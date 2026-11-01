---
title: "Logging and Field Diagnostics: Finding Bugs in Deployed Devices"
brief: "How to design logs, crash reports and remote diagnostics so that you can explain failures on devices you cannot touch."
order: 66
phase: 11
tags: ["Logging", "Telemetry", "Crash Reports", "Diagnostics", "Observability"]
---

"It stopped working last Tuesday." That is all the information you get from a customer, about a device on another continent. No debugger, no serial cable, no way to reproduce it. What you know depends entirely on what the device recorded before it failed. Diagnostics must be designed in, because you cannot add them after the fact.

## The Fundamental Problem

Bugs seen in the field are the rarest and hardest ones: they depend on real conditions that lab tests never reached. Devices have limited storage, flash wears out, and bandwidth costs money. Log too little and you learn nothing. Log too much and you wear out flash, flood the network and bury the important line.

## The Big Picture

![The device stores logs and crash data locally, then uploads them for analysis](/diagrams/field_logs.svg)

### In Plain Terms

An aircraft carries a black box. It does not stream everything to the ground. It keeps recording the last while, overwriting older data, and that record survives the crash. Investigators then read exactly what happened.

Your device needs a small black box of its own: a ring of recent events, kept safe across a reset, and uploaded when a problem occurs. Along with it, a small regular health report shows how the fleet is doing.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Log level** | Severity such as error, warning, info, debug. |
| **Structured log** | Fields that software can parse, not free text. |
| **Ring buffer** | Fixed memory where new entries overwrite the oldest. |
| **Telemetry** | Regular metrics sent from devices. |
| **Crash dump** | Saved state at the moment of failure. |
| **Reset reason** | Why the device restarted last. |
| **Log rotation** | Limiting log file size and number. |

## How It Works

### Step 1: Decide what matters

Log state changes and errors, not every loop.

### Step 2: Write to a ring

Keep recent entries in RAM or a small flash ring.

### Step 3: Capture crashes

A fault handler saves registers and a stack summary to memory that survives reset.

### Step 4: Report on the next boot

The device reads the reset reason and sends any saved crash.

### Step 5: Aggregate

A server groups reports, so that you can see patterns.

## A Closer Look: What Makes a Log Useful

Most logs are written for the developer of the moment, and they make little sense a year later. Compare these two lines:

```text
error
upload failed: tls handshake err=-0x2700 host=api.example.com retry=3
```

The first says something went wrong. The second says what failed, why, where and how many times.

A useful log line answers four questions: what happened, why, in what context, and what happens next. It is also consistent, so a machine can count and group it.

Log levels help keep this under control. **Error** means something failed and needs attention. **Warning** means something unusual occurred, but the system coped. **Info** records normal milestones, such as a state change or a boot. **Debug** is for developers, and is off by default.

A good rule of thumb: log changes, not repetition. "Link went down" is useful. "Link is still down", every second, only fills the storage.

## A Worked Example: The Tuesday Failure

Customers report that gateways reboot at random. Each device sends a small boot report:

```json
{"id":"gw-4182","fw":"2.1.0","reset":"watchdog","uptime_s":518400,
 "last_state":"UPLOADING","free_heap":1824}
```

Grouped together, the reports show a pattern: the reset reason is always `watchdog`, uptime is close to six days, and heap is low. That points to a slow memory leak, not random behaviour.

The ring log from one device shows retries in an upload path, with each failure adding a small buffer. The team finds the leak on a rarely used error path, and writes a test for it.

Notice what made this possible: a reset reason, a firmware version, a state name and a free memory value. That is only a few bytes per boot. Without these, the team might spend weeks staring at code.

## Common Questions

**How much should I log?** Enough to explain a failure. Start with errors and state changes.

**Should logs include timestamps?** Yes, plus a boot counter, as clocks may be wrong.

**Can I change the log level remotely?** Good designs allow it for a limited time, on one device.

**What is the difference between logs and metrics?** Logs describe events. Metrics count them, over time.

## Under the Hood

Flash has limited write cycles, so constant logging can wear it out. Keep frequent logs in RAM, and write to flash only for important events, or batch writes. On Linux, `journald` with volatile storage keeps logs in RAM, and limits on disk use prevent runaway growth.

MCU crash data can sit in RAM that is not cleared at reset, with a magic number to prove it is valid. Saving program counter, link register and fault registers fits in a few dozen bytes. Addresses are decoded later on a server, using the map file for that exact build.

Timestamps matter. If a device lost its time, log uptime and boot number too, so events can still be put in order.

## Real-World Applications

**Cars.** Event data and DTCs are read from ECUs at service.

**Phones.** Crash reports are grouped by signature.

**Gateways.** Fleet dashboards show version and health.

**Remote support.** Authorised engineers request logs on demand.

## Common Mistakes

### Mistake 1: Logging secrets

**What goes wrong:** Keys, tokens or personal data end up in uploaded logs.

**How to avoid it:** Review what you log, and never print credentials.

### Mistake 2: Logging from ISRs with blocking calls

**What goes wrong:** Timing changes and the system stalls.

**How to avoid it:** Write to a lock-free ring, and print elsewhere.

### Mistake 3: Log storms

**What goes wrong:** A repeating error fills storage and hides the first cause.

**How to avoid it:** Rate-limit, and keep the first occurrence.

## Debugging and Troubleshooting

**Symptom:** Logs stop just before a crash

**Possible Cause:** Buffered output was lost.

**Investigation Method:** Compare buffered logs to a live console.

**Resolution:** Flush on errors, or keep logs in reset-safe RAM.

**Symptom:** Flash fails early in the field

**Possible Cause:** Too many writes.

**Investigation Method:** Read eMMC health data, and measure log write volume.

**Resolution:** Reduce writes, and move logs to RAM.

## Design Considerations and Best Practices

**Design logs for a stranger.** Someone must understand them a year later.

**Always include version and reset reason.** They are the most valuable fields.

**Use counters.** Counting errors costs little, and shows trends.

**Respect privacy.** Disclose what you collect, and keep only what you need.

## Expert Notes

**Reset reason is the most valuable single field.** Watchdog, brownout and panic all point in very different directions.

**Sample your telemetry.** Sending everything from a large fleet is costly. A small sample shows the same trends.

**Keep the map file for every release.** Crash addresses are useless without the exact matching build.

## Summary

Field failures can only be explained by what a device recorded at the time, so diagnostics must be designed from the start. Keep a small black box of recent events, save crash data across resets, and always report the firmware version and reset reason. Protect flash from excessive writes, keep secrets out of logs, and look for patterns across the fleet.

## Related Topics

**Prerequisites**

- Fault Handling and Crash Analysis
- Debugging on Linux

**Next Topics**

- Failover and Fault-Tolerant Design
- OTA on Embedded Linux
