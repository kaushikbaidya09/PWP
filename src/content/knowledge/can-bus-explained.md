---
title: "CAN Bus Explained: Reliable Communication Between Vehicle Controllers"
brief: "How CAN's differential bus, bitwise arbitration, error confinement and acceptance filters make it the backbone of vehicle networks."
order: 19
phase: 4
tags: ["CAN", "Arbitration", "Frame", "Differential"]
---

Picture a modern car. Under the hood, an engine control unit monitors fuel injection timing and exhaust temperature.

Before CAN existed, engineers wired each sensor directly to each controller that needed its data. A car with twenty electronic control units and fifty signals quickly becomes a wiring harness weighing thirty kilograms and containing thousands of individual connections.

## The Fundamental Problem

The naive approach to connecting ten microcontrollers is to wire them in a star or ring topology, give each one a unique address, and let them send data packets to specific destinations. This is how Ethernet works, and for high-bandwidth office networks it is perfectly reasonable.

Standard UART, the protocol most engineers learn first, fails immediately in this context. UART is point-to-point — two devices only.

## The Big Picture

![CAN Bus Topology and Frame Structure](/diagrams/can_bus.svg)

CAN is a BROADCAST BUS. Every node receives every message.

The physical bus is a terminated twisted-pair. Two bus lines, CAN_H and CAN_L, carry complementary signals.

## [120r] CAN_H / CAN_L (Twisted Pair) [120r]

All nodes receive all messages. Any node may transmit.

In the OSI model, CAN covers the physical layer (differential signaling, bit timing) and the data link layer (framing, arbitration, error detection, and acknowledgment). Everything above — message routing, application-layer protocols like CANopen, J1939, or AUTOSAR COM — is built on top by software.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Differential Signaling** | CAN_H and CAN_L are driven to complementary voltages rather than referencing a common ground. |
| **Dominant and Recessive** | CAN uses a wired-AND bus logic. |
| **Arbitration** | When multiple nodes want to transmit simultaneously, each transmits its message identifier bit by bit while monitoring the bus. |
| **Message Identifier (CAN Id)** | Standard CAN (CAN 2.0A) uses an 11-bit identifier, giving 2048 possible message IDs. |
| **Bit Stuffing** | CAN uses NRZ (Non-Return-to-Zero) encoding, which means clock edges are embedded in signal transitions. |
| **Error Frame** | When a node detects a protocol error (CRC mismatch, bit error, form error, etc.), it deliberately transmits 6 dominant bits in a row — which is itself a bit stuffing violation. |

## How It Works

### Step 1: Bus idle detection and frame start

The bus sits recessive (both lines at ~2.5V) when no node is transmitting. A node that wants to transmit waits for the bus to be idle for at least 3 recessive bits (the interframe space).

### Step 2: Arbitration: Who wins the bus

After SOF, the transmitting node outputs its 11-bit (or 29-bit) message identifier, MSB first, while simultaneously reading back what is actually on the bus. Each node does the same.

### Step 3: Frame structure: Control, data, CRC

After the arbitration field, the Control field encodes the IDE bit (standard vs. extended format), the RTR bit (data frame vs. remote frame request), and the DLC (Data Length Code, 0-8 bytes). The Data field carries the payload — up to 8 bytes in classical CAN.

### Step 4: Acknowledgment: Distributed confirmation

The ACK slot is a single recessive bit transmitted by the sender. ANY node on the bus that successfully received and verified the frame up to this point drives the ACK slot dominant.

### Step 5: Bit stuffing in action

As the transmitter serializes bits, dedicated hardware counts consecutive same-polarity bits. After five, it inserts one of the opposite polarity before continuing.

### Step 6: Error detection: Six independent checks

CAN hardware performs six error checks simultaneously: (1) CRC check on the received frame; (2) bit monitoring — every transmitter reads back what it just sent and checks for agreement; (3) bit stuffing rule violations; (4) form errors — fixed-format fields (CRC delimiter, ACK delimiter, EOF) must be recessive; (5) acknowledgment error — sender checks the ACK slot; (6) overload frames — a node that needs more time before receiving the next frame can transmit an overload frame. If any check fails, the detecting node transmits an error frame, incrementing its own error counter.

### Step 7: Error state machine and fault confinement

A node starts in Error Active state. As errors accumulate, TEC and REC climb.

## Under the Hood

Bit timing is the most misunderstood aspect of CAN implementation. A CAN bit period is divided into four segments: SYNC_SEG (always 1 time quantum), PROP_SEG (compensates for physical bus propagation delay), PHASE_SEG1, and PHASE_SEG2.

The CAN controller peripheral on modern MCUs (STM32 bxCAN, STM32 FDCAN, dsPIC ECAN, NXP FlexCAN) contains one or more transmit mailboxes and a receive FIFO with hardware acceptance filtering. On STM32 bxCAN, there are three transmit mailboxes prioritized by identifier value, and two receive FIFOs each capable of holding three frames.

## Real-World Applications

**Automotive** — This is where CAN was born, and it remains dominant. A typical mid-range vehicle contains two to five CAN networks segmented by speed and function: a high-speed CAN (500kbit/s or 1Mbit/s) for powertrain (engine ECU, transmission control, ABS), a medium-speed CAN for body electronics (BCM, HVAC, lighting), and a diagnostic CAN accessible via the OBD-II port.

**Industrial Automation** — CANopen (CiA 301) is the dominant industrial CAN protocol, defining a device object dictionary, process data objects (PDO) for real-time exchange, and service data objects (SDO) for configuration. A CNC machine tool might use CANopen to command six servo axes simultaneously, with each axis controller sending position feedback at 1ms intervals and the master broadcasting synchronized motion commands.

## Common Mistakes

**Mistake 1** — MISSING OR WRONG TERMINATION RESISTORS What goes wrong: Omitting the 120-ohm termination resistors, or placing them incorrectly (in the middle of the bus rather than at each physical end), causes signal reflections. At 500kbit/s and above, reflections can corrupt bits intermittently. How to avoid: Measure resistance between CAN_H and CAN_L with the bus unpowered.

**Mistake 2** — TESTING A SINGLE NODE WITH NO OTHER ACTIVE NODES What goes wrong: A CAN node transmitting with no other nodes present will never receive an ACK. TEC increments by 8 per failed transmission. Within seconds the node goes Bus Off and stops transmitting entirely.

**Mistake 3** — BAUD RATE MISMATCH What goes wrong: CAN has no automatic baud rate negotiation. If one node runs at 250kbit/s and another at 500kbit/s, every frame looks like garbage to the mismatched node. It will continuously transmit error frames, causing network disruption.

## Debugging and Troubleshooting

**Symptom:** Node transmits but no other node receives.

**Possible Cause:** No other active node is present to assert the ACK slot dominant, OR termination is missing and the ACK slot is corrupted by reflections.

**Investigation Method:** Probe CAN_H and CAN_L with an oscilloscope.

**Resolution:** Add a second active node or a USB-CAN device.

---

**Symptom:** Network stable under light traffic but produces burst errors under sustained load.

**Possible Cause:** Baud rate sample point is marginal.

**Investigation Method:** Use a CAN analyzer (PEAK PCAN, Kvaser, or Vector CANalyzer) to log frames.

**Resolution:** Recalculate bit timing with wider PHASE_SEG1/SEG2 to increase resynchronization jump width (SJW).

---

## Design Considerations and Best Practices

1. **Always Use a Dedicated Can Transceiver Ic.** Never connect a CAN controller's TX/RX pins directly to the bus. The transceiver performs differential driving, common-mode rejection, bus protection (up to +-58V on TJA1050), and thermal shutdown. The CAN controller output is single-ended 3.3V or 5V logic — connecting it directly violates ISO 11898 and results in reduced noise immunity and potential hardware damage.

2. ISOLATE THE CAN BUS ELECTRICALLY on nodes that may experience large ground potential differences or are safety-critical.

## Expert Notes

**The ACK mechanism does not confirm the correct receiver got the message.** CAN's acknowledgment only tells the transmitter that at least one node received a valid frame. If the intended consumer of a message has its acceptance filter misconfigured, or is in Bus Off state, or has crashed, the transmitter will still see ACK from other nodes and consider the transmission successful.

**Bit stuffing makes frame timing NON-DETERMINISTIC.** A CAN data frame with 8 bytes of all-zeros data will have a different number of stuff bits than the same frame with a checkerboard data pattern. Worst-case frame length for scheduling analysis must assume maximum stuff bits.

## Summary

CAN bus exists because the naive approach of wiring every sensor to every controller does not scale, and because standard serial protocols designed for point-to-point or benign environments cannot survive the electrical reality of motor drives, ignition systems, and industrial machinery. Bosch's answer was a broadcast bus with differential signaling, wired-AND logic, and a priority-based arbitration scheme that requires no master, produces no collisions, and imposes no retry penalty on the winning transmitter.

The protocol's robustness comes from layers of independent error detection — CRC, bit monitoring, bit stuffing, form checks, and acknowledgment — combined with a hardware error counter state machine that gracefully degrades a faulty node from full participation to passive observation to complete disconnection, all without software intervention. This fault confinement design is what makes CAN suitable for safety-relevant applications where a single node failure must not take down the network.

## Related Topics

**Prerequisites**

- Serial Communication Fundamentals
- Interrupts

**Next Topics**

- Embedded Security Fundamentals
- Fault Handling and Crash Analysis
- CAN FD and UDS
