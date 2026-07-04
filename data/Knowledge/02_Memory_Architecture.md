---
id: memory-architecture
tags: ['Flash', 'SRAM', 'Memory Map', 'Stack']
---

# Memory Architecture: Understanding Flash, RAM, Stack, Heap and Memory Maps

You have just written your first firmware for an STM32F4. The code compiles cleanly, the linker reports no errors, and you flash it to the board. The device resets, the LED blinks twice, and then the system locks up hard. No fault handler fires. No watchdog reset. Just silence. You stare at the map file trying to figure out what went wrong. A colleague glances over your shoulder and says, "You overflowed the stack." You nod, but you do not really know what that means or how to confirm it, let alone prevent it next time.

This scenario plays out constantly in embedded development. Unlike application-layer software, firmware runs on hardware with fixed, finite memory. There is no operating system to expand your heap on demand, no virtual memory to bail you out when you run long, and no garbage collector quietly tidying up your allocations. Every byte of Flash and every byte of RAM has a fixed address, a fixed purpose, and a fixed limit. If your code violates those limits, the hardware will not protect you. It will silently execute garbage from wherever the stack pointer happens to land.

Understanding memory architecture is not optional knowledge for embedded engineers. It is the lens through which every other concept is understood. Linker scripts, startup code, DMA configuration, bootloaders, and real-time scheduling all depend on a clear mental model of how memory is organized and used at runtime. Misunderstanding memory is the root cause of a disproportionate share of production firmware bugs, field failures, and hard-to-reproduce defects.

This article focuses on microcontrollers with Harvard-influenced or von Neumann memory architectures, primarily ARM Cortex-M devices (STM32, nRF52, LPC, SAM series) and AVR, though the principles apply broadly. The emphasis is not on memorizing specs but on building a durable mental model.

By the end of this article, you will understand how Flash, SRAM, EEPROM, and memory-mapped peripherals coexist in a single address space; how the linker places your code and data into physical memory; how the stack and heap work mechanically at the CPU level; and how to reason about memory layout when things go wrong.

## The Fundamental Problem

A microcontroller is not a PC. It has no memory management unit capable of giving every process its own virtual address space, no disk to page to, and no runtime memory allocator backed by an OS kernel. The CPU sees one flat address space. Every peripheral register, every byte of Flash, every byte of RAM, and every external bus address occupies a range within that flat address space. On ARM Cortex-M, that space is 4 GB (32-bit addressing), and the silicon vendor decides how to carve it up. The engineer who does not understand that layout will write code that compiles and links correctly but corrupts memory silently at runtime.

The naive assumption most engineers bring from desktop development is that the compiler and runtime handle memory. You declare a variable and it exists. You call malloc and memory appears. You return from a function and the stack rewinds automatically. All of that is technically true, but in embedded systems the mechanisms behind it are fragile and unforgiving. The stack is a fixed region of SRAM with no guard, no expansion, and no protection on most Cortex-M0 and Cortex-M0+ cores. Overflowing it means overwriting whatever happens to live below it, typically heap data or statically allocated variables, with no immediate fault.

A second problem is that not all memory behaves the same way. Flash is non-volatile, byte-readable but block-erasable. SRAM is volatile, fast, and uniformly accessible. EEPROM is non-volatile but slow to write and has a limited endurance cycle count. Peripheral registers occupy specific addresses and respond to read/write cycles with hardware side effects. Using the wrong memory type for the wrong purpose, putting a frequently-modified configuration value in Flash instead of EEPROM, for example, produces a system that slowly destroys itself in production. These distinctions are invisible to the compiler. Only the engineer who understands them can make correct decisions.

## The Big Picture

At the highest level, a microcontroller's memory system is a set of physical resources, each mapped into a specific region of the CPU's address space. The CPU fetches instructions from Flash (read-only at runtime), reads and writes variables in SRAM, accesses peripheral registers by writing to their mapped addresses, and may optionally interact with external memory via a bus interface. The linker script defines which symbols and sections land in which physical regions. The startup code initializes RAM contents before main() runs. From main() onward, stack and heap operations consume SRAM dynamically.

The relationship between these layers is the memory map: a document (and a hardware reality) that assigns address ranges to functions. Getting this map wrong at the linker level means your .data section initializers will not be copied to RAM correctly. Getting it wrong at the application level means your stack and heap will collide. Getting it wrong at the peripheral level means you will write to the wrong register and configure the wrong hardware block.

The diagram below shows a simplified Cortex-M memory map alongside a typical STM32F4 instance, and the runtime layout of SRAM.

<div class="detail-diagram">
<img src="../assets/svg/diagrams/memory_layout.svg" alt="Cortex-M Memory Map and SRAM Runtime Layout" loading="lazy">
</div>

## How It Works

### Step 1: The Linker Places Sections Into Physical Regions

Before any code runs, the linker script (typically a .ld file for GCC-based toolchains) defines memory regions corresponding to physical memory on the target. For example, FLASH might be defined as starting at 0x08000000 with a length of 512K on an STM32F411. SRAM might be 0x20000000 with 128K. The linker then places output sections into these regions. The .text section (compiled machine code) and .rodata section (string literals, const data) go into Flash. The .data section (initialized global and static variables) has a LOAD address in Flash (where initial values are stored) and a RUN address in SRAM (where the CPU will access them at runtime). The .bss section (zero-initialized globals and statics) occupies only SRAM with no Flash footprint.

### Step 2: Startup Code Copies .data and Zeroes .bss

After reset, the CPU begins executing at the reset handler address stored in the vector table (the second word in Flash, at offset 0x00000004 from the Flash base). The reset handler is assembly or C code provided by the vendor or your startup file. It does two things before calling main(): it copies the .data section's initial values from Flash to SRAM using the symbols the linker exported (_sdata, _edata, _sidata), and it fills the .bss region with zeros using _sbss and _ebss. If this step is skipped or corrupted, your initialized globals will contain garbage and your zero-initialized globals will contain whatever was left in SRAM from the last boot. This is a real failure mode when startup files are customized incorrectly.

### Step 3: The Stack Is Initialized and Starts Consuming Sram

The initial stack pointer value is the first word of the vector table (offset 0x00000000 in the Cortex-M vector table). The linker places the top of SRAM there. As functions are called, the CPU decrements the stack pointer (SP) and writes the return address, saved registers, and local variables. When a function returns, SP is incremented back. This means the stack grows downward toward lower addresses. The danger is obvious: if the stack grows far enough, it collides with the .bss or .data region sitting at the bottom of SRAM, silently overwriting your global variables with stack frames.

### Step 4: The Heap Grows Upward From the End of .bss

If your code calls malloc() or new (or uses a library that does), the C runtime heap allocator takes memory from a region starting immediately above .bss. The heap pointer grows upward. The stack grows downward. They are converging toward each other from both ends of free SRAM. Neither knows about the other. When they meet, you have a collision. On Cortex-M0 with no MPU, you will not get a fault. You will get data corruption.

### Step 5: Peripheral Registers Are Accessed by Address

At runtime, your code accesses hardware by reading and writing specific addresses. When you write to GPIOA->ODR on an STM32, you are writing to address 0x40020014. The ARM bus fabric routes that write to the AHB1 peripheral bus, and the GPIO IP block responds by changing the output latch. There is no function call overhead at the hardware level. The compiler generates a single STR instruction. The volatile keyword on peripheral register definitions is CRITICAL here. Without it, the compiler is free to optimize away reads or writes it considers redundant, breaking peripheral access in ways that are nearly impossible to debug without an oscilloscope.

### Step 6: Flash Is Also Readable As Data (rodata and Constants)

Code is not the only thing in Flash. Constants, lookup tables, string literals, and font bitmaps for displays can all be placed in Flash using the const keyword combined with proper linker section placement. On AVR, you must use the PROGMEM attribute and pgm_read functions because the Harvard architecture uses separate buses for program and data memory. On Cortex-M, Flash is in the same address space and const data in Flash is readable with a normal pointer. This distinction trips up engineers moving from AVR to ARM for the first time.

### Step 7: Eeprom (or Flash Emulation) Handles Non-Volatile Parameters

Some MCUs include dedicated EEPROM (ATmega, some STM32L series). Others emulate EEPROM in Flash using wear-leveling algorithms (STM32 AN2594 EEPROM emulation). Either way, writing non-volatile parameters requires explicit erase and write cycles. Treating EEPROM like RAM and writing to it in a loop will exhaust its write endurance (typically 100,000 to 1,000,000 cycles) within days. The correct pattern is to buffer updates in SRAM and flush to non-volatile storage only on meaningful state changes.

## Key Concepts and Terminology

**Flash Memory** — Non-volatile program storage that retains contents without power. Code and read-only data live here. On most MCUs, Flash is internally connected and the CPU fetches instructions directly from it, often through a prefetch buffer or instruction cache. Flash cannot be written byte-by-byte; it must be erased in pages or sectors (typically 1 KB to 128 KB) before writing. Program Flash endurance is typically 10,000 to 100,000 erase/write cycles.

**Sram** — Static Random Access Memory. Volatile, fast, uniformly read/writable at any granularity. Holds the .data section, .bss section, stack, and heap at runtime. "Static" refers to the latch technology (no refresh needed), not to static storage class in C. On Cortex-M devices, SRAM typically starts at 0x20000000. Some MCUs have multiple SRAM banks that may require explicit placement to use.

**Memory Map** — The complete assignment of address ranges to physical resources: Flash, SRAM, peripheral registers, external buses, and system peripherals. Published in the MCU's reference manual. The linker script must agree with the hardware memory map precisely, or the firmware will not run.

**Vector Table** — A table of 32-bit addresses at the very beginning of Flash (or at an offset set by VTOR). The first entry is the initial stack pointer value. Subsequent entries are handler addresses for reset, NMI, HardFault, and all peripheral interrupts. Cortex-M hardware reads this table directly on exception entry.

.TEXT SECTION - The linker section containing compiled machine code. Placed in Flash by the linker script. Also called the code segment.

.DATA SECTION - The linker section containing initialized global and static variables. Has both a load address (in Flash, where initial values are stored) and a virtual address (in SRAM, where the CPU accesses them at runtime). Startup code copies from LMA to VMA before main().

.BSS SECTION - The linker section containing zero-initialized globals and statics. Takes no space in Flash (only its size and SRAM address are recorded). Startup code fills the region with zeros.

**Stack** — A LIFO region of SRAM used for function call overhead: return addresses, saved register values, and local variables. On Cortex-M, the stack grows downward (toward lower addresses). The SP register tracks the current top. No bounds checking exists unless an MPU is configured.

**Heap** — A region of SRAM used for dynamic memory allocation (malloc, new). Managed by the C runtime allocator. Grows upward from the end of .bss. Fragmentation and stack-heap collision are the two primary failure modes. Dynamic allocation is DISCOURAGED in safety-critical firmware after initialization.

**Linker Script** — A text file (.ld on GCC, .icf on IAR) that instructs the linker how to map input sections to output sections and then to physical memory regions. The engineer-controlled bridge between the compiler's output and the target hardware's memory map. Getting this wrong silently produces broken firmware.

## Under the Hood

On ARM Cortex-M, the CPU uses a modified Harvard architecture internally (separate instruction and data buses) but presents a single unified address space to software. The Cortex-M3 and M4 cores have three bus interfaces: the I-Code bus (instruction fetches from Flash), the D-Code bus (data accesses to Flash, e.g. reading .rodata), and the System bus (SRAM, peripheral, and external memory accesses). These three buses operate in parallel within a single cycle, which means the CPU can simultaneously fetch an instruction from Flash and read a data operand from SRAM. This pipelining is invisible to firmware but explains why Flash wait states do not always incur the full penalty one might expect.

Flash wait states deserve particular attention. Internal Flash is slower than the CPU clock on high-speed MCUs. An STM32F4 running at 168 MHz requires 5 Flash wait states. This means an instruction fetch can stall the pipeline for up to 5 cycles if the prefetch buffer misses. The ART accelerator (Adaptive Real-Time) on STM32F4 mitigates this with a 64-bit wide, 8-line instruction cache and a branch predictor, achieving near-zero wait state performance for sequential code. Disabling the ART accelerator on an STM32F4 (a mistake sometimes made when porting startup code) cuts effective throughput roughly in half. The lesson: always configure Flash latency AND the cache/prefetch before jumping to your application.

Stack operation at the register level is mechanical. The MSP (Main Stack Pointer) and PSP (Process Stack Pointer) are the two hardware stack pointers on Cortex-M. In a bare-metal application, MSP is used exclusively. In an RTOS, each task uses PSP (pointing to task-private stack memory), while the kernel exception handlers use MSP (pointing to a separate interrupt stack). This separation means a task stack overflow cannot corrupt the kernel stack, but it DOES require each task to have its own correctly sized stack allocated in SRAM. Every additional task in FreeRTOS or Zephyr takes a fixed SRAM chunk. Forgetting to account for this is a classic cause of mysterious crashes when adding a new task.

Memory aliasing is a subtlety in Cortex-M that confuses engineers. On Cortex-M0 and M0+, the address range 0x00000000 to 0x1FFFFFFF can be aliased to either Flash or SRAM depending on the BOOT pins or SYSCFG register. When BOOT0 is high on STM32, address 0x00000000 maps to the system memory bootloader, not user Flash. When BOOT0 is low, it maps to user Flash at 0x08000000. This aliasing is why STM32 firmware must use absolute addresses (0x08000000) in the linker script, not the aliased base (0x00000000), or the flash programming tool will not write to the right location.

EEPROM endurance deserves a hardware-level note. Flash cells work by trapping charge on a floating gate (NOR Flash) or by Fowler-Nordheim tunneling (some EEPROM). Each erase cycle stresses the oxide layer. The spec endurance (e.g. 100,000 cycles for STM32 data Flash) is a statistical minimum at rated temperature. In practice, high-temperature environments degrade endurance faster. A configuration byte written once per power cycle in a device that cycles 10 times a day will exhaust a 100,000-cycle cell in 27 years. The same byte written 100 times per second will destroy the cell in 17 minutes. Always calculate write frequency against rated endurance before choosing a storage mechanism.

## Real-World Applications

### Automotive

Automotive ECUs (Engine Control Units) use Flash for calibration tables (fuel maps, ignition timing curves) and SRAM for real-time loop variables. Some designs use external SPI Flash for large lookup tables. EEPROM or Flash emulation stores learned adaptation values, such as idle trim offsets, that must survive power loss but change slowly. Memory protection (MPU) is often required by ISO 26262 ASIL-B and above to prevent stack overflow from corrupting safety-critical variables. Cortex-M7 devices (STM32H7) used in newer ECUs provide a tightly coupled memory (TCM) region for deterministic, zero-wait-state execution of the highest-priority control loops.

### Industrial

PLCs and motion controllers frequently need deterministic cycle times. Time-critical ISRs and motor control loops are placed in CCM (Core Coupled Memory) or DTCM on Cortex-M7, which operates at CPU clock speed with no wait states. Stack sizing is done by worst-case analysis (often with a stack painting technique) and verified during system qualification. Industrial devices also commonly use an external FRAM (Ferroelectric RAM) for non-volatile parameter storage, as FRAM has effectively unlimited write endurance and byte-level write granularity.

### Medical

Implantable and Class III medical devices require formal verification of memory layout. Stack and heap usage must be bounded and proven via static analysis tools such as PolySpace or PC-lint. Dynamic memory allocation is typically PROHIBITED after initialization per IEC 62304 guidance. Memory regions are often locked with the MPU to enforce read/write/execute permissions. Any access violation generating a HardFault must be handled deterministically rather than resetting the device, which could interrupt therapy delivery.

### Consumer Electronics / Iot

Bluetooth SoCs like the nRF52840 have multiple RAM banks that can be individually powered down to save energy. Memory layout must account for which RAM banks stay powered in different sleep modes, or volatile data will be lost unexpectedly. BLE softdevice (Nordic's pre-compiled protocol stack) reserves a fixed region of Flash and a fixed region of SRAM that the application linker script must NOT overlap. Getting those boundaries wrong is one of the most common nRF52 bring-up mistakes.

### Aerospace

RTCA DO-178C requires traceability from requirements to object code. That traceability includes memory layout: knowing exactly which address range holds each function, which data structure, and which constant table. Map files and linker script artifacts are part of the certification evidence. Scratchpad RAM and DMA buffers must be explicitly defined, not left to the linker's default placement, to satisfy the structural coverage requirements.

## Common Mistakes

**Stack Overflow Without Detection** — An undersized stack grows into the .bss or .data region. The CPU overwrites your global variables with stack frames. Behavior becomes unpredictable but no fault fires on Cortex-M0. Avoid it by using stack painting (fill stack with a known pattern at startup and check the watermark at runtime), configuring the MPU stack limit register on Cortex-M33, and performing worst-case stack analysis.

**Forgetting to Configure Flash Wait States** — On STM32F4/F7/H7, the default Flash wait state after reset is 0. If you boost the CPU clock without setting the correct wait state, Flash reads return garbage. Code that worked at 16 MHz (HSI reset clock) crashes at 168 MHz because startup code raised the PLL before the Flash latency was set. ALWAYS set Flash latency before raising the clock frequency.

**Treating Peripheral Registers As Regular Memory** — Omitting volatile on a pointer to a peripheral register allows the compiler to cache the read in a register and never re-read it. A status flag poll becomes an infinite loop or a never-entered branch. Use the vendor CMSIS headers which declare all peripheral structs with the correct volatile qualifiers.

**Linker Script Region Sizes Not Matching Hardware** — A copied or generic linker script with wrong Flash or RAM sizes will allow the linker to place data past the end of physical memory. The device will appear to work until code accesses the out-of-range addresses and hits unmapped memory, causing a bus fault. Always verify MEMORY region definitions against the MCU's datasheet on every new bring-up.

**Writing to Flash Eeprom Emulation Too Frequently** — Using Flash EEPROM emulation to store a counter that increments on every iteration of the main loop will burn through erase cycles within hours. Buffer the value in SRAM and flush periodically or on a defined trigger event.

**Stack and Heap Overlap** — In a linker script that does not explicitly limit heap size, malloc can allocate into the stack region. The standard newlib sbrk() will happily hand out memory past the end of RAM. Define a HEAP_SIZE symbol in the linker script and add an assertion in sbrk() that raises a fault when the heap limit is reached.

**Placing Large Buffers on the Stack** — A function declares a uint8_t buf[4096] as a local variable. That 4 KB lands on the stack. On a device with 8 KB total SRAM, that single local variable consumes half the SRAM and likely overflows the stack. Declare large buffers as static or global, or allocate them once at startup.

**Assuming .bss Is Zero Without Startup Code** — When a debugger is used to load code without a full reset, or when the startup file is missing, .bss may contain non-zero garbage. Code that relies on zero-initialized globals without verifying that the startup sequence ran will fail intermittently depending on prior SRAM contents.

## Debugging and Troubleshooting

**Symptom:** Device hard-faults or locks up shortly after startup, but only when certain functions are called.

**Possible Cause:** Stack overflow. The stack has grown into .bss or .data, corrupting critical runtime state.

**Investigation Method:** Enable stack painting in startup code (fill stack region with 0xDEADBEEF). After the fault, inspect SRAM in the debugger and look for where the pattern is overwritten. Check SP register value in the fault handler against the bottom of the allocated stack region.

**Resolution:** Increase stack size in the linker script or reduce stack usage by moving large local arrays to static scope.

**Symptom:** Global variable always reads zero even though it is initialized to a non-zero value.

**Possible Cause:** .data section initialization is not running. Startup code is missing or the linker script symbols (_sdata, _edata, _sidata) are wrong.

**Investigation Method:** Set a breakpoint at the first line of the reset handler. Single-step through the startup copy loop. Verify the source (Flash LMA) and destination (SRAM VMA) addresses match what the map file reports for .data.

**Resolution:** Fix the linker script MEMORY definitions or the startup copy loop symbols. Ensure startup code is not being bypassed by a debugger that loads code without executing reset.

**Symptom:** Peripheral never responds; a status register poll loops forever.

**Possible Cause:** Compiler has optimized out the register read. The variable holding the register value is cached in a CPU register and never re-fetched from the peripheral address.

**Investigation Method:** Inspect the generated assembly. Look for a LDR instruction inside the polling loop. If the LDR is outside the loop, volatile is missing. Alternatively, check that you are using the CMSIS vendor header and not a hand-rolled struct without volatile.

**Resolution:** Use the vendor CMSIS header definitions. If defining your own peripheral struct, every member that maps to a hardware register must be declared volatile.

**Symptom:** Application works in debug build but fails in release build, or works at low clock speed but fails at high clock speed.

**Possible Cause:** Flash wait states not configured for the operating frequency. At 16 MHz (reset default), 0 wait states are fine. At 168 MHz, 5 wait states are required for 3.3 V operation on STM32F4. Without the correct latency, the CPU fetches stale or wrong data from Flash.

**Investigation Method:** Check the FLASH_ACR register value after clock configuration. Verify LATENCY bits match the table in the reference manual for the operating voltage and frequency. Compare the SystemCoreClock value against the configured PLL output.

**Resolution:** Set Flash latency BEFORE increasing the PLL frequency. Follow the clock configuration sequence in the reference manual exactly.

## Design Considerations and Best Practices

1. **Always Verify Your Linker Script Against the Hardware Datasheet.** Copied linker scripts are one of the most dangerous things in embedded development. They compile silently with wrong sizes, wrong base addresses, or wrong section placements. The first task on any new MCU bring-up is to cross-reference every MEMORY region in the .ld file against the datasheet's memory map table. This takes ten minutes and prevents days of debugging.

2. **Size Your Stack with Margin and Then Add More.** Calculate the worst-case call chain depth, add up the stack frames (local variables + saved registers + return address per frame), multiply by 1.5 for interrupt overhead, and add 256 bytes minimum safety margin. Interrupts nest on their own stack frame ON TOP OF whatever the current stack depth is. An interrupt that fires at the deepest point of your call tree defines your actual worst case.

3. **Avoid Dynamic Allocation After Initialization in Safety-Critical Code.** After the system is initialized, every call to malloc introduces fragmentation and nondeterministic execution time. Prefer statically allocated pools or fixed-size block allocators. If you must use dynamic allocation, do all of it in the initialization phase and never free and reallocate in the steady state. This constraint is enforced by MISRA C Rule 21.3.

4. **Use the Mpu to Enforce Memory Region Boundaries.** Cortex-M3 and higher include an optional Memory Protection Unit. Configure it to mark the stack guard region (the lowest addresses of the stack) as no-access. A stack overflow will then generate a MemManage fault instead of silent corruption. Similarly, mark Flash as read-only and execute-never for SRAM to prevent code injection attacks and catch errant function pointer bugs.

5. PUT FREQUENTLY ACCESSED CONSTANTS IN FLASH, NOT RAM. Large lookup tables (sine tables, CRC tables, font data) should be declared const and placed in Flash. This keeps SRAM free for runtime data. On Cortex-M, const data in Flash is directly addressable through the D-Code bus. The only cost is Flash read latency, which the prefetch cache mitigates for sequential access patterns.

6. **Plan Non-Volatile Storage Write Frequency Before Choosing a Mechanism.** Calculate the worst-case write rate for each piece of non-volatile data. Compare against the rated endurance of your chosen storage. If a config value changes more than a few times per minute, consider FRAM, battery-backed SRAM, or a wear-leveling layer. Document the write frequency assumption in the design so it can be verified during system test.

7. **Separate Interrupt Stacks From Task Stacks When Using an Rtos.** In FreeRTOS on Cortex-M, interrupts use MSP (the main stack), while tasks use PSP (process stack). The MSP stack is set in the linker script and must be sized for the worst-case interrupt nesting depth across all ISRs, not for the application logic. Failing to account for this causes the interrupt stack to overflow into the heap or data sections while the application stacks appear healthy.

8. **Include a Memory Utilization Report in Your Build Process.** The linker map file contains exact sizes for every section. Write a build step that parses the map file and reports Flash usage, SRAM usage, stack allocation, and heap allocation as a percentage of available memory. Fail the build if utilization exceeds 90%. This makes memory pressure visible in CI before it becomes a production problem.

## Expert Notes

VOLATILE DOES NOT MEAN ATOMIC. A common misconception is that declaring a variable volatile makes concurrent access safe. Volatile only tells the compiler to reload the variable from memory on every access. It says nothing about atomicity. On a 32-bit Cortex-M, reading or writing a 32-bit aligned variable is atomic because it completes in a single bus transaction. But reading a 64-bit value, or a 32-bit value on a non-aligned address, is NOT atomic and can be torn by an interrupt. Use proper critical sections or stdatomic.h for shared data between ISRs and tasks.

THE MAP FILE IS ONE OF THE MOST USEFUL DEBUGGING TOOLS YOU HAVE. When something goes wrong with memory, the first thing experienced engineers open is the .map file. It shows the exact address and size of every symbol, every section, and every object file's contribution. When two global variables seem to interfere with each other, a quick check of the map file will reveal if they are suspiciously close in memory. Junior engineers frequently do not know this file exists. Get comfortable reading it early.

CCMRAM AND DTCM DO NOT BEHAVE LIKE REGULAR SRAM FOR DMA. On STM32F4, the 64 KB CCM (Core Coupled Memory) at 0x10000000 is connected only to the D-bus of the CPU, bypassing the AHB bus matrix. This makes it ideal for stacks and RTOS kernel data (zero wait states, no bus contention), but DMA controllers on STM32F4 CANNOT access CCM. Placing a DMA buffer in CCM will silently transfer nothing and is a particularly frustrating bug to track down. Always check which bus master can access which RAM bank.

STACK USAGE IN C IS NOT JUST YOUR LOCAL VARIABLES. Every function call pushes at minimum a return address onto the stack. The Cortex-M hardware automatically pushes 8 registers (xPSR, PC, LR, R12, R3, R2, R1, R0) onto the stack on interrupt entry before your handler even begins. If your ISR then calls a function, more registers are pushed. If the ISR is preempted by a higher priority interrupt, the whole thing happens again. Deep interrupt nesting in a system with many ISR levels can create stack usage that is dramatically larger than the sum of all local variables would suggest.

WHAT THE STARTUP FILE DOES IS AS IMPORTANT AS YOUR MAIN FUNCTION. Most junior engineers think startup.s or startup_stm32.c is boilerplate they do not need to understand. In reality, it sets the initial stack pointer, configures the FPU (enabling lazy stacking if present), copies .data, zeroes .bss, and calls any pre-main constructors before reaching main(). If any of that is wrong, every subsequent assumption about your program's state is invalid. Read your startup file once, understand every line, and never replace it with an unreviewed copy from a forum post.

## Summary

Memory architecture is not a topic you learn once and then take for granted. It is an active constraint that shapes every firmware decision. The placement of code in Flash, variables in SRAM, and parameters in non-volatile storage is not automatic. It is the result of a linker script that you, or someone on your team, configured deliberately, and that must match the hardware memory map of the specific device. When it does not, the firmware will appear to build correctly and fail at runtime in ways that are difficult to diagnose without understanding the underlying layout.

The stack and heap are not abstract concepts. They are specific regions of physical SRAM with fixed base addresses, fixed sizes, and no hardware protection by default. The stack grows downward from the top of SRAM. The heap grows upward from the top of .bss. They are converging toward each other constantly during runtime. Understanding this is the difference between an engineer who debugs stack corruption in an hour and one who spends a week replacing unrelated code looking for the bug.

Non-volatile storage choices have long-term hardware consequences. Flash EEPROM emulation, EEPROM cells, and FRAM each have different endurance characteristics, write granularities, and performance profiles. The choice made at design time, combined with how frequently the application writes to that storage, determines whether the hardware lasts 30 years or destroys itself in the first week of production testing.

The mental model to retain is this: a microcontroller's memory is a flat address space divided into fixed regions. Flash holds code and constants permanently. SRAM holds runtime state temporarily, subdivided into static data, dynamic heap, and the descending stack. Peripherals appear as addresses in the same space. The linker script is the contract that binds your source code to this physical reality. Every production firmware failure related to memory can be traced back to a violation of this model, whether from a wrong linker script, an undersized stack, an overwritten peripheral register, or a misconfigured clock that makes Flash reads unreliable.

## Related Topics

Prerequisites: - MCU Boot Sequence (reset vector, vector table structure, boot modes) - C Storage Classes (auto, static, extern, volatile, const) - Basic ARM Cortex-M Architecture Overview

Next Topics: - CPU Execution Model (pipeline, exception model, privilege levels) - Linker Scripts In Depth (MEMORY, SECTIONS, LMA vs VMA, symbol exports) - Startup Code and C Runtime Initialization - MPU Configuration for Memory Protection - RTOS Memory Management and Stack Sizing
