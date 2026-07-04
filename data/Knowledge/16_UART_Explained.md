---
id: uart-explained
tags: ['UART', 'Baud Rate', 'Framing', 'RS-232']
---

# UART Explained: Frame Format, Baud Rate Generation, FIFOs, Flow Control, and Signal Levels

You are three days into debugging a new board. The GPS module is connected, power is clean, and the firmware compiles without errors. But the UART receive buffer fills with garbage. You swap the TX and RX lines. Still garbage. You slow the baud rate down. Still garbage. You pull out the oscilloscope and probe the RX pin. The signal looks clean. The problem, it turns out, is that your crystal oscillator has a 1% tolerance and the GPS module expects 9600 baud with less than 0.5% error. The baud rate generator in your MCU is dividing a 16 MHz clock, and the nearest integer divisor gives you 9615 baud instead of 9600. That 0.16% error accumulates across each bit, and by the stop bit the sampling point has drifted enough that the UART hardware flags a framing error and discards the byte.

This scenario plays out on real hardware constantly, across every industry. UART -- Universal Asynchronous Receiver/Transmitter -- is the oldest and most ubiquitous serial interface in embedded systems. It predates microcontrollers, predates USB, and predates Ethernet. Yet engineers who have used it for years still encounter subtle failures caused by misunderstanding the baud rate generator, the sampling algorithm, or the electrical interface layer.

UART exists because digital systems need to exchange data serially -- one bit at a time over a single wire -- without the overhead of a shared clock signal. The "asynchronous" part of the name is what makes it both useful and tricky. Both ends independently generate their own clocks, agree on a rate in advance, and the hardware must reconstruct timing purely from the incoming data stream. When that works, it is elegant. When the rates drift apart, every received byte is corrupted.

Understanding UART at the level of a working engineer -- not just "set baud rate, enable peripheral, call it done" -- requires understanding the frame format that structures each byte, the clock divider arithmetic that sets the baud rate, the FIFO buffers that prevent data loss under interrupt latency, the flow control signals that prevent overrun, and the electrical standards that govern signal levels. Each of these layers can independently cause a system failure.

By the end of this article, you will understand how a UART frame is structured bit by bit, how the baud rate divisor is calculated and why rounding errors matter, how TX and RX FIFOs work and when they fail, how RTS/CTS hardware flow control prevents data loss, and when to use RS-232 level conversion versus direct TTL connections.

## The Fundamental Problem

Moving data between two digital systems requires a shared reference. If both sides share a clock line, the receiver can latch data on every clock edge and the framing is guaranteed. That is how SPI and I2C work. But a shared clock requires an extra wire, requires the master to generate and distribute the clock, and couples the two devices in a way that limits cable length and introduces signal integrity constraints. For many applications -- connecting a microcontroller to a GPS receiver across a board, or connecting two boards across a cable -- the cost of the clock line is unacceptable.

The naive solution is to remove the clock line and have both devices count time themselves. The sender outputs bits at a fixed rate; the receiver samples the line at the same fixed rate. This works until the two clocks disagree by enough that the receiver samples the wrong bit. With an 8-bit data field, 8 stop and start bits, and a 10-bit total frame, the receiver must stay synchronized within one bit-period across the entire frame. A 5% clock error would cause a one-bit drift by the 20th bit, which means the receiver would misread every byte. In practice the tolerance is tighter than 5%, because the sampling point is ideally at the center of each bit period.

The original designers of UART solved this by adding a start bit that marks the beginning of every byte. The receiver, idle and waiting, detects the falling edge of the start bit and immediately re-synchronizes its internal counter. It then counts bit-periods from that edge to sample each subsequent data bit at its center. Because re-synchronization happens at the start of every byte, the accumulated clock error resets to zero each time. A 0.5% clock discrepancy across a 10-bit frame produces only a 0.05-bit drift by the last bit, which is well within the sampling margin. This is why UART can tolerate small clock differences where a naive fixed-rate scheme cannot: it resynchronizes frequently enough that small errors never accumulate to a full bit-period.

## The Big Picture

UART occupies the lowest layer of a serial communication stack. At the physical layer, two wires carry data in opposite directions: TX from transmitter to receiver, and RX from receiver to transmitter. Optionally two more wires, RTS and CTS, carry flow control signals. At the data link layer, the UART peripheral inside the MCU serializes bytes from a transmit data register into bit sequences on TX, and deserializes bit sequences from RX into bytes in a receive data register. Software reads from and writes to those registers or the FIFOs that buffer them. Everything above -- protocols, packet framing, checksums -- is the responsibility of the application layer.

The UART peripheral connects to the MCU's APB or AHB bus on one side and to the physical TX/RX pins on the other. A baud rate generator divides the peripheral clock down to the desired bit rate. An interrupt controller or DMA engine moves data between the peripheral registers and RAM without busy- waiting. The signal levels at the pins may or may not match the receiving device; a level converter or line driver sits between them when they do not match.

The following diagram shows the full signal path for a half-system view, transmit side:

<div class="detail-diagram">
<img src="../assets/svg/diagrams/uart_flow.svg" alt="UART Signal Path — Transmit Side" loading="lazy">
</div>

TX Pin ---> [Level Converter, if needed] ---> Remote Device RX Pin

On the receive side the flow is mirrored: incoming bits on RX feed the receive shift register, which assembles them into a byte and writes it to the RX FIFO, where software or DMA reads it. The baud rate generator drives the sampling clock that determines when each incoming bit is sampled.

## Key Concepts and Terminology

**Baud Rate** — The number of symbol transitions per second on the line. For a standard UART with no encoding, one symbol equals one bit, so baud rate equals bit rate. Common values are 9600, 115200, and 921600. The value must match on both ends to within roughly 3-5% total combined error; the actual limit depends on the number of bits per frame and the receiver's oversampling ratio.

**Frame** — The complete unit of transmission for one byte. A UART frame consists of: one start bit (always logic 0), 5-9 data bits (LSB first by convention), an optional parity bit, and one or two stop bits (always logic 1). The line idles high between frames. The start bit's falling edge is the synchronization event that triggers the receiver's bit-counter.

**Oversampling** — The technique the receiver uses to locate the center of each bit period. Most modern UART peripherals oversample the incoming signal at 16x or 8x the baud rate. At 16x oversampling with 9600 baud, the receiver samples RX at 153,600 Hz. The start bit is detected by a falling edge; the receiver then waits 8 sample-clocks (half a bit period) before taking the first data sample at the bit center. This majority-vote sampling reduces susceptibility to glitches.

**Baud Rate Generator** — A clock divider inside the UART peripheral. It takes the peripheral clock (e.g., 42 MHz on an STM32F4 APB1) and divides it by a fractional or integer divisor to produce the oversampling clock. On STM32 parts, the USARTDIV register supports a fractional mantissa and fraction field, allowing the baud rate error to be less than 0.1% across a wide range of system clocks.

**Tx Fifo** — A small FIFO buffer (typically 8-64 bytes) between the transmit data register and the transmit shift register. Software fills the FIFO; the shift register drains it one bit at a time. The FIFO decouples software timing from hardware timing. Without a FIFO, software must write each byte exactly when the shift register becomes free, which requires very tight interrupt latency.

**Rx Fifo** — The receive-side FIFO buffer. Incoming bytes are assembled by the shift register and pushed onto the RX FIFO automatically. Software reads from the FIFO at its own pace. If the FIFO fills before software reads it, an OVERRUN ERROR is flagged and the oldest or newest byte is discarded, depending on the implementation. This is one of the most common UART failure modes in practice.

**Parity Bit** — An optional bit appended after the data bits that provides a single-bit error detection mechanism. Even parity means the parity bit is set so the total number of 1s in the data plus parity is even. Odd parity does the opposite. Parity detects single-bit errors but cannot correct them and cannot detect two-bit errors. Many modern protocols omit parity and use CRC instead.

**Flow Control** — A mechanism to prevent the transmitter from sending faster than the receiver can process. Hardware flow control uses two dedicated signals: RTS (Request To Send) driven by the transmitter and CTS (Clear To Send) driven by the receiver. When the receiver's buffer is nearly full, it deasserts CTS, causing the transmitter to pause. This prevents RX FIFO overrun without requiring the receiver to process data at line speed.

**Rs-232** — An electrical standard that defines UART signal levels as +3V to +15V for logic 0 and -3V to -15V for logic 1. The voltage swing is large for noise immunity over long cables. RS-232 requires a level converter IC (e.g., MAX3232) when interfacing to a 3.3V or 5V MCU. Note that RS-232 is inverted compared to TTL: RS-232 idle is a negative voltage, whereas TTL idle is high.

**Ttl Levels** — The signal levels produced directly by an MCU GPIO pin: 0V for logic 0 and VCC (3.3V or 5V) for logic 1. Most board-to-board UART connections at short distances use TTL directly. Confusingly, the term "TTL serial" has come to mean any 3.3V or 5V UART connection, even though true TTL refers to the older 5V bipolar logic family.

## How It Works

STEP 1: IDLE STATE AND START BIT DETECTION

When no data is being sent, the UART TX line idles high (logic 1 at the TTL level). The receiver monitors RX continuously. The UART peripheral uses its oversampling clock to sample RX many times per bit period. When it detects a falling edge -- the transition from idle high to logic 0 -- it identifies this as a potential start bit. To distinguish a genuine start bit from a noise glitch, the receiver continues to sample for several more oversampling clocks. On STM32 parts with 16x oversampling, the receiver requires the line to remain low for at least 8 consecutive samples before accepting the start bit as valid. A glitch shorter than half a bit period is rejected.

STEP 2: BIT CENTER ALIGNMENT

Once the start bit is confirmed, the receiver's internal counter is synchronized to the start bit edge. The receiver then counts forward to sample each data bit at its center. With 16x oversampling, the center of the first data bit is at sample 24 (16 samples for the start bit plus 8 to reach the center of bit 0). Each subsequent data bit is sampled 16 oversampling clocks later. The majority of three samples around the center point is used as the bit value, providing immunity against narrow glitches.

STEP 3: DATA BIT SAMPLING AND SHIFT REGISTER ASSEMBLY

The receive shift register collects sampled bits LSB first. For a standard 8N1 frame (8 data bits, no parity, 1 stop bit), the shift register collects 8 bits over 8 bit periods. Each bit is shifted in from the MSB end of the shift register so that after all 8 bits have been received, bit 0 is in the LSB position, which matches the original transmit order. The data is now a complete byte in the shift register.

STEP 4: PARITY AND STOP BIT VERIFICATION

If parity is enabled, the hardware computes the parity of the received data bits and compares it to the received parity bit. A mismatch sets the PARITY ERROR flag in the status register. Whether or not parity is enabled, the hardware then samples the stop bit. The stop bit must be logic 1. If it is logic 0 -- meaning the sender transmitted a start bit for the next byte before the receiver expected one, or noise corrupted the stop bit -- the hardware sets the FRAMING ERROR flag. Framing errors indicate a baud rate mismatch or signal integrity problem and should NEVER be silently ignored in production firmware.

STEP 5: BYTE TRANSFER TO RX FIFO

After the stop bit is verified, the byte in the shift register is transferred to the RX FIFO (or directly to the RDR register if there is no FIFO). On the AVR ATmega series, there is a two-level buffer; on STM32 USART peripherals, there is a single-byte buffer by default and a larger FIFO on parts that support FIFO mode. An interrupt flag is set if the RXNE (receive not empty) interrupt is enabled. The receive shift register is now free to accept the next incoming byte immediately; it does not wait for software to read the current byte. This is why the FIFO depth matters -- if software takes too long to service the interrupt, the FIFO fills and data is lost.

STEP 6: TRANSMIT PATH

Software writes a byte to the transmit data register (or FIFO). The hardware transfers it to the transmit shift register when the shift register is empty. The shift register prepends the start bit (logic 0), outputs data bits LSB first at the baud rate, appends the parity bit if enabled, and finally outputs one or two stop bits (logic 1). The TX line then returns to idle. The TXE interrupt flag signals when the FIFO or transmit data register is empty and ready for another byte.

## Under the Hood

The baud rate generator on most Cortex-M peripherals works as a fractional divider. On the STM32 USART, the USARTDIV value is a 16-bit fixed-point number with a 4-bit fractional part (for 16x oversampling mode). The mantissa field is the integer part of the divisor and the fraction field is the fractional remainder expressed in sixteenths. For example, to achieve 115200 baud from a 42 MHz APB1 clock at 16x oversampling: USARTDIV = 42,000,000 / (16 * 115200) = 22.786. The mantissa is 22 (0x16) and the fraction is round(0.786 * 16) = 13 (0xD). Writing 0x016D to BRR gives a realized baud rate of 42,000,000 / (16 * 22.8125) = 115,107 baud, an error of 0.08%. That is well within the acceptable range.

The 16x oversampling clock runs at 16 times the baud rate. The receiver samples the RX line on every oversampling clock edge. The start bit detector watches for any falling edge and then waits for the transition to persist. The bit sampling logic uses samples 7, 8, and 9 (counting from the start of the start bit, 0-indexed) to determine whether the start bit is genuine -- if two of three agree it is low, the start bit is accepted. The same majority-vote logic applies to each data bit sample at position N*16 + 8 relative to the start bit edge, where N is the bit index. This majority vote is what makes UART tolerant of narrow noise spikes.

On the transmit side, the shift register is clocked directly by the baud rate clock (one clock per bit period, derived by dividing the oversampling clock by 16 or 8). The shift register has no majority vote -- it outputs one bit per clock. This asymmetry means the transmitter is simpler than the receiver, which is the expected design: the transmitter controls its own timing perfectly, while the receiver must infer timing from the incoming signal.

FIFO depth interacts with interrupt latency in a non-obvious way. On an STM32F4 at 115200 baud, one byte takes approximately 87 microseconds to receive. If the MCU is executing an ISR that takes 100 microseconds to complete and the RX FIFO is only one byte deep, the byte that arrives during that ISR will overwrite the previous byte before software reads it. A 4-byte FIFO would tolerate up to 350 microseconds of latency. In practice, firmware that uses DMA for UART reception avoids this problem entirely by transferring bytes directly to RAM without CPU involvement. The DMA controller on STM32 can be configured to trigger a half-transfer or full-transfer interrupt when a circular buffer reaches specific fill levels.

RS-232 level conversion introduces an important subtlety: the MAX3232 and similar devices invert the signal. TTL high becomes RS-232 negative (logic 1), and TTL low becomes RS-232 positive (logic 0). The inversion is handled inside the level converter IC -- the UART peripheral never sees it. However, if you connect a 3.3V UART directly to an RS-232 port without a converter, you will receive inverted data and may damage the MCU input, since RS-232 can swing to +15V. This is a very common hardware mistake on prototype boards.

## Real-World Applications

### Automotive

UART underlies the K-line diagnostic bus used in older OBD-II systems. More recently, LIN (Local Interconnect Network) is a single-wire bus based on a UART-compatible frame format, running at up to 20 kbaud. LIN is used for low-speed body electronics: window lifts, mirror adjusters, seat position control. The LIN physical layer is a single wire pulled to battery voltage, not a differential pair, and UART hardware with a LIN mode (available on STM32 USART peripherals) can generate LIN break fields and sync bytes natively.

CONSUMER ELECTRONICS AND IoT

Nearly every Wi-Fi and Bluetooth module -- ESP8266, ESP32, HC-05, SIM800 -- communicates with a host MCU over UART using an AT command set. Baud rates range from 9600 to 921600. Many of these modules support auto-baud detection, but the host must still configure its baud rate generator correctly. UART is also the universal debug interface for embedded Linux systems; the boot console on a Raspberry Pi, BeagleBone, or custom i.MX6 board is a 3.3V TTL UART at 115200 8N1.

### Industrial

RS-232 and RS-485 (which uses differential signaling but UART framing) are ubiquitous in factory automation, PLCs, and instrumentation. Modbus RTU, one of the most deployed industrial protocols in the world, runs over RS-485 with UART framing. The baud rate tolerance in industrial settings matters because cable lengths can reach hundreds of meters, and termination and ground noise add to the effective jitter budget.

### Medical

Portable medical devices -- pulse oximeters, glucose meters, infusion pumps -- use UART for internal board-to-board communication between a sensor module and the main application processor. The low pin count and simple protocol reduce certification risk compared to USB or Ethernet. In these systems, parity and framing error detection are often used as part of the data integrity strategy, alongside application-layer checksums.

### Aerospace

Older avionics use RS-232 for ground support equipment interfaces. GPS receivers in general aviation use NMEA 0183, which is a UART-based ASCII protocol at 4800 or 9600 baud. Modern avionics are moving to RS-422 (differential single-master) and RS-485, but UART framing remains the underlying format.

## Common Mistakes

MISTAKE 1: WRONG BAUD RATE DIVISOR CALCULATION What goes wrong: Engineer uses an integer divisor formula, ignores fractional support, and accumulates 2-5% error. Works on bench with one specific crystal but fails with a different frequency crystal variant or when the GPS module's own oscillator is at a different tolerance end. How to avoid: Always calculate the exact floating-point USARTDIV, then use the MCU's fractional BRR register to minimize error. Verify with a frequency counter or oscilloscope. Log the calculated error percentage in a code comment next to the BRR register write.

MISTAKE 2: IGNORING FRAMING AND OVERRUN ERROR FLAGS What goes wrong: Firmware reads bytes from the RDR register without checking the status register first. Corrupted bytes are passed silently to the application layer, causing protocol failures that look like software bugs rather than hardware issues. How to avoid: Always read the status register before reading data. In the ISR, check ORE (overrun error), FE (framing error), and PE (parity error) flags. Log or count them. React to them.

MISTAKE 3: SWAPPING TX AND RX What goes wrong: The TX of one device must connect to the RX of the other. Engineers wire TX-to-TX and RX-to-RX by following a label convention that seems symmetric. This is the most common physical wiring error on UART bring-up. How to avoid: Trace the signal direction explicitly: TX on device A outputs, RX on device B inputs. Draw an arrow on the schematic. Use a multimeter or oscilloscope to confirm TX is toggling before connecting to an unknown device.

MISTAKE 4: MIXING 3.3V AND 5V WITHOUT A LEVEL SHIFTER What goes wrong: Connecting a 3.3V MCU UART pin directly to a 5V device's TX line. The 5V HIGH level (up to 5.5V) exceeds the 3.3V MCU's absolute maximum input voltage, causing immediate or latent damage to the GPIO pin. How to avoid: Check the absolute maximum ratings of the receiving pin. If 5V-tolerant, no shifter is needed for the input direction. If not 5V-tolerant, use a voltage divider or a dedicated level shifter IC. Never assume a Cortex-M MCU is 5V tolerant -- many are not.

MISTAKE 5: INSUFFICIENT RX FIFO SERVICING LEADING TO OVERRUN What goes wrong: ISR-driven receive firmware works in testing but drops bytes when a higher-priority ISR is added later in development. The overrun is intermittent and hard to reproduce. How to avoid: Use DMA for UART reception on any channel where the data rate exceeds a few hundred bytes per second or where interrupt latency is non-deterministic. Monitor the ORE flag in production.

MISTAKE 6: ENABLING FLOW CONTROL ON ONLY ONE END What goes wrong: One device asserts RTS but the other has not configured CTS. The CTS pin floats or is pulled to a level that permanently enables or disables transmission. Half the link works; the other half is stuck. How to avoid: Enable flow control on both devices simultaneously or on neither. When debugging, confirm flow control signal levels with a logic analyzer before assuming a software issue.

MISTAKE 7: NOT ACCOUNTING FOR STOP BIT COUNT MISMATCH What goes wrong: One end configured for 2 stop bits, the other for 1. The receiving end interprets the second stop bit as the start of the next frame, generating a continuous stream of framing errors. How to avoid: Verify that both ends use the same stop bit count. Most modern devices default to 1 stop bit. Legacy RS-232 equipment often uses 2. Check the device datasheet, not the module label.

## Debugging and Troubleshooting

**Symptom:** All received bytes are 0xFF or 0x00

**Possible Cause:** TX and RX lines are both unconnected or shorted to a supply rail.

**Investigation Method:** Probe RX on the receiving MCU with an oscilloscope. If the line is constantly high (1) and never transitions, either the transmitter is not sending, or the wires are disconnected. If constantly low, the TX wire is shorted to ground or the transmitter is stuck driving low.

**Resolution:** Verify physical connections. Send a known byte (e.g., 0x55, which alternates bits) from the transmitter and confirm the waveform on the oscilloscope before connecting to the receiver.

**Symptom:** Intermittent framing errors, seemingly random

**Possible Cause:** Baud rate mismatch between the two ends, or crystal frequency tolerance mismatch.

**Investigation Method:** Measure the actual baud rate of the transmitter with a frequency counter or oscilloscope time measurement on a known byte (0x55 at 9600 baud has 104.2 us bit periods). Compare to the expected value. Also check if errors correlate with temperature -- crystal drift is temperature-dependent.

**Resolution:** Recalculate the USARTDIV for both ends. Use the fractional BRR register to minimize the error. If using an internal RC oscillator, consider switching to an external crystal.

**Symptom:** Data received correctly for a few seconds, then the application stops responding to incoming bytes

**Possible Cause:** RX FIFO overrun. Bytes are arriving faster than software is reading them. Once the FIFO is full, the ORE flag is set and new bytes are discarded.

**Investigation Method:** Add a counter that increments on ORE flag detection. Log the counter value over time. Measure the time between RX interrupt service and FIFO read to quantify interrupt latency.

**Resolution:** Switch to DMA-driven reception. Alternatively, increase thread/ISR priority for the UART handler. If using an RTOS, ensure the receive task has sufficient priority relative to other tasks that could block it.

**Symptom:** UART works in loopback test but fails when connected to external device

**Possible Cause:** Signal level mismatch (e.g., 5V device connected to 3.3V MCU input), or RS-232 inversion without a level converter.

**Investigation Method:** Probe both sides of the connection with an oscilloscope. Confirm voltage levels. If the RS-232 RX signal shows negative voltages on the cable side, the MAX3232 or equivalent is missing or has failed. Check that the signal idles in the correct direction (high for TTL, negative for RS-232).

**Resolution:** Install the required level converter. Confirm with oscilloscope after installation. Verify that the level converter's VCC matches the MCU VCC, not the cable voltage.

## Design Considerations and Best Practices

1. ALWAYS CHECK ERROR FLAGS BEFORE READING THE DATA REGISTER

On many STM32 parts, reading the data register clears the status register flags. If you read the data register first, you lose the error context for that byte. Write your receive ISR to read the status register first, copy the flags, then read the data register. This gives you accurate error attribution per byte.

2. USE DMA FOR ANY CHANNEL ABOVE 9600 BAUD IN A COMPLEX SYSTEM

Above 9600 baud in an RTOS environment, interrupt-driven UART reception is unreliable unless the UART ISR has the highest priority in the system. DMA removes the CPU from the receive path entirely, placing bytes directly into a circular buffer in RAM. The CPU is only involved when the buffer is half-full or full, not on every byte.

3. SIZE YOUR RECEIVE BUFFER FOR WORST-CASE LATENCY, NOT AVERAGE LATENCY

Buffer sizing is a worst-case calculation. If your highest-priority ISR can block UART for 2 milliseconds, and you are receiving at 115200 baud (approximately 11,520 bytes per second), you need a receive buffer of at least 24 bytes to guarantee no loss during that blocking period. Add a 2x safety margin and use 64 bytes.

4. CALCULATE AND DOCUMENT THE BAUD RATE ERROR FOR EVERY UART IN YOUR SYSTEM

Write the realized baud rate, the requested baud rate, and the percentage error as a comment next to every USARTDIV or BRR register write. This takes 30 seconds and saves hours of debugging when someone changes the system clock frequency six months later.

5. NEVER USE SOFTWARE UART (BIT-BANGING) FOR ANYTHING ABOVE 9600 BAUD ON AN RTOS

Bit-banged UART is timing-critical. Under an RTOS, task preemption can corrupt the bit timing. Use the hardware UART peripheral whenever one is available. If all hardware UARTs are consumed, use a UART expander IC over I2C or SPI rather than bit-banging.

6. VERIFY FLOW CONTROL SIGNAL POLARITY ON EVERY NEW DESIGN

RS-232 RTS and CTS are active-low in the electrical standard but many UART peripheral datasheets express them as active-high in the register description. Read the datasheet for your specific MCU's hardware flow control configuration. Check with an oscilloscope that CTS deasserts (goes high in TTL) when the receiver wants the transmitter to stop, not when it wants it to continue.

7. PREFER 8N1 UNLESS THE REMOTE DEVICE REQUIRES OTHERWISE

8 data bits, no parity, 1 stop bit (8N1) is the universal default and is what every device assumes when no frame format is specified. Any deviation -- 7E1, 8O1, 8N2 -- must be explicitly configured on both ends. The configuration must also be verified at bring-up with an oscilloscope or logic analyzer.

8. TREAT YOUR UART RECEIVE HANDLER AS A PRODUCER, NOT A PROCESSOR

The ISR or DMA callback should place bytes into a ring buffer and return immediately. Protocol parsing, command dispatch, and error handling belong in a lower-priority task or main loop function that consumes from the ring buffer. Doing protocol work inside the ISR increases interrupt latency for the entire system.

## Expert Notes

### The Baud Rate Error Accumulates in One Direction

If the transmitter is running 0.5% faster than the receiver, the sampling drift is always in the same direction -- the receiver samples progressively later relative to each bit center. This means that at the end of a long frame (10 bits), the cumulative drift is 0.05 bit periods, which is safe. But if the transmitter sends back-to-back bytes with no idle time between them (as it does when a FIFO is full), the receiver re-synchronizes on each start bit edge. The drift resets on every start bit. This re-synchronization property is why UART tolerates oscillator error as well as it does -- the specification is per-frame, not per-session.

### Overrun Error Is Sticky on Some Silicon Revisions

On certain STM32 silicon revisions, the ORE flag in SR cannot be cleared just by reading SR and then DR. It requires the specific read-SR-then-read-DR sequence, in that order, in the same ISR invocation. If your firmware reads DR without first reading SR, the ORE flag stays set, and the RXNE interrupt keeps firing even though no new byte is available. This creates an infinite ISR re-entry that starves the rest of the system. Always read SR before DR, always.

RS-232 IDLE IS MARK (NEGATIVE VOLTAGE), WHICH MEANS LOGIC 1 IN UART TERMS

A common confusion when first working with RS-232: the line idles at a negative voltage, which is defined as logic 1 (MARK state). The start bit is a transition to positive voltage (SPACE state, logic 0). This is inverted relative to common intuition. The level converter IC handles the inversion transparently, but if you are probing the cable side with an oscilloscope and see the line at -8V at idle, that is correct behavior. If it is at 0V at idle, the transmitter is off or the cable is disconnected.

THE HARDWARE FLOW CONTROL THRESHOLD IS CONFIGURABLE ON SOME PARTS

On STM32 parts with FIFO mode (USART on STM32H7, for example), the RTS threshold -- the FIFO fill level at which RTS is asserted to pause the remote transmitter -- is configurable. The default is often set to assert RTS when the FIFO is completely full, leaving no margin. In a high-throughput application, set the threshold to assert RTS when the FIFO is half-full or three-quarters full. This gives the remote transmitter time to react to the CTS deassertion before the local FIFO actually overflows.

### Parity Is Not a Substitute for a Checksum

Parity detects single-bit errors in a single byte. It cannot detect two-bit errors (they cancel out), and it says nothing about errors in other bytes in a multi-byte message. If your protocol requires data integrity, use a CRC over the entire message at the application layer. Parity is a useful indicator that the physical layer has a problem, but it is not a data integrity mechanism for a message.

## Summary

UART is the foundation of serial communication in embedded systems, and its apparent simplicity hides a set of precise mechanical details that determine whether it works reliably. The frame format -- start bit, data bits, optional parity, stop bits -- is the contract between transmitter and receiver. The start bit provides per-frame resynchronization that is the key insight allowing asynchronous operation to work despite clock tolerance. Every engineer working with UART needs to understand this mechanism, because it directly explains the baud rate tolerance budget.

The baud rate generator is a clock divider, and integer division introduces error. On modern MCU peripherals with fractional BRR support, this error can be reduced to well below 0.5%. The error must be calculated and documented explicitly; it is not safe to assume the hardware picks the right value. TX and RX FIFOs buffer the interface between hardware timing and software timing, but they have finite depth and they overflow under sustained interrupt latency. DMA is the correct solution for high-throughput UART in complex systems.

Hardware flow control (RTS/CTS) solves the specific problem of receive buffer overrun by allowing the receiver to pause the transmitter. It must be configured consistently on both ends and verified at bring-up. RS-232 level conversion is mechanically straightforward but adds a signal inversion, uses voltage levels incompatible with 3.3V GPIOs, and is a common source of damage on prototype boards when overlooked.

The mental model to retain: UART is a self-synchronizing bit stream where both ends agree on rate in advance, the start bit re-synchronizes the receiver on every frame, and reliability depends on the baud rate error being small enough that the sampling point remains near the bit center across the entire frame. Everything else -- FIFOs, flow control, error flags, level conversion -- is infrastructure that makes this core mechanism reliable in a real system.

## Related Topics

Prerequisites: - Serial Communication Fundamentals (clock domains, signal levels, protocol layers) - Digital Logic and GPIO Configuration - MCU Clock Trees and Peripheral Clock Assignment - Interrupt Handling and ISR Design

Next Topics: - SPI Explained (synchronous serial, master/slave, clock polarity and phase) - I2C Explained (two-wire bus, addressing, clock stretching, multi-master) - DMA Controllers (memory-to-peripheral, circular buffers, half-transfer interrupts) - RS-485 and Modbus RTU (differential signaling, multi-drop buses, industrial protocols) - UART Bootloaders and Firmware Update over Serial
