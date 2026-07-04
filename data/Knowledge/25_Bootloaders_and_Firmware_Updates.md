---
id: bootloaders-and-firmware-updates
tags: ['Bootloader', 'OTA', 'Flash', 'Firmware']
---

# Bootloaders and Firmware Updates: Managing Code in Flash at Runtime

Imagine you have shipped 10,000 IoT sensors to industrial sites across three continents. Three months later, your team discovers a critical bug in the sensor calibration logic. Without a bootloader and firmware update mechanism, your only option is to physically recall every unit, connect a programmer to each one, reflash the device, and redeploy it. At roughly $50 per site visit, you are looking at half a million dollars to fix a software bug. This is not a hypothetical. This scenario has destroyed product lines and companies.

A bootloader is a small, resident piece of firmware that runs before your main application. Its job is to decide what code runs next and, critically, to provide a mechanism for replacing that code without external programming hardware. On an MCU like the STM32F4, the bootloader lives in a protected region of flash and executes every time the chip resets. It checks conditions, validates images, and either launches the application or enters an update mode.

The need for this capability did not come from theoretical software design. It came from field reality. Products get deployed and then they need to change. Security vulnerabilities get discovered. Features get added. Hardware errata require software workarounds. Every product that runs on an MCU, from a washing machine controller to a cardiac monitor, eventually needs its firmware updated after it leaves the factory floor.

This article covers the entire bootloader problem: how boot stages chain together, how the application jump works at the CPU level, how to lay out flash memory for reliable over-the-air updates, how CRC verification protects against corruption, what secure boot means and why it matters, and how rollback protects your users when an update goes wrong.

By the end of this article, you will understand how to design a production-grade bootloader system, what happens at the register level during an application jump, and why specific design choices in memory layout determine whether your OTA update system is reliable or a field disaster waiting to happen.

## The Fundamental Problem

The core problem is simple to state and surprisingly hard to solve: you need to replace the code that is currently running without interrupting the running system permanently, and you need to do it safely even when the process can be interrupted at any point (power loss, network dropout, cosmic ray, user impatience). Flash memory is not like RAM. You cannot overwrite it byte by byte. You erase it in sectors (typically 512 bytes to 128 KB depending on the device), and during the erase-write cycle the system is vulnerable. If power dies while you are halfway through writing a new application image, you need a plan for what happens next.

The naive approach fails immediately: if you simply erase your running application from flash and write a new one in place, you have a window where the flash contains neither a valid old image nor a valid new image. Any reset during that window bricks the device. On an STM32F103, erasing the application sector takes roughly 20-40ms per page. Writing a 64KB image takes hundreds of milliseconds. You cannot guarantee power stability over that window in any real deployment.

There is a deeper problem beyond the power-loss window. How does the CPU know whether the image in flash is valid? The CPU does not know. After reset, it reads the reset vector from a fixed address and jumps to it. If that address points to garbage because the write was incomplete, the CPU executes garbage. On a Cortex-M, this typically results in a HardFault, which resets the device, which reads the same garbage reset vector, which faults again. You are now in an infinite boot loop with no way out except external hardware intervention. This is the bricked device scenario.

The solution architecture that emerged from decades of painful field experience is: keep a small, NEVER-UPDATED piece of code (the bootloader) in a protected flash region that always has a valid reset vector, and have it manage the complexity of image validation, storage, and switching. The bootloader itself must be simple enough to be correct the first time, because you cannot update it in the field without accepting the risks described above.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/bootloader_flash.svg" alt="Bootloader Flash Layout and Update Flow" loading="lazy">
</div>

At the system level, the bootloader is the first user code to execute after the hardware initialization sequence. On a Cortex-M device, after power-on reset, the CPU hardware reads the initial stack pointer from address 0x00000000 and the reset handler address from 0x00000004. Wherever flash is mapped at address zero, that is where execution begins. The bootloader occupies this privileged position.

The bootloader's architectural role is that of a gatekeeper and dispatcher. It runs briefly at every reset, performs its checks, and then either hands control to the application or enters update mode. Once it hands off to the application, it is dormant. The application runs until the next reset. This clean separation means the bootloader and application are independently compiled, linked, and located. They communicate only through shared memory structures or flash metadata, never through function calls.

In an OTA (Over-the-Air) update system, there is typically a third actor: the download agent. This is code running inside the application that receives new firmware over a communication channel (UART, CAN, BLE, TCP/IP) and writes it to a staging area in flash. When the download is complete and verified, the download agent sets a flag and resets the device. The bootloader then sees the flag, validates the staged image, copies or swaps it into the active slot, and boots it.

## Key Concepts and Terminology

**Bootloader** — A small, resident firmware image that executes before the main application. The bootloader is permanently installed at the MCU's reset vector address and is responsible for validating application images, performing firmware updates, and jumping to the application. Unlike the application, the bootloader is typically not updated in the field because doing so would remove the safety net it provides.

**Application Vector Table** — A table of function pointers located at the start of each firmware image. On Cortex-M, this begins with the initial stack pointer value followed by the reset handler address, then other exception handlers. When jumping to an application, the bootloader reads the stack pointer from offset 0 and the reset handler from offset 4 of the application's base address. The VTOR (Vector Table Offset Register) must be updated to point to the application's vector table.

**Flash Slot / Image Slot** — A reserved, contiguous region of flash memory designated to hold one firmware image. A dual-slot (A/B) OTA system has two slots: one for the running image, one for the incoming image. Single-slot systems have one application slot plus a smaller download buffer. Slot boundaries must align to flash sector/page boundaries for erase operations to work cleanly.

**Firmware Metadata / Image Header** — A structured block of data prepended to each firmware image containing the image size, version number, CRC or hash value, target hardware identifier, and flags. The bootloader reads this header before executing any image. Without metadata, the bootloader cannot validate an image or compare versions for rollback decisions.

**Crc (cyclic Redundancy Check)** — A mathematical checksum computed over the firmware image bytes. The same algorithm run over the same data always produces the same value. A mismatched CRC between the stored value (in the image header) and the computed value (run over the actual flash contents) indicates corruption. CRC-32 is standard for firmware integrity checks. It detects corruption but does not protect against intentional tampering (use a cryptographic hash for that).

**Secure Boot** — A chain-of-trust mechanism where each stage of the boot process cryptographically verifies the next stage before executing it. On ARM TrustZone-enabled devices, secure boot begins in ROM, verifies the bootloader's digital signature, and only executes it if valid. The bootloader then verifies the application signature. Secure boot prevents execution of unauthorized firmware, which is critical for devices handling sensitive data or operating in safety-critical environments.

**Rollback** — The act of reverting to a previously known-good firmware image when a new image fails to boot correctly or fails verification. A robust rollback mechanism requires keeping the old image intact until the new image has proven itself healthy (often called "image confirmation"). Without rollback, a buggy OTA update can brick a deployed fleet.

**Boot Flag / Boot State Machine** — A persistent variable (stored in non-volatile memory, a dedicated flash sector, or backup registers) that communicates intent between the application and the bootloader across a reset boundary. Common states include: NO_UPDATE, UPDATE_REQUESTED, UPDATE_IN_PROGRESS, UPDATE_CONFIRMED, ROLLBACK_REQUESTED. The bootloader reads this flag on every reset to determine its next action.

**Mcu Factory Bootloader** — Many MCUs ship with a built-in ROM bootloader (also called the system memory bootloader on STM32). The STM32 ROM bootloader supports UART, USB DFU, SPI, I2C, and CAN update protocols and is activated by pulling BOOT0 high. This is not the same as a user-written bootloader. It is a fallback recovery tool, not a production OTA mechanism.

**Write Protection** — A hardware feature that marks flash sectors as read-only, preventing accidental or malicious modification. On STM32, Option Bytes control sector write protection. The bootloader flash region should always be write-protected in production to prevent application code from accidentally or maliciously overwriting it.

## How It Works

### Step 1 - Power-on Reset and Bootloader Entry

When the MCU powers on or resets, the Cortex-M CPU hardware loads the stack pointer from address 0x00000000 and loads the program counter from address 0x00000004. These two values are the first two words of the vector table. Because the bootloader is linked to start at address 0x08000000 (on STM32) and the flash is mapped to address 0x00000000 via the BOOT0 pin or alias register, the CPU begins executing the bootloader's reset handler. No software is involved in this first step. Hardware does it unconditionally on every reset.

### Step 2 - Bootloader Hardware Initialization

The bootloader's reset handler runs before main(). It initializes the stack, copies initialized data from flash to RAM (.data section), and zeros the BSS section (.bss). This is minimal compared to a full application startup because the bootloader only needs the peripherals it uses: typically a flash driver, possibly a UART for recovery, and a timer for watchdog management. The bootloader must NOT assume any peripheral state left by the previous application. It must initialize everything it needs from scratch.

### Step 3 - Boot Decision Logic

After hardware init, the bootloader reads its boot flag from persistent storage and evaluates conditions. Typical decision tree: Is there a valid update request with a CRC-verified image in the download slot? If yes, proceed to update. Is there a valid application in the active slot (CRC passes, magic number matches)? If yes, jump to it. Is there no valid application at all? Enter recovery mode (activate the ROM bootloader or wait for a connection on UART). The entire decision tree must execute deterministically and finish within a bounded time. Production bootloaders often have a watchdog running during this phase to catch any corruption-induced infinite loops.

### Step 4 - Firmware Update Procedure

If an update is requested, the bootloader proceeds with the update. In a dual-slot system, it erases the active slot sector by sector and copies the verified image from the download slot. After each flash write, it reads back and verifies the written data. On completion, it computes the CRC of the newly written active slot and compares it against the expected value in the image header. Only if CRC matches does it mark the image as valid and clear the update-pending flag. The old image in the download slot is left intact until the new image has been confirmed healthy by the running application (see rollback step).

### Step 5 - Application Jump

The application jump is the most misunderstood step and the most common source of bugs. The bootloader must: (1) read the application's initial stack pointer from APP_BASE_ADDRESS + 0, (2) set the MSP (Main Stack Pointer) register to that value, (3) read the application reset handler address from APP_BASE_ADDRESS + 4, (4) update VTOR to APP_BASE_ADDRESS so the CPU finds the application's exception handlers, (5) disable all interrupts and reset any peripherals the bootloader used, and (6) jump to the application reset handler. On Cortex-M, this is done with a function pointer cast and a direct jump, or by writing to the PC register. The jump must happen in privileged mode, and the application starts executing its own startup code as if it was just powered on.

### Step 6 - Application Running and Download Agent

The application runs normally. At some point, the download agent (a task or module within the application) receives a new firmware image over whatever communication channel the product uses. It writes incoming data to the download slot in flash, sector by sector. When the full image is received, it verifies the image CRC, writes the image metadata, sets the boot flag to UPDATE_REQUESTED, and triggers a system reset. The device resets, the bootloader runs, sees the update request, and the cycle repeats from step 3.

### Step 7 - Image Confirmation and Rollback Guard

After booting a new image for the first time, the bootloader marks it as BOOT_PENDING_CONFIRMATION. The new application has a responsibility: if it starts successfully and decides it is healthy (comms work, sensors respond, watchdog is fed), it writes BOOT_CONFIRMED to the flag. On the NEXT reset, the bootloader sees the confirmed image and boots it normally. If the application never confirms (because it crashed, hung, or the watchdog fired), the bootloader increments a retry counter. After N failed attempts (typically 2-3), it declares the new image unhealthy and falls back to the previous known-good image in the other slot.

## Under the Hood

The application jump involves direct manipulation of Cortex-M privileged registers. The VTOR (Vector Table Offset Register) lives at address 0xE000ED08 in the System Control Block. Writing the application base address to VTOR tells the CPU where to find interrupt and exception vectors. If you forget this step, the CPU will still jump to the application reset handler, but the first interrupt that fires will vector through the BOOTLOADER's vector table, not the application's. The result is unpredictable behavior that can be nearly impossible to debug without an oscilloscope and a logic analyzer.

Flash memory on STM32F4 devices is organized into sectors of non-uniform size: sectors 0-3 are 16KB each, sector 4 is 64KB, and sectors 5-11 are 128KB each. This matters enormously for memory layout. Your bootloader fits comfortably in sector 0 (16KB). But if your application image is large, it might span multiple 128KB sectors. When the download agent erases the download slot, it must erase complete sectors, even if the image is smaller than the sector. Erasing a sector that overlaps with other data (such as a configuration storage region) is a classic disaster. Memory layout planning must account for sector boundaries from the start of the project.

CRC computation over flash has a subtle timing implication. Computing CRC-32 over a 256KB image requires reading 65,536 32-bit words from flash. On an STM32 running at 168MHz with flash wait states, this takes several hundred milliseconds. During this time, the bootloader is not running the application, the watchdog must be fed, and if the device is battery-powered, you are burning energy. Some designs use the STM32's hardware CRC unit, which accelerates this significantly and frees the CPU. Others compute CRC incrementally during the write process rather than as a separate verification pass. Both are valid; the key is that CRC must run to completion before any jump or erase decision.

Secure boot on Cortex-M33 (e.g., STM32L5, STM32U5) uses ARM TrustZone and a hardware-enforced secure/non-secure partition. The ROM bootloader in these devices verifies a digital signature over the user bootloader image using a public key burned into One-Time-Programmable (OTP) memory. The signature algorithm is typically ECDSA-P256 or RSA-2048. The public key hash is stored in the device at manufacturing time. This means: the signing key must be protected at your manufacturing facility. If that key leaks, an attacker can sign malicious firmware that passes your secure boot chain. Key management is not an embedded firmware problem; it is an operations and security problem that begins before you write the first line of bootloader code.

Interrupt state during the application jump requires careful attention. If the bootloader has enabled any peripheral interrupts (e.g., a UART receive interrupt for recovery mode), those interrupts must be disabled before jumping to the application, or the application may receive spurious interrupts from the bootloader's peripherals before it has initialized its own NVIC configuration. The cleanest approach: before jumping, call __disable_irq(), reset all peripheral clocks back to their reset state, then jump. The application re-enables only the interrupts it needs during its own initialization sequence.

## Real-World Applications

### Automotive

In automotive ECUs, bootloaders implement the UDS (Unified Diagnostic Services, ISO 14229) protocol over CAN. The bootloader responds to specific diagnostic service IDs (0x34 for RequestDownload, 0x36 for TransferData, 0x37 for RequestTransferExit) and performs programmed flashing via the OBD-II port during vehicle service. Every AUTOSAR-compliant ECU has a standardized Flash Bootloader (FBL) that also enforces security access (service 0x27) requiring a seed-key exchange before flashing is permitted. Rollback and CRC verification are mandatory. Field flashing at a dealership of a safety-critical ECU (ABS, airbag) triggers a DTC log entry for traceability.

### Medical Devices

FDA-regulated medical devices require firmware update traceability as part of 21 CFR Part 11 compliance. Bootloaders in implantable or near-patient devices must implement cryptographic signature verification (secure boot) to prevent unauthorized firmware. The update process is logged with timestamp, image version, and device identifier. Rollback is typically disabled or tightly controlled: regulators want to know exactly which firmware version a device ran at any point in time, and reverting to an uncleared firmware version raises audit questions. The bootloader itself is treated as safety-critical software and goes through IEC 62304 software class C review.

INDUSTRIAL IoT

Industrial sensors and PLCs deployed in factories use bootloaders with FOTA (Firmware Over The Air) via MQTT or CoAP. A central device management platform pushes firmware updates to thousands of devices simultaneously. Delta updates (only sending the changed bytes, not the full image) reduce bandwidth on constrained networks. The Zephyr RTOS MCUboot implementation is widely used here: it supports slot swapping, image signing with ECDSA, and rollback out of the box and has been deployed across millions of industrial IoT devices.

### Consumer Electronics

Bluetooth speakers, smart home devices, and wearables use DFU (Device Firmware Upgrade) over BLE. Nordic Semiconductor's nRF52 series ships with a well-documented BLE DFU bootloader that supports image signing, CRC verification, and automatic rollback on failed boot. The update is triggered by the companion phone app. The entire image (typically 100-300KB) is transferred over BLE in segments; the nRF52 bootloader writes each segment to the download slot and validates the complete image before attempting the swap.

### Aerospace

Avionics bootloaders on DO-178C Level A systems use deterministic verification sequences and have formal requirements for every decision branch. Firmware updates on aircraft systems require ground support equipment, specific data loading keys, and post-load built-in test (BIT) sequences before the system is declared airworthy. Dual-redundant flash banks are common. The bootloader is part of the safety-critical software baseline and cannot be updated in the field without a full re-qualification cycle.

## Common Mistakes

**Not Write-Protecting the Bootloader Sector** — An application bug or stack overflow can corrupt flash, including the bootloader sector, if write protection is not enabled. The CPU has no memory protection that prevents flash writes to any address. Enable sector write protection via Option Bytes on STM32 in production; never ship a device with an unprotected bootloader.

**Forgetting to Update Vtor Before Jumping** — The application jumps and seems to work until the first interrupt fires, which vectors through the wrong table and causes a HardFault. Always write the application base address to SCB->VTOR before calling the application reset handler. This is the single most common application jump bug.

**Using the Same Linker Script for Bootloader and Application** — The bootloader must be linked at address 0x08000000 (or wherever flash starts). The application must be linked at 0x08000000 + BOOTLOADER_SIZE. Using the wrong base address in either linker script causes one to overwrite the other. Maintain separate linker scripts. Use a shared header file for the address boundaries so they stay synchronized.

**Computing Crc Over the Wrong Range** — A common mistake is including the CRC field itself in the CRC computation, or not including the full image (stopping early at the first 0xFF byte thinking flash padding is not part of the image). Define clearly what bytes are included in the CRC: from the first byte after the CRC field in the header to the last byte of the image, with a fixed image size stored in the header.

**No Watchdog During the Update Process** — If the bootloader hangs during a flash erase or copy operation, the device is stuck forever. Keep the independent watchdog (IWDG) running during the entire update process and feed it at defined points. If you cannot feed it, something has gone wrong and a reset is the correct response.

**Assuming Flash Writes Succeed Without Readback Verification** — Flash write failures are rare but not zero, especially on aged devices or at temperature extremes. After every flash page write, read back the written data and compare it word by word. If a mismatch is found, retry (some flash controllers allow this) or abort the update and report the error rather than booting a silently corrupted image.

**Not Handling the Half-Updated State on Power Loss** — If power is lost after erasing the active slot but before completing the write, the device has no valid application. The bootloader must detect this state (erased active slot, valid download slot) and resume or restart the copy rather than attempting to jump to an empty flash region. The boot flag state machine handles this: the UPDATE_IN_PROGRESS state is distinct from UPDATE_REQUESTED.

**Hardcoding Image Addresses in the Application** — If the application contains hardcoded flash addresses for reading configuration data or its own version number, those addresses break when the memory layout changes. Use symbols from the linker script for all flash address references. This also applies to the download agent: the download slot address should come from a shared header, not a magic number buried in one source file.

## Debugging and Troubleshooting

**Symptom:** Device resets immediately after the bootloader attempts to jump to the application.

**Possible Cause:** The application's initial stack pointer value (first word of its vector table) is 0xFFFFFFFF, meaning the application flash slot is erased. Alternatively, the application is linked at the wrong address and its reset handler address is invalid.

**Investigation Method:** Connect a debugger (J-Link, ST-Link) and halt at the application jump. Inspect the memory at APP_BASE_ADDRESS. The first word should be a valid RAM address (e.g., 0x20000000 + some offset for STM32). The second word should be an odd address (Thumb bit set) pointing into the application flash region. If either word is 0xFFFFFFFF, the slot is empty. Confirm the linker script FLASH origin and LENGTH for the application.

**Resolution:** Flash the application image to the correct address. Verify the application's linker script FLASH ORIGIN matches APP_BASE_ADDRESS. Confirm the bootloader's APP_BASE_ADDRESS constant matches the application's linker script ORIGIN.

**Symptom:** Application boots successfully but all interrupts cause a HardFault.

**Possible Cause:** VTOR was not updated before the application jump. All interrupt vectors still point to the bootloader's handlers, which are no longer valid in the application context.

**Investigation Method:** In the debugger, after the application starts, read the value at address 0xE000ED08 (SCB->VTOR). It should equal APP_BASE_ADDRESS. If it still equals 0x08000000 (bootloader base), VTOR was never updated. Also confirm the application itself sets VTOR in its SystemInit() or startup code.

**Resolution:** Add SCB->VTOR = APP_BASE_ADDRESS to the bootloader's jump sequence before calling the application reset handler. Some application frameworks (STM32 HAL) also set VTOR in SystemInit(); verify this is not being skipped.

**Symptom:** OTA update completes, device reboots, bootloader reports CRC failure, rolls back. This happens consistently with the same image.

**Possible Cause:** The CRC algorithm or byte range used at build time (to compute the stored CRC in the image header) does not match the CRC algorithm used by the bootloader at runtime. Common mismatch: polynomial differs (0x04C11DB7 vs. reflected 0xEDB88320), initial value differs, or the final XOR differs.

**Investigation Method:** Extract the raw image binary. Run the CRC computation manually with the bootloader's exact algorithm parameters over the exact byte range. Compare to the stored value in the image header. Also check if the image was padded to a sector boundary during the download and whether the CRC covers the padded or unpadded image.

**Resolution:** Align the build tools' CRC parameters with the bootloader's CRC function. Define a single CRC configuration header shared by both the build toolchain scripts and the bootloader source code to prevent divergence.

**Symptom:** After a successful OTA update, the device reboots into the new firmware but rolls back to the old firmware on the next scheduled reset (e.g., daily watchdog reset).

**Possible Cause:** The new application never writes the BOOT_CONFIRMED flag. The bootloader interprets every boot as an unconfirmed new image and rolls back after its retry count is exhausted.

**Investigation Method:** Read the boot flag persistent storage (flash sector or backup register) after the new application has been running for a while. If it still shows BOOT_PENDING_CONFIRMATION rather than BOOT_CONFIRMED, the application confirmation logic is not executing.

**Resolution:** Ensure the application's confirmation logic runs unconditionally during startup, not only when certain conditions are met. Confirm the write reaches persistent storage (check that the flash write function returns success and that the storage sector is not write-protected).

## Design Considerations and Best Practices

USE A DUAL-SLOT (A/B) MEMORY LAYOUT RATHER THAN SINGLE-SLOT WITH BUFFER

The A/B layout keeps a complete, verified copy of both the old and new image on flash at all times. The single-slot-with-download-buffer approach saves flash space but requires overwriting the running image, leaving no fallback. On devices where flash is abundant, always choose A/B. The cost (doubled flash usage for application code) is small compared to the operational cost of a bricked device fleet.

### Keep the Bootloader As Small As Possible

Every line of code in the bootloader is a liability that cannot be patched without accepting the risks of bootloader update. A bootloader under 16KB is achievable for most use cases. Avoid including anything that belongs in the application: no application logic, no full communication stacks, no RTOS. The bootloader needs flash drivers, a CRC function, and a minimal transport for recovery (UART at minimum).

### Define Memory Boundaries in a Single Shared File

Create a memory_map.h (or memory_regions.ld) that defines APP_SLOT_A_BASE, APP_SLOT_B_BASE, DOWNLOAD_SLOT_BASE, CONFIG_BASE, BOOTLOADER_BASE as constants. Both the bootloader linker script, the application linker script, and the download agent source code include this single file. When the layout changes, you change one file and recompile everything. Mismatched hardcoded addresses across multiple files are the root cause of most layout-related bugs.

STORE THE BOOT FLAG IN BACKUP REGISTERS, NOT APPLICATION FLASH

On STM32, the RTC backup registers (RTC_BKPxR) survive system resets and low-power modes but are cleared only by a power-on reset or a VBAT removal. This makes them ideal for boot flags. Storing the flag in flash requires an erase-write cycle on every flag update, which introduces both wear and a time cost. Backup registers are a single 32-bit write. Use flash only for persistent flags that must survive a full power-off.

INCLUDE A HARDWARE RECOVERY PATH THAT BYPASSES THE BOOTLOADER ENTIRELY

On every design, designate a GPIO pin that, when held low at boot, forces entry into the MCU's factory ROM bootloader (for STM32, this is done via the BOOT0 pin). This physical recovery path must be accessible on the PCB via a test point or dedicated header. When a software bug in your bootloader leaves the device in an unrecoverable state, this physical pin is the only way out short of replacing the MCU. Never ship a design where this recovery path is inaccessible.

SIGN FIRMWARE IMAGES IN PRODUCTION EVEN IF YOU DO NOT HAVE FULL SECURE BOOT HARDWARE

Even on devices without TrustZone, you can implement signature verification in the bootloader using an ECDSA or Ed25519 library. The private key signs the image at build time; the bootloader holds the public key (compiled into its binary) and verifies the signature before accepting any image. This prevents loading modified firmware from a compromised server or an attacker with physical access to the flash interface. The computational cost of ECDSA-P256 verification on a Cortex-M4 at 168MHz is approximately 200-400ms, which is acceptable at boot time.

IMPLEMENT A BOOT ATTEMPT COUNTER WITH A HARD LIMIT

Store a boot attempt counter in persistent storage. Every time the bootloader boots an unconfirmed image, increment the counter. If the counter reaches 3 (or your defined limit), declare the image failed and roll back without waiting for the confirmation timeout. This ensures that a device stuck in a crash-reset loop does not retry indefinitely; it falls back within a bounded number of cycles. Reset the counter to zero when an image is confirmed.

### Never Disable the Watchdog in the Bootloader

Some engineers disable the IWDG during bootloader execution to avoid handling watchdog resets during long flash operations. This is dangerous. If the bootloader hangs due to a corrupted image or a flash controller anomaly, the device is stuck forever. Feed the watchdog at defined points during update operations instead of disabling it. Design the bootloader's flash update loop so that the maximum time between watchdog feeds is well within the IWDG timeout window.

## Expert Notes

THE APPLICATION MUST NOT ASSUME A CLEAN HARDWARE STATE

Juniors frequently write applications that assume all peripherals are in their power-on-reset state. When a bootloader precedes the application, this assumption is wrong. The bootloader may have enabled clocks, started timers, configured GPIO pins, or left DMA channels partially configured. The application MUST initialize every peripheral it uses from scratch, not rely on power-on-reset defaults. The best practice is for the bootloader to reset all peripherals it used to their reset state before jumping; but your application should not depend on this being done correctly.

LINKER SCRIPT ERRORS CREATE SILENT, CATASTROPHIC BUGS

A misconfigured linker script does not generate a compiler error. It generates an image that links successfully and produces a binary that is placed at the wrong address in flash. The device may appear to work in simple tests but fails under load when an interrupt fires and vectors to the wrong address. Always verify the memory map of a new bootloader or application build by inspecting the .map file and reading back the actual flash contents with a debugger. Confirm the vector table is at the address you expect BEFORE testing complex functionality.

THE DOWNLOAD AGENT AND BOOTLOADER MUST AGREE ON THE EXACT IMAGE FORMAT

This sounds obvious but it breaks constantly in practice. The download agent writes an image to the download slot. The bootloader reads a header from that slot to find the CRC, size, and version. If the download agent writes a raw binary and the bootloader expects a header at offset zero, you have a mismatch. Define the image format in a shared header file included by both the bootloader project and the application project. Include the image format version in the header so the bootloader can detect format changes gracefully.

FLASH ENDURANCE IS FINITE AND MATTERS FOR OTA-HEAVY PRODUCTS

STM32 flash is rated for 10,000 erase-write cycles minimum (typically higher in practice). For a product that receives a firmware update monthly, this is 833 years. For a product that updates daily (e.g., an industrial gateway), it is 27 years. For a product that updates with every configuration change (bad design, but it happens), endurance becomes a real concern. Track update counts in your device management system. Design update-heavy systems to spread writes across sectors or use external flash (SPI NOR, typically rated for 100,000 cycles) for the download slot.

ROLLBACK IS NOT FREE: YOU NEED AN EXPLICIT CONFIRMATION PROTOCOL

The most common bootloader design mistake is implementing rollback as a reaction to CRC failure but not implementing the confirmation protocol for a successfully-booted image. Without confirmation, the bootloader has no way to distinguish "new image is running fine" from "new image booted once but will crash under load." The confirmation must come from application logic that runs after the system has been operational for long enough to detect the most common failure modes: communications operational, sensors responding, application watchdog being fed. Implement confirmation as an explicit, required step in your application startup sequence, not as an optional future enhancement.

### Debug Interfaces Are a Security Boundary in Production

JTAG and SWD interfaces allow full read/write access to flash memory, bypassing your entire bootloader and secure boot chain. In production devices, the debug interface should be disabled via option bytes (on STM32, set RDP to Level 1 or Level 2). Level 1 prevents flash readback over debug but preserves the ability to do a full chip erase to unlock the device (destroying the firmware). Level 2 permanently disables the debug interface, which also permanently prevents recovery via that path. For medical and security-sensitive devices, RDP Level 2 is appropriate. For most commercial products, Level 1 is a reasonable balance.

## Summary

A bootloader is not a luxury or an optional optimization; it is the foundation that makes deployed embedded products maintainable over their operational life. The core design principle is that a small, never-updated, write-protected piece of code always controls the reset vector. Everything else -- application code, communication stacks, business logic -- can be replaced by this gatekeeper. Getting the bootloader right before first silicon is critical because fixing it in the field is the hardest possible firmware problem.

The memory layout is the most important design decision you will make. Define your flash slot boundaries before you write the first line of application code, encode them in a single shared header, and never let them appear as magic numbers in source code. Align everything to flash sector boundaries. Protect the bootloader sector in hardware. The application jump requires updating VTOR, setting the stack pointer, disabling the bootloader's interrupts, and jumping to the application's reset handler -- in that order, with no shortcuts. CRC verification is the minimum bar for image integrity; cryptographic signatures are the bar for security.

Rollback is what separates a bootloader you trust with a production fleet from one that looks good on a developer bench. Rollback requires: keeping the old image intact, booting the new image in a provisional state, having the application explicitly confirm health, and having the bootloader revert after a defined number of failed confirmation attempts. This protocol must survive power loss at any point. Build your boot flag state machine to handle every possible interrupted state.

The mental model to retain: the bootloader is a trusted, minimal, hardware-adjacent firmware component that acts as a referee between the flash contents and the CPU. It never trusts the application region blindly. It always validates before executing. It always has a fallback plan. Every design decision -- memory layout, update protocol, confirmation, rollback, security -- flows from this single responsibility: safely manage what code the CPU runs next.

## Related Topics

Prerequisites: - Linker Scripts and Memory Sections (understanding MEMORY and SECTIONS directives, symbol definitions, .map file interpretation) - MCU Boot Sequence (reset vector, startup file execution, .data/.bss initialization, SystemInit flow) - Memory Architecture (flash organization, RAM regions, sector vs. page erase, read/write/erase timing, endurance specifications)

Next Topics: - Embedded Security Fundamentals (cryptographic primitives for embedded, key storage, TrustZone, RDP, secure element interfaces, threat modeling for firmware) - Power Management (low-power modes and their effect on RAM/register retention, bootloader behavior after wakeup from standby, RTC backup domain and boot flag storage)
