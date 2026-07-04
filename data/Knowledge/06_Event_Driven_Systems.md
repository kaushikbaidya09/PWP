---
id: event-driven-systems
tags: ['Events', 'Callbacks', 'Non-blocking']
---

# Event Driven Systems

Imagine you are writing firmware for a battery-powered sensor node. The node reads a temperature sensor every 10 seconds, blinks an LED on a valid reading, and transmits over UART when a threshold is crossed. A junior engineer's first instinct is to write a while(1) loop that checks the timer, reads the sensor, checks the threshold, and toggles the LED in sequence. It works on the bench. Then the product manager adds a button that must respond in under 50 ms. The engineer adds a button poll to the loop. Then a second UART channel. Then a watchdog. Within weeks, the loop has grown into a tangled sequence of polls with timing that depends on how long each step takes. The button sometimes misses presses. The UART drops bytes under load. The system that worked on the bench is unreliable in the field.

This is not a bug. It is an architectural failure, and it happens because the engineer used the wrong mental model for the job. Embedded systems do not exist to execute a fixed sequence of operations. They exist to RESPOND TO THE WORLD as it changes. The world sends signals: a button closes, a timer fires, a byte arrives, a voltage crosses a threshold. The firmware's job is to notice those signals and act on them correctly and promptly. An architecture built around polling a loop cannot do that reliably. An architecture built around events can.

Event-driven design is the answer to this problem. It is the dominant philosophy in professional embedded firmware, and for good reason: it maps directly onto how hardware actually works. Microcontrollers are interrupt-driven machines. Peripherals assert signals when something happens. The CPU has mechanisms specifically designed to respond to those signals. An event-driven architecture exploits those mechanisms rather than fighting them with a polling loop.

The concept scales from the simplest STM32G0 running bare-metal at 64 MHz all the way up to a Cortex-A application processor with a full RTOS. Understanding event-driven design at its core, before adding the complexity of an RTOS, is what separates engineers who build robust firmware from engineers who build firmware that mostly works.

By the end of this article, you will understand what an event is and how it differs from a condition you poll, how an event loop processes events without blocking, why reactive systems are more deterministic than polling loops, how to structure a bare-metal event-driven architecture on an ARM Cortex-M MCU, and what traps experienced engineers have already fallen into so you do not have to fall into them yourself.

## The Fundamental Problem

The naive approach to embedded firmware is the SUPERLOOP: a while(1) that checks every input in sequence and takes action when a condition is true. This pattern feels natural because it mirrors how humans think through a checklist. The problem is that it serializes everything. Every check waits for every other check to finish. The time between any two checks of the same input is bounded by the total time to complete one pass through the loop. On a system with ten tasks each taking 1 ms, your loop period is 10 ms at best. You cannot make it faster without cutting tasks. You cannot add tasks without making it slower.

The deeper issue is that the superloop conflates DETECTION with RESPONSE. The loop detects nothing; it just finds conditions that are already true when it happens to look. A button press that lasts 20 ms and a loop period of 25 ms means the button is never seen. A UART byte that arrives 100 ns after the UART check in the loop and is overwritten by the next byte before the loop comes around means data loss. The system is not reacting to the world; it is sampling the world at its own convenience. That is fundamentally different, and the gap between those two things is where reliability is lost.

Hardware provides a direct solution: interrupts. The peripheral hardware asserts a signal to the CPU the moment something happens, the CPU suspends whatever it is doing, runs a small handler, and resumes. Detection is now immediate and hardware-guaranteed, not dependent on when the software loop happens to check. But interrupt-driven hardware alone does not give you an architecture. You still need a way to move work out of the interrupt service routine and into the main context where it can be processed safely, without blocking other interrupts. That structure -- the mechanism for queuing detected events and dispatching them to handlers -- is the event-driven architecture. The hardware detects; the event system routes and processes.

Without that structure, engineers end up doing all the work inside the interrupt handler. That leads to non-reentrant code, priority inversions, and handlers that run long enough to miss the next interrupt. Or they disable interrupts around shared data, introducing latency. Neither is correct. The event-driven model solves this by keeping ISRs minimal (detect and post an event) and doing all real work in a non-interrupt context driven by the event queue.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/event_pipeline.svg" alt="Event-Driven Architecture Pipeline" loading="lazy">
</div>

At the highest level, an event-driven system is a pipeline with three stages: GENERATION, QUEUING, and DISPATCH. Hardware peripherals and software timers generate events when something happens. Those events are placed into a queue by the ISR or timer callback. The event loop in the main context pulls events from the queue and calls the appropriate handler. The handler does the work and returns. The loop checks for the next event. Nothing blocks. Nothing polls hardware directly in the main loop.

This pipeline decouples the timing of detection from the timing of processing. The ISR does not care what the main loop is doing; it posts and returns. The main loop does not care when events arrive; it processes them in order. This decoupling is what makes the system composable. You can add a new peripheral and a new event type without changing any existing handler. You can add a new handler without changing the ISR. The system grows by extension, not by modification of existing, tested code.

ASCII DIAGRAM:

HARDWARE WORLD FIRMWARE APPLICATION ============ ======== ===========

ISRs are MINIMAL: set flag / post event only. NO processing in ISR context.

Notice that every ISR does one thing: it posts an event. All processing happens in the event loop on the right side. The queue is the only shared resource between ISR context and main context, and it is protected with a brief critical section or by using an atomic write. This is the structural discipline that makes event-driven firmware reliable.

## Key Concepts and Terminology

**Event** — A discrete, timestamped signal that something happened. An event has a type (what happened), optionally a payload (associated data), and is typically represented as a struct in C. Unlike a condition you check with an if, an event is generated exactly once when something occurs and persists in the queue until processed. Missing a poll does not destroy an event; missing a poll destroys a condition.

**Trigger** — The hardware or software source that causes an event to be generated. A trigger is the mapping from physical reality (a signal edge, a timer overflow, a DMA transfer complete) to a software event. On a Cortex-M MCU, the trigger is typically an IRQ line configured in the NVIC and EXTI or peripheral interrupt enable register. The trigger defines the "when"; the event defines the "what".

**Reactive System** — A system that is structurally organized to respond to stimuli from its environment rather than to execute a predetermined sequence. Embedded firmware is almost always reactive in nature: the environment drives it. A reactive architecture makes this explicit in code. The system does nothing until an event arrives, then it responds, then it does nothing again. This is distinct from a system that has a fixed loop that always runs regardless of whether there is anything to do.

**Event Loop** — The top-level control structure of an event-driven bare-metal system. It is a while(1) that dequeues one event at a time, calls the dispatch function, and repeats. The key property is that it is NON-BLOCKING: each handler runs to completion quickly and returns control to the loop. The loop is often combined with a WFI instruction when the queue is empty, saving power.

**Dispatch** — The mechanism that routes an event to its handler. In the simplest form, dispatch is a switch statement on the event type. In more structured systems, it is a lookup table mapping event types to function pointers. The dispatcher is the "switchboard" of the architecture. A well-designed dispatcher is itself stateless; the handlers own all state.

**Event Queue** — A FIFO data structure, typically a ring buffer, that holds events between the time they are generated (in ISR context) and the time they are consumed (in the event loop). The queue is the critical shared resource between ISR and non-ISR contexts. It must be accessed atomically at the enqueue point, which on a Cortex-M means disabling interrupts briefly or using an atomic compare-and-swap.

**Isr (interrupt Service Routine)** — The function that executes in response to a hardware interrupt. In an event-driven architecture, the ISR is kept deliberately minimal: it records that an event occurred, clears the interrupt flag in the peripheral, and returns. It does not call application logic, does not allocate memory, and does not block. Treating the ISR as a full handler is one of the most common architectural mistakes in embedded firmware.

**Run-to-Completion (rtc)** — A processing model in which each event handler, once started, executes to its end without being preempted by another handler from the same dispatcher. This simplifies reasoning about shared state enormously because you do not need mutex protection between handlers that run in the same context. RTC is the default model in a bare-metal event loop. It is NOT the default in an RTOS, where tasks can preempt each other.

**Active Object** — A design pattern where each major subsystem owns its own event queue and private state. An active object processes only the events posted to it and encapsulates all the logic for responding to those events. This is the structured extension of the basic event loop toward an RTOS-based model and is the foundation of frameworks like Quantum Platform (QP).

**Deferred Event** — An event that cannot be handled in the current state and must be saved for later when the system reaches a state where it can process it. This arises naturally in state-machine-based event-driven systems. Implementing deferral correctly without losing events or introducing unbounded memory growth is a non-trivial design problem.

## How It Works

### Step 01: Hardware Triggers an Interrupt a Peripheral Detects a Physical Event: a Gpio Pin Transitions, a Timer Overflows, a Uart Receive Data Register Fills. the Peripheral Asserts Its Interrupt Line to the Nvic. the Nvic Checks Whether the Interrupt Is Enabled and Whether Its Priority Exceeds the Current Execution Priority. If Both Are True, the Cpu Finishes the Current Instruction, Pushes Eight Registers (xpsr, Pc, Lr, R12, R3, R2, R1, R0) Onto the Stack Automatically, and Branches to the Isr Address From the Vector Table.

### Step 02: Isr Posts an Event and Returns the Isr Clears the Interrupt Pending Flag in the Peripheral. It Then Constructs a Minimal Event Struct with the Type and Any Essential Payload, and Posts It to the Event Queue Using a Function That Briefly Disables Interrupts to Protect the Shared Queue State. the Isr Returns. the Cpu Pops the Saved Registers and Resumes the Interrupted Code. Total Isr Time Is Typically Under 200 Ns for a Simple Post Operation.

### Step 03: Event Sits in the Queue the Event Queue Is a Ring Buffer with a Write Index Managed by Isr Context and a Read Index Managed by the Event Loop. the Event Waits in the Queue Until the Event Loop Gets to It. If Multiple Events Arrive Before the Loop Processes Them, They Are Served in Order. If the Queue Overflows, This Is a Design Error.

### Step 04: Event Loop Dequeues and Dispatches the Event Loop in Main() Polls the Queue. When an Event Is Available, It Dequeues It with a Critical Section. It Then Passes the Event to the Dispatcher. the Dispatcher Is Typically a Switch on Event.type or a Function-Pointer Table Lookup. It Calls the Registered Handler for That Event Type.

### Step 05: Handler Executes to Completion the Handler for the Event Type Runs All the Application Logic for That Event: Updates State Variables, Drives Outputs, Reads Peripheral Data, Starts the Next Transaction. on a Cortex-M Running Bare-Metal, the Handler Executes to Its End Without Being Preempted by Another Handler at the Same Priority Level.

### Step 06: Loop Sleeps When Idle After Dispatching, If the Queue Is Empty, the Event Loop Executes __wfi() (wait for Interrupt on Cortex-M). the Cpu Halts Its Clock, Drawing Only Standby Current, and Wakes Automatically When the Next Interrupt Fires. This Is Crucial for Battery-Powered Devices.

### Step 07: Software Events and Timers Post Into the Same Queue Software Timers Managed in a Tick Isr Can Post Events Like Timer_1sec_expired When Their Countdown Reaches Zero. One Module Can Post an Event to Be Processed by Another Module, Enabling Asynchronous Intra-Firmware Communication Without Direct Function Calls That Create Coupling.

## Under the Hood

On an ARM Cortex-M processor, the interrupt architecture is inseparable from event-driven design. The NVIC supports up to 240 external interrupts with configurable priorities. When an interrupt fires, the CPU performs EXCEPTION ENTRY: it pushes a stack frame of eight registers onto the Process Stack, sets the IPSR register with the exception number, and reads the vector table address from VTOR + (exception_number * 4) to get the handler address. This entire sequence takes 12 clock cycles on a Cortex-M4 with no bus wait states. On return, writing a special EXC_RETURN value to the PC triggers exception exit, which pops the stack frame and returns to the interrupted context. This hardware-level discipline is why ISR entry and exit latency is deterministic and bounded.

The critical section protecting the event queue is implemented differently depending on the MCU. On Cortex-M, the standard approach uses __disable_irq() (which writes to the PRIMASK register, masking all maskable interrupts) around the queue access. A more refined approach uses __set_BASEPRI() to mask only interrupts below a certain priority level. On AVR (ATmega328P, ATmega2560), the equivalent is saving the SREG register, clearing the global interrupt flag with CLI, performing the operation, and restoring SREG with SEI. The key invariant is that the critical section must be as short as possible, and must never contain blocking calls.

Memory layout matters in event-driven firmware. On a typical STM32F4 with 192 KB SRAM, a ring buffer of 32 events at 8 bytes per event consumes 256 bytes. The concern is not size but ALIGNMENT and CACHE COHERENCY. On Cortex-M7 (STM32H7 series), which has a D-Cache, event struct members written by an ISR and read by the event loop may be cached inconsistently. The correct approach is to either mark the queue memory as non-cacheable in the MPU configuration or use explicit cache flush/invalidate operations around queue accesses. This is a class of bugs that does not exist on simpler Cortex-M0/M3/M4 devices and catches engineers upgrading to higher-performance parts.

Software timers in a bare-metal event-driven system are typically built on a hardware timer peripheral configured to generate a periodic interrupt (the system tick). Inside the tick ISR, the firmware decrements all active software timer counters. When a counter reaches zero, the ISR posts a timer-expired event to the queue. This decouples the timer interrupt from the application logic. The tick ISR itself should take no more than a few microseconds even with 20 active software timers. One hardware timer supports arbitrarily many software timers with no additional hardware cost.

The WFI instruction interacts with the event queue in a subtle but important way. The correct idle sequence is: check queue, if empty call WFI, on wake check queue again. The Cortex-M architecture guarantees that if a pending interrupt exists when WFI is executed, the instruction completes immediately rather than sleeping. This prevents the race where an interrupt fires and posts to the queue between the empty-check and the WFI. This guarantee is documented in the ARMv7-M Architecture Reference Manual (Section B1.5.17) and is not something to leave to chance.

## Real-World Applications

AUTOMOTIVE: An Electronic Control Unit (ECU) on a CAN bus is a textbook event-driven system. CAN frames arrive asynchronously with tight timing requirements (ISO 11898 requires reception within 2 ms at 500 kbps). The CAN peripheral ISR posts a CAN_FRAME_RECEIVED event with the frame ID and DLC. Modern AUTOSAR-compliant ECUs formalize this pattern: the Basic Software layer generates events and Application Software Components respond via AUTOSAR RTE signals, which are conceptually the same event-dispatch model in a standardized framework.

CONSUMER ELECTRONICS (WEARABLES): A fitness tracker is a case study in power-driven event design. The system spends most of its time with the CPU in deep sleep. An accelerometer interrupt wakes the MCU when movement is detected; a touch controller interrupt wakes it on screen tap; an RTC alarm event wakes it for the hourly step-count sync. The event loop's idle path executes WFI, keeping average current draw under 10 microamps despite supporting multiple active sensors. Polling-based firmware for the same device would consume milliamps continuously.

INDUSTRIAL (MOTOR CONTROL): A variable frequency drive controlling a three-phase induction motor generates a cascade of tightly coupled events: PWM period interrupt posts a CURRENT_SAMPLE_READY event every 50 microseconds, the FOC handler processes it and updates duty cycle values, an encoder interrupt posts POSITION_UPDATE events, and a serial HMI posts SETPOINT_CHANGE events at a much lower rate. NVIC priority assignment enforces that the current-loop handler runs first; the HMI handler can wait.

MEDICAL (INFUSION PUMP): An infusion pump controller must respond to multiple concurrent stimuli: flow sensor pulses, air bubble detection alerts, a keypad for dose entry, and alarms from a pressure sensor. These stimuli have radically different urgency: a bubble alarm must stop the pump within 200 ms; a keypad press can be handled within 100 ms. IEC 62304 safety standards implicitly assume event-driven architectures because they require demonstrating that safety-critical responses occur within a bounded time, which a polling loop cannot easily prove.

IOT (LPWAN SENSOR): An NB-IoT sensor node sending telemetry every 15 minutes spends most of its life powered down. The firmware wakes on an RTC alarm event, reads sensors via I2C using DMA with a DMA-complete event for each transfer, then initiates an NB-IoT transmission using a series of UART command-response events with response timeouts managed as software timer events. After the last acknowledgment event, the firmware posts a self-generated GO_TO_SLEEP event. The entire active window is driven by events; nothing polls.

## Common Mistakes

**Mistake 01** — Doing work inside the ISR WHAT GOES WRONG: The ISR calls a sensor read function, formats a string, or updates a display. This blocks other interrupts of equal or lower priority for the duration, causing missed events and jitter. On a Cortex-M3 at 72 MHz, a 1 ms ISR blocks 72,000 cycles of other work. HOW TO AVOID: ISRs post events. Nothing else. If you find yourself calling a function inside an ISR that is not a queue-post utility or a peripheral flag clear, stop and move that call to a handler.

**Mistake 02** — Forgetting to clear the interrupt flag WHAT GOES WRONG: The ISR returns without clearing the pending flag in the peripheral. The NVIC immediately re-enters the ISR. The firmware appears to lock up in an infinite interrupt re-entry loop. HOW TO AVOID: The first substantive line of any ISR should clear the interrupt pending bit in the peripheral register. For GPIO EXTI on STM32: EXTI->PR1 |= (1 << pin).

**Mistake 03** — Queue overflow silently dropping events WHAT GOES WRONG: The queue is sized at 8 entries. A burst of CAN frames fills it. Subsequent events are silently dropped. Symptoms are intermittent missed commands or dropped sensor readings that are extremely difficult to reproduce in testing. HOW TO AVOID: The queue post function must check for overflow and either assert or set a sticky overflow flag. Size the queue generously (32+ entries costs only a few hundred bytes) and instrument queue high-water marks in development builds.

**Mistake 04** — Blocking inside an event handler WHAT GOES WRONG: A handler calls HAL_Delay(100) or spins waiting for an I2C transfer to complete. The event loop stalls for that duration. All pending events queue up. This is the same problem as a superloop, but hidden inside what looks like an event-driven architecture. HOW TO AVOID: Handlers must be non-blocking. Use DMA for transfers and post a DMA-complete event. Use software timers instead of delays. If you need to sequence multi-step operations, use a state machine driven by events.

**Mistake 05** — Unprotected shared state between ISR and handler WHAT GOES WRONG: A global variable is written by an ISR and read by a handler. On an 8-bit AVR, a 16-bit variable read is not atomic; the ISR can update the high byte between the two 8-bit reads. On Cortex-M, the compiler may cache the value in a register without volatile. HOW TO AVOID: Declare ISR-shared variables volatile. Use critical sections for multi-byte accesses. Prefer passing data through the event struct rather than through globals.

**Mistake 06** — Treating the event type as the entire system state WHAT GOES WRONG: The handler for BUTTON_PRESSED does different things depending on a global mode variable checked with nested ifs. The system state becomes implicit and spread across multiple handlers. HOW TO AVOID: Combine event-driven dispatch with an explicit state machine. The current state plus the event determines the response.

**Mistake 07** — Ignoring the WFI race condition WHAT GOES WRONG: The event loop checks the queue, finds it empty, and an interrupt fires before the WFI instruction executes. The CPU enters WFI and sleeps until the next interrupt. On a system with infrequent interrupts, the already-queued event is delayed by seconds. HOW TO AVOID: On Cortex-M, the architecture guarantees that a pending interrupt prevents WFI from sleeping. If you are using a custom WFI sequence with PRIMASK manipulation, be aware you can break this guarantee.

## Debugging and Troubleshooting

**Symptom:** System appears to stop responding after running for a few minutes.

**Possible Cause:** Event queue overflow. ISR is posting events faster than the event loop processes them. The queue fills; new events are dropped; the system reaches a state where it expects a confirmation event that was dropped and hangs.

**Investigation Method:** Add a queue high-water mark counter and an overflow counter that increments when a post is rejected. Print both via a debug UART on a periodic timer event. If the high-water mark is at or near queue capacity, you have confirmed the cause.

**Resolution:** Increase queue size as a short-term fix. Identify which ISR is generating high event volume by instrumenting each ISR post with a per-type counter. Either reduce the event rate at the source or reduce handler processing time.

**Symptom:** Sporadic data corruption in a variable that is written by an ISR and read in a handler.

**Possible Cause:** Missing volatile qualifier or a non-atomic multi-byte read on an 8-bit MCU.

**Investigation Method:** Inspect the generated assembly for the read site. Check for a single LDR instruction versus two LDRB instructions for a 16-bit read on AVR. Verify the variable is declared volatile. Use a logic analyzer or GPIO toggle to observe whether the ISR fires during the handler read.

**Resolution:** Add volatile. For multi-byte reads on 8-bit MCUs, use a critical section. Long-term: pass the data in the event struct at post time and eliminate the shared variable.

**Symptom:** A specific event handler never runs, even though the triggering condition is confirmed active on a scope.

**Possible Cause:** The interrupt is not enabled in the NVIC, the peripheral interrupt flag is not being cleared (ISR re-enters continuously), or the event type has no entry in the dispatch table.

**Investigation Method:** Set a GPIO toggle at the start of the ISR. Add a toggle at the queue post call. Add a toggle at the dispatch case for the event type. Step through the chain to find where the trace breaks.

**Resolution:** If the ISR does not fire: check NVIC_EnableIRQ call and peripheral interrupt enable bit. If the ISR fires but does not post: check queue capacity. If the event is in the queue but dispatch ignores it: add the case to the switch or function-pointer table.

**Symptom:** System works correctly at slow event rates but fails at high throughput.

**Possible Cause:** Re-entrancy issue in the queue post function. Two ISRs of different priority both call the post function. The higher-priority ISR preempts the lower-priority ISR mid-post, corrupting the queue write index.

**Investigation Method:** Review every ISR that calls the queue post function. Check whether the critical section uses PRIMASK (disables all maskable interrupts) or BASEPRI (only masks below a threshold). ISRs above the BASEPRI threshold can still preempt and corrupt the queue.

**Resolution:** Use PRIMASK-based critical sections around queue operations: save PRIMASK, disable all interrupts, perform the enqueue, restore PRIMASK. The window is very small (a few instructions) so the latency cost is minimal.

## Design Considerations and Best Practices

Keep ISRs under 1 microsecond whenever possible. Clear the flag, post the event, return. No application logic, no function calls except the queue post utility, no loops. The reason: ISRs at the same or lower priority are blocked for the ISR duration. Exceeding 1 microsecond in an ISR on a 72 MHz Cortex-M3 is 72 wasted clock cycles that other interrupts cannot use.

Put data in the event struct at post time, not at handler time. When the ISR fires, it has access to the hardware data right now. That data may change by the time the handler runs. Copy the data into the event struct fields before posting. The handler then works from a snapshot. This eliminates an entire class of race conditions.

Instrument queue utilization from day one. A queue that never overflows in normal testing will overflow at the worst possible moment in the field. Add a high-water mark counter and an overflow counter during development. Set an assertion in development builds that fires if the overflow counter is ever non-zero.

Assign interrupt priorities with response-time requirements in mind. The NVIC priority assignment is not a formality. Map your response-time requirements directly to priority levels. A safety shutdown that must execute within 100 microseconds gets the highest priority. A keypad scan that can wait 50 ms gets the lowest. Document this mapping in a header comment block.

Never call a blocking function from a handler. HAL_Delay, while loops waiting for flags, I2C polling loops: these are all blocking calls. Any one of them in a handler converts your event-driven architecture into a superloop with extra steps. Use DMA and respond to the DMA-complete event. Use software timers instead of delays.

Use a single event queue for a single-core bare-metal system. Resist the temptation to add per-module queues or priority queues before you have validated the need. A single FIFO queue is simple, debuggable, and correct for most bare-metal systems. Reserve per-module queues for RTOS-based active object architectures.

Give event types meaningful, self-documenting names in an enum. EVT_UART1_RX_BYTE_RECEIVED is much harder to misuse than EVT_7. Use an enum for all event types in a shared header with a comment above each entry explaining what triggers it.

Plan for event-driven and state-machine design together from the start. An event-driven architecture answers "how does the system receive and route signals." A state machine answers "what does the system do with a signal depending on its current state." These are complementary, not competing. Design both together rather than bolting one onto the other later.

## Expert Notes

**The Most Common Production Failure Is Not a Software Bug** — it is an incorrect assumption about event arrival rate. Engineers size queues for nominal conditions and test in nominal conditions. Field devices see burst conditions that no one tested. The difference between firmware that ships and firmware that is recalled is whether the engineer designed for the burst rate and overflow case, not just the average rate. Always calculate your peak event rate from hardware specs, not from observation during testing.

VOLATILE IS NOT OPTIONAL, IT IS LOAD-BEARING -- the compiler does not know that an ISR can modify a variable asynchronously. Without volatile, the compiler may load the variable into a register once and never re-read it. This produces bugs that disappear at lower optimization levels and appear at -O2 or -O3. These bugs are invisible in a debugger (which reads memory, not the register the compiler cached the value in). Declare all ISR-shared variables volatile.

**The Event Loop Is Not the Only Place Where Timing Matters** — junior engineers focus on handler latency (how long after an event is posted does the handler run). Experienced engineers also focus on jitter (how much does that latency vary) and worst-case latency (what is the absolute maximum). Safety standards like IEC 61508 require worst-case analysis, not average-case.

**Every Global Variable Shared with an Isr Is a Contract** — when you declare a global that both an ISR and a handler touch, you are making an implicit contract about who owns it, when each party can write it, and how conflicts are resolved. Most production bugs in event-driven bare-metal firmware come from these contracts being implicit rather than documented. Make them explicit with a comment block above the variable.

**The Depth of Your Debug Instrumentation Determines How Fast You Ship** — the event-driven architecture is debuggable only if you build in the instrumentation during development. A circular trace buffer in RAM that records the last 64 event posts with timestamps is an hour of development that saves days of debugging. A queue utilization metric accessible over a debug UART has stopped more production fires than any single other debugging technique.

## Summary

Event-driven design exists because embedded systems live in a reactive world that does not wait for software to be ready to look at it. The polling superloop fails not because it is poorly written, but because it is the wrong model for a world of asynchronous, concurrent, time-critical signals. Event-driven architecture maps firmware structure onto hardware reality: ISRs detect, events carry, the queue buffers, the event loop dispatches, and handlers process. Each concern has a defined place, and each place has defined rules.

The architectural discipline required is not complicated, but it is non-negotiable. ISRs must be minimal. Handlers must be non-blocking. The queue must be protected and instrumented. Data must travel in event structs, not through shared globals. These rules are not style preferences; they are load-bearing constraints. Violating any one of them creates a class of bugs that is intermittent, difficult to reproduce in testing, and catastrophic in the field.

The power of event-driven design scales beyond bare-metal. The active object pattern, RTOS task-based architectures, and real-time middleware like AUTOSAR are all built on the same fundamental model. Understanding event-driven design at the bare-metal level, where every byte of the event queue and every cycle of ISR execution is visible, gives you the foundation to work correctly at every higher level of abstraction.

The mental model to retain is this: your firmware is a RESPONDER, NOT A CONTROLLER. The world generates events. Your system's job is to receive those events promptly and correctly and act on them appropriately. Every architectural decision -- where to put state, how to size the queue, how long handlers should run, how to assign interrupt priorities -- flows from this single model. Keep it concrete: for each piece of the system you design, ask "what event does this respond to, what work does it do, and what event does it generate next?" If you can answer those three questions for every module, your architecture is sound.

## Related Topics

Prerequisites: - Interrupts and the NVIC - Bare-Metal Architecture - C Memory Model for Embedded - Ring Buffer Implementation

Next Topics: - State Machines in Embedded C - RTOS Fundamentals - Active Object Pattern - DMA-Driven Peripherals
