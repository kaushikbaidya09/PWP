---
id: concurrency-and-synchronization
tags: ['Mutex', 'Semaphore', 'Race Condition', 'Critical Section']
---

# Concurrency and Synchronization in Embedded Firmware

Imagine you have a motor controller running on an STM32F4. A high-priority interrupt fires every millisecond to update a PID output value. Your main-loop task reads that same value to log it over UART. In testing, everything works perfectly for hours. On the production floor, a unit fails intermittently -- the motor surges, the log shows a velocity reading of 65,535 RPM for one sample, then recovers. No assert fires. No watchdog trips. The sensor was fine. What happened?

What happened is a RACE CONDITION: the interrupt fired exactly in the middle of a two-instruction read of a 32-bit variable on a platform that does not atomically access 32-bit values in all contexts. The main loop read the low 16 bits of the new value and the high 16 bits of the old value, assembling a number that was never valid. This class of failure is the most dangerous in embedded firmware because it is timing-dependent, rarely reproducible in a debugger, and capable of corrupting safety-critical state silently.

Concurrency and synchronization is the discipline of writing firmware where multiple execution contexts -- tasks, interrupts, DMA callbacks, timer handlers -- share resources without corrupting each other. The challenge is not theoretical. Every non-trivial embedded system has at least two execution contexts: an interrupt handler and the main loop. The moment you have two contexts and one shared variable, you have a potential race condition. The moment you have two shared resources and two tasks, you have potential deadlock.

This topic matters because the bugs it produces are the hardest to find and the most expensive to fix in production. Understanding synchronization primitives, when to use them, and crucially when NOT to use them, is what separates reliable production firmware from firmware that "works on my desk."

By the end of this article, you will understand what makes concurrent access unsafe at the hardware level, how mutexes and semaphores work mechanically, how deadlocks and priority inversion arise and how to prevent them, and how to apply the right synchronization tool to real embedded scenarios on ARM Cortex-M and AVR targets.

## The Fundamental Problem

The naive approach to sharing data between contexts is to just share it: declare a global variable, read it and write it from wherever you need to. This works fine when only one context ever touches the variable at a time. It fails the moment two contexts can interleave. On a single-core MCU, interleaving happens at interrupt boundaries. On a multicore MCU (e.g., STM32H7 with Cortex-M7 and Cortex-M4), it can happen simultaneously. Either way, the problem is the same: a sequence of operations that APPEARS to be a single action is actually multiple hardware steps, and another context can run between any two of them.

Consider a simple counter increment: counter++. In C this looks atomic. In assembly on an ARM Cortex-M it compiles to three operations: LOAD (read counter from RAM into a register), ADD (add 1), STORE (write the register back to RAM). If an interrupt fires after the LOAD and modifies counter before the STORE, the main loop's STORE overwrites the interrupt's update. The increment is lost. This is a classic lost update, and it happens on AVR, ARM, and every architecture where read-modify-write is not a single atomic bus transaction.

The problem compounds with data structures. A linked list, a ring buffer, a packet queue -- these require multiple consistent writes to stay valid. If a reader interleaves with a writer partway through, it sees a structure in a half-updated state: a pointer pointing to freed memory, a buffer with its head and tail indices inconsistent, a message with its length field not yet matching its data. The corruption is not always obvious. The system may continue running for thousands of iterations before the corrupted state causes a visible failure, by which point the original cause is long gone.

The obvious fix -- "just be careful about when you write to shared variables" -- does not scale. As firmware grows, the mental model of which task touches which variable when becomes impossible to maintain. You need formal mechanisms: synchronization primitives that enforce mutual exclusion at the hardware level, not just by convention.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/sync_layers.svg" alt="Concurrency and Synchronization Layers" loading="lazy">
</div>

In an RTOS-based embedded system, multiple tasks and interrupt service routines (ISRs) share the CPU and, critically, share memory. The RTOS scheduler switches between tasks based on priority and blocking state. Interrupts preempt everything at the hardware level. Synchronization sits between these execution contexts and the shared resources they need -- it is the traffic control layer that prevents collisions.

At the highest level, every synchronization decision answers two questions: who can run at the same time, and who must wait for whom? Mutexes enforce mutual exclusion over a critical section. Semaphores signal events or count available resources. Disabling interrupts removes preemption entirely for a brief window. Each tool has a cost and a correct context of use. Choosing the wrong one produces either broken behavior (no protection) or livelock, deadlock, and priority inversion (wrong protection).

### Execution Contexts Shared Resources

RACE CONDITION PATH (no sync): Task A LOAD --> [ISR fires] --> ISR STORE --> Task A STORE ^ OVERWRITES ISR UPDATE

PROTECTED PATH (mutex): Task A TAKE_MUTEX --> LOAD --> STORE --> GIVE_MUTEX Task B waits here

## Key Concepts and Terminology

**Race Condition** — A defect where the outcome of a computation depends on the relative timing of two or more execution contexts. The "race" is between the contexts to read or write shared state. Race conditions are non-deterministic: they may never appear during development and only surface under specific load, temperature, or timing conditions in the field.

**Critical Section** — A sequence of code that must execute without preemption -- no other context may access the shared resource while this code is running. On bare-metal systems, a critical section is typically protected by disabling interrupts for its duration. In an RTOS, it may be protected by a mutex or by temporarily raising the task priority.

**Mutex** — A mutual exclusion object: a binary lock with ownership semantics. Only the task that took the mutex can give it back. This ownership property is what distinguishes a mutex from a binary semaphore and is what enables priority inheritance. If a lower-priority task holds a mutex, the RTOS can temporarily elevate its priority to prevent priority inversion.

**Semaphore** — A signaling primitive with a counter. A binary semaphore (count 0 or 1) can signal an event between contexts: an ISR posts it, a task pends on it. A counting semaphore tracks available resources (e.g., three DMA channels available). Unlike a mutex, a semaphore has no owner -- any context can post it, which makes it appropriate for ISR-to-task signaling but dangerous for mutual exclusion.

**Deadlock** — A state where two or more tasks are each waiting for a resource held by the other, and none can proceed. The system does not crash -- it silently stops making progress. Deadlock requires four conditions to hold simultaneously: mutual exclusion, hold-and-wait, no preemption of held locks, and circular waiting. Breaking any one of those conditions prevents deadlock.

**Priority Inversion** — A scenario where a high-priority task is effectively blocked by a low-priority task because the low-priority task holds a mutex the high-priority task needs. If a medium-priority task then preempts the low-priority task, the high-priority task is indirectly blocked by a task of lower priority -- an inversion of the intended scheduling order. The Mars Pathfinder mission experienced this in 1997.

**Atomic Operation** — An operation that completes as a single, indivisible step from the perspective of all other execution contexts. On ARM Cortex-M, 32-bit aligned reads and writes to RAM are NOT guaranteed atomic in all contexts. ARM provides LDREX/STREX instructions for load-linked/store-conditional sequences that implement software atomicity without disabling interrupts.

**Priority Inheritance** — A mechanism in RTOS mutexes that temporarily elevates the priority of a mutex-holding task to match the highest-priority task waiting for the same mutex. This prevents the medium-priority preemption scenario that causes classic priority inversion. FreeRTOS mutexes support priority inheritance; binary semaphores do not. This distinction matters greatly in practice.

**Spinlock** — A lock where the waiting context loops continuously checking the lock state rather than yielding to the scheduler. Useful only when the wait time is shorter than the context-switch overhead, and only on multicore systems. On a single-core MCU with an RTOS, spinning wastes CPU cycles that the lock holder needs to finish -- a spinlock in this context can cause livelock or watchdog expiry.

## How It Works

### Step 1: Task Requests a Mutex (xsemaphoretake) the Calling Task Issues a Take on the Mutex Handle. the Rtos Checks the Mutex State. If It Is Free, the Rtos Marks the Mutex As Owned by This Task, Records the Owner's Task Handle, and Returns Immediately. the Task Continues Executing and Enters the Protected Critical Section. Hardware Involved: None Yet -- This Is a Ram State Check.

### Step 2: Mutex Is Already Held -- Task Blocks If Another Task Owns the Mutex, the Rtos Moves the Requesting Task From the Ready List to the Blocked List, Recording Which Mutex It Is Waiting For. the Scheduler Then Runs the Next Highest-Priority Ready Task. the Blocked Task Consumes Zero Cpu. This Is What Makes Rtos Mutexes Superior to Spinlocks on Single-Core Mcus: the Cpu Is Freed for Useful Work While Waiting.

### Step 3: Priority Inheritance Kicks in If the Task Waiting for the Mutex Has Higher Priority Than the Task Holding It, a Correct Rtos Implementation (freertos, Threadx) Immediately Elevates the Holding Task's Priority to Match the Waiter. This Prevents a Medium-Priority Task From Preempting the Lock Holder and Inadvertently Blocking the High-Priority Waiter. the Elevated Priority Is Temporary -- It Reverts When the Mutex Is Released.

### Step 4: Lock Holder Completes Critical Section and Gives Mutex the Holding Task Finishes Its Work on the Shared Resource and Calls Give (xsemaphoregive). the Rtos Clears the Owner Field, Reverts Any Inherited Priority, and Checks the Blocked-Waiting List. If One or More Tasks Are Waiting, the Highest-Priority Waiter Is Moved to the Ready List. If It Has Higher Priority Than the Current Task, a Context Switch Occurs Immediately.

### Step 5: Isr-to-Task Signaling via Binary Semaphore an Isr Cannot Take a Mutex (doing So Would Block the Isr, Which Is Not Allowed). for Isr-to-Task Signaling, a Binary Semaphore Is the Correct Primitive. the Isr Calls the Fromisr Variant (xsemaphoregivefromisr), Which Posts the Semaphore and Sets a Flag If a Higher-Priority Task Was Unblocked. at the End of the Isr, the Port-Level Yield Macro Checks This Flag and Triggers a Context Switch If Needed, Ensuring the Unblocked Task Runs Immediately After the Isr Returns.

### Step 6: Bare-Metal Critical Section: Interrupt Disable Without an Rtos, the Standard Approach Is to Disable Interrupts Around a Critical Section Using __disable_irq() on Arm Cortex-M (sets Primask) or Cli() on Avr. After the Critical Section, Restore the Prior Interrupt State -- Do Not Unconditionally Re-Enable Interrupts, Because the Caller May Itself Have Been in an Interrupt-Disabled Context. Pattern: Save Primask, Disable, Modify Shared Data, Restore Primask.

### Step 7: Arm Exclusive Access for Lightweight Atomics Arm Cortex-M3 and Above Support Ldrex/strex for Software Atomic Operations Without Disabling Interrupts. Ldrex Loads a Value and Sets the Exclusive Monitor. Strex Attempts to Store; It Returns 0 on Success or 1 If the Monitor Was Cleared (by Another Access Between the Ldrex and Strex). a Retry Loop Around This Pair Implements an Atomic Read-Modify-Write. the Cmsis __ldrexw/__strexw Intrinsics Expose This Directly in C. Cortex-M0 Does Not Have Ldrex/strex -- Interrupt Disable Is the Only Option There.

## Under the Hood

On ARM Cortex-M, the PRIMASK register is a single-bit register that, when set, prevents all exceptions with configurable priority from preempting the current execution. Setting PRIMASK is a single instruction (CPSID I) and clearing it is equally cheap (CPSIE I). This makes interrupt-based critical sections extremely low overhead. The BASEPRI register offers more surgical control: setting BASEPRI to a value N masks all exceptions with priority N or lower, allowing high-priority interrupts (like a hardware fault handler or NMI) to still preempt. FreeRTOS uses BASEPRI rather than PRIMASK for its critical sections precisely so that the highest-priority hardware interrupts remain responsive.

A mutex in FreeRTOS is implemented as a queue of length 1 with additional owner-tracking fields. The initial "Give" at creation time puts a token in the queue. A Take removes the token (blocking if the queue is empty). A Give returns the token. The queue implementation under the hood uses brief critical sections (BASEPRI manipulation) to protect its own internal state -- this is a correct recursive structure because the internal critical section is non-blocking and very brief. The owner task handle stored in the mutex control block is what enables priority inheritance: when a higher-priority task blocks on a Take, the RTOS walks the inheritance chain and elevates the owner.

The compiler is your adversary in concurrent code. Modern optimizers can reorder memory accesses, cache values in registers across what you believe to be a "re-read" of a variable, and eliminate stores they consider "dead." The volatile keyword in C tells the compiler that a variable may be modified outside the normal program flow -- it forces every read to go to memory and every write to be committed to memory. In embedded firmware, any variable shared between an ISR and the main context MUST be declared volatile. Note however that volatile does NOT provide atomicity -- it only prevents compiler reordering. Hardware preemption can still corrupt a multi-step access to a volatile variable.

Memory barriers are the other half of the story. The ARM architecture allows out-of-order memory operations for performance. A Data Memory Barrier (DMB instruction) ensures all memory accesses before the barrier are visible to all observers before any accesses after the barrier proceed. A Data Synchronization Barrier (DSB) is stronger: it waits for all pending memory transactions to complete. In practice, RTOS primitives already include the necessary barriers. Where you call raw LDREX/STREX loops or write your own lock-free structures, you must insert DMB explicitly, or you will see cache-coherency bugs on Cortex-M7 (which has data caching) and multicore systems.

Stack corruption from ISRs is a related but often overlooked concern. On Cortex-M, when an interrupt fires, the CPU automatically pushes eight registers onto the stack of the interrupted context (the exception frame: PC, PSR, R0-R3, R12, LR). If the ISR's stack usage plus this eight-register frame exceeds the available stack for the interrupted context, you get a stack overflow -- not an ISR-specific overflow, but an overflow of the main task or thread stack. This manifests as corruption of local variables in the interrupted function, which looks exactly like a race condition. Always account for the maximum interrupt nesting depth when sizing stacks, and enable RTOS stack overflow checking during development.

## Real-World Applications

AUTOMOTIVE: In a body control module (BCM) on an STM32, a CAN receive ISR populates a ring buffer with incoming frames. A mid-priority task reads frames and dispatches them to handlers. A low-priority logging task reads the same buffer for telemetry. The ring buffer head pointer is written by the ISR and read by both tasks -- it must be protected. The correct pattern here uses a lock-free single-producer single-consumer ring buffer (valid when exactly one writer and one reader exist) with memory barriers, avoiding the overhead of a mutex in an ISR context entirely.

MEDICAL: An infusion pump runs a high-priority task updating motor step counts and a lower-priority task computing the next dosage schedule. Both tasks access a shared dose-rate variable. A mutex with priority inheritance is mandatory here -- a missed update due to priority inversion could result in the wrong flow rate persisting for a scheduling cycle, which in a safety-critical device is a reportable event. IEC 62304 requires that concurrency hazards be identified and mitigated in the software architecture.

INDUSTRIAL: A Modbus RTU slave on an AVR ATmega receives register write commands over UART in an ISR and exposes those registers to a PLC-facing application loop. The shared register table must use atomic 8-bit accesses (AVR guarantees 8-bit RAM access is atomic) or interrupt-disable guards for multi-byte values. Engineers new to AVR often forget that 16-bit reads on AVR are non-atomic -- the compiler uses a temporary register, and an ISR can corrupt it between the low and high byte reads.

AEROSPACE: A flight computer running on a dual-core STM32H7 (Cortex-M7 + Cortex-M4) where the M7 runs navigation and the M4 runs actuator control. The two cores share a region of SRAM3. True hardware-level mutual exclusion requires the HSEM (Hardware Semaphore) peripheral, which provides 32 independent semaphores accessible from both cores with atomic test-and-set at the bus level. Software mutexes within a single RTOS are NOT sufficient here -- they only protect against preemption within one core's scheduler, not concurrent access from a second core with its own pipeline.

IOT: A Bluetooth mesh node processes packets from a BLE stack ISR context and a user application main-loop context. The BLE stack typically runs in a protected region with its own event queue. Application code that calls stack APIs from both an ISR and a task context will corrupt the stack's internal state. Most BLE stacks mandate that all API calls are made from a single task context -- synchronization is enforced at the architectural level, not left to the application engineer.

## Common Mistakes

**Mistake 1** — USING A MUTEX IN AN ISR What goes wrong: The ISR calls xSemaphoreTake. If the mutex is held, the ISR blocks. ISRs cannot block -- the scheduler is not running in an ISR context. The system hangs, the watchdog fires, or the behavior is undefined depending on the RTOS. How to avoid it: ISRs use only the FromISR API variants. For ISR-to-task data transfer, use a queue or binary semaphore. For protected shared state between ISR and task, use interrupt-disable critical sections, not mutex locking.

**Mistake 2** — FORGETTING VOLATILE ON ISR-SHARED VARIABLES What goes wrong: The compiler optimizes a tight polling loop that reads a flag set by an ISR: it reads the flag once, caches it in a register, and never re-reads memory. The ISR sets the flag; the main loop never sees it. The system waits forever. How to avoid it: Declare all variables written by an ISR and read by another context as volatile. Review all ISR-shared state in code review as a checklist item.

**Mistake 3** — TAKING TWO MUTEXES IN DIFFERENT ORDER What goes wrong: Task A takes mutex_uart then tries to take mutex_dma. Task B takes mutex_dma then tries to take mutex_uart. Each task holds one mutex and waits for the other. Neither can proceed. Classic circular deadlock. Often only manifests under specific timing. How to avoid it: Establish a global lock ordering: if your system has N mutexes, number them and enforce that any task acquiring multiple mutexes does so in ascending order. Document this ordering in the architecture. Static analysis tools can enforce it.

**Mistake 4** — USING BINARY SEMAPHORE INSTEAD OF MUTEX FOR MUTUAL EXCLUSION What goes wrong: A binary semaphore appears to work like a mutex -- take it before accessing shared data, give it after. But semaphores have no ownership. They do not support priority inheritance. Priority inversion is guaranteed under any scheduling pressure. Additionally, a different task than the one that took it can give it -- a logic bug that mutexes prevent by design. How to avoid it: Use a mutex for mutual exclusion between tasks. Use binary semaphores only for signaling (ISR notifies task) or for single-producer single-consumer event handoff.

**Mistake 5** — LONG CRITICAL SECTIONS KILLING INTERRUPT LATENCY What goes wrong: A developer wraps an entire UART transmit sequence -- multiple byte sends, delay loops -- inside a disabled-interrupt critical section. Hardware interrupt latency spikes. An encoder ISR misses a tick. A CAN receive FIFO overflows. Real-time behavior degrades in a way that is hard to correlate with the critical section. How to avoid it: Critical sections should be microseconds, not milliseconds. The rule: disable interrupts only to copy or swap the shared data, then re-enable. Do all computation outside the critical section with a local copy of the data.

**Mistake 6** — ASSUMING 32-BIT ACCESS IS ATOMIC ON CORTEX-M What goes wrong: A developer reads that "Cortex-M has a 32-bit bus" and assumes 32-bit variable access is atomic. In most cases it is -- but the C compiler is allowed to access 32-bit variables as two 16-bit accesses if alignment is not guaranteed. Misaligned structs packed with **attribute**((packed)) are especially prone to this. How to avoid it: For safety, assume nothing is atomic unless you use LDREX/STREX or a proper critical section. Avoid packed structs in shared memory. Use stdint.h types with explicit alignment. If using C11, use _Atomic or stdatomic.h primitives.

**Mistake 7** — GIVING A MUTEX FROM A DIFFERENT TASK THAN THE TAKER What goes wrong: A task takes a mutex to protect a resource, but a timeout or error handler in a different task calls Give on the same mutex to "release" it in the error path. The RTOS may assert, corrupt the owner field, or silently allow double-releases. The resource is now accessible to two tasks simultaneously. How to avoid it: Mutexes must be given by the same task that took them. Error paths and cleanup code must be written to give the mutex from within the owning task's context. If you need a different task to release access, re-examine whether a mutex is the right primitive.

## Debugging and Troubleshooting

**Symptom:** A variable occasionally contains a garbage or impossible value (e.g., velocity reads as 65,535 rpm, a pointer is non-NULL but invalid, a counter skips values).

**Possible Cause:** Race condition on a multi-byte or multi-step variable shared between an ISR and a task, or between two tasks.

**Investigation Method:** In the debugger, set a data watchpoint on the suspect variable. Add a bounds-check assert and log the program counter on violation. Review the disassembly of every access site to count instructions -- if a write or read takes more than one instruction, it is not atomic. Check that volatile is applied.

**Resolution:** Protect all access sites with a consistent synchronization method: interrupt-disable for ISR/task, mutex for task/task. Use a local copy pattern: disable interrupts, copy the data to locals, re-enable, then operate on locals.

**Symptom:** The system appears running (LEDs blink, watchdog fed) but one or more tasks stop producing expected output after some run time. Debugger shows tasks in Blocked state with no timeout.

**Possible Cause:** Deadlock. Two or more tasks are waiting on mutexes held by each other in a circular dependency.

**Investigation Method:** Halt the system and inspect the RTOS task list. In FreeRTOS, use vTaskList() output or the RTOS-aware debug plugin to view each task's state, stack high-water mark, and what object it is blocked on. Trace the chain: Task A blocked on Mutex X held by Task B, which is blocked on Mutex Y held by Task A.

**Resolution:** Establish and enforce a global lock ordering. Refactor so tasks never hold more than one mutex at a time. Add timeout parameters to all mutex takes during development; a timeout expiry with a log entry will surface deadlock paths long before they become production issues.

**Symptom:** A high-priority task misses its deadline intermittently. CPU load is not high. The system otherwise appears healthy. Increasing the task's stack size does not help.

**Possible Cause:** Priority inversion. The high-priority task is blocked on a mutex held by a low-priority task, which is being preempted by a medium-priority task.

**Investigation Method:** Use an RTOS-aware trace tool (Segger SystemView, FreeRTOS+Trace) to capture a timeline of context switches and mutex events. Look for the pattern: high-pri task blocks, low-pri task runs but is preempted, medium-pri task runs while high-pri waits.

**Resolution:** Ensure you are using a mutex with priority inheritance, not a binary semaphore. In FreeRTOS, the mutex created with xSemaphoreCreateMutex() implements priority inheritance; xSemaphoreCreateBinary() does not.

**Symptom:** Firmware crashes (HardFault, stack overflow fault) at an apparently random location. The crash address changes each run. Stack canary has been overwritten.

**Possible Cause:** ISR stack overflow. An ISR with significant local variable usage, or nested interrupts, has overflowed the stack of the interrupted task. This is often mistaken for a heap corruption or buffer overflow bug.

**Investigation Method:** Calculate worst-case ISR stack usage: sum local variables of all simultaneously-active ISRs plus the Cortex-M exception frame (8 registers x 4 bytes = 32 bytes, or 68 bytes with FPU state). Enable FreeRTOS stack overflow hooks (configCHECK_FOR_STACK_OVERFLOW = 2) and MPU stack guard pages if available.

**Resolution:** Increase stack sizes for tasks that can be interrupted by large ISRs. Move ISR local buffers to static global storage (with correct protection) to remove them from the stack frame. Reduce interrupt nesting depth if possible.

## Design Considerations and Best Practices

1. **Minimize Shared State by Design.** The best way to avoid synchronization bugs is to need less synchronization. Architect tasks so each owns its data exclusively and communicates via message queues rather than shared memory. This is not always possible in embedded systems with constrained memory, but it should be the default design goal. Every piece of shared state is a liability that must be actively managed for the lifetime of the product.

2. **Match the Primitive to the Pattern.** Use a mutex for mutual exclusion between tasks. Use a binary semaphore for signaling (ISR posts, task pends). Use a counting semaphore for resource pool counting. Use interrupt disable for ISR-to-task shared variables in bare-metal or when an RTOS mutex cannot be used. Conflating these patterns introduces subtle bugs that are difficult to diagnose because the system "almost" works.

3. **Keep Critical Sections Minimal.** Everything inside a critical section is serial: it blocks all other waiters and (in bare-metal) all interrupt handlers. Move computation, formatting, logging, and protocol processing outside the critical section. Copy data in, copy data out, and work on copies. The critical section duration sets your worst-case interrupt latency floor on bare-metal systems.

4. **Enforce a Global Lock Ordering and Document It.** In any system where tasks take more than one mutex, the order of acquisition must be defined and documented -- in the architecture document and in code comments. Without a documented order, the lock ordering drifts as code grows, and deadlock becomes a question of when, not if. Number your mutexes and enforce ascending-order acquisition.

5. **Use Mutex Take with a Timeout During Development.** A timeout of 10-100ms combined with an assert or error log on expiry will surface deadlocks that would otherwise be silent. Once the system is validated, you can assess whether production code should use infinite waits or retain bounded timeouts for fault recovery behavior.

6. **Treat Volatile and Synchronization As Separate Concerns.** volatile prevents the compiler from caching the variable. Synchronization primitives prevent interleaved access. You typically need both: volatile ensures the compiler re-reads from memory on each access; the critical section ensures no other context modifies the value between your read and your write.

7. **Never Call Blocking Rtos Apis From Isr Context.** This is a correctness requirement, not a performance suggestion. ISRs must use the FromISR API variants exclusively. In FreeRTOS, calling the non-ISR variant from an ISR will corrupt the scheduler state. Enable configASSERT in FreeRTOS during development -- it catches many of these misuse patterns at runtime before they cause silent corruption.

8. **Test Concurrency Paths Explicitly.** Race conditions do not appear in unit tests of individual functions. Use stress tests: run the system at full load, trigger rapid context switches by lowering task tick rates, use a JTAG debugger to manually suspend and resume tasks to force boundary conditions. Static analysis tools (Polyspace, PC-lint) can find data races without executing the code at all.

## Expert Notes

**Note 1** — WHAT TEXTBOOKS OMIT: Priority inheritance does NOT fully solve priority inversion -- it prevents unbounded inversion, but the high-priority task still waits for the low-priority task to finish its critical section. The correct architectural response is to minimize the time any task holds a mutex. A mutex that protects a 10-microsecond register swap is fine. A mutex that protects a 500-microsecond flash write is an architectural problem that inheritance cannot fix.

**Note 2** — WHAT CAUSES PRODUCTION FAILURES: The Mars Pathfinder priority inversion bug of 1997 is not just a historical curiosity -- variants of it appear in production firmware every year. The pattern is always the same: a low-priority housekeeping task holds a mutex, a high-priority real-time task needs the same mutex, and a medium-priority task (often something innocuous like periodic telemetry) preempts the housekeeping task and holds the CPU just long enough for the watchdog to fire. The system resets. The log shows a watchdog reset. No one suspects the semaphore because the telemetry task looks innocent.

**Note 3** — WHAT JUNIOR ENGINEERS FREQUENTLY MISS: A single-producer single-consumer (SPSC) lock-free ring buffer is safe WITHOUT any mutex or interrupt disable, provided memory barriers are correct and the producer and consumer are in separate execution contexts that do not run simultaneously (i.e., on a single-core MCU). This pattern is used in virtually every high-performance embedded driver. It eliminates the critical section entirely. If you are using a mutex to protect a ring buffer where one side is an ISR, you are doing more work than necessary and introducing ISR-blocking risk.

**Note 4** — WHAT EXPERIENCED ENGINEERS PAY ATTENTION TO: Compiler version changes can introduce or fix race conditions. An optimization flag change from -O1 to -O2 can cause a previously "working" race condition to surface because the optimizer now aggressively caches a non-volatile shared variable in a register. Every firmware release that changes the toolchain version or optimization flags should be followed by a concurrency regression test. This is rarely in anyone's test plan and it should be.

**Note 5** — HARDWARE SIDE (WHAT TEXTBOOKS OMIT): On Cortex-M7 (STM32H7, STM32F7), the data cache changes the rules. A peripheral or DMA engine writing to RAM does not automatically invalidate the D-cache line covering that address. If your task reads from a buffer that DMA wrote, and the cache has a stale copy, the task sees old data -- this looks identical to a race condition but is actually a cache coherency bug. The fix is to either mark the DMA buffer region as non-cacheable in the MPU, or to invalidate the cache range before reading the buffer. This is not a synchronization primitive issue, but it is found by engineers who are debugging what looks like one.

## Summary

Concurrency bugs are defined by their non-determinism: they do not appear on demand, they do not reproduce reliably in a debugger, and they often survive months of testing before surfacing in production at the worst possible moment. The root cause is always the same -- multiple execution contexts accessing shared state without adequate coordination. On embedded systems, this is not an edge case. It is the default condition of any firmware with interrupts.

The tools exist to handle this correctly. Interrupt-disable critical sections for brief, bare-metal ISR/task data exchanges. Mutexes with priority inheritance for task-to-task mutual exclusion where the wait time is bounded. Binary semaphores for ISR-to-task event signaling. Lock-free SPSC ring buffers for high-throughput, low-latency data paths. LDREX/STREX exclusive access for lightweight atomics on Cortex-M3 and above. Each tool has a context where it is correct and contexts where it causes new problems. Choosing the wrong tool is just as dangerous as no tool.

Deadlock and priority inversion are the failure modes of synchronization itself -- they happen when synchronization is present but incorrectly designed. Deadlock is prevented by lock ordering discipline. Priority inversion is bounded by using proper mutex primitives and minimizing critical section duration. Both are architectural concerns that cannot be patched at the code level without a design change.

The deeper skill is writing firmware that minimizes the need for synchronization through architectural discipline: single-owner data, message-passing between contexts, and clear documentation of shared resource access patterns. Synchronization primitives are load-bearing structure in your firmware, not incidental implementation details.

MENTAL MODEL TO RETAIN: Every shared variable is a contract -- who writes it, who reads it, and under what conditions. For every shared variable in your system, you should be able to state that contract in one sentence. If you cannot, the synchronization is likely wrong. Write the contracts down, enforce them with the right primitive, and verify them under stress -- not just at rest.

## Related Topics

Prerequisites: - RTOS Fundamentals - Interrupt Handling - ARM Cortex-M Architecture - C Memory Model and volatile

Next Topics: - Fault Handling - Memory Corruption and System Stability - Lock-Free Data Structures - RTOS Task Design Patterns

---

The rendered HTML version is saved at: /tmp/claude-1000/-home-kaushik-workspace-Templates-PWP/8c29c2be-f7aa-4cab-a839-85ab72e715a6/scratchpad/concurrency-article.html

The HTML file uses a phosphor-green / logic-amber palette on a deep blue-black ground (#0D1117), monospace section headers, a sticky scroll-spy TOC sidebar with glowing dot indicators, an animated dual-trace oscilloscope canvas in the hero, and structured card layouts for mistakes and debug entries. It is fully self-contained with no external dependencies.
