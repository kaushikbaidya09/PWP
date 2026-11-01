---
title: "Bare-Metal Architecture: Structuring Firmware Without an RTOS"
brief: "Structuring firmware without an RTOS: superloops, ISR-to-main handoff, cooperative scheduling and timing budgets."
order: 8
phase: 2
tags: ["HAL", "Architecture", "Bare-metal"]
---

You are three weeks into a new embedded project. The hardware is a small STM32F030 microcontroller driving an LED matrix, reading four buttons, and sending periodic UART status messages to a host.

This scenario plays out constantly in embedded development. An RTOS is a powerful tool, but it is not always the right tool.

## The Fundamental Problem

A microcontroller can only execute one instruction at a time. But real systems need to do many things: read sensors, update displays, respond to button presses, transmit data, and handle faults.

The naive approach is to write everything in sequence inside main(). Read the sensor, then check the button, then send the UART byte, then update the display, repeat forever.

## The Big Picture

A bare-metal system has two execution contexts: the FOREGROUND (interrupt service routines) and the BACKGROUND (the main loop). The foreground is event-driven and runs at any time, preempting the background.

The background loop is called the SUPERLOOP. It is an infinite loop inside main() that calls every module in the system in a fixed sequence.

The diagram below shows the overall structure:

![Foreground/Background Bare-Metal Architecture](/diagrams/foreground_background.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Superloop** | The infinite while(1) loop that forms the backbone of bare-metal firmware. |
| **Foreground Context** | The execution context of interrupt service routines. |
| **Background Context** | The main execution context, running in the superloop. |
| **Event Flag** | A variable (typically a volatile uint8_t or uint32_t bit field) that an ISR sets to signal that something has happened. |
| **Cooperative Scheduling** | A scheduling model where each piece of code voluntarily yields control after a bounded amount of work. |
| **Latency** | The time between an event occurring and the firmware responding to it. |

## How It Works

### Step 1: System initialization before the loop begins

When reset is released, the CPU begins executing from the reset vector. On ARM Cortex-M, the startup code (written in assembly or provided by the vendor) initializes the stack pointer, copies initialized data from flash to RAM, zeros the BSS segment, and calls main().

### Step 2: The superloop begins and calls the first module

Execution falls into the while(1) loop. Each call to a module is a function call to a non-blocking run function, conventionally named module_run() or module_process().

### Step 3: An interrupt fires during the loop

While the background is executing (anywhere in the loop, at any instruction), a hardware event occurs — a UART byte arrives, a GPIO edge triggers, a timer expires. The CPU hardware automatically saves the program counter, processor status register, and scratch registers onto the current stack (the process stack on Cortex-M with an RTOS, or the main stack in bare-metal).

### Step 4: The background consumes the event flag

On the next pass through the loop, the module that owns that event reaches its flag check. It sees the flag set, clears it atomically, and processes the event.

### Step 5: Timeouts and non-blocking delays via the tick

A SysTick or general-purpose timer ISR fires every 1 ms and increments a global volatile uint32_t tick counter. Modules that need to wait — for a debounce period, a sensor conversion time, a retransmit timeout — record the tick count at the start of the wait and compare on each pass.

### Step 6: The loop repeats and cycle time is maintained

After all modules have been called once, the loop wraps around and starts again. The cycle time for one complete pass is the sum of the execution times of all module calls for that pass.

## Under the Hood

On ARM Cortex-M, the transition from background to ISR context is handled entirely in hardware. When an interrupt fires, the CPU executes an automatic push of eight registers (PC, PSR, R0-R3, R12, LR) onto the stack — this is called exception entry stacking and takes a fixed number of cycles (12 cycles on M0, fewer on M4 with late-arriving optimization).

The volatile keyword is essential to correctness in bare-metal systems. When a variable is shared between an ISR and the background, the compiler must not optimize away reads or writes to it.

## Real-World Applications

### Automotive

Body control modules (BCMs) in vehicles often run bare-metal firmware on mid-range MCUs such as the NXP S32K or Renesas RH850. These modules control power windows, door locks, lighting, and mirror adjusters.

### Industrial

Programmable logic controllers (PLCs) and industrial I/O modules frequently run bare-metal on processors such as the STM32F4 or TI Tiva C. A fixed scan cycle — analogous to the superloop — is central to IEC 61131-3 programming models.

## Common Mistakes

**Blocking Inside the Superloop** — A module calls HAL_Delay() or spins waiting for a hardware flag inside its run function. This stalls the entire loop for the duration of the delay. Every other module misses its scheduled processing time.

**Non-Volatile Event Flags** — The event flag variable is declared as uint8_t flag instead of volatile uint8_t flag. The compiler optimizes the background loop into a read that never re-fetches the variable from memory, so the flag set by the ISR is never seen. The symptom is a system that appears to stop responding to events after the first few seconds of operation.

**Missing Critical Sections on Multi-Byte Reads** — A 32-bit timestamp is read by the background while the SysTick ISR is in the middle of incrementing it. The background reads a value that is one increment in progress, getting a number that is neither the old value nor the new value. Protect all multi-byte shared variable reads with a brief interrupt disable, or use a read-twice-compare pattern for read-only tick timestamps.

## Debugging and Troubleshooting

**Symptom:** System stops responding to a specific event after running normally for some time.

**Possible Cause:** The event flag is not volatile, or the flag is being set and cleared in the same ISR (e.g., the ISR reads the data and clears the hardware flag, but inadvertently also clears the software event flag before the background processes it).

**Investigation Method:** Set a GPIO high at the start of the ISR and low when the ISR returns.

**Resolution:** Add volatile to the flag declaration.

---

**Symptom:** System hangs immediately on startup with no output.

**Possible Cause:** An interrupt fires during initialization before its handler is ready, landing in the default HardFault or infinite-loop default handler.

**Investigation Method:** Connect a debugger (J-Link or ST-Link).

**Resolution:** Move peripheral interrupt enable to the END of the initialization sequence for that peripheral, after all state machines and buffers are initialized.

---

## Design Considerations and Best Practices

**Bound every module's worst-case execution time.**

### Initialize All Modules Before Entering the Superloop

Set every module's internal state, clear every flag, configure every peripheral, and enable every interrupt only after all initialization is complete. An interrupt that fires before its handler is ready is one of the most common causes of startup crashes.

### Keep ISRs as short as possible

An ISR that runs for 100 microseconds is blocking every lower-priority interrupt for that entire duration. The recommended pattern is: read the hardware status register, push data to a ring buffer or set a flag, clear the hardware interrupt flag, and return.

## Expert Notes

**The loop cycle time is your contract with the system.**

Junior engineers often treat the superloop as "fast enough" without measuring it. Senior engineers treat the worst-case loop cycle time as a hard specification, like a timing requirement.

## Summary

Bare-metal architecture is a deliberate choice for systems where memory is constrained, determinism is required, or complexity does not justify an RTOS. The superloop provides a simple and reliable execution framework: a fixed-sequence, continuously-running loop that calls non-blocking module functions. The entire system's responsiveness depends on keeping every module's per-call execution time short and bounded.

Interrupts are the foreground layer that makes bare-metal systems responsive to asynchronous events. The ISR-to-background communication pattern — ISR sets a flag or pushes to a ring buffer, background consumes it on the next pass — is the fundamental IPC mechanism of bare-metal firmware. Getting this pattern right requires volatile on shared variables, critical sections on multi-byte data, and ring buffers or counters when events can arrive faster than the loop can process them.

## Related Topics

**Prerequisites**

- MCU Boot Sequence (startup code, vector table, memory initialization)
- Interrupts (NVIC configuration, ISR entry/exit, interrupt priorities on ARM Cortex-M, volatile and shared data)

**Next Topics**

- RTOS Fundamentals (tasks, scheduler, context switching, when bare-metal is no longer sufficient)
- Event-Driven Systems (event queues, publish-subscribe patterns, extending bare-metal cooperative scheduling toward more structured event handling)
