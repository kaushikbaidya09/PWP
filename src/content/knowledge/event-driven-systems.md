---
title: "Event-Driven Systems: Reacting to Events Instead of Polling"
brief: "Designing firmware around events and queues instead of polling, so the CPU sleeps until something actually happens."
order: 6
phase: 2
tags: ["Events", "Callbacks", "Non-blocking"]
---

Imagine you are writing firmware for a battery-powered sensor node. The node reads a temperature sensor every 10 seconds, blinks an LED on a valid reading, and transmits over UART when a threshold is crossed.

This is not a bug. It is an architectural failure, and it happens because the engineer used the wrong mental model for the job.

## The Fundamental Problem

The naive approach to embedded firmware is the SUPERLOOP: a while(1) that checks every input in sequence and takes action when a condition is true. This pattern feels natural because it mirrors how humans think through a checklist.

The deeper issue is that the superloop conflates DETECTION with RESPONSE. The loop detects nothing; it just finds conditions that are already true when it happens to look.

## The Big Picture

![Event-Driven Architecture Pipeline](/diagrams/event_pipeline.svg)

At the highest level, an event-driven system is a pipeline with three stages: GENERATION, QUEUING, and DISPATCH. Hardware peripherals and software timers generate events when something happens.

This pipeline decouples the timing of detection from the timing of processing. The ISR does not care what the main loop is doing; it posts and returns.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Event** | A discrete, timestamped signal that something happened. |
| **Trigger** | The hardware or software source that causes an event to be generated. |
| **Reactive System** | A system that is structurally organized to respond to stimuli from its environment rather than to execute a predetermined sequence. |
| **Event Loop** | The top-level control structure of an event-driven bare-metal system. |
| **Dispatch** | The mechanism that routes an event to its handler. |
| **Event Queue** | A FIFO data structure, typically a ring buffer, that holds events between the time they are generated (in ISR context) and the time they are consumed (in the event loop). |

## How It Works

### Step 01: Hardware triggers an interrupt

A peripheral detects a physical event: a GPIO pin transitions, a timer overflows, a UART receive data register fills. The peripheral asserts its interrupt line to the NVIC.

### Step 02: ISR posts an event and returns

The ISR clears the interrupt pending flag in the peripheral. It then constructs a minimal event struct with the type and any essential payload, and posts it to the event queue using a function that briefly disables interrupts to protect the shared queue state.

### Step 03: Event sits in the queue

The event queue is a ring buffer with a write index managed by ISR context and a read index managed by the event loop. The event waits in the queue until the event loop gets to it.

### Step 04: Event loop dequeues and dispatches

The event loop in main() polls the queue. When an event is available, it dequeues it with a critical section.

### Step 05: Handler executes to completion

The handler for the event type runs all the application logic for that event: updates state variables, drives outputs, reads peripheral data, starts the next transaction. On a Cortex-M running bare-metal, the handler executes to its end without being preempted by another handler at the same priority level.

### Step 06: Loop sleeps when idle

After dispatching, if the queue is empty, the event loop executes __WFI() (Wait For Interrupt on Cortex-M). The CPU halts its clock, drawing only standby current, and wakes automatically when the next interrupt fires.

### Step 07: Software events and timers post into the same queue

Software timers managed in a tick ISR can post events like TIMER_1SEC_EXPIRED when their countdown reaches zero. One module can post an event to be processed by another module, enabling asynchronous intra-firmware communication without direct function calls that create coupling.

## Under the Hood

On an ARM Cortex-M processor, the interrupt architecture is inseparable from event-driven design. The NVIC supports up to 240 external interrupts with configurable priorities.

The critical section protecting the event queue is implemented differently depending on the MCU. On Cortex-M, the standard approach uses __disable_irq() (which writes to the PRIMASK register, masking all maskable interrupts) around the queue access.

## Real-World Applications

AUTOMOTIVE: An Electronic Control Unit (ECU) on a CAN bus is a textbook event-driven system. CAN frames arrive asynchronously with tight timing requirements (ISO 11898 requires reception within 2 ms at 500 kbps).

**Consumer electronics (WEARABLES).** A fitness tracker is a case study in power-driven event design. The system spends most of its time with the CPU in deep sleep.

## Common Mistakes

**Mistake 01** — Doing work inside the ISR WHAT GOES WRONG: The ISR calls a sensor read function, formats a string, or updates a display. This blocks other interrupts of equal or lower priority for the duration, causing missed events and jitter. On a Cortex-M3 at 72 MHz, a 1 ms ISR blocks 72,000 cycles of other work.

**Mistake 02** — Forgetting to clear the interrupt flag WHAT GOES WRONG: The ISR returns without clearing the pending flag in the peripheral. The NVIC immediately re-enters the ISR. The firmware appears to lock up in an infinite interrupt re-entry loop.

**Mistake 03** — Queue overflow silently dropping events WHAT GOES WRONG: The queue is sized at 8 entries. A burst of CAN frames fills it. Subsequent events are silently dropped.

## Debugging and Troubleshooting

**Symptom:** System appears to stop responding after running for a few minutes.

**Possible Cause:** Event queue overflow.

**Investigation Method:** Add a queue high-water mark counter and an overflow counter that increments when a post is rejected.

**Resolution:** Increase queue size as a short-term fix.

**Symptom:** Sporadic data corruption in a variable that is written by an ISR and read in a handler.

**Possible Cause:** Missing volatile qualifier or a non-atomic multi-byte read on an 8-bit MCU.

**Investigation Method:** Inspect the generated assembly for the read site.

**Resolution:** Add volatile.

## Design Considerations and Best Practices

Keep ISRs under 1 microsecond whenever possible. Clear the flag, post the event, return.

Put data in the event struct at post time, not at handler time. When the ISR fires, it has access to the hardware data right now.

## Expert Notes

**The Most Common Production Failure Is Not a Software Bug** — it is an incorrect assumption about event arrival rate. Engineers size queues for nominal conditions and test in nominal conditions.

**Volatile is not optional, it is LOAD-BEARING.** the compiler does not know that an ISR can modify a variable asynchronously. Without volatile, the compiler may load the variable into a register once and never re-read it.

## Summary

Event-driven design exists because embedded systems live in a reactive world that does not wait for software to be ready to look at it. The polling superloop fails not because it is poorly written, but because it is the wrong model for a world of asynchronous, concurrent, time-critical signals. Event-driven architecture maps firmware structure onto hardware reality: ISRs detect, events carry, the queue buffers, the event loop dispatches, and handlers process.

The architectural discipline required is not complicated, but it is non-negotiable. ISRs must be minimal. Handlers must be non-blocking.

## Related Topics

**Prerequisites**

- Interrupts
- Bare-Metal Architecture
- C Pitfalls in Embedded

**Next Topics**

- State Machines
- RTOS Fundamentals
- DMA
