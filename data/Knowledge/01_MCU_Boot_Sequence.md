---
id: mcu-boot-seq
title: MCU Boot Sequence What Really Happens Before main()
brief: What the processor does after reset before main() -- vector table, Reset Handler, .data copy, and .bss zeroing.
tags: [Startup, Cortex-M, Linker, Reset]
---

# MCU Boot Sequence: What Really Happens Before main()

You write your firmware, flash it to the board, and hit reset. A fraction of a second later, your code is running. But have you ever stopped to ask what actually happened in that fraction of a second? Between the moment voltage was applied and the first line of your main() function executing, a surprisingly complex sequence of events took place -- events that, if they go wrong, will leave you staring at a blank debug terminal with no idea where to start.

Here is a scenario that trips up junior engineers constantly: you initialize a global variable at declaration, like `uint32_t counter = 10;`, and then find that it reads as zero at runtime. Or you set up a lookup table as a const array in flash, but your code crashes when it tries to read it. Or your RTOS starts, but the heap is corrupted from the very first allocation. In every one of these cases, the root cause is not in your application code at all -- it is in the startup sequence, or rather in a misunderstanding of what the startup sequence does and why it must do it.

The MCU boot sequence is the bridge between raw silicon coming out of reset and a running C program. C makes certain guarantees to the programmer: global variables with initializers have their values, zero-initialized globals are actually zero, the stack pointer is valid before any function is called. None of these guarantees come for free. Something has to set them up. On a desktop computer, the operating system and runtime loader handle all of this transparently. On a bare-metal microcontroller, your startup code is responsible, and if it is wrong or missing, your program starts in an undefined state.

Understanding the boot sequence also gives you practical power. You will know why your linker script looks the way it does, why ARM Cortex-M has a vector table, what the reset handler does and why you should not modify it carelessly, and what happens when you enable a hardware debugger and it halts the core right after reset. This knowledge separates engineers who can bring up new hardware from those who are stuck waiting for someone else to debug the startup code.

By the end of this article, you will understand the complete sequence of events from MCU reset to the first instruction of main(), including the role of the vector table, stack initialization, the reset handler, the copying and zeroing of data sections, and how the linker script connects all of it together.

## The Fundamental Problem

The core problem is this: C assumes a runtime environment that does not exist on bare hardware. The C standard says that objects with static storage duration -- global variables, static local variables -- are initialized before program startup. Zero-initialized ones are set to zero. Explicitly initialized ones get their specified value. This is not optional. It is part of the language specification. But the hardware coming out of reset does not know anything about C. The CPU just starts fetching and executing instructions from a defined address. RAM contains whatever was there before power was applied, which is effectively random data. Nothing is set up.

The obvious approach -- just compile your code and run it -- fails for several reasons. First, the stack pointer register may be pointing at an arbitrary address. The very first function call or interrupt that occurs before the stack is set up will corrupt memory or cause a fault. Second, initialized global variables live in RAM at runtime but their initial values must be stored somewhere non-volatile -- in flash. Without something explicitly copying those values from flash to RAM, the variables contain garbage. Third, uninitialized globals and BSS-section variables are supposed to contain zero. Flash memory is typically erased to 0xFF, so any leftover flash-initialized RAM would be 0xFF, not zero, if nothing explicitly zeroes it.

There is also a processor-level problem. ARM Cortex-M processors do not boot by jumping to a single fixed address and expecting a flat binary. They boot by reading a vector table at the base of flash, extracting the initial stack pointer value from the first word, and then jumping to the reset handler address stored in the second word. If your linker script does not place the vector table at the exact address the hardware expects, or if the vector table entries are malformed, the CPU will either fetch a nonsensical stack pointer or branch to a garbage address, and your device will hard fault before executing a single line of your code.

These problems are not theoretical. Every embedded project that has ever run C code on bare metal had to solve them. The solution is the startup sequence: a small piece of carefully written assembly or C code that runs before main() and sets up the minimum environment the C runtime requires.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/mcu_boot_flow.svg" alt="MCU Boot Sequence Flow Diagram" loading="lazy">
</div>

The boot sequence can be viewed as a handoff pipeline. The hardware handles the earliest stages automatically -- applying power, releasing reset, reading the vector table. Then control passes to a software stage, the reset handler, which is responsible for configuring the C runtime environment. Only after that environment is validated does control pass to main().

The architectural position of the boot sequence is at the absolute bottom of your firmware stack, below the HAL, below the RTOS, below your application. It interacts directly with the CPU's reset mechanism, the linker script's memory map, and the physical layout of flash and RAM. Every other layer in your system depends on it having run correctly.

```
POWER ON / RESET ASSERT
       |
       v
+-------------------------------+
| Hardware Reset                |
| - Internal RC oscillator      |
| - Core registers cleared      |
| - Peripherals reset           |
+-------------------------------+
       |
       v
+-------------------------------+
| Vector Table Fetch            |
| Word 0: Initial Stack Pointer |
| Word 1: Reset Handler Address |
+-------------------------------+
       |
       v
+-------------------------------+
| Reset Handler (Software)      |
| - Copy .data from flash->RAM  |
| - Zero .bss section in RAM    |
| - Optional: SystemInit()      |
| - Optional: FPU enable        |
+-------------------------------+
       |
       v
+-------------------------------+
| C Runtime Init (if used)      |
| - __libc_init_array()         |
| - C++ constructors (if used)  |
+-------------------------------+
       |
       v
+-------------------------------+
|         main()                |
+-------------------------------+
```

The linker script is the invisible thread connecting these boxes. It defines where .data lives in flash vs. RAM, where .bss sits in RAM, and where the vector table is placed at the base of flash. The reset handler uses symbols generated by the linker script to know the source and destination addresses for its copy and zero loops.

## Key Concepts and Terminology

**Reset Vector** -- The address stored at offset 0x04 in the vector table on ARM Cortex-M devices. When the CPU comes out of reset, it reads this address and branches to it, making it the true entry point of your firmware. The reset vector points to your reset handler function.

**Vector Table** -- A table of function pointers stored at the base of flash (address 0x08000000 on STM32 devices by default). The first word is not a function pointer but the initial stack pointer value. Subsequent words are addresses of exception and interrupt handlers. The hardware reads this table on reset and also during exception handling.

**Reset Handler** -- The function that executes immediately after the CPU reads the reset vector and branches. It is typically written in C or assembly in your startup file (startup_stm32xxxx.s or similar). It is responsible for all pre-main() initialization. You should treat it as sacred -- do not add arbitrary code here without understanding the consequences.

**Linker Script** -- A text file (.ld extension in GCC toolchains) that tells the linker how to arrange code and data in memory. It defines memory regions (FLASH, RAM, CCMRAM, etc.), assigns sections to those regions, and exports symbols that the startup code uses to locate and size .data and .bss. Everything about your memory layout flows from this file.

**.data Section** -- The ELF section containing initialized global and static variables. At link time, the linker places both a load address (LMA -- where it lives in flash) and a virtual address (VMA -- where the CPU expects it at runtime in RAM). The startup code copies from LMA to VMA during initialization.

**.bss Section** -- The ELF section containing zero-initialized global and static variables. Unlike .data, no actual bytes need to be stored in flash for .bss, since the startup code just zeroes the region in RAM. The linker exports `_bss_start` and `_bss_end` (or similar) so the startup code knows the range to zero.

**Load Address (LMA) vs. Virtual Address (VMA)** -- The LMA is where a section is physically stored in flash. The VMA is the address the code uses to access it at runtime. For .text (code), LMA equals VMA. For .data, the LMA is in flash (where values are preserved across power cycles) but the VMA is in RAM (where the CPU can write to them). The startup code bridges this gap.

**Stack Pointer Initialization** -- The first word of the vector table holds the initial value for the Main Stack Pointer (MSP) register on Cortex-M. This value is loaded into SP before the reset handler is called, which is why function calls work immediately in the reset handler without explicit assembly setup.

**SystemClock_Config / SystemInit** -- A function commonly called early in the reset handler to configure the MCU's clock tree. On STM32 devices, this function switches from the low-speed internal RC oscillator (the reset default) to the desired clock source. Peripheral initialization depends on stable clocks, so this runs before main().

**ELF Sections** -- The building blocks of the compiled binary. `.text` contains executable code, `.rodata` contains read-only data (constants, string literals), `.data` contains initialized variables, `.bss` contains zero-initialized variables. The linker script arranges these sections into your physical memory map.

## How It Works

### Step 1: The Hardware Releases Reset

When power is applied or NRST is deasserted, the Cortex-M core performs its own internal reset sequence. The program counter and most general-purpose registers are cleared or set to defined reset values. The processor enters Thread mode with privileged access. Importantly, the hardware automatically reads the first two words from the address pointed to by the VTOR (Vector Table Offset Register), which defaults to 0x00000000 (mapped to 0x08000000 on most STM32 parts via the boot pins). The value at word 0 is loaded directly into the Main Stack Pointer register. The value at word 1 is the reset vector address and is loaded into the PC. This all happens in hardware, before any instruction you wrote is executed.

### Step 2: Execution Enters the Reset Handler

The CPU branches to the address it just loaded into PC from the reset vector. This is your Reset_Handler function. On ARM Cortex-M, because the SP was already loaded from the vector table, you have a valid stack immediately. The reset handler is the first software that runs. It is typically found in a file like `startup_stm32f4xx.s` (for STM32F4) or `startup_ARMCM4.s`. At this point, the clock is running on the internal RC oscillator, peripherals are in their reset state, and RAM contains whatever garbage was there before. The reset handler's job is to fix the state of RAM before anything else touches it.

### Step 3: Copy .data From Flash to RAM

The reset handler reads three linker-exported symbols: `_sidata` (the LMA start of .data in flash), `_sdata` (the VMA start of .data in RAM), and `_edata` (the VMA end of .data in RAM). It then runs a simple copy loop, reading 32-bit words from flash starting at `_sidata` and writing them to RAM starting at `_sdata`, until it reaches `_edata`. After this loop, every initialized global variable in your program has its correct initial value. Without this step, `uint32_t timeout = 5000;` would contain unpredictable garbage.

### Step 4: Zero the .bss Section in RAM

The reset handler reads two more linker symbols: `_sbss` and `_ebss`, which bracket the .bss section in RAM. It writes zero to every address in this range. This is what guarantees that `uint32_t error_count;` (declared without an initializer) equals zero when main() starts. This step is not optional under the C standard. If your startup code skips it or gets the symbols wrong, you will see intermittent initialization failures that depend on what happened to be in RAM before reset.

### Step 5: Optional Hardware and Clock Initialization

Many startup files call `SystemInit()` at this point, before main(). On Cortex-M4 and Cortex-M7 devices, this is also where the FPU is enabled by writing to the CPACR register -- if you use floating-point and this step is skipped, your code will immediately take a UsageFault the first time a floating-point instruction executes. Clock configuration may happen here or may be deferred to `SystemClock_Config()` inside main(). The key constraint is that nothing requiring a specific clock speed (UART baud rates, SPI timing, timer frequencies) should be called before this runs.

### Step 6: C++ Constructors and Init Arrays

If your project uses C++ or has functions registered with GCC's `__attribute__((constructor))`, the startup code calls `__libc_init_array()`. This function iterates over function pointers stored in the `.init_array` and `.preinit_array` sections and calls each one. In practice, this is where global C++ objects get their constructors called. For pure C firmware, this step is a no-op, but it still needs to be present if you link against newlib.

### Step 7: Branch to main()

The last instruction of the reset handler is a branch to main(). On GCC-based toolchains this is simply `bl main`. From this point, your application code takes over. If main() ever returns (which it should not on most bare-metal systems), the reset handler typically traps in an infinite loop to prevent undefined behavior.

## Under the Hood

At the register level, the Cortex-M reset sequence is defined precisely in the ARM Architecture Reference Manual. After reset, the PRIMASK, FAULTMASK, BASEPRI, and CONTROL registers are all at their reset values, placing the processor in Thread mode with the Main Stack Pointer active and privileged access enabled. The VTOR register defaults to 0x00000000. The very first memory transaction the CPU performs is a 32-bit read from 0x00000000 to load SP_main, followed immediately by a 32-bit read from 0x00000004 to load the PC. On ARM Cortex-M, function pointers stored in the vector table must have their LSB set to 1 to indicate Thumb mode. If your linker or startup file forgets to OR the reset handler address with 1, you will take an immediate hard fault on entry.

The LMA/VMA distinction is implemented at the linker level using `AT()` syntax in the linker script. A typical section directive looks like this:

```
.data : AT(_sidata)
{
    _sdata = .;
    *(.data)
    *(.data*)
    _edata = .;
} >RAM
```

The `AT(_sidata)` tells the linker to place the section's physical bytes (the LMA) starting at `_sidata`, which is positioned after .text and .rodata in flash. But the addresses used within the section (the VMA) are those of the RAM region. The linker resolves all .data variable addresses to RAM addresses, which is why your C code can write to them. But the actual bytes are in flash, and `_sidata` marks where they start.

The .bss section is handled differently. Because all values are zero, no bytes are stored in flash for .bss at all. The linker script simply marks the start and end symbols, and the startup code zeroes the RAM range at runtime. This is why adding large arrays of zeros to your global scope costs you nothing in flash size but does cost RAM.

On STM32 devices, the internal SRAM is not guaranteed to be in any particular state after power-on. The ECC-protected TCM RAM on STM32H7 devices is especially interesting: it must be initialized before being read, or an ECC error fault will occur. This means the .bss zeroing pass is not just a C standard compliance issue on H7 devices -- it is a hardware requirement.

Interrupts are globally disabled from the hardware perspective immediately after reset. The startup sequence runs with interrupts effectively disabled until something explicitly enables them. This means even if your startup code triggers an exception, the only exception that will fire is HardFault, since the other configurable priority exceptions are not yet active.

## Real-World Applications

**Automotive (ECU / Body Control Modules):** AUTOSAR-compliant ECUs have strict requirements on startup time and memory initialization. The AUTOSAR OS and MemMap specifications mandate that all RAM sections be initialized before any RTE code runs. On AURIX TriCore processors used in automotive applications, the startup code must also initialize multiple independent memory banks, enable cache coherency, and handle dual-core startup synchronization.

**Industrial (PLCs / Motor Controllers):** In safety-critical industrial systems, the startup code is often subject to IEC 61508 SIL requirements. This means the .data copy and .bss zero loops may be followed by readback verification -- read back the RAM values and confirm they match expected data. Initialization faults at startup are considered dangerous failures in industrial motion control, since a corrupted variable could cause unintended motor movement.

**Medical (Infusion Pumps / Patient Monitors):** IEC 62304 Class C software requires that the startup sequence be tested and verified as part of software verification. Medical device firmware frequently adds a CRC check of the .text and .rodata sections during startup to detect flash corruption before execution proceeds. If the CRC fails, the device enters a safe state and displays an error rather than running with corrupted code.

**IoT / Consumer Devices:** On ultra-low-power devices like those using Nordic nRF52 or STM32L0 series MCUs, the startup sequence intersects with the power management design. On wake from deep sleep, the startup sequence may run again, but RAM may have been retained. The startup code must distinguish between a cold boot (RAM is garbage, full initialization needed) and a warm wake (RAM is valid, skip initialization to save time and power). This is often done by storing a magic number in a dedicated RAM region that survives sleep, checked at the top of the reset handler.

**Aerospace:** On DO-178C Level A software, every line of the startup sequence must be traceable to a requirement and verified by test. The startup code is often hand-written assembly for the most critical sections, specifically to avoid compiler optimizations that might reorder or omit initialization steps.

## Common Mistakes

**Wrong vector table address --** The linker script places the vector table at an address that does not match the CPU's boot address. The result is that the hardware reads garbage for the stack pointer and reset vector, and the device never starts. Verify that the ORIGIN of FLASH in your linker script matches the physical boot address for your part and boot pin configuration.

**Stack pointer value exceeds RAM --** The initial stack pointer in the vector table points past the top of RAM. All seems fine until the stack grows deep enough to hit the actual RAM limit, at which point you get silent memory corruption or a hard fault. Always verify that the top-of-stack address matches your part's actual RAM size.

**Modifying initialized globals before .data is copied --** Calling any function that accesses a global variable before the .data copy loop completes results in reading garbage. This happens when engineers add peripheral initialization calls to the reset handler before the standard initialization sequence. The C runtime must be set up first.

**Missing or wrong BSS symbols --** If the linker script uses different symbol names than the startup code expects (for example, the script exports `__bss_start` but the startup code looks for `_sbss`), the .bss region is not zeroed. The bug is intermittent because RAM sometimes happens to be zero from a previous run, masking the fault.

**Forgetting FPU enable on Cortex-M4/M7 --** Using floating-point operations before enabling the FPU via CPACR causes a UsageFault. Check `SystemInit()` for CPACR configuration when bringing up M4/M7 devices.

**Assuming main() will never return --** Most startup files trap in an infinite loop if main() returns. But some stripped-down startup files omit this, and returning from main() on bare metal lands in a random instruction stream. Always verify your reset handler has a post-main() trap.

**Corrupting the vector table with DMA --** On devices where DMA is started early in startup, a misconfigured DMA transfer can overwrite the vector table in RAM. Validate DMA destination addresses and enable the MPU to protect the vector table region.

## Debugging and Troubleshooting

**Symptom:** Device appears to boot but immediately hard faults before any application code runs.
**Possible Cause:** Invalid reset vector or stack pointer in the vector table. The LSB of the reset handler address may be 0 (ARM mode instead of Thumb mode on Cortex-M).
**Investigation:** Attach a debugger and halt immediately after reset. Inspect the PC and SP registers. Read the raw bytes at address 0x08000000 and verify word 0 is a valid top-of-RAM address and word 1 is your reset handler address with LSB set.
**Resolution:** Verify the vector table section placement in your linker script. Ensure the vector table is declared with the correct GCC attribute and section name.

**Symptom:** Initialized global variables contain zero or garbage instead of their declared initial values.
**Possible Cause:** The .data copy loop in the reset handler is not executing, or the linker-exported symbols `_sidata`/`_sdata`/`_edata` are wrong.
**Investigation:** Set a breakpoint at the first line of main(). Inspect the global variable. Then step back to the reset handler and single-step through the .data copy loop, watching the destination RAM addresses being written.
**Resolution:** Check that `_sidata` in the linker script is positioned correctly after .rodata in flash, and that `_sdata` and `_edata` bracket the .data section in RAM.

**Symptom:** Global variables that should be zero at startup are non-zero.
**Possible Cause:** .bss section is not being zeroed. The startup code may have symbol name mismatches or the zero loop may not be executing.
**Investigation:** Halt immediately after the .bss zero loop. Read the contents of the .bss region from RAM in the debugger. Print `_sbss` and `_ebss` values from the startup code.
**Resolution:** Verify symbol names match between linker script and startup file.

**Symptom:** Firmware works perfectly on the bench but fails on production boards after factory programming.
**Possible Cause:** The factory programmer is writing the binary at a slightly wrong flash offset, or option bytes controlling boot pin behavior differ between bench and production boards.
**Investigation:** Read back the first 32 bytes of flash from a failing production unit and compare byte-by-byte with a known-good bench unit. Verify option byte settings.
**Resolution:** Lock down the option byte configuration in production programming scripts.

## Design Considerations and Best Practices

**Never modify the vendor startup file directly.** Copy it into your project and modify the copy. Vendor-provided startup files are overwritten by SDK updates. Keeping your startup file under version control as a project-owned file ensures your initialization sequence is stable and auditable.

**Validate linker script symbols with an assertion.** In debug builds, add a compile-time or runtime check that `_edata` minus `_sdata` equals the expected .data section size. Section size drift is normal, but it is good practice to confirm the symbols resolve to non-null, non-overlapping regions on each new build target.

**Make the startup sequence clock-agnostic.** The .data copy and .bss zero loops should not depend on a configured clock. They run on the reset default oscillator and must work at whatever frequency the hardware provides after reset.

**Protect the vector table with the MPU.** On Cortex-M3 and above, configure the MPU to make the vector table region read-only from unprivileged code. This prevents a runaway DMA or software bug from overwriting your interrupt vectors.

**Add a flash integrity check in production firmware.** Calculate a CRC32 over your .text and .rodata regions during startup and compare it against a stored reference value. On STM32 devices, the hardware CRC unit makes this fast enough to add negligible startup latency.

**Document your startup time budget.** Measure the time from reset deassertion to the first instruction of main() and track it as a metric. Unexplained increases in startup time are often the first sign that the .data section has grown unexpectedly.

**Handle warm wake from sleep explicitly.** If your device uses RAM-retention sleep modes, implement a sentinel value in a `noinit`-attributed RAM section and check it at the top of the reset handler to branch between cold boot and fast wake paths.

**Keep the reset handler short and deterministic.** The reset handler is not the place for complex hardware bringup logic. Anything that can fail or block belongs in main(), where you have proper error handling infrastructure.

## Expert Notes

**The vector table Thumb bit is a constant source of confusion.** When you write the reset handler address into the vector table, the ARM architecture requires the LSB to be 1, indicating Thumb mode. The actual branch target is the address with LSB cleared. Most toolchains handle this automatically, but when you are manually constructing a vector table in C using an array of function pointers, you must ensure the compiler is generating the addresses with LSB set.

**The classic uninitialized BSS bug is hardware-dependent.** If you test your firmware only on devices that have been previously programmed (where RAM often happens to be zero from the last run), you will never see the uninitialized .bss bug. The bug only manifests on first power-on of a brand new device. This is why "it works on my desk but fails in the field" is a real phenomenon with this class of bug.

**C++ global constructors run before main() and can fail silently.** If a C++ global object's constructor allocates memory, opens a handle, or calls a function that can fail, and that failure is not caught, the firmware continues into main() in a degraded state. On bare metal there is no exception propagation, so a failed constructor is invisible unless you explicitly add error detection.

**Some linker scripts do not initialize .data in CCMRAM.** On STM32F4 devices, the CCMRAM region (64 KB of tightly coupled RAM accessible only by the CPU, not DMA) is a separate memory region. Vendor linker scripts sometimes provide a CCMRAM region but do not automatically copy initialized variables placed there during startup. Check your linker script carefully for which regions are covered by the initialization sequence.

**The stack grows down; your startup code sets the top.** The initial SP value in the vector table should be the TOP of the stack region -- the highest address plus four. A common mistake is pointing SP at the bottom of the stack region, so the stack immediately grows into whatever is below it.

## Summary

The MCU boot sequence is a precisely ordered set of hardware and software operations that transforms a CPU coming out of reset into an environment where C code can run correctly. The hardware takes the first step automatically, reading the vector table to establish the initial stack pointer and branch to the reset handler. From that point forward, software is responsible for copying initialized data from flash to RAM, zeroing the BSS region, and performing any mandatory hardware setup before main() is called.

The linker script is the foundation on which all of this rests. It defines where each section lives in physical memory, ensures the vector table lands at the correct boot address, and exports the symbols that the startup code uses to locate and size the .data and .bss regions. Understanding your linker script is not optional -- it is the map that tells you why your firmware is laid out the way it is.

Bugs in the startup sequence are among the most disorienting to debug precisely because they do not look like startup bugs. They look like corrupted variables, wrong initial values, or intermittent faults in application code. The key diagnostic insight is to always look upstream: if a global variable is wrong at the start of main(), the problem is almost certainly in the startup sequence or the linker script, not in your application logic.

## Related Topics

**Prerequisites:**

- Basic C programming (variables, pointers, memory model)
- Binary number representation and hexadecimal notation
- Basic understanding of microcontroller architecture (Harvard vs. von Neumann)
- Familiarity with a GCC-based embedded toolchain (arm-none-eabi-gcc)

**Next Topics:**

- Memory Architecture: Flash, RAM, and address spaces in depth
- CPU Execution Model: Pipeline, fetch/decode/execute, the program counter
- Linker Scripts: Writing and understanding .ld files for embedded targets
- Interrupt and Exception Handling: Vector table in depth, NVIC configuration
- Stack and Heap Management: Stack overflow detection, heap allocators on bare metal
