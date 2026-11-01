---
title: "CPU Execution Model: How a Processor Runs Your Code"
brief: "How a Cortex-M fetches, decodes and executes instructions: pipeline, registers, the stack frame, privilege modes and wait states."
order: 3
phase: 1
tags: ["Pipeline", "Cortex-M", "Registers", "ABI"]
---

A firmware engineer is chasing a hard fault that appears only at 168 MHz and vanishes when the debugger is attached. The stack frame looks corrupted, the LR value points nowhere meaningful, and the fault address is inside what should be a safe read.

The ARM Cortex-M family (M0, M0+, M3, M4, M23, M33, M55) all share the same fundamental programmer model even though they differ in pipeline depth, DSP capability, and security extensions. Everything in this article applies to the M3 and M4 unless a specific difference is called out.

## The Fetch-Decode-Execute Pipeline

The Cortex-M3 and M4 implement a three-stage in-order pipeline: fetch, decode, and execute. In the fetch stage the processor reads one or more 16-bit halfwords from instruction memory at the address held in the Program Counter (PC, also called r15).

A branch instruction breaks pipeline continuity because the processor has already fetched and begun decoding the two instructions after the branch before it knows whether the branch is taken. On the Cortex-M3 and M4 a taken branch incurs a three-cycle penalty while the pipeline refills from the branch target address.

## Registers and the Programmer Model

The Cortex-M programmer model exposes 16 registers in the integer register bank, all 32 bits wide. Registers r0 through r12 are general-purpose registers available for integer arithmetic, addresses, and temporary storage.

Register r12 (also named IP, the intra-procedure-call scratch register) is technically caller-saved and is sometimes used by linker veneers for long-range branches; firmware code can use it freely as a scratch register with the same caveats as r0-r3. Register r13 is the Stack Pointer (SP).

## The Program Status Register

The xPSR (combined Program Status Register) is a 32-bit register that the processor updates automatically on every instruction. It is not directly addressable as a single register; instead it is composed of three overlapping views: the Application Program Status Register (APSR), the Execution Program Status Register (EPSR), and the Interrupt Program Status Register (IPSR).

The APSR holds the condition flags in its upper bits: N (bit 31, set when the result of an arithmetic or logical operation is negative), Z (bit 30, set when the result is zero), C (bit 29, set when an unsigned arithmetic operation produces a carry or a shift operation produces a carry-out), and V (bit 28, set when a signed arithmetic operation overflows). On the Cortex-M4 the APSR also holds Q (bit 27, the saturation flag for DSP-style saturating arithmetic) and the GE bits (bits 19:16, used by parallel add/subtract SIMD instructions).

## Instruction Set Overview

Cortex-M processors execute the Thumb-2 instruction set, a superset of the original 16-bit Thumb instruction set introduced with ARM7TDMI. Thumb-2 is a mixed-width encoding: most common operations (arithmetic on low registers r0-r7, short branches, load/store with small offsets) are encoded in 16 bits, while operations requiring full register access, wide immediate values, or complex addressing modes use 32-bit encodings.

The original ARM architecture used a fixed 32-bit instruction encoding with a 4-bit condition code field on every instruction, allowing any instruction to be conditionally executed. Thumb-2 replaces most per-instruction conditioning with the IT (If-Then) block, a 16-bit instruction that conditions the next one to four instructions based on a flag test.

## Memory-Mapped Architecture

The Cortex-M memory map is flat and unified: every peripheral register, every SRAM bank, every flash sector, every debug register, and every core peripheral (NVIC, SysTick, SCB, FPU control) lives at a specific 32-bit address, and the same load/store instructions that read a variable from RAM are used to read a peripheral status register. There is no separate I/O address space, no IN/OUT instructions, and no distinction between "memory" and "device" at the instruction level — the distinction is made by the Memory Protection Unit (MPU) attribute tables and by the bus fabric routing that connects an address range to a particular slave interface.

The ARMv7-M memory map divides the 4 GB address space into fixed regions with default memory attributes. Addresses 0x00000000-0x1FFFFFFF are Code (typically flash, with instruction and data caching allowed).

## The Stack and Function Calls

The Cortex-M uses a full descending stack model: the stack grows from high addresses toward low addresses, and the stack pointer always points to the last occupied slot (the "full" convention, as opposed to an empty convention where SP points to the next free slot). A PUSH {r4, lr} instruction decrements SP by 8 (4 bytes per register), then writes r4 to SP+4 and LR to SP, in that order.

The function prologue and epilogue generated by a C compiler for an AAPCS-compliant function are predictable: the prologue PUSHes any callee-saved registers the function uses, and the epilogue POPs them back. The frame pointer (r7 on Thumb, r11 on ARM32) is optional; GCC omits it by default for Thumb-2 targets when compiled with optimization, using SP-relative addressing for local variables instead.

## Operating Modes and Privilege

The Cortex-M processor operates in one of two modes and one of two privilege levels at any given time. Thread mode is the normal execution context; code runs in Thread mode when not handling an exception.

Privileged code can read and write all processor registers and access the full memory map. Unprivileged code is subject to MPU restrictions and cannot access certain system registers (CONTROL, PRIMASK, BASEPRI, FAULTMASK, MSP, PSP, and the core peripheral registers).

## Processor Exceptions and the NVIC

The Cortex-M exception model unifies interrupts, faults, and system events into a single numbered exception space. Exception numbers 1 through 15 are fixed system exceptions: 1 (Reset), 2 (NMI), 3 (HardFault), 4 (MemManage), 5 (BusFault), 6 (UsageFault), 7-10 (reserved), 11 (SVCall), 12 (DebugMonitor), 13 (reserved), 14 (PendSV), 15 (SysTick).

The Nested Vectored Interrupt Controller (NVIC) manages priority, pending, and active state for all external interrupts. Priority is configured per-interrupt with 3 to 8 bits of priority field depending on the part (STM32 uses 4 bits, giving 16 software-configurable priority levels).

## Wait States and Execution Timing

Flash memory on STM32 and similar microcontrollers cannot sustain the read rate demanded by a processor running at maximum clock frequency. On the STM32F4 running at 168 MHz with 3.3 V supply, the ART Accelerator (Adaptive Real-Time cache) is required to deliver zero-wait-state performance from flash; without it the processor would incur 5 wait states per instruction fetch, reducing effective throughput to roughly 168/6 = 28 MIPS.

Certain STM32 variants provide a Core Coupled Memory (CCM) region, a block of SRAM connected directly to the D-bus of the processor with zero wait states and no bus contention with DMA or peripheral accesses. On the STM32F4, the 64 kB CCM at 0x10000000 is accessible only by the CPU (not by DMA), making it ideal for the stack, RTOS task stacks, and latency-critical data.

## Common Misunderstandings

A frequently misunderstood point is the distinction between volatile and atomic. Declaring a variable volatile tells the C compiler to emit a memory access instruction every time the variable is read or written, instead of caching the value in a register across multiple accesses.

A second misunderstanding involves memory ordering. The Cortex-M3 and M4 (ARMv7-M) have a weakly ordered memory model for device memory but a strongly ordered model for normal memory in the default (MPU-unconfigured) state; however the compiler and the write buffer can still reorder stores to device memory as seen by other bus masters.

## Key Takeaways

The three-stage in-order pipeline with no dynamic branch prediction means firmware performance is highly predictable and linear: backward branches are cheap, forward branches incur a refill penalty, and placing hot paths in sequential code without branches is the primary throughput optimization available to the firmware engineer without changing the clock.

The distinction between MSP and PSP, and between privileged and unprivileged Thread mode, is the foundation of safe RTOS design on Cortex-M; understanding which stack the processor is using and why prevents the class of bugs where an ISR stack overflow silently corrupts a task's local variables.

## Further Reading

The ARM Architecture Reference Manual for ARMv7-M (document ARM DDI 0403, available from developer.arm.com with a free account) is the definitive normative reference for everything described in this article; chapters B1 (programmer model), B3 (memory model), and B5 (debug) are most directly relevant to firmware engineers.

Joseph Yiu's "The Definitive Guide to ARM Cortex-M3 and Cortex-M4 Processors" (3rd edition, Elsevier/Newnes, ISBN 978-0-12-408082-9) is the single best book for practicing firmware engineers; chapters 2-5 cover the programmer model, memory map, exceptions, and fault handling with worked examples from STM32 and LPC hardware.

## Related Topics

**Prerequisites**

- Clock System Fundamentals

**Next Topics**

- Memory Architecture
- Interrupts
- Fault Handling and Crash Analysis
