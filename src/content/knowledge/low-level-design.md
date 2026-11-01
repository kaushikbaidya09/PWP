---
title: "Low-Level Design: Planning Before You Code"
brief: "How to write a useful low-level design: interfaces, states, data flow and failure handling, and how design reviews save time."
order: 63
phase: 10
tags: ["Low-Level Design", "LLD", "Interfaces", "Design Review", "Architecture"]
---

The fastest way to write a driver seems to be to start typing. Weeks later, the interface does not fit, two tasks fight over one buffer, and nobody thought about what happens when the sensor fails. A short design written first catches those problems when changing them costs one edit, not a rewrite.

## The Fundamental Problem

Code shows what a system does, not why. Big decisions get made by accident while typing, and reviewers see them only when the code is finished, when change is expensive. Without a shared plan, modules connect in ways nobody intended, and error handling becomes an afterthought.

## The Big Picture

![Requirements lead to a design, which is reviewed before code is written](/diagrams/lld_flow.svg)

### In Plain Terms

You would not build a house by laying bricks and seeing how it goes. An architect's overall plan shows the rooms. A detailed plan shows where each pipe and wire runs, so that the plumber and the electrician do not collide.

High-level design is the overall plan. Low-level design is the detailed plan for one module: what it does, how others use it, and what happens when things go wrong. It should be short enough that someone will actually read it.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **HLD** | High-level design: major components and how they connect. |
| **LLD** | Low-level design: the inside of one module. |
| **Interface** | The functions and data other modules use. |
| **Encapsulation** | Hiding internals behind an interface. |
| **Sequence diagram** | Shows message order between components. |
| **State machine** | Defines states and transitions. |
| **Design review** | Others check the plan before coding. |

## How It Works

### Step 1: State the purpose

Say what the module does, and what it does not.

### Step 2: Define the interface

Write the header first. How will others use it?

### Step 3: Describe behaviour

Use a state diagram or sequence diagram for flow.

### Step 4: Plan the resources

Note threads, memory, buffers, locks and timing limits.

### Step 5: List failure cases

For every external call, ask what happens if it fails.

### Step 6: Review

Have someone else challenge it.

## A Closer Look: Why Interfaces Matter Most

If you write down only one thing in a design, make it the interface. Here is why.

An interface is a promise to the rest of the system. Everything behind it can change freely. Everything in front of it depends on it. So a poor interface spreads through the code, while poor internals stay in one file.

Compare two versions of a sensor module:

```c
/* Exposes internals */
extern uint8_t sensor_buf[64];
extern int sensor_state;

/* Hides them */
int sensor_read(float *celsius);
```

In the first, callers read a buffer and a state variable directly. If you later change the buffer format, every caller breaks. In the second, callers know only what they need, and you can rewrite the inside tomorrow.

A good test is to ask: could someone use this without knowing how it works inside? Then ask the awkward questions: what does it return on failure? Which thread may call it? Who owns the memory? Answering these takes minutes, and saves weeks of integration.

## A Worked Example: A Connection Failover Module

Say you need a module that switches a device from Ethernet to Bluetooth when the network fails. A one-page LLD might say:

**Purpose.** Keep exactly one active link, and report changes.

**Interface.**

```c
int  link_mgr_init(const link_cfg_t *cfg);
int  link_mgr_send(const uint8_t *data, size_t len);
void link_mgr_on_change(link_cb_t cb);
```

**States.** `ETH_ACTIVE`, `SWITCHING`, `BT_ACTIVE`, `OFFLINE`.

**Threading.** One owner thread. Other threads post events to a queue, so no locks are needed around the state.

**Failure handling.** What if data arrives while `SWITCHING`? It is queued, with a limit of 32 messages, and the oldest is dropped. What if both links fail? Go to `OFFLINE`, and retry with backoff.

**Open question.** Should we drop back to Ethernet immediately or wait? A reviewer points out that a flapping cable would cause constant switching, so the design adds a 30-second stability timer.

That single insight took one minute in review. In code, it might have surfaced as a field bug months later.

## Common Questions

**How long should an LLD be?** One or two pages for most modules.

**When is it not needed?** For small and obvious changes. Scale the effort to the risk.

**Is this the same as documentation?** It comes before the code and explains intent. It also serves as documentation afterwards.

**Should diagrams be formal?** A clear sketch is often enough. PlantUML keeps them in version control.

## Under the Hood

Good interfaces hide decisions. If callers know about your buffer format, you can never change it. An opaque handle keeps those internals private:

```c
typedef struct link_mgr link_mgr_t;   /* defined only in the .c file */
```

Ownership should be clear: who allocates a buffer, who frees it, and on which thread is a callback called? Most integration bugs come from these unstated assumptions.

Estimating resources matters on small systems. Stack size, peak RAM and worst-case timing can be estimated at design time, and checked later.

## Real-World Applications

**Team projects.** An agreed interface lets people work in parallel.

**Safety development.** ISO 26262 requires documented software unit design.

**Onboarding.** New engineers learn from a design faster than from code.

**Code reviews.** Reviewers can compare code with its stated intent.

## Common Mistakes

### Mistake 1: Designing only the happy path

**What goes wrong:** Failures get handled in rushed patches.

**How to avoid it:** Give failure cases their own section.

### Mistake 2: Writing a document nobody reads

**What goes wrong:** Long documents fall out of date.

**How to avoid it:** Keep it to a page or two, and store it with the code.

### Mistake 3: Skipping threading decisions

**What goes wrong:** Races appear during integration.

**How to avoid it:** State which thread owns what.

## Debugging and Troubleshooting

**Symptom:** Integration keeps breaking at module boundaries

**Possible Cause:** Unclear interfaces or ownership.

**Investigation Method:** List the assumptions on each side of the failing call.

**Resolution:** Define the contract in the header comments.

**Symptom:** The design and the code no longer match

**Possible Cause:** Decisions changed during coding.

**Investigation Method:** Compare at code review.

**Resolution:** Update the document in the same change.

## Design Considerations and Best Practices

**Match the effort to the risk.** A small helper needs a few lines. A core module needs a proper review.

**Write the header first.** It shows quickly if the interface feels awkward.

**Record why.** Rejected options save future debate.

**Prefer diagrams for flow.** A state diagram explains more than paragraphs.

## Expert Notes

**Design the unhappy paths first.** Normal operation usually takes care of itself. Failures are where designs get tested.

**Prototype the risky part.** If you are unsure a chip can do something, try it before writing a long plan.

**Record what you rejected.** Next year someone will suggest the same idea. A short note explains why not.

## Summary

A low-level design is a short plan for one module: its purpose, interface, states, resources and failure handling. Like a house's detailed plan, it stops problems before they are built in. Write the interface first, state who owns what, plan for failures, and get a review, since a change in a document costs far less than a change in code.

## Related Topics

**Prerequisites**

- Firmware Architecture Patterns
- State Machines

**Next Topics**

- Unit Testing Firmware
- Failover and Fault-Tolerant Design
