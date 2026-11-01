---
title: "Embedded Debugging: Finding Bugs Beyond printf()"
brief: "Beyond printf(): SWD and JTAG debuggers, breakpoints, trace, logic analyzers and oscilloscopes, and a method for hard bugs."
order: 22
phase: 5
tags: ["JTAG", "SWD", "GDB", "Breakpoints"]
---

You are three days into debugging a timing-sensitive communication fault on a production STM32F4 board. The UART packet occasionally corrupts on byte 5.

This is not a contrived scenario. It happens on real hardware, on real schedules, with real consequences.

## The Fundamental Problem

Every embedded engineer starts with printf(). It is familiar, it is simple, and it works well enough on desktop software.

The naive approach also fails in resource-constrained environments for simpler reasons. Semihosting via printf() requires a debugger to be connected and halts the processor on every output call.

## The Big Picture

![Debug Probe and JTAG/SWD Connection](/diagrams/debug_probe.svg)

A modern ARM Cortex-M MCU contains a built-in debug subsystem called the CoreSight architecture. This subsystem is separate from the application processor and can observe and control the CPU without the CPU knowing it is being watched.

The key architectural insight is that hardware breakpoints, watchpoints, and trace are all handled by dedicated silicon inside the MCU. The CPU does not execute extra instructions to check whether a breakpoint has been hit.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **JTAG** | Joint Test Action Group, IEEE 1149.1. |
| **SWD** | Serial Wire Debug, ARM's two-pin alternative to JTAG. |
| **Hardware Breakpoint** | A breakpoint implemented by dedicated silicon (the Flash Patch and Breakpoint unit, FPB, on Cortex-M). |
| **Software Breakpoint** | Implemented by replacing the instruction at the target address with a BKPT instruction (opcode 0xBE00 on Thumb-2). |
| **Watchpoint** | A data breakpoint implemented by the Data Watchpoint and Trace unit (DWT). |
| **ITM** | Instrumentation Trace Macrocell. |

## How It Works

### Step 1: Establishing the debug connection

The debug probe enumerates as a USB device on the host PC. The IDE or GDB client opens the probe and initiates a connection to the MCU's Debug Access Port (DAP) over JTAG or SWD.

### Step 2: Halting and inspecting the CPU

To halt the CPU, the debugger writes the DHCSR (Debug Halting Control and Status Register) in the CoreSight address space (0xE000EDF0 on Cortex-M). Setting the C_HALT and C_DEBUGEN bits requests a halt.

### Step 3: Setting hardware breakpoints

The debugger programs a comparator in the FPB unit with the target address. On Cortex-M3/M4, the FPB has 6 instruction comparators (FP_COMP0 through FP_COMP5) and 2 literal comparators.

### Step 4: Configuring watchpoints

The DWT unit contains up to 4 comparators on Cortex-M4. Each comparator has a DWT_COMPn (address), DWT_MASKn (address mask for range matching), and DWT_FUNCTIONn register.

### Step 5: Enabling ITM/SWO trace

The firmware (or the debugger's startup script) must configure the TPIU, ITM, and DWT for trace output. The steps are: enable the trace clock (CoreSight TrClkEn), set the SWO baud rate divisor in the TPIU_ACPR register, set TPIU encoding to NRZ or Manchester in TPIU_SPPR, enable DWT and ITM in DEMCR, unlock the ITM with the key 0xC5ACCE55 written to ITM_LAR, and enable the desired stimulus ports in ITM_TER.

### Step 6: Using the logic analyzer for protocol capture

Connect the logic analyzer ground to board ground and attach probes to the relevant signal lines. Configure the sample rate to at least 4 times the highest clock frequency you expect to see (10x is better for clean decode).

### Step 7: Oscilloscope verification of analog conditions

Probe the signal with a 10x passive probe; use ground leads as short as possible to avoid adding inductance to the measurement. Set the time base to show 3-5 full cycles of the signal.

## Under the Hood

The FPB unit sits between the instruction fetch bus and the rest of the CPU pipeline. On Cortex-M3 and M4, it operates on the Instruction Bus (I-Code bus) which is separate from the Data Bus (D-Code bus).

The DWT sits on the AHB bus fabric, not on the CPU pipeline directly. It monitors all AHB transactions, including DMA transfers, not just CPU memory accesses.

## Real-World Applications

**Automotive.** In an automotive body control module (BCM) running on an S32K144 Cortex-M4, LIN bus communication faults that appear only at temperature extremes are nearly impossible to debug with printf(). Engineers use a combination of a DWT watchpoint on the LIN status register and ITM trace to log the register values in real time.

**Consumer electronics.** A wireless earphone firmware on a Cortex-M0+ uses hardware breakpoints and SWD heavily during RF bring-up. The device has no spare UART pins.

## Common Mistakes

### Leaving semihosting calls in production firmware

**What goes wrong:** The firmware builds and passes testing with a debugger attached. On production hardware with no debugger, the BKPT instruction in the semihosting call causes an unhandled debug event, resulting in a HardFault.

**How to avoid it:** Use a compiler-defined symbol to conditionally compile semihosting out, or replace the semihosting retarget layer with a UART or ITM implementation before production. Review the linker map and search for semihosting symbols (SYS_WRITE, __semihost) as a release gate check.

### Confusing hardware and software breakpoints

**What goes wrong:** The engineer sets many breakpoints in an IDE and does not realize the IDE has silently switched to software breakpoints after exhausting the 6 hardware comparators. Software breakpoints in flash do not work on most ARM Cortex-M devices because the debug hardware cannot modify flash at runtime.

**How to avoid it:** Know the hardware breakpoint limit for your target (typically 6 for Cortex-M4). Use hardware breakpoints for flash code.

### Watchdog resetting during debug halt

**What goes wrong:** The engineer halts the CPU on a breakpoint to inspect state. After a few seconds, the MCU resets.

**How to avoid it:** In the debugger startup script or DBGMCU initialization, set DBG_IWDG_STOP and DBG_WWDG_STOP bits in DBGMCU_APB1_FZ (STM32 example). Most IDEs handle this automatically for common STM32 devices, but verify for custom targets.

## Debugging and Troubleshooting

**Symptom:** HardFault on boot, no debugger output visible.

**Possible Cause:** Semihosting BKPT instruction executed with no debugger attached, or vector table points to invalid handler addresses.

**Investigation Method:** Attach the debugger BEFORE the device resets.

**Resolution:** If HFSR shows DEBUGEVT set (bit 31), the cause is a BKPT with no debugger.

**Symptom:** Global variable is being overwritten with a wrong value at an unknown point in execution.

**Possible Cause:** Memory corruption from a buffer overflow, incorrect pointer arithmetic, or an uninitialized pointer write.

**Investigation Method:** Determine the address of the variable (from the linker map or GDB "info address").

**Resolution:** Trace the call stack from the halt location.

## Design Considerations and Best Practices

**Always expose SWD test points on hardware.** Even if the production BOM does not include a debug connector, place two test points for SWDIO and SWCLK plus one for GND on every PCB. The marginal cost is under $0.05.

**Configure DBGMCU freeze registers early in firmware bring-up.** During bring-up, set the debug freeze bits for all watchdog timers and communication peripherals. This prevents the watchdog from resetting the device during halt and stops UART baud rate timers from counting while you inspect state.

## Expert Notes

**The reset vector is your first breakpoint opportunity.** Many engineers try to set a breakpoint in main() during initial bring-up and are confused when the device resets before reaching it. The correct approach is to set a breakpoint on the reset handler (Reset_Handler in startup_stm32xxxx.s) or to configure the debugger to halt on reset.

**ITM data is lost if the probe cannot keep up.** The SWO pin is a one-way stream. If the probe's USB host cannot drain the data fast enough, the probe's internal buffer overflows and trace packets are silently dropped.

## Summary

Debugging embedded systems requires a fundamentally different mindset from debugging desktop software. The core discipline is non-perturbative observation: using tools that let you see what the hardware is doing without changing what the hardware is doing. Hardware breakpoints halt the CPU without modifying code.

The physical layer of debugging is equally important. Software can only see what software can see. A logic analyzer watching an I2C bus sees bus errors, address NACKs, clock stretching violations, and glitches that no amount of firmware logging would ever reveal.

## Related Topics

**Prerequisites**

- MCU Boot Sequence (understanding reset vector, startup code, vector table layout)
- CPU Execution Model (pipeline, privilege levels, exception model, stack frames)
- C Pitfalls in Embedded (pointers, volatile, memory-mapped registers)

**Next Topics**

- Fault Handling and Crash Analysis (decoding CFSR/HFSR, writing robust fault handlers, field logging)
- Memory Corruption and System Stability (stack overflow detection, MPU configuration, heap integrity)
- RTOS Fundamentals (task-aware debugging, deadlock detection, stack usage analysis)
- Logging and Field Diagnostics (persistent fault logs, field debug interfaces, RTT in production)
