---
id: serial-communication-fundamentals
tags: ['UART', 'SPI', 'I2C', 'Protocols']
---

# Serial Communication Fundamentals

You have a microcontroller that reads a temperature sensor, and you need to send that reading to a display module on the other side of a PCB. The sensor speaks a different voltage, runs on its own clock, and was made by a different manufacturer than your MCU. You have eight GPIO pins free. You could dedicate all eight to a parallel bus and blast the data across simultaneously, but then you have consumed most of your available I/O, your PCB traces need to run in lockstep, and adding a second sensor means you are out of pins. There is a better way, and it is older than modern microcontrollers: move data one bit at a time over a single wire.

Serial communication is the foundation on which virtually every embedded peripheral interface is built. UART, SPI, I2C, CAN, USB, RS-485, 1-Wire are all serial protocols. Before you can use any of them effectively, you need to understand the common concepts that run beneath them all: how bits are timed, how a receiver knows where a message starts and ends, how errors are detected, and how two devices agree on who is allowed to talk. Skipping this layer and jumping straight to protocol APIs leads to bugs that are genuinely difficult to diagnose because you do not have a mental model of what the hardware is actually doing.

Serial communication exists as a discipline because the physical constraints of real hardware -- pin count, trace impedance, noise, distance, and power -- make parallel buses impractical in most situations. A microcontroller has dozens of peripherals but only so many pins. A cable connecting two boards introduces capacitance that degrades fast parallel signals. Serial protocols are the engineering compromise that wins in almost every scenario outside of memory buses and display interfaces.

This is a topic where a one-paragraph summary will mislead you. The details matter -- baud rate misconfiguration, missing stop bits, and incorrect parity settings all produce subtly broken behavior that looks identical at first glance. A logic analyzer trace of a corrupted UART frame looks almost right. You need to know exactly what "almost right" means in order to spot it.

By the end of this article, you will understand how serial communication works at the signal level, why synchronous and asynchronous schemes exist and when each is appropriate, how framing keeps a receiver synchronized, what baud rate actually means and where errors come from, and how to make informed decisions about duplex, parity, and timing that will serve you in every protocol you encounter afterward.

## The Fundamental Problem

The naive approach to moving data between two chips is to wire them together bit-for-bit: eight data lines, one for each bit of a byte, all driven simultaneously. This is a parallel bus, and it works beautifully on a single chip where the silicon is millimeters apart and the timing is controlled by a single clock. The moment you leave the chip boundary, problems multiply. Parallel buses require every trace to be the same electrical length -- or close enough -- because a skew of even a few nanoseconds between lines means the receiver samples a mix of the current byte and the previous one. At high speeds, this routing constraint becomes expensive and sometimes physically impossible on a production PCB.

Pin count is the other killer. A 32-bit parallel bus consumes 32 GPIO lines plus control signals. On an STM32F4 with 114 I/O pins, committing 32 to a single peripheral is a significant fraction of the entire package. If you are on an ATmega328P with 23 usable I/O lines, a parallel bus is simply not an option for most applications. The chip would have no pins left for anything else.

The solution is to accept a speed trade-off and serialize the data: send bits one after another over a single wire, or at most a handful of wires. The speed penalty is real -- a single-wire serial interface sends one bit where a parallel bus would send eight -- but the penalty is often irrelevant. Most sensor data changes at human or mechanical timescales. A temperature reading that updates ten times per second over a 115200 baud UART link takes microseconds to transmit. The parallel bus would have been wasted bandwidth. The new problem serialization introduces is the synchronization problem: how does the receiver know exactly when each bit is valid? How does it know where one byte ends and the next begins? Solving those two questions is what framing, baud rates, and the synchronous/asynchronous distinction are all about.

## The Big Picture

At the highest level, serial communication is a pipeline: data enters as parallel bytes in the transmitter's memory, gets shifted out bit-by-bit onto a wire, travels to the receiver, gets shifted back into a parallel byte, and lands in the receiver's memory. The hardware that does the shifting -- the shift register and its associated clock and control logic -- is the UART, SPI, or I2C peripheral. The software only sees the finished byte; the bit-by-bit mechanics happen entirely in hardware.

The architectural position of a serial peripheral is between the CPU's data bus and the physical wire. From the CPU's perspective, it writes a byte to a data register, and some time later that byte has been transmitted. The peripheral handles all the timing, framing, and electrical signaling. This abstraction is why you can move from an AVR to an STM32 and the high-level concept stays the same, even though the register maps are completely different.

ASYNC FRAME (8N1, one byte):

<--- 1 bit period = 1 / baud_rate seconds --->

The diagram illustrates both the abstraction (parallel on the CPU side, serial on the wire side) and the concrete structure of an asynchronous frame. The clock source -- whether shared between devices or reconstructed independently by each side -- determines which category the protocol falls into.

<div class="detail-diagram">
<img src="../assets/svg/diagrams/serial_frame.svg" alt="Serial Frame Structure — Parallel to Serial" loading="lazy">
</div>

## Key Concepts and Terminology

**Baud Rate** — The number of symbol changes per second on the line, measured in baud. In simple binary signaling where each symbol is one bit, baud rate equals bit rate. At 9600 baud, each bit occupies roughly 104 microseconds. Both devices must agree on this value independently -- there is no negotiation. A 1% mismatch between transmitter and receiver clocks is usually tolerable; 3-5% is often not, especially accumulated across a full byte frame.

**Synchronous Communication** — A scheme where a dedicated clock line accompanies the data line. The receiver samples data on a clock edge rather than using its own internal timer. Because both devices share the same clock signal, there is no baud rate to configure and no clock drift error. SPI and I2C are synchronous protocols. The cost is at least one additional wire for the clock signal.

**Asynchronous Communication** — A scheme where there is no shared clock line. Both devices run from their own oscillators, pre-configured to the same baud rate. The receiver reconstructs timing from the data signal itself using the start bit as a reference edge. UART is the canonical asynchronous protocol. It works over any cable length and requires only two wires for bidirectional communication, but it demands accurate clocks on both ends.

**Framing** — The structure imposed on a bit stream so that the receiver can identify the boundaries of each data unit. In asynchronous communication, framing is done with start and stop bits that bracket every byte. Without framing, the receiver cannot tell where one byte ends and another begins, because the idle line state (high) is identical to a transmitted logic 1. Framing converts a continuous waveform into a structured sequence of bytes.

**Start Bit** — The single logic-low bit that precedes every data byte in an asynchronous frame. The line idles high (mark state). The falling edge of the start bit is the synchronization event -- the receiver detects this transition and starts its internal bit-timing counter. The receiver then waits 1.5 bit periods to sample the first data bit near the center of its window, maximizing tolerance for clock drift.

**Stop Bit** — One or two logic-high bits that follow the data bits (and parity bit, if used) at the end of a frame. The stop bit guarantees the line returns to idle before the next start bit, and gives the receiver time to process the completed byte. If the receiver detects a low level where it expects a stop bit, it flags a FRAMING ERROR -- this is the single most useful hardware error flag for diagnosing baud rate mismatches.

**Parity** — An optional single-bit error detection mechanism appended after the data bits. Even parity means the total number of 1-bits in the data plus the parity bit is even; odd parity keeps it odd. Parity detects single-bit errors only. It cannot detect two-bit errors and cannot correct anything. It is rarely used in modern designs because CRC-based error detection at the protocol layer is far more robust. Its main relevance today is legacy systems and the setting on your terminal emulator.

FULL-DUPLEX vs HALF-DUPLEX - Full-duplex means the device can transmit and receive simultaneously using separate physical paths (separate TX and RX wires). Half-duplex means both directions share a single wire or bus, so only one device can transmit at a time. RS-485 is a common half-duplex standard. Half-duplex requires a direction-control mechanism -- either a dedicated enable line or a protocol-level turn-around scheme. Careless handling of turn-around timing is a frequent source of collision errors in production firmware.

**Mark and Space** — Teletype-era terms for the logic-high (1) and logic-low (0) states respectively, still used in RS-232 and UART documentation. The idle state of a UART line is mark (high). A start bit is a space (low). You will encounter these terms in older datasheets and oscilloscope documentation.

**Oversampling** — The technique where the receiver samples each bit multiple times per bit period and uses majority vote to determine the bit value. The STM32 USART peripheral defaults to 16x oversampling: it samples each bit 16 times and takes the majority of the 3 samples nearest the center. This filters out short glitches and allows modest clock tolerance. Switching to 8x oversampling doubles the achievable baud rate but halves the clock tolerance budget.

## How It Works

### Step 1 -- the Line Sits Idle

Before any transmission, the TX line is held high (mark state) by the transmitter's output driver. This is the default state after reset on every UART-capable MCU pin. The receiver monitors the line and knows that as long as it stays high, no data is coming. On an STM32, if you configure a GPIO as USART TX in alternate function mode, the USART peripheral holds the pin high automatically. If you accidentally configure it as a general-purpose output and drive it low, the receiver sees a perpetual start bit and generates a flood of framing errors -- this is a surprisingly common bring-up mistake.

### Step 2: Start Bit Signals the Frame Boundary

The transmitter pulls the line low for exactly one bit period. This falling edge is the synchronization event for the receiver. On detecting the transition, the receiver's internal state machine starts a counter based on its configured baud rate clock. The receiver does not sample immediately -- it waits 1.5 bit periods from the falling edge before taking the first sample, placing the sample window in the center of bit D0. This center-sampling strategy maximizes the tolerance for clock frequency error between the two devices.

### Step 3: Data Bits Are Shifted Out Lsb First

The transmitter shifts out bits from the least significant bit to the most significant bit, one per baud period. If you are sending the ASCII character 'A' (0x41, binary 01000001), the line sequence is: low (start), high (D0=1), low (D1=0), low (D2=0), low (D3=0), low (D4=0), low (D5=0), high (D6=1), low (D7=0). The receiver samples once per bit period, rebuilding the byte in a shift register. Nearly every UART peripheral sends LSB first by default; the AVR USART, STM32 USART, and virtually every other implementation follow this convention. MSB-first mode exists on some peripherals as a configuration option but is rarely used outside of specific protocols.

### Step 4 -- Optional Parity Bit Is Appended

If parity is configured, the hardware calculates the parity bit automatically and inserts it after the last data bit, before the stop bit. The receiver independently calculates parity on the received data bits and compares it to the received parity bit. A mismatch sets the parity error flag in the status register. On the STM32 USART, the PCE (parity control enable) and PS (parity selection) bits in CR1 control this. Most modern designs use 8N1 (8 data bits, no parity, 1 stop bit) and rely on higher-level CRC for error detection, but you will encounter 8E1 and 8O1 configurations on industrial devices and legacy systems.

### Step 5 -- Stop Bit Closes the Frame

The transmitter drives the line high for one (or two) bit periods. The receiver verifies it sees a high level at the stop bit position. A low at this point sets the framing error (FE) flag and typically discards the byte. After the stop bit, the line returns to idle. If another byte follows immediately, the start bit of the next frame can follow directly after the stop bit with no gap -- this is back-to-back transmission.

### Step 6: The Receive Shift Register Transfers to the Data Register

Once the full frame is assembled in the receive shift register, the UART peripheral moves the byte into the receive data register (RDR on STM32, UDR on AVR) and sets the RXNE (receive not empty) flag. This triggers either a CPU interrupt (if RXNEIE is set) or a DMA transfer. If the CPU or DMA does not read the data register before the next complete frame arrives, the overrun error (ORE) flag is set and the incoming byte is lost. This is the source of overrun errors in interrupt-driven designs that spend too long in other ISRs.

## Under the Hood

The baud rate generator is a fractional clock divider driven from the peripheral clock (PCLK on STM32, FOSC/2 on most AVRs). On the STM32, the USART baud rate register (BRR) holds a fixed-point value with 12 integer bits and 4 fractional bits. The actual baud rate is PCLK / (16 * USARTDIV) in 16x oversampling mode. Because both the numerator and denominator are integers, there is almost always a small rounding error. On an STM32 running PCLK at 84 MHz, configuring 115200 baud gives an actual baud rate of approximately 115108 -- an error of 0.08%, well within tolerance. The AVR datasheet includes a table of UBRR values versus baud rate error for common oscillator frequencies precisely because the rounding error can be significant at some combinations.

Oversampling is implemented as a counter that increments at 16x (or 8x) the baud rate. For each nominal bit period, the peripheral samples the line on ticks 7, 8, and 9 (out of 16) -- the three samples centered in the bit window. Majority vote across those three samples is the received bit value. A single glitch shorter than roughly one-quarter of a bit period is rejected outright. Longer glitches will corrupt the sample. On noisy industrial lines, this is why an RC filter on the RX pin is a recommended hardware practice -- it is a first-pass noise filter before the digital oversampling takes over.

In synchronous mode (SPI, I2C), the clock edge -- rising or falling -- determines when the data line is sampled. SPI has two parameters that control this: CPOL (clock polarity, the idle state of the clock) and CPHA (clock phase, whether data is sampled on the first or second edge of each clock cycle). Four combinations exist (modes 0-3). Getting CPOL and CPHA wrong produces a frame that appears to receive data but the bytes are shifted by one bit or inverted in a systematic pattern -- a classic debugging scenario on a new peripheral bring-up. The SPI device datasheet always specifies which mode the device requires; the MCU must be configured to match.

Full-duplex serial requires separate TX and RX signal paths that operate completely independently in hardware. On an STM32 USART, the transmit shift register and the receive shift register are separate physical circuits. The peripheral can be clocking out a byte on TX at the exact same moment it is sampling incoming bits on RX, with no interaction between the two. Half-duplex on RS-485 uses a single differential pair for both directions. The RS-485 driver chip has a transmit enable (DE) pin that the MCU must assert before driving and deassert before the remote device responds. The turn-around time -- the gap between deasserting DE and the remote device beginning to transmit -- must be long enough that the local driver has gone high-impedance. Violating this creates a bus contention event: two drivers fighting each other on the same differential pair.

## Real-World Applications

AUTOMOTIVE: The CAN bus, the backbone of modern vehicle networks, is an asynchronous serial protocol running at 500 kbps or 1 Mbps over a differential pair. Every ECU -- engine control, ABS, airbag, HVAC -- communicates over the same two-wire bus. CAN uses a sophisticated framing scheme with 11-bit or 29-bit message identifiers, CRC, and acknowledge fields, but at its core it is bit-serial communication with careful framing. LIN bus, used for body electronics (window motors, seat adjustment), is a simpler single-wire asynchronous protocol based directly on UART framing.

INDUSTRIAL: RS-485 multidrop networks connect dozens of sensors, actuators, and PLCs over cable runs of up to 1200 meters using half-duplex differential serial at rates from 9600 baud to several megabaud. Modbus RTU, the most widely deployed industrial protocol in the world, runs on top of RS-485 and uses 8N2 or 8E1 framing. The UART peripheral in any modern MCU can generate this framing directly; the only extra hardware is an RS-485 transceiver chip like the MAX485 or SP3485.

MEDICAL: Serial communication appears in implantable device programmer interfaces, patient monitoring equipment, and laboratory instruments. Medical-grade serial designs pay particular attention to electrical isolation -- the patient circuit must be galvanically isolated from any equipment connected to mains power. Optocouplers and digital isolators like the ISO7241 pass UART signals across the isolation barrier. The framing and baud rate are identical to standard UART; only the physical layer changes.

CONSUMER ELECTRONICS: The debug UART port is present on virtually every embedded consumer device. A single 3.3V UART connection to a USB-to-serial adapter (CP2102, FT232, CH340) gives a developer a command shell or log output over a terminal. IoT modules (ESP32, SIM800, u-blox SARA) use AT commands over UART as their primary configuration and data interface. The UART is the universal escape hatch: when a device is misbehaving and you have no other visibility, connecting to its debug UART is often the first diagnostic step.

AEROSPACE: MIL-STD-1553 is a half-duplex differential serial bus used in military and aerospace avionics, running at exactly 1 Mbps with Manchester encoding. It predates RS-485 and has different electrical characteristics, but the fundamental concept -- serialize data, add framing, transmit over a shared differential pair -- is identical. SpaceWire, a point-to-point serial link derived from IEEE 1355, runs at hundreds of megabits per second but is built on the same serialization principles.

## Common Mistakes

**Mistake 01** — Baud rate mismatch due to clock source assumption. The engineer configures 115200 baud in the HAL without verifying the peripheral clock frequency. If the PLL is not configured as expected (or the MCU boots from the internal RC oscillator at a different frequency than anticipated), the actual baud rate will be wrong. Symptom is garbage characters or consistent framing errors. AVOID: Verify the peripheral clock frequency from the RCC registers or SystemCoreClock variable before calculating baud rate. Check that startup code initializes the PLL before any UART init.

**Mistake 02** — TX and RX pins swapped. UART TX of the MCU connects to TX of the other device instead of RX. This is extremely common during prototyping. Not obviously a connection error on a schematic because the labeling "TX/RX" is from the perspective of each device. AVOID: TX of one device connects to RX of the other, always. Draw the connection with arrows on your schematic to make directionality explicit.

**Mistake 03** — Missing common ground. Two boards communicate over UART with no ground connection between them. If powered separately, the voltage reference is floating and received bits are unreliable. Sometimes it partially works, which wastes debugging time. AVOID: UART and every single-ended serial interface requires a shared ground. Always run a ground wire alongside the signal wires.

**Mistake 04** — Overrun errors from slow ISR handling. An interrupt-driven UART receive handler performs too much work -- buffering, parsing, calling complex functions -- and takes longer than one byte period to complete. The next byte arrives before the data register is read and is discarded silently. AVOID: Receive ISRs should do exactly one thing: copy the byte into a ring buffer and return. Parse in the main loop or a lower-priority task. Use DMA for high-baud-rate links.

**Mistake 05** — RS-485 turn-around timing violation. The transmit enable (DE) pin is deasserted immediately after the last byte is written to the transmit data register, before the hardware has finished shifting out the last stop bit. The local driver goes high-impedance mid-transmission, corrupting the last character. AVOID: Wait for the TC (transmission complete) flag -- NOT TXNE (transmit data register empty) -- before deasserting DE. These are different flags. TXNE means the shift register has been loaded; TC means the line has gone idle.

**Mistake 06** — Configuring SPI in the wrong mode for a peripheral. The engineer guesses SPI mode 0 without reading the peripheral datasheet. Some devices require mode 3. The received bytes are systematically wrong -- shifted by one bit or inverted -- but communication appears to function. AVOID: Always look up the SPI mode in the peripheral datasheet. Look for CPOL and CPHA values, or a timing diagram. Do not guess.

**Mistake 07** — Pulling SPI CS high too early. On SPI, the chip select is deasserted before the last clock edge has been generated. Many SPI peripherals latch incoming data on the CS rising edge. Deasserting CS early can corrupt the final byte of a transaction. AVOID: Ensure all clock edges have completed before deasserting CS. In hardware SPI, wait for the BSY (busy) flag to clear before touching CS.

## Debugging and Troubleshooting

**Symptom:** Receiver sees only garbage characters; every byte is wrong or the terminal shows random symbols.

**Possible Cause:** Baud rate mismatch between transmitter and receiver. Can also be caused by peripheral clock misconfiguration.

**Investigation Method:** Connect a logic analyzer or oscilloscope. Measure the width of one bit period in microseconds. Calculate 1/bit_width to get the actual baud rate. Compare to the configured value.

**Resolution:** Verify SystemCoreClock and peripheral clock divider settings. Recalculate baud rate register value. On STM32, check RCC configuration in SystemClock_Config().

---

**Symptom:** Communication works at first, then random bytes go missing. Overrun Error (ORE) flag is set.

**Possible Cause:** CPU is not reading the receive data register fast enough. Interrupt latency is too high, or interrupt is disabled during another ISR.

**Investigation Method:** Profile interrupt latency with a GPIO toggle at ISR entry and exit. Measure the time between a byte being received and the ISR reading the data register. Compare this to the byte period (1 / baud_rate * 10 bits for 8N1).

**Resolution:** Move to DMA receive. If staying with interrupts, reduce ISR execution time to the bare minimum: copy to ring buffer and return. Raise UART interrupt priority relative to other ISRs.

---

**Symptom:** SPI peripheral receives all 0xFF or all 0x00 bytes regardless of what is transmitted. No framing errors.

**Possible Cause:** MISO pin is not connected, CS is not being asserted, or SPI mode does not match the peripheral.

**Investigation Method:** Use a logic analyzer to verify CS is asserted low before the clock starts. Confirm MISO is toggling. Check the clock idle level against the peripheral datasheet (CPOL). Verify MISO pin is configured as alternate function.

**Resolution:** Fix pin configuration, CS polarity, or SPI mode (CPOL/CPHA) as indicated by the scope trace and datasheet timing diagram.

---

**Symptom:** RS-485 network works reliably with two nodes but fails intermittently with a third node added.

**Possible Cause:** Bus termination is incorrect. RS-485 requires a 120-ohm termination resistor at each end of the cable. Missing or extra termination causes reflections that corrupt bits.

**Investigation Method:** Measure the differential voltage on the bus with an oscilloscope during transmission. A mis-terminated bus shows ringing (oscillations after each edge) at 50% or more of the signal amplitude.

**Resolution:** Place exactly two 120-ohm resistors, one at each physical end of the cable run. Add failsafe bias resistors (pull-up on A, pull-down on B) to define the idle state.

## Design Considerations and Best Practices

1. **Choose Synchronous Over Asynchronous When the Extra Wire Is Acceptable.** Synchronous protocols eliminate baud rate mismatch errors entirely. If both devices are under your control and wire count is not constrained, SPI is more robust than UART because there is no clock tolerance budget to manage.

2. **Use Dma for Any Uart Link Above 115200 Baud.** At 921600 baud, a byte arrives every 10 microseconds. DMA moves bytes to a circular buffer without CPU involvement, eliminating overrun risk and freeing CPU cycles for application work.

3. **Always Check Hardware Error Flags in Production Code.** Framing error (FE), overrun error (ORE), and noise error (NE) flags are available on every UART peripheral. They tell you whether a communication problem is a clock issue (FE), a latency issue (ORE), or an electrical noise issue (NE). Log them to counters at minimum.

4. **Do Not Use the Internal Rc Oscillator As Baud Rate Source for External Communication.** The STM32 HSI has a typical accuracy of 1% over temperature and voltage. At cold temperatures or under load, the oscillator shifts and the baud rate error can exceed tolerance. Use an external crystal or a PLL locked to an external reference.

5. **Add Hardware Flow Control for Any Uart Link That Can Buffer Data.** RTS/CTS flow control uses two additional GPIO lines to allow each device to pause the other's transmission when its buffer is full. Without it, a fast transmitter can overflow a slow receiver's buffer.

6. **Isolate Customer-Facing Serial Ports Electrically.** Any serial port that connects to an external cable should be protected by ESD diodes and series resistors at minimum, or galvanically isolated. A user plugging in a cable to a running RS-232 port can inject voltage spikes that kill the MCU UART peripheral.

7. **Verify Signal Integrity at the Target Baud Rate on Actual Hardware.** A UART link that works on your bench with short jumper wires may fail on a production board with 30 cm of PCB trace, a connector, and a cable. Stray capacitance rounds signal edges. Measure eye diagrams or minimum bit widths on actual hardware before finalizing baud rate.

8. FOR MULTI-DROP BUSES, DEFINE ADDRESS SPACE AND ARBITRATION BEFORE CODING. RS-485, I2C, and CAN all allow multiple devices on one bus. Define which device has which address and how conflicts are handled at the wire level first. Designing this beforehand saves significant protocol debugging time.

## Expert Notes

**Note 01** — THE TC FLAG IS NOT THE TXNE FLAG. Every tutorial shows waiting for TXNE to clear before writing the next byte. TXNE clears as soon as the shift register loads the byte -- before the last bit has left the pin. If you gate any post-transmission action (deasserting RS-485 DE, toggling a GPIO, signaling completion) on TXNE, you have a race condition. TC (transmission complete) clears only after the shift register has finished and the line is idle. Use TC for any post-transmission action. This mistake caused hard-to-reproduce failures in RS-485 systems and took down more than one production device before the difference was fully internalized.

**Note 02** — BAUD RATE ERROR ACCUMULATES ACROSS THE FRAME. A 2% baud rate error means each bit period is 2% longer or shorter than expected. For the first data bit (D0), the sample point is offset by 1.5 bit periods from the start bit edge -- the error is 1.5 * 0.02 = 0.03 bit periods. By the last data bit (D7), the accumulated drift is 9.5 * 0.02 = 0.19 bit periods. At the stop bit, total drift is 10.5 * 0.02 = 0.21 bit periods. With 16x oversampling, the sample window is 0.5 bit periods wide. A 0.21 bit period drift is 42% of the window -- already at risk. The accumulating nature of the error is why framing resets on every start bit rather than growing indefinitely.

**Note 03** — THE LOGIC ANALYZER LIES ABOUT TIMING AT HIGH BAUD RATES. A cheap logic analyzer sampling at 24 MHz has a timing resolution of about 41 nanoseconds. At 115200 baud each bit is 8.68 microseconds wide -- well within resolution. At 1 Mbaud, each bit is 1 microsecond wide. A 24 MHz analyzer has roughly 24 samples per bit -- marginal. At 4 Mbaud or above, you need a fast oscilloscope, not a logic analyzer. Junior engineers often trust the logic analyzer's bit decode at speeds where the hardware is not resolving the signal accurately.

**Note 04** — SYNCHRONOUS DOES NOT MEAN GLITCH-IMMUNE. A glitch on the SCK or CLK line generates phantom clock edges. The slave counts an extra edge and shifts in an extra bit, corrupting the rest of the frame. This is particularly nasty because the frame keeps going -- there is no framing error detection in SPI at the hardware level. The received bytes shift by one bit and nothing obvious fires. SPI at high speeds over long cables needs careful attention to layout, decoupling, and series termination resistors on the clock line.

**Note 05** — HALF-DUPLEX TURN-AROUND IS ASYMMETRIC IN TIME. In RS-485 half-duplex, the time from "DE deasserted" to "bus truly idle" depends on the driver chip's propagation delay and cable capacitance -- typically 100-500 nanoseconds for short cable, potentially several microseconds for long runs. The slave's reply may begin within a few bit periods of the last master stop bit. If DE deassertion has not completed, the first character of the reply is corrupted. The solution is to deassert DE in the TC interrupt and delay for at least one bit period before enabling the receiver. This exact timing problem is underspecified in most protocol implementations and is a frequent cause of first-byte corruption in Modbus RTU deployments.

## Summary

Serial communication exists because parallel buses are impractical in the physical world of real PCBs, cables, and constrained I/O pin counts. The core idea is simple: shift bits out one at a time, let the receiver shift them back in. Everything else -- baud rates, framing, parity, duplex modes -- is the engineering needed to make that simple idea reliable across different hardware, different clock sources, varying distances, and noisy environments.

The asynchronous/synchronous distinction is the first decision you make when choosing a protocol. Synchronous protocols (SPI, I2C) tie both devices to a shared clock and eliminate timing error at the cost of at least one additional wire. Asynchronous protocols (UART, RS-485) require only the data wire but impose a pre-agreed baud rate and the framing discipline of start and stop bits. The hardware in both cases is doing the same fundamental thing: serializing bytes for transmission and deserializing received bit streams back into bytes.

Error handling is not optional in production firmware. Every UART peripheral provides framing, overrun, noise, and parity error flags. Checking these flags in your receive handler is the difference between a device that logs useful diagnostic detail and one that silently drops bytes and presents the user with unexplained misbehavior.

The mental model to retain: serial communication is a pipeline where the key design parameters are timing (baud rate and its accuracy), framing (start/stop bits that give the receiver boundaries), direction control (full-duplex with separate wires or half-duplex with turn-around discipline), and error detection (parity or higher-level CRC). Every protocol you encounter -- UART, SPI, I2C, CAN, RS-485, USB at its logical layer -- is a specific configuration of these same parameters. Understanding them at this level means you can read a protocol datasheet, identify the framing structure, calculate the timing budget, and predict where failures will occur before you write a single line of code.

## Related Topics

Prerequisites: - GPIO Fundamentals - Clock System Fundamentals

Next Topics: - UART -- Hardware Peripheral Deep Dive - SPI -- Synchronous Peripheral Interface - I2C -- Inter-Integrated Circuit Bus - CAN Bus -- Controller Area Network - RS-485 and Modbus RTU - DMA -- Direct Memory Access
