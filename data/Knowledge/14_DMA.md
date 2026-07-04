---
id: dma
tags: ['DMA', 'Transfer', 'Circular Buffer']
---

# DMA: Moving Data Without CPU Intervention

You are building a data acquisition system. Every millisecond, an ADC samples twelve channels at 1 MSPS and your firmware must store each result in a buffer for later processing. You write the obvious loop: poll the ADC data register, copy the value, increment the pointer, repeat. It works on the bench. Then you add the Ethernet driver, the UART logging, and the display refresh, and suddenly your ADC samples start arriving late. You miss conversions. The buffer fills with gaps. The system is not fast enough -- not because the CPU is slow, but because the CPU is doing the wrong work.

This is the problem DMA solves. Direct Memory Access is a hardware mechanism that transfers data between memory and peripherals (or between two memory regions) without any CPU involvement during the transfer itself. The CPU sets up the transfer, the DMA controller executes it autonomously, and the CPU is free to run other code -- or sleep -- while data moves in the background. DMA is not a shortcut or an optimization trick. It is a fundamental architectural feature of virtually every serious embedded MCU on the market, from 8-bit AVRs with basic DMA to ARM Cortex-M7 devices with multi-channel DMA controllers supporting complex linked-list descriptors.

Understanding DMA matters for more than just performance. DMA changes how you think about data flow in a system. Without DMA, data movement is explicit and synchronous: your code touches every byte. With DMA, data can be moving at all times -- ADC filling a buffer, UART emptying another, SPI transferring a display frame -- all simultaneously, all without consuming CPU cycles. This changes firmware architecture in fundamental ways: how you structure buffers, how you synchronize between producers and consumers, how you handle errors.

It also changes what bugs look like. DMA-related bugs can be among the most confusing in embedded firmware because they involve timing, hardware state, cache coherency, and buffer management interacting in subtle ways. A DMA misconfiguration might work perfectly at low sample rates and fail only when the system is under load. Cache incoherency can produce corrupted data that appears intermittently. Circular buffer overruns can corrupt adjacent memory. These bugs are not obvious from code inspection alone.

By the end of this article, you will understand how DMA controllers work internally, the different transfer modes and when to use each, how to configure DMA on real MCUs like the STM32, what can go wrong and why, and how to design firmware that uses DMA correctly and safely.

## The Fundamental Problem

The CPU and peripherals operate at very different speeds and on very different schedules. A UART running at 115200 baud produces one byte roughly every 87 microseconds. An ADC in continuous mode might assert a data-ready signal every 1 microsecond. An I2S audio interface might need a new 16-bit sample every 22 microseconds. If the CPU handles each of these events through interrupt service routines, each ISR has a hard deadline. Miss the deadline and you lose data.

The naive approach is interrupt-driven I/O: each byte transfer triggers an interrupt, the ISR reads or writes one unit of data, and returns. For low-bandwidth peripherals this is acceptable. For high-bandwidth peripherals it breaks down quickly. Consider a 1 MSPS ADC: one million interrupts per second. Each interrupt involves saving context, executing the ISR, and restoring context -- typically 30 to 100 CPU cycles minimum, even on a fast Cortex-M. At 1 MSPS on a 72 MHz CPU, interrupt overhead alone consumes somewhere between 40% and 100% of available cycles. The CPU cannot do anything else. And if any other interrupt fires at the wrong moment, you miss a sample.

Even at moderate rates, interrupt-driven I/O is wasteful. The ISR for "copy one byte from the SPI data register to a buffer" is typically just two or three instructions of real work. The overhead of getting there and back is ten to fifty times larger than the useful work itself. The CPU is spending most of its time context-switching rather than computing. DMA eliminates this overhead entirely by removing the CPU from the data path. Once configured, the DMA controller handles every transfer. The CPU only needs to respond once -- when the entire buffer is full, or when a half-buffer threshold is crossed -- rather than once per byte.

The deeper issue is that CPU intervention does not scale. As systems grow more complex, more peripherals compete for CPU time. Adding a second ADC doubles the interrupt rate. Adding a third sensor adds another stream of interrupts. Eventually the CPU spends all its time servicing interrupts and none computing, processing, or managing the system. DMA solves this at the architecture level: peripherals become autonomous data sources and sinks. The CPU coordinates and processes, not ferries individual bytes.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/dma_arch.svg" alt="DMA Architecture and Transfer Modes" loading="lazy">
</div>

A DMA controller sits on the same bus interconnect as the CPU, SRAM, and peripherals. It has its own bus master capability, meaning it can independently initiate read and write transactions on the system bus without CPU involvement. When configured, it reads data from a source address (a peripheral data register or a memory location) and writes it to a destination address (a memory buffer or another peripheral), decrementing a transfer counter with each transfer until the count reaches zero.

The CPU's role is setup and teardown: configure the source address, destination address, transfer count, data width, and mode; enable the DMA channel; and optionally enable a completion interrupt. After that, the CPU is free. The DMA hardware watches for the peripheral's DMA request signal (a hardware signal asserted when the peripheral is ready to transfer), services it by executing the transfer, and optionally notifies the CPU when the job is done.

On a real MCU like the STM32F4, the DMA controller is a separate peripheral block with multiple streams or channels, each supporting a different set of peripherals via a request multiplexer. The AHB bus matrix allows the DMA and CPU to access memory simultaneously through separate bus ports, so a DMA transfer to SRAM does not necessarily stall the CPU.

Figure 1: DMA controller as an independent bus master alongside the CPU. Peripherals assert DMA request lines; DMA controller services them by reading/writing SRAM directly, bypassing the CPU entirely.

## Key Concepts and Terminology

**Dma Channel / Stream** — The independent transfer path within a DMA controller. Most MCUs have multiple channels (STM32F1: 7 per DMA controller; STM32F4 uses "streams" with a request multiplexer; SAM devices use channels with descriptors). Each channel operates independently and can be configured for a different peripheral or memory region. The terms channel and stream are often used interchangeably across families but have distinct meanings on STM32F4 and later devices.

**Dma Request** — A hardware signal from a peripheral to the DMA controller indicating that the peripheral is ready to send or receive data. For example, when the ADC completes a conversion, it asserts its DMA request line. The DMA controller monitors this signal and initiates a transfer when it is asserted. Without the request signal, the DMA controller would not know when the peripheral is ready, leading to incorrect transfers.

**Transfer Width** — The granularity of each individual transfer: byte (8-bit), half-word (16-bit), or word (32-bit). Source and destination widths can often be configured independently, which is useful when a 32-bit peripheral register feeds a byte buffer or vice versa. Mismatching widths without understanding the packing behavior is a common source of corruption bugs.

**Transfer Count** — The number of individual transfers to perform before the DMA controller signals completion. After each transfer, the counter decrements. When it reaches zero, the DMA controller either stops (normal mode) or reloads the original count and continues (circular mode). The transfer count multiplied by the transfer width gives the total bytes moved.

**Address Increment** — Whether the source and/or destination address increments after each transfer. Peripheral-to-memory transfers typically use fixed source address (peripheral data register does not move) and incrementing destination address (buffer pointer advances). Memory-to-memory copies increment both. Forgetting to enable address increment on the memory side is a classic mistake that writes every byte to the same address.

**Circular Mode** — A DMA operating mode in which the transfer counter automatically reloads when it reaches zero and the DMA starts over from the beginning. This creates a continuously filling ring buffer, ideal for streaming data like ADC sampling or audio I/O. In circular mode, the DMA never stops; the CPU must consume data fast enough to avoid overrun.

**Half-Transfer Interrupt** — An interrupt generated when the DMA transfer counter reaches half of the configured count. Combined with the transfer-complete interrupt, this enables double-buffering: the CPU processes the first half of the buffer while DMA fills the second half, then switches. This is essential for real-time audio, continuous ADC sampling, and other streaming applications.

**Dma Burst** — On advanced DMA controllers (STM32F4 BDMA, MDMA), the ability to transfer multiple beats per arbitration cycle using the AHB INCR burst protocol. Bursting improves bus efficiency for memory-to-memory transfers but requires careful alignment and is irrelevant for slow peripheral-to-memory transfers that are paced by the peripheral request signal.

**Fifo (dma Side)** — Some DMA controllers (STM32F4 streams) include a small FIFO between the bus interfaces to decouple the source and destination bus transactions and enable bursting. The FIFO can also do width conversion. Direct mode bypasses the FIFO. Using the FIFO incorrectly (for example, enabling FIFO with a burst size that does not divide evenly into the transfer count) can cause the DMA to silently under-transfer.

**Cache Coherency** — On Cortex-M7 devices with data cache (D-Cache), DMA writes to SRAM may not be visible to the CPU if the corresponding cache lines have not been invalidated, and DMA reads may see stale data if cache lines have not been cleaned (flushed). This is invisible on Cortex-M0/M3/M4 (no cache) but causes hard-to-reproduce data corruption on M7 and Cortex-A devices. Managing cache coherency is one of the most important -- and most often missed -- aspects of DMA on modern MCUs.

## How It Works

STEP 1: PERIPHERAL CONFIGURATION The peripheral must be configured to issue DMA requests. On the STM32, this means setting the DMA enable bit in the peripheral's control register (for example, ADC_CR2_DMA for the ADC, USART_CR3_DMAEN for USART). Until this bit is set, the peripheral does not assert its DMA request line and the DMA controller receives no trigger, regardless of how the DMA channel is configured. The peripheral also needs to be configured for the correct mode: for example, the ADC must be set to continuous conversion mode if you want the DMA to fill a buffer without CPU intervention.

STEP 2: DMA CHANNEL CONFIGURATION The firmware configures the DMA channel registers: source address, destination address, transfer count, transfer width, direction (peripheral-to-memory, memory-to-peripheral, or memory-to-memory), address increment settings, and operating mode (normal or circular). On the STM32F4, you also select the request channel number (which peripheral is connected to this stream) via the channel selection bits. At this point, the DMA is configured but not yet active.

STEP 3: INTERRUPT CONFIGURATION (OPTIONAL) If the firmware needs notification when the transfer is complete (or half-complete), the corresponding interrupt enable bits are set in the DMA channel's configuration register, and the DMA interrupt is enabled in the NVIC. The interrupt handler is written to respond to transfer-complete or half-transfer events, typically by flagging a buffer as ready for processing.

STEP 4: DMA ENABLE Setting the enable bit in the DMA channel's configuration register activates the channel. From this point forward, the DMA controller monitors the peripheral's request line. On M-to-M transfers with no peripheral request, the DMA starts immediately. For peripheral-to-memory transfers, the DMA waits for the first request from the peripheral.

STEP 5: HARDWARE TAKES OVER The peripheral asserts its DMA request line (for example, when an ADC conversion completes). The DMA controller, acting as a bus master, initiates a read from the peripheral data register and a write to the current destination address in SRAM. It decrements the transfer counter and advances the destination pointer (if increment is enabled). The CPU is uninvolved -- it may be executing application code, running a different ISR, or sleeping in a WFI instruction.

STEP 6: HALF-TRANSFER AND COMPLETE EVENTS When the transfer counter reaches half the original count, the DMA asserts the half-transfer flag. When the counter reaches zero, it asserts the transfer-complete flag. If the corresponding interrupts are enabled, the NVIC pends the DMA interrupt. In normal mode, the DMA channel disables itself. In circular mode, the counter reloads and the DMA continues immediately without any CPU action.

STEP 7: CPU RESPONSE (ISR OR POLLING) The DMA ISR executes. In a double-buffer arrangement, the ISR on half-transfer processes the first half while DMA fills the second half. On transfer-complete, the ISR processes the second half while DMA circles back to the first. This ping-pong arrangement allows continuous, zero-gap streaming with no samples lost, as long as the CPU can process each half-buffer before DMA overwrites it.

## Under the Hood

The DMA controller is a hardware state machine that arbitrates bus access independently of the CPU. On Cortex-M devices, the CPU and DMA controller share the AHB bus through a matrix or crossbar switch. When both the CPU and DMA attempt to access the same memory bank simultaneously, the bus arbiter grants access to one and stalls the other. This stalling is called DMA latency from the CPU's perspective (the CPU stalls waiting for the bus) or CPU latency from the DMA's perspective. Understanding this arbitration is important for real-time systems: a DMA-intensive workload can increase CPU memory access latency.

On the STM32F4, the DMA controller has two AHB master ports: one for memory accesses and one for peripheral accesses. These can operate simultaneously when accessing different memory regions, giving full duplex bandwidth. The FIFO on each stream allows the DMA to accumulate transfers before committing a burst to memory, improving bus efficiency. The priority level of each stream (low, medium, high, very high) determines arbitration order when multiple streams compete for the same bus port -- a critical configuration when mixing high-rate audio DMA with lower-priority flash reads.

The DMA request signal is a physical pin or internal wire from the peripheral to the DMA controller. It is level-sensitive in some implementations and pulse-sensitive in others. The peripheral typically de-asserts the request after the DMA controller has read or written the data register, which clears the condition that triggered the request (for example, the ADC data register is read, clearing the end-of-conversion flag). If the DMA does not service the request fast enough -- for example, because a higher-priority stream is holding the bus -- the peripheral may generate another conversion before the previous one is transferred, causing an overrun condition that the peripheral flags with an error bit.

On Cortex-M7 MCUs (STM32H7, STM32F7), the 32-KiB data cache is between the Cortex-M7 core and the AHB bus. DMA transfers bypass the cache entirely -- they go directly to SRAM through the bus. This means that when the DMA writes a buffer in SRAM, the CPU may read stale data from its cache rather than the new values. The firmware must explicitly invalidate the affected cache lines (SCB_InvalidateDCache_by_Addr) before reading DMA destination buffers. Conversely, when the CPU writes a buffer that DMA will read, the firmware must clean (flush) the cache lines (SCB_CleanDCache_by_Addr) before starting the DMA. Failing to do this on the H7 is one of the most common sources of "works on M4, breaks on H7" bugs.

Double-buffering with DMA has precise timing requirements. In circular mode with half-transfer interrupts, the CPU has exactly one half-buffer period to process the data before DMA overwrites it. If the half-buffer period is 1 millisecond (for example, 1000 ADC samples at 1 MSPS, half-buffer at 500 samples) and the processing ISR takes 1.2 milliseconds, the DMA overwrites the beginning of the buffer before the CPU is done reading it. The result is corrupted data that appears only under load -- a classic embedded timing bug that does not reproduce on the bench with lighter workloads.

## Real-World Applications

AUTOMOTIVE In automotive body control modules and ADAS sensors, DMA transfers are used to collect ADC readings from multiple voltage, temperature, and current sensors continuously in the background. CAN and LIN communication peripherals use DMA for high-throughput message buffering. In a radar front-end processor (for example, Texas Instruments AWR devices based on Cortex-R4), DMA transfers move IF samples from the ADC to DSP memory continuously at rates of hundreds of megabytes per second. The CPU manages radar processing algorithms while DMA handles all data movement, a strict architectural separation.

CONSUMER ELECTRONICS AND AUDIO Audio codecs connected via I2S or SAI (Serial Audio Interface) are almost universally DMA-driven. The I2S peripheral generates a DMA request for each stereo sample pair. DMA in circular mode with double-buffering fills audio output buffers continuously. The CPU processes one buffer (applies equalization, mixing, or effects) while DMA reads the other buffer and sends it to the codec. The same pattern applies to microphone arrays: DMA collects PDM or I2S data from multiple microphones simultaneously into separate buffers.

INDUSTRIAL AND INSTRUMENTATION High-speed data loggers sample multiple ADC channels simultaneously using DMA in scan mode. For example, on the STM32, the ADC can scan through a sequence of channels automatically, and each result is transferred by DMA to a contiguous buffer in memory -- twelve channels at 100 ksps produces 1.2 million 16-bit values per second, easily handled by DMA but impossible with interrupt-driven I/O. UART-based Modbus or RS-485 communications use DMA to send and receive complete frames without ISR overhead.

MEDICAL DEVICES Pulse oximeters and ECG front-ends use DMA to stream ADC data from analog front-end chips connected via SPI or I2C. The firmware must guarantee no samples are missed to meet regulatory requirements for data integrity. DMA circular mode with half-transfer interrupts provides the deterministic no-gap sampling that these applications require. Infusion pumps use DMA for motor controller SPI communication, sending continuous position and velocity updates to motor driver ICs at precise intervals.

AEROSPACE AND DEFENSE IMU data acquisition systems (gyroscopes, accelerometers sampled via SPI at 8 kHz or higher) use DMA for all SPI transfers. The determinism of DMA is critical: the sample must arrive in the buffer within a fixed window after the SPI transfer completes or the inertial navigation solution diverges. Memory-to-memory DMA is used to move large blocks of telemetry data between SRAM regions efficiently before transmission.

IOT AND WIRELESS BLE and Zigbee SoCs (nRF52 series, EFR32) use DMA (called EasyDMA on nRF52) for UART, SPI, and I2C transfers. Low-power IoT devices use DMA particularly because it enables the CPU to remain in a low-power sleep state (WFI) while data transfers proceed. The CPU wakes only on DMA completion, minimizing active time and extending battery life. This sleep-during-DMA pattern can reduce active current consumption by 50% or more compared to polling.

## Common Mistakes

FORGETTING TO ENABLE THE PERIPHERAL'S DMA REQUEST - The DMA channel is configured correctly but nothing happens. The peripheral has a separate DMA enable bit (for example, USART_CR3_DMAEN) that must be set. The DMA controller waits forever for a request that never comes. Check the peripheral control register, not just the DMA configuration.

**Wrong Address Increment Settings** — Setting the source or destination increment incorrectly. The most common case: configuring memory-to-memory DMA but forgetting to increment both source and destination addresses, so the transfer reads one location correctly but writes to the same destination address N times. Also occurs when doing peripheral-to-memory DMA but accidentally incrementing the peripheral address, which reads successive register addresses instead of the same data register.

**Ignoring Cache Coherency on Cortex-M7** — Firmware developed on an STM32F4 is ported to an STM32H7. The code compiles and runs but data corruption appears intermittently. The D-Cache on the M7 is not being managed around DMA operations. Add SCB_InvalidateDCache_by_Addr before reading DMA destination buffers and SCB_CleanDCache_by_Addr before starting a DMA read from CPU-written memory. Buffer alignment to 32-byte cache line boundaries is also required.

**Overrunning a Circular Buffer** — Using DMA circular mode but not processing data fast enough. The DMA wraps around and starts overwriting the data the CPU has not yet processed. There is no hardware protection against this -- the DMA does not know the CPU is still reading the buffer. Use half-transfer interrupts and measure worst-case processing time to prove there is sufficient margin. Add an overrun detection flag in the ISR: if the half-transfer interrupt fires before the previous half is consumed, an overrun has occurred.

**Incorrect Transfer Count After Re-Enabling Dma** — In normal (non-circular) mode, the DMA disables itself after completing. To restart, you must reconfigure the transfer count register before re-enabling -- the hardware does not reload it automatically. Forgetting to reset the count results in a transfer of zero bytes on the second run. Always reload the NDTR (number of data to transfer) register before re-enabling a normal-mode DMA channel.

**Not Clearing Dma Flags Before Re-Enabling** — The DMA status flags (transfer complete, half-transfer, error) from the previous transfer must be cleared before re-enabling the channel. If not cleared, the interrupt fires immediately upon re-enable with a stale flag, causing the ISR to process non-existent data. Clear all relevant flags in the DMA interrupt status clear register before reconfiguring.

**Using Dma for Transfers Too Small to Benefit** — Configuring DMA for transfers of 4 or fewer bytes. The setup overhead (configuring registers, enabling the channel, handling the completion interrupt) exceeds the cost of a simple direct register write. DMA pays off when transferring at least 8-16 bytes, ideally much more. For small, infrequent transfers, direct register access or simple ISR-driven I/O is simpler and faster.

## Debugging and Troubleshooting

**Symptom:** DMA transfer never starts; no data in destination buffer.

**Possible Cause:** Peripheral DMA request enable bit not set, or incorrect DMA channel/stream/request selection.

**Investigation Method:** Use a debugger to read back the DMA channel configuration registers after setup. Verify the EN bit is set, the source and destination addresses are correct, and the NDTR (transfer count) is non-zero. Check the peripheral's control register for its DMA enable bit. On STM32F4, verify the channel selection bits in DMA_SxCR match the expected request source.

**Resolution:** Enable the peripheral DMA request output. Verify stream-to-request mapping against the MCU datasheet DMA request table (not the reference manual alone -- they sometimes disagree). Use ST's STM32CubeMX DMA configuration as a reference for correct request channel numbers.

**Symptom:** First DMA transfer works correctly; subsequent transfers produce garbage.

**Possible Cause:** DMA transfer count not reloaded before re-enabling in normal mode, or DMA status flags not cleared before restart.

**Investigation Method:** In the debugger, break immediately after the DMA completion ISR and inspect the DMA channel's NDTR register. If it reads zero and you have not reloaded it, the next enable will transfer zero bytes. Check whether the interrupt flag clear register is being written in the ISR.

**Resolution:** In the ISR or in the re-enable sequence, write the original transfer count to NDTR before setting the EN bit. Clear transfer-complete and any error flags in the interrupt flag clear register (IFCR on STM32).

**Symptom:** Intermittent data corruption on STM32H7 that does not reproduce on STM32F4.

**Possible Cause:** D-Cache coherency. DMA writes are visible at the SRAM level but the CPU is reading from a stale cache line.

**Investigation Method:** Temporarily disable the D-Cache (SCB_DisableDCache) and check whether the corruption disappears. If it does, cache coherency is the problem. Use a logic analyzer or ITM trace to confirm DMA completion occurs before the CPU reads the buffer.

**Resolution:** Place DMA buffers in non-cacheable SRAM (MPU region with TEX=0, C=0, B=0), or explicitly call SCB_InvalidateDCache_by_Addr(buffer, length) after DMA completion and before CPU access. Ensure buffers are aligned to 32-byte cache line boundaries (use **attribute**((aligned(32)))).

**Symptom:** Audio output has periodic clicks or dropouts at irregular intervals.

**Possible Cause:** DMA circular mode is running correctly but the CPU is occasionally not processing a half-buffer before DMA overwrites it (overrun). The click corresponds to stale or partially-written data being sent to the codec.

**Investigation Method:** Add a counter in the half-transfer and transfer-complete ISRs that increments whenever the ISR fires before the previous handler has signaled completion. Log the worst-case processing time using the DWT cycle counter. Check whether any higher-priority interrupt (Ethernet, USB) is preempting the DMA ISR for significant durations.

**Resolution:** Increase the buffer size (longer half-buffer period gives more processing margin). Reduce processing complexity per interrupt. Raise the DMA ISR priority. Profile the worst-case ISR latency under all interrupt load conditions, not just average case.

## Design Considerations and Best Practices

**Align Dma Buffers to Their Natural Width** — A buffer used for 32-bit DMA transfers should be 32-bit aligned. Unaligned DMA can cause bus faults on some MCUs or silently use more bus cycles. On Cortex-M7, align to 32 bytes (cache line size) to ensure cache operations work correctly on whole cache lines. Use **attribute**((aligned(32))) or place buffers in a linker-defined section.

USE STATIC OR GLOBAL BUFFERS, NOT STACK BUFFERS - DMA operates on physical memory addresses. A buffer on the stack is valid only while the function is executing. If the function returns before the DMA transfer completes, the stack frame is reused and the DMA writes into other data. ALWAYS make DMA buffers static, global, or heap-allocated with a lifetime that exceeds the DMA transfer. This is one of the most common causes of stack corruption bugs involving DMA.

**Define a Clear Ownership Model for Each Buffer** — At any point in time, either the DMA owns a buffer (and the CPU must not write to it) or the CPU owns it (and DMA must not be active on it). Double-buffering formalizes this by giving the CPU half of the buffer while DMA uses the other half. Document which half is CPU-owned at each point in execution. Violating ownership causes data corruption that is extremely hard to reproduce.

**Configure and Check Error Interrupt Flags** — Every DMA controller has error status bits: transfer error (bus fault during DMA), FIFO error, direct mode error (STM32F4). Enable the DMA error interrupt in production firmware. An undetected DMA error silently halts transfers with no indication -- the system appears to run but data stops moving. Log or assert on DMA error flags.

**Always Verify Register Readback After Configuration** — After configuring DMA registers, read them back and verify the values. On some STM32 devices, attempting to write DMA stream registers while the stream is enabled is silently ignored. Always disable the stream, wait for the EN bit to clear (the hardware clears it only after the current transfer completes), then configure, then re-enable.

**Measure Actual Bus Utilization Under Full Load** — DMA sharing the bus with the CPU can degrade real-time response. On a Cortex-M4 without a cache, every DMA bus cycle can potentially stall a CPU fetch or data access. Measure worst-case ISR latency with all DMA active using the DWT cycle counter. If critical ISRs have unacceptable latency, move DMA buffers to a different SRAM bank (TCM on STM32H7) that the CPU can access without contention.

**Use Peripheral-Specific Dma Where Available** — Some peripherals have dedicated local DMA or FIFO (UART TX/RX FIFO on TI MSP432, SPI FIFO on NXP LPC). Using the built-in FIFO as an intermediate stage reduces DMA request frequency, improving bus efficiency. Read the peripheral chapter of your reference manual, not just the DMA chapter.

**Account for Dma Tail in Normal Mode** — In normal (non-circular) mode, after the transfer count reaches zero, there may be one transfer in progress at the hardware level that has not yet completed. Do not immediately read the destination buffer after setting up the next DMA transaction or after the transfer-complete flag appears. In practice, the transfer-complete interrupt fires AFTER the final bus transaction commits, so data is valid in the ISR -- but verify this in your specific MCU's errata.

## Expert Notes

**The Transfer-Complete Interrupt Latency Is Not Zero** — The DMA asserts the transfer-complete flag at the exact moment the last transfer completes. But the NVIC pends the interrupt, the CPU finishes its current instruction, and the ISR starts -- potentially many cycles later. Meanwhile, in circular mode, the DMA has already started the next round of transfers. This is fine in circular mode (the ISR processes data that is no longer being written). In normal mode, the DMA has stopped. The important point: the ISR does not fire instantaneously. Do not architect a system that requires zero-latency response to DMA completion.

**Mcu Errata Can Invalidate What the Manual Says** — Every STM32 device has an errata document separate from the reference manual. DMA errata are common. Known issues include: certain FIFO configurations causing under-transfer, DMA stream enable requiring a drain period before reconfiguration, and channel priority conflicts under specific burst configurations. Always cross-reference the errata before shipping. Engineers who skip the errata sheet are the ones who debug production failures at 2 AM.

**Dma and Sleep Modes Interact** — On STM32, some DMA controllers (DMA1, DMA2) cannot operate in Stop mode because the peripheral clocks are gated. Only the BDMA (Basic DMA) on STM32H7 or DMA driven by wake-up sources can work in low-power modes. If you rely on DMA for data collection while the MCU sleeps, verify which DMA controller is connected to your peripheral and which sleep mode is compatible. Using the wrong combination silently drops all data while the CPU sleeps and everything looks fine when the CPU is awake.

**The Dma Request Signal Is Not a Queue** — When a peripheral asserts its DMA request, the DMA controller will service it -- but if the DMA is busy (bus contention, higher-priority stream) and the peripheral asserts another request before the first is serviced, many peripherals will set an overrun flag rather than queue the second request. The DMA request line is not a FIFO. At high peripheral rates with multiple competing DMA streams, this is a real failure mode. Check the peripheral's overrun flag register in your diagnostics.

**Memory-to-Memory Dma Has No Pacing** — Peripheral-to-memory DMA is inherently paced by the peripheral request rate. Memory-to-memory DMA has no external pace: the DMA runs as fast as the bus allows, competing aggressively with the CPU. A large M-to-M DMA transfer can cause significant CPU stalls. For bulk memory operations, consider breaking the transfer into smaller chunks or using memcpy (which the compiler may optimize to LDMIA/STMIA) for small blocks where DMA overhead exceeds the benefit.

## Summary

DMA is a hardware mechanism that transfers data between memory and peripherals (or between memory regions) without CPU intervention during the transfer. It solves the fundamental scaling problem of interrupt-driven I/O: as peripheral rates increase or the number of peripherals grows, ISR-based data movement eventually consumes all available CPU cycles. DMA offloads that data movement to dedicated hardware, freeing the CPU for computation, control, and communication.

The key operating modes -- normal, circular, and memory-to-memory -- cover the vast majority of real use cases. Circular mode with half-transfer interrupts is the backbone of real-time streaming applications: audio, ADC sampling, communication protocol framing. Memory-to-memory mode enables efficient bulk data movement for protocol processing and buffer management. In every case, the CPU's role is reduced to setup, exception handling, and data processing -- never individual byte transfers.

Safe DMA usage requires discipline around buffer ownership (who is currently writing a buffer and who is reading it), cache coherency on devices with D-Cache, register configuration sequencing, and error handling. The bugs introduced by DMA misuse are among the most subtle in embedded development because they involve timing, hardware state, and memory behavior interacting in ways that do not appear in code review alone.

The mental model to retain: DMA turns peripherals into autonomous data producers and consumers. Buffers are the hand-off points between the DMA hardware world and the CPU software world. Your job as the firmware engineer is to manage those hand-off points correctly: ensure buffers are valid, owned, coherent, and processed in time. Everything else -- the actual data movement -- the hardware handles.

## Related Topics

Prerequisites: - Memory Architecture (address spaces, SRAM regions, bus matrix, AHB/APB) - Interrupts (NVIC, ISR priority, context save/restore, interrupt latency) - Timers and Counters (periodic triggers, ADC trigger sources, PWM generation)

Next Topics: - Firmware Architecture Patterns (layered drivers, event-driven design, buffer management) - RTOS Fundamentals (task synchronization with DMA, semaphores from ISR, zero-copy IPC)
