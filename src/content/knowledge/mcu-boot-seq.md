---
title: "MCU Boot Sequence: What Happens Before main() Runs"
brief: "What a Cortex-M does between reset and main(): vector table, Reset_Handler, .data copy, .bss zeroing and early clock setup."
order: 1
phase: 1
tags: [Startup, Cortex-M, Linker, Reset]
---

You write your firmware, flash it to the board, and hit reset. A fraction of a second later, your code is running.

Here is a scenario that trips up junior engineers constantly: you initialize a global variable at declaration, like `uint32_t counter = 10;`, and then find that it reads as zero at runtime. Or you set up a lookup table as a const array in flash, but your code crashes when it tries to read it.

## The Fundamental Problem

The core problem is this: C assumes a runtime environment that does not exist on bare hardware. The C standard says that objects with static storage duration — global variables, static local variables — are initialized before program startup.

The obvious approach — just compile your code and run it — fails for several reasons. First, the stack pointer register may be pointing at an arbitrary address.

## The Big Picture

![MCU Boot Sequence Flow Diagram](/diagrams/mcu_boot_flow.svg)

The boot sequence can be viewed as a handoff pipeline. The hardware handles the earliest stages automatically — applying power, releasing reset, reading the vector table.

The architectural position of the boot sequence is at the absolute bottom of your firmware stack, below the HAL, below the RTOS, below your application. It interacts directly with the CPU's reset mechanism, the linker script's memory map, and the physical layout of flash and RAM.

## Key Concepts and Terminology

**Reset Vector** — The address stored at offset 0x04 in the vector table on ARM Cortex-M devices.

**Vector Table** — A table of function pointers stored at the base of flash (address 0x08000000 on STM32 devices by default).

**Reset Handler** — The function that executes immediately after the CPU reads the reset vector and branches.

**Linker Script** — A text file (.ld extension in GCC toolchains) that tells the linker how to arrange code and data in memory.

**.data Section** — The ELF section containing initialized global and static variables.

**.bss Section** — The ELF section containing zero-initialized global and static variables.

## How It Works

### Step 1: The Hardware Releases Reset

When power is applied or NRST is deasserted, the Cortex-M core performs its own internal reset sequence. The program counter and most general-purpose registers are cleared or set to defined reset values.

### Step 2: Execution Enters the Reset Handler

The CPU branches to the address it just loaded into PC from the reset vector. This is your Reset_Handler function.

### Step 3: Copy .data From Flash to RAM

The reset handler reads three linker-exported symbols: `_sidata` (the LMA start of .data in flash), `_sdata` (the VMA start of .data in RAM), and `_edata` (the VMA end of .data in RAM). It then runs a simple copy loop, reading 32-bit words from flash starting at `_sidata` and writing them to RAM starting at `_sdata`, until it reaches `_edata`.

### Step 4: Zero the .bss Section in RAM

The reset handler reads two more linker symbols: `_sbss` and `_ebss`, which bracket the .bss section in RAM. It writes zero to every address in this range.

### Step 5: Optional Hardware and Clock Initialization

Many startup files call `SystemInit()` at this point, before main(). On Cortex-M4 and Cortex-M7 devices, this is also where the FPU is enabled by writing to the CPACR register — if you use floating-point and this step is skipped, your code will immediately take a UsageFault the first time a floating-point instruction executes.

### Step 6: C++ Constructors and Init Arrays

If your project uses C++ or has functions registered with GCC's `__attribute__((constructor))`, the startup code calls `__libc_init_array()`. This function iterates over function pointers stored in the `.init_array` and `.preinit_array` sections and calls each one.

### Step 7: Branch to main()

The last instruction of the reset handler is a branch to main(). On GCC-based toolchains this is simply `bl main`.

## Under the Hood

At the register level, the Cortex-M reset sequence is defined precisely in the ARM Architecture Reference Manual. After reset, the PRIMASK, FAULTMASK, BASEPRI, and CONTROL registers are all at their reset values, placing the processor in Thread mode with the Main Stack Pointer active and privileged access enabled.

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

## Real-World Applications

**Automotive (ECU / Body Control Modules):** AUTOSAR-compliant ECUs have strict requirements on startup time and memory initialization. The AUTOSAR OS and MemMap specifications mandate that all RAM sections be initialized before any RTE code runs.

**Industrial (PLCs / Motor Controllers):** In safety-critical industrial systems, the startup code is often subject to IEC 61508 SIL requirements. This means the .data copy and .bss zero loops may be followed by readback verification — read back the RAM values and confirm they match expected data.

## Common Mistakes

**Wrong vector table address --** The linker script places the vector table at an address that does not match the CPU's boot address. The result is that the hardware reads garbage for the stack pointer and reset vector, and the device never starts. Verify that the ORIGIN of FLASH in your linker script matches the physical boot address for your part and boot pin configuration.

**Stack pointer value exceeds RAM --** The initial stack pointer in the vector table points past the top of RAM. All seems fine until the stack grows deep enough to hit the actual RAM limit, at which point you get silent memory corruption or a hard fault. Always verify that the top-of-stack address matches your part's actual RAM size.

**Modifying initialized globals before .data is copied --** Calling any function that accesses a global variable before the .data copy loop completes results in reading garbage. This happens when engineers add peripheral initialization calls to the reset handler before the standard initialization sequence. The C runtime must be set up first.

## Debugging and Troubleshooting

**Symptom:** Device appears to boot but immediately hard faults before any application code runs.
**Possible Cause:** Invalid reset vector or stack pointer in the vector table.

**Symptom:** Initialized global variables contain zero or garbage instead of their declared initial values.
**Possible Cause:** The .data copy loop in the reset handler is not executing, or the linker-exported symbols `_sidata`/`_sdata`/`_edata` are wrong.
**Investigation:** Set a breakpoint at the first line of main().

## Design Considerations and Best Practices

**Never modify the vendor startup file directly.** Copy it into your project and modify the copy. Vendor-provided startup files are overwritten by SDK updates.

**Validate linker script symbols with an assertion.** In debug builds, add a compile-time or runtime check that `_edata` minus `_sdata` equals the expected .data section size. Section size drift is normal, but it is good practice to confirm the symbols resolve to non-null, non-overlapping regions on each new build target.

## Expert Notes

**The vector table Thumb bit is a constant source of confusion.** When you write the reset handler address into the vector table, the ARM architecture requires the LSB to be 1, indicating Thumb mode. The actual branch target is the address with LSB cleared.

**The classic uninitialized BSS bug is hardware-dependent.** If you test your firmware only on devices that have been previously programmed (where RAM often happens to be zero from the last run), you will never see the uninitialized .bss bug. The bug only manifests on first power-on of a brand new device.

## Summary

The MCU boot sequence is a precisely ordered set of hardware and software operations that transforms a CPU coming out of reset into an environment where C code can run correctly. The hardware takes the first step automatically, reading the vector table to establish the initial stack pointer and branch to the reset handler. From that point forward, software is responsible for copying initialized data from flash to RAM, zeroing the BSS region, and performing any mandatory hardware setup before main() is called.

The linker script is the foundation on which all of this rests. It defines where each section lives in physical memory, ensures the vector table lands at the correct boot address, and exports the symbols that the startup code uses to locate and size the .data and .bss regions. Understanding your linker script is not optional — it is the map that tells you why your firmware is laid out the way it is.

## Related Topics

**Prerequisites:**

- CPU Execution Model (Harvard vs. von Neumann)
- Cross-Compilation and Toolchains (arm-none-eabi-gcc)

**Next Topics:**

- Memory Architecture: Flash, RAM, and address spaces in depth
- Linker Scripts Explained: Writing and understanding .ld files for embedded targets
- Interrupts: Vector table in depth, NVIC configuration
