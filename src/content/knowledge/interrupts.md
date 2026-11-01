---
title: "Interrupts: How Hardware Gets the CPU's Attention"
brief: "From peripheral IRQ to NVIC to ISR and back: priorities, latency, the exception frame and the rules for writing safe ISRs."
order: 4
phase: 1
tags: ["NVIC", "ISR", "Priority", "Latency"]
---

Imagine you are building a safety system for an industrial press. A physical emergency stop button must halt the machine within 2 milliseconds of being pressed.

Interrupts exist because the real world is asynchronous. External events — a button press, a byte arriving over UART, a timer reaching its count, a voltage threshold being crossed — do not wait for your software to be ready.

## The Fundamental Problem

The naive approach to reacting to external events is polling: you periodically check whether something has happened. In your main loop, you call a function that reads a GPIO pin, or checks a UART status register, or inspects an ADC result register.

The main problem with polling is latency. The time between when an event occurs and when your code reacts to it is bounded by how often you poll.

## The Big Picture

At the highest level, an interrupt is a hardware-triggered diversion of CPU execution. The peripheral signals the CPU through a dedicated hardware line.

Between the peripheral and the CPU, there is a hardware block called the interrupt controller. On ARM Cortex-M processors this is the NVIC (Nested Vectored Interrupt Controller), which is part of the CPU core itself.

The animation below follows the CPU from main() into the ISR and back.

![Animated interrupt: main() pauses, the CPU runs the ISR, then main() carries on](/diagrams/interrupt_flow.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Interrupt Request (IRQ)** | A signal sent by a peripheral to the CPU indicating that the peripheral needs attention. |
| **Interrupt Service Routine (ISR)** | The function that executes when a specific interrupt fires. |
| **Vector Table** | A table in memory (usually at the start of flash, address 0x00000000 on Cortex-M) containing the addresses of all ISR functions. |
| **NVIC (Nested Vectored Interrupt Controller)** | The interrupt controller built into all ARM Cortex-M processors. |
| **Interrupt Priority** | A numerical value assigned to each interrupt that determines its urgency relative to other interrupts. |
| **Context Saving / Exception Entry** | When the CPU accepts an interrupt, it automatically saves a set of registers onto the current stack. |

## How It Works

### Step 1: The peripheral asserts its IRQ line

A peripheral generates an interrupt request when a specific condition is met: the UART receive data register becomes full, a timer counter matches its compare value, a GPIO pin transitions from low to high. Each peripheral has an internal status register with flag bits that record what happened, and a corresponding enable register that determines whether that condition is allowed to generate an interrupt.

### Step 2: The NVIC evaluates the request

The IRQ line from the peripheral reaches the NVIC. The NVIC checks whether the interrupt is globally enabled (via the ISER register), and what priority it has been assigned (via the IPR registers).

### Step 3: Exception entry and context push

When the CPU decides to take the interrupt, it completes the current instruction (most instructions), then automatically pushes eight registers onto the active stack: xPSR, PC, LR, R12, R3, R2, R1, R0. This happens in hardware with no software involvement.

### Step 4: Vector fetch and ISR entry

The CPU reads the vector table. The base address of the vector table is held in the VTOR (Vector Table Offset Register).

### Step 5: ISR executes

The ISR function runs. The first thing the ISR MUST do is clear the interrupt pending flag in the peripheral's status register.

### Step 6: Context restoration and resume

When the ISR executes its return instruction, the CPU detects the special EXC_RETURN value in LR. This triggers exception return: the CPU pops the eight saved registers back off the stack, restoring PC, xPSR, LR, and R0-R3 to their values before the interrupt.

## Under the Hood

The Cortex-M exception entry mechanism is engineered for both speed and C-language compatibility. The automatic push of 8 registers (the exception frame) corresponds exactly to the ARM Procedure Call Standard's caller-saved registers.

On Cortex-M3/M4/M7, the NVIC uses a priority grouping scheme that divides the priority byte into two fields: preemption priority and sub-priority. Preemption priority determines whether one interrupt can preempt another.

## Real-World Applications

**Automotive.** Modern automotive ECUs (Engine Control Units) rely on interrupts for crank and cam position sensing. The engine crank signal fires a GPIO interrupt on every tooth of the reluctor wheel.

**Industrial.** Industrial motion controllers use timer interrupts to run control loops at fixed intervals. A servo drive running a 20 kHz current control loop uses a PWM timer interrupt to sample ADC results, compute a new duty cycle, and update the PWM compare register — all within a 50 microsecond window.

## Common Mistakes

MISTAKE: Not clearing the interrupt flag in the ISR What goes wrong: The ISR returns, the flag is still set, the CPU immediately re-enters the ISR. The main loop never runs. The system appears to hang or behave erratically.

MISTAKE: Doing too much work inside an ISR What goes wrong: The ISR calls blocking functions, performs heavy computation, waits for another peripheral, or calls library functions not designed for ISR context. Other interrupts are delayed, timing requirements are missed. How to avoid: ISRs should do the minimum necessary: read data into a buffer, set a flag, post a semaphore to an RTOS task.

MISTAKE: Sharing data between ISR and main loop without protection What goes wrong: The ISR writes a multi-byte variable (say, a 32-bit counter on a 16-bit MCU, or a struct) while the main loop reads it partway through. The main loop reads a partially updated value — a data race. The bug appears intermittently and is very hard to reproduce.

## Debugging and Troubleshooting

**Symptom:** System hangs immediately or main loop stops running

**Possible Cause:** ISR is in an infinite loop because the interrupt flag was not cleared.

**Investigation Method:** Attach a debugger and halt execution.

**Resolution:** Add code to clear the interrupt flag before the ISR returns.

**Symptom:** Intermittent data corruption in a variable shared between ISR and main loop

**Possible Cause:** Data race on a multi-byte variable.

**Investigation Method:** Add a data integrity check — store a known pattern alongside the variable and verify it on every read.

**Resolution:** Wrap the access to the shared variable in the main loop with a critical section (disable/enable interrupts).

## Design Considerations and Best Practices

**Keep ISRs as short as possible.** This is the single most important rule. An ISR occupies the CPU exclusively (relative to lower-priority interrupts) for its entire execution.

**Always declare shared variables as volatile.** Without volatile, the compiler may cache the variable in a register and never re-read it from memory. The main loop could loop forever on a stale value even though the ISR updated it.

## Expert Notes

**The Cortex-M priority numbering is a common trap.** Priority 0 is the HIGHEST priority and priority 255 is the LOWEST. This is counterintuitive.

**The exception frame stores the PC of the next instruction to execute, not the one that was interrupted.** When you inspect the stacked PC during a HardFault or while debugging an ISR timing issue, you are seeing where execution will RESUME after the ISR, not where it was when the interrupt was taken. This matters when you are trying to correlate an interrupt to a specific point in your main loop code for timing analysis.

## Summary

Interrupts are the fundamental mechanism by which embedded software responds to the asynchronous, real-time nature of the physical world. Polling, the naive alternative, fails because it introduces unbounded and growing latency, wastes CPU cycles, and provides no way to prioritize urgent events over routine ones. The interrupt mechanism solves all three problems by having the hardware itself divert the CPU to handle an event the moment it occurs.

On ARM Cortex-M processors, the interrupt path runs from peripheral to NVIC to CPU exception entry. The hardware automatically saves the caller context (exception frame) on the stack, fetches the ISR address from the vector table, and executes the ISR as a normal C function. On return, the context is automatically restored.

## Related Topics

**Prerequisites**

- CPU Execution Model (register file, program counter, stack pointer, instruction fetch-decode-execute cycle)
- Clock System Fundamentals (clock sources, PLL, bus prescalers, peripheral clock gating)

**Next Topics**

- Event-Driven Systems (designing firmware architecture around interrupt-generated events)
- Concurrency and Synchronization (mutexes, semaphores, atomic operations, preventing data races)
- RTOS Fundamentals (tasks, scheduler, how interrupts integrate with an RTOS kernel)
