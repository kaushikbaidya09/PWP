---
id: state-machines
tags: ['FSM', 'State Machine', 'UML', 'Transitions']
---

# State Machines: The Most Important Embedded Design Pattern

You are three weeks into a project. The firmware compiles, the hardware is on your bench, and everything works fine during basic testing. Then your manager hands you a bug report: the device locks up when the user presses a button during a network reconnect attempt. You dig in. You find the problem buried inside a function that is 400 lines long, stuffed with nested if-else blocks and boolean flags named things like "is_ready_but_waiting" and "done_but_not_really." You fix that bug. Two days later, another one surfaces. You fix that one too. A month passes and you are still playing whack-a-mole with behavior that seems to change depending on the order things happen. The product ships late. Customer complaints come in about edge cases nobody tested. Sound familiar?

This is what happens when firmware grows without a disciplined model for managing behavior over time. Single-threaded code executing a sequence of instructions is easy to reason about. But real products do not work that way. A motor controller has to respond to a fault while it is mid-ramp. A medical device has to ignore a button press during a calibration sequence. A wireless sensor has to queue a reading while the radio is busy. These are all STATE-DEPENDENT behaviors: what the system should do depends not just on the current input, but on what it was already doing. This is exactly the problem that state machines solve.

State machines are not an academic abstraction. They are a practical engineering tool that has been used in embedded firmware since the earliest microcontrollers. They give you a formal way to describe every condition your system can be in, every event that can occur, and exactly what should happen as a result. They make behavior explicit rather than implicit. They eliminate the class of bug where your system ends up in a combination of flag states that you never anticipated.

By the end of this article, you will understand what a finite state machine is and why it belongs at the center of your firmware architecture. You will understand how to identify states, events, and transitions in a real system. You will know how to implement an FSM in C on bare-metal MCUs. You will recognize the common mistakes that turn a clean state machine design into the same mess you were trying to escape. And you will have a mental model that makes the next firmware project you take on fundamentally easier to reason about.

## The Fundamental Problem

The naive approach to embedded behavior control is the flag-and-if-else architecture. You declare a handful of boolean or integer variables at file scope, set and clear them from ISRs and function calls, and then check them in your main loop to decide what to do. This approach feels natural because it maps directly onto how you might describe the system verbally: "if the button is pressed AND the system is initialized AND we are not currently in an error state, then start the motor." The problem is that this description already contains three implicit state variables, and any system of real complexity will have ten or twenty of them. The number of possible combinations grows exponentially. For ten boolean flags, you have 1024 possible states. You will only ever think carefully about perhaps a dozen of them. The rest are undefined behavior waiting to happen.

The deeper problem is that flags encode history implicitly. When you look at a snapshot of your flag variables, you cannot easily tell HOW the system arrived at that combination. Was the error flag set because of a timeout? A hardware fault? A failed CRC? Different origins might require different recovery paths, but a single boolean cannot express that distinction. Engineers respond to this by adding more flags, which creates more combinations, which creates more bugs. The codebase becomes a machine that only its original author can navigate, and even then only on a good day.

Event ordering is the final nail. Embedded systems are asynchronous. Interrupts fire at unpredictable times. Communication packets arrive while other processing is happening. A debounced button press completes while the system is mid-state. The flag-and-if-else model has no concept of event ordering. Events collapse into whatever state the flags happen to be in at the moment they are processed. Rare orderings produce corner cases that only appear in the field, under specific timing conditions, on a customer's production board. A state machine does not eliminate asynchrony, but it gives you a structured way to define WHICH events are valid in WHICH conditions, and what to safely ignore or defer when they are not.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/state_machine.svg" alt="State Machine Diagram — UART Packet Handler" loading="lazy">
</div>

A finite state machine is a computational model that consists of a finite set of states, a set of events (also called inputs or triggers), and a set of transitions that define which state to move to when a given event occurs in a given state. At any moment, the system is in EXACTLY ONE state. When an event occurs, the machine consults its transition table, executes any associated actions, and moves to the next state. The system cannot be in two states simultaneously, and it cannot be in an undefined state. This is the guarantee that makes FSMs powerful.

At the firmware architecture level, the state machine sits between your hardware abstraction layer and your application logic. Drivers and ISRs detect raw events and post them into an event queue. The state machine consumes those events, updates its current state, and triggers outputs through the HAL. Business logic lives inside the state machine rather than scattered across callbacks and interrupt handlers. The result is a system where all behavior is traceable: given any event and any current state, you can point to exactly one row in your transition table and say "this is what happens."

Below is a simplified architectural view of where the FSM sits:

```
+---------------------+       +---------------------+
| HARDWARE / ISRs     |       | PERIPHERAL DRIVERS  |
| (GPIO, UART, Timer) |       | (SPI, I2C, ADC)     |
+----------+----------+       +----------+----------+
           |                             |
           |   raw events / callbacks    |
           +---------------+-------------+
                           |
                  +--------v--------+
                  |   EVENT QUEUE   |
                  |  (ring buffer   |
                  |   or flags)     |
                  +--------+--------+
                           |
                  +--------v--------+
                  |  STATE MACHINE  | <--- current state variable
                  |   DISPATCHER   |       transition table
                  |                 |       entry/exit actions
                  +--------+--------+
                           |
           +---------------+-------------+
           |                             |
+----------v----------+       +----------v----------+
|   OUTPUT ACTIONS    |       | APPLICATION LOGIC   |
| (HAL, actuators,    |       | (business rules,    |
|  display updates)   |       |  data processing)   |
+---------------------+       +---------------------+
```

## Key Concepts and Terminology

**State** — A distinct, stable condition that the system can occupy. A state represents a period of time during which the system exhibits a specific behavior and responds to events in a specific way. States are not momentary; they persist until an event causes a transition. On an STM32 running a motor controller, IDLE, RAMPING_UP, RUNNING, FAULT, and CALIBRATING are all states.

**Event** — Something that happens that the state machine needs to respond to. Events are instantaneous; they have no duration. An event can come from a GPIO interrupt, a timer expiry, a received UART byte, a computed result, or a software trigger. Events should be named from the system's perspective, not the hardware's: BUTTON_PRESSED is better than GPIO_PA0_FALLING_EDGE.

**Transition** — The act of moving from one state to another in response to an event. A transition is defined by three things: the SOURCE state, the TRIGGER event, and the DESTINATION state. Transitions may also have associated actions that execute at the moment of transition. A transition table (or state table) is a complete enumeration of all valid source-event-destination combinations.

**Action** — Code that executes in response to an event or state change. Actions come in three flavors: ENTRY actions run once when a state is entered, EXIT actions run once when a state is left, and TRANSITION actions run during a specific transition. Separating actions into these categories prevents duplicated initialization code and makes cleanup reliable.

**Guard Condition** — An additional boolean check that must be true for a transition to fire, even if the triggering event has occurred. Guards let you share event types across multiple transitions and choose between them based on runtime conditions. For example, a TIMEOUT event might transition to RETRY if the retry count is below maximum, or to FAULT if it is not.

**Hierarchical State Machine (hsm)** — An extension of the basic FSM where states can contain other states. A parent state defines behavior that applies to all its children, allowing states to inherit transitions. HSMs dramatically reduce the size of transition tables for complex systems. The UML statechart formalism is the standard reference for HSMs in embedded work.

**Run-to-Completion (rtc)** — The execution model where a state machine processes one event completely before accepting the next. This means all entry/exit/transition actions for one event have finished before the next event is dispatched. RTC is the foundation of deterministic FSM behavior and is essential for avoiding reentrancy bugs in single-threaded or cooperative systems.

**Event Queue** — A data structure (often a ring buffer or small array) that buffers events between their source (an ISR, a timer callback) and the state machine dispatcher. The queue decouples event generation from event processing and enables the run-to-completion model even when events arrive asynchronously.

MEALY vs. MOORE - Two formal FSM classifications. In a MOORE machine, outputs depend only on the current state (entry/exit actions). In a MEALY machine, outputs depend on both the current state and the triggering event (transition actions). Most practical embedded FSMs are hybrid: they use both state-dependent and transition-dependent actions.

**Extended State Machine** — An FSM augmented with variables (sometimes called "extended state variables") that store information which does not need its own full state. A retry counter is a canonical example: rather than creating states RETRY_1, RETRY_2, RETRY_3, you have one RETRYING state and an integer variable. Guard conditions on the transition use the variable to differentiate behavior.

## How It Works

STEP 1: ENUMERATE YOUR STATES

Start by listing every distinct behavioral mode your system can be in. A good heuristic: if the system should respond differently to the same input in two situations, those are two different states. Do not over-enumerate; CONNECTING_ATTEMPT_3 is almost certainly not a state. CONNECTING with a retry count variable is. For a UART protocol handler on an AVR ATmega, your states might be: IDLE, RECEIVING_HEADER, RECEIVING_PAYLOAD, PROCESSING, TRANSMITTING, ERROR.

STEP 2: ENUMERATE YOUR EVENTS

List every external or internal trigger that can change behavior. Every interrupt source is a candidate event. Every timeout is a candidate event. Every computed threshold crossing is a candidate event. Be specific: do not use a generic DATA_RECEIVED event if the meaning differs depending on which peripheral raised it. Name events to reflect what happened, not what caused it.

STEP 3: BUILD THE TRANSITION TABLE

For every combination of (current state, event), decide: does this transition fire? If yes, what is the next state? Is there a guard condition? What action executes? Unspecified combinations are IGNORED TRANSITIONS by default. In safety-critical work, unspecified combinations may instead trigger an error or assert. Build this as a literal table on paper or in a spreadsheet before writing any code.

STEP 4: IMPLEMENT THE DISPATCH MECHANISM

The core of the implementation is a dispatch function that takes the current event and executes the correct transition. In C, the two dominant patterns are the TABLE-DRIVEN approach (a 2D array indexed by state and event, each cell containing a function pointer and next-state value) and the SWITCH-CASE approach (nested switch on state, then switch on event). The table approach scales better for large machines. The switch approach is easier to read for small machines and is preferred by many safety-critical coding standards because control flow is explicit.

STEP 5: IMPLEMENT ENTRY AND EXIT ACTIONS

When a transition fires and the next state differs from the current state, execute the exit action of the current state, update the current state variable, then execute the entry action of the new state. This ordering is critical. Entry actions initialize state-specific resources (start a timer, enable an interrupt, set a pin). Exit actions clean up (stop the timer, disable the interrupt). This pattern ensures that every state is always entered in a known condition, regardless of which transition led to it.

STEP 6: INTEGRATE THE EVENT QUEUE

In a real system, events arrive from ISRs at arbitrary times. You cannot run the state machine dispatcher directly from an ISR; that breaks run-to-completion and can cause priority inversion. Instead, ISRs post events to a queue (a small ring buffer protected by a critical section or using atomic operations on Cortex-M). The main loop or an RTOS task drains the queue and calls the dispatcher for each event.

STEP 7: VALIDATE WITH YOUR TRANSITION TABLE

Once implemented, walk through every row of your transition table and verify the code matches. This is your formal specification. Then write unit tests that inject events and assert expected state transitions. With Unity/CMock on Ceedling, you can test the entire state machine logic without hardware, covering edge cases that are hard to reproduce manually.

## Under the Hood

On a Cortex-M device, the state machine's current state is typically a single enum variable in RAM. The enum maps to integer values, which the compiler uses as indices or switch cases. Modern ARM compilers are excellent at optimizing switch statements over dense integer ranges into jump tables, meaning the dispatch overhead for even a 20-state machine is just a few cycles: a load, a bounds check, and an indirect branch. This is negligible compared to the actions themselves.

The event queue deserves careful implementation on bare-metal systems. On Cortex-M3 and later, you can use the LDREX/STREX exclusive access instructions (or the __LDREXB/__STREXB intrinsics in CMSIS) to implement a lock-free single-producer/single-consumer ring buffer. The ISR writes to the tail, the main loop reads from the head. As long as there is only one producer and one consumer, no critical section is needed and the queue is safe from both contexts. If you have multiple ISRs posting events, you need a critical section (disable/re-enable interrupts with __disable_irq/__enable_irq) around the enqueue operation. Keep it as short as possible.

Entry and exit action function pointers, if you use them, must be stored in a way the linker can resolve. In C, a common pattern is to define a state descriptor struct containing a state ID, a pointer to an entry function, a pointer to an exit function, and a pointer to the event-handler function for that state. An array of these structs is stored in flash. The dispatcher indexes into the array by current state, then calls the handler. This structure maps naturally to what tools like SinelaboreRT generate from a UML statechart model.

Timer management is where many FSM implementations get complicated. States frequently need to time out if no event arrives. The right pattern is to allocate a logical software timer per state that needs one, start it in the entry action, and stop it in the exit action. On STM32, you might use one hardware TIM peripheral to drive a software timer tick, and maintain an array of countdown counters. When a counter expires, the timer module posts a TIMEOUT event to the event queue. The state machine then handles it exactly like any other event. Do NOT poll elapsed time inside the state machine logic; that breaks the event-driven model.

One Cortex-M-specific concern is ISR stack usage. If you call state machine functions from ISRs (which you generally should not, but sometimes you will under resource pressure), those functions execute on the interrupt stack. On many STM32 variants, the default interrupt stack is only 256 to 512 bytes. Complex state machine actions with local arrays or printf-style logging will overflow it silently, corrupting RAM in ways that are very hard to debug. Always profile your worst-case stack depth and set the interrupt stack size deliberately, not by default.

## Real-World Applications

AUTOMOTIVE: Engine control units use layered HSMs to manage fuel injection state. The outermost states are CRANKING, RUNNING, and SHUTDOWN. Nested within RUNNING are sub-states for closed-loop control, open-loop enrichment, deceleration fuel cutoff, and idle speed control. The HSM guarantees that safety-critical shutdown transitions are always reachable from any nested sub-state. AUTOSAR OS and AUTOSAR StateManager are both built around this model.

CONSUMER ELECTRONICS: A Bluetooth LE peripheral (say, a fitness tracker on a Nordic nRF52) manages its radio state with an FSM: ADVERTISING, CONNECTING, CONNECTED_IDLE, CONNECTED_NOTIFYING, DISCONNECTING. The SoftDevice (Nordic's RF stack) posts connection events and disconnect events. The application FSM handles them and drives the display and sensor subsystems accordingly. Getting this right is the difference between a device that reconnects gracefully and one that requires a power cycle.

INDUSTRIAL: A PLC-based conveyor controller uses an FSM for belt segment state: STOPPED, STARTING, RUNNING, FAULT_STOPPING, FAULTED, CLEARING_FAULT. The FAULT_STOPPING state is critical: it ensures the belt decelerates in a controlled way before entering FAULTED, rather than cutting power abruptly. Without this state, a hard stop on a loaded conveyor causes mechanical shock and eventual failure. The state machine makes this deceleration path explicit and mandatory.

MEDICAL: An infusion pump's delivery mechanism FSM must be certified to IEC 62304. States include PRIMING, DELIVERING, OCCLUSION_DETECTED, ALARMING, PAUSED, and STOPPED. The transition table must be included in the design history file, and every transition must be traced to a requirement and a verification test. The formal nature of state machines makes them directly compatible with this regulatory traceability requirement.

AEROSPACE / IOT: A CubeSat power management controller uses an FSM to manage battery charge states (BULK_CHARGE, ABSORPTION, FLOAT, BATTERY_LOW, EMERGENCY_LOAD_SHED) while simultaneously managing payload enable states. On a resource-constrained MCU like an MSP430, the entire state machine fits in a few hundred bytes of flash. The deterministic event-driven behavior is essential because the satellite must operate autonomously for months without human intervention.

## Common Mistakes

**Encoding History in State Names** — Engineers create states like WAITING_AFTER_ERROR and WAITING_AFTER_INIT instead of a single WAITING state with context stored in an extended state variable. This leads to state explosion: the machine grows to 50 states when 15 would cover the same behavior. Avoid it by asking whether two states respond identically to all events. If yes, they are the same state.

PROCESSING EVENTS DIRECTLY IN ISRs - Calling the state machine dispatcher from inside an interrupt handler breaks run-to-completion. If a higher-priority interrupt fires mid-dispatch, you can re-enter the state machine with an inconsistent state variable. Always post to a queue from ISRs and dispatch from a non-interrupt context.

**Missing the Default (unhandled Event) Case** — A switch-case FSM without a default clause silently ignores events in states where they are not handled. This is often correct behavior, but the silence hides bugs. Add an explicit default that either does nothing (with a comment) or calls an assert/log function. In safety-critical code, an unhandled event in a state where none should occur is a defect indicator.

**Forgetting Exit Actions on Self-Transitions** — A self-transition is when an event causes a transition back to the same state. In many implementations, if the source and destination state are the same, the entry and exit actions are skipped as an optimization. This is correct for internal transitions but wrong for self-transitions. A self-transition should reset the state: re-run exit, then re-run entry. Confusing the two causes timers not to restart and initialization not to re-run.

**Putting Business Logic Inside Guard Conditions** — A guard condition should be a cheap boolean test, not a function call that has side effects or takes significant time. Side effects in guards make behavior order-dependent and difficult to test. If your guard is calling HAL functions or modifying shared data, refactor: move the logic into the transition action or into a pre-computed flag.

**Growing the State Machine to Cover Multiple Concerns** — One FSM should represent one behavioral concern. If your motor controller FSM is also handling display updates and BLE advertising state, it will become unmaintainable. Use separate, smaller FSMs for separate concerns and let them communicate through events. Concurrency between them is managed by the event queue, not by merging them into a single machine.

**Using Float or Blocking Calls in Actions** — State machine actions should complete quickly. If an action blocks waiting for a semaphore, sends a synchronous I2C transaction, or does floating-point math inside an ISR-driven context, you will introduce jitter, miss events, and fill your queue. Delegate blocking work to tasks or defer it through additional events.

## Debugging and Troubleshooting

**Symptom:** System appears stuck in one state and stops responding to inputs.

**Possible Cause:** Event queue is full and new events are being dropped, OR an entry action is blocking indefinitely, OR a critical section is left locked preventing ISRs from posting events.

**Investigation Method:** Add a state-change log (a ring buffer in RAM of the last N state transitions) and inspect it under a debugger. Check the queue head/tail indices to see if the queue is full. Add instrumentation to the entry action to confirm it completes.

**Resolution:** Fix the blocking call in the entry action, increase queue depth if the rate of events is legitimately high, or find and fix the missed critical-section exit (use RAII-style wrappers or a consistent lock/unlock pattern).

**Symptom:** Random transitions to an unexpected state under load or after long runtime.

**Possible Cause:** Stack overflow corrupting the state variable in RAM, OR a race condition where an ISR modifies the state variable directly without going through the queue.

**Investigation Method:** On Cortex-M, enable the MPU and stack limit registers. Use the compiler's stack usage report (-fstack-usage in GCC) to find the worst-case frame. Search the codebase for any direct assignment to the state variable outside the dispatcher function.

**Resolution:** Increase stack size, refactor ISRs to post events only, and make the state variable static with a single-writer policy enforced by code review.

**Symptom:** A specific sequence of events causes the system to behave incorrectly, but only that exact sequence.

**Possible Cause:** A transition is missing from the table, causing an event to be silently ignored in a state where it should be handled. The system reaches a state it was never designed to handle correctly.

**Investigation Method:** Reproduce the sequence in a unit test. Print or log every (state, event) pair as it is dispatched. Compare the sequence to the transition table and find the first unhandled combination.

**Resolution:** Add the missing transition explicitly. Decide whether it should be ignored (internal transition to self with no action), handled (a new transition to a defined state), or flagged as an error.

**Symptom:** Timer-based transitions fire at the wrong time or not at all after a retry cycle.

**Possible Cause:** The software timer is not being restarted in the state's entry action, so it inherits the remaining count from the previous visit to the state. Or the timer is not being stopped in the exit action, causing a stale TIMEOUT event to arrive in a later, unrelated state.

**Investigation Method:** Add log output in entry and exit actions for the affected state. Confirm the timer start and stop calls are executing and are symmetric.

**Resolution:** Make timer start/stop strictly paired: always start in entry, always stop in exit. Do not rely on the timer "running out naturally" across state transitions.

## Design Considerations and Best Practices

**Draw the State Diagram Before Writing Code** — A state machine that you cannot draw is one you do not understand. Use a whiteboard, a UML tool, or even a text-based tool like PlantUML. The diagram is the specification. Code is the implementation of the diagram. If you write code first, you are implementing an implicit, undefined specification, and you will rediscover its gaps as bugs.

**Keep the Number of States Manageable** — If a single FSM exceeds 15-20 states, consider whether it should be two FSMs or whether you should promote to an HSM. Flat FSMs with 40+ states produce transition tables with hundreds of cells, most of which are empty, and which no one person can hold in their head.

NAME STATES AS NOUNS OR GERUNDS, EVENTS AS VERB PHRASES - States represent conditions (IDLE, CONNECTING, FAULTED). Events represent occurrences (BUTTON_PRESSED, TIMEOUT_EXPIRED, PACKET_RECEIVED). This naming discipline helps during design: if you find yourself naming a state PROCESS_DATA, it is probably a transition action, not a state.

**Enforce a Single Writer for the State Variable** — The current state variable must only be updated by the state machine dispatcher. No ISR, no callback, no external module should write to it directly. Declare it static at file scope. Provide a getter function if other modules need to read it. This is the single most important invariant in the entire system.

STORE THE TRANSITION TABLE AS DATA, NOT LOGIC - The table-driven approach (an array of structs or a 2D function pointer array) is preferable to a nested switch for machines with more than about 8 states. It separates the machine's topology from its execution, makes the structure inspectable at runtime or by tooling, and is easier to validate against the design document.

**Always Handle the Impossible** — In addition to the defined transitions, add a default handler that logs or asserts on (state, event) pairs that should never occur. In development builds, assert. In production builds, log and transition to a safe recovery state. Silent failure in a safety-relevant product is never acceptable.

**Test the Fsm in Isolation Without Hardware** — The FSM dispatcher, transition table, and action stubs can and should be unit tested on a host machine with no target hardware. Use CMock to stub out the HAL functions that actions call. Drive the FSM with a sequence of events and assert state after each one. This test suite catches the majority of logic bugs before you ever touch a JTAG debugger.

**Version Control Your State Diagram Alongside Your Code** — The diagram and the code must stay in sync. If you use a tool that generates a diagram from source (SinelaboreRT, Yakindu, or a custom Python script), automate the sync. If you draw it manually, check the image into the same repository commit as the code change. A state diagram that is months out of date is worse than no diagram at all.

## Expert Notes

**The Current State Is Not Enough Information** — Junior engineers often think the state variable alone defines system behavior. It does not. The HISTORY of how you arrived at the current state, and the values of extended state variables, complete the picture. When debugging unexpected behavior, print the last five state transitions, not just the current state. A state machine logger (a circular buffer of (event, from_state, to_state, timestamp) entries) is worth adding to every serious firmware project. It is the black box recorder for your logic.

**The Most Dangerous Transition Is the One You Did Not Write** — Unhandled events in unspecified (state, event) pairs are not automatically safe. In some operating conditions, an event you never expected can arrive in a state you never expected. Interrupt sources can be enabled by driver initialization in an order you did not anticipate. Communication protocols can send messages during your startup sequence before you are in a state to handle them. Treat every unhandled pair as a potential defect and audit your table at review time.

**Self-Transitions and Internal Transitions Are Not the Same** — A self-transition fires exit and entry. An internal transition does not. Many engineers implement only internal transitions by habit (because the state does not change, so they skip the exit/entry calls) and then wonder why their timer does not restart when the same event fires twice. Decide deliberately which behavior you want and implement it consistently.

**The Fsm Is Not Free Rtos** — When engineers first learn FSMs, they sometimes try to use them as a substitute for concurrency. They create states like WAITING_FOR_SPI_COMPLETE that hold the machine in limbo while a transaction finishes. This defeats the purpose. The FSM should dispatch an event when the SPI transaction completes (via a DMA interrupt), not poll. If you find yourself asking "how do I wait inside a state," the answer is almost always: post an event when the wait condition is satisfied, and let the machine transition then.

**Hierarchical Extensions Pay Off at Around 12 States** — The overhead of implementing an HSM is real: you need parent-state resolution logic, which adds complexity to the dispatcher. Below about 12 states, a flat FSM is simpler. Above that threshold, the reduction in transition table entries and the ability to handle "universal" events (like a GLOBAL_SHUTDOWN) at the parent level starts to outweigh the dispatcher complexity. Knowing this threshold helps you decide which tool to reach for.

**Misra C and Fsm Patterns Are Compatible** — A common concern is that function pointer tables (used in table-driven FSMs) violate MISRA C rules about pointer conversions and indirect calls. In MISRA C:2025, function pointers are permitted under specific constraints. The key is to ensure all function pointers in the table have the SAME signature, that the table is declared const (stored in flash, not RAM), and that index bounds are checked before dereferencing. A well-designed table-driven FSM can be fully MISRA-compliant with discipline.

## Summary

A state machine is the formalization of a truth that experienced engineers discover empirically: in any non-trivial embedded system, behavior is always conditional on history, and that history must be managed explicitly or it will manage you. The finite state machine gives you a closed vocabulary for describing that history: a finite set of states, a finite set of events, and a complete, auditable table of transitions between them. Every behavior is visible. Every edge case is handled by design or explicitly flagged as an error.

The implementation patterns are not exotic. A well-structured C FSM on an STM32 or AVR amounts to an enum for states, an enum for events, a transition table (array of structs or a switch block), a small event queue, and a dispatcher that runs in your main loop. The complexity budget is small. The payoff is enormous: code that can be read by someone who was not there when it was written, debugged with a state log instead of guesswork, and tested in isolation on a laptop before a board is spun.

The discipline of drawing the state diagram first is not optional for serious work. The diagram is the design. The code is the implementation of the design. If they diverge, the diagram must win, because the diagram is what was reviewed, what is traced to requirements, and what the next engineer will use to understand the system. Keep them synchronized with the same rigor you apply to version-controlling your source.

The mental model to retain is this: your firmware is always in a state. If you did not choose what that state is, the compiler and the runtime did it for you, and they did not read the requirements document. State machines are how you take that choice back and make it deliberate.

## Related Topics

Prerequisites: - Event-Driven Systems (understanding event queues, ISR-to-task communication, deferred processing) - C Programming for Embedded Systems (enum, function pointers, static variables, const correctness) - Interrupt Handling and Concurrency Basics (critical sections, ISR constraints, atomicity) - Bare-Metal MCU Architecture (ARM Cortex-M register model, NVIC, SysTick)

Next Topics: - Firmware Architecture Patterns (layered architecture, HAL design, module boundaries, dependency management) - RTOS Fundamentals (tasks, queues, semaphores, and how FSMs integrate with an RTOS scheduler) - Hierarchical State Machines and UML Statecharts (HSM dispatcher implementation, history pseudo-states, orthogonal regions) - Model-Based Design and Code Generation (SinelaboreRT, Yakindu, using the model as source of truth) - Unit Testing Embedded Firmware (Ceedling, Unity, CMock, testing FSMs without hardware)
