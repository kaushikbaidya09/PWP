---
title: "UART Explained: Simple Serial Communication Over Two Wires"
brief: "Start bits, baud-rate error, framing and flow control, plus ring-buffered, interrupt-driven and DMA-driven UART drivers."
order: 16
phase: 4
tags: ["UART", "Baud Rate", "Framing", "RS-232"]
---

You are three days into debugging a new board. The GPS module is connected, power is clean, and the firmware compiles without errors.

This scenario plays out on real hardware constantly, across every industry. UART — Universal Asynchronous Receiver/Transmitter — is the oldest and most ubiquitous serial interface in embedded systems.

## The Fundamental Problem

Moving data between two digital systems requires a shared reference. If both sides share a clock line, the receiver can latch data on every clock edge and the framing is guaranteed.

The naive solution is to remove the clock line and have both devices count time themselves. The sender outputs bits at a fixed rate; the receiver samples the line at the same fixed rate.

## The Big Picture

UART occupies the lowest layer of a serial communication stack. At the physical layer, two wires carry data in opposite directions: TX from transmitter to receiver, and RX from receiver to transmitter.

The UART peripheral connects to the MCU's APB or AHB bus on one side and to the physical TX/RX pins on the other. A baud rate generator divides the peripheral clock down to the desired bit rate.

The animation below shows one byte leaving on the TX line, bit by bit:

![Animated UART frame sending the letter A: start bit, eight data bits and stop bit on the TX line](/diagrams/uart_flow.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Baud Rate** | The number of symbol transitions per second on the line. |
| **Frame** | The complete unit of transmission for one byte. |
| **Oversampling** | The technique the receiver uses to locate the center of each bit period. |
| **Baud Rate Generator** | A clock divider inside the UART peripheral. |
| **Tx FIFO** | A small FIFO buffer (typically 8-64 bytes) between the transmit data register and the transmit shift register. |
| **Rx FIFO** | The receive-side FIFO buffer. |

## How It Works

### Step 1: Idle state and start bit detection

When no data is being sent, the UART TX line idles high (logic 1 at the TTL level). The receiver monitors RX continuously.

### Step 2: Bit center alignment

Once the start bit is confirmed, the receiver's internal counter is synchronized to the start bit edge. The receiver then counts forward to sample each data bit at its center.

### Step 3: Data bit sampling and shift register assembly

The receive shift register collects sampled bits LSB first. For a standard 8N1 frame (8 data bits, no parity, 1 stop bit), the shift register collects 8 bits over 8 bit periods.

### Step 4: Parity and stop bit verification

If parity is enabled, the hardware computes the parity of the received data bits and compares it to the received parity bit. A mismatch sets the PARITY ERROR flag in the status register.

### Step 5: Byte transfer to rx FIFO

After the stop bit is verified, the byte in the shift register is transferred to the RX FIFO (or directly to the RDR register if there is no FIFO). On the AVR ATmega series, there is a two-level buffer; on STM32 USART peripherals, there is a single-byte buffer by default and a larger FIFO on parts that support FIFO mode.

### Step 6: Transmit path

Software writes a byte to the transmit data register (or FIFO). The hardware transfers it to the transmit shift register when the shift register is empty.

## Under the Hood

The baud rate generator on most Cortex-M peripherals works as a fractional divider. On the STM32 USART, the USARTDIV value is a 16-bit fixed-point number with a 4-bit fractional part (for 16x oversampling mode).

The 16x oversampling clock runs at 16 times the baud rate. The receiver samples the RX line on every oversampling clock edge.

## Real-World Applications

### Automotive

UART underlies the K-line diagnostic bus used in older OBD-II systems. More recently, LIN (Local Interconnect Network) is a single-wire bus based on a UART-compatible frame format, running at up to 20 kbaud.

### Industrial

RS-232 and RS-485 (which uses differential signaling but UART framing) are ubiquitous in factory automation, PLCs, and instrumentation. Modbus RTU, one of the most deployed industrial protocols in the world, runs over RS-485 with UART framing.

## Common Mistakes

### Mistake 1: Wrong baud rate divisor calculation

**What goes wrong:** Engineer uses an integer divisor formula, ignores fractional support, and accumulates 2-5% error. Works on bench with one specific crystal but fails with a different frequency crystal variant or when the GPS module's own oscillator is at a different tolerance end.

**How to avoid:** Always calculate the exact floating-point USARTDIV, then use the MCU's fractional BRR register to minimize error. Verify with a frequency counter or oscilloscope.

### Mistake 2: Ignoring framing and overrun error flags

**What goes wrong:** Firmware reads bytes from the RDR register without checking the status register first. Corrupted bytes are passed silently to the application layer, causing protocol failures that look like software bugs rather than hardware issues.

**How to avoid:** Always read the status register before reading data. In the ISR, check ORE (overrun error), FE (framing error), and PE (parity error) flags.

### Mistake 3: Swapping tx and rx

**What goes wrong:** The TX of one device must connect to the RX of the other. Engineers wire TX-to-TX and RX-to-RX by following a label convention that seems symmetric.

**How to avoid:** Trace the signal direction explicitly: TX on device A outputs, RX on device B inputs. Draw an arrow on the schematic.

## Debugging and Troubleshooting

**Symptom:** All received bytes are 0xFF or 0x00

**Possible Cause:** TX and RX lines are both unconnected or shorted to a supply rail.

**Investigation Method:** Probe RX on the receiving MCU with an oscilloscope.

**Resolution:** Verify physical connections.

**Symptom:** Intermittent framing errors, seemingly random

**Possible Cause:** Baud rate mismatch between the two ends, or crystal frequency tolerance mismatch.

**Investigation Method:** Measure the actual baud rate of the transmitter with a frequency counter or oscilloscope time measurement on a known byte (0x55 at 9600 baud has 104.2 us bit periods).

**Resolution:** Recalculate the USARTDIV for both ends.

## Design Considerations and Best Practices

1. ALWAYS CHECK ERROR FLAGS BEFORE READING THE DATA REGISTER

On many STM32 parts, reading the data register clears the status register flags. If you read the data register first, you lose the error context for that byte.

## Expert Notes

### The Baud Rate Error Accumulates in One Direction

If the transmitter is running 0.5% faster than the receiver, the sampling drift is always in the same direction — the receiver samples progressively later relative to each bit center. This means that at the end of a long frame (10 bits), the cumulative drift is 0.05 bit periods, which is safe.

### Overrun Error Is Sticky on Some Silicon Revisions

On certain STM32 silicon revisions, the ORE flag in SR cannot be cleared just by reading SR and then DR. It requires the specific read-SR-then-read-DR sequence, in that order, in the same ISR invocation.

## Summary

UART is the foundation of serial communication in embedded systems, and its apparent simplicity hides a set of precise mechanical details that determine whether it works reliably. The frame format — start bit, data bits, optional parity, stop bits — is the contract between transmitter and receiver. The start bit provides per-frame resynchronization that is the key insight allowing asynchronous operation to work despite clock tolerance.

The baud rate generator is a clock divider, and integer division introduces error. On modern MCU peripherals with fractional BRR support, this error can be reduced to well below 0.5%. The error must be calculated and documented explicitly; it is not safe to assume the hardware picks the right value.

## Related Topics

**Prerequisites**

- Serial Communication Fundamentals (clock domains, signal levels, protocol layers)
- GPIO Fundamentals
- Clock System Fundamentals
- Interrupts

**Next Topics**

- SPI Explained (synchronous serial, master/slave, clock polarity and phase)
- I2C Explained (two-wire bus, addressing, clock stretching, multi-master)
- DMA (memory-to-peripheral, circular buffers, half-transfer interrupts)
- Bootloaders and Firmware Updates
