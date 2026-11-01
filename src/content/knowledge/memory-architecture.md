---
title: "Memory Architecture: How Flash, RAM, Stack and Heap Fit Together"
brief: "How Flash, SRAM, stack, heap and peripherals share one address space, and how to catch overflows before they corrupt data."
order: 2
phase: 1
tags: ["Flash", "SRAM", "Memory Map", "Stack"]
---

You have just written your first firmware for an STM32F4. The code compiles cleanly, the linker reports no errors, and you flash it to the board.

This scenario plays out constantly in embedded development. Unlike application-layer software, firmware runs on hardware with fixed, finite memory.

## The Fundamental Problem

A microcontroller is not a PC. It has no memory management unit capable of giving every process its own virtual address space, no disk to page to, and no runtime memory allocator backed by an OS kernel.

The naive assumption most engineers bring from desktop development is that the compiler and runtime handle memory. You declare a variable and it exists.

## The Big Picture

At the highest level, a microcontroller's memory system is a set of physical resources, each mapped into a specific region of the CPU's address space. The CPU fetches instructions from Flash (read-only at runtime), reads and writes variables in SRAM, accesses peripheral registers by writing to their mapped addresses, and may optionally interact with external memory via a bus interface.

The relationship between these layers is the memory map: a document (and a hardware reality) that assigns address ranges to functions. Getting this map wrong at the linker level means your .data section initializers will not be copied to RAM correctly.

The diagram below shows a simplified Cortex-M memory map alongside a typical STM32F4 instance, and the runtime layout of SRAM.

![Cortex-M Memory Map and SRAM Runtime Layout](/diagrams/memory_layout.svg)

## How It Works

### Step 1: The Linker Places Sections Into Physical Regions

Before any code runs, the linker script (typically a .ld file for GCC-based toolchains) defines memory regions corresponding to physical memory on the target. For example, FLASH might be defined as starting at 0x08000000 with a length of 512K on an STM32F411.

### Step 2: Startup Code Copies .data and Zeroes .bss

After reset, the CPU begins executing at the reset handler address stored in the vector table (the second word in Flash, at offset 0x00000004 from the Flash base). The reset handler is assembly or C code provided by the vendor or your startup file.

### Step 3: The Stack Is Initialized and Starts Consuming SRAM

The initial stack pointer value is the first word of the vector table (offset 0x00000000 in the Cortex-M vector table). The linker places the top of SRAM there.

### Step 4: The Heap Grows Upward From the End of .bss

If your code calls malloc() or new (or uses a library that does), the C runtime heap allocator takes memory from a region starting immediately above .bss. The heap pointer grows upward.

### Step 5: Peripheral Registers Are Accessed by Address

At runtime, your code accesses hardware by reading and writing specific addresses. When you write to GPIOA->ODR on an STM32, you are writing to address 0x40020014.

### Step 6: Flash Is Also Readable As Data (rodata and Constants)

Code is not the only thing in Flash. Constants, lookup tables, string literals, and font bitmaps for displays can all be placed in Flash using the const keyword combined with proper linker section placement.

### Step 7: EEPROM (Or Flash Emulation) Handles Non-Volatile Parameters

Some MCUs include dedicated EEPROM (ATmega, some STM32L series). Others emulate EEPROM in Flash using wear-leveling algorithms (STM32 AN2594 EEPROM emulation).

## Key Concepts and Terminology

**Flash Memory** — Non-volatile program storage that retains contents without power.

**Sram** — Static Random Access Memory.

**Memory Map** — The complete assignment of address ranges to physical resources: Flash, SRAM, peripheral registers, external buses, and system peripherals.

**Vector Table** — A table of 32-bit addresses at the very beginning of Flash (or at an offset set by VTOR).

.TEXT SECTION - The linker section containing compiled machine code.

.DATA SECTION - The linker section containing initialized global and static variables.

## Under the Hood

On ARM Cortex-M, the CPU uses a modified Harvard architecture internally (separate instruction and data buses) but presents a single unified address space to software. The Cortex-M3 and M4 cores have three bus interfaces: the I-Code bus (instruction fetches from Flash), the D-Code bus (data accesses to Flash, e.g. reading .rodata), and the System bus (SRAM, peripheral, and external memory accesses).

Flash wait states deserve particular attention. Internal Flash is slower than the CPU clock on high-speed MCUs.

## Real-World Applications

### Automotive

Automotive ECUs (Engine Control Units) use Flash for calibration tables (fuel maps, ignition timing curves) and SRAM for real-time loop variables. Some designs use external SPI Flash for large lookup tables.

### Industrial

PLCs and motion controllers frequently need deterministic cycle times. Time-critical ISRs and motor control loops are placed in CCM (Core Coupled Memory) or DTCM on Cortex-M7, which operates at CPU clock speed with no wait states.

## Common Mistakes

**Stack Overflow Without Detection** — An undersized stack grows into the .bss or .data region. The CPU overwrites your global variables with stack frames. Behavior becomes unpredictable but no fault fires on Cortex-M0.

**Forgetting to Configure Flash Wait States** — On STM32F4/F7/H7, the default Flash wait state after reset is 0. If you boost the CPU clock without setting the correct wait state, Flash reads return garbage. Code that worked at 16 MHz (HSI reset clock) crashes at 168 MHz because startup code raised the PLL before the Flash latency was set.

**Treating Peripheral Registers As Regular Memory** — Omitting volatile on a pointer to a peripheral register allows the compiler to cache the read in a register and never re-read it. A status flag poll becomes an infinite loop or a never-entered branch. Use the vendor CMSIS headers which declare all peripheral structs with the correct volatile qualifiers.

## Debugging and Troubleshooting

**Symptom:** Device hard-faults or locks up shortly after startup, but only when certain functions are called.

**Possible Cause:** Stack overflow.

**Investigation Method:** Enable stack painting in startup code (fill stack region with 0xDEADBEEF).

**Resolution:** Increase stack size in the linker script or reduce stack usage by moving large local arrays to static scope.

**Symptom:** Global variable always reads zero even though it is initialized to a non-zero value.

**Possible Cause:** .data section initialization is not running.

**Investigation Method:** Set a breakpoint at the first line of the reset handler.

**Resolution:** Fix the linker script MEMORY definitions or the startup copy loop symbols.

## Design Considerations and Best Practices

1. **Always Verify Your Linker Script Against the Hardware Datasheet.** Copied linker scripts are one of the most dangerous things in embedded development. They compile silently with wrong sizes, wrong base addresses, or wrong section placements. The first task on any new MCU bring-up is to cross-reference every MEMORY region in the .ld file against the datasheet's memory map table. This takes ten minutes and prevents days of debugging.

2. **Size Your Stack with Margin and Then Add More.** Calculate the worst-case call chain depth, add up the stack frames (local variables + saved registers + return address per frame), multiply by 1.5 for interrupt overhead, and add 256 bytes minimum safety margin. Interrupts nest on their own stack frame ON TOP OF whatever the current stack depth is.

## Expert Notes

**Volatile does not mean atomic.** A common misconception is that declaring a variable volatile makes concurrent access safe. Volatile only tells the compiler to reload the variable from memory on every access.

**The map file is one of the most useful debugging tools you have.** When something goes wrong with memory, the first thing experienced engineers open is the .map file. It shows the exact address and size of every symbol, every section, and every object file's contribution.

## Summary

Memory architecture is not a topic you learn once and then take for granted. It is an active constraint that shapes every firmware decision. The placement of code in Flash, variables in SRAM, and parameters in non-volatile storage is not automatic.

The stack and heap are not abstract concepts. They are specific regions of physical SRAM with fixed base addresses, fixed sizes, and no hardware protection by default. The stack grows downward from the top of SRAM.

## Related Topics

**Prerequisites**

- MCU Boot Sequence (reset vector, vector table structure, boot modes)
- CPU Execution Model

**Next Topics**

- Linker Scripts Explained (MEMORY, SECTIONS, LMA vs VMA, symbol exports)
- Memory Corruption and System Stability
- RTOS Fundamentals
