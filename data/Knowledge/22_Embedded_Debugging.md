---
id: embedded-debugging
tags: ['JTAG', 'SWD', 'GDB', 'Breakpoints']
---

# Embedded Debugging: Beyond printf()

You are three days into debugging a timing-sensitive communication fault on a production STM32F4 board. The UART packet occasionally corrupts on byte 5. You added a printf() call to log the buffer contents just before transmission. The bug vanished. You removed the printf(). The bug came back. You have just met a Heisenbug, and printf() is its best friend.

This is not a contrived scenario. It happens on real hardware, on real schedules, with real consequences. The act of observing the system through printf() changes the system. The delay introduced by a blocking UART write shifts timing relationships, alters interrupt latency, and perturbs DMA transfer windows just enough to hide the exact race condition you are hunting. You are no longer debugging your firmware; you are debugging a different firmware that happens to look like yours.

The embedded debugging problem runs deeper than Heisenbugs. Code runs on bare metal where there is no operating system to catch faults gracefully, no memory manager to report leaks, and no debugger attached by default. The MCU boots, executes instructions, and either works or silently misbehaves. A corrupted stack pointer causes a fault handler to fire three hundred instructions after the actual error. A watchdog resets the device before any log gets written. A peripheral register gets written to once at startup and never again, yet six weeks later a production unit fails because a single field in that register was wrong from day one.

The tools and techniques covered in this article exist because engineers needed ways to observe running systems without perturbing them, stop execution at precise moments without rewriting the firmware, and capture hardware-level signals that software cannot see. JTAG, SWD, hardware breakpoints, watchpoints, ITM/SWO tracing, semi-hosting, logic analyzers, and oscilloscopes are not optional luxuries. They are the vocabulary of production-quality embedded engineering.

By the end of this article, you will understand how each of these tools works at a hardware level, when to use each one, how they interact with the CPU and debug subsystem, and how to avoid the common traps that waste days of debugging time.

## The Fundamental Problem

Every embedded engineer starts with printf(). It is familiar, it is simple, and it works well enough on desktop software. On an MCU, printf() over a UART is a blocking, timing-perturbing, resource-consuming operation that changes the very behavior you are trying to observe. On an ARM Cortex-M4 running at 168 MHz with a UART at 115200 baud, printing a 40-character string takes roughly 3.5 milliseconds. During those 3.5 milliseconds, interrupts may be deferred, DMA transactions may stall waiting for CPU acknowledgment, and any task with a period shorter than 3.5 ms has already missed its deadline. You have not observed the bug; you have surgically removed it.

The naive approach also fails in resource-constrained environments for simpler reasons. Semihosting via printf() requires a debugger to be connected and halts the processor on every output call. On a Cortex-M, unhandled semihosting calls with no debugger attached cause a HardFault. Flash and RAM are limited; a full printf() implementation may consume 20-40 KB of flash, which is the entire program budget on a small AVR or low-end Cortex-M0. You cannot ship firmware with a full semihosting stack in production, which means your debug build and your production build are not the same binary, and you are not testing what you will ship.

The deeper problem is that software cannot see hardware. A logic analyzer can show you that your SPI clock line has a glitch at microsecond 47 of a transaction. A UART printf() cannot tell you this because software never knows it happened. The processor clocked out the bytes and moved on. Similarly, printf() cannot tell you which instruction caused a HardFault because by the time the fault handler runs, the call stack may already be corrupt. You need tools that operate at or below the hardware boundary.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/debug_probe.svg" alt="Debug Probe and JTAG/SWD Connection" loading="lazy">
</div>

A modern ARM Cortex-M MCU contains a built-in debug subsystem called the CoreSight architecture. This subsystem is separate from the application processor and can observe and control the CPU without the CPU knowing it is being watched. The debug subsystem connects to the outside world through a physical interface, either JTAG (4-5 pins) or SWD (2 pins). A debug probe, such as a J-Link, ST-LINK, or CMSIS-DAP adapter, sits between your host PC and this interface. The IDE or GDB running on the PC sends commands to the probe, which translates them into JTAG/SWD transactions, which the CoreSight subsystem executes on the live CPU.

The key architectural insight is that hardware breakpoints, watchpoints, and trace are all handled by dedicated silicon inside the MCU. The CPU does not execute extra instructions to check whether a breakpoint has been hit. The debug hardware monitors the instruction pipeline and the bus fabric independently and halts or logs events without software involvement. This is why hardware breakpoints do not perturb timing the way software patches do.

The trace subsystem adds another dimension. The Instrumentation Trace Macrocell (ITM) and the Serial Wire Output (SWO) pin allow the MCU to stream lightweight debug data to the probe in real time while the application continues executing at full speed. No halts, no printf(), no timing perturbation.

## Key Concepts and Terminology

**Jtag** — Joint Test Action Group, IEEE 1149.1. A four or five-wire serial interface originally designed for board-level boundary scan testing. In embedded debugging, the same pins (TCK, TMS, TDI, TDO, optional TRST) are used to communicate with the CoreSight DAP. JTAG supports multiple devices chained on one bus (daisy-chain topology) and is the standard for FPGAs, complex SoCs, and legacy MCUs. It consumes more pins than SWD and is generally not used for new ARM Cortex-M designs unless chain scanning is required.

**Swd** — Serial Wire Debug, ARM's two-pin alternative to JTAG. Uses SWDIO (bidirectional data) and SWCLK (clock). SWD is the practical choice for most Cortex-M development because it requires only two MCU pins and still provides full debug and programming access. The SWO pin (Serial Wire Output) is a third optional pin that adds trace output. STM32 devices expose SWD as the default debug interface; the full JTAG pins are also available on most packages.

**Hardware Breakpoint** — A breakpoint implemented by dedicated silicon (the Flash Patch and Breakpoint unit, FPB, on Cortex-M). When the CPU fetches an instruction at the address stored in an FPB comparator register, the debug hardware halts the CPU before that instruction executes. No instruction in flash is modified. The application code is byte-for-byte identical before and after a hardware breakpoint is set. Cortex-M3/M4/M7 devices typically have 6 hardware breakpoints; Cortex-M33 may have more.

**Software Breakpoint** — Implemented by replacing the instruction at the target address with a BKPT instruction (opcode 0xBE00 on Thumb-2). The CPU executes the BKPT opcode and traps to the debug monitor. Software breakpoints can be set at unlimited locations but they modify the code in RAM (they cannot be placed in read-only flash without erasing). They also perturb the instruction cache on devices that have one.

**Watchpoint** — A data breakpoint implemented by the Data Watchpoint and Trace unit (DWT). The DWT monitors the AHB data bus and halts (or traces) when a specific memory address is read, written, or accessed with a specific value. Watchpoints are invaluable for memory corruption bugs: configure a watchpoint on the address of a variable that is being mysteriously overwritten, and the CPU will halt the instant the write occurs.

**Itm** — Instrumentation Trace Macrocell. A set of 32 stimulus ports inside the CoreSight subsystem. Firmware writes 8, 16, or 32-bit values to ITM stimulus registers. The ITM packetizes these writes and emits them on the SWO pin. The host receives and decodes them. A properly implemented ITM logging function is non-blocking from the firmware's perspective (it writes to a FIFO) and introduces orders-of-magnitude less latency than a UART printf(). ITM channel 0 is used by the ARM semihosting printf() implementation in many toolchains; custom channels (1-31) are available for application-defined trace.

**Swo** — Serial Wire Output. A single-pin output from the TPIU (Trace Port Interface Unit) that carries ITM, DWT, and ETM trace data from the MCU to the debug probe. SWO uses either Manchester encoding (UART-compatible, lower speed) or NRZ encoding. The data rate must be configured consistently between the MCU's TPIU and the probe. On an STM32 with a 168 MHz core clock, SWO speeds of 2 MHz are routinely achievable and sufficient for ITM logging.

**Semihosting** — A mechanism by which firmware makes requests to the host debugger at runtime, originally to redirect I/O (printf, file access, clock reads) through the debug connection. Implemented as a BKPT instruction with a specific register state; the debug probe intercepts the halt and services the request. Semihosting is useful in early bring-up when no UART is available, but it halts the CPU on every call. It must never be left in production firmware.

**Logic Analyzer** — An instrument that captures and time-stamps digital signal transitions across multiple channels simultaneously. A logic analyzer decodes protocols (SPI, I2C, UART, CAN) from raw signal transitions. It answers questions like "did the chip select de-assert at the right time?" and "did the slave ACK on I2C?" that pure software debugging cannot answer. Modern USB logic analyzers (Saleae Logic, sigrok/PulseView) give 8-16 channels at 24-100 MHz sample rates for under $200.

**Oscilloscope** — An instrument that captures analog voltage waveforms over time. Where a logic analyzer shows clean digital transitions, an oscilloscope shows the actual voltage levels, rise times, overshoot, ringing, and noise. An oscilloscope is the correct tool when you suspect signal integrity problems: a 3.3 V SPI line that overshoots to 4.1 V, an I2C pull-up that is too weak to meet the 1 microsecond rise time spec, or a power rail that droops 200 mV during a burst write.

## How It Works

STEP 1: ESTABLISHING THE DEBUG CONNECTION The debug probe enumerates as a USB device on the host PC. The IDE or GDB client opens the probe and initiates a connection to the MCU's Debug Access Port (DAP) over JTAG or SWD. During SWD connection, the probe sends a specific line-reset sequence (50 or more clock cycles with SWDIO high) followed by a JTAG-to-SWD switching sequence. This resets the DAP state machine and identifies the target. The probe reads the DPIDR register to confirm the DAP type and revision. At this point, the host has a logical connection to the AHB bus of the MCU and can read and write any memory-mapped address, including peripheral registers, RAM, and flash controller registers.

STEP 2: HALTING AND INSPECTING THE CPU To halt the CPU, the debugger writes the DHCSR (Debug Halting Control and Status Register) in the CoreSight address space (0xE000EDF0 on Cortex-M). Setting the C_HALT and C_DEBUGEN bits requests a halt. The CPU completes its current instruction and halts; it does not execute any more instructions until released. The debugger then reads the 16 core registers (R0-R15, PSR, MSP, PSP) by reading the DCRSR and DCRDR registers. The programmer sees a complete snapshot of CPU state at the point of halt. Stack frames can be unwound from SP and LR to reconstruct the call chain.

STEP 3: SETTING HARDWARE BREAKPOINTS The debugger programs a comparator in the FPB unit with the target address. On Cortex-M3/M4, the FPB has 6 instruction comparators (FP_COMP0 through FP_COMP5) and 2 literal comparators. The debugger writes the target address to an FP_COMPn register and sets the ENABLE bit. When the CPU's instruction fetch unit presents an address that matches any enabled comparator, the FPB asserts a debug event, and the CPU halts after completing any prior instruction but before executing the instruction at the breakpoint address. The firmware in flash is not modified in any way. Releasing the CPU from the halt (writing C_STEP or C_HALT=0 to DHCSR) resumes execution.

STEP 4: CONFIGURING WATCHPOINTS The DWT unit contains up to 4 comparators on Cortex-M4. Each comparator has a DWT_COMPn (address), DWT_MASKn (address mask for range matching), and DWT_FUNCTIONn register. To halt on a write to a specific global variable, the debugger writes the variable's address to DWT_COMP0, sets DWT_MASK0 to 0 (exact address match), and writes 0x6 to DWT_FUNCTION0 (halt on write). When any AHB bus master, including DMA, writes to that address, the DWT fires a watchpoint event and the CPU halts. The instruction that caused the write is identified from the PC at halt. This is the correct tool for tracking down silent memory corruption.

STEP 5: ENABLING ITM/SWO TRACE The firmware (or the debugger's startup script) must configure the TPIU, ITM, and DWT for trace output. The steps are: enable the trace clock (CoreSight TrClkEn), set the SWO baud rate divisor in the TPIU_ACPR register, set TPIU encoding to NRZ or Manchester in TPIU_SPPR, enable DWT and ITM in DEMCR, unlock the ITM with the key 0xC5ACCE55 written to ITM_LAR, and enable the desired stimulus ports in ITM_TER. Firmware then writes to ITM_STIM0 (or other channels) as printf() replacements. The writes are non-blocking if the FIFO has space; the firmware can check the FIFO-full bit before writing. The probe collects the SWO stream, decodes the TPIU framing, and presents the data in the IDE's SWV (Serial Wire Viewer) window.

STEP 6: USING THE LOGIC ANALYZER FOR PROTOCOL CAPTURE Connect the logic analyzer ground to board ground and attach probes to the relevant signal lines. Configure the sample rate to at least 4 times the highest clock frequency you expect to see (10x is better for clean decode). In the protocol decoder, select the protocol (SPI, I2C, UART, etc.) and configure parameters (clock polarity, phase, baud rate, bit order). Trigger on a specific event: chip select assertion, a specific byte value, or a falling edge on a data line. Capture and inspect the decoded transaction. Compare the decoded bytes against the expected protocol framing documented in the peripheral's datasheet. Discrepancies in byte order, ACK/NAK, or bit timing are immediately visible.

STEP 7: OSCILLOSCOPE VERIFICATION OF ANALOG CONDITIONS Probe the signal with a 10x passive probe; use ground leads as short as possible to avoid adding inductance to the measurement. Set the time base to show 3-5 full cycles of the signal. Check rise and fall times against the specification. Measure overshoot and undershoot. If debugging a power supply droop during a radio transmission burst, trigger on the TX_ENABLE signal and observe the VDD rail on a second channel. Measure the worst-case droop in millivolts and compare to the minimum operating voltage of your MCU and peripherals.

## Under the Hood

The FPB unit sits between the instruction fetch bus and the rest of the CPU pipeline. On Cortex-M3 and M4, it operates on the Instruction Bus (I-Code bus) which is separate from the Data Bus (D-Code bus). This is why FPB comparators match instruction addresses only; you cannot set a hardware breakpoint on a data read. The FPB can also remap flash addresses to RAM addresses (the "patch" part of Flash Patch and Breakpoint), which is how some bootloaders implement in-field code patching without reflashing. This remap function shares the same comparator hardware as breakpoints, so using remap reduces the available breakpoint count.

The DWT sits on the AHB bus fabric, not on the CPU pipeline directly. It monitors all AHB transactions, including DMA transfers, not just CPU memory accesses. This is a critical and often missed point: a DWT watchpoint will fire if DMA writes to the watched address, even if no CPU instruction is involved. The DWT also has a cycle counter (DWT_CYCCNT) that increments every CPU clock cycle. By reading CYCCNT before and after a code section, you can measure execution time with single-cycle precision without using a hardware timer peripheral. This is far superior to toggling a GPIO and measuring with an oscilloscope because it requires no external equipment and has known, fixed overhead.

The ITM FIFO is 32 words deep. If firmware writes to ITM stimulus registers faster than the SWO pin can drain them, the FIFO fills and writes are dropped. The firmware can poll bit 0 of the stimulus register before writing (a 1 indicates the FIFO has space). In practice, at 168 MHz core clock and a 2 MHz SWO rate, you can emit roughly 200,000 bytes per second, which is sufficient for moderate logging. Increasing the SWO clock rate up to the probe's limit (J-Link supports SWO at up to 50 MHz) significantly increases throughput. Unlike UART printf(), ITM writes are 32-bit word writes to a memory-mapped register, which takes a few CPU cycles, not thousands.

ARM ETM (Embedded Trace Macrocell) is the fourth trace component, not discussed in depth here because it requires a parallel trace port (4-8 pins) and a specialized trace probe rather than the simple SWO pin. ETM captures every instruction executed, enabling full instruction trace and code coverage analysis. It is available on Cortex-M4 and higher but rarely used outside of safety-critical development (IEC 61508, ISO 26262) due to the pin and tooling requirements.

When the CPU halts due to a breakpoint or watchpoint, the clock to the CPU core stops but clocks to peripherals (including DMA, timers, and communication peripherals) may or may not stop depending on the device's debug configuration registers. On STM32, the DBGMCU_CR register controls which peripherals freeze at halt. Timers used for timeout detection will continue counting while the CPU is stopped unless DBG_TIMx_STOP is set. This means a watchdog timer WILL reset the MCU if the CPU is halted for too long with the watchdog running, unless you also enable DBG_IWDG_STOP and DBG_WWDG_STOP in DBGMCU.

## Real-World Applications

AUTOMOTIVE In an automotive body control module (BCM) running on an S32K144 Cortex-M4, LIN bus communication faults that appear only at temperature extremes are nearly impossible to debug with printf(). Engineers use a combination of a DWT watchpoint on the LIN status register and ITM trace to log the register values in real time. A logic analyzer on the LIN bus simultaneously captures the bus-level frame. When the fault occurs at 85 degrees C, the ITM log shows the error flag set and the logic analyzer shows the dominant time exceeding the specification by 15 microseconds. The fault is a pull-up resistor value drift at temperature; no software change would have revealed it.

CONSUMER ELECTRONICS A wireless earphone firmware on a Cortex-M0+ uses hardware breakpoints and SWD heavily during RF bring-up. The device has no spare UART pins. SWD is the only debug interface available, and ITM is not available on Cortex-M0+ (it lacks SWO). The engineer uses a J-Link in RTT (Real-Time Transfer) mode, which uses a RAM-based ring buffer polled by the debugger over SWD without halting the CPU. RTT is a practical ITM alternative for devices without SWO.

INDUSTRIAL A motor drive controller based on STM32G474 requires real-time cycle-accurate execution time profiling of the FOC (Field Oriented Control) interrupt handler to verify it completes within the 50-microsecond PWM period. The DWT cycle counter is read at ISR entry and exit, and the difference is logged via ITM. The worst-case execution time appears in the SWV trace window. No oscilloscope or timer peripheral is consumed; the debug hardware handles it entirely.

MEDICAL An infusion pump firmware requires IEC 62304 software lifecycle compliance, which includes evidence of test coverage. ETM instruction trace, where available, provides automatic code coverage data during qualification testing. For devices without ETM, DWT PC sampling (periodic capture of the program counter by the DWT) provides statistical coverage data over long test runs, which is captured by the debug probe without modifying the firmware under test.

AEROSPACE An avionics data concentrator running on a radiation-tolerant LEON3 processor uses JTAG boundary scan for board-level test, and JTAG debug access for pre-flight validation. Because LEON3 is not a Cortex-M, CoreSight is not available, but the JTAG debug port provides halt, step, and register inspect capabilities through a GRLIB debug support unit. The debugging workflow is conceptually identical: halt, read registers, set breakpoints, resume.

IoT A low-power sensor node on an nRF52840 Cortex-M4 uses SWD for programming and initial debugging, then transitions to RTT for field diagnostics. A test point pair on the PCB exposes SWDIO and SWCLK. In the field, a technician can clip a debug probe onto the test points and read the RTT log without firmware modification, without breaking the power budget, and without accessing UART pins that do not exist on the production board.

## Common Mistakes

MISTAKE: LEAVING SEMIHOSTING CALLS IN PRODUCTION FIRMWARE What goes wrong: The firmware builds and passes testing with a debugger attached. On production hardware with no debugger, the BKPT instruction in the semihosting call causes an unhandled debug event, resulting in a HardFault. The device resets in a loop. The field failure report says "device stuck on boot." How to avoid it: Use a compiler-defined symbol to conditionally compile semihosting out, or replace the semihosting retarget layer with a UART or ITM implementation before production. Review the linker map and search for semihosting symbols (SYS_WRITE, __semihost) as a release gate check.

MISTAKE: CONFUSING HARDWARE AND SOFTWARE BREAKPOINTS What goes wrong: The engineer sets many breakpoints in an IDE and does not realize the IDE has silently switched to software breakpoints after exhausting the 6 hardware comparators. Software breakpoints in flash do not work on most ARM Cortex-M devices because the debug hardware cannot modify flash at runtime. The breakpoints appear set but never fire. How to avoid it: Know the hardware breakpoint limit for your target (typically 6 for Cortex-M4). Use hardware breakpoints for flash code. Reserve software breakpoints for RAM-resident code (which is rare). Check the IDE's breakpoint type indicator.

MISTAKE: WATCHDOG RESETTING DURING DEBUG HALT What goes wrong: The engineer halts the CPU on a breakpoint to inspect state. After a few seconds, the MCU resets. The DBGMCU freeze configuration was never set, so the IWDG or WWDG continued counting and expired. How to avoid it: In the debugger startup script or DBGMCU initialization, set DBG_IWDG_STOP and DBG_WWDG_STOP bits in DBGMCU_APB1_FZ (STM32 example). Most IDEs handle this automatically for common STM32 devices, but verify for custom targets.

MISTAKE: WRONG SWO CLOCK CONFIGURATION What goes wrong: ITM is enabled but the SWV window shows garbage or no data. The SWO baud rate configured in the TPIU does not match the rate configured in the probe or IDE. How to avoid it: The SWO prescaler is computed from the CPU clock: TPIU_ACPR = (CPU_CLK / SWO_BAUD) - 1. Both the firmware initialization and the IDE's SWV configuration must use the same SWO baud value. Verify with: if CPU is 168 MHz and SWO is set to 2 MHz, ACPR = 83. Confirm the IDE setting shows 2000000 baud to match.

MISTAKE: PROBING WITH TOO LONG A GROUND LEAD What goes wrong: The oscilloscope shows high-frequency ringing on SPI clock edges that does not correlate with any actual signal integrity problem on the board. The measurement itself is the problem: a 20 cm ground lead forms an inductor that resonates with the probe tip capacitance. How to avoid it: Use the shortest possible ground lead, or the probe's spring-tip ground attachment. For signals above 10 MHz, use a ground clip within 1-2 cm of the probe tip.

MISTAKE: USING ITM LOGGING IN AN ISR WITHOUT CHECKING THE FIFO What goes wrong: The ISR writes to ITM_STIM0 unconditionally. The FIFO is full because the main loop is also logging. The write blocks until the FIFO drains, extending ISR execution time unpredictably and violating real-time constraints. How to avoid it: In time-critical ISRs, either skip the ITM write if the FIFO is full (check bit 0 of the stimulus register) or use a DWT-based logging scheme that does not write to the ITM from interrupt context.

MISTAKE: RELYING ON THE DISASSEMBLY VIEW FOR PERFORMANCE PROFILING What goes wrong: The engineer counts instruction cycles from the disassembly listing to estimate loop execution time, misses cache effects, pipeline stalls, wait states on flash reads, and AHB bus contention from DMA. How to avoid it: Use DWT_CYCCNT for actual cycle counts on real hardware. The measured value includes all real-world effects that static analysis misses.

## Debugging and Troubleshooting

**Symptom:** HardFault on boot, no debugger output visible.

**Possible Cause:** Semihosting BKPT instruction executed with no debugger attached, or vector table points to invalid handler addresses.

**Investigation Method:** Attach the debugger BEFORE the device resets. Set a breakpoint at the HardFault handler entry point. Let the device boot with the debugger connected. When the fault fires, inspect the stacked PC and LR values to find the faulting instruction. Check CFSR (0xE000ED28), HFSR (0xE000ED2C), and MMFAR (0xE000ED34) registers.

**Resolution:** If HFSR shows DEBUGEVT set (bit 31), the cause is a BKPT with no debugger. Remove semihosting calls. If CFSR shows a precise bus fault, the stacked PC points directly to the faulting instruction; trace the call stack from there.

**Symptom:** Global variable is being overwritten with a wrong value at an unknown point in execution.

**Possible Cause:** Memory corruption from a buffer overflow, incorrect pointer arithmetic, or an uninitialized pointer write.

**Investigation Method:** Determine the address of the variable (from the linker map or GDB "info address"). Configure a DWT watchpoint on that address set to halt on write. Run the firmware. The CPU will halt the instant any write occurs to that address. Inspect the PC at halt to identify the exact instruction causing the write.

**Resolution:** Trace the call stack from the halt location. If the write comes from DMA, inspect the DMA source address and transfer length configuration. If from a function, inspect the pointer origin.

**Symptom:** SPI transaction produces incorrect data from the slave device; software log shows correct bytes transmitted.

**Possible Cause:** SPI mode mismatch (CPOL/CPHA), incorrect bit order, chip select timing violation, or bus contention.

**Investigation Method:** Attach a logic analyzer to MOSI, MISO, SCK, and CS. Capture one complete transaction. Verify CPOL and CPHA by observing clock idle state and the clock edge on which MOSI changes. Verify CS de-assertion timing matches the slave's minimum CS high time. Compare decoded bytes against the expected command sequence.

**Resolution:** Correct the SPI_CR1 CPOL/CPHA configuration bits. Add a software delay between consecutive transactions if CS timing is violated. Check for any other SPI master sharing the bus.

**Symptom:** System is slower in debug builds than release builds; performance issue disappears when profiling code is added.

**Possible Cause:** Compiler optimizations disabled in debug build; profiling code itself perturbs timing; flash wait states differ between configurations.

**Investigation Method:** Use DWT_CYCCNT to measure execution time in the release build (not debug build) with no additional code changes. Compare with the theoretical minimum from the processor manual. Enable the ARM cycle counter and read it from within an unmodified interrupt handler.

**Resolution:** If the release build meets timing and the debug build does not, the difference is optimization and instrumentation overhead; this is expected. If the release build also misses timing, investigate DMA, flash wait states, and interrupt latency using DWT profiling in the release binary.

## Design Considerations and Best Practices

ALWAYS EXPOSE SWD TEST POINTS ON HARDWARE Even if the production BOM does not include a debug connector, place two test points for SWDIO and SWCLK plus one for GND on every PCB. The marginal cost is under $0.05. The cost of debugging a production board without any debug access can be days. A pogo-pin fixture can contact these test points for production programming and field diagnostics.

CONFIGURE DBGMCU FREEZE REGISTERS EARLY IN FIRMWARE BRING-UP During bring-up, set the debug freeze bits for all watchdog timers and communication peripherals. This prevents the watchdog from resetting the device during halt and stops UART baud rate timers from counting while you inspect state. On STM32, this is a two-register write to DBGMCU_APB1_FZ and DBGMCU_APB2_FZ. Make this part of your SystemInit() or bring-up checklist.

USE DWT_CYCCNT INSTEAD OF GPIO TOGGLING FOR TIMING MEASUREMENTS GPIO toggling wastes a pin, consumes bus bandwidth, and introduces its own latency (the GPIO write takes cycles). DWT_CYCCNT is free, always available on Cortex-M3 and higher, and gives single-cycle accuracy. Write a two-line inline macro: capture CYCCNT at start, subtract from CYCCNT at end, convert to microseconds using the known clock frequency.

IMPLEMENT A LIGHTWEIGHT ITM LOGGING LAYER EARLY IN THE PROJECT A simple itm_log(channel, value) wrapper costs almost nothing to write and will save many hours over the project lifetime. Make it check the ITM FIFO before writing to avoid blocking in ISRs. Assign channel 0 to printf()-style text output (compatible with most IDE SWV viewers), and use channels 1-4 for structured binary data such as task event codes, state machine transitions, and timing measurements.

KNOW THE DIFFERENCE BETWEEN HARDWARE WATCHPOINTS AND SOFTWARE MEMORY GUARDS Hardware watchpoints catch the exact instruction doing the write with zero overhead. Software memory guards (canary values around buffers, MPU region faults) catch the corruption after the fact, at the granularity of the guard check interval. Use hardware watchpoints in development to find the root cause. Use MPU-based guards in production firmware to detect and handle corruption that slips through.

NEVER RELY ON A SINGLE INSTRUMENT IN ISOLATION A logic analyzer that shows correct bytes does not rule out a signal integrity problem. An oscilloscope that shows clean edges does not confirm correct byte values. The combination of an oscilloscope (analog health), a logic analyzer (protocol correctness), and ITM trace (firmware state) gives a complete picture. When a bug survives all three, check the clock.

TREAT THE LINKER MAP AS A DEBUGGING TOOL Every unknown memory corruption hunt should begin with the linker map. Identify the address ranges of all global variables, stack, heap, and linker sections. A watchpoint on an address tells you nothing if you do not know what lives there. The linker map is the ground truth for memory layout. Keep it in version control alongside the firmware binary.

USE CONDITIONAL COMPILATION TO SEPARATE DEBUG AND PRODUCTION LOGGING Define a DEBUG_BUILD symbol and gate all debug logging, ITM writes, and assertion checks behind it. The production binary must be warnings-clean, not include semihosting, and have the same memory layout as the tested binary. Use a separate NDEBUG guard for assert() calls. Review the production binary's linker map to confirm no debug symbols or semihosting stubs are present before release.

## Expert Notes

THE RESET VECTOR IS YOUR FIRST BREAKPOINT OPPORTUNITY Many engineers try to set a breakpoint in main() during initial bring-up and are confused when the device resets before reaching it. The correct approach is to set a breakpoint on the reset handler (Reset_Handler in startup_stm32xxxx.s) or to configure the debugger to halt on reset. Most debug probes support a "halt on reset" option that stops the CPU at the first instruction after the vector table loads. This is the only reliable way to debug code that runs before main().

ITM DATA IS LOST IF THE PROBE CANNOT KEEP UP The SWO pin is a one-way stream. If the probe's USB host cannot drain the data fast enough, the probe's internal buffer overflows and trace packets are silently dropped. The SWV window may show no indication of the loss. When timing measurements from ITM look suspicious, lower the logging rate, reduce the SWO clock, or use a faster USB port. J-Link has a protocol-level mechanism (TPIU sync packets) that allows partial recovery of a lost stream; CMSIS-DAP probes generally do not.

THE DWT CYCLE COUNTER WRAPS AROUND DWT_CYCCNT is a 32-bit counter. At 168 MHz, it wraps after approximately 25.6 seconds. Code that computes elapsed time by simple subtraction is correct as long as the time interval is less than 25.6 seconds (because unsigned 32-bit subtraction handles wrap-around correctly). Code that compares absolute counter values across wrap points is wrong. This is the same bug as the 32-bit millis() rollover on Arduino, but with a 25-second period instead of 49 days.

FLASH PATCH REMAPPING AFFECTS BREAKPOINT COUNT On Cortex-M3/M4, the FPB has 6 instruction comparators. If the bootloader or a patching library has used any comparators for address remapping, those comparators are unavailable for debug breakpoints. You may find that you can only set 4 breakpoints when you expect 6. Inspect the FPB comparator registers (0xE0002008 through 0xE0002020) to see which are already enabled and what addresses they are mapped to.

CLOCKS CHANGE BEHAVIOR WHEN THE CPU IS HALTED Several MCU subsystems derive their clock from the CPU or from a clock gating scheme that is aware of the debug halt state. On some STM32 devices, the ADC sample rate is affected by whether the core is halted. An ADC conversion that completes in 1 microsecond at runtime may appear to complete instantly in a debug session because the timer counting the sample period is configured to freeze at halt. Be cautious drawing conclusions about timing from register values read while the CPU is stopped.

LEARN TO READ THE FAULT STATUS REGISTERS WITHOUT RELYING ON THE IDE The CFSR, HFSR, MMFAR, and BFAR registers at 0xE000ED28 through 0xE000ED3C are the post-mortem record of every ARM Cortex-M fault. The IDE's fault analyzer is helpful but can be unavailable in field failures. Write a fault handler that dumps these registers, the stacked PC, and the stacked LR to a non-volatile location (internal flash page, external EEPROM, UART) before resetting. This field-recoverable fault log has saved production debugging efforts that would otherwise require reproducing the fault in the lab.

## Summary

Debugging embedded systems requires a fundamentally different mindset from debugging desktop software. The core discipline is non-perturbative observation: using tools that let you see what the hardware is doing without changing what the hardware is doing. Hardware breakpoints halt the CPU without modifying code. Watchpoints catch memory corruption at the exact instruction and without software overhead. ITM trace logs firmware state in real time at negligible cost. These capabilities exist in silicon on every modern Cortex-M device and are available at no additional cost, yet many engineers spend weeks with printf() before discovering them.

The physical layer of debugging is equally important. Software can only see what software can see. A logic analyzer watching an I2C bus sees bus errors, address NACKs, clock stretching violations, and glitches that no amount of firmware logging would ever reveal. An oscilloscope measuring a power rail during a radio burst sees supply droops that corrupt ADC readings in ways that look like firmware bugs. Using the right instrument for the right layer of the system is not optional; it is how experienced engineers close bugs quickly.

The practical message is this: invest fifteen minutes at the start of every project in enabling and testing the debug infrastructure. Verify that SWD connects, that a breakpoint fires, that ITM outputs a test character. Configure DBGMCU freeze registers. Know your hardware breakpoint count. Place SWD test points on the PCB. These fifteen minutes will pay back tenfold on the first real bug.

The mental model to retain is this: your MCU contains a complete second processor dedicated to watching the first one. That second processor, the CoreSight debug subsystem, is connected to every bus, monitors every instruction fetch, and can stop or trace the application CPU at any moment without the application knowing. Your job as a debugger is to configure and interrogate that second processor correctly. Printf() is a letter you wrote to yourself. Hardware debug is a window into the live machine.

## Related Topics

Prerequisites: - MCU Boot Sequence (understanding reset vector, startup code, vector table layout) - CPU Execution Model (pipeline, privilege levels, exception model, stack frames) - ARM Cortex-M Architecture Overview (memory map, bus fabric, NVIC) - Basic C for Embedded Systems (pointers, volatile, memory-mapped registers)

Next Topics: - Fault Handling and Fault Analysis (decoding CFSR/HFSR, writing robust fault handlers, field logging) - Memory Corruption Debugging (stack overflow detection, MPU configuration, heap integrity) - RTOS Debugging (task-aware debugging, deadlock detection, stack usage analysis) - Performance Profiling on Cortex-M (DWT-based profiling, cache effects, flash latency) - Production Logging and Diagnostics (persistent fault logs, field debug interfaces, RTT in production)
