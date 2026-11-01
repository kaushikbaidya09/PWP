---
title: "systemd for Embedded: Starting and Supervising Services"
brief: "How systemd starts services in the right order, restarts them after failure, and works with a watchdog on embedded Linux."
order: 49
phase: 8
tags: ["systemd", "Services", "Units", "Watchdog", "journald"]
---

When an embedded Linux device boots, many things must start in the right order: network, sensors, your application. If your application crashes at 3 a.m., no one is there to restart it. systemd handles both jobs, and a few lines of configuration can replace a lot of hand-written shell scripts.

## The Fundamental Problem

Old init scripts ran one after another, used fixed sleep delays and did not check whether anything was still running. A service that died stayed dead. Each team wrote its own restart loops and logging. A product needs something that understands dependencies and keeps watching after boot.

## The Big Picture

![The kernel starts systemd, which starts services and restarts them if they fail](/diagrams/systemd_flow.svg)

### In Plain Terms

systemd is like a stage manager in a theatre. It holds a list of everyone in the show, knows who must be ready before whom, and calls each actor at the right moment. If an actor faints mid-show, it sends them back on, without stopping the play. It also keeps a logbook of everything that happened.

You write a small card for each actor, called a unit file, and the manager handles the rest.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Unit** | A thing systemd manages: a service, socket, timer or mount. |
| **Service** | A unit that runs a program. |
| **Target** | A group of units representing a state, such as `multi-user.target`. |
| **After= / Requires=** | Ordering and dependency between units. |
| **Restart=** | When to restart a service. |
| **journald** | The system log service. |
| **WatchdogSec=** | Restarts a service that stops reporting. |

## How It Works

### Step 1: The kernel starts PID 1

systemd starts as the first process and reads unit files.

### Step 2: Build a dependency graph

It works out what the default target needs, and runs what it can in parallel.

### Step 3: Start services

Each service starts when its ordering conditions are met.

### Step 4: Supervise

systemd tracks each service, including its child processes, using cgroups, and applies restart rules.

### Step 5: Log

Output to stdout and stderr goes to the journal automatically.

## A Closer Look: Ordering Is Not the Same as Requiring

The directives in a unit file are the part people get wrong, because two separate ideas are involved.

**Requirement** answers "should this other thing be started too?" `Wants=` says start it if you can. `Requires=` says it is essential.

**Ordering** answers "which goes first?" `After=` says wait for that unit to finish starting.

They are independent. `After=network.target` alone does not start anything. It only says that if both happen to be starting, wait. Likewise, `Wants=` without `After=` starts both at once. Usually you need both lines together.

There is one more trap. "Started" does not always mean "ready". A plain service counts as started the moment its process launches, while it may still be loading. If others depend on it being ready, use `Type=notify`. The program then calls `sd_notify("READY=1")` when it can actually accept work, and only then do the waiting units begin.

## A Worked Example: A Robust Sensor Service

Create `/etc/systemd/system/sensor.service`:

```ini
[Unit]
Description=Sensor service
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/sensor
Restart=on-failure
RestartSec=2
WatchdogSec=30
User=sensor

[Install]
WantedBy=multi-user.target
```

Then enable it and check on it:

```bash
systemctl enable --now sensor
systemctl status sensor
journalctl -u sensor -f
```

Now the service starts after the network is ready and runs as a limited user. If it crashes, it comes back in two seconds. If it hangs without crashing, `WatchdogSec` catches that too, provided the program calls `sd_notify("WATCHDOG=1")` regularly. A crash and a hang are both handled, with no restart script.

## Common Questions

**Where do unit files go?** Vendor files go in `/usr/lib/systemd/system`, and local ones in `/etc/systemd/system`, which take priority.

**How do I see why something failed?** `systemctl status name`, then `journalctl -u name`.

**What is the difference between enable and start?** `start` runs it now. `enable` makes it start at boot.

**Is systemd too big for my device?** On small systems it may be. BusyBox init is a common lighter choice.

## Under the Hood

systemd places each service in a cgroup, so it can track and kill every child process, and limit its CPU and memory. It can also pet the hardware watchdog itself using `RuntimeWatchdogSec`, so that a full system hang resets the board.

Socket activation lets systemd hold a listening socket and start a service on first connection, reducing boot time and memory. Sandboxing options such as `ProtectSystem=strict` and `NoNewPrivileges=yes` restrict a service with one line each.

`systemd-analyze blame` lists slow services and `systemd-analyze critical-chain` shows what held up boot.

## Real-World Applications

**Gateways.** Each function runs as its own restartable service.

**Kiosks and displays.** A GUI service restarts on crash.

**Scheduled work.** Timer units replace cron, for tasks such as log uploads.

**OTA.** Services can confirm health after an update, or trigger rollback.

## Common Mistakes

### Mistake 1: Using After= alone

**What goes wrong:** `After=` only sets the order. It does not pull the other unit in, so it may never start.

**How to avoid it:** Add `Wants=` or `Requires=` as well.

### Mistake 2: Daemonising inside the program

**What goes wrong:** systemd thinks the service exited.

**How to avoid it:** Stay in the foreground, with `Type=simple` or `notify`.

### Mistake 3: Filling flash with logs

**What goes wrong:** Persistent logging wears out storage or fills the disk.

**How to avoid it:** Set limits in `journald.conf`, such as `SystemMaxUse=`.

## Debugging and Troubleshooting

**Symptom:** A service keeps restarting, then stops

**Possible Cause:** It hit the start limit after repeated failures.

**Investigation Method:** Run `systemctl status` and `journalctl -u name -b`.

**Resolution:** Fix the crash, then run `systemctl reset-failed`.

**Symptom:** The service fails at boot, but works when started by hand

**Possible Cause:** Something it needs is not ready, such as a device or network.

**Investigation Method:** Compare times in `journalctl -b`.

**Resolution:** Add the correct dependency, or wait for the device in the program.

## Design Considerations and Best Practices

**One job per service.** Small services restart independently.

**Use the watchdog.** Hangs are more common than clean crashes.

**Run with least privilege.** Use `User=` and the sandboxing options.

**Consider simpler init on tiny systems.** BusyBox init uses far less memory where systemd will not fit.

## Expert Notes

**Drop-ins beat editing vendor units.** `systemctl edit name` adds overrides without touching the original file, so updates are safe.

**Sandbox options are nearly free.** `ProtectSystem=strict`, `PrivateTmp=yes` and `NoNewPrivileges=yes` shrink the damage from a compromised service. `systemd-analyze security` scores each service.

**Beware restart loops hiding bugs.** A service that quietly restarts looks healthy on a dashboard. Count restarts, and report them.

## Summary

systemd is the stage manager of a Linux system. You describe each service in a small unit file, and it starts them in order, restarts them on failure and keeps logs. Its watchdog catches hangs as well as crashes. Use clear dependencies, keep services small, and give each one only the privileges it needs.

## Related Topics

**Prerequisites**

- Linux Boot Flow

**Next Topics**

- Debugging on Linux
- Watchdog Timers
- Failover and Fault-Tolerant Design
