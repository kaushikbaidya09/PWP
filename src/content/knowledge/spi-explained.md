---
title: "SPI Explained: Fast Communication With Peripheral Chips"
brief: "Full-duplex SPI from the wire up: clock polarity and phase, chip-select timing, multi-device buses and DMA transfers."
order: 17
phase: 4
tags: ["SPI", "MOSI", "MISO", "Clock Polarity"]
---

Your accelerometer is returning garbage. You configured the I2C address correctly, wired everything up, and the datasheet says the sensor is at 0x1D — but the readings make no sense.

Plenty, as it turns out. SPI (Serial Peripheral Interface) is one of the most widely used synchronous serial protocols in embedded systems, appearing everywhere from display controllers and ADCs to flash memory and wireless modules.

## The Fundamental Problem

Microcontrollers need to talk to peripherals: sensors, memory, displays, codecs, wireless chips. Parallel buses (8 or 16 data lines plus address and control lines) are fast but consume enormous pin count.

The naive solution is bit-banging: toggle a clock line, set a data line high or low, and shift bits out manually in software. This works at low speeds, but it is CPU-intensive, not deterministic under interrupt load, and hits a ceiling well before the speeds that modern peripherals support.

## The Big Picture

![SPI Master–Slave Connection](/diagrams/spi_conn.svg)

SPI connects one master to one or more slaves using a shared clock and data bus, with individual chip select lines providing device selection. All slaves see the same SCK, MOSI, and MISO lines.

The master initiates every transfer. Slaves cannot initiate communication.

## Key Concepts and Terminology

**Sck (serial Clock)** — The clock signal generated exclusively by the master.

**MOSI (master out, slave in).** The data line from master to slave.

**MISO (master in, slave out).** The data line from slave to master.

**Cs / Nss (chip Select / Slave Select)** — An active-low signal that tells a specific slave it is being addressed.

**Cpol (clock Polarity)** — Defines the idle state of SCK when no transaction is occurring.

**Cpha (clock Phase)** — Defines which edge of SCK is used to SAMPLE (latch) incoming data and which edge is used to SHIFT OUT (change) data.

## How It Works

### Step 1 — Configure the Hardware

Before any transaction, both master and slave must agree on mode (CPOL/CPHA), bit order (MSB or LSB first), and maximum clock frequency. On an STM32F4 using HAL, this means setting SPI_InitTypeDef fields: Mode (SPI_MODE_MASTER), Direction (SPI_DIRECTION_2LINES), DataSize (SPI_DATASIZE_8BIT), CLKPolarity, CLKPhase, NSS (SPI_NSS_SOFT for multi-device), BaudRatePrescaler, and FirstBit.

### Step 2 — Assert Chip Select

The master drives the CS GPIO output low before the first clock edge. This must happen a minimum setup time (tCSS) before SCK begins, as specified in the slave's datasheet.

### Step 3: Clock Starts, Data Shifts

With CS asserted, the master begins toggling SCK. On each cycle, one bit is shifted out of the master's shift register onto MOSI, and simultaneously one bit is shifted into the master's shift register from MISO.

### Step 4: Byte Completes, Status Flags Update

After 8 clock cycles (for 8-bit data), the transfer is complete. On STM32, the RXNE (Receive Buffer Not Empty) flag in SPI_SR is set, indicating that a received byte is ready to be read from SPI_DR.

### Step 5 — Multi-Byte Transactions

Most SPI peripherals require a sequence of bytes within a single CS assertion. A typical SPI flash read looks like: assert CS, send READ command byte (0x03), send three address bytes, then send N dummy bytes while clocking in N data bytes, then deassert CS.

### Step 6 — Deassert Chip Select

After all bytes have been transferred and the BSY (busy) flag in SPI_SR has cleared, the master drives CS high. The BSY flag matters because it indicates the SPI hardware is still shifting the last byte; deasserting CS before BSY clears will truncate the final byte.

### Step 7 — Multi-Device Bus Management

With multiple slaves sharing SCK, MOSI, and MISO, the master must ensure only one CS is asserted at any time. Asserting two CS lines simultaneously causes two slaves to drive MISO simultaneously, which is a bus contention fault that can damage ICs or corrupt data.

## Under the Hood

At the register level on an STM32F4, SPI is configured through SPI_CR1 and SPI_CR2. SPI_CR1 holds CPOL, CPHA, MSTR (master mode enable), BR[2:0] (baud rate prescaler), SPE (SPI enable), LSBFIRST, SSI (internal slave select), and SSM (software slave manage).

The shift register clock relationship between CPOL and CPHA can be understood by drawing the waveform. Consider Mode 0: SCK idles low (CPOL=0).

## Real-World Applications

### Automotive

SPI is the primary interface for external SPI flash used in automotive ECUs to store calibration tables and firmware images. Typical devices are NOR flash chips (Winbond, Microchip SST) at 4-16 MB, accessed via SPI at 20-40 MHz.

### Consumer Electronics

Almost every small TFT or e-ink display module uses SPI. The ST7789 controller (common on Adafruit and similar breakout boards) is a classic example: it accepts 8-bit or 16-bit SPI data at up to 15 MHz.

## Common Mistakes

**Wrong Spi Mode** — The peripheral datasheet says Mode 0 but the engineer configures Mode 3 (or vice versa). Both modes have SCK idle low/high reversed. The result is corrupted data on every byte.

**Not Waiting for Bsy to Clear Before Deasserting Cs** — The engineer deasserts CS immediately after writing the last byte to SPI_DR. The SPI hardware is still shifting that last byte when CS goes high, truncating the transfer. The final byte received by the slave is corrupted.

**Forgetting to Drain the Receive Buffer** — The engineer sends multiple bytes but only reads the last received byte. The RX FIFO fills, OVR sets, and the entire SPI state machine stalls or corrupts subsequent transfers. To avoid: always read SPI_DR after every byte sent, or use DMA with both TX and RX channels active.

## Debugging and Troubleshooting

**Symptom:** Data received by master is all 0xFF or all 0x00.

**Possible Cause:** MISO line is not driven by the slave.

**Investigation Method:** Use a multimeter to verify slave power supply voltage.

**Resolution:** Correct GPIO alternate function configuration for MISO.

---

**Symptom:** Every byte received is shifted by one or two bits (e.g., expected 0x9A, got 0x4D or 0x26).

**Possible Cause:** Wrong CPHA setting.

**Investigation Method:** Capture SCK, MOSI, MISO, and CS simultaneously on a logic analyzer.

**Resolution:** Toggle CPHA between 0 and 1 in the SPI configuration register (SPI_CR1 bit 0 on STM32).

---

## Design Considerations and Best Practices

### Always Initialize CS Lines High Before Enabling SPI

GPIO outputs on most MCUs default to low after reset. If CS is low at power-on, the SPI peripheral's initialization traffic (or any other bus activity) will be interpreted by the slave as a valid transaction.

### Use Software NSS Management for Multi-Slave Systems

STM32 hardware NSS management is designed for single-slave point-to-point use. For any system with multiple SPI slaves, set SSM=1 and SSI=1 in SPI_CR1 (SPI_NSS_SOFT in HAL) and manage each CS line as a plain GPIO output.

## Expert Notes

**The dummy byte problem bites everyone at least once.**

### SPI Peripheral Reset State After Abort Is Undefined

If a firmware bug causes a transaction to be aborted mid-byte (CS deasserted early, SPI peripheral disabled during transfer), the slave's internal state machine is now in an unknown state. The slave is typically designed to reset on CS going high, but not all peripherals do this cleanly.

### Logic Analyzers Lie About High-Speed SPI

A cheap 24 MHz logic analyzer (the ubiquitous USB LA tools) will misrepresent signals running above 10-12 MHz due to sample rate limitations and input hysteresis. If your SPI peripheral is rated at 20 MHz and you are seeing occasional bit errors that only show up on the logic analyzer trace, the problem may be the measurement tool, not the circuit.

## Summary

SPI is a synchronous, full-duplex, master-driven serial protocol that exchanges data between shift registers using a shared clock. Its four-wire interface (SCK, MOSI, MISO, CS) is simple in concept but demands precise configuration of clock polarity, clock phase, device selection, and bus management. Every SPI failure traces back to one of a small set of root causes: wrong mode, incorrect CS handling, receive buffer overrun, or marginal timing.

The CPOL and CPHA parameters are the most critical configuration choices. They define which edge samples data and which shifts it. Mode 0 (CPOL=0, CPHA=0) is by far the most common, but you must always verify against the peripheral's timing diagram.

## Related Topics

**Prerequisites**

- Serial Communication Fundamentals (UART, synchronous vs asynchronous, baud rate)
- GPIO Fundamentals (push-pull, open-drain, alternate function, GPIO speed settings)
- Clock System Fundamentals (APB bus, peripheral clocks, prescalers)

**Next Topics**

- I2C Explained (multi-master addressing, open-drain bus, ACK/NAK, clock stretching)
- DMA (Direct Memory Access) (memory-to-peripheral transfer, circular mode, interrupt-driven completion)
