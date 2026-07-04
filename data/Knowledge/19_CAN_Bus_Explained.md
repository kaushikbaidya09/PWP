---
id: can-bus-explained
tags: ['CAN', 'Arbitration', 'Frame', 'Differential']
---

# CAN Bus Explained: Differential Signaling, Arbitration, Frames, and Fault Confinement

Picture a modern car. Under the hood, an engine control unit monitors fuel injection timing and exhaust temperature. On the dashboard, the instrument cluster reads engine RPM, coolant temperature, and vehicle speed. In the door, a body control module manages window motors and mirror actuators. In the trunk, an ABS controller is watching wheel speeds sixty times per second. These are not four separate systems -- they are a conversation, and every word of that conversation travels on a single pair of wires called a CAN bus.

Before CAN existed, engineers wired each sensor directly to each controller that needed its data. A car with twenty electronic control units and fifty signals quickly becomes a wiring harness weighing thirty kilograms and containing thousands of individual connections. Every added feature demanded more copper. Fault isolation was a nightmare. The obvious solution -- point-to-point wiring -- broke under its own weight as vehicle electronics grew in the 1980s.

Bosch developed the Controller Area Network specification in 1986 specifically to solve this problem. CAN is a MULTI-MASTER SERIAL BUS designed for real-time control applications where nodes need to share data reliably, detect faults gracefully, and operate in electrically hostile environments. The ISO 11898 standard codified it, and today CAN appears in every domain where you need robust, deterministic communication between microcontrollers: automotive, industrial automation, medical equipment, robotics, and aerospace.

What makes CAN remarkable is not any single feature but the combination: differential signaling that rejects electrical noise, a priority-based arbitration scheme that requires no bus master, a message-oriented model where any node can consume any message, and a layered error-detection and fault confinement system that keeps a single broken node from silencing the entire network. Understanding why each of these design choices was made is what separates engineers who can configure a CAN peripheral from engineers who can debug it at 3am in a prototype vehicle.

By the end of this article, you will understand how CAN differential signaling works and why it tolerates noise, how multi-master arbitration resolves bus contention without collisions or a central arbiter, what every field in a CAN data frame does, how bit stuffing maintains synchronization, how the error-handling state machine protects the network, and how CAN FD extends the original protocol for higher-bandwidth applications.

## The Fundamental Problem

The naive approach to connecting ten microcontrollers is to wire them in a star or ring topology, give each one a unique address, and let them send data packets to specific destinations. This is how Ethernet works, and for high-bandwidth office networks it is perfectly reasonable. The problem is that embedded control systems have radically different requirements: they operate in environments saturated with electromagnetic interference from ignition coils, motor windings, and switching power supplies; they need deterministic latency guarantees so a braking command arrives within microseconds, not milliseconds; and they need to keep functioning even when one node develops a fault.

Standard UART, the protocol most engineers learn first, fails immediately in this context. UART is point-to-point -- two devices only. Extending it to multiple nodes requires a bus master to poll each device in sequence, which destroys real-time response. It uses single-ended signaling referenced to ground, which means any noise induced on the signal wire goes straight into the receiver. And UART has no concept of message priority: a low-priority temperature reading and a high-priority emergency brake signal look identical to the hardware.

SPI and I2C fix the multi-node problem but introduce their own limitations. I2C is too slow for real-time control at 100kHz or 400kHz, and its open-drain architecture does not provide the noise immunity needed in automotive environments. SPI requires a chip-select line per device, which scales poorly, and it has no built-in error detection beyond whatever you implement in software. Neither protocol was designed for environments where a single node failure must not bring down the entire network. CAN was designed from scratch with all of these failure modes in mind, which is why its architecture looks different from every other serial protocol you have worked with.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/can_bus.svg" alt="CAN Bus Topology and Frame Structure" loading="lazy">
</div>

CAN is a BROADCAST BUS. Every node receives every message. There is no addressing in the traditional sense -- messages carry an identifier that describes what data they contain, not who should receive it. Any node that cares about a particular message ID listens for it; nodes that do not care ignore it. This inversion of the addressing model is fundamental to understanding CAN: you are not sending a packet to a device, you are publishing a signal onto a shared medium.

The physical bus is a terminated twisted-pair. Two bus lines, CAN_H and CAN_L, carry complementary signals. All nodes connect to this same pair in a daisy-chain or short stub topology. At each end of the bus, a 120-ohm termination resistor prevents reflections. The CAN transceiver in each node translates between the MCU's single-ended logic and the differential bus voltage. The MCU's CAN controller peripheral handles framing, arbitration, bit stuffing, and error detection entirely in hardware.

## [120r] Can_h / Can_l (twisted Pair) [120r]

All nodes receive all messages. Any node may transmit. Higher-priority message IDs always win bus arbitration.

In the OSI model, CAN covers the physical layer (differential signaling, bit timing) and the data link layer (framing, arbitration, error detection, and acknowledgment). Everything above -- message routing, application-layer protocols like CANopen, J1939, or AUTOSAR COM -- is built on top by software. When debugging a CAN problem, the first question is always whether the fault is at the physical layer (bad termination, shorted bus, noise) or at the protocol layer (wrong baud rate, timing error, filter misconfiguration).

## Key Concepts and Terminology

**Differential Signaling** — CAN_H and CAN_L are driven to complementary voltages rather than referencing a common ground. A receiver determines bit value from the DIFFERENCE between the two lines (nominally 2V for dominant, 0V for recessive). Because noise couples equally onto both lines, it cancels in the subtraction. This is why CAN works in engine bays where single-ended UART cannot.

**Dominant and Recessive** — CAN uses a wired-AND bus logic. A DOMINANT bit (logic 0) is actively driven: CAN_H at ~3.5V, CAN_L at ~1.5V, differential ~2V. A RECESSIVE bit (logic 1) is not driven -- both lines float to ~2.5V via the termination resistors. If any node drives dominant, the bus is dominant, regardless of what other nodes are doing. This property is the foundation of arbitration and error signaling.

**Arbitration** — When multiple nodes want to transmit simultaneously, each transmits its message identifier bit by bit while monitoring the bus. If a node transmits a recessive bit but sees a dominant bit on the bus, another node with a lower (numerically smaller) ID is also transmitting and will win. The losing node backs off immediately and waits for the bus to go idle. The winning node never stops transmitting -- there is no collision or retry delay. Lower ID value means higher priority.

**Message Identifier (can Id)** — Standard CAN (CAN 2.0A) uses an 11-bit identifier, giving 2048 possible message IDs. Extended CAN (CAN 2.0B) uses a 29-bit identifier. The ID does not identify a node -- it identifies the content or type of data. A single node may transmit dozens of different message IDs, and multiple nodes may be interested in receiving the same ID. Priority is determined entirely by numeric ID value: ID 0x000 is the highest priority possible.

**Bit Stuffing** — CAN uses NRZ (Non-Return-to-Zero) encoding, which means clock edges are embedded in signal transitions. After five consecutive bits of the same polarity in the data stream, the transmitter inserts one bit of opposite polarity (a stuff bit). Receivers detect and discard these inserted bits. Without stuffing, a long run of recessive bits would leave the bus with no transitions, causing receivers to lose synchronization with the transmitter's clock.

**Error Frame** — When a node detects a protocol error (CRC mismatch, bit error, form error, etc.), it deliberately transmits 6 dominant bits in a row -- which is itself a bit stuffing violation. This active error flag destroys the current frame, forces all other nodes to recognize the error, and triggers the sender to retransmit. Error frames are the network's self-healing mechanism.

**Transmit Error Counter (tec) and Receive Error Counter (rec)** — Every CAN node maintains two hardware counters. TEC increments by 8 on each transmit error and decrements by 1 on each successful transmission. REC behaves similarly for receive errors. These counters gate three operational states: Error Active (healthy), Error Passive (quiet error flags), and Bus Off (node disconnects from bus). This graduated response prevents a single faulty node from flooding the network with error frames.

**Acceptance Filter** — CAN hardware peripherals (on STM32, dsPIC, NXP S32K, etc.) implement acceptance filters in silicon. The filter is a mask-and-match circuit that the MCU configures at init time. Only frames whose IDs pass the filter generate an interrupt or fill a receive FIFO -- the rest are discarded in hardware without CPU involvement. Misunderstanding filter configuration is one of the most common sources of "I'm not receiving messages" bugs.

**Can Fd (flexible Data-Rate)** — ISO 11898-1:2015 extension that allows the data phase of a frame to be transmitted at a higher bit rate than the arbitration phase, and expands the data payload from 8 bytes to up to 64 bytes per frame. The arbitration phase still runs at the classical CAN rate (for backward compatibility in mixed networks), but the payload phase can run at 2, 5, or 8 Mbit/s. CAN FD requires CAN FD-capable transceivers and controllers -- classical CAN nodes will misinterpret CAN FD frames.

## How It Works

### Step 1: Bus Idle Detection and Frame Start the Bus Sits Recessive (both Lines at ~2.5v) When No Node Is Transmitting. a Node That Wants to Transmit Waits for the Bus to Be Idle for at Least 3 Recessive Bits (the Interframe Space). It Then Asserts the Start-of-Frame (sof) Bit -- a Single Dominant Bit -- Which Also Serves As a Synchronization Edge for All Receivers. All Nodes on the Bus Synchronize Their Internal Bit Clocks to This Falling Edge, Which Is Why Consistent Bit Timing Across All Nodes Is Critical for a Stable Network.

### Step 2: Arbitration: Who Wins the Bus After Sof, the Transmitting Node Outputs Its 11-Bit (or 29-Bit) Message Identifier, Msb First, While Simultaneously Reading Back What Is Actually on the Bus. Each Node Does the Same. If a Node Transmits a Recessive Bit (1) but Reads Back a Dominant Bit (0), It Knows a Higher-Priority Node Is Also Transmitting. It Immediately Stops Transmitting, Switches to Receive Mode, and Will Retry After the Current Frame Ends. the Winning Node Never Pauses -- the Message Is Delivered with Zero Delay Penalty. This Is Non-Destructive Arbitration: Unlike Csma/cd (ethernet), There Is No Collision and No Backoff Algorithm.

### Step 3: Frame Structure: Control, Data, Crc After the Arbitration Field, the Control Field Encodes the Ide Bit (standard Vs. Extended Format), the Rtr Bit (data Frame Vs. Remote Frame Request), and the Dlc (data Length Code, 0-8 Bytes). the Data Field Carries the Payload -- Up to 8 Bytes in Classical Can. Following the Data Is a 15-Bit Crc Calculated Over the Sof, Arbitration Field, Control Field, and Data Field. the Transmitter Appends the Crc, Then a Crc Delimiter (recessive), Then the Ack Slot.

### Step 4: Acknowledgment: Distributed Confirmation the Ack Slot Is a Single Recessive Bit Transmitted by the Sender. Any Node on the Bus That Successfully Received and Verified the Frame Up to This Point Drives the Ack Slot Dominant. the Sender Reads Back the Ack Slot -- If It Sees Dominant, at Least One Other Node Received the Frame Correctly. If It Reads Recessive (no Acknowledgment), the Sender Knows Something Went Wrong and Increments Its Tec. Note That the Sender Cannot Tell Which Node Acknowledged -- Only That at Least One Did. This Is Why a Lone Node on a Bench, with No Other Nodes Present, Will See Its Tec Climb and Eventually Go Bus Off.

### Step 5: Bit Stuffing in Action As the Transmitter Serializes Bits, Dedicated Hardware Counts Consecutive Same-Polarity Bits. After Five, It Inserts One of the Opposite Polarity Before Continuing. the Receiver Does the Same Counting And, When It Sees Five Consecutive Same-Polarity Bits Followed by the Opposite, It Discards That Inserted Bit Without Passing It Up the Stack. This Happens Transparently and Continuously Throughout the Sof Through Crc Sequence. the Can Frame Timing You See in Datasheets Refers to the Bit Count Before Stuff Bits Are Added -- the Actual Frame Length on the Wire Is Longer by the Number of Stuff Bits Generated, Which Depends on the Data.

### Step 6: Error Detection: Six Independent Checks Can Hardware Performs Six Error Checks Simultaneously: (1) Crc Check on the Received Frame; (2) Bit Monitoring -- Every Transmitter Reads Back What It Just Sent and Checks for Agreement; (3) Bit Stuffing Rule Violations; (4) Form Errors -- Fixed-Format Fields (crc Delimiter, Ack Delimiter, Eof) Must Be Recessive; (5) Acknowledgment Error -- Sender Checks the Ack Slot; (6) Overload Frames -- a Node That Needs More Time Before Receiving the Next Frame Can Transmit an Overload Frame. If Any Check Fails, the Detecting Node Transmits an Error Frame, Incrementing Its Own Error Counter.

### Step 7: Error State Machine and Fault Confinement a Node Starts in Error Active State. As Errors Accumulate, Tec and Rec Climb. at Tec or Rec Greater Than 127, the Node Enters Error Passive -- It Still Participates but Sends Passive Error Flags (6 Recessive Bits Rather Than 6 Dominant Bits, Which Are Much Less Disruptive). at Tec Greater Than 255, the Can Controller Hardware Disconnects the Node From the Bus (bus Off). Recovery From Bus Off Requires 128 Occurrences of 11 Consecutive Recessive Bits on the Bus, Followed by a Software or Hardware Reset of the Controller.

## Under the Hood

Bit timing is the most misunderstood aspect of CAN implementation. A CAN bit period is divided into four segments: SYNC_SEG (always 1 time quantum), PROP_SEG (compensates for physical bus propagation delay), PHASE_SEG1, and PHASE_SEG2. The sample point is between PHASE_SEG1 and PHASE_SEG2 -- this is when the CAN controller latches the bit value. The controller's oscillator is divided down by a prescaler (BRP) to produce the time quantum (TQ). Setting the baud rate is not just a matter of choosing a prescaler: you must set PROP_SEG long enough to cover twice the worst-case bus propagation delay, and position the sample point correctly -- typically 75-87.5% into the bit period for automotive CAN. On an STM32F4 running at 42 MHz APB1, a 500 kbit/s CAN bus might use BRP=6 (TQ = 142ns), PROP_SEG=7 TQ, PHASE_SEG1=8 TQ, PHASE_SEG2=4 TQ -- sample point at 80%. Getting this wrong produces intermittent bit errors under load that only show up when the bus approaches full utilization.

The CAN controller peripheral on modern MCUs (STM32 bxCAN, STM32 FDCAN, dsPIC ECAN, NXP FlexCAN) contains one or more transmit mailboxes and a receive FIFO with hardware acceptance filtering. On STM32 bxCAN, there are three transmit mailboxes prioritized by identifier value, and two receive FIFOs each capable of holding three frames. The acceptance filter bank uses a combination of mask-and-ID registers: a 32-bit mask defines which ID bits are "don't care" and a 32-bit identifier defines the required values of the non-masked bits. A common configuration mistake is setting the mask to 0xFFFFFFFF (all bits significant) and then wondering why no messages pass -- the filter requires an exact 29-bit ID match including reserved bits the application forgot to set.

CAN FD introduces a critical hardware difference: the transceiver must now support higher slew rates during the data phase. A classical TJA1050 transceiver limits slew rate to reduce EMI and cannot reliably transmit or receive CAN FD data-phase bits at 2 Mbit/s or above. For CAN FD you need transceivers explicitly rated for it -- TJA1044G, TJA1462, or TCAN1044 are common choices. The STM32G4's FDCAN peripheral has separate data-phase prescaler and segment values (DBRP, DTSEG1, DTSEG2) distinct from the arbitration-phase values (NBRP, NTSEG1, NTSEG2). A transmitter switching to fast data phase must complete its bit transitions before the receiver's sample point -- at 5 Mbit/s the bit period is 200ns and transceiver propagation delay becomes a dominant design constraint.

The CRC field in a classical CAN frame is a 15-bit CRC with generator polynomial x^15 + x^14 + x^10 + x^8 + x^7 + x^4 + x^3 + 1. CAN FD uses either a 17-bit or 21-bit CRC depending on data length, with additional CRC initialization values to improve error detection for longer payloads. The Hamming distance of the classical CAN CRC is 6 for frames up to 127 bits (before stuffing), meaning it can detect any combination of up to 5 bit errors. For frames of 127-1989 bits the Hamming distance drops to 4. This is one reason the original CAN spec limits data payloads to 8 bytes -- larger payloads would reduce the error detection capability of the 15-bit CRC to unacceptable levels, which is precisely why CAN FD needed new CRC polynomials.

## Real-World Applications

**Automotive** — This is where CAN was born, and it remains dominant. A typical mid-range vehicle contains two to five CAN networks segmented by speed and function: a high-speed CAN (500kbit/s or 1Mbit/s) for powertrain (engine ECU, transmission control, ABS), a medium-speed CAN for body electronics (BCM, HVAC, lighting), and a diagnostic CAN accessible via the OBD-II port. OBD-II is mandated in the USA since 1996 and uses CAN exclusively since 2008. ISO 15765-4 (UDS over CAN) is the diagnostic protocol. J1939 is a higher-layer CAN protocol used in heavy trucks and buses -- it uses 29-bit extended frames and defines a full parameter naming convention and transport protocol for multi-frame messages.

**Industrial Automation** — CANopen (CiA 301) is the dominant industrial CAN protocol, defining a device object dictionary, process data objects (PDO) for real-time exchange, and service data objects (SDO) for configuration. A CNC machine tool might use CANopen to command six servo axes simultaneously, with each axis controller sending position feedback at 1ms intervals and the master broadcasting synchronized motion commands. DeviceNet (IEC 62026-3) is another industrial CAN protocol common in North American factory automation.

**Medical** — CAN appears in imaging equipment, infusion pumps, surgical robots, and patient monitoring systems. The deterministic latency guarantee is critical: a surgical robot must relay force feedback and command actuators within a bounded time window regardless of other network traffic. Medical implementations require certified hardware and rigorous IEC 62443 and IEC 60601 compliance, but the underlying CAN protocol layer is identical to automotive use.

**Aerospace** — CAN is used in small aircraft, satellites, and UAVs. UAVCAN (now Cyphal) is an open protocol for aerospace-grade CAN FD applications, standardizing node health monitoring, firmware updates over CAN, and publish-subscribe messaging. Small satellite buses frequently use CAN to interconnect attitude control systems, power management units, and payload controllers.

IoT AND BUILDING AUTOMATION -- CAN appears in building management systems (BMS) for HVAC and access control, and in EV charging infrastructure. The ISO 11898-3 low-speed fault-tolerant CAN variant (max 125kbit/s) is used in body electronics where continuity of operation matters more than speed.

## Common Mistakes

**Mistake 1** — MISSING OR WRONG TERMINATION RESISTORS What goes wrong: Omitting the 120-ohm termination resistors, or placing them incorrectly (in the middle of the bus rather than at each physical end), causes signal reflections. At 500kbit/s and above, reflections can corrupt bits intermittently. How to avoid: Measure resistance between CAN_H and CAN_L with the bus unpowered. You should read approximately 60 ohms (two 120-ohm resistors in parallel). Place resistors physically at each end of the cable run.

**Mistake 2** — TESTING A SINGLE NODE WITH NO OTHER ACTIVE NODES What goes wrong: A CAN node transmitting with no other nodes present will never receive an ACK. TEC increments by 8 per failed transmission. Within seconds the node goes Bus Off and stops transmitting entirely. How to avoid: Always have at least two nodes (or use a USB-CAN adapter like PEAK PCAN or Kvaser) when testing. Alternatively configure the CAN controller in loopback mode -- most CAN peripherals support this for solo unit testing.

**Mistake 3** — BAUD RATE MISMATCH What goes wrong: CAN has no automatic baud rate negotiation. If one node runs at 250kbit/s and another at 500kbit/s, every frame looks like garbage to the mismatched node. It will continuously transmit error frames, causing network disruption. How to avoid: Calculate bit timing from first principles using the actual peripheral clock frequency. Do not copy TQ and segment values from an example for a different MCU. Use the MCU vendor's bit timing calculator, then verify with an oscilloscope.

**Mistake 4** — ACCEPTANCE FILTER MISCONFIGURATION What goes wrong: Setting the filter mask incorrectly causes the node to receive no messages (filter too restrictive) or every message (filter too permissive, flooding the CPU). On STM32 bxCAN, the filter mask register is 1-means-must-match and 0-means-don't-care. How to avoid: Read your specific CAN peripheral's filter documentation carefully -- the mask polarity convention varies between vendors. Write a test that sends a known message ID and verify the filter passes it before connecting to a live network.

**Mistake 5** — NOT HANDLING BUS OFF RECOVERY IN FIRMWARE What goes wrong: Many CAN driver implementations initialize the peripheral and start transmitting, but never implement the Bus Off interrupt handler or recovery procedure. When the node goes Bus Off, it stays silent forever until someone power-cycles the unit. How to avoid: Always implement the error interrupt handler. Monitor the CAN controller's Error Status Register. On Bus Off detection, schedule a recovery attempt after a brief delay. Log the event to non-volatile memory for diagnostics.

**Mistake 6** — ASSIGNING THE SAME MESSAGE ID TO TWO TRANSMITTING NODES What goes wrong: CAN arbitration assumes a given message ID is owned by exactly one transmitter. If two nodes transmit the same ID, they win arbitration simultaneously and transmit conflicting data bits, causing bit errors and network instability that is very difficult to trace. How to avoid: Maintain a network-wide message ID database (a DBC file in automotive, a CANopen EDS file in industrial). Review it before assigning IDs to new messages.

**Mistake 7** — USING CLASSICAL CAN TRANSCEIVERS FOR CAN FD What goes wrong: Classical CAN transceivers have slew rate limiting that prevents them from reliably switching at CAN FD data-phase rates. A network that uses CAN FD controllers but classical transceivers will appear to work at low data-phase bit rates but produce intermittent bit errors at higher rates. How to avoid: Verify transceiver datasheets explicitly state CAN FD support and list the maximum data-phase bit rate supported. Check the loop delay symmetry specification.

## Debugging and Troubleshooting

**Symptom:** Node transmits but no other node receives. TEC steadily increases until Bus Off.

**Possible Cause:** No other active node is present to assert the ACK slot dominant, OR termination is missing and the ACK slot is corrupted by reflections.

**Investigation Method:** Probe CAN_H and CAN_L with an oscilloscope. Verify the ACK slot (second recessive bit after the CRC delimiter) shows a dominant pulse. Measure CAN_H-to-CAN_L resistance with power off -- should be ~60 ohms.

**Resolution:** Add a second active node or a USB-CAN device. Add or reposition 120-ohm termination resistors at the physical ends of the bus cable.

---

**Symptom:** Network stable under light traffic but produces burst errors under sustained load.

**Possible Cause:** Baud rate sample point is marginal. Termination reflections that tolerate low duty-cycle become destructive at full load. Oscillator tolerance accumulation between multiple nodes.

**Investigation Method:** Use a CAN analyzer (PEAK PCAN, Kvaser, or Vector CANalyzer) to log frames. Check error frame rate. Use an oscilloscope in persistence mode to look for bit timing jitter near the sample point. Verify all node clock sources are within CAN spec (max 1.58% total network oscillator tolerance for 500kbit/s).

**Resolution:** Recalculate bit timing with wider PHASE_SEG1/SEG2 to increase resynchronization jump width (SJW). Check oscillator accuracy -- ceramic resonators may not meet CAN tolerance requirements; use crystals.

---

**Symptom:** Specific message IDs are never received by a node, even though a CAN analyzer confirms they are present on the bus.

**Possible Cause:** Acceptance filter is configured incorrectly. The hardware is discarding the frames before they reach the receive FIFO.

**Investigation Method:** Temporarily configure the filter to accept ALL frames (mask = 0x0000, all don't-care). If the message is now received, the filter configuration is wrong. Read back the filter registers to confirm they match your initialization code.

**Resolution:** Recalculate the mask and ID filter values for the target message IDs. Pay attention to extended vs. standard frame bit alignment in the filter register -- on STM32 bxCAN these are different register layouts selected by FBM and FMI bits in CAN_FM1R.

---

**Symptom:** Node enters Bus Off state intermittently, seemingly at random, with no obvious physical fault.

**Possible Cause:** Duplicate message ID transmitted by two nodes. EMI burst causing a run of bit errors. Bus Off recovery routine re-enters Bus Off immediately because the underlying fault persists.

**Investigation Method:** Log TEC/REC values in the error interrupt. Capture bus traffic with a CAN analyzer when Bus Off occurs -- look for error frames and note which message IDs precede them. Check for ground loops or high-current switching near the CAN wiring harness.

**Resolution:** Audit message ID assignments across all nodes. Add ferrite beads and proper twisted-pair routing away from high-current traces. Implement exponential backoff in the Bus Off recovery routine.

## Design Considerations and Best Practices

1. **Always Use a Dedicated Can Transceiver Ic.** Never connect a CAN controller's TX/RX pins directly to the bus. The transceiver performs differential driving, common-mode rejection, bus protection (up to +-58V on TJA1050), and thermal shutdown. The CAN controller output is single-ended 3.3V or 5V logic -- connecting it directly violates ISO 11898 and results in reduced noise immunity and potential hardware damage.

2. ISOLATE THE CAN BUS ELECTRICALLY on nodes that may experience large ground potential differences or are safety-critical. In vehicles, chassis ground can vary by several volts between body panels. ISO-CAN transceivers (ISO1050, ADM3053) provide galvanic isolation up to 2500V, protecting both the MCU and the bus from ground-referenced faults.

3. DEFINE AND MAINTAIN A DBC FILE OR EQUIVALENT MESSAGE DATABASE before writing any firmware. A DBC file specifies every message ID, its transmitter, its cycle time, and the encoding of every signal within it. Without this, duplicate ID assignment and signal encoding mistakes are nearly inevitable in multi-engineer projects.

4. DESIGN BUS OFF RECOVERY AS A DELIBERATE STATE in your application logic, not as an afterthought. The correct recovery behavior is application-dependent. A braking ECU should attempt recovery immediately and alert the driver. A non-critical display node might wait longer and implement exponential backoff to avoid flooding the network with recovery attempts during a persistent fault.

5. KEEP BUS UTILIZATION BELOW 70-80% under normal operating conditions. CAN is a shared medium. At 100% bus load, higher-priority messages will starve lower-priority ones indefinitely. The headroom accommodates diagnostic traffic, fault-triggered messages, and the statistical distribution of simultaneous transmit requests.

6. ROUTE CAN WIRING AS A DAISY-CHAIN (trunk with short stubs), not as a star topology. Stubs create signal reflections. At 500kbit/s, stubs longer than about 30cm can cause reflected waves to corrupt the bit value at the sample point. At 1Mbit/s the maximum stub is approximately 10cm.

7. USE TIME-TRIGGERED CAN (TTCAN, ISO 11898-4) when your application requires bounded worst-case latency guarantees, not just priority guarantees. Standard CAN provides priority-based arbitration -- the highest-priority message wins, but its actual latency depends on what messages are currently transmitting. Under maximum bus load, a low-priority message may be delayed indefinitely.

8. FOR CAN FD, VERIFY BIT TIMING FOR BOTH PHASES with your specific transceiver and cable length before production. CAN FD data-phase bit timing is far less tolerant of propagation delay and transceiver loop delay asymmetry than classical CAN. What works on a bench with 30cm of wire may fail in a vehicle with 3m of cable.

## Expert Notes

THE ACK MECHANISM DOES NOT CONFIRM THE CORRECT RECEIVER GOT THE MESSAGE. CAN's acknowledgment only tells the transmitter that at least one node received a valid frame. If the intended consumer of a message has its acceptance filter misconfigured, or is in Bus Off state, or has crashed, the transmitter will still see ACK from other nodes and consider the transmission successful. Application-layer heartbeat/alive monitoring (standard in CANopen and J1939) is the only way to detect that a specific node is not functioning. Never rely on CAN ACK as an application-layer confirmation.

BIT STUFFING MAKES FRAME TIMING NON-DETERMINISTIC. A CAN data frame with 8 bytes of all-zeros data will have a different number of stuff bits than the same frame with a checkerboard data pattern. Worst-case frame length for scheduling analysis must assume maximum stuff bits. For a standard CAN frame with 8 bytes of data, worst-case is 135 bits including stuffing. Engineers who calculate bus load from the nominal 111-bit frame length will underestimate worst-case bus utilization by approximately 20%.

THE ERROR PASSIVE STATE IS A WARNING, NOT A FAILURE MODE. Textbooks typically discuss Error Active and Bus Off, but Error Passive is where insidious intermittent problems hide. A node in Error Passive can still receive and transmit normally -- it just sends quieter error flags. If your TEC or REC is hovering between 96 and 127 without going Bus Off, you have a persistent marginal fault (bad termination, marginal bit timing, mild EMI) that will eventually cause sporadic data corruption. Monitor TEC and REC in your diagnostics; do not wait for Bus Off to investigate.

CAN BUS FAILURE MODES IN PRODUCTION ARE DOMINATED BY PHYSICAL LAYER ISSUES. In design validation, most CAN bugs are software: wrong baud rate, filter misconfiguration, missing Bus Off handler. In production field returns, the overwhelming majority are physical: corroded connectors (CAN_H or CAN_L goes open), chafed wire harnesses, failed termination resistors, or water ingress changing bus impedance. ISO 11898-2 specifies that CAN must continue to function with one of the two bus lines open or shorted to ground -- design your connector selection and harness routing to respect this and not exceed it.

HIGHER-LAYER PROTOCOL CHOICE HAS MORE IMPACT THAN CAN TUNING. J1939, CANopen, and raw CAN look similar from the wire but impose very different constraints on your firmware architecture. CANopen's PDO mapping model requires configuring which object dictionary entries are mapped to which PDOs during network startup -- getting this wrong silently produces the right data in the wrong byte of the payload. Before choosing a CAN stack or writing your own, confirm whether your application needs only the CAN frame layer or a full higher-layer protocol, and allocate engineering time accordingly.

## Summary

CAN bus exists because the naive approach of wiring every sensor to every controller does not scale, and because standard serial protocols designed for point-to-point or benign environments cannot survive the electrical reality of motor drives, ignition systems, and industrial machinery. Bosch's answer was a broadcast bus with differential signaling, wired-AND logic, and a priority-based arbitration scheme that requires no master, produces no collisions, and imposes no retry penalty on the winning transmitter.

The protocol's robustness comes from layers of independent error detection -- CRC, bit monitoring, bit stuffing, form checks, and acknowledgment -- combined with a hardware error counter state machine that gracefully degrades a faulty node from full participation to passive observation to complete disconnection, all without software intervention. This fault confinement design is what makes CAN suitable for safety-relevant applications where a single node failure must not take down the network.

CAN FD extends the original protocol's bandwidth by switching to a faster bit rate after arbitration completes, and expands the payload to 64 bytes -- but at the cost of stricter physical layer requirements. Mixed CAN/CAN FD networks require careful transceiver selection, recalculated bit timing for both phases, and an understanding of what classical CAN nodes will do when they see a CAN FD frame (they will error on the BRS bit).

At the implementation level, the most common production failures are physical layer problems that manifest only under temperature, vibration, or long-term connector degradation. Investing in proper termination, quality connectors, and a CAN analyzer for development pays dividends in field reliability far beyond what firmware tuning can achieve.

MENTAL MODEL: CAN bus is a shared newsroom. Any reporter (node) can shout a headline (transmit a message ID), but the editor with the most important story (lowest ID) always gets to finish first. Everyone in the room hears every headline. If a reporter makes a factual error (bad CRC), the whole room shouts "wrong!" (error frame). A reporter who keeps making errors gets sent out of the building (Bus Off). The copy (data) is self-describing by headline alone -- there is no envelope addressed to a specific reader.

## Related Topics

Prerequisites: - Serial Communication Fundamentals - Differential Signaling and Signal Integrity - MCU Peripheral Configuration (UART, SPI, I2C) - Interrupt Handling and DMA - Basic EMC and PCB Layout

Next Topics: - Embedded Security Fundamentals - Fault Handling and Safety-Critical Design - CANopen Protocol and Device Profiles - J1939 for Heavy Vehicle Systems - AUTOSAR COM and PDU Router - LIN Bus (Single-Wire CAN Companion)
