---
title: "Secure Boot Chain: Trusting Every Stage From Reset"
brief: "How each boot stage verifies the next from immutable ROM, so that only authorised firmware ever runs on the device."
order: 37
phase: 7
tags: ["Secure Boot", "Chain of Trust", "Root of Trust", "ROM", "Rollback"]
---

A device can have perfect TLS and strong encryption, yet none of it matters if an attacker can replace the firmware. Malicious firmware can read every key and report that all is well. Secure boot exists to answer one question at every power-on: is the code about to run really ours?

## The Fundamental Problem

Software cannot check itself. If firmware verifies its own signature, a modified copy can simply skip the check. The verifier must be something an attacker cannot change, and it must run first. That means the check has to begin in hardware or in read-only memory.

## The Big Picture

Trust starts in code that cannot be changed, and each stage checks the next before handing over control.

![Immutable ROM verifies the bootloader, which verifies the kernel or firmware, which runs the application](/diagrams/boot_chain.svg)

### In Plain Terms

Think of a relay of security guards. The first guard was hired by the head office and cannot be replaced. That guard checks the ID of the second guard, who checks the third, and so on. Nobody enters without being checked by someone already trusted. If one ID fails, the line stops there.

The first guard is boot ROM, burned into the chip at the factory. Everything else depends on it being trustworthy, so it is called the root of trust.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Root of trust** | The small, unchangeable starting point that everything else relies on. |
| **Chain of trust** | Each stage verifying the next before running it. |
| **Boot ROM** | Vendor code in read-only memory, the first thing that runs after reset. |
| **eFuse / OTP** | One-time programmable bits, often holding the hash of the public key. |
| **Rollback protection** | Refusing older signed firmware that may contain known bugs. |
| **Measured boot** | Recording what booted, without blocking it, so it can be reported later. |

## How It Works

### Step 1: Reset

The CPU starts in boot ROM. No flash code has run yet, so nothing an attacker wrote can interfere.

### Step 2: Check the public key

The first-stage image includes a public key. ROM hashes it and compares it with the hash stored in fuses. Storing only a hash saves fuse space and still fixes the key.

### Step 3: Verify the first stage

ROM checks the image signature using that public key. If it fails, the device stops or enters recovery.

### Step 4: Pass control down the chain

The verified bootloader checks the next image the same way. On Linux this means U-Boot verifies a signed kernel and device tree. dm-verity can then verify the root filesystem block by block as it is read.

### Step 5: Check the version

Each stage compares the image version with a monotonic counter, so an old vulnerable image cannot be reinstalled even though its signature is valid.

## A Closer Look: Why Trust Has to Start in Hardware

Imagine asking a stranger, "Are you honest?" A dishonest person says yes, just as an honest one does. Software checking itself has the same problem. If an attacker changed the program, they also changed the part that does the checking, so it will happily report that all is well.

The only way out is to start with something that cannot be changed. Boot ROM is written into the silicon when the chip is made. No software, however privileged, can edit it. So when the ROM says "this bootloader is genuine", that statement can be believed.

Each stage then lends its trust to the next. The ROM trusts the bootloader because the signature checked out. The bootloader trusts the kernel for the same reason. The trust is a chain, and a chain breaks at its weakest link: one stage that runs something unchecked ends the protection for everything after it.

Notice that secure boot only answers one question: is this the code we approved? It does not prove the code is free of bugs. A signed program with a flaw can still be attacked, which is why updates and rollback protection matter too.

## A Worked Example: Booting an Embedded Linux Device

On an i.MX processor, the ROM (HAB or AHAB) checks U-Boot against a key hash in fuses. U-Boot then loads a FIT image containing the kernel, device tree and initramfs, and verifies its signature using a public key built into U-Boot itself. The kernel mounts a read-only root filesystem protected by dm-verity, so changed blocks produce read errors instead of running attacker code.

Suppose an attacker writes a modified kernel to the eMMC. U-Boot's signature check fails and the device refuses to boot it. If they replace U-Boot too, the ROM check fails. To break the chain they would need a private signing key, or a bug in one of the stages.

## Common Questions

**Does secure boot encrypt my firmware?** No. It proves that the firmware is genuine, but anyone can still read it. If you need to hide the firmware, encrypt it as well.

**What happens if verification fails?** The device stops booting that image. A good design then tries a backup image or enters a recovery mode, so one bad update does not leave a dead device.

**Can I turn it off later?** Usually not. Enforcing secure boot often means blowing a fuse, which is permanent for that chip.

**Does it slow down start-up?** A little. Hardware hashing keeps the delay small, and it is rarely noticeable unless the product needs a very fast start.

## Under the Hood

ROM has to be small and is impossible to patch, so it uses simple code and usually a hardware hash unit. Verification adds to boot time, which is why designs hash large images with hardware and may use dm-verity to check data only when it is read.

The fuse step is permanent. Devices normally ship with secure boot "open" for development, then blow a lock fuse at the factory. Afterwards, unsigned images are refused for the life of the chip, so a mistake in key handling can brick the entire production batch.

Debug access must be closed at the same time. An open JTAG port lets an attacker bypass everything by running code directly.

## Real-World Applications

**Phones.** Android Verified Boot checks every partition and shows a warning for modified software.

**Automotive.** ECUs use secure boot through an on-chip HSM, so tampered firmware cannot control the vehicle.

**Industrial gateways.** Signed images and dm-verity stop persistent malware surviving a reboot.

**PCs.** UEFI Secure Boot applies the same idea to bootloaders and operating systems.

## Common Mistakes

### Mistake 1: A gap in the chain

**What goes wrong:** The kernel is verified, but the bootloader environment or a boot script is not, so an attacker changes boot arguments and bypasses later checks.

**How to avoid it:** Verify or lock down everything that affects execution, including environment variables and device trees.

### Mistake 2: Leaving debug open

**What goes wrong:** JTAG or a U-Boot console lets anyone stop the boot and load their own code.

**How to avoid it:** Disable debug ports and bootloader consoles in production.

### Mistake 3: Blowing fuses without a tested process

**What goes wrong:** One wrong key hash permanently bricks units.

**How to avoid it:** Verify the signed boot in non-enforcing mode first, then lock.

## Debugging and Troubleshooting

**Symptom:** The device boots in development but fails after enabling secure boot

**Possible Cause:** The image was signed with the wrong key, or the wrong address range was signed.

**Investigation Method:** Read the vendor's boot status log, such as HAB events on i.MX.

**Resolution:** Fix the signing step and re-check in open mode before closing the device.

**Symptom:** Random read errors on the root filesystem

**Possible Cause:** dm-verity detected changed blocks, often from something writing to a read-only partition.

**Investigation Method:** Check kernel logs for verity errors and find the writer.

**Resolution:** Keep the root partition read-only and move writable data elsewhere.

## Design Considerations and Best Practices

**Plan signing key management first.** Keep keys in an HSM and allow several key slots, so a leaked key can be revoked.

**Provide safe recovery.** Dual image slots let a device fall back when an update fails verification, without weakening the checks.

**Measure boot time.** Hash speed matters for products with fast-start requirements.

**Test failure paths.** Corrupt an image on purpose and confirm the device refuses it.

## Expert Notes

**The bootloader's other inputs count too.** Environment variables, device trees and kernel arguments all influence what runs. Attackers look for these side doors, not the signature check itself.

**Key rotation is a design decision.** If only one key can ever be trusted, a leaked key leaves you with no way out. Reserve spare key slots before the fuses are blown.

**Test the closed state early.** Teams often enable secure boot in the final weeks and discover problems with factory tools and update flows. Run a closed device early in development.

## Summary

Secure boot means each piece of code checks the next before it runs, starting from code that cannot be changed. Like a relay of guards, one trusted first check protects everything after it. Keep the chain complete, close debug ports, add rollback protection, and treat the permanent fuse step as a carefully tested factory process.

## Related Topics

**Prerequisites**

- Hashes, MACs and Digital Signatures
- MCU Boot Sequence

**Next Topics**

- Device Provisioning
- Bootloaders and Firmware Updates
- Linux Boot Flow
