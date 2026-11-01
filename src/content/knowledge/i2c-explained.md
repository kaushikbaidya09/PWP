---
title: "I2C Explained: Connecting Many Devices Over Two Wires"
brief: "The two-wire open-drain bus: addressing, ACK and NACK, clock stretching, repeated starts and recovering a stuck bus."
order: 18
phase: 4
tags: ["I2C", "ACK", "Address", "Pull-Up"]
---

You are debugging a sensor board at 11 PM. The accelerometer is supposed to be responding, but your firmware reads back 0xFF on every register access.

This scenario plays out constantly in embedded development. I2C is one of those protocols that appears simple on the surface — only two wires, short register reads, low pin count — but hides a surprising number of failure modes that only become visible once you understand what the hardware is actually doing underneath.

## The Fundamental Problem

In the early days of microcontroller-based systems, connecting multiple peripheral ICs to a processor required either a parallel bus (many signal lines, good speed) or UART-style point-to-point links (one device per port, no sharing). Both approaches consumed significant PCB space and pin count.

The naive approach is a shared parallel bus with chip-select lines. This is what SPI does, and it works well for high-speed or high-throughput peripherals.

## The Big Picture

At the highest level, I2C is a SYNCHRONOUS, MULTI-MASTER, MULTI-SLAVE serial bus. Two wires do all the work: SCL (Serial Clock Line) and SDA (Serial Data Line).

A typical transaction follows this sequence: controller issues a START condition, sends the 7-bit device address plus a read/write bit, waits for an ACK from the target, exchanges data bytes (each followed by an ACK or NACK), and terminates with a STOP condition. Register-based peripherals (the majority of I2C devices) require a write transaction to set the internal register pointer, followed by a read transaction to retrieve the data — connected by a REPEATED START rather than a full STOP/START cycle.

The diagram below shows the bus topology.

![I2C bus topology: a master and three slaves sharing SDA and SCL](/diagrams/i2c_bus.svg)

## Key Concepts and Terminology

**Open-Drain Bus** — Both SCL and SDA lines are open-drain (or open-collector).

**Start Condition** — A HIGH-to-LOW transition on SDA while SCL is HIGH.

**Stop Condition** — A LOW-to-HIGH transition on SDA while SCL is HIGH.

**Repeated Start** — A START condition issued without a preceding STOP.

7-BIT ADDRESS - The first byte after a START consists of 7 address bits followed by the R/W bit.

**Ack / Nack** — After every byte, the RECEIVER pulls SDA LOW during the 9th clock pulse to signal ACK (acknowledgment).

## How It Works

### Step 1: Bus idle and start condition

Before a transaction, both SCL and SDA are pulled HIGH by the pull-up resistors. The controller initiates a transaction by pulling SDA LOW while SCL is HIGH.

### Step 2: Address phase transmission

The controller clocks out 8 bits: the 7-bit device address (MSB first) followed by the R/W bit. Data bits are set on SDA while SCL is LOW and sampled while SCL is HIGH.

### Step 3: ACK from target device

After the 8th bit is clocked in, the controller releases SDA (stops driving it) and generates the 9th clock pulse. If a device recognized its address, it pulls SDA LOW during this 9th pulse — that is the ACK.

### Step 4: Data transfer

If the transaction is a WRITE, the controller continues sending data bytes, each followed by an ACK from the slave. The slave is consuming and processing each byte, often writing it to an internal register.

### Step 5: Stop or repeated start

After the final data byte, the controller issues either a STOP or a Repeated START. For a STOP: SCL goes HIGH, then SDA goes HIGH while SCL remains HIGH.

## Under the Hood

The open-drain bus topology is the most important hardware mechanism to internalize. Inside an MCU GPIO configured for open-drain, the output stage has a pull-down transistor (NMOS) and NO pull-up transistor.

Inside the MCU's I2C peripheral (for example, the STM32F4 I2C peripheral), the hardware implements a state machine that generates START and STOP conditions, shifts bits in and out, manages the ACK/NACK output, and handles clock generation. The peripheral interacts with firmware via status registers and control registers.

## Real-World Applications

AUTOMOTIVE: I2C is widely used for body electronics and sensor interfaces where bus speed is not critical. Ambient light sensors for automatic headlight control, interior temperature sensors, seat position memory modules, and EEPROM storage for ECU configuration data all commonly use I2C.

**Consumer electronics.** Smartphones and tablets are among the densest I2C environments in the industry. A typical smartphone main board connects 10 to 20 I2C devices: the inertial measurement unit, proximity sensor, ambient light sensor, battery fuel gauge, touchscreen controller, audio codec, NFC controller, fingerprint sensor, and multiple PMICs (power management ICs), each with their own register maps.

## Common Mistakes

**Address Confusion with the R/w Bit** — What goes wrong: the engineer passes the 8-bit wire format (address already left-shifted with R/W bit ORed in) to an HAL function that expects a 7-bit address and does its own shift. The result is a transaction to a completely wrong address, and the device NACKs silently. How to avoid it: read the HAL documentation for each function.

**Ignoring Return Codes From I2c Hal Functions** — What goes wrong: the I2C write returns HAL_ERROR or an error enum, firmware ignores it, then tries to read register data that was never actually written. Debugging appears to show correct reads but the sensor is uninitialized. How to avoid it: every I2C call must check its return value.

**Wrong Pull-Up Resistor Values** — What goes wrong: 10k resistors are used everywhere because they are common in tutorials. At Fast Mode (400 kHz) with moderate bus capacitance (150 pF), the rise time (R * C = 1.5 us) exceeds the spec maximum (0.3 us for Fast Mode). The oscilloscope shows rounded, slow transitions that are borderline valid.

## Debugging and Troubleshooting

**Symptom:** Device NACKs on address phase; was working previously.

**Possible Cause:** Device in a bad internal state (mid-transaction reset), power supply glitch caused loss of internal configuration, or I2C bus lockup leaving SDA asserted so the device cannot see a valid START.

**Investigation Method:** With a logic analyzer or oscilloscope, verify SDA is HIGH at bus idle.

**Resolution:** Toggle device RESET if available.

**Symptom:** Reads return 0xFF on every register.

**Possible Cause:** Missing pull-up resistors on SCL or SDA (both lines pulled HIGH by weak internal pads or floating, device sees all 1s).

**Investigation Method:** Confirm pull-up resistors are populated and connected to the correct VCC rail.

**Resolution:** Add or verify pull-up resistors.

## Design Considerations and Best Practices

1. SIZE PULL-UP RESISTORS FROM THE BUS CAPACITANCE, NOT FROM DEFAULTS. The formula is R_max = t_r / C_bus where t_r is the maximum allowed rise time from the spec (1000 ns for Standard Mode, 300 ns for Fast Mode). Start with a parasitic capacitance estimate of 10 pF per device plus 1-2 pF per cm of trace. Solve for R, then verify on a scope. A default of 4.7k works for many designs but fails silently in others.

2. **Implement Bus Recovery in Every I2c Driver Initialization.** Every production driver should check SDA at startup. If SDA is LOW, execute the recovery sequence (9 SCL pulses, then a STOP) before attempting any transaction.

## Expert Notes

**The stray capacitance from a logic analyzer probe matters.** Adding a logic analyzer with 10 pF probes on both SCL and SDA adds up to 20 pF to a bus that may already be near its limit. On a marginal bus at 400 kHz, the probe itself can push the rise time over the limit and introduce errors that only appear when the analyzer is connected.

**The I2C "busy flag errata" is not just an STM32 problem.** Several Microchip PIC32 and some older NXP Kinetis I2C peripherals have similar issues where the hardware state machine can enter a stuck state. The pattern is always the same: a STOP condition generated under non-ideal bus conditions leaves the peripheral's internal BUSY flag asserted.

## Summary

I2C's genius is in what it does with two wires: it provides a true multi-device bus with hardware addressing, bidirectional data, synchronous clocking, and built-in flow control (via ACK/NACK and clock stretching), all without requiring a dedicated chip-select line for each device. The open-drain topology is not incidental — it is the electrical foundation that makes every feature of the protocol possible. Understanding that both masters and slaves can hold the bus LOW, and that the HIGH state is always a passive resistor pull, is the key insight that unlocks the rest of the protocol.

The failure modes in I2C almost always trace back to one of three root causes: electrical margin problems (wrong pull-up values, excessive bus capacitance, marginal rise times), hardware peripheral defects (errata, missing clock stretching support, stuck BUSY flags), or software omissions (ignoring return codes, skipping bus recovery, incorrect address shifting, missing Repeated START). All three are avoidable if the engineer understands the protocol deeply rather than treating the HAL as a black box.

## Related Topics

**Prerequisites**

- Serial Communication Fundamentals (understanding synchronous vs. asynchronous protocols, baud rate concepts, framing)
- GPIO Fundamentals (push-pull vs. open-drain output modes, pull-up and pull-down resistors, GPIO register configuration on ARM Cortex-M)

**Next Topics**

- SPI Explained (higher-speed synchronous protocol, full-duplex, chip-select based multi-device, contrast with I2C)
- CAN Bus Explained (differential, multi-master, arbitration in automotive and industrial systems, error frames)
