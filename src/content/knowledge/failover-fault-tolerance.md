---
title: "Failover and Fault-Tolerant Design: Keeping Devices Running"
brief: "How to detect failures, switch to backups and recover automatically, so a device keeps working when a part of it stops."
order: 68
phase: 11
tags: ["Failover", "Fault Tolerance", "Redundancy", "Recovery", "Graceful Degradation"]
---

A gateway in a remote site loses its Ethernet cable at midnight. It should not just go silent until someone notices. A well-designed device expects parts of itself to fail, notices when they do, and carries on as well as it can. Reliability is not about never failing. It is about what happens next.

## The Fundamental Problem

Everything fails eventually: cables, sensors, flash, power, software. A remote device usually has nobody to reset it. Yet recovery logic is rarely exercised, so it is often the least tested code in the system. Poor failover can make things worse, for example by flapping between two links or restarting forever.

## The Big Picture

![Detect a fault, switch to a backup, and recover when it is safe](/diagrams/failover_loop.svg)

### In Plain Terms

Think of a hospital. If mains power fails, a generator starts within seconds. Most things keep working, while non-essential lights stay off to save fuel. Staff notice it, deal with the fault, and then switch back only after mains is clearly stable.

Those are the steps in any fault-tolerant design: spot the failure, switch to a backup, reduce to what is essential, and return carefully.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Fault** | Something has gone wrong inside the system. |
| **Failure** | The system no longer does its job. |
| **Redundancy** | Spare parts that can take over. |
| **Failover** | Switching to the backup. |
| **Failback** | Returning to the primary. |
| **Graceful degradation** | Working with reduced function. |
| **Heartbeat** | A regular "I am alive" signal. |
| **Fail-safe** | Going to a safe state on a fault. |

## How It Works

### Step 1: Detect

Use heartbeats, timeouts and health checks. Do not trust "link up" alone.

### Step 2: Confirm

Require several failures, so that one lost packet does not trigger a switch.

### Step 3: Switch

Activate the backup and reroute work.

### Step 4: Degrade

Reduce non-essential work to fit the backup's capacity.

### Step 5: Report

Record what happened and alert someone.

### Step 6: Recover

Return to the primary only after it has been stable for a while.

## A Closer Look: Why Different Up and Down Thresholds Stop Flapping

Imagine a thermostat that turns heat on below 20 °C, and off above 20 °C. Around 20 degrees it would click on and off constantly. Real thermostats turn on at 19 and off at 21. That gap is called hysteresis.

Failover needs the same thing. If a link switches away after one missed heartbeat and back after one good one, then a slightly unreliable link causes endless switching. Each switch costs time and may lose data, so the result is worse than either link alone.

So use two different conditions. To leave a link, it must fail several checks in a row. To come back, it must be good for a long time, such as 60 seconds.

Fast to leave and slow to return makes sense: leaving a failed link quickly protects your data, while returning too eagerly only risks another failure.

This pattern appears everywhere: battery charging, sensor alarms and retries. If a system oscillates, you usually need a wider gap.

## A Worked Example: Ethernet to Bluetooth Failover

A device normally reports through Ethernet, with a Bluetooth link to a nearby hub as backup.

**Detection.** The cable can show link up while the switch upstream is dead, so the device sends application-level heartbeats every 10 seconds. Three misses means the path has failed.

**Switch.** A state machine moves from `ETH_ACTIVE` to `SWITCHING`, brings up Bluetooth, then enters `BT_ACTIVE`.

**Degrade.** Bluetooth has far less bandwidth, so the device sends only alarms and summaries, and keeps detailed data in a bounded local queue.

**Recover.** When Ethernet heartbeats return, the device waits for 60 seconds of stable replies. Without this wait, a loose connector would cause constant flipping, called flapping.

**Catch up.** The stored data is sent, at a limited rate, oldest first, then the Bluetooth link closes.

The application only ever calls one `send` function. Failover logic stays hidden in one module, which makes it possible to test by simulating every failure.

## Common Questions

**What is the difference between fault-tolerant and fail-safe?** Fault-tolerant keeps working. Fail-safe moves to a safe state, such as closing a valve.

**Is a watchdog enough?** It handles hangs. It does not fix the cause, and it cannot help with a device stuck in a reboot loop.

**Do I need redundant hardware?** Not always. Software retries and graceful degradation solve many cases cheaply.

**How do I test failover?** Pull cables, kill processes, cut power and fill the disk, on purpose.

## Under the Hood

Independent paths matter. Two links through one power supply are not truly redundant: a shared failure takes out both. These are called common-cause failures.

Watchdogs form layers: a service watchdog under systemd, then a hardware watchdog for full hangs. A device should also limit restarts, because endless restart loops hide problems and can wear out flash. Escalate in steps: restart a service, reboot, then enter a safe recovery mode.

Storing state with journaling or atomic file writes means that a power cut mid-write does not corrupt data. Write to a temporary file, flush, then rename it over the old one.

## Real-World Applications

**Telecom.** Backup links and redundant power supplies.

**Automotive.** Limp-home mode runs with reduced power.

**Aerospace.** Multiple flight computers vote on outputs.

**Industrial.** Redundant controllers take over within milliseconds.

## Common Mistakes

### Mistake 1: Trusting link status

**What goes wrong:** A device stays on a dead path because the cable is fine.

**How to avoid it:** Check end to end.

### Mistake 2: Flapping

**What goes wrong:** Constant switching is worse than either link.

**How to avoid it:** Use different up and down thresholds, and timers.

### Mistake 3: Never testing failover

**What goes wrong:** The backup fails when finally needed.

**How to avoid it:** Inject faults regularly.

## Debugging and Troubleshooting

**Symptom:** The device keeps switching links

**Possible Cause:** Thresholds too sensitive.

**Investigation Method:** Log each transition, with time and reason.

**Resolution:** Add hysteresis and a stability timer.

**Symptom:** A reboot loop in the field

**Possible Cause:** A fault that returns at each start.

**Investigation Method:** Check reset reasons and boot counters.

**Resolution:** Add a counter that enters safe mode after several failures.

## Design Considerations and Best Practices

**Decide what must survive.** List the essential functions first.

**Keep recovery code simple.** Complex recovery is itself a source of bugs.

**Bound everything.** Queues, retries and logs all need limits.

**Test by breaking things.** Pull cables, cut power and fill storage.

## Expert Notes

**The backup path rots.** Code that rarely runs breaks without anybody noticing. Exercise failover on a regular schedule.

**Retries multiply.** If several layers each retry three times, one failure can become dozens of attempts. Retry at one layer.

**Tell someone.** A silent failover hides a broken primary. Report every switch, or you will eventually lose the backup too.

## Summary

Fault-tolerant devices expect failure. They detect problems with real health checks, confirm them, switch to a backup, reduce to essential work, and return carefully once things are stable. Avoid flapping with timers, escalate recovery in steps, keep backups truly independent, and regularly test the failure paths, since untested recovery may not work when needed.

## Related Topics

**Prerequisites**

- Watchdog Timers
- State Machines

**Next Topics**

- Logging and Field Diagnostics
- OTA on Embedded Linux
