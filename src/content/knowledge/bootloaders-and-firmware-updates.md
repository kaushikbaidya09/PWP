---
title: "Bootloaders and Firmware Updates: Replacing Firmware Safely"
brief: "Bootloader design and safe field updates: dual-bank flash, image verification, rollback protection and OTA delivery."
order: 25
phase: 6
tags: ["Bootloader", "OTA", "Flash", "Firmware"]
---

Imagine you have shipped 10,000 IoT sensors to industrial sites across three continents. Three months later, your team discovers a critical bug in the sensor calibration logic.

A bootloader is a small, resident piece of firmware that runs before your main application. Its job is to decide what code runs next and, critically, to provide a mechanism for replacing that code without external programming hardware.

## The Fundamental Problem

The core problem is simple to state and surprisingly hard to solve: you need to replace the code that is currently running without interrupting the running system permanently, and you need to do it safely even when the process can be interrupted at any point (power loss, network dropout, cosmic ray, user impatience). Flash memory is not like RAM.

The naive approach fails immediately: if you simply erase your running application from flash and write a new one in place, you have a window where the flash contains neither a valid old image nor a valid new image. Any reset during that window bricks the device.

## The Big Picture

![Bootloader Flash Layout and Update Flow](/diagrams/bootloader_flash.svg)

At the system level, the bootloader is the first user code to execute after the hardware initialization sequence. On a Cortex-M device, after power-on reset, the CPU hardware reads the initial stack pointer from address 0x00000000 and the reset handler address from 0x00000004.

The bootloader's architectural role is that of a gatekeeper and dispatcher. It runs briefly at every reset, performs its checks, and then either hands control to the application or enters update mode.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Bootloader** | A small, resident firmware image that executes before the main application. |
| **Application Vector Table** | A table of function pointers located at the start of each firmware image. |
| **Flash Slot / Image Slot** | A reserved, contiguous region of flash memory designated to hold one firmware image. |
| **Firmware Metadata / Image Header** | A structured block of data prepended to each firmware image containing the image size, version number, CRC or hash value, target hardware identifier, and flags. |
| **CRC (Cyclic Redundancy Check)** | A mathematical checksum computed over the firmware image bytes. |
| **Secure Boot** | A chain-of-trust mechanism where each stage of the boot process cryptographically verifies the next stage before executing it. |

## How It Works

### Step 1 - Power-on Reset and Bootloader Entry

When the MCU powers on or resets, the Cortex-M CPU hardware loads the stack pointer from address 0x00000000 and loads the program counter from address 0x00000004. These two values are the first two words of the vector table.

### Step 2 - Bootloader Hardware Initialization

The bootloader's reset handler runs before main(). It initializes the stack, copies initialized data from flash to RAM (.data section), and zeros the BSS section (.bss).

### Step 3 - Boot Decision Logic

After hardware init, the bootloader reads its boot flag from persistent storage and evaluates conditions. Typical decision tree: Is there a valid update request with a CRC-verified image in the download slot?

### Step 4 - Firmware Update Procedure

If an update is requested, the bootloader proceeds with the update. In a dual-slot system, it erases the active slot sector by sector and copies the verified image from the download slot.

### Step 5 - Application Jump

The application jump is the most misunderstood step and the most common source of bugs. The bootloader must: (1) read the application's initial stack pointer from APP_BASE_ADDRESS + 0, (2) set the MSP (Main Stack Pointer) register to that value, (3) read the application reset handler address from APP_BASE_ADDRESS + 4, (4) update VTOR to APP_BASE_ADDRESS so the CPU finds the application's exception handlers, (5) disable all interrupts and reset any peripherals the bootloader used, and (6) jump to the application reset handler.

### Step 6 - Application Running and Download Agent

The application runs normally. At some point, the download agent (a task or module within the application) receives a new firmware image over whatever communication channel the product uses.

### Step 7 - Image Confirmation and Rollback Guard

After booting a new image for the first time, the bootloader marks it as BOOT_PENDING_CONFIRMATION. The new application has a responsibility: if it starts successfully and decides it is healthy (comms work, sensors respond, watchdog is fed), it writes BOOT_CONFIRMED to the flag.

## Under the Hood

The application jump involves direct manipulation of Cortex-M privileged registers. The VTOR (Vector Table Offset Register) lives at address 0xE000ED08 in the System Control Block.

Flash memory on STM32F4 devices is organized into sectors of non-uniform size: sectors 0-3 are 16KB each, sector 4 is 64KB, and sectors 5-11 are 128KB each. This matters enormously for memory layout.

## Real-World Applications

### Automotive

In automotive ECUs, bootloaders implement the UDS (Unified Diagnostic Services, ISO 14229) protocol over CAN. The bootloader responds to specific diagnostic service IDs (0x34 for RequestDownload, 0x36 for TransferData, 0x37 for RequestTransferExit) and performs programmed flashing via the OBD-II port during vehicle service.

### Medical Devices

FDA-regulated medical devices require firmware update traceability as part of 21 CFR Part 11 compliance. Bootloaders in implantable or near-patient devices must implement cryptographic signature verification (secure boot) to prevent unauthorized firmware.

## Common Mistakes

**Not Write-Protecting the Bootloader Sector** — An application bug or stack overflow can corrupt flash, including the bootloader sector, if write protection is not enabled. The CPU has no memory protection that prevents flash writes to any address. Enable sector write protection via Option Bytes on STM32 in production; never ship a device with an unprotected bootloader.

**Forgetting to Update Vtor Before Jumping** — The application jumps and seems to work until the first interrupt fires, which vectors through the wrong table and causes a HardFault. Always write the application base address to SCB->VTOR before calling the application reset handler. This is the single most common application jump bug.

**Using the Same Linker Script for Bootloader and Application** — The bootloader must be linked at address 0x08000000 (or wherever flash starts). The application must be linked at 0x08000000 + BOOTLOADER_SIZE. Using the wrong base address in either linker script causes one to overwrite the other.

## Debugging and Troubleshooting

**Symptom:** Device resets immediately after the bootloader attempts to jump to the application.

**Possible Cause:** The application's initial stack pointer value (first word of its vector table) is 0xFFFFFFFF, meaning the application flash slot is erased.

**Investigation Method:** Connect a debugger (J-Link, ST-Link) and halt at the application jump.

**Resolution:** Flash the application image to the correct address.

**Symptom:** Application boots successfully but all interrupts cause a HardFault.

**Possible Cause:** VTOR was not updated before the application jump.

**Investigation Method:** In the debugger, after the application starts, read the value at address 0xE000ED08 (SCB->VTOR).

**Resolution:** Add SCB->VTOR = APP_BASE_ADDRESS to the bootloader's jump sequence before calling the application reset handler.

## Design Considerations and Best Practices

**Use a dual-slot (A/B) memory layout rather than single-slot with buffer.**

### Keep the Bootloader As Small As Possible

Every line of code in the bootloader is a liability that cannot be patched without accepting the risks of bootloader update. A bootloader under 16KB is achievable for most use cases.

### Define Memory Boundaries in a Single Shared File

Create a memory_map.h (or memory_regions.ld) that defines APP_SLOT_A_BASE, APP_SLOT_B_BASE, DOWNLOAD_SLOT_BASE, CONFIG_BASE, BOOTLOADER_BASE as constants. Both the bootloader linker script, the application linker script, and the download agent source code include this single file.

## Expert Notes

**The application must not assume a clean hardware state.**

### Debug Interfaces Are a Security Boundary in Production

JTAG and SWD interfaces allow full read/write access to flash memory, bypassing your entire bootloader and secure boot chain. In production devices, the debug interface should be disabled via option bytes (on STM32, set RDP to Level 1 or Level 2).

## Summary

A bootloader is not a luxury or an optional optimization; it is the foundation that makes deployed embedded products maintainable over their operational life. The core design principle is that a small, never-updated, write-protected piece of code always controls the reset vector. Everything else — application code, communication stacks, business logic — can be replaced by this gatekeeper.

The memory layout is the most important design decision you will make. Define your flash slot boundaries before you write the first line of application code, encode them in a single shared header, and never let them appear as magic numbers in source code. Align everything to flash sector boundaries.

## Related Topics

**Prerequisites**

- Linker Scripts Explained (understanding MEMORY and SECTIONS directives, symbol definitions, .map file interpretation)
- MCU Boot Sequence (reset vector, startup file execution, .data/.bss initialization, SystemInit flow)
- Memory Architecture (flash organization, RAM regions, sector vs. page erase, read/write/erase timing, endurance specifications)

**Next Topics**

- Embedded Security Fundamentals (cryptographic primitives for embedded, key storage, TrustZone, RDP, secure element interfaces, threat modeling for firmware)
- Power Management Fundamentals (low-power modes and their effect on RAM/register retention, bootloader behavior after wakeup from standby, RTC backup domain and boot flag storage)
