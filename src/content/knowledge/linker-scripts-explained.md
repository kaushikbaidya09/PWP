---
title: "Linker Scripts Explained: How Your Code Gets Placed in Memory"
brief: "Reading and writing linker scripts: memory regions, sections, load versus run addresses and the symbols startup code relies on."
order: 24
phase: 6
tags: ["Linker", ".text", ".data", ".bss"]
---

You have written a perfectly valid embedded C program. It compiles without warnings, your logic is sound, and yet when you flash the device the microcontroller either does nothing, resets immediately, or corrupts its own variables within milliseconds of startup.

Every embedded project has a linker script, even if you never wrote one yourself. When you start a new project in STM32CubeIDE or use a vendor-provided Makefile, a linker script comes along for the ride.

## The Fundamental Problem

A C compiler translates source code into machine instructions and data, but it makes no commitment about where those instructions and data will reside in physical memory. This is intentional: the compiler is a general-purpose tool, and it produces relocatable object files whose addresses can be adjusted later.

The naive assumption is that you can simply concatenate your object files and flash the result. This fails immediately.

## The Big Picture

Think of the linker script as a configuration document that tells the linker what memory regions exist on the chip and what goes in each one.

At the highest level, a linker script has two major commands. The MEMORY command describes the physical memory map of the target: the names, origins, and lengths of each region (flash, SRAM, CCM, etc.).

The diagram below shows where the linker script fits in the build pipeline and how it relates to the resulting memory layout.

![Linker Script and Memory Layout](/diagrams/linker_map.svg)

## Key Concepts and Terminology

.text SECTION - The section that contains compiled machine code (executable instructions).

.data SECTION - The section that holds initialized global and static variables.

.bss SECTION - The section that holds zero-initialized and uninitialized global and static variables.

LMA (Load Memory Address) - The address where a section's data physically resides in the flash image.

VMA (Virtual Memory Address) - The address at which a section operates at runtime.

MEMORY Command - The linker script command that defines available memory regions on the target.

## How It Works

### Step 1: The compiler produces relocatable sections

The compiler translates each .c file into a .o object file. Inside each object file, the code and data are organized into sections: .text for functions, .data for initialized globals, .bss for zero-initialized globals, .rodata for string literals and const data.

### Step 2: The linker reads the memory command

The linker opens the linker script and parses the MEMORY command first. This establishes the memory map: on an STM32F4, for example, you might have FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1024K and RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K.

### Step 3: The linker processes the sections command

Working through the SECTIONS command, the linker builds each output section by collecting the matching input sections from all object files. For example, the output .text section might be described as: collect .text and .text.* from every input object file, then place the result at the start of the FLASH region.

### Step 4: LMA/VMA split for initialized data

When the linker encounters the .data output section, the script instructs it to set the VMA to the current position in RAM (for example 0x20000000) but set the LMA to the current position in flash, immediately after .text and .rodata. In GNU ld syntax, this is expressed with the AT> FLASH directive on the section.

### Step 5: Symbols are defined and exported

At strategic points in the SECTIONS command, the script assigns values to symbols using the dot operator. A pattern like: _sdata = .; .data : AT>FLASH { *(.data) } >RAM _edata = .; _sidata = LOADADDR(.data); creates three symbols. _sdata holds the RAM start address of .data. _edata holds the RAM end address. _sidata holds the flash address where the initial values are stored.

### Step 6: Bss size is recorded

After .data, the script defines .bss similarly but with no LMA split because there is nothing to store in flash. The script records _sbss and _ebss (or equivalent names).

### Step 7: The final image is emitted

The linker produces the ELF file with all sections at their final addresses. A subsequent objcopy command strips ELF metadata and produces a flat binary or Intel HEX file for flashing.

## Under the Hood

When an ARM Cortex-M processor comes out of reset, the hardware performs a specific boot sequence in silicon. It reads a 32-bit word from address 0x00000000 (or from the boot alias, which is typically remapped to the start of flash) and loads it into the Main Stack Pointer register (MSP).

The location counter (the dot, ".") inside the SECTIONS command is a cursor that tracks the current address being assigned. Every time the linker places an input section, the dot advances by the section's size.

## Real-World Applications

**Automotive (AUTOSAR, MCAL, Safety-Critical ECUs).** Automotive firmware on platforms like NXP S32K or Infineon AURIX requires strict separation of code and data by memory protection unit (MPU) regions. The linker script must align section boundaries to MPU granularity (typically 32 bytes or a power of two).

**Consumer electronics (STM32, nordic nRF, NXP LPC).** Wireless SoC firmware for devices like Bluetooth earbuds or smartwatches often uses the linker script to place softdevice or radio protocol stack code in a reserved flash region and application code in a separate region. Nordic's nRF5 SDK, for example, provides a linker script template with the softdevice region pre-reserved.

## Common Mistakes

### Wrong origin or length in memory command

**What goes wrong:** The firmware flashes and runs but corrupts variables or hard-faults because the linker placed sections beyond the actual end of flash or RAM, or the origins do not match the hardware. On STM32F103, flash starts at 0x08000000, not 0x00000000 (though both may alias).

**How to avoid it:** Cross-reference the MEMORY command against the MCU's datasheet memory map section. Use the MAP file to verify that no section exceeds its region boundary.

### Forgetting the data copy in startup code

**What goes wrong:** Initialized globals contain garbage at startup. The linker script correctly defines _sdata, _edata, and _sidata, but the startup code was written or modified without implementing the copy loop.

**How to avoid it:** Inspect the startup assembly file. Confirm that the loop from _sidata to (_sidata + (_edata - _sdata)) is explicitly coded and runs before main() is called.

### Not keeping the vector table with

--gc-sections

**What goes wrong:** When --gc-sections is active, the linker removes sections not reachable from the entry point. The vector table is referenced only as data, not called by code, so the linker may strip it entirely.

## Debugging and Troubleshooting

**Symptom:** Hard fault immediately on reset, before reaching main().

**Possible Cause:** Vector table is at the wrong address, or Reset_Handler address in the vector table is incorrect (wrong address or missing Thumb bit).

**Investigation Method:** Attach a JTAG/SWD debugger (OpenOCD + GDB).

**Resolution:** Ensure the vector table section is the FIRST thing in the FLASH region in the linker script.

**Symptom:** Initialized global variables contain garbage or zero at program start.

**Possible Cause:** The .data copy loop in startup code is not running, or _sidata contains an incorrect flash address because the LMA was not set correctly in the linker script.

**Investigation Method:** In GDB, set a breakpoint at the first instruction of Reset_Handler.

**Resolution:** Correct the LMA specification in the .data section of the linker script (add AT>FLASH or AT(_sidata) as appropriate).

## Design Considerations and Best Practices

1. **Always Cross-Reference the Memory Command Against the Datasheet Every Time You Target a New Device.** Memory map errors are silent at compile time and catastrophic at runtime. The ORIGIN and LENGTH values for every region must come from the MCU datasheet's memory map table, not from a neighboring device's linker script. STM32 sub-families differ: an STM32F103C8 has 64 KB flash while an STM32F103CB has 128 KB at the same ORIGIN. Using the wrong LENGTH will not cause a build error until you exceed it; until then, the tool silently accepts the configuration.

2. **Use Assert() in the Linker Script to Enforce Invariants.** The GNU ld ASSERT() command evaluates an expression and halts the link with a message if it is false. Use it to verify that stack and heap fit: "ASSERT(_heap_end <= _stack_start, "Heap and stack overlap")".

## Expert Notes

**The thumb bit in vector table entries is not a mistake.** Every function address stored in the Cortex-M vector table has bit 0 set to 1. This looks like an odd (misaligned) address, but it is not: it signals to the CPU that the target is Thumb code.

**The map file orphan section warning is not informational.** When you see a linker warning like "orphan section .foo from bar.o placed in .text", this means a section in an object file had no matching rule in the SECTIONS command, and the linker placed it somewhere it thought was reasonable. This is never intentional behavior in a mature embedded project.

## Summary

The linker script is the exact specification of your firmware's physical layout in memory. Every address at which your code executes and every address at which your data lives is determined by the rules written in this file. On bare-metal embedded targets there is no operating system, no loader, and no dynamic relocation: the linker script's decisions are permanent from the moment the build completes.

The three most important concepts to internalize are: (1) the LMA/VMA split for initialized data, which requires a corresponding copy in startup code; (2) the role of linker-defined symbols as the communication channel between the linker and the startup code; and (3) the KEEP() directive as the guardian against garbage-collection silently removing your vector table and ISRs. These three concepts together account for the majority of production failures that trace back to linker script errors.

## Related Topics

**Prerequisites**

- Memory Architecture (Flash, SRAM, ROM, memory-mapped peripherals)
- MCU Boot Sequence (reset vector, vector table, boot modes)
- Cross-Compilation and Toolchains (preprocessor, compiler, assembler, linker stages)
- CPU Execution Model (register set, Thumb instruction set, MSP/PSP)

**Next Topics**

- Bootloaders and Firmware Updates (application jump, address boundaries, shared linker script conventions)
- Firmware Architecture Patterns (layered architecture, HAL placement, section-based feature flags)
- Memory Corruption and System Stability (aligning sections to MPU regions, linker script support)
