---
title: "DMA: Moving Data Without Using the CPU"
brief: "Letting the DMA controller move data between peripherals and memory: circular buffers, cache coherency and completion handling."
order: 14
phase: 3
tags: ["DMA", "Transfer", "Circular Buffer"]
---

You are building a data acquisition system. Every millisecond, an ADC samples twelve channels at 1 MSPS and your firmware must store each result in a buffer for later processing.

This is the problem DMA solves. Direct Memory Access is a hardware mechanism that transfers data between memory and peripherals (or between two memory regions) without any CPU involvement during the transfer itself.

## The Fundamental Problem

The CPU and peripherals operate at very different speeds and on very different schedules. A UART running at 115200 baud produces one byte roughly every 87 microseconds.

The naive approach is interrupt-driven I/O: each byte transfer triggers an interrupt, the ISR reads or writes one unit of data, and returns. For low-bandwidth peripherals this is acceptable.

## The Big Picture

![DMA Architecture and Transfer Modes](/diagrams/dma_arch.svg)

A DMA controller sits on the same bus interconnect as the CPU, SRAM, and peripherals. It has its own bus master capability, meaning it can independently initiate read and write transactions on the system bus without CPU involvement.

The CPU's role is setup and teardown: configure the source address, destination address, transfer count, data width, and mode; enable the DMA channel; and optionally enable a completion interrupt. After that, the CPU is free.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **DMA Channel / Stream** | The independent transfer path within a DMA controller. |
| **DMA Request** | A hardware signal from a peripheral to the DMA controller indicating that the peripheral is ready to send or receive data. |
| **Transfer Width** | The granularity of each individual transfer: byte (8-bit), half-word (16-bit), or word (32-bit). |
| **Transfer Count** | The number of individual transfers to perform before the DMA controller signals completion. |
| **Address Increment** | Whether the source and/or destination address increments after each transfer. |
| **Circular Mode** | A DMA operating mode in which the transfer counter automatically reloads when it reaches zero and the DMA starts over from the beginning. |

## How It Works

### Step 1: Peripheral configuration

The peripheral must be configured to issue DMA requests. On the STM32, this means setting the DMA enable bit in the peripheral's control register (for example, ADC_CR2_DMA for the ADC, USART_CR3_DMAEN for USART).

### Step 2: DMA channel configuration

The firmware configures the DMA channel registers: source address, destination address, transfer count, transfer width, direction (peripheral-to-memory, memory-to-peripheral, or memory-to-memory), address increment settings, and operating mode (normal or circular). On the STM32F4, you also select the request channel number (which peripheral is connected to this stream) via the channel selection bits.

### Step 3: Interrupt configuration (optional)

If the firmware needs notification when the transfer is complete (or half-complete), the corresponding interrupt enable bits are set in the DMA channel's configuration register, and the DMA interrupt is enabled in the NVIC. The interrupt handler is written to respond to transfer-complete or half-transfer events, typically by flagging a buffer as ready for processing.

### Step 4: DMA enable

Setting the enable bit in the DMA channel's configuration register activates the channel. From this point forward, the DMA controller monitors the peripheral's request line.

### Step 5: Hardware takes over

The peripheral asserts its DMA request line (for example, when an ADC conversion completes). The DMA controller, acting as a bus master, initiates a read from the peripheral data register and a write to the current destination address in SRAM.

### Step 6: Half-transfer and complete events

When the transfer counter reaches half the original count, the DMA asserts the half-transfer flag. When the counter reaches zero, it asserts the transfer-complete flag.

### Step 7: CPU response (ISR or polling)

The DMA ISR executes. In a double-buffer arrangement, the ISR on half-transfer processes the first half while DMA fills the second half.

## Under the Hood

The DMA controller is a hardware state machine that arbitrates bus access independently of the CPU. On Cortex-M devices, the CPU and DMA controller share the AHB bus through a matrix or crossbar switch.

On the STM32F4, the DMA controller has two AHB master ports: one for memory accesses and one for peripheral accesses. These can operate simultaneously when accessing different memory regions, giving full duplex bandwidth.

## Real-World Applications

**Automotive.** In automotive body control modules and ADAS sensors, DMA transfers are used to collect ADC readings from multiple voltage, temperature, and current sensors continuously in the background. CAN and LIN communication peripherals use DMA for high-throughput message buffering.

**Consumer electronics and audio.** Audio codecs connected via I2S or SAI (Serial Audio Interface) are almost universally DMA-driven. The I2S peripheral generates a DMA request for each stereo sample pair.

## Common Mistakes

**Forgetting to enable the peripheral's DMA request.** The DMA channel is configured correctly but nothing happens. The peripheral has a separate DMA enable bit (for example, USART_CR3_DMAEN) that must be set. The DMA controller waits forever for a request that never comes.

**Wrong Address Increment Settings** — Setting the source or destination increment incorrectly. The most common case: configuring memory-to-memory DMA but forgetting to increment both source and destination addresses, so the transfer reads one location correctly but writes to the same destination address N times. Also occurs when doing peripheral-to-memory DMA but accidentally incrementing the peripheral address, which reads successive register addresses instead of the same data register.

**Ignoring Cache Coherency on Cortex-M7** — Firmware developed on an STM32F4 is ported to an STM32H7. The code compiles and runs but data corruption appears intermittently. The D-Cache on the M7 is not being managed around DMA operations.

## Debugging and Troubleshooting

**Symptom:** DMA transfer never starts; no data in destination buffer.

**Possible Cause:** Peripheral DMA request enable bit not set, or incorrect DMA channel/stream/request selection.

**Investigation Method:** Use a debugger to read back the DMA channel configuration registers after setup.

**Resolution:** Enable the peripheral DMA request output.

**Symptom:** First DMA transfer works correctly; subsequent transfers produce garbage.

**Possible Cause:** DMA transfer count not reloaded before re-enabling in normal mode, or DMA status flags not cleared before restart.

**Investigation Method:** In the debugger, break immediately after the DMA completion ISR and inspect the DMA channel's NDTR register.

**Resolution:** In the ISR or in the re-enable sequence, write the original transfer count to NDTR before setting the EN bit.

## Design Considerations and Best Practices

**Align Dma Buffers to Their Natural Width** — A buffer used for 32-bit DMA transfers should be 32-bit aligned. Unaligned DMA can cause bus faults on some MCUs or silently use more bus cycles.

**Use static or global buffers, not stack buffers.** DMA operates on physical memory addresses. A buffer on the stack is valid only while the function is executing.

## Expert Notes

**The Transfer-Complete Interrupt Latency Is Not Zero** — The DMA asserts the transfer-complete flag at the exact moment the last transfer completes. But the NVIC pends the interrupt, the CPU finishes its current instruction, and the ISR starts — potentially many cycles later.

**Mcu Errata Can Invalidate What the Manual Says** — Every STM32 device has an errata document separate from the reference manual. DMA errata are common.

## Summary

DMA is a hardware mechanism that transfers data between memory and peripherals (or between memory regions) without CPU intervention during the transfer. It solves the fundamental scaling problem of interrupt-driven I/O: as peripheral rates increase or the number of peripherals grows, ISR-based data movement eventually consumes all available CPU cycles. DMA offloads that data movement to dedicated hardware, freeing the CPU for computation, control, and communication.

The key operating modes — normal, circular, and memory-to-memory — cover the vast majority of real use cases. Circular mode with half-transfer interrupts is the backbone of real-time streaming applications: audio, ADC sampling, communication protocol framing. Memory-to-memory mode enables efficient bulk data movement for protocol processing and buffer management.

## Related Topics

**Prerequisites**

- Memory Architecture (address spaces, SRAM regions, bus matrix, AHB/APB)
- Interrupts (NVIC, ISR priority, context save/restore, interrupt latency)
- Timers and Counters (periodic triggers, ADC trigger sources, PWM generation)

**Next Topics**

- Firmware Architecture Patterns (layered drivers, event-driven design, buffer management)
- RTOS Fundamentals (task synchronization with DMA, semaphores from ISR, zero-copy IPC)
