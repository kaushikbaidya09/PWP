---
title: "RTOS Fundamentals: Running Several Tasks on One CPU"
brief: "How a preemptive scheduler runs tasks predictably: priorities, ticks, blocking, context switches and choosing task periods."
order: 9
phase: 2
tags: ["RTOS", "FreeRTOS", "Scheduler", "Tasks"]
---

Imagine you are debugging a motor controller that also needs to update a display, respond to button presses, and send telemetry over UART. You write a big loop, carefully ordering each operation, tuning delays, and praying that nothing takes too long.

This is the problem that a Real-Time Operating System, or RTOS, exists to solve. The core promise of an RTOS is not "fast" in the sense of raw throughput.

## The Fundamental Problem

A bare-metal superloop works well when every operation in the loop completes in a predictable, short time. The loop polls all inputs, updates all state, drives all outputs, and repeats.

Interrupts are the first tool engineers reach for to solve this. You move the time-sensitive work into an interrupt service routine and let the rest run in the background loop.

## The Big Picture

An RTOS sits between your application code and the hardware. The hardware includes the CPU, peripherals, and memory.

At the highest level, the system operates in two modes. When no task is ready to run, the idle task runs, which typically puts the CPU into a low-power sleep state.

The animation below shows two tasks sharing one CPU over time:

![Animated timeline: a high-priority task preempts a low-priority task whenever it becomes ready](/diagrams/rtos_arch.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Task** | An independent unit of execution with its own stack, priority, and state. |
| **Scheduler** | The kernel component that decides which task runs on the CPU at any moment. |
| **Context Switch** | The act of saving the CPU state of the currently running task and restoring the CPU state of the next task to run. |
| **Task State** | Each task is in exactly one state at any moment: RUNNING (currently on the CPU), READY (eligible to run but waiting for the CPU), BLOCKED (waiting for an event such as a queue, semaphore, or timeout), or SUSPENDED (explicitly removed from scheduling). |
| **Priority** | A numeric value assigned to a task at creation that determines its scheduling order. |
| **Tick** | The periodic interrupt that drives the RTOS time base. |

## How It Works

### Step 1: Kernel initialization

The application calls an RTOS initialization function (vTaskStartScheduler in FreeRTOS). Before this call, the application has created one or more tasks by calling the task-creation API.

### Step 2: Scheduler start and first dispatch

vTaskStartScheduler configures the SysTick timer to generate interrupts at the configured tick rate, sets up the PendSV exception for context switching, and then dispatches the highest-priority READY task. On Cortex-M, this involves manipulating the Process Stack Pointer (PSP) to point to the first task's stack and executing an exception return to enter the task in Thread mode (unprivileged execution).

### Step 3: Task execution and blocking

The running task executes its code. When it needs to wait for something (a delay, a queue message, a semaphore), it calls a blocking RTOS API.

### Step 4: Tick interrupt and timeout management

Every tick period, SysTick fires. The tick handler increments the tick count, scans the list of blocked tasks, and moves any task whose timeout has expired back to the READY state.

### Step 5: Context switch execution (PendSV)

The PendSV handler is the core of the context switch. On Cortex-M, hardware automatically saves R0-R3, R12, LR, PC, and xPSR to the current task's stack when entering any exception (this is the hardware exception frame).

### Step 6: Unblocking from an ISR

A hardware ISR (say, a UART receive complete interrupt) needs to wake a task that is waiting for incoming data. The ISR calls a FromISR variant of the RTOS API (xQueueSendFromISR or xSemaphoreGiveFromISR in FreeRTOS).

### Step 7: Round-robin among Equal-Priority tasks

When two or more tasks share the same priority and are both READY, the scheduler gives each a full time-slice (one tick period) before switching. This is round-robin scheduling.

## Under the Hood

On ARM Cortex-M, the RTOS exploits specific hardware features that are designed for exactly this purpose. The processor has two stack pointers: the Main Stack Pointer (MSP) and the Process Stack Pointer (PSP).

The PendSV exception is deliberately configured at the LOWEST interrupt priority on Cortex-M. This is critical.

## Real-World Applications

**Automotive.** Engine control units decompose into tasks at multiple priority levels: crank-angle-synchronized fuel injection calculation runs at the highest priority, driven by crankshaft position interrupts. Transmission gear-shift logic runs at a medium priority with a defined periodic rate.

**Medical.** Infusion pumps use RTOS architectures where the motor control task (high priority, strict periodicity) is separated from the alarm monitoring task (high priority, event-driven) and the user interface task (low priority, can be sluggish). Critically, medical device RTOSes often require formal certification: FreeRTOS has a SafeRTOS derivative certified to IEC 62304, and INTEGRITY RTOS is certified for DO-178C in avionics.

## Common Mistakes

**Assigning All Tasks the Same Priority** — When every task has equal priority, round-robin scheduling applies universally. Time-sensitive operations are no longer protected from being delayed by slower tasks. Real-time behavior disappears.

**Blocking Inside an Isr** — Calling vTaskDelay, xQueueReceive, or any blocking RTOS API from an ISR will corrupt the kernel state or cause a hard fault. ISRs must use the FromISR variants of all RTOS APIs. The FromISR functions never block.

**Stack Too Small** — The default stack size suggested in tutorials is usually too small for any task that calls printf, uses floating-point, or calls deeply nested functions. Enable FreeRTOS stack overflow detection (configCHECK_FOR_STACK_OVERFLOW set to 2), and instrument uxTaskGetStackHighWaterMark periodically during development. Set the final stack size to observed peak plus 50% margin.

## Debugging and Troubleshooting

**Symptom:** System hard-faults randomly, usually under load.

**Possible Cause:** Stack overflow on one or more tasks.

**Investigation Method:** Enable configCHECK_FOR_STACK_OVERFLOW=2 in FreeRTOSConfig.h.

**Resolution:** Increase the stack allocation for the overflowing task.

**Symptom:** A high-priority task misses its deadline intermittently, with no obvious blocking operation in its code.

**Possible Cause:** A lower-priority task holds a shared mutex, and priority inheritance is not functioning (wrong mutex type used), or a critical section in an ISR is holding off the scheduler for too long.

**Investigation Method:** Toggle a GPIO at entry and exit of the high-priority task and measure with a logic analyzer.

**Resolution:** Replace standard mutexes with priority-inheritance mutexes.

## Design Considerations and Best Practices

**Assign priorities based on deadline, not importance.** Rate Monotonic Scheduling (RMS) provides a formal basis: tasks with shorter periods get higher priorities. "Importance" is a vague concept; deadline is measurable.

**Use Static Allocation Wherever Possible** — Dynamic heap allocation in an RTOS introduces fragmentation risk and non-deterministic allocation time. FreeRTOS supports fully static allocation (configSUPPORT_STATIC_ALLOCATION=1).

## Expert Notes

**The Rtos Does Not Make Timing Bugs Disappear** — It restructures them. In a superloop, timing bugs appear as loops that run too slowly.

**Floating Point Is Not Free** — On Cortex-M4/M7 with FPU, the hardware saves and restores floating-point registers on context switch only if the FPU was used during the task's last execution (lazy FPU stacking). This adds up to 34 extra words to the stack frame.

## Summary

An RTOS solves the fundamental problem of running multiple concurrent activities with predictable timing on a single CPU. It does this by decomposing the application into tasks, each with a priority and a stack, and using a preemptive priority-based scheduler to ensure that the highest-priority ready task always runs. The context switch, executed in hardware-assisted software on Cortex-M via PendSV, saves and restores the full CPU state so that each task resumes exactly where it left off.

The key behaviors to internalize are: priority determines preemption, blocking APIs yield the CPU, ISRs use FromISR variants and trigger immediate reschedule via portYIELD_FROM_ISR, and the RTOS tick provides timing granularity for delays and timeouts. Every task needs a correctly sized stack, a focused responsibility, and priorities assigned by deadline rather than perceived importance.

## Related Topics

**Prerequisites**

- Bare-Metal Architecture: understanding the superloop, startup code, linker scripts, and MCU memory map
- Interrupts: NVIC configuration, ISR writing, interrupt priorities on Cortex-M, hardware exception model
- CPU Execution Model: pipeline, registers, stack pointer operation, exception entry and exit on ARM Cortex-M

**Next Topics**

- Concurrency and Synchronization: mutexes, semaphores, event groups, message queues, deadlock analysis, priority inversion in depth
- Firmware Architecture Patterns: layered architectures, active objects, publish-subscribe with RTOS, component isolation, testability in multitasking firmware
