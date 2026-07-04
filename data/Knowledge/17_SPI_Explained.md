---
id: spi-explained
tags: ['SPI', 'MOSI', 'MISO', 'Clock Polarity']
---

# SPI Explained: Serial Peripheral Interface for Embedded Systems Engineers

Your accelerometer is returning garbage. You configured the I2C address correctly, wired everything up, and the datasheet says the sensor is at 0x1D -- but the readings make no sense. Then you swap to a different sensor module and notice it has four pins instead of two: SCK, MOSI, MISO, and CS. The datasheet says "SPI interface." You have just encountered SPI for the first time, and if you have not used it before, it looks deceptively simple. Four wires. Full duplex. Fast. What could go wrong?

Plenty, as it turns out. SPI (Serial Peripheral Interface) is one of the most widely used synchronous serial protocols in embedded systems, appearing everywhere from display controllers and ADCs to flash memory and wireless modules. It was developed by Motorola in the mid-1980s and has since become an informal standard, meaning there is no formal specification body -- only a shared convention that hardware vendors interpret slightly differently. That last point is critical and causes more bugs than almost any other aspect of the protocol.

Unlike I2C, SPI does not have a built-in addressing mechanism. There is no device ID broadcast on the bus. Selection is handled purely through hardware: a dedicated chip select line per peripheral. This means SPI scales in wiring cost as you add devices, but it also means the protocol itself stays simple, fast, and deterministic -- qualities that matter enormously in real-time and high-throughput applications.

SPI is also genuinely full duplex. While the master sends a byte, it simultaneously receives a byte. Every clock cycle moves one bit in each direction. This is not a software abstraction -- it is how the shift registers physically work, and understanding it changes how you think about multi-byte transactions and dummy bytes.

By the end of this article, you will understand how SPI transfers bits at the hardware level, what CPOL and CPHA actually mean and how to set them correctly, how chip select works in single and multi-device configurations, where SPI fits in a system architecture, and how to diagnose the common failures that trip up engineers at every experience level.

## The Fundamental Problem

Microcontrollers need to talk to peripherals: sensors, memory, displays, codecs, wireless chips. Parallel buses (8 or 16 data lines plus address and control lines) are fast but consume enormous pin count. On a 64-pin MCU that must also run I/O, timers, and PWM, dedicating 16 pins to a data bus is simply not viable. The problem is moving data reliably between chips without burning your entire pin budget.

The naive solution is bit-banging: toggle a clock line, set a data line high or low, and shift bits out manually in software. This works at low speeds, but it is CPU-intensive, not deterministic under interrupt load, and hits a ceiling well before the speeds that modern peripherals support. A SPI flash chip rated for 80 MHz transactions cannot be driven usefully by bit-banging on a 72 MHz Cortex-M3.

A deeper problem is synchronization. Asynchronous UART solves the pin problem but requires both sides to agree on baud rate and tolerates only small clock drift. For chip-to-chip communication on the same PCB, where one device can simply provide a clock for the other, a synchronous approach is far more robust. SPI takes this to its logical conclusion: the master owns the clock entirely. The peripheral has no oscillator requirement for its serial interface -- it just watches SCK and shifts bits in or out on each edge.

The result is a protocol that is simple enough for an 8-bit AVR running at 8 MHz to implement in dedicated hardware (the SPDR, SPSR, and SPCR registers), and fast enough for an STM32H7 to push 50 Mbps to a display driver. The tradeoff is that SPI demands more pins per device and puts all timing responsibility on the master.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/spi_conn.svg" alt="SPI Master–Slave Connection" loading="lazy">
</div>

SPI connects one master to one or more slaves using a shared clock and data bus, with individual chip select lines providing device selection. All slaves see the same SCK, MOSI, and MISO lines. Only the selected slave (CS pulled low) is actively driving MISO and latching MOSI. Unselected slaves ignore the clock and hold their MISO outputs in a high-impedance state.

The master initiates every transfer. Slaves cannot initiate communication. If a slave needs to signal the master asynchronously -- for example, an interrupt from an IMU indicating new data ready -- it does so through a separate interrupt pin, not through the SPI bus itself. The SPI bus is strictly request-response from the master's point of view.

The overall data flow in a typical read transaction follows this path: the master asserts chip select, then drives SCK while simultaneously shifting out a command byte on MOSI and clocking in a response byte on MISO. On the peripheral side, the received command is decoded and the response data is loaded into a shift register for transmission.

**Ascii Block Diagram** — SPI BUS TOPOLOGY (INDEPENDENT CS):

Each device shares SCK, MOSI, and MISO. CS lines are driven by individual GPIO outputs on the master. Only one CS is asserted low at any time during normal operation. This is the INDEPENDENT (NON-DAISY-CHAINED) topology, which is by far the most common.

## Key Concepts and Terminology

**Sck (serial Clock)** — The clock signal generated exclusively by the master. All data sampling and shifting is referenced to SCK edges. The master controls both the clock frequency and polarity. The slave derives its entire timing from SCK and cannot communicate without it.

MOSI (MASTER OUT, SLAVE IN) - The data line from master to slave. The master drives this line. The active slave latches the bit on MOSI on the appropriate SCK edge. All slaves on the bus see MOSI simultaneously, but only the selected slave acts on it.

MISO (MASTER IN, SLAVE OUT) - The data line from slave to master. The selected slave drives this line in response to the clock. Unselected slaves must tristate their MISO driver, otherwise multiple slaves would fight on the same line. Most SPI peripherals do this automatically when CS is deasserted.

**Cs / Nss (chip Select / Slave Select)** — An active-low signal that tells a specific slave it is being addressed. In STM32 terminology this is NSS (Negative Slave Select). The master asserts CS low before the first clock edge and deasserts it high after the last clock edge of the transaction. On STM32, NSS can be hardware-managed or software-managed (SSM/SSI bits in SPI_CR1). Software management is more flexible in multi-device setups.

**Cpol (clock Polarity)** — Defines the idle state of SCK when no transaction is occurring. CPOL=0 means SCK idles low. CPOL=1 means SCK idles high. This must match the peripheral's requirement exactly; getting it wrong means every falling edge becomes a rising edge from the protocol's perspective, which inverts the entire timing.

**Cpha (clock Phase)** — Defines which edge of SCK is used to SAMPLE (latch) incoming data and which edge is used to SHIFT OUT (change) data. CPHA=0 means data is sampled on the FIRST edge (the edge coming out of idle). CPHA=1 means data is sampled on the SECOND edge. This is the most commonly misconfigured parameter in SPI bring-up.

**Spi Mode** — A two-bit combination of CPOL and CPHA that fully describes the clock behavior. Mode 0 is CPOL=0, CPHA=0 (most common). Mode 1 is CPOL=0, CPHA=1. Mode 2 is CPOL=1, CPHA=0. Mode 3 is CPOL=1, CPHA=1. Datasheets will specify one of these four modes; always set both CPOL and CPHA explicitly rather than assuming a default.

**Shift Register** — The hardware mechanism underlying SPI. Both master and slave contain an 8-bit (or 16-bit) shift register. On each clock edge, the master shifts one bit out of its register onto MOSI while simultaneously shifting one bit in from MISO. The slave does the same in reverse. After 8 clocks, both shift registers have exchanged their entire contents.

**Full Duplex** — SPI transmits and receives simultaneously on every clock cycle. This is not a mode -- it is the fundamental architecture. When you send a command byte, you simultaneously receive a byte. That received byte is typically meaningless during a command phase and must be discarded; failure to drain the receive buffer causes overrun errors in subsequent transactions.

**Dummy Byte** — A byte the master sends when it only wants to receive data. Because SPI requires clock cycles to shift in MISO data, the master must send SOMETHING on MOSI to generate those clocks. The payload is irrelevant (0x00 or 0xFF are conventional), and the returned data is what the master actually wants. Many SPI datasheets describe read sequences in terms of dummy bytes explicitly.

## How It Works

### Step 1 -- Configure the Hardware

Before any transaction, both master and slave must agree on mode (CPOL/CPHA), bit order (MSB or LSB first), and maximum clock frequency. On an STM32F4 using HAL, this means setting SPI_InitTypeDef fields: Mode (SPI_MODE_MASTER), Direction (SPI_DIRECTION_2LINES), DataSize (SPI_DATASIZE_8BIT), CLKPolarity, CLKPhase, NSS (SPI_NSS_SOFT for multi-device), BaudRatePrescaler, and FirstBit. The peripheral clock is divided by the prescaler to produce SCK; on an STM32F4 with PCLK2 at 84 MHz and prescaler 8, SCK is 10.5 MHz.

### Step 2 -- Assert Chip Select

The master drives the CS GPIO output low before the first clock edge. This must happen a minimum setup time (tCSS) before SCK begins, as specified in the slave's datasheet. This setup time is typically tens of nanoseconds, which matters only at very high clock rates. If you are using STM32 HAL with software NSS, you call HAL_GPIO_WritePin() to assert CS manually before calling HAL_SPI_Transmit() or HAL_SPI_TransmitReceive(). The slave sees CS go low and enables its MISO driver and its internal shift register clock.

### Step 3: Clock Starts, Data Shifts

With CS asserted, the master begins toggling SCK. On each cycle, one bit is shifted out of the master's shift register onto MOSI, and simultaneously one bit is shifted into the master's shift register from MISO. The slave does the complementary operation. The exact edge used for sampling versus shifting depends on the SPI mode. In Mode 0 (CPOL=0, CPHA=0), the master shifts out data on the falling edge of SCK (or on CS assertion) and samples MISO on the rising edge. In Mode 1 (CPOL=0, CPHA=1), data is shifted out on the rising edge and sampled on the falling edge. The hardware SPI peripheral on the MCU handles all of this automatically once the mode is configured.

### Step 4: Byte Completes, Status Flags Update

After 8 clock cycles (for 8-bit data), the transfer is complete. On STM32, the RXNE (Receive Buffer Not Empty) flag in SPI_SR is set, indicating that a received byte is ready to be read from SPI_DR. The TXE (Transmit Buffer Empty) flag indicates the transmit buffer can accept the next byte. In polled mode, firmware checks these flags in a loop. In interrupt mode, the RXNE interrupt fires. In DMA mode, the DMA controller handles the buffer transfer autonomously. Failing to read SPI_DR after each byte causes the OVR (overrun) flag to set, and subsequent receive data will be corrupted.

### Step 5 -- Multi-Byte Transactions

Most SPI peripherals require a sequence of bytes within a single CS assertion. A typical SPI flash read looks like: assert CS, send READ command byte (0x03), send three address bytes, then send N dummy bytes while clocking in N data bytes, then deassert CS. All of this happens without toggling CS in between. The slave interprets the first byte as a command and subsequent bytes as parameters or data phases. Deasserting CS mid-transaction aborts the operation and leaves the peripheral in an undefined state.

### Step 6 -- Deassert Chip Select

After all bytes have been transferred and the BSY (busy) flag in SPI_SR has cleared, the master drives CS high. The BSY flag matters because it indicates the SPI hardware is still shifting the last byte; deasserting CS before BSY clears will truncate the final byte. The slave deactivates its MISO driver when CS goes high, releasing the MISO line for use by other slaves on the bus.

### Step 7 -- Multi-Device Bus Management

With multiple slaves sharing SCK, MOSI, and MISO, the master must ensure only one CS is asserted at any time. Asserting two CS lines simultaneously causes two slaves to drive MISO simultaneously, which is a bus contention fault that can damage ICs or corrupt data. The master manages this purely through GPIO discipline. There is no hardware enforcement.

## Under the Hood

At the register level on an STM32F4, SPI is configured through SPI_CR1 and SPI_CR2. SPI_CR1 holds CPOL, CPHA, MSTR (master mode enable), BR[2:0] (baud rate prescaler), SPE (SPI enable), LSBFIRST, SSI (internal slave select), and SSM (software slave manage). SPI_CR2 holds TXEIE, RXNEIE, ERRIE (interrupt enables), SSOE (SS output enable), and TXDMAEN/RXDMAEN (DMA request enables). The SPI_DR register is both the transmit buffer and the receive buffer at the same address; writing to it loads the TX FIFO, reading from it drains the RX FIFO. On STM32F4 this is effectively double-buffered: you can write the next byte as soon as TXE sets, without waiting for the current byte to finish.

The shift register clock relationship between CPOL and CPHA can be understood by drawing the waveform. Consider Mode 0: SCK idles low (CPOL=0). The first rising edge is the sampling edge (CPHA=0). The master must have MOSI data stable BEFORE the first rising edge. It sets MOSI as CS is asserted or on the preceding falling edge. At the first rising SCK edge, both master and slave latch the first bit. At the first falling SCK edge, both sides shift out the next bit onto MOSI and MISO. This repeats for 8 cycles. Mode 3 (CPOL=1, CPHA=1) is electrically identical to Mode 0 in terms of the relationship between sampling edge and data setup time -- both sample on the second edge relative to idle -- which is why some devices work on both modes but not on Modes 1 and 2.

The MISO line has a specific timing constraint called t_DO (data output time) in slave datasheets. This is the maximum delay from the clock edge at which the slave changes MISO to a valid state. At high clock frequencies, this propagation delay plus PCB trace delay can violate the master's MISO setup-and-hold window. For example, an SPI ADC rated for SPI clock up to 20 MHz at 3.3V might have a t_DO of 15 ns. At 20 MHz, the clock period is 50 ns and the half-period is 25 ns. If the master samples on the rising edge, it needs MISO valid at least a few nanoseconds before that edge. 15 ns of slave output delay plus 2 ns of trace delay leaves only 8 ns of margin. Add temperature variation and multiple board revisions, and you have an intermittent failure that appears only in production.

On Cortex-M processors, the SPI peripheral is a bus-mastering device connected to the APB (Advanced Peripheral Bus). On STM32F4, SPI1 is on APB2 (up to 84 MHz), while SPI2 and SPI3 are on APB1 (up to 42 MHz). This means SPI1 can achieve higher clock rates than SPI2/SPI3 for the same prescaler setting. When designing a high-speed SPI interface to a display or flash chip, SPI1 is the correct choice on this family.

DMA transfers for SPI work by connecting the DMA stream to the SPI_DR register. The DMA controller increments through a source buffer in memory and writes each byte to the fixed SPI_DR address (or vice versa for receive). The CPU is free during the transfer. However, you MUST enable both TX and RX DMA streams simultaneously for full-duplex operation, even if you do not care about the received data. If you enable only TX DMA, the RX FIFO will fill up, the OVR flag will set, and the SPI state machine may stall. A common pattern is to point the RX DMA at a single dummy byte location with no-increment mode, purely to drain the receive FIFO.

## Real-World Applications

### Automotive

SPI is the primary interface for external SPI flash used in automotive ECUs to store calibration tables and firmware images. Typical devices are NOR flash chips (Winbond, Microchip SST) at 4-16 MB, accessed via SPI at 20-40 MHz. SPI is also used for high- resolution encoder interfaces and for communication to dedicated automotive-grade ADC chips (e.g., measuring battery cell voltages in BMS systems). The deterministic timing and lack of address collisions (unlike I2C) make SPI preferred in safety-critical paths.

### Consumer Electronics

Almost every small TFT or e-ink display module uses SPI. The ST7789 controller (common on Adafruit and similar breakout boards) is a classic example: it accepts 8-bit or 16-bit SPI data at up to 15 MHz. IMUs like the LSM6DSO from STMicroelectronics support both SPI and I2C; in high-ODR applications (6.6 kHz accelerometer output), engineers choose SPI because I2C cannot sustain the required throughput. SD cards use a simplified SPI mode for initialization and low-speed access, which is why nearly every SD card library for Arduino and STM32 is built on SPI.

### Industrial

High-speed ADCs and DACs in industrial measurement equipment almost universally use SPI. A 16-bit ADC sampling at 500 ksps with a 16-bit result needs to move 8 Mbps of data -- well within SPI's capability but impossible over I2C. Digital potentiometers, signal chain programmable-gain amplifiers, and digital isolators commonly use SPI. In programmable logic controllers, SPI links the main MCU to expansion I/O chips (e.g., MCP23S17 port expanders).

### Medical

Portable patient monitors use SPI to interface the main processor with AFE (analog front end) ICs for ECG, SpO2, and blood pressure measurement. The ADS1292 (Texas Instruments) ECG AFE uses SPI with a dedicated DRDY interrupt line -- the AFE pulls DRDY low when new data is ready, and the MCU initiates an SPI read transaction in response. The clean separation between interrupt signaling and data transfer is a common SPI design pattern.

### Aerospace and Defense

Inertial Measurement Units for aerospace (e.g., Analog Devices ADIS series) use SPI for their primary data interface. These devices often use 16-bit SPI frames, MSB-first, at rates up to 2 MHz, with specific timing requirements for CS-to-SCK setup time that must be verified against the MCU's timing.

### Iot

RF modules such as the nRF24L01+, CC1101, and LoRa (SX1276/SX1278) use SPI for configuration and data transfer. The master writes to configuration registers over SPI, then triggers a transmit by asserting a GPIO. The module signals completion via an interrupt line. This SPI + interrupt pattern appears in virtually every discrete wireless module designed for microcontroller use.

## Common Mistakes

**Wrong Spi Mode** — The peripheral datasheet says Mode 0 but the engineer configures Mode 3 (or vice versa). Both modes have SCK idle low/high reversed. The result is corrupted data on every byte. To avoid: always read the CPOL and CPHA values explicitly from the peripheral datasheet, cross-reference the timing diagram with the waveforms, and verify with a logic analyzer before trusting software behavior.

**Not Waiting for Bsy to Clear Before Deasserting Cs** — The engineer deasserts CS immediately after writing the last byte to SPI_DR. The SPI hardware is still shifting that last byte when CS goes high, truncating the transfer. The final byte received by the slave is corrupted. To avoid: on STM32 HAL this is handled internally, but in register-level code, poll until the BSY bit in SPI_SR clears before toggling CS.

**Forgetting to Drain the Receive Buffer** — The engineer sends multiple bytes but only reads the last received byte. The RX FIFO fills, OVR sets, and the entire SPI state machine stalls or corrupts subsequent transfers. To avoid: always read SPI_DR after every byte sent, or use DMA with both TX and RX channels active.

**Bus Contention on Miso** — Two or more CS lines are asserted simultaneously, either by a firmware bug or because CS lines are not initialized to high before the SPI peripheral is enabled. Both slaves drive MISO, which can latch-up outputs or simply corrupt data. To avoid: initialize all CS GPIO outputs to high BEFORE enabling the SPI peripheral. This must happen in the GPIO init sequence, not after SPI init.

**Clock Frequency Exceeding Peripheral Maximum** — The engineer sets the SPI clock to the maximum the MCU supports without checking the peripheral's maximum SCK frequency. The peripheral works intermittently or not at all. At cold temperatures, the device may work; at high temperature, it fails. To avoid: check the peripheral datasheet for f_SCK max at the operating supply voltage and temperature range. Derate by at least 20% in production.

**Ignoring the Cs-to-Sck Setup Time** — The master asserts CS and immediately drives SCK. Some peripherals require a minimum time (tCSS) between CS assertion and the first clock edge. Violating this causes the first bit of the first byte to be missed or mislatched. To avoid: add a GPIO toggle followed by at minimum a NOP or small delay before beginning the SPI transfer if operating near the maximum clock rate.

**Using 5v Spi Signals on a 3.3v Peripheral** — An AVR MCU at 5V drives its SPI lines at 5V. The accelerometer has 3.3V-rated inputs. The result is latent damage or immediate failure. To avoid: check logic level compatibility. Use level shifters (74LVC245, TXS0104) or ensure both devices operate at the same voltage.

**Assuming Spi Is Bidirectional on All Peripherals** — Some SPI slaves are write-only (e.g., some simple DACs and display controllers). Their MISO pin is not connected or is not implemented. Attempting to read back data from these devices returns garbage or the MISO line floats. To avoid: read the peripheral datasheet to determine if MISO is functional.

## Debugging and Troubleshooting

**Symptom:** Data received by master is all 0xFF or all 0x00.

**Possible Cause:** MISO line is not driven by the slave. CS may not be asserted, the slave may be powered off, or the MISO GPIO may be misconfigured as an input without alternate function assignment.

**Investigation Method:** Use a multimeter to verify slave power supply voltage. Use a logic analyzer to confirm CS goes low before SCK starts. Confirm the MISO pin on the MCU is configured as AF (Alternate Function) for SPI, not as a plain GPIO input. On STM32 CubeMX, verify the MISO pin shows the SPI AF label.

**Resolution:** Correct GPIO alternate function configuration for MISO. Verify CS GPIO is initialized high and toggled low before HAL_SPI_TransmitReceive(). Confirm slave power rail.

---

**Symptom:** Every byte received is shifted by one or two bits (e.g., expected 0x9A, got 0x4D or 0x26).

**Possible Cause:** Wrong CPHA setting. The master is sampling on the wrong clock edge, causing it to read the previous bit's value instead of the current bit.

**Investigation Method:** Capture SCK, MOSI, MISO, and CS simultaneously on a logic analyzer. Decode the raw bit stream manually and compare the sampling edges to what the peripheral datasheet shows in its timing diagram.

**Resolution:** Toggle CPHA between 0 and 1 in the SPI configuration register (SPI_CR1 bit 0 on STM32). Retest. If the bit shift disappears, the original CPHA setting was wrong.

---

**Symptom:** First byte of a multi-byte transfer is correct but subsequent bytes are corrupted.

**Possible Cause:** RX FIFO overrun (OVR flag set in SPI_SR). The firmware is not reading SPI_DR fast enough between bytes, causing the newly received byte to overwrite the previous one before it was read.

**Investigation Method:** In the debugger, halt execution after a transfer and read SPI_SR. Check if OVR (bit 6) is set. Alternatively, add OVR error callback handling (HAL_SPI_ErrorCallback) and set a breakpoint or toggle a GPIO inside it.

**Resolution:** In polled mode, ensure SPI_DR is read after every transmitted byte before sending the next. In DMA mode, enable both TX and RX DMA channels. Clear OVR by reading SPI_DR followed by SPI_SR as described in the STM32 reference manual.

---

**Symptom:** SPI works on the bench at room temperature but fails randomly in the field or at temperature extremes.

**Possible Cause:** Marginal timing. SPI clock frequency is close to the peripheral's maximum, or MISO propagation delay (t_DO) is consuming most of the setup time budget. Temperature degrades transistor switching speed, reducing margin to zero.

**Investigation Method:** Calculate the setup time budget: half clock period minus t_DO_max at worst temperature minus trace propagation delay. If this is less than ~5 ns, there is insufficient margin. Use an oscilloscope (not a logic analyzer) to capture MISO transitions relative to SCK at the extremes.

**Resolution:** Reduce SPI clock frequency by increasing the prescaler. Alternatively, configure the master to sample on the opposite phase (which may give a full half-period of extra margin) if the peripheral supports both modes.

## Design Considerations and Best Practices

### Always Initialize Cs Lines High Before Enabling Spi

GPIO outputs on most MCUs default to low after reset. If CS is low at power-on, the SPI peripheral's initialization traffic (or any other bus activity) will be interpreted by the slave as a valid transaction. Initialize all CS GPIOs to high in the GPIO init code that runs before SPI init.

### Use Software Nss Management for Multi-Slave Systems

STM32 hardware NSS management is designed for single-slave point-to-point use. For any system with multiple SPI slaves, set SSM=1 and SSI=1 in SPI_CR1 (SPI_NSS_SOFT in HAL) and manage each CS line as a plain GPIO output. This gives you full control over timing and allows driving each device's CS individually.

VERIFY MODE WITH A LOGIC ANALYZER BEFORE WRITING APPLICATION CODE

During peripheral bring-up, always capture at least one complete transaction on a logic analyzer before assuming the configuration is correct. Configure the analyzer to decode SPI with the same CPOL, CPHA, and bit order settings you believe the peripheral uses. If the decoded values match what you sent, the mode is correct. This saves hours of debugging later.

DO NOT DRIVE SCK FASTER THAN THE SLOWEST DEVICE ON A SHARED BUS

If multiple peripherals share a single SPI bus (which is common for cost and pin count reasons), the maximum SCK frequency for the bus is constrained by the slowest device. An SPI EEPROM rated at 5 MHz will fail if the bus also hosts a flash chip you are clocking at 20 MHz. You can change SCK frequency between transactions by reconfiguring the prescaler, but this adds complexity. The simpler rule is: know the slowest device on the bus and configure for that speed.

### Always Check the Bsy Flag in Register-Level Code

When not using HAL or a hardware abstraction layer, always wait for BSY to deassert before pulling CS high after the last byte. The transmit buffer being empty (TXE set) does not mean the last byte has finished shifting -- the shift register may still be clocking out bits. HAL handles this for you, but bare-metal code does not.

### Design for Level Compatibility at the Schematic Stage

Decide early whether your SPI bus operates at 3.3V or 5V. Level shifting adds cost and component count. Where possible, run the entire SPI bus (MCU and all peripherals) at the same voltage. Modern STM32 series are 3.3V devices; connecting a 5V-only peripheral requires a unidirectional or bidirectional level shifter on MOSI, MISO, SCK, and CS.

### Add Decoupling on Every Spi Peripheral

High-speed SPI transactions cause short, sharp current spikes in peripheral supply pins. Place a 100 nF ceramic capacitor as close as possible to every VCC pin of every SPI peripheral. For high-speed flash or display drivers, also add a 10 uF bulk capacitor nearby. This is basic practice but frequently omitted on prototype boards, leading to noise-induced data corruption at higher clock rates.

### Document the Spi Transaction Format for Every Peripheral

Write a concise comment or table in your driver code showing the exact byte sequence for each command: CS low, byte 0 (command), byte 1 (address MSB), etc. This is the equivalent of a protocol document at the driver level and prevents future engineers (including yourself six months later) from having to re-read the peripheral datasheet to understand the driver.

## Expert Notes

THE DUMMY BYTE PROBLEM BITES EVERYONE AT LEAST ONCE

SPI is full duplex. You cannot receive without sending. When you issue a read command to an SPI device, you must clock out dummy bytes to generate the SCK cycles that bring in the real data. Every byte you "receive" during the command phase is garbage and must be explicitly discarded. Junior engineers consistently forget this and wonder why their received buffer starts two or three bytes off from the expected data.

THE BSY FLAG IN STM32 CLEARS BEFORE THE LAST BIT IS FULLY SENT

In some STM32 SPI implementations, there is a documented errata and known behavior: the BSY flag can appear to clear before the last serial clock pulse has fully transitioned. This is most relevant when bit-banging delays or when DMA transfer-complete interrupts fire. Always add a small delay or re-read BSY after the DMA TC interrupt fires if you observe the last byte occasionally being truncated.

### Spi Peripheral Reset State After Abort Is Undefined

If a firmware bug causes a transaction to be aborted mid-byte (CS deasserted early, SPI peripheral disabled during transfer), the slave's internal state machine is now in an unknown state. The slave is typically designed to reset on CS going high, but not all peripherals do this cleanly. Some SPI EEPROMs require a full power cycle to recover from a corrupted command sequence. In production firmware, wrap SPI transactions with error handling that can retry with a clean CS cycle, and test recovery behavior explicitly during validation.

### Logic Analyzers Lie About High-Speed Spi

A cheap 24 MHz logic analyzer (the ubiquitous USB LA tools) will misrepresent signals running above 10-12 MHz due to sample rate limitations and input hysteresis. If your SPI peripheral is rated at 20 MHz and you are seeing occasional bit errors that only show up on the logic analyzer trace, the problem may be the measurement tool, not the circuit. For SPI above 10 MHz, use an oscilloscope with at least 3-5x the SPI clock rate in bandwidth to validate signal integrity before trusting the logic analyzer decode.

CS LINE INTEGRITY MATTERS MORE THAN MOST ENGINEERS THINK

A long, unmatched, or poorly terminated CS trace on a PCB will have overshoot and undershoot. If the overshoot on a CS line causes the line to dip below the peripheral's VIL threshold for even a few nanoseconds after deassertion, the peripheral may interpret a spurious CS assertion and misframe subsequent data. This is especially problematic with high-drive GPIO outputs (STM32 GPIO drive strength can be set to very high, which makes ringing worse). Set GPIO output speed to MEDIUM unless you have a specific reason to use HIGH or VERY HIGH.

## Summary

SPI is a synchronous, full-duplex, master-driven serial protocol that exchanges data between shift registers using a shared clock. Its four-wire interface (SCK, MOSI, MISO, CS) is simple in concept but demands precise configuration of clock polarity, clock phase, device selection, and bus management. Every SPI failure traces back to one of a small set of root causes: wrong mode, incorrect CS handling, receive buffer overrun, or marginal timing.

The CPOL and CPHA parameters are the most critical configuration choices. They define which edge samples data and which shifts it. Mode 0 (CPOL=0, CPHA=0) is by far the most common, but you must always verify against the peripheral's timing diagram. Getting the mode wrong produces corrupted data in a pattern that looks plausible -- bytes are received but they are wrong -- which makes it more insidious than a complete communication failure.

Multi-device SPI bus management is a discipline, not an afterthought. CS lines must be initialized high before SPI is enabled. Only one CS must be active at a time. Bus frequency must respect the slowest device. These are not optional guidelines; violating them causes bus contention, corrupted data, or intermittent failures that only appear in production environments or at temperature extremes.

The mental model to retain is this: SPI is two shift registers connected by two wires, clocked in lockstep by the master. On every clock edge, one bit moves from the master to the slave and one bit moves from the slave to the master. CS enables the connection. Everything else -- modes, dummy bytes, FIFO management -- is a consequence of this fundamental mechanism. When in doubt, draw the waveform, count the edges, and verify with a logic analyzer.

## Related Topics

Prerequisites: - Serial Communication Fundamentals (UART, synchronous vs asynchronous, baud rate) - GPIO Fundamentals (push-pull, open-drain, alternate function, GPIO speed settings) - MCU Clock Architecture (APB bus, peripheral clocks, prescalers) - Digital Logic Fundamentals (shift registers, latches, setup and hold time)

Next Topics: - I2C Explained (multi-master addressing, open-drain bus, ACK/NAK, clock stretching) - DMA (Direct Memory Access) (memory-to-peripheral transfer, circular mode, interrupt-driven completion) - SPI with DMA (combining SPI and DMA for high-throughput transfers) - SPI Flash Driver Development (command protocols, page program, sector erase, status polling) - Signal Integrity for Embedded Engineers (trace impedance, termination, ringing, EMC)
