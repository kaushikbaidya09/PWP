---
id: rtos-fundamentals
tags: ['RTOS', 'FreeRTOS', 'Scheduler', 'Tasks']
---

# RTOS Fundamentals: Running Multiple Tasks Predictably

Imagine you are debugging a motor controller that also needs to update a display, respond to button presses, and send telemetry over UART. You write a big loop, carefully ordering each operation, tuning delays, and praying that nothing takes too long. It works in testing. Then, in production, the motor stutters for 200 milliseconds every time the display refreshes. You add a flag, restructure the loop, test again. Three weeks later, a new bug appears: button presses are dropped under heavy UART load. You are not writing bad code. You are fighting the wrong architecture.

This is the problem that a Real-Time Operating System, or RTOS, exists to solve. The core promise of an RTOS is not "fast" in the sense of raw throughput. It is "predictable." An RTOS lets you decompose a complex embedded application into independent units of work called tasks, each with its own timing requirements, and guarantees that high-priority work is never delayed by low-priority work. The word "real-time" means that the system meets defined timing deadlines, not that it runs as fast as possible.

For a junior engineer, the jump from bare-metal superloop to RTOS can feel like suddenly having to understand an entire operating system. In practice, an RTOS kernel for a Cortex-M MCU compiles down to a few kilobytes of code. The concepts are few and concrete. What it requires is a mental shift: instead of thinking about the order of operations in a single loop, you think about concurrent units of work with priorities and communication between them.

An RTOS does not eliminate complexity. It moves complexity from timing management inside your application logic into a well-defined, tested kernel. That trade is almost always worth making once your application has more than two or three loosely related responsibilities. FreeRTOS, Zephyr, ThreadX, and embOS are the names you will encounter most often in the field. The concepts across all of them are nearly identical; the API names differ.

By the end of this article, you will understand what a task is and how the scheduler decides which one runs, what context switching is at the hardware level on an ARM Cortex-M processor, how priority assignment drives real-time behavior, and what the common mistakes are that turn an RTOS application into something less reliable than the superloop it replaced.

## The Fundamental Problem

A bare-metal superloop works well when every operation in the loop completes in a predictable, short time. The loop polls all inputs, updates all state, drives all outputs, and repeats. The problem is that embedded applications rarely have this property. Some operations are fast: reading a GPIO takes nanoseconds. Others are slow: writing to external flash can take tens of milliseconds. When a slow operation blocks the loop, every other operation waits. The motor control update that must happen every 100 microseconds waits behind a 20-millisecond UART transmission. You cannot fix this problem by being clever about loop ordering once the timing requirements diverge by more than an order of magnitude.

Interrupts are the first tool engineers reach for to solve this. You move the time-sensitive work into an interrupt service routine and let the rest run in the background loop. This works up to a point. When you have three or four interrupt sources with different priorities and shared data, you begin building a scheduler yourself, badly, without realizing it. You introduce flags, state machines in ISRs, deferred processing queues. This is the ad-hoc RTOS, and it is what you are building in every complex superloop project. An RTOS gives you that infrastructure, pre-built, tested, and understood by every engineer who reads your code afterward.

The naive approach also fails under load in non-obvious ways. A superloop with interrupt offloading appears to work correctly during normal operation, then fails only under specific combinations of simultaneous events. These are the hardest bugs in embedded development because they are not reproducible from a debugger. They are timing bugs. An RTOS does not eliminate timing bugs, but it gives you the tools to reason about them: stack depth, worst-case execution time, priority assignment, and blocking behavior are all explicit and measurable rather than emergent properties of loop ordering.

## The Big Picture

An RTOS sits between your application code and the hardware. The hardware includes the CPU, peripherals, and memory. Your application is divided into multiple tasks, each implemented as an infinite loop function. The RTOS kernel, running on the same CPU, decides which task runs at any moment based on priority and state. Peripheral drivers sit at the bottom, often triggering the kernel through interrupts when hardware events arrive.

At the highest level, the system operates in two modes. When no task is ready to run, the idle task runs, which typically puts the CPU into a low-power sleep state. When a task becomes ready, the scheduler wakes the CPU and gives it control. The transition between tasks is the context switch. Hardware interrupts can preempt any task, but they should defer long work back to a task through a notification mechanism rather than executing it inside the ISR.

The diagram below shows the layered structure and the relationship between tasks, the scheduler, and hardware:

<div class="detail-diagram">
<img src="../assets/svg/diagrams/rtos_arch.svg" alt="RTOS Architecture — Tasks, Kernel, Hardware" loading="lazy">
</div>

The scheduler is invoked on every RTOS tick (driven by SysTick on Cortex-M), on every blocking API call, and on every ISR exit when a higher-priority task has been unblocked. This means context switches happen not only on a timer but also immediately when important work arrives.

## Key Concepts and Terminology

**Task** — An independent unit of execution with its own stack, priority, and state. A task is implemented as a C function that never returns; it contains an infinite loop. Each task has its own stack in RAM, which is where its local variables and register saves live during context switches. Tasks are the fundamental abstraction replacing the superloop.

**Scheduler** — The kernel component that decides which task runs on the CPU at any moment. In a preemptive priority-based scheduler (the most common type), the highest-priority READY task always runs. If two tasks have equal priority, they share the CPU in a round-robin fashion on each tick. The scheduler is not a background thread; it executes as part of the kernel inside the context-switch mechanism.

**Context Switch** — The act of saving the CPU state of the currently running task and restoring the CPU state of the next task to run. On ARM Cortex-M, this involves saving and restoring 16 general-purpose registers (R0-R12, SP, LR, PC), plus floating-point registers if the FPU is in use. The processor's hardware assists this process through the PendSV exception.

**Task State** — Each task is in exactly one state at any moment: RUNNING (currently on the CPU), READY (eligible to run but waiting for the CPU), BLOCKED (waiting for an event such as a queue, semaphore, or timeout), or SUSPENDED (explicitly removed from scheduling). Only one task can be RUNNING at a time on a single-core MCU.

**Priority** — A numeric value assigned to a task at creation that determines its scheduling order. Higher priority tasks preempt lower priority tasks. On FreeRTOS, higher numbers mean higher priority. On some other RTOSes it is reversed. Knowing which convention your RTOS uses is non-negotiable.

**Tick** — The periodic interrupt that drives the RTOS time base. On Cortex-M, SysTick generates this interrupt, typically at 1 kHz (1 ms period). The tick is used to unblock tasks waiting on timeouts, to implement vTaskDelay, and to trigger round-robin time-slice switches between equal-priority tasks.

**Stack** — Each task has its own dedicated stack region in RAM. The stack holds local variables, function call frames, and saved CPU registers during context switches. Stack overflow is the most common runtime failure in RTOS applications. Stack size must be configured at task creation.

**Semaphore** — A signaling primitive used to synchronize tasks or to notify a task from an ISR. A binary semaphore is either available or not; a counting semaphore has a count. A task can block on a semaphore (waiting for it to become available), and an ISR can give a semaphore to unblock the waiting task without itself doing the work.

**Queue** — A data structure that allows tasks (and ISRs) to send messages to other tasks. Unlike a semaphore, a queue carries data. The RTOS kernel handles the copy and the thread-safety. Queues are the primary mechanism for passing data between tasks safely.

**Idle Task** — The lowest-priority task created automatically by the RTOS kernel. It runs only when all application tasks are blocked. It is commonly used to put the CPU into a low-power sleep mode. Application code can hook into the idle task through a callback, but the idle task must never block.

## How It Works

### Step 1: Kernel Initialization the Application Calls an Rtos Initialization Function (vtaskstartscheduler in Freertos). Before This Call, the Application Has Created One or More Tasks by Calling the Task-Creation Api. Each Task Creation Allocates a Task Control Block (tcb) and a Stack Region, Either Statically From Linker-Defined Arrays or Dynamically From the Heap. the Tcb Stores the Task's Name, Priority, Stack Pointer, and State. at Initialization, All Created Tasks Start in the Ready State.

### Step 2: Scheduler Start and First Dispatch Vtaskstartscheduler Configures the Systick Timer to Generate Interrupts at the Configured Tick Rate, Sets Up the Pendsv Exception for Context Switching, and Then Dispatches the Highest-Priority Ready Task. on Cortex-M, This Involves Manipulating the Process Stack Pointer (psp) to Point to the First Task's Stack and Executing an Exception Return to Enter the Task in Thread Mode (unprivileged Execution). From This Point Forward, the Application's Main() Function Never Resumes.

### Step 3: Task Execution and Blocking the Running Task Executes Its Code. When It Needs to Wait for Something (a Delay, a Queue Message, a Semaphore), It Calls a Blocking Rtos Api. the Api Moves the Task From Running to Blocked, Records the Reason for Blocking (and the Timeout If Any), and Calls the Scheduler. the Scheduler Scans the Ready List and Dispatches the Next Highest-Priority Ready Task. the Cpu Never Spins Waiting. If No Tasks Are Ready, the Idle Task Runs.

### Step 4: Tick Interrupt and Timeout Management Every Tick Period, Systick Fires. the Tick Handler Increments the Tick Count, Scans the List of Blocked Tasks, and Moves Any Task Whose Timeout Has Expired Back to the Ready State. If a Newly Readied Task Has Higher Priority Than the Currently Running Task, the Tick Handler Pends a Context Switch by Setting the Pendsv Exception As Pending. Pendsv Fires at the Lowest Interrupt Priority, Ensuring It Runs After All Hardware Isrs Complete. This Two-Step Mechanism (pend Then Execute) Keeps Context Switches Out of High-Priority Interrupt Handlers.

### Step 5: Context Switch Execution (pendsv) the Pendsv Handler Is the Core of the Context Switch. on Cortex-M, Hardware Automatically Saves R0-R3, R12, Lr, Pc, and Xpsr to the Current Task's Stack When Entering Any Exception (this Is the Hardware Exception Frame). the Pendsv Handler Saves the Remaining Registers (r4-R11, and Fp Registers If Used) Onto the Current Task's Stack. It Updates the Current Tcb's Stack Pointer, Calls the Scheduler to Select the Next Task, Loads the New Task's Stack Pointer From Its Tcb, Pops R4-R11 From the New Stack, and Executes an Exc_return Value That Causes Hardware to Restore R0-R3, R12, Lr, Pc, and Xpsr From the New Task's Stack. the New Task Resumes Exactly Where It Left Off.

### Step 6: Unblocking From an Isr a Hardware Isr (say, a Uart Receive Complete Interrupt) Needs to Wake a Task That Is Waiting for Incoming Data. the Isr Calls a Fromisr Variant of the Rtos Api (xqueuesendfromisr or Xsemaphoregivefromisr in Freertos). These Functions Are Interrupt-Safe and Never Block. They Manipulate the Kernel Data Structures Directly and Set a Flag Indicating a Higher-Priority Task May Have Been Unblocked. the Isr Passes This Flag Back to the Kernel on Exit by Calling Portyield_from_isr. If the Flag Is Set, Pendsv Is Pended and the Context Switch Occurs at Isr Exit, Ensuring the Unblocked Task Runs Immediately Rather Than Waiting for the Next Tick.

### Step 7: Round-Robin Among Equal-Priority Tasks When Two or More Tasks Share the Same Priority and Are Both Ready, the Scheduler Gives Each a Full Time-Slice (one Tick Period) Before Switching. This Is Round-Robin Scheduling. It Ensures No Equal-Priority Task Starves, but It Also Means That a Task Cannot Assume It Will Complete a Short Operation Without Preemption If Another Same-Priority Task Exists. Time-Slicing Is Configurable; Some Hard Real-Time Designs Disable It and Rely Entirely on Explicit Yields.

## Under the Hood

On ARM Cortex-M, the RTOS exploits specific hardware features that are designed for exactly this purpose. The processor has two stack pointers: the Main Stack Pointer (MSP) and the Process Stack Pointer (PSP). The kernel and interrupt handlers use MSP. Each task uses PSP. This separation means the kernel's stack and each task's stack are independent memory regions. The SVC (Supervisor Call) instruction, PendSV, and SysTick exceptions are the three hardware mechanisms most RTOS kernels use, and their priority relationships are carefully set to make context switching safe and efficient.

The PendSV exception is deliberately configured at the LOWEST interrupt priority on Cortex-M. This is critical. When a higher-priority ISR calls a FromISR API and pends PendSV, the context switch does not interrupt the ISR. It waits. All pending hardware interrupts drain first. Only when the CPU would otherwise return to Thread mode does PendSV execute. This means context switches never occur inside ISR handlers, preventing a class of reentrancy bugs that plagued earlier architectures.

The task stack must hold a complete CPU snapshot at the moment of preemption. For a Cortex-M4 task with FPU in use, this is 34 words (136 bytes) of register state per context switch frame, not counting the task's own local variables and call stack depth. A task running a deeply nested call chain with large local arrays can easily consume a kilobyte or more. The stack monitor (typically implemented using a known fill pattern like 0xA5A5A5A5 written to the stack at creation) can detect overflow before it corrupts adjacent memory, but it is a detection mechanism, not prevention. If you configure a task stack too small and the monitor catches it, the system has already been operating in a degraded state.

Interrupt latency in an RTOS-based system is often misunderstood. Hardware ISRs still fire with the same latency as in bare-metal code because they are handled entirely by the NVIC, bypassing the scheduler. What the RTOS adds is the time from ISR exit to when the notified task actually runs. In FreeRTOS on a Cortex-M running at 168 MHz, this interrupt-to-task latency is typically under 10 microseconds. For most applications this is acceptable. For applications requiring sub-microsecond response (motor phase control, encoder counting), the work must still remain in the ISR, with the RTOS used only for the non-time-critical aftermath.

The RTOS tick introduces a minimum timing granularity. A call to vTaskDelay(1) delays for at least one tick period (1 ms at 1 kHz tick rate) but possibly up to two tick periods depending on when in the current tick the call is made. If you need sub-millisecond timing, do not use vTaskDelay. Use a hardware timer directly, or run the tick at a higher rate and accept the overhead. This is a common source of timing surprises for engineers new to RTOS.

## Real-World Applications

AUTOMOTIVE Engine control units decompose into tasks at multiple priority levels: crank-angle-synchronized fuel injection calculation runs at the highest priority, driven by crankshaft position interrupts. Transmission gear-shift logic runs at a medium priority with a defined periodic rate. CAN bus communication and diagnostic logging run at lower priorities. The RTOS guarantees that the injection calculation always meets its deadline regardless of CAN bus load.

MEDICAL Infusion pumps use RTOS architectures where the motor control task (high priority, strict periodicity) is separated from the alarm monitoring task (high priority, event-driven) and the user interface task (low priority, can be sluggish). Critically, medical device RTOSes often require formal certification: FreeRTOS has a SafeRTOS derivative certified to IEC 62304, and INTEGRITY RTOS is certified for DO-178C in avionics. Task separation means that a UI bug cannot delay drug delivery.

INDUSTRIAL Programmable logic controllers (PLCs) in industrial automation implement the IEC 61131-3 scan cycle as a high-priority periodic task. Fieldbus communication (EtherCAT, PROFINET) tasks run at deterministic rates. Operator interface and data logging run as low-priority background tasks. STM32-based industrial controllers commonly run FreeRTOS or Zephyr for exactly this decomposition.

CONSUMER ELECTRONICS Wireless earbuds run Bluetooth audio decode, active noise cancellation DSP, touch interface handling, and battery management as separate RTOS tasks. The audio decode task runs at high priority with a tight deadline (typically every 7.5 ms for Bluetooth LE Audio). If the battery management task were to block the audio task even briefly, users would hear audio dropouts. Task priority separation prevents this.

IOT / CONNECTIVITY ESP32-based IoT devices use FreeRTOS (it is built into the ESP-IDF framework). The WiFi and TCP/IP stack runs as system tasks at defined priorities. Application code runs at lower priorities. The developer creates tasks for sensor reading, cloud publishing, and local display updates. The framework's RTOS integration means that a slow cloud publish (waiting on a TCP ACK) never blocks sensor sampling.

## Common Mistakes

**Assigning All Tasks the Same Priority** — When every task has equal priority, round-robin scheduling applies universally. Time-sensitive operations are no longer protected from being delayed by slower tasks. Real-time behavior disappears. The fix is to assign priorities based on deadline: shorter deadline means higher priority (Rate Monotonic Scheduling is the theoretical basis). Spend time on your priority table before writing a line of task code.

**Blocking Inside an Isr** — Calling vTaskDelay, xQueueReceive, or any blocking RTOS API from an ISR will corrupt the kernel state or cause a hard fault. ISRs must use the FromISR variants of all RTOS APIs. The FromISR functions never block. They are designed to be callable from interrupt context. The FreeRTOS documentation is explicit about this; there is no excuse for mixing them up.

**Stack Too Small** — The default stack size suggested in tutorials is usually too small for any task that calls printf, uses floating-point, or calls deeply nested functions. Enable FreeRTOS stack overflow detection (configCHECK_FOR_STACK_OVERFLOW set to 2), and instrument uxTaskGetStackHighWaterMark periodically during development. Set the final stack size to observed peak plus 50% margin.

**Sharing Data Without Protection** — Two tasks sharing a global variable without a mutex or critical section will race. On Cortex-M, a read-modify-write of a 32-bit aligned variable MAY be atomic in practice, but it is not guaranteed and the compiler may issue multiple instructions for what looks like a single line of C. Never rely on implicit atomicity. Use a mutex, a queue, or a critical section.

**Priority Inversion Without a Priority-Inheritance Mutex** — If a low-priority task holds a mutex and a high-priority task blocks waiting for it, and a medium-priority task preempts the low-priority task, the high-priority task is effectively blocked by the medium-priority task. This is priority inversion. Use a mutex type that supports priority inheritance (FreeRTOS mutexes do this). Understand it, test for it, and design around it.

**Using Rtos Delays As Timing Sources for Control Loops** — vTaskDelay introduces jitter because tick granularity and scheduler latency vary. A control loop that calls vTaskDelay(10) does not run every 10 ms; it runs every 10 ms PLUS scheduler overhead PLUS any time spent waiting for a higher-priority task to block. Use vTaskDelayUntil for periodic tasks, which compensates for execution time, and verify actual timing with a GPIO toggled at task entry, measured on a logic analyzer.

**Not Accounting for the Idle Task Stack** — The idle task also has a stack. In static allocation mode, this stack must be provided by the application. Forgetting it, or making it too small, causes crashes in what appears to be idle time. The hook functions registered on the idle task (vApplicationIdleHook) must not call blocking RTOS APIs.

## Debugging and Troubleshooting

**Symptom:** System hard-faults randomly, usually under load.

**Possible Cause:** Stack overflow on one or more tasks. The hard fault occurs when the stack pointer walks into another task's stack or into kernel memory.

**Investigation Method:** Enable configCHECK_FOR_STACK_OVERFLOW=2 in FreeRTOSConfig.h. Implement vApplicationStackOverflowHook to write a unique identifier to a known memory location before trapping. Call uxTaskGetStackHighWaterMark on all tasks from a low-priority diagnostic task and log the results early in system operation.

**Resolution:** Increase the stack allocation for the overflowing task. Add 50% margin beyond the measured high-water mark. If RAM is constrained, reduce the task's local variable usage or split the task.

**Symptom:** A high-priority task misses its deadline intermittently, with no obvious blocking operation in its code.

**Possible Cause:** A lower-priority task holds a shared mutex, and priority inheritance is not functioning (wrong mutex type used), or a critical section in an ISR is holding off the scheduler for too long.

**Investigation Method:** Toggle a GPIO at entry and exit of the high-priority task and measure with a logic analyzer. Identify what is running between the expected entry time and the actual entry time. Check all mutexes taken by tasks that share resources with the high-priority task.

**Resolution:** Replace standard mutexes with priority-inheritance mutexes. Shorten or eliminate critical sections in ISRs. Reconsider resource sharing between the high-priority task and lower-priority tasks.

**Symptom:** System appears to freeze (no response to inputs, no output activity) but the watchdog does not fire.

**Possible Cause:** Deadlock: two tasks are each waiting for a mutex held by the other. The watchdog continues to be refreshed by a third, still-running task (such as the idle task hook), masking the deadlock.

**Investigation Method:** Attach a debugger and pause execution. Inspect the task list using vTaskList (FreeRTOS) or equivalent. Identify which tasks are in the BLOCKED state and what object each is waiting on. Trace the ownership chain.

**Resolution:** Redesign the locking order so that all tasks acquire mutexes in the same global order. Alternatively, use a single mutex protecting a shared data structure rather than multiple fine-grained locks.

**Symptom:** A task that should respond immediately to a hardware event (ISR-driven) has visible latency of 10-50 ms.

**Possible Cause:** The ISR is not calling portYIELD_FROM_ISR after giving the semaphore or sending to the queue. The unblocked task therefore waits until the next tick to be scheduled, rather than being immediately scheduled at ISR exit.

**Investigation Method:** Review the ISR code. Confirm that the higher-priority wake-up parameter (pxHigherPriorityTaskWoken) is passed to the FromISR function and its result is passed to portYIELD_FROM_ISR at the end of the ISR.

**Resolution:** Add portYIELD_FROM_ISR(xHigherPriorityTaskWoken) as the final statement in every ISR that uses RTOS notification APIs. This pends PendSV and triggers the context switch immediately at ISR exit.

## Design Considerations and Best Practices

ASSIGN PRIORITIES BASED ON DEADLINE, NOT IMPORTANCE - Rate Monotonic Scheduling (RMS) provides a formal basis: tasks with shorter periods get higher priorities. "Importance" is a vague concept; deadline is measurable. A motor control task that must run every 500 microseconds gets a higher priority than a telemetry task that can tolerate 100 ms latency, even if you consider telemetry more "important" to the business.

**Use Static Allocation Wherever Possible** — Dynamic heap allocation in an RTOS introduces fragmentation risk and non-deterministic allocation time. FreeRTOS supports fully static allocation (configSUPPORT_STATIC_ALLOCATION=1). Declare task stacks and TCBs as static arrays. This eliminates an entire class of runtime failures and makes it possible to compute RAM usage at link time.

**Keep Tasks Focused on One Responsibility** — A task that reads a sensor, processes the data, formats a message, and transmits it over UART is doing four jobs. When it blocks on UART, sensor reading stops. Split responsibilities so that each task has one reason to block. A sensor task reads and publishes to a queue. A processing task reads from that queue. A comms task reads from another queue and handles UART.

**Minimize Time Spent in Critical Sections** — A critical section (taskENTER_CRITICAL) disables interrupts on Cortex-M. Every microsecond spent in a critical section is a microsecond of added worst-case interrupt latency. If you are accessing a shared data structure that requires a critical section longer than a few microseconds, redesign the data structure or use a queue to pass ownership rather than sharing in place.

ALWAYS USE vTaskDelayUntil FOR PERIODIC TASKS - vTaskDelay delays relative to when the call is made. If the task body took longer than expected, the next invocation is late. vTaskDelayUntil delays relative to the absolute last wake time. It automatically compensates for execution time and keeps the task running at a consistent rate, which is the definition of periodic in real-time systems.

**Instrument Task Timing During Development** — Toggle a GPIO at task entry and exit. Measure with a logic analyzer or oscilloscope. Compute actual period, actual execution time, and worst-case latency before any code ships. Numbers you measure are reality. Numbers you calculate are estimates. Discrepancies between them reveal preemption, priority inversion, or unexpected blocking.

**Size Your Tick Rate to the Fastest Periodic Task** — A 1 kHz tick rate (1 ms granularity) is appropriate if your fastest periodic task runs at 10 ms or slower. If you have a 500-microsecond control task, either drive it from a hardware timer ISR directly (not from vTaskDelayUntil) or raise the tick rate and accept the overhead. Higher tick rates increase interrupt overhead; every tick is a PendSV evaluation.

**Handle Rtos Api Return Values** — Every RTOS API that can fail (queue send with a timeout, mutex take with a timeout) returns a status. Ignoring these return values is a common cause of silent data loss. If xQueueSend returns pdFALSE, the queue was full and the message was dropped. Your application must handle this case explicitly.

## Expert Notes

**The Rtos Does Not Make Timing Bugs Disappear** — It restructures them. In a superloop, timing bugs appear as loops that run too slowly. In an RTOS, they appear as priority inversions, deadlocks, and missed deadlines. The engineer who understands the RTOS deeply can find and fix these quickly. The engineer who added an RTOS expecting it to "handle timing" will be confused for a long time. The RTOS is a tool for expressing timing requirements, not for silently meeting them.

**Floating Point Is Not Free** — On Cortex-M4/M7 with FPU, the hardware saves and restores floating-point registers on context switch only if the FPU was used during the task's last execution (lazy FPU stacking). This adds up to 34 extra words to the stack frame. If you assign inadequate stack, FPU use will cause silent corruption. If you mix tasks that use FPU with tasks that do not, verify that FreeRTOS is built with configUSE_TASK_FPU_SUPPORT=1 and that the task was created with the FPU support flag.

**The Idle Task High-Water Mark Tells You About Overall Load** — If the idle task is consuming most of the CPU (high-water mark shows very little usage), your system has headroom. If the idle task barely runs, you are close to 100% CPU load. A system that never reaches the idle task has tasks with deadlines longer than their execution times. This is the definition of a system that will fail under worst-case input conditions. Measure idle task utilization on every design before release.

**Misuse of Blocking Apis From Multiple Tasks on One Object** — Multiple tasks can wait on the same queue, semaphore, or event group. When the object becomes available, which task is unblocked depends on the RTOS implementation. FreeRTOS unblocks the highest-priority waiting task, not the longest-waiting one. This is correct behavior for real-time systems, but it surprises engineers expecting FIFO ordering. If two tasks of equal priority wait on the same queue, the unblock order is implementation-defined. Design your architecture so that only one task consumes a given resource.

**Startup Sequencing Matters** — Tasks begin running the moment the scheduler starts. If Task A depends on initialization performed by Task B, and both are READY at scheduler start, you have a race condition. Use an event group or semaphore initialized to "not ready" to block Task A until Task B signals completion. Never use a delay as a startup sequencing mechanism; a delay that works on your hardware today will fail on hardware with a slower startup path or after a code change.

**The Rtos Heap Is Not the C Standard Library Heap** — FreeRTOS provides its own heap implementations (heap_1 through heap_5). The malloc in your C standard library is not thread-safe and must not be called from tasks unless you have replaced its internals with a thread-safe version. Calls to printf on implementations that use dynamic allocation internally are a common way to introduce heap corruption. Know what your printf implementation does.

## Summary

An RTOS solves the fundamental problem of running multiple concurrent activities with predictable timing on a single CPU. It does this by decomposing the application into tasks, each with a priority and a stack, and using a preemptive priority-based scheduler to ensure that the highest-priority ready task always runs. The context switch, executed in hardware-assisted software on Cortex-M via PendSV, saves and restores the full CPU state so that each task resumes exactly where it left off.

The key behaviors to internalize are: priority determines preemption, blocking APIs yield the CPU, ISRs use FromISR variants and trigger immediate reschedule via portYIELD_FROM_ISR, and the RTOS tick provides timing granularity for delays and timeouts. Every task needs a correctly sized stack, a focused responsibility, and priorities assigned by deadline rather than perceived importance.

Common failures in RTOS systems are not caused by the RTOS itself; they are caused by engineers who do not understand the rules. Stack overflow, priority inversion, deadlock, and ISR API misuse are all preventable with discipline. Enable diagnostic features during development (stack monitoring, runtime stats), instrument timing with GPIO toggles, and treat the high-water mark output as a required test artifact before any firmware release.

The mental model to retain is this: the RTOS scheduler is a dispatcher that asks one question repeatedly and without pause: "Of all the tasks that are currently READY to run, which has the highest priority?" The answer to that question determines what runs next. Your job as the firmware engineer is to make sure that the right tasks are READY at the right times, that they complete before their deadlines, and that the shared resources between them are protected. Everything else is plumbing.

## Related Topics

Prerequisites: - Bare-Metal Architecture: understanding the superloop, startup code, linker scripts, and MCU memory map - Interrupts: NVIC configuration, ISR writing, interrupt priorities on Cortex-M, hardware exception model - CPU Execution Model: pipeline, registers, stack pointer operation, exception entry and exit on ARM Cortex-M

Next Topics: - Concurrency and Synchronization: mutexes, semaphores, event groups, message queues, deadlock analysis, priority inversion in depth - Firmware Architecture Patterns: layered architectures, active objects, publish-subscribe with RTOS, component isolation, testability in multitasking firmware
