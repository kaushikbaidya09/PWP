---
title: "Concurrency and Synchronization: Keeping Shared Data Safe"
brief: "Race conditions between tasks and ISRs, and the tools that prevent them: critical sections, mutexes, semaphores and atomics."
order: 10
phase: 2
tags: ["Mutex", "Semaphore", "Race Condition", "Critical Section"]
---

Imagine you have a motor controller running on an STM32F4. A high-priority interrupt fires every millisecond to update a PID output value.

What happened is a RACE CONDITION: the interrupt fired exactly in the middle of a two-instruction read of a 32-bit variable on a platform that does not atomically access 32-bit values in all contexts. The main loop read the low 16 bits of the new value and the high 16 bits of the old value, assembling a number that was never valid.

## The Fundamental Problem

The naive approach to sharing data between contexts is to just share it: declare a global variable, read it and write it from wherever you need to. This works fine when only one context ever touches the variable at a time.

Consider a simple counter increment: counter++. In C this looks atomic.

## The Big Picture

![Animated race condition: two threads both read 5 and write 6, so one increment is lost](/diagrams/sync_layers.svg)

In an RTOS-based embedded system, multiple tasks and interrupt service routines (ISRs) share the CPU and, critically, share memory. The RTOS scheduler switches between tasks based on priority and blocking state.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Race Condition** | A defect where the outcome of a computation depends on the relative timing of two or more execution contexts. |
| **Critical Section** | A sequence of code that must execute without preemption — no other context may access the shared resource while this code is running. |
| **Mutex** | A mutual exclusion object: a binary lock with ownership semantics. |
| **Semaphore** | A signaling primitive with a counter. |
| **Deadlock** | A state where two or more tasks are each waiting for a resource held by the other, and none can proceed. |
| **Priority Inversion** | A scenario where a high-priority task is effectively blocked by a low-priority task because the low-priority task holds a mutex the high-priority task needs. |

## How It Works

### Step 1: Task requests a mutex (xSemaphoreTake)

The calling task issues a Take on the mutex handle. The RTOS checks the mutex state.

### Step 2: Mutex is already held — task blocks

If another task owns the mutex, the RTOS moves the requesting task from the Ready list to the Blocked list, recording which mutex it is waiting for. The scheduler then runs the next highest-priority ready task.

### Step 3: Priority inheritance kicks in

If the task waiting for the mutex has higher priority than the task holding it, a correct RTOS implementation (FreeRTOS, ThreadX) immediately elevates the holding task's priority to match the waiter. This prevents a medium-priority task from preempting the lock holder and inadvertently blocking the high-priority waiter.

### Step 4: Lock holder completes critical section and gives mutex

The holding task finishes its work on the shared resource and calls Give (xSemaphoreGive). The RTOS clears the owner field, reverts any inherited priority, and checks the blocked-waiting list.

### Step 5: ISR-to-task signaling via binary semaphore

An ISR cannot take a mutex (doing so would block the ISR, which is not allowed). For ISR-to-task signaling, a binary semaphore is the correct primitive.

### Step 6: Bare-metal critical section: interrupt disable

Without an RTOS, the standard approach is to disable interrupts around a critical section using __disable_irq() on ARM Cortex-M (sets PRIMASK) or cli() on AVR. After the critical section, restore the prior interrupt state — do not unconditionally re-enable interrupts, because the caller may itself have been in an interrupt-disabled context.

### Step 7: ARM exclusive access for lightweight atomics

ARM Cortex-M3 and above support LDREX/STREX for software atomic operations without disabling interrupts. LDREX loads a value and sets the exclusive monitor.

## Under the Hood

On ARM Cortex-M, the PRIMASK register is a single-bit register that, when set, prevents all exceptions with configurable priority from preempting the current execution. Setting PRIMASK is a single instruction (CPSID I) and clearing it is equally cheap (CPSIE I).

A mutex in FreeRTOS is implemented as a queue of length 1 with additional owner-tracking fields. The initial "Give" at creation time puts a token in the queue.

## Real-World Applications

AUTOMOTIVE: In a body control module (BCM) on an STM32, a CAN receive ISR populates a ring buffer with incoming frames. A mid-priority task reads frames and dispatches them to handlers.

MEDICAL: An infusion pump runs a high-priority task updating motor step counts and a lower-priority task computing the next dosage schedule. Both tasks access a shared dose-rate variable.

## Common Mistakes

**Mistake 1** — USING A MUTEX IN AN ISR What goes wrong: The ISR calls xSemaphoreTake. If the mutex is held, the ISR blocks. ISRs cannot block — the scheduler is not running in an ISR context.

**Mistake 2** — FORGETTING VOLATILE ON ISR-SHARED VARIABLES What goes wrong: The compiler optimizes a tight polling loop that reads a flag set by an ISR: it reads the flag once, caches it in a register, and never re-reads memory. The ISR sets the flag; the main loop never sees it. The system waits forever.

**Mistake 3** — TAKING TWO MUTEXES IN DIFFERENT ORDER What goes wrong: Task A takes mutex_uart then tries to take mutex_dma. Task B takes mutex_dma then tries to take mutex_uart. Each task holds one mutex and waits for the other.

## Debugging and Troubleshooting

**Symptom:** A variable occasionally contains a garbage or impossible value (e.g., velocity reads as 65,535 rpm, a pointer is non-NULL but invalid, a counter skips values).

**Possible Cause:** Race condition on a multi-byte or multi-step variable shared between an ISR and a task, or between two tasks.

**Investigation Method:** In the debugger, set a data watchpoint on the suspect variable.

**Resolution:** Protect all access sites with a consistent synchronization method: interrupt-disable for ISR/task, mutex for task/task.

**Symptom:** The system appears running (LEDs blink, watchdog fed) but one or more tasks stop producing expected output after some run time.

**Possible Cause:** Deadlock.

**Investigation Method:** Halt the system and inspect the RTOS task list.

**Resolution:** Establish and enforce a global lock ordering.

## Design Considerations and Best Practices

1. **Minimize Shared State by Design.** The best way to avoid synchronization bugs is to need less synchronization. Architect tasks so each owns its data exclusively and communicates via message queues rather than shared memory. This is not always possible in embedded systems with constrained memory, but it should be the default design goal. Every piece of shared state is a liability that must be actively managed for the lifetime of the product.

2. **Match the Primitive to the Pattern.** Use a mutex for mutual exclusion between tasks. Use a binary semaphore for signaling (ISR posts, task pends).

## Expert Notes

**Note 1** — WHAT TEXTBOOKS OMIT: Priority inheritance does NOT fully solve priority inversion — it prevents unbounded inversion, but the high-priority task still waits for the low-priority task to finish its critical section. The correct architectural response is to minimize the time any task holds a mutex.

**Note 2** — WHAT CAUSES PRODUCTION FAILURES: The Mars Pathfinder priority inversion bug of 1997 is not just a historical curiosity — variants of it appear in production firmware every year. The pattern is always the same: a low-priority housekeeping task holds a mutex, a high-priority real-time task needs the same mutex, and a medium-priority task (often something innocuous like periodic telemetry) preempts the housekeeping task and holds the CPU just long enough for the watchdog to fire.

## Summary

Concurrency bugs are defined by their non-determinism: they do not appear on demand, they do not reproduce reliably in a debugger, and they often survive months of testing before surfacing in production at the worst possible moment. The root cause is always the same — multiple execution contexts accessing shared state without adequate coordination. On embedded systems, this is not an edge case.

The tools exist to handle this correctly. Interrupt-disable critical sections for brief, bare-metal ISR/task data exchanges. Mutexes with priority inheritance for task-to-task mutual exclusion where the wait time is bounded.

## Related Topics

**Prerequisites**

- RTOS Fundamentals
- Interrupts
- CPU Execution Model
- C Pitfalls in Embedded

**Next Topics**

- Fault Handling and Crash Analysis
- Memory Corruption and System Stability

---

The HTML file uses a phosphor-green / logic-amber palette on a deep blue-black ground (#0D1117), monospace section headers, a sticky scroll-spy TOC sidebar with glowing dot indicators, an animated dual-trace oscilloscope canvas in the hero, and structured card layouts for mistakes and debug entries. It is fully self-contained with no external dependencies.
