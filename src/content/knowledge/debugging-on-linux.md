---
title: "Debugging on Linux: Tools for Finding Real Problems"
brief: "How to use GDB, strace, perf, core dumps and logs to find crashes, hangs and slowdowns on embedded Linux systems."
order: 50
phase: 8
tags: ["GDB", "strace", "perf", "Core Dumps", "Valgrind"]
---

On a microcontroller you attach a probe and stop the CPU. On Linux, many processes are running, the kernel is involved, and the bug might appear only in the field after three days. The good news is that Linux gives you better tools than any MCU, once you know which one fits.

## The Fundamental Problem

Different failures need different views. A crash needs a stack trace. A hang needs to know what a process is waiting for. A slowdown needs a profile of where time goes. Adding print statements changes timing and needs a rebuild, and often the failure has already happened by the time you look.

## The Big Picture

![Crashes use GDB and core dumps, hangs use strace, and slowness uses perf](/diagrams/linux_debug.svg)

### In Plain Terms

Think of a car mechanic. If the car has crashed, they examine the wreck: that is a core dump. If it stops and will not move, they check what it is stuck on: that is `strace`. If it runs but feels slow, they put it on a test bench and measure it: that is `perf`. The right first step depends on the symptom.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **GDB** | The standard debugger, for stepping and inspecting state. |
| **gdbserver** | Runs on the target so that GDB can connect from a PC. |
| **Core dump** | A snapshot of a process's memory when it crashed. |
| **strace** | Shows the system calls a process makes. |
| **perf** | A profiler that samples where CPU time goes. |
| **dmesg** | The kernel log. |
| **Sanitizers** | Compiler tools that catch memory and race bugs at runtime. |
| **Valgrind** | Finds memory errors by running code in an emulator. |

## How It Works

### Step 1: Classify the symptom

Crash, hang, slowness or wrong output? Each leads to a different tool.

### Step 2: Check the logs first

`journalctl -b` and `dmesg` often give the answer directly.

### Step 3: Capture evidence

For crashes, enable core dumps. For hangs, attach before restarting.

### Step 4: Narrow it down

Use the tool to find the function or system call.

### Step 5: Reproduce and fix

Write a test for the failure, then fix it.

## A Closer Look: How to Read a Backtrace

A backtrace looks intimidating, but it is simply a list of "who called whom", read from the top down.

```text
#0  parse_frame (buf=0x0) at parser.c:88
#1  on_receive () at net.c:142
#2  event_loop () at main.c:60
```

Frame #0 is where the program was when it stopped. Here that is `parse_frame`, at line 88 of `parser.c`. Frame #1 is the function that called it, and frame #2 called that. So the program went: `event_loop` called `on_receive`, which called `parse_frame`.

The values in brackets are the clues. `buf=0x0` tells you the buffer pointer was null. Now ask the real question: why? Frame #1 passed that pointer in, so use `frame 1`, then `info locals`, to look at that function's variables.

The crash site is often not the real bug. The bug is wherever the bad value came from. Walking up the frames, asking "who gave me this?", usually leads you there. If you see only `??` and addresses, you are missing the symbols.

## A Worked Example: A Crash in the Field

A service restarts once a day. The journal shows `SIGSEGV`, but no one can reproduce it. Enable core dumps:

```bash
ulimit -c unlimited
echo '/var/crash/core.%e.%p' > /proc/sys/kernel/core_pattern
```

The next crash leaves a file. Copy it to your PC, then open it with the unstripped binary:

```bash
gdb-multiarch sensor core.sensor.812
(gdb) bt
#0 parse_frame (buf=0x0) at parser.c:88
#1 on_receive () at net.c:142
(gdb) thread apply all bt
```

The null `buf` at line 88 shows what happened. Keep debug symbols for each release so you can do this without shipping them.

Another case: a process seems frozen.

```bash
strace -p 812
futex(0x7f2a..., FUTEX_WAIT...
```

It is waiting on a lock, which points to a deadlock. For slowness, use `perf top`, or record with `perf record -g -p 812` and inspect it with `perf report`.

## Common Questions

**Should I use print statements?** They are fine for quick checks. Tools give more information, and change timing less.

**Why does a program behave differently under a debugger?** Timing changes, and that can hide a race.

**What is a stripped binary?** One with its debug symbols removed. Keep a copy of the unstripped version.

**How do I debug a program that runs on the board from my PC?** Run `gdbserver :2345 ./app` on the board, then `target remote` from `gdb-multiarch`.

## Under the Hood

`strace` uses `ptrace` to stop a process at each system call, which can slow it a lot, so timing bugs may vanish. `perf` samples using CPU counters at a set rate, with very little cost.

GDB breakpoints replace an instruction with a trap, and `gdbserver` passes that over the network. Core files are ELF files containing memory and registers, so you need matching binaries to read them, and a build ID ensures that they match.

For the kernel, `ftrace` traces functions and events through `/sys/kernel/tracing`, and `kgdb` allows source debugging. `addr2line` turns addresses from a kernel oops into source lines.

## Real-World Applications

**Field failures.** Core dumps are uploaded for offline analysis.

**Performance work.** `perf` finds hot functions in GUI rendering.

**Memory leaks.** Long-running services are checked using Valgrind or ASan.

**Latency work.** `ftrace` shows delays in interrupt handling.

## Common Mistakes

### Mistake 1: Debugging without symbols

**What goes wrong:** Backtraces show only addresses.

**How to avoid it:** Keep a matching debug build for every release.

### Mistake 2: Restarting first

**What goes wrong:** The evidence disappears with the process.

**How to avoid it:** Capture state, such as stacks and logs, before restarting.

### Mistake 3: Relying only on prints

**What goes wrong:** Prints change the timing and hide the race.

**How to avoid it:** Use tracing or sanitizers.

## Debugging and Troubleshooting

**Symptom:** High CPU and the cause is unknown

**Possible Cause:** A busy loop or an expensive function.

**Investigation Method:** Use `top -H` to find the thread, then `perf top`.

**Resolution:** Fix the loop, or block on `poll` instead.

**Symptom:** Memory grows slowly until the device fails

**Possible Cause:** A leak, or a growing cache.

**Investigation Method:** Track `/proc/PID/status` over time, then run Valgrind.

**Resolution:** Free the allocation, or set limits.

## Design Considerations and Best Practices

**Build debug tools into a dev image.** Keep them out of production, but make them easy to add.

**Log with purpose.** Include IDs and states, so that one line tells a story.

**Make core dumps collectable.** `systemd-coredump` manages them for you.

**Run sanitizers in CI.** ASan and TSan find bugs before the field does.

## Expert Notes

**Learn `dmesg` first.** The kernel prints useful information about crashes, killed processes and driver errors, and it is checked too rarely.

**The OOM killer leaves a clear trail.** If a process vanishes with no crash, search the log for "Out of memory".

**Time-travel tools are worth knowing.** `rr` records a run so that you can step backward from a crash, on supported platforms.

## Summary

Debugging Linux starts by naming the symptom. Use core dumps and GDB for crashes, `strace` for hangs, and `perf` for slowness, and always read the logs first. Keep symbols for every release, capture evidence before restarting, and run sanitizers during testing so that fewer bugs ever reach the field.

## Related Topics

**Prerequisites**

- Embedded Debugging
- Kernel vs User Space

**Next Topics**

- Logging and Field Diagnostics
- Static Analysis and CI
