---
title: "Serial Communication Fundamentals: Sending Data One Bit at a Time"
brief: "Why serial links won: synchronous versus asynchronous transmission, framing, clocking and choosing the right protocol."
order: 15
phase: 4
tags: ["UART", "SPI", "I2C", "Protocols"]
---

You have a microcontroller that reads a temperature sensor, and you need to send that reading to a display module on the other side of a PCB. The sensor speaks a different voltage, runs on its own clock, and was made by a different manufacturer than your MCU.

Serial communication is the foundation on which virtually every embedded peripheral interface is built. UART, SPI, I2C, CAN, USB, RS-485, 1-Wire are all serial protocols.

## The Fundamental Problem

The naive approach to moving data between two chips is to wire them together bit-for-bit: eight data lines, one for each bit of a byte, all driven simultaneously. This is a parallel bus, and it works beautifully on a single chip where the silicon is millimeters apart and the timing is controlled by a single clock.

Pin count is the other killer. A 32-bit parallel bus consumes 32 GPIO lines plus control signals.

## The Big Picture

At the highest level, serial communication is a pipeline: data enters as parallel bytes in the transmitter's memory, gets shifted out bit-by-bit onto a wire, travels to the receiver, gets shifted back into a parallel byte, and lands in the receiver's memory. The hardware that does the shifting — the shift register and its associated clock and control logic — is the UART, SPI, or I2C peripheral.

The architectural position of a serial peripheral is between the CPU's data bus and the physical wire. From the CPU's perspective, it writes a byte to a data register, and some time later that byte has been transmitted.

The diagram illustrates both the abstraction (parallel on the CPU side, serial on the wire side) and the concrete structure of an asynchronous frame. The clock source — whether shared between devices or reconstructed independently by each side — determines which category the protocol falls into.

![Serial Frame Structure — Parallel to Serial](/diagrams/serial_frame.svg)

## Key Concepts and Terminology

**Baud Rate** — The number of symbol changes per second on the line, measured in baud.

**Synchronous Communication** — A scheme where a dedicated clock line accompanies the data line.

**Asynchronous Communication** — A scheme where there is no shared clock line.

**Framing** — The structure imposed on a bit stream so that the receiver can identify the boundaries of each data unit.

**Start Bit** — The single logic-low bit that precedes every data byte in an asynchronous frame.

**Stop Bit** — One or two logic-high bits that follow the data bits (and parity bit, if used) at the end of a frame.

## How It Works

### Step 1 — the Line Sits Idle

Before any transmission, the TX line is held high (mark state) by the transmitter's output driver. This is the default state after reset on every UART-capable MCU pin.

### Step 2: Start Bit Signals the Frame Boundary

The transmitter pulls the line low for exactly one bit period. This falling edge is the synchronization event for the receiver.

### Step 3: Data Bits Are Shifted Out Lsb First

The transmitter shifts out bits from the least significant bit to the most significant bit, one per baud period. If you are sending the ASCII character 'A' (0x41, binary 01000001), the line sequence is: low (start), high (D0=1), low (D1=0), low (D2=0), low (D3=0), low (D4=0), low (D5=0), high (D6=1), low (D7=0).

### Step 4 — Optional Parity Bit Is Appended

If parity is configured, the hardware calculates the parity bit automatically and inserts it after the last data bit, before the stop bit. The receiver independently calculates parity on the received data bits and compares it to the received parity bit.

### Step 5 — Stop Bit Closes the Frame

The transmitter drives the line high for one (or two) bit periods. The receiver verifies it sees a high level at the stop bit position.

### Step 6: The Receive Shift Register Transfers to the Data Register

Once the full frame is assembled in the receive shift register, the UART peripheral moves the byte into the receive data register (RDR on STM32, UDR on AVR) and sets the RXNE (receive not empty) flag. This triggers either a CPU interrupt (if RXNEIE is set) or a DMA transfer.

## Under the Hood

The baud rate generator is a fractional clock divider driven from the peripheral clock (PCLK on STM32, FOSC/2 on most AVRs). On the STM32, the USART baud rate register (BRR) holds a fixed-point value with 12 integer bits and 4 fractional bits.

Oversampling is implemented as a counter that increments at 16x (or 8x) the baud rate. For each nominal bit period, the peripheral samples the line on ticks 7, 8, and 9 (out of 16) — the three samples centered in the bit window.

## Real-World Applications

AUTOMOTIVE: The CAN bus, the backbone of modern vehicle networks, is an asynchronous serial protocol running at 500 kbps or 1 Mbps over a differential pair. Every ECU — engine control, ABS, airbag, HVAC — communicates over the same two-wire bus.

INDUSTRIAL: RS-485 multidrop networks connect dozens of sensors, actuators, and PLCs over cable runs of up to 1200 meters using half-duplex differential serial at rates from 9600 baud to several megabaud. Modbus RTU, the most widely deployed industrial protocol in the world, runs on top of RS-485 and uses 8N2 or 8E1 framing.

## Common Mistakes

**Mistake 01** — Baud rate mismatch due to clock source assumption. The engineer configures 115200 baud in the HAL without verifying the peripheral clock frequency. If the PLL is not configured as expected (or the MCU boots from the internal RC oscillator at a different frequency than anticipated), the actual baud rate will be wrong.

**Mistake 02** — TX and RX pins swapped. UART TX of the MCU connects to TX of the other device instead of RX. This is extremely common during prototyping.

**Mistake 03** — Missing common ground. Two boards communicate over UART with no ground connection between them. If powered separately, the voltage reference is floating and received bits are unreliable.

## Debugging and Troubleshooting

**Symptom:** Receiver sees only garbage characters; every byte is wrong or the terminal shows random symbols.

**Possible Cause:** Baud rate mismatch between transmitter and receiver.

**Investigation Method:** Connect a logic analyzer or oscilloscope.

**Resolution:** Verify SystemCoreClock and peripheral clock divider settings.

---

**Symptom:** Communication works at first, then random bytes go missing.

**Possible Cause:** CPU is not reading the receive data register fast enough.

**Investigation Method:** Profile interrupt latency with a GPIO toggle at ISR entry and exit.

**Resolution:** Move to DMA receive.

---

## Design Considerations and Best Practices

1. **Choose Synchronous Over Asynchronous When the Extra Wire Is Acceptable.** Synchronous protocols eliminate baud rate mismatch errors entirely. If both devices are under your control and wire count is not constrained, SPI is more robust than UART because there is no clock tolerance budget to manage.

2. **Use Dma for Any Uart Link Above 115200 Baud.** At 921600 baud, a byte arrives every 10 microseconds. DMA moves bytes to a circular buffer without CPU involvement, eliminating overrun risk and freeing CPU cycles for application work.

## Expert Notes

**Note 01** — THE TC FLAG IS NOT THE TXNE FLAG. Every tutorial shows waiting for TXNE to clear before writing the next byte.

**Note 02** — BAUD RATE ERROR ACCUMULATES ACROSS THE FRAME. A 2% baud rate error means each bit period is 2% longer or shorter than expected.

## Summary

Serial communication exists because parallel buses are impractical in the physical world of real PCBs, cables, and constrained I/O pin counts. The core idea is simple: shift bits out one at a time, let the receiver shift them back in. Everything else — baud rates, framing, parity, duplex modes — is the engineering needed to make that simple idea reliable across different hardware, different clock sources, varying distances, and noisy environments.

The asynchronous/synchronous distinction is the first decision you make when choosing a protocol. Synchronous protocols (SPI, I2C) tie both devices to a shared clock and eliminate timing error at the cost of at least one additional wire. Asynchronous protocols (UART, RS-485) require only the data wire but impose a pre-agreed baud rate and the framing discipline of start and stop bits.

## Related Topics

**Prerequisites**

- GPIO Fundamentals
- Clock System Fundamentals

**Next Topics**

- UART Explained
- SPI Explained
- I2C Explained
- CAN Bus Explained
- DMA
