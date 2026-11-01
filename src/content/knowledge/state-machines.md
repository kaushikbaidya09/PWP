---
title: "State Machines: Organising Firmware Behaviour Into Clear Steps"
brief: "Modelling firmware behaviour as explicit states, events and transitions, and implementing table-driven state machines in C."
order: 7
phase: 2
tags: ["FSM", "State Machine", "UML", "Transitions"]
---

You are three weeks into a project. The firmware compiles, the hardware is on your bench, and everything works fine during basic testing.

This is what happens when firmware grows without a disciplined model for managing behavior over time. Single-threaded code executing a sequence of instructions is easy to reason about.

## The Fundamental Problem

The naive approach to embedded behavior control is the flag-and-if-else architecture. You declare a handful of boolean or integer variables at file scope, set and clear them from ISRs and function calls, and then check them in your main loop to decide what to do.

The deeper problem is that flags encode history implicitly. When you look at a snapshot of your flag variables, you cannot easily tell HOW the system arrived at that combination.

## The Big Picture

![Animated state machine moving between Idle, Connecting, Connected and Error](/diagrams/state_machine.svg)

A finite state machine is a computational model that consists of a finite set of states, a set of events (also called inputs or triggers), and a set of transitions that define which state to move to when a given event occurs in a given state. At any moment, the system is in EXACTLY ONE state.

At the firmware architecture level, the state machine sits between your hardware abstraction layer and your application logic. Drivers and ISRs detect raw events and post them into an event queue.

## Key Concepts and Terminology

**State** — A distinct, stable condition that the system can occupy.

**Event** — Something that happens that the state machine needs to respond to.

**Transition** — The act of moving from one state to another in response to an event.

**Action** — Code that executes in response to an event or state change.

**Guard Condition** — An additional boolean check that must be true for a transition to fire, even if the triggering event has occurred.

**Hierarchical State Machine (hsm)** — An extension of the basic FSM where states can contain other states.

## How It Works

### Step 1: Enumerate your states

Start by listing every distinct behavioral mode your system can be in. A good heuristic: if the system should respond differently to the same input in two situations, those are two different states.

### Step 2: Enumerate your events

List every external or internal trigger that can change behavior. Every interrupt source is a candidate event.

### Step 3: Build the transition table

For every combination of (current state, event), decide: does this transition fire? If yes, what is the next state?

### Step 4: Implement the dispatch mechanism

The core of the implementation is a dispatch function that takes the current event and executes the correct transition. In C, the two dominant patterns are the TABLE-DRIVEN approach (a 2D array indexed by state and event, each cell containing a function pointer and next-state value) and the SWITCH-CASE approach (nested switch on state, then switch on event).

### Step 5: Implement entry and exit actions

When a transition fires and the next state differs from the current state, execute the exit action of the current state, update the current state variable, then execute the entry action of the new state. This ordering is critical.

### Step 6: Integrate the event queue

In a real system, events arrive from ISRs at arbitrary times. You cannot run the state machine dispatcher directly from an ISR; that breaks run-to-completion and can cause priority inversion.

### Step 7: Validate with your transition table

Once implemented, walk through every row of your transition table and verify the code matches. This is your formal specification.

## Under the Hood

On a Cortex-M device, the state machine's current state is typically a single enum variable in RAM. The enum maps to integer values, which the compiler uses as indices or switch cases.

The event queue deserves careful implementation on bare-metal systems. On Cortex-M3 and later, you can use the LDREX/STREX exclusive access instructions (or the __LDREXB/__STREXB intrinsics in CMSIS) to implement a lock-free single-producer/single-consumer ring buffer.

## Real-World Applications

AUTOMOTIVE: Engine control units use layered HSMs to manage fuel injection state. The outermost states are CRANKING, RUNNING, and SHUTDOWN.

**Consumer electronics.** A Bluetooth LE peripheral (say, a fitness tracker on a Nordic nRF52) manages its radio state with an FSM: ADVERTISING, CONNECTING, CONNECTED_IDLE, CONNECTED_NOTIFYING, DISCONNECTING. The SoftDevice (Nordic's RF stack) posts connection events and disconnect events.

## Common Mistakes

**Encoding History in State Names** — Engineers create states like WAITING_AFTER_ERROR and WAITING_AFTER_INIT instead of a single WAITING state with context stored in an extended state variable. This leads to state explosion: the machine grows to 50 states when 15 would cover the same behavior. Avoid it by asking whether two states respond identically to all events.

**Processing events directly in ISRs.** Calling the state machine dispatcher from inside an interrupt handler breaks run-to-completion. If a higher-priority interrupt fires mid-dispatch, you can re-enter the state machine with an inconsistent state variable. Always post to a queue from ISRs and dispatch from a non-interrupt context.

**Missing the Default (unhandled Event) Case** — A switch-case FSM without a default clause silently ignores events in states where they are not handled. This is often correct behavior, but the silence hides bugs. Add an explicit default that either does nothing (with a comment) or calls an assert/log function.

## Debugging and Troubleshooting

**Symptom:** System appears stuck in one state and stops responding to inputs.

**Possible Cause:** Event queue is full and new events are being dropped, OR an entry action is blocking indefinitely, OR a critical section is left locked preventing ISRs from posting events.

**Investigation Method:** Add a state-change log (a ring buffer in RAM of the last N state transitions) and inspect it under a debugger.

**Resolution:** Fix the blocking call in the entry action, increase queue depth if the rate of events is legitimately high, or find and fix the missed critical-section exit (use RAII-style wrappers or a consistent lock/unlock pattern).

**Symptom:** Random transitions to an unexpected state under load or after long runtime.

**Possible Cause:** Stack overflow corrupting the state variable in RAM, OR a race condition where an ISR modifies the state variable directly without going through the queue.

**Investigation Method:** On Cortex-M, enable the MPU and stack limit registers.

**Resolution:** Increase stack size, refactor ISRs to post events only, and make the state variable static with a single-writer policy enforced by code review.

## Design Considerations and Best Practices

**Draw the State Diagram Before Writing Code** — A state machine that you cannot draw is one you do not understand. Use a whiteboard, a UML tool, or even a text-based tool like PlantUML.

**Keep the Number of States Manageable** — If a single FSM exceeds 15-20 states, consider whether it should be two FSMs or whether you should promote to an HSM. Flat FSMs with 40+ states produce transition tables with hundreds of cells, most of which are empty, and which no one person can hold in their head.

## Expert Notes

**The Current State Is Not Enough Information** — Junior engineers often think the state variable alone defines system behavior. It does not.

**The Most Dangerous Transition Is the One You Did Not Write** — Unhandled events in unspecified (state, event) pairs are not automatically safe. In some operating conditions, an event you never expected can arrive in a state you never expected.

## Summary

A state machine is the formalization of a truth that experienced engineers discover empirically: in any non-trivial embedded system, behavior is always conditional on history, and that history must be managed explicitly or it will manage you. The finite state machine gives you a closed vocabulary for describing that history: a finite set of states, a finite set of events, and a complete, auditable table of transitions between them. Every behavior is visible.

The implementation patterns are not exotic. A well-structured C FSM on an STM32 or AVR amounts to an enum for states, an enum for events, a transition table (array of structs or a switch block), a small event queue, and a dispatcher that runs in your main loop. The complexity budget is small.

## Related Topics

**Prerequisites**

- Event-Driven Systems (understanding event queues, ISR-to-task communication, deferred processing)
- C Pitfalls in Embedded (enum, function pointers, static variables, const correctness)
- Concurrency and Synchronization (critical sections, ISR constraints, atomicity)
- Bare-Metal Architecture (ARM Cortex-M register model, NVIC, SysTick)

**Next Topics**

- Firmware Architecture Patterns (layered architecture, HAL design, module boundaries, dependency management)
- RTOS Fundamentals (tasks, queues, semaphores, and how FSMs integrate with an RTOS scheduler)
- Unit Testing Firmware (Ceedling, Unity, CMock, testing FSMs without hardware)
