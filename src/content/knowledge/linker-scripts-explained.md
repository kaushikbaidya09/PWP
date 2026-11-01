---
title: "Linker Scripts Explained: How Your Firmware Gets Placed in Memory"
brief: "Reading and writing linker scripts: memory regions, sections, load versus run addresses and the symbols startup code relies on."
order: 24
phase: 6
tags: ["Linker", ".text", ".data", ".bss"]
---
You have written a perfectly valid embedded C program. It compiles without warnings, your logic is sound, and yet when you flash the device the microcontroller either does nothing, resets immediately, or corrupts its own variables within milliseconds of startup. You dig into the disassembly and discover that your initialized global variables contain garbage, your interrupt vector table is sitting at the wrong address, and your carefully written startup code is trying to copy data from a flash address that maps to nothing. The compiler did not lie to you. The linker did exactly what you told it to do. The problem is that nobody told it the right thing.

Every embedded project has a linker script, even if you never wrote one yourself. When you start a new project in STM32CubeIDE or use a vendor-provided Makefile, a linker script comes along for the ride. It is usually a file with a .ld extension sitting quietly in your project directory, touched by almost nobody and understood by fewer still. This is a mistake. The linker script is the document that defines your firmware's physical layout in memory. It is not optional, not boilerplate, and not something you can cargo-cult from a reference design without understanding what it says.

The linker's job is to take all the object files (.o) produced by the compiler and combine them into a single executable image. But for an embedded target, combining objects is only half the job. The linker also has to answer a question the compiler deliberately left open: WHERE in memory does each piece of code and data actually live? On a hosted system (Linux, Windows), the operating system handles that. On a bare-metal microcontroller, there is no operating system. You are the operating system. That means you must tell the linker exactly what memory exists, where it starts, how large it is, and which sections of your program belong in which memory region. The linker script is how you do that.

## The Fundamental Problem

A C compiler translates source code into machine instructions and data, but it makes no commitment about where those instructions and data will reside in physical memory. This is intentional: the compiler is a general-purpose tool, and it produces relocatable object files whose addresses can be adjusted later. The linker is the tool that performs that adjustment. On a desktop system, an operating system loader handles the final placement at runtime. On a bare-metal embedded target, there is no loader. The firmware image that gets flashed to the device must already be positioned correctly, permanently, before it ever runs.

The naive assumption is that you can simply concatenate your object files and flash the result. This fails immediately. Your microcontroller's flash memory might start at address 0x08000000 (as it does on most STM32 devices), while its RAM starts at 0x20000000. The ARM Cortex-M core expects to find the initial stack pointer value and the reset handler address at specific locations at the very start of flash, because that is what the hardware reads on power-up. If your vector table is not at 0x08000000, or if it contains the wrong values, the processor will jump to a garbage address and hard-fault before your main() function ever runs.

There is a second, subtler problem: initialized data. When you write "uint32_t counter = 42;" at file scope in C, you expect counter to equal 42 when your program starts. In a desktop environment, the loader copies initialized data from the executable file into RAM before main() runs. On a bare-metal target, that copy does not happen automatically. The initial values must be stored in non-volatile flash, and then copied into RAM during startup. The linker script must define both where the initial values live in flash AND where the variables will live in RAM at runtime. The startup code then performs that copy. If the linker script does not communicate both addresses correctly, the startup code copies from the wrong place, and every initialized global in your program is corrupted before the first line of main() executes.

## The Big Picture

Think of the linker script as a configuration document that answers three questions. First: what memory regions exist on this chip? Second: which output sections of the final image go into which memory regions? Third: where exactly within those sections should each input section from each object file be placed? The linker reads this document, processes all the input object files, and produces a single ELF file (and optionally a binary or hex file) whose contents are positioned exactly as the script describes.

At the highest level, a linker script has two major commands. The MEMORY command describes the physical memory map of the target: the names, origins, and lengths of each region (flash, SRAM, CCM, etc.). The SECTIONS command describes how to populate those regions: it defines output sections, specifies which input sections from object files feed into them, and assigns addresses. The result is an ELF image where every byte of code and data has a known, fixed address that matches the physical memory of your target.

The diagram below shows where the linker script fits in the build pipeline and how it relates to the resulting memory layout.

![Linker Script and Memory Layout](/diagrams/linker_map.svg)

## Key Concepts and Terminology

.text SECTION - The section that contains compiled machine code (executable instructions). Every function in your program ends up here by default. The name comes from Unix conventions and has nothing to do with human-readable text. On an ARM Cortex-M device, .text resides in flash memory because flash is non-volatile and executable-in-place (XIP). The processor fetches instructions directly from flash addresses.

.data SECTION - The section that holds initialized global and static variables. These are variables that have a non-zero initial value specified at declaration time (for example, "int x = 5;"). The .data section has a dual life: its initial values must be stored in flash so they survive power cycles, but the variables must reside in RAM at runtime so they can be modified. This duality is what makes LMA vs VMA important.

.bss SECTION - The section that holds zero-initialized and uninitialized global and static variables. The C standard guarantees that uninitialized globals are zero at program start. Rather than storing a block of zeros in flash (wasteful), the linker notes the size of .bss and the startup code zeroes the RAM region at boot. .bss takes up zero bytes in the flash image but occupies a defined region of RAM at runtime.

LMA (Load Memory Address) - The address where a section's data physically resides in the flash image. For .text, LMA and VMA are the same because the code runs directly from flash. For .data, the LMA is the flash address where initial values are stored. At startup, the startup code copies data FROM the LMA TO the VMA. Confusing LMA and VMA is one of the most common linker script mistakes.

VMA (Virtual Memory Address) - The address at which a section operates at runtime. The processor uses VMA addresses to access code and data. For .text, VMA equals LMA. For .data, the VMA is the RAM address where variables live during program execution. When the linker resolves references to a variable, it uses the VMA. The compiler has already assumed the VMA when generating addressing code.

MEMORY Command - The linker script command that defines available memory regions on the target. Each region has a name (arbitrary, by convention FLASH and RAM), an origin address, a length, and optional access attributes (r=readable, w=writable, x=executable). The linker uses these regions to check for overflow and as targets for the AT> and > region placement operators in the SECTIONS command.

SECTIONS Command - The linker script command that defines how to build output sections from input sections and where to place them. Inside SECTIONS, you write output section descriptions that specify which input sections to include (using wildcard patterns), and which MEMORY region to assign them to.

**Symbol Definition** — The linker script can define symbols whose values are addresses or constants computed during linking. These symbols are exposed to C code as extern variables. The canonical examples are _sdata, _edata (start/end of .data in RAM), and _sidata (start of .data initial values in flash). Your startup code uses these symbols to perform the data copy and BSS zeroing.

**Entry Point** — The ENTRY() command in the linker script tells the linker which symbol is the program's entry point. For Cortex-M firmware this is typically Reset_Handler. This does not set the reset vector (that is done by your vector table data), but it prevents the linker from discarding Reset_Handler as an unreferenced symbol and marks it in the ELF for debugger use.

**Keep()** — A linker directive that prevents the linker's garbage collection from discarding a section, even if no other section appears to reference it. The interrupt vector table is the classic example: no C code calls the vector table, so the linker might strip it if you use --gc-sections. Wrapping it in KEEP() forces retention.

## How It Works

### Step 1: The compiler produces relocatable sections

The compiler translates each .c file into a .o object file. Inside each object file, the code and data are organized into sections: .text for functions, .data for initialized globals, .bss for zero-initialized globals, .rodata for string literals and const data. All addresses within these sections are relative (position-independent or relocation-noted), not yet fixed to physical addresses. The object file also contains a symbol table listing every function name, variable name, and linker script symbol that the file references or defines.

### Step 2: The linker reads the memory command

The linker opens the linker script and parses the MEMORY command first. This establishes the memory map: on an STM32F4, for example, you might have FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1024K and RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K. The linker now knows the address ranges it is allowed to populate. If the final image overflows a region, the linker emits an error and refuses to produce output. This overflow detection is one of the most valuable features of a correctly written linker script.

### Step 3: The linker processes the sections command

Working through the SECTIONS command, the linker builds each output section by collecting the matching input sections from all object files. For example, the output .text section might be described as: collect .text and .text.* from every input object file, then place the result at the start of the FLASH region. The linker concatenates all the matching input sections in the order they appear (influenced by link order and SORT directives), resolves symbol references between them, and assigns final virtual addresses starting from the current location counter (represented as the dot, or ".").

### Step 4: LMA/VMA split for initialized data

When the linker encounters the .data output section, the script instructs it to set the VMA to the current position in RAM (for example 0x20000000) but set the LMA to the current position in flash, immediately after .text and .rodata. In GNU ld syntax, this is expressed with the AT> FLASH directive on the section. The linker records both addresses. The flash image will contain the initial values of all .data variables stored consecutively after the code. The ELF file encodes both addresses so that the debugger and programmer flash the values to the right place.

### Step 5: Symbols are defined and exported

At strategic points in the SECTIONS command, the script assigns values to symbols using the dot operator. A pattern like: _sdata = .; .data : AT>FLASH { *(.data) } >RAM _edata = .; _sidata = LOADADDR(.data); creates three symbols. _sdata holds the RAM start address of .data. _edata holds the RAM end address. _sidata holds the flash address where the initial values are stored. These are the symbols your startup assembly (startup_stm32fxxx.s) uses when it loops to copy data from flash to RAM.

### Step 6: Bss size is recorded

After .data, the script defines .bss similarly but with no LMA split because there is nothing to store in flash. The script records _sbss and _ebss (or equivalent names). The startup code uses these to zero the range [_sbss, _ebss) in RAM. This satisfies the C standard's guarantee of zero-initialized storage duration for objects with static storage.

### Step 7: The final image is emitted

The linker produces the ELF file with all sections at their final addresses. A subsequent objcopy command strips ELF metadata and produces a flat binary or Intel HEX file for flashing. The flash programmer writes this image to the MCU's non-volatile memory. On reset, the hardware reads the initial stack pointer from address 0x08000000 and the reset handler address from 0x08000004 (on Cortex-M), both of which are now at their correct locations because the linker script placed the vector table first in the FLASH region.

## Under the Hood

When an ARM Cortex-M processor comes out of reset, the hardware performs a specific boot sequence in silicon. It reads a 32-bit word from address 0x00000000 (or from the boot alias, which is typically remapped to the start of flash) and loads it into the Main Stack Pointer register (MSP). It then reads the next 32-bit word and treats it as the address of the Reset_Handler function, and branches to it. This is pure hardware behavior, burned into the processor's reset logic. The linker script must guarantee that the first 8 bytes of your flash image contain exactly these values: initial MSP value and Reset_Handler address. The vector table section in the linker script enforces this by being placed first.

The location counter (the dot, ".") inside the SECTIONS command is a cursor that tracks the current address being assigned. Every time the linker places an input section, the dot advances by the section's size. You can read the dot's value (to assign it to a symbol), write to it (to insert padding or alignment gaps), and use it in expressions. ALIGN(4) is shorthand for advancing the dot to the next 4-byte boundary. If you do not align sections appropriately, you will get hard fault exceptions because ARM requires word-aligned access for 32-bit loads and stores.

The linker's garbage collection feature (--gc-sections, paired with -ffunction-sections and -fdata-sections in the compiler flags) deserves special attention. When these flags are active, each function and each data object is placed in its own input section (.text.function_name, .data.variable_name). The linker can then discard any section that is not reachable from the entry point. This significantly reduces image size. However, it can silently discard interrupt handlers, because ISRs are referenced only via the vector table (a data structure), not via direct function calls. The KEEP() directive in the linker script tells the linker to retain specific sections unconditionally. Without it, --gc-sections can produce a firmware image that is missing half its ISRs.

The LOADADDR() function in a linker script returns the LMA of a named section. This is how _sidata gets assigned correctly: the linker knows the LMA of the .data section (wherever it landed in flash after .text and .rodata) and stores that address in the _sidata symbol. Your startup code, written in assembly or C, does pointer arithmetic using _sidata, _sdata, and _edata to perform the copy loop. If these symbols contain wrong values because the linker script is malformed, the copy loop corrupts memory at boot, and the bug will look like random variable corruption that is extremely difficult to trace.

Memory-mapped peripherals and special RAM regions (CCM RAM on STM32F4, DTCM on STM32H7, tightly-coupled memory on various Cortex-M7 parts) require additional MEMORY entries and additional output sections in the SECTIONS command. Placing time-critical ISRs or DMA buffers in CCM or DTCM RAM dramatically improves performance but requires explicit linker script support: a separate section (typically .ccmram) with its own LMA/VMA split and a corresponding copy in startup code. Forgetting the startup copy is a very common mistake with these regions.

## Real-World Applications

**Automotive (AUTOSAR, MCAL, Safety-Critical ECUs).** Automotive firmware on platforms like NXP S32K or Infineon AURIX requires strict separation of code and data by memory protection unit (MPU) regions. The linker script must align section boundaries to MPU granularity (typically 32 bytes or a power of two). AUTOSAR memory mapping uses compiler-specific pragmas and sections (MemMap.h) to direct code into specific sections that the linker script then routes to protected memory regions. A misconfigured linker script that places stack and heap in the same MPU region as application data will defeat the entire memory protection scheme.

**Consumer electronics (STM32, nordic nRF, NXP LPC).** Wireless SoC firmware for devices like Bluetooth earbuds or smartwatches often uses the linker script to place softdevice or radio protocol stack code in a reserved flash region and application code in a separate region. Nordic's nRF5 SDK, for example, provides a linker script template with the softdevice region pre-reserved. The application developer must not modify those reserved regions or the radio stack will be overwritten and RF functionality will silently break.

**Industrial.** (Motor Controllers, PLCs, Safety PLCs) Industrial motor controllers on Cortex-M7 parts place time-critical current control loop code in DTCM (Data Tightly Coupled Memory, zero-wait-state) via **attribute**((section(".dtcm_code"))) in C, with a corresponding section in the linker script. The ISR handling the PWM update runs deterministically in tens of nanoseconds from DTCM instead of potentially stalling on flash cache misses.

**Medical devices (fda, IEC 62304 class c).** Medical firmware subject to IEC 62304 Class C requires that the linker script produce images with no overlapping sections and that section addresses be verified post-build. Build verification scripts parse the MAP file produced by the linker and assert that code sections stay within validated address ranges. Any linker script change triggers re-verification of the memory layout as part of the design control record.

**Aerospace (DO-178C, RTCA).** Safety-critical avionics firmware requires qualified toolchain components. The linker script is part of the qualified build process. It is version-controlled, reviewed under the same rigor as source code, and its correctness is verified by a MAP file analysis tool that cross-references the Software Design Document's memory allocation table.

IOT / LOW-POWER DEVICES IoT firmware on devices like the STM32L0 or MSP430 uses the linker script to place latency-tolerant code in flash and place interrupt handlers in RAM (where they execute with no flash wait states), trading RAM consumption for response speed. Some designs place a compact bootloader at a fixed address in the first N kilobytes of flash and application firmware at a higher address, with MEMORY regions in the linker script that enforce the boundary.

## Common Mistakes

### Wrong origin or length in memory command

**What goes wrong:** The firmware flashes and runs but corrupts variables or hard-faults because the linker placed sections beyond the actual end of flash or RAM, or the origins do not match the hardware. On STM32F103, flash starts at 0x08000000, not 0x00000000 (though both may alias). Using the wrong origin means the vector table is at the wrong address and the processor fetches garbage on reset.

**How to avoid it:** Cross-reference the MEMORY command against the MCU's datasheet memory map section. Use the MAP file to verify that no section exceeds its region boundary.

### Forgetting the data copy in startup code

**What goes wrong:** Initialized globals contain garbage at startup. The linker script correctly defines _sdata, _edata, and _sidata, but the startup code was written or modified without implementing the copy loop. The symptoms look like random data corruption that appears immediately at program start.

**How to avoid it:** Inspect the startup assembly file. Confirm that the loop from _sidata to (_sidata + (_edata - _sdata)) is explicitly coded and runs before main() is called.

### Not keeping the vector table with

--gc-sections

**What goes wrong:** When --gc-sections is active, the linker removes sections not reachable from the entry point. The vector table is referenced only as data, not called by code, so the linker may strip it entirely. The resulting firmware either fails to boot or crashes on any interrupt.

**How to avoid it:** Wrap the vector table section in KEEP(*(.isr_vector)) in the linker script.

### Misaligned section boundaries

**What goes wrong:** The .data or .bss section starts at an odd or non-word-aligned address. The startup code's copy loop uses 32-bit word copies (LDMIA/STMIA) and will read or write misaligned addresses, triggering a HardFault before main() runs.

**How to avoid it:** Use ALIGN(4) before and after data sections in the SECTIONS command to enforce 4-byte alignment.

### Placing stack and heap in the same region with no guard

**What goes wrong:** Stack grows downward from the top of RAM, heap grows upward from below BSS. With no guard between them, stack overflow silently overwrites heap-allocated data (or vice versa). The resulting bugs are non-deterministic and very difficult to trace.

**How to avoid it:** Define explicit _Min_Heap_Size and _Min_Stack_Size symbols in the linker script and add an ASSERT to verify that heap + stack fit within RAM.

### Using the wrong section name for

ISRs

**What goes wrong:** The developer writes an ISR and expects it to land in .text, but uses a section attribute like **attribute**((section(".ramfunc"))) without a corresponding entry in the linker script. The function is placed in an orphan section, the linker emits a warning (often ignored), and the function lands at an unpredictable address or is discarded.

**How to avoid it:** Every custom section attribute in C code must have a matching output section entry in the linker script.

### Overlooking fill and padding in flash size calculations

**What goes wrong:** The linker script inserts alignment padding between sections. A project may appear to have 2 KB free based on raw code size, but alignment padding and fill bytes consume that space, causing unexpected "region overflow" errors during build.

**How to avoid it:** Always use the MAP file's section summary to check actual consumed flash, not the compiler's size output alone.

## Debugging and Troubleshooting

**Symptom:** Hard fault immediately on reset, before reaching main().

**Possible Cause:** Vector table is at the wrong address, or Reset_Handler address in the vector table is incorrect (wrong address or missing Thumb bit).

**Investigation Method:** Attach a JTAG/SWD debugger (OpenOCD + GDB). On halt, inspect the PC register. Read the word at 0x08000004 (or the flash origin + 4) and verify it matches the address of Reset_Handler with bit 0 set (Thumb mode). Use "arm-none-eabi-objdump -d firmware.elf" and cross-reference.

**Resolution:** Ensure the vector table section is the FIRST thing in the FLASH region in the linker script. Verify that Reset_Handler is defined in the startup file and is not being garbage-collected.

**Symptom:** Initialized global variables contain garbage or zero at program start.

**Possible Cause:** The .data copy loop in startup code is not running, or _sidata contains an incorrect flash address because the LMA was not set correctly in the linker script.

**Investigation Method:** In GDB, set a breakpoint at the first instruction of Reset_Handler. Step through the startup code and watch the copy loop execute. Print the values of _sdata, _edata, and _sidata. Verify that the flash memory at _sidata actually contains the expected initial values using "x/8wx _sidata".

**Resolution:** Correct the LMA specification in the .data section of the linker script (add AT>FLASH or AT(_sidata) as appropriate). Verify the startup copy loop bounds.

**Symptom:** Firmware runs correctly from the debugger but fails when flashed and run standalone.

**Possible Cause:** The linker script uses ORIGIN = 0x00000000 for flash, which works when the debugger loads the ELF directly into memory but fails when the actual flash base is 0x08000000 and the boot alias is not remapped.

**Investigation Method:** Check VTOR (Vector Table Offset Register) value at runtime. On STM32, read the SYSCFG_MEMRMP register to see the boot mode. Compare the ORIGIN in the linker script against the datasheet.

**Resolution:** Set ORIGIN in the MEMORY FLASH region to the correct physical base address of flash on the target MCU.

**Symptom:** A specific interrupt never fires, or fires but jumps to the wrong handler.

**Possible Cause:** The ISR function name does not match the name expected by the vector table, or the ISR was placed in a custom section that was discarded by --gc-sections.

**Investigation Method:** Open the MAP file and search for the ISR function name. Verify it appears in the .text (or intended) section. Disassemble the vector table region (objdump -s --start-address=0x08000000 firmware.elf) and check that the vector slot contains the correct address.

**Resolution:** Ensure ISR names match the weak aliases defined in the startup file. Add KEEP() around the vector table section in the linker script. If using a custom section for RAM-executed ISRs, add the section to the linker script and the copy to startup code.

## Design Considerations and Best Practices

1. **Always Cross-Reference the Memory Command Against the Datasheet Every Time You Target a New Device.** Memory map errors are silent at compile time and catastrophic at runtime. The ORIGIN and LENGTH values for every region must come from the MCU datasheet's memory map table, not from a neighboring device's linker script. STM32 sub-families differ: an STM32F103C8 has 64 KB flash while an STM32F103CB has 128 KB at the same ORIGIN. Using the wrong LENGTH will not cause a build error until you exceed it; until then, the tool silently accepts the configuration.

2. **Use Assert() in the Linker Script to Enforce Invariants.** The GNU ld ASSERT() command evaluates an expression and halts the link with a message if it is false. Use it to verify that stack and heap fit: "ASSERT(_heap_end <= _stack_start, "Heap and stack overlap")". This catches RAM overflow at link time rather than as a silent runtime corruption.

3. **Always Review the Map File After Significant Changes.** The .map file (produced with -Wl,-Map=firmware.map) is the ground truth for what the linker actually did. It lists every section, every symbol address, and every input object that contributed to each output section. Keeping a MAP file diff between releases catches unintended code growth, symbol address changes (which affect hard-coded addresses in bootloaders), and orphan sections.

4. **Version-Control the Linker Script with the Same Rigor As Source Code.** A change to the linker script can silently change the address of every function and variable in the firmware. If your bootloader jumps to a hard-coded application entry point (a common pattern), a linker script change that shifts the entry point will break the boot sequence without any compiler warning.

5. USE -ffunction-sections AND -fdata-sections TOGETHER WITH --gc-sections TO REDUCE IMAGE SIZE, BUT AUDIT THE MAP FILE AFTER ENABLING THEM. These flags allow the linker to discard unreachable code and data. The image size reduction on a real project is typically 10-30%. However, enabling --gc-sections without auditing the MAP file risks silently discarding sections you intended to keep (ISRs, linker-script-placed data, constructor tables). The Map file will show "discarded" sections explicitly.

6. DEFINE _Min_Stack_Size AND _Min_Heap_Size AS SYMBOLS AND USE THEM IN AN ASSERT. This makes your minimum requirements explicit and machine-checkable. Many vendor-supplied linker scripts already do this (STM32CubeIDE templates use 0x400 and 0x200 as defaults). Adjust these based on your worst-case measured stack depth, not guesswork.

7. **Place Critical Real-Time Code in Zero-Wait-State Memory Explicitly.** On Cortex-M7 devices with ITCM/DTCM, default placement in flash may introduce cache-miss latency that violates timing requirements. Define a .itcm_text section in the linker script, use a function attribute to route latency-critical ISRs there, and add the LMA/VMA copy to startup code. Measure, do not assume.

8. **Never Copy a Linker Script From a Different Chip Family Without a Line-by-Line Review.** Cortex-M0, M3, M4, M7, and M33 all use the same GNU ld linker, so a script from one will "work" on another at the tool level, but the MEMORY parameters, FPU context save sections, and special memory regions differ. A Cortex-M7 script applied to a Cortex-M0 target will compile and link but may reference TCM regions that do not exist, causing subtle runtime failures.

## Expert Notes

**The thumb bit in vector table entries is not a mistake.** Every function address stored in the Cortex-M vector table has bit 0 set to 1. This looks like an odd (misaligned) address, but it is not: it signals to the CPU that the target is Thumb code. The actual function address is (stored_value & ~1). Forgetting this when manually constructing a vector table in assembly, or when writing a bootloader that reads and jumps to a vector table entry, produces a UsageFault immediately on the branch because the CPU attempts to switch to ARM state (bit 0 = 0), which Cortex-M does not support.

**The map file orphan section warning is not informational.** When you see a linker warning like "orphan section .foo from bar.o placed in .text", this means a section in an object file had no matching rule in the SECTIONS command, and the linker placed it somewhere it thought was reasonable. This is never intentional behavior in a mature embedded project. It means either the C code has a section attribute with no matching linker script entry, or a third-party library uses non-standard section names. Treat orphan section warnings as errors (-Wl,--orphan-handling=error) once the project is stable.

**Startup code and linker script are inseparable contracts.** The symbol names used in the startup code (_sdata, _edata, _sidata, _sbss, _ebss) are not standard: different vendors and different template generators use different names. If you replace a vendor startup file with a custom one, or replace the linker script with one from a different source, the symbol names must match exactly on both sides. A mismatch produces no compile error and no link error if the startup code declares the missing symbol as extern; the symbol simply resolves to address 0, and the copy loop silently zeros the wrong memory region.

**The linker script controls constructors and destructors in c++ firmware.** If your embedded firmware uses C++, the linker script must include .init_array and .fini_array sections, and the startup code must iterate these arrays to call global constructors before main() and destructors at exit. Missing .init_array in the linker script means global C++ objects are never constructed. The objects exist in memory but their constructors never ran, so any object with a non-trivial constructor (mutexes, peripheral drivers, RTOS objects) is in an undefined state when main() starts. This is a very common failure mode when porting C++ code to a bare-metal target whose startup file was written for C.

**Linker script expressions are evaluated at link time, not runtime.** This sounds obvious but causes confusion when symbols calculated in the linker script are used in C code as if they were variables. When you write "extern uint32_t _estack;" in C and read its value, you are reading the ADDRESS of _estack (which is the value assigned in the linker script), not the contents of a memory location. The correct pattern is to take the address: "_stack_top = (uint32_t)&_estack;". Using it without the address-of operator is a very common and non-obvious bug that reads garbage depending on what happens to be at address zero (or wherever the linker placed the symbol value).

## Summary

The linker script is the exact specification of your firmware's physical layout in memory. Every address at which your code executes and every address at which your data lives is determined by the rules written in this file. On bare-metal embedded targets there is no operating system, no loader, and no dynamic relocation: the linker script's decisions are permanent from the moment the build completes. Getting it right is not optional and not something that can be safely delegated to a template without understanding.

The three most important concepts to internalize are: (1) the LMA/VMA split for initialized data, which requires a corresponding copy in startup code; (2) the role of linker-defined symbols as the communication channel between the linker and the startup code; and (3) the KEEP() directive as the guardian against garbage-collection silently removing your vector table and ISRs. These three concepts together account for the majority of production failures that trace back to linker script errors.

Beyond correctness, the linker script is also a design document. Decisions about where to place real-time ISRs, how to size the stack and heap, which regions of flash are reserved for bootloaders, and how MPU regions align to section boundaries all belong in the linker script. Treating it as a read-only vendor artifact that you never touch is a missed opportunity. A well-crafted linker script encodes the memory architecture of your system and enforces it at every build.

The mental model to retain is this: the linker script is the contract between the build tools and the hardware. The MEMORY command describes what the hardware offers. The SECTIONS command describes what your firmware needs. The symbols bridge the static link-time world and the runtime world that startup code inhabits. Every time something fails at boot before main() runs, and every time initialized data is corrupt at program start, the linker script or startup code is the first place to look.

## Related Topics

**Prerequisites**

- Memory Architecture (Flash, SRAM, ROM, memory-mapped peripherals)
- MCU Boot Sequence (reset vector, vector table, boot modes)
- C Compilation Pipeline (preprocessor, compiler, assembler, linker stages)
- ELF File Format (sections, segments, symbol tables)
- ARM Cortex-M Architecture (register set, Thumb instruction set, MSP/PSP)

**Next Topics**

- Bootloaders and Firmware Updates (application jump, address boundaries, shared linker script conventions)
- Firmware Architecture Patterns (layered architecture, HAL placement, section-based feature flags)
- Startup Code Deep Dive (Reset_Handler, copy loops, C runtime init)
- Memory Protection Unit (MPU) Configuration (aligning sections to MPU regions, linker script support)
- Map File Analysis and Build Size Optimization
