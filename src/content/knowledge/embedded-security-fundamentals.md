---
title: "Embedded Security Fundamentals: Protecting a Device in Layers"
brief: "Threat models for devices: secure boot, debug-port lockdown, key storage, TrustZone and protected firmware updates."
order: 27
phase: 6
tags: ["Security", "TrustZone", "Crypto", "Secure Boot"]
---

A few years ago, a major home router vendor shipped millions of devices with a UART debug port left active on the board. Anyone with a cheap USB-to-serial adapter could open a root shell. The product's encryption was fine. The door next to it had simply been left open.

Embedded devices sit in homes, cars and factories, often in reach of the people who want to attack them. Security here is about closing all the doors, not building one strong lock.

## The Fundamental Problem

A server sits in a guarded building. An embedded device sits on someone's shelf, where an attacker can buy one, open it and probe it for weeks. Devices also stay in the field for years, often with little memory and no security team watching them. And because many units run identical firmware, one attack found on one device can often be repeated on all of them.

## The Big Picture

Good device security is built in layers, so that one failure does not lose everything. Each layer protects the one above it.

![Secure Boot Chain and TrustZone Architecture](/diagrams/security_arch.svg)

### In Plain Terms

Think of a bank. It does not rely on the front door alone. There are locks, cameras, a vault and staff who can only open certain rooms. A thief who gets past one layer still faces the next.

A device works the same way. Secure boot makes sure that only approved code runs. Locked debug ports keep people out of the back door. A protected area keeps keys away from ordinary code. Signed updates stop someone swapping the software later.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Attack surface** | Every point where an attacker can reach the device. |
| **Secure boot** | Each boot stage checks the next before running it. |
| **Debug lockdown** | Disabling JTAG, SWD and serial consoles in production. |
| **TrustZone** | Arm hardware that splits a chip into secure and normal worlds. |
| **Read-out protection** | Stops firmware being read through the debug port. |
| **Secure element** | A separate chip that stores keys and does cryptography. |
| **Least privilege** | Give each part of the system only the access it needs. |

## How It Works

### Step 1: Decide what you are protecting

List your assets, such as firmware, keys and user data, and who might go after them.

### Step 2: Reduce the attack surface

Remove debug shells, unused services and open ports. Code that is not there cannot be attacked.

### Step 3: Start from a root of trust

Use secure boot, so that only signed firmware runs on the device.

### Step 4: Protect keys

Give each device unique keys, and keep them in protected hardware.

### Step 5: Secure communication

Use TLS for anything crossing a network, and check certificates.

### Step 6: Plan for updates

New flaws will appear, so signed updates are part of security. A device you cannot patch stays vulnerable for life.

## A Closer Look: Why One Device Key Can Sink a Fleet

The most damaging embedded mistakes are not clever bugs. They are shared secrets.

Suppose every product uses one AES key to decrypt updates, stored in flash. An attacker buys one unit for a small sum, reads the key out with a debug probe, and publishes it. Now every device ever sold can be attacked, and the key cannot be changed without an update, which that same key protects.

Compare this with per-device keys. The same attacker spends the same effort and gets one key that opens one device. They would have to repeat that work for each unit, so the attack stops being worth doing.

This is called making an attack not scale. You usually cannot stop a skilled person with a device on their bench. You can make sure that breaking one device gains them almost nothing.

## A Worked Example: Hardening a Smart Plug

A smart plug starts as a prototype with a UART console, a default password and an update link over plain HTTP.

**Close the doors.** The UART console is disabled in production firmware, read-out protection is enabled, and the default password is replaced with a unique one printed on each unit.

**Protect updates.** Firmware is signed at the build server, and the bootloader checks each signature using a public key stored in protected memory. The download moves to HTTPS.

**Protect secrets.** The Wi-Fi password and device key are stored in encrypted storage, tied to that chip.

**Limit the damage.** The network task runs with restricted memory access using the MPU, so a parser bug cannot read the keys.

None of these steps is exotic. Each one closes a door that real attacks have used.

## Common Questions

**Is a security chip always needed?** No. It depends on the value of what you protect, but it is a good choice for connected products.

**Does hiding my code keep it safe?** No. Attackers can dump and study firmware. Design as if they have read it.

**Isn't my product too small to attack?** Automated scans do not care. Small devices get recruited into botnets.

**Can security be added later?** Parts can, but secure boot and key storage are hard to add once hardware has shipped.

## Under the Hood

TrustZone for Cortex-M divides memory and peripherals into secure and non-secure regions, enforced by hardware. Normal code can only enter secure code at defined gateway functions, so keys kept in the secure world cannot be read even if the application is compromised. The MPU gives a simpler version of this, limiting what each task may touch.

## Real-World Applications

**Consumer IoT.** The Mirai botnet spread through default passwords on cameras and routers.

**Automotive.** Secure boot and on-chip HSMs protect ECUs.

**Medical.** Regulators now expect a security plan for connected devices.

## Common Mistakes

### Mistake 1: Leaving debug access open

**What goes wrong:** A shell or JTAG port gives an attacker full control.

**How to avoid it:** Disable debug access as a production step, and verify it on real units.

### Mistake 2: Hard-coded credentials

**What goes wrong:** A password in firmware is found once and works on every device.

**How to avoid it:** Use unique credentials for each device.

### Mistake 3: Unsigned updates

**What goes wrong:** Anyone who can reach the update path can install their own code.

**How to avoid it:** Sign every image, and verify it before installing.

## Debugging and Troubleshooting

**Symptom:** Debug access is still possible on production units

**Possible Cause:** The lock step was skipped, or set to a reversible level.

**Investigation Method:** Attach a debugger to a real production unit.

**Resolution:** Add the lock to the factory process, and test for it.

**Symptom:** The bootloader rejects a valid update

**Possible Cause:** Wrong signing key, or a mismatch in the signed range.

**Investigation Method:** Compare the image hash on both sides.

**Resolution:** Fix the signing step, and keep a recovery path.

## Design Considerations and Best Practices

**Plan security at the start.** Hardware choices decide what is possible later, and adding it at the end costs far more.

**Make each attack scale poorly.** Unique keys for each device limit any breach to one unit.

## Expert Notes

**Most real attacks are simple.** Default passwords and open ports cause far more damage than advanced cryptographic attacks.

**Security must be maintained.** Plan for how you will find out about vulnerabilities and ship fixes for the whole life of the product.

## Summary

Embedded security means closing all the doors, not building one strong lock. Devices are physically exposed and often identical, so build in layers: remove what you do not need, allow only signed code, lock debug ports, protect keys and keep the ability to update. Give each device unique keys, so that breaking one gains an attacker very little.

## Related Topics

**Prerequisites**

- Bootloaders and Firmware Updates

**Go Deeper**

- Security Goals
- Secure Boot Chain
- TLS
- HSMs and Secure Key Storage
