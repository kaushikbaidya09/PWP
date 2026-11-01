---
title: "OTA on Embedded Linux: Updating Devices Safely"
brief: "How A/B partitions, health checks and rollback let a Linux device update itself in the field without bricking."
order: 65
phase: 11
tags: ["OTA", "A/B Update", "Rollback", "RAUC", "SWUpdate"]
---

Sooner or later every connected product needs a fix. If the update goes wrong on a device 3,000 km away, there is no one to press a button. Over-the-air updates are one of the riskiest things a device does: a power cut or a bad image at the wrong moment could turn it into a brick.

## The Fundamental Problem

Overwriting a running system is dangerous. If power fails halfway through, the system is neither old nor new, and may never boot again. Even a completely written image may have a bug that only appears in the field. An update design has to assume failure at every step and always leave a way back.

## The Big Picture

![The device runs from slot A, writes the update to slot B, and rolls back if it fails](/diagrams/ab_update.svg)

### In Plain Terms

Imagine changing the tyre of a moving car. That is what updating a running system is like. Now imagine the car has two sets of wheels. You fit new tyres to the set that is not being used, switch over, and if the new ones wobble you switch straight back.

That is A/B updating. The device keeps two complete copies of its system. It only writes to the one that is not running, so a failure at any moment leaves the working copy untouched.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **A/B update** | Two system slots, used in turn. |
| **Active / inactive slot** | The running copy, and the one to update. |
| **Rollback** | Returning to the previous slot. |
| **Boot counter** | Limits attempts on a new slot. |
| **Commit** | Marking a new system as good. |
| **Delta update** | Sending only the differences. |
| **RAUC / SWUpdate / Mender** | Common update tools for Linux. |

## How It Works

### Step 1: Check for updates

The device asks a server about new versions, over TLS.

### Step 2: Download and verify

The package is downloaded, and its signature checked.

### Step 3: Write the inactive slot

If running from A, the image goes to B, while the system keeps working.

### Step 4: Switch

The bootloader is told to try B, with a limited number of attempts.

### Step 5: Reboot and check

U-Boot decrements the count and boots B. A health check runs.

### Step 6: Commit or roll back

Good: mark B as permanent. Bad, or no commit: the boot count runs out, and U-Boot returns to A.

## A Closer Look: Who Decides an Update Worked?

The clever part of A/B updating is not the two slots. It is who decides that the new version is good.

The obvious design is: write the update, reboot, done. But a new version could boot and then fail, and a broken system cannot be trusted to fix itself. So the default has to be failure.

It works like a trial period. Before rebooting, the system sets a counter: "you have three attempts on slot B". The bootloader lowers the counter on each boot. If it reaches zero, the bootloader goes back to slot A, without needing Linux at all.

To end the trial, the new system must do something positive. Once it has started and passed its health checks, it clears the counter and marks itself good. If it hangs, crashes or cannot reach the network, that never happens, so rollback occurs automatically.

So success has to be proved, and doing nothing means failure. That is why a bad update cannot trap a device.

## A Worked Example: A Bad Release

Version 2.1 goes out to a gateway running 2.0 in slot A. It writes slot B, verifies the write and reboots.

U-Boot sets the try counter to 3 and boots B. The kernel starts, but the new network service crashes, and the device can no longer reach the server. A health service checks: can I reach the cloud? Are key services running? The check fails, so nothing marks the slot as good.

The watchdog resets the device, U-Boot counts down, and after the attempts run out it boots A again. The gateway is back on 2.0 and reports the failure, and the fleet rollout is paused.

Compare that to a single-slot design: this device would need a site visit. The extra flash pays for itself the first time this happens. A staged rollout helps too: update 1% of devices first, watch the reports, then widen.

## Common Questions

**Does A/B need twice the storage?** For system partitions, yes. Delta updates can reduce download size, but not the slot size.

**What about my settings?** They live on a separate data partition shared by both slots.

**Can I update while the device is running?** Yes. It writes to the inactive slot, and the switch happens at reboot.

**What if power fails during the write?** Nothing is lost. The active slot was untouched.

## Under the Hood

U-Boot stores its boot state in a redundant environment, so a power cut during a save cannot lose it. Variables such as `upgrade_available` and `bootcount` drive this logic, and `fw_setenv` changes them from Linux.

Persistent data must live on a separate partition, since `/etc` in slot A is not in slot B. A new version may also need to migrate data, and that must not break rollback. If the new version changes a database, the old version must still be able to read it.

Signed images come first: rollback is no use against an attacker who can install valid-looking firmware. Secure boot and anti-rollback counters complete the picture.

## Real-World Applications

**Phones.** Android uses A/B slots for seamless updates.

**Vehicles.** Tesla-style OTA uses the same principles, with extra safety checks.

**Gateways.** RAUC with Yocto is a common stack.

**Containers.** Some fleets update applications in containers, and the OS less often.

## Common Mistakes

### Mistake 1: Committing too early

**What goes wrong:** The system marks itself good before the network comes up.

**How to avoid it:** Check real function first, including reaching the update server.

### Mistake 2: Keeping data in the system slot

**What goes wrong:** Settings vanish after each update.

**How to avoid it:** Use a data partition.

### Mistake 3: Updating everything at once

**What goes wrong:** One bad release hits the entire fleet.

**How to avoid it:** Roll out in stages.

## Debugging and Troubleshooting

**Symptom:** The device rolls back after each update

**Possible Cause:** The commit step never runs, or the health check fails.

**Investigation Method:** Read logs from the failed boot, and check `fw_printenv`.

**Resolution:** Fix the service order or check.

**Symptom:** Boot state is lost after a power cut

**Possible Cause:** No redundant environment.

**Investigation Method:** Inspect the U-Boot config.

**Resolution:** Enable the redundant environment with two copies.

## Design Considerations and Best Practices

**Budget flash early.** A/B needs double the system space, so plan storage from the start.

**Test power loss.** Automate power cuts during updates.

**Keep the updater independent.** A broken application must not stop updates.

**Record versions and results.** You must know what each device is running.

## Expert Notes

**Include the bootloader in your plan.** It is the hardest part to update, so keep it simple, and update it rarely.

**Check data migrations with rollback in mind.** If version 2 changes the data format, version 1 must still run after a rollback.

**Put a canary group first.** Roll out to your own devices and a small group before the fleet.

## Summary

Safe OTA means never overwriting the system that is running. A/B updating keeps two copies: write to the spare, boot it with limited attempts, and commit only after a real health check. If it fails, the device falls back by itself. Sign every image, keep data separate, test power loss, and roll out in stages.

## Related Topics

**Prerequisites**

- Bootloaders and Firmware Updates
- Linux Boot Flow

**Next Topics**

- Secure Boot Chain
- Failover and Fault-Tolerant Design
