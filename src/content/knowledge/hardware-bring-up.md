---
title: "Hardware Bring-Up: First Power-On of a New Board"
brief: "A careful step-by-step process for checking power, clocks, debug access and peripherals on a brand new board."
order: 64
phase: 11
tags: ["Bring-Up", "Prototype", "Power Rails", "JTAG", "Debug"]
---

A new board arrives from the factory, and nobody has ever run code on it. Nothing is proven: the schematic might have an error, a part may be fitted backwards, and the firmware has never met this hardware. Bring-up is how you turn an unknown board into a working platform, one small fact at a time.

## The Fundamental Problem

When everything is new, any failure could have many causes. If you power up and flash full firmware, and it does not work, you have learned nothing. It might be power, clocks, pins, code or the board. A single careless step can also destroy the only prototype you have.

## The Big Picture

![Check power first, then clock, then debug access, then peripherals](/diagrams/bring_up.svg)

### In Plain Terms

Starting a repaired car after a long time, you do not simply jump in and race off. You check the oil, then the battery, turn the key, and listen. Each check depends on the one before.

Bring-up works the same way. Prove one thing at a time and always in order, so when something fails you know exactly where to look. Boring and slow is the fast way here.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Bring-up** | Getting new hardware working for the first time. |
| **Power rail** | One supply voltage on the board. |
| **Current limit** | A bench supply setting that protects the board. |
| **Power sequencing** | The order in which rails must start. |
| **SWD / JTAG** | Debug access to the CPU. |
| **Errata** | The vendor's list of known chip bugs. |
| **Rework** | Physical fixes on the board. |
| **BSP** | Board support package: low-level code for a board. |

## How It Works

### Step 1: Inspect

With no power, check for shorts, part orientation and solder bridges.

### Step 2: Power up carefully

Use a bench supply with a low current limit, and raise the voltage while watching the current.

### Step 3: Check rails and clocks

Measure each rail and oscillator, and check reset is released.

### Step 4: Connect the debugger

Reading the chip ID proves that the CPU is alive.

### Step 5: Run a minimal program

Blink an LED and print on UART.

### Step 6: Add one peripheral at a time

Test memory first, then each bus and device.

## A Closer Look: Using a Current-Limited Supply

The most valuable tool at bring-up is a bench supply, and one setting does most of the work.

A normal power supply gives as much current as a board asks for. If a part is backwards or two rails are shorted, that can be several amps, and something burns.

With a current limit, you set a ceiling, such as 100 mA. If the board tries to draw more, the supply lowers its voltage to hold that ceiling. Nothing has time to overheat, and the display tells you immediately that something is wrong.

The current reading is also a diagnostic. You should know what to expect: a small MCU board might draw 20 mA. If it draws 300 mA, there is a problem. If it draws 0 mA, something is open or a regulator is off.

Watch the first second closely. Raise the limit gradually only as each rail is confirmed. This one habit has saved countless prototypes, and it costs only a few seconds.

## A Worked Example: A New MCU Board

You set the supply to 5 V with a 100 mA limit, and the current jumps to the limit. Stop: there is a short. A thermal camera shows one hot regulator. It was fitted rotated, so you rework it and try again. Now it draws 30 mA.

You measure 3.3 V and 1.2 V, and the reset line is high. The scope shows no clock at the crystal, but the internal oscillator is available, so you carry on without it.

`openocd` connects and reads the device ID. You flash a blink test and the LED works. UART prints nothing, so you scope the TX pin and see data at the wrong rate. The clock configuration assumes a crystal that has not started. Checking the schematic, the load capacitors are the wrong value. You fix them and the crystal runs.

Then you test I2C. `NACK` from the sensor. The scope shows SDA stuck low, and you find the pull-up is not fitted. Every bug here was found by a single small step, in minutes.

## Common Questions

**What should I test first?** Check for shorts between power and ground with a multimeter before applying power at all.

**What if I have only one board?** Be even more careful, and take photos before you rework anything.

**Do I need an oscilloscope?** For clocks, signals and power issues, yes. A multimeter cannot show these.

**When does firmware start?** After rails, clocks and debug access are proven.

## Under the Hood

Inrush current at start-up can be high, and the current limit must allow for it without hiding a short. Some rails need to rise in a set order, or the part can latch up and be damaged.

For Linux boards, DRAM is the biggest hurdle. Vendor tools run memory tests and training over many values, then generate settings. Run memory stress tests across temperature, as weak signals fail only when hot.

Signal integrity checks use a scope with short ground leads. A long ground lead adds ringing that is not really there.

## Real-World Applications

**New products.** Every prototype goes through this.

**Second sources.** Replacing a part needs a repeat of the checks.

**SoC boards.** Bring-up covers DRAM, boot and Linux.

**Factory testing.** Bring-up tests often become production tests.

## Common Mistakes

### Mistake 1: Powering with no current limit

**What goes wrong:** A short burns traces or parts.

**How to avoid it:** Always start limited.

### Mistake 2: Starting with full firmware

**What goes wrong:** Failures tell you nothing.

**How to avoid it:** Use the smallest test possible.

### Mistake 3: Not recording fixes

**What goes wrong:** The same rework is lost for the next revision.

**How to avoid it:** Keep a board log.

## Debugging and Troubleshooting

**Symptom:** Debugger cannot connect

**Possible Cause:** No power, held in reset, wrong boot mode or swapped SWD lines.

**Investigation Method:** Measure reset and clock, and use a slow SWD speed.

**Resolution:** Fix wiring or the boot pins.

**Symptom:** The board works when probed, and fails when not

**Possible Cause:** A floating signal, or weak timing.

**Investigation Method:** Check pull-ups and think about the probe's capacitance.

**Resolution:** Add the missing resistor.

## Design Considerations and Best Practices

**Design for bring-up.** Add test points, debug headers and LED or UART access.

**Prepare test firmware early.** Small test programs save days.

**Read the errata.** Your strange fault might be a known issue.

**Bring up with two people.** One hardware and one firmware engineer solve problems faster.

## Expert Notes

**Always suspect the simple thing first.** Most first-board faults are missing pull-ups, swapped lines and footprints, not exotic bugs.

**Keep a known-good reference.** A vendor evaluation board lets you compare the same firmware and signals.

**Write down every measurement.** Your notes become the checklist for the next revision and for production test.

## Summary

Bring-up proves a new board one fact at a time: inspection, power, clocks, debug access, then one peripheral after another. Use a current-limited supply and the smallest possible test at each step, so that any failure has one clear cause. Keep a log of fixes, and turn your tests into factory checks.

## Related Topics

**Prerequisites**

- Clock System Fundamentals
- Embedded Debugging

**Next Topics**

- Linux Boot Flow
- Hardware-in-the-Loop Testing
