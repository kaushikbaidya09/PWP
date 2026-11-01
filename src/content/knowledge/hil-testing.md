---
title: "Hardware-in-the-Loop Testing: Automating Tests on Real Boards"
brief: "How automated rigs flash real hardware, drive its inputs and check its outputs, catching what host tests cannot."
order: 61
phase: 10
tags: ["HIL", "Test Automation", "pytest", "CI", "Test Rig"]
---

Unit tests prove the logic. They cannot prove that the SPI timing works, that a driver handles real interrupts, or that the board recovers from a power cut. Those failures appear only on real hardware. Hardware-in-the-loop testing does that checking automatically, every night, without anyone at the bench.

## The Fundamental Problem

Manual bench testing is slow and easy to skip. People test the feature they changed, and miss what they broke elsewhere. Real faults also involve timing, electrical behaviour and long runs that a person would never repeat a thousand times. Yet real hardware is awkward to automate, and it can hang, which a test system must survive.

## The Big Picture

![A test PC flashes the device, drives its inputs and reads its outputs](/diagrams/hil_rig.svg)

### In Plain Terms

Think of a machine that tests a new car door by opening and closing it 100,000 times. The door is real, but the hand is a robot, and the robot never gets tired or forgets to check.

A HIL rig is that robot for your board. A PC acts as the outside world: it pretends to be sensors, presses buttons, cuts power and listens to outputs. Your firmware cannot tell the difference, and so runs just as it would in a product.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **DUT** | Device under test. |
| **Test rig** | The hardware around the DUT. |
| **Fixture** | Setup and teardown code for tests. |
| **Power cycling** | Switching the DUT off and on, under control. |
| **Simulated peripheral** | A helper that acts as a sensor or bus device. |
| **Flaky test** | A test that passes and fails with no code change. |
| **Soak test** | A long run to find slow failures. |

## How It Works

### Step 1: Build

CI compiles firmware and stores the image.

### Step 2: Flash

The rig programs the DUT through SWD, USB or network boot.

### Step 3: Bring to a known state

Power cycle it and wait for a ready message.

### Step 4: Stimulate and observe

Drive inputs, then read outputs and logs.

### Step 5: Report

Save results and logs, and mark the build pass or fail.

## A Closer Look: What a Host Test Cannot See

If unit tests are so fast, why go to the trouble of a rig? Because some bugs do not exist until real hardware is involved.

**Timing.** A sensor needs 10 ms after power-up, and your code waits 5. A mock answers instantly, so the test passes.

**Electrical behaviour.** A signal rises too slowly with a long cable, and I2C fails on some boards.

**Real concurrency.** An interrupt arrives during a specific instruction. Host tests rarely recreate this.

**Long-term effects.** Memory leaks, flash wear and counters that wrap only show up after days of running.

**Recovery.** What happens when power is cut mid-write? Only a real power cut shows you.

So the two layers do different jobs. Unit tests are fast and check logic thousands of times, and they should find most bugs. HIL tests are slower and check that everything works together in the real world. A healthy project has many unit tests, and a smaller number of well-chosen rig tests.

## A Worked Example: Testing Power-Loss Recovery

A gateway must survive power loss during a firmware update. By hand, that means pulling a plug at just the right moment, many times. With a rig, a USB-controlled relay does it:

```python
import pytest

@pytest.mark.parametrize("delay_s", [1, 2, 5, 10, 20])
def test_update_survives_power_loss(dut, delay_s):
    dut.start_update("fw_new.img")
    dut.wait(delay_s)
    dut.power_cycle()
    dut.wait_for_boot(timeout=60)
    assert dut.version() in ("old", "new")
    assert dut.self_test() == "OK"
```

Cutting power at varied times covers many points in the update. Add random delays and run it overnight, and a bug seen once in 500 runs will show up by morning, with a log and an exact firmware version.

No person would run that test hundreds of times, which is why such bugs reach customers without a rig.

## Common Questions

**Do I need expensive equipment?** No. A relay, a USB serial adapter and a Python script make a useful start.

**How many boards?** One to begin with. Add more when tests start to queue.

**Should it run on every commit?** A short smoke test can. Long tests suit nightly runs.

**What language should tests be in?** Python with pytest is a common, practical choice.

## Under the Hood

A rig needs control of power, a console, and a way to recover a bricked board. Common parts are a relay or programmable supply, a debug probe, a logic analyser and USB to CAN or UART adapters. Tools such as `pyserial`, `python-can` and OpenOCD tie these together.

Good rigs can recover from anything, since a hung DUT must not stall the whole test queue. Every step has a timeout, and a failure triggers a full reflash through the debug probe.

Full HIL for automotive simulates a vehicle, with tools such as dSPACE driving real electrical signals. Lab frameworks like LAVA manage many boards and share them among teams.

## Real-World Applications

**Linux kernel.** KernelCI and LAVA run tests on real boards.

**Automotive.** ECUs run with a simulated vehicle.

**Industrial.** Rigs simulate sensors over long runs.

**Consumer products.** Racks of phones run nightly tests.

## Common Mistakes

### Mistake 1: No recovery path

**What goes wrong:** One bad image bricks the rig, and tests stop.

**How to avoid it:** Keep a debug-probe reflash that always works.

### Mistake 2: Fixed delays

**What goes wrong:** Tests are slow and flaky.

**How to avoid it:** Wait for events with timeouts.

### Mistake 3: Ignoring flaky tests

**What goes wrong:** People learn to ignore failures, and miss real ones.

**How to avoid it:** Find the cause: it might be a real timing bug.

## Debugging and Troubleshooting

**Symptom:** Tests fail only on the rig

**Possible Cause:** Long wires, ground problems or a different supply.

**Investigation Method:** Compare signals with a scope, and swap the DUT.

**Resolution:** Fix the rig, and record known differences.

**Symptom:** A test fails rarely, with no log

**Possible Cause:** Logs lost during reset.

**Investigation Method:** Capture the console on the rig, outside the DUT.

**Resolution:** Save full logs and firmware version for each run.

## Design Considerations and Best Practices

**Add test points early.** Debug access must be designed into the board.

**Start small.** One board, one relay and a smoke test bring value quickly.

**Keep the rig in version control.** Wiring notes and scripts need maintenance.

**Pick tests wisely.** Run fast tests per commit, long ones nightly.

## Expert Notes

**Separate DUT problems from rig problems.** Add a self-test for the rig, or you will chase bugs in your own cables.

**Keep an image of the failure.** Save firmware, logs and input for each failed run, so that a bug can be reproduced later.

**Add fault injection.** Dropped packets, low voltage and corrupted flash reveal recovery bugs that normal runs never touch.

## Summary

Hardware-in-the-loop testing puts real boards under the control of a test machine, which flashes them, drives their inputs and checks their outputs. It catches timing, driver and recovery bugs that host tests cannot, and repeats tests no person would. Start small, make the rig able to recover from anything, and treat flaky results as bugs.

## Related Topics

**Prerequisites**

- Unit Testing Firmware

**Next Topics**

- Static Analysis and CI
- Hardware Bring-Up
