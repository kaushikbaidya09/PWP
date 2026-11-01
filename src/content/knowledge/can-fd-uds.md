---
title: "CAN FD and UDS: Faster Frames and Vehicle Diagnostics"
brief: "What CAN FD changes, how ISO-TP splits long messages, and how UDS lets tools diagnose and update ECUs."
order: 57
phase: 9
tags: ["CAN FD", "ISO-TP", "UDS", "Diagnostics", "DTC"]
---

Classic CAN carries 8 bytes per frame. That suited a wheel speed in 1990. Today's firmware update for an ECU is many megabytes, and a mechanic's tool needs to read fault codes from every controller in a vehicle. CAN FD gives more bandwidth, and UDS gives a shared diagnostic language on top.

## The Fundamental Problem

Eight bytes at 500 kbit/s is too small for growing software. Yet the arbitration scheme limits bit rate, since all nodes must see each bit before the next begins. Long messages also need splitting and rebuilding, and every ECU maker needs the same way of answering a diagnostic tool.

## The Big Picture

![A tester sends UDS requests through ISO-TP over CAN FD to an ECU](/diagrams/uds_stack.svg)

### In Plain Terms

Imagine a meeting where everyone must politely take turns to speak. Choosing who speaks has to go slowly, so everyone hears. But once someone has the floor, nobody else needs to react, so they can talk much faster. That is CAN FD: slow for arbitration, then fast for the data.

UDS is like a doctor's visit for a car. The tester asks standard questions: "any faults?", "what is your software version?", "run this test". Every ECU understands the same questions. ISO-TP is the courier that splits long answers across several small frames.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **CAN FD** | Flexible data rate: up to 64 bytes per frame. |
| **BRS** | Bit rate switch: the data phase runs faster. |
| **DLC** | Data length code. |
| **ISO-TP** | ISO 15765-2: splits large messages over CAN. |
| **UDS** | ISO 14229: the unified diagnostic services. |
| **DTC** | Diagnostic trouble code. |
| **Session** | A diagnostic mode, such as default or programming. |
| **Security access** | A seed and key check before risky actions. |

## Classic CAN and CAN FD

| Feature | Classic CAN | CAN FD |
| --- | --- | --- |
| Payload | 8 bytes | 64 bytes |
| Data rate | Up to 1 Mbit/s | Commonly 2 to 5 Mbit/s |
| Arbitration | Same rate | Same rate as classic |
| CRC | 15-bit | 17 or 21-bit |

## How It Works

### Step 1: Arbitrate

Nodes compete at the normal rate, using ID priority.

### Step 2: Switch speed

With BRS set, the sender moves to the faster rate for data.

### Step 3: Segment

ISO-TP sends a First Frame with the length, and the receiver answers with Flow Control.

### Step 4: Send the rest

Consecutive Frames follow, numbered in sequence.

### Step 5: Handle the service

The ECU processes the UDS request and sends a response.

## A Closer Look: Why CAN FD Can Go Faster

Classic CAN is limited by a clever feature. During arbitration, every node on the bus reads each bit as it is being sent, to decide who wins. For this to work, a bit must travel to the far end of the bus and back before the next one begins. The physical length of the wire sets the speed.

But that only matters while several nodes are competing. Once one node has won, everyone else just listens. No one needs to answer within the same bit.

CAN FD uses this. It runs arbitration at the normal rate, then at one flag, the bit rate switch, the winner speeds up for the data. Near the end, it drops back to the slow rate for the acknowledgement, when all nodes need to take part again.

So the overall rule stays the same, and only the middle of the frame goes faster. That also raises payload from 8 to 64 bytes. The result is that a frame takes less time on the bus while carrying far more data.

## A Worked Example: Reading a Fault

A tester reads stored fault codes. The UDS service for this is `0x19`:

```text
Tester -> ECU:  19 02 08          ReadDTCInformation, status mask
ECU -> Tester:  59 02 FF 01 23 45 08 ...
```

A positive response adds 0x40 to the service ID, so `0x19` returns `0x59`. If the request cannot be done, the ECU sends a negative response, `7F 19 22`, where `22` means conditions are not correct.

A firmware update follows a sequence. The tester enters programming session with `10 02`, and unlocks with security access `27`. It then calls `34` to request download, sends blocks using `36`, finishes with `37`, and resets with `11 01`. Each step checks the last, so a failed transfer never runs bad code.

On Linux, `candump can0` shows traffic, and the kernel's ISO-TP sockets handle segmentation.

## Common Questions

**Can CAN FD and classic CAN share a bus?** Only if classic nodes are never sent FD frames, or they are FD-tolerant. Otherwise they raise errors.

**What is the difference between OBD-II and UDS?** OBD-II is a legal standard for emissions data. UDS is a broader diagnostic protocol.

**Why is ISO-TP needed?** A UDS message can be far larger than a single frame.

**What is a DID?** A data identifier: a number that names a value you can read, like a software version.

## Under the Hood

CAN FD's speed change happens inside a frame, so bit timing has two parts, nominal and data, each with a sample point. The transmitter delay matters at high rates, which is why controllers use transmitter delay compensation. Transceivers must also be rated for the data rate, and older ones can destroy bus traffic.

The node-to-node acknowledgement still happens at the slow rate at the end of the frame.

Security access in older ECUs has been weak, with short keys and simple algorithms. Newer designs use stronger authentication, such as UDS service `0x29`, using certificates.

## Real-World Applications

**Automotive ECUs.** Most new vehicles use CAN FD and UDS.

**OBD scan tools.** Repair shops read fault codes.

**End-of-line testing.** Factories program and check each ECU.

**Commercial vehicles.** Similar diagnostics are used with J1939-based systems.

## Common Mistakes

### Mistake 1: Wrong data-phase timing

**What goes wrong:** Errors only appear with BRS enabled.

**How to avoid it:** Set a matching sample point on every node.

### Mistake 2: Mixing classic nodes on an FD bus

**What goes wrong:** Classic nodes see FD frames as errors and disrupt the bus.

**How to avoid it:** Use FD-tolerant parts, or separate networks.

### Mistake 3: Weak security access

**What goes wrong:** Anyone with a tool can reprogram an ECU.

**How to avoid it:** Use strong keys unique per ECU, and limit attempts.

## Debugging and Troubleshooting

**Symptom:** Error frames only during the data phase

**Possible Cause:** Long stubs, bad termination or timing.

**Investigation Method:** Scope the bus, and read error counters with `ip -details -statistics link show can0`.

**Resolution:** Shorten stubs, and fix termination and sample points.

**Symptom:** ISO-TP transfers time out

**Possible Cause:** Missing Flow Control, or wrong address IDs.

**Investigation Method:** Capture with `candump` and follow the sequence.

**Resolution:** Fix IDs and timing parameters.

## Design Considerations and Best Practices

**Choose the bit rate for your wiring.** Test the longest real harness.

**Keep sessions safe.** Refuse programming while the vehicle is moving.

**Verify before activating.** Check signatures before marking new firmware valid.

**Document your DIDs and DTCs.** Tools depend on these identifiers for years.

## Expert Notes

**Sample point mismatch is the top FD bug.** Use the same sample point across all nodes, particularly in the data phase.

**CAN XL and Automotive Ethernet are coming.** Plan your architecture for more data, as updates and sensors keep growing.

**Log negative responses.** UDS codes such as `0x22` and `0x33` explain exactly why an ECU refused, and they save hours.

## Summary

CAN FD keeps the same arbitration but sends data faster, with up to 64 bytes per frame. ISO-TP splits long messages over those frames, and UDS gives tools a common way to read faults and update firmware. Get bit timing right, keep classic nodes separate, and treat diagnostic access as a security boundary.

## Related Topics

**Prerequisites**

- CAN Bus Explained

**Next Topics**

- Bootloaders and Firmware Updates
- Secure Boot Chain
