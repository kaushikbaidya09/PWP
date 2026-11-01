---
title: "Side-Channel and Fault Attacks: When Hardware Leaks Secrets"
brief: "How attackers read keys from timing and power use, or skip checks with voltage glitches, and what firmware can do about it."
order: 40
phase: 7
tags: ["Side Channel", "Fault Injection", "Glitching", "Constant Time"]
---

AES has no known practical weakness, yet a researcher with a cheap oscilloscope can recover an AES key from an unprotected microcontroller in minutes. They do not break the mathematics. They watch the chip while it works. Physical devices leak information, and in embedded systems the attacker may be holding the device.

## The Fundamental Problem

Cryptography proofs assume a sealed black box: data in, data out. Real chips are not black boxes. They consume power, take time and emit radio noise, and all of these depend on what they are calculating. They can also be pushed into making mistakes. An attacker with physical access has channels the mathematics never considered.

## The Big Picture

There are two broad families. One passively listens, the other actively disturbs.

![Side channels observe a chip's timing and power, while fault attacks disturb it to skip checks](/diagrams/side_channel.svg)

### In Plain Terms

Imagine a safe with a dial. A skilled thief does not attack the steel. They listen to tiny clicks as each digit falls into place, and work out the code one number at a time. That is a side-channel attack.

Now imagine a guard who checks passes at a door. If you startle him at the exact moment he reads your pass, he might wave you through. That is a fault attack: a short voltage dip or laser pulse makes the CPU skip an instruction, such as the one that rejects a bad signature.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Side channel** | Unintended information through timing, power, radio or sound. |
| **Timing attack** | Learning secrets from how long an operation takes. |
| **SPA / DPA** | Simple and differential power analysis: reading keys from power traces. |
| **Fault injection** | Forcing errors with glitches, lasers or electromagnetic pulses. |
| **Glitching** | Briefly disturbing voltage or clock. |
| **Constant-time code** | Code whose timing does not depend on secret data. |
| **Masking** | Mixing secret values with random numbers during computation. |

## How It Works

### Step 1: A timing leak

A password check using `memcmp` stops at the first wrong byte. Correct first bytes take slightly longer, so the attacker guesses one byte at a time.

### Step 2: A power leak

Switching more bits draws more current. Inside AES, power use during one operation depends on key bits. DPA collects thousands of traces, guesses each key byte, and uses statistics to find which guess fits.

### Step 3: A fault

A short voltage dip during a comparison can corrupt one instruction. A branch that should go to "reject" falls through, and unsigned code runs.

### Step 4: The result

The attacker walks away with a key, or code execution. Both need access to the device, which is why this matters most where one device's secret unlocks many.

## A Closer Look: How a Power Trace Reveals a Key

It seems impossible that measuring current could reveal a secret, so let us go slowly.

Each time a transistor changes state, it uses a tiny bit of energy. A number with many 1 bits, moving through a register, draws slightly more current than a number with few. On its own, one measurement is buried in noise.

During AES, the chip combines one byte of the key with one byte of your data. The attacker knows the data, because they sent it. They do not know the key byte, but it has only 256 possible values, a small number for a computer.

So they try each guess. For each one, they predict how many bits would be set for thousands of different inputs, then compare those predictions with the real power traces. The wrong guesses show no pattern. The right guess matches, and stands out as a clear peak.

Repeat for all 16 bytes, and they have the full key. The key is attacked one byte at a time, so the huge number of possible AES keys no longer protects it.

## A Worked Example: Bypassing a Signature Check

A bootloader contains this logic:

```c
if (verify_signature(image) != OK) {
    halt();
}
boot(image);
```

An attacker flashes a modified image, and the check would normally stop it. They connect a small MOSFET to short the core voltage for a few nanoseconds, timed by watching the UART. After a few thousand attempts, one glitch corrupts the branch, and the device boots their image.

The defence is to make one skipped instruction insufficient. The code checks twice, using values that are not simple zero and one, and adds a random delay:

```c
volatile uint32_t ok = verify(image);   /* returns 0x5AA5C33C on success */
random_delay();
if (ok != 0x5AA5C33C) halt();
if (ok != 0x5AA5C33C) halt();
boot(image);
```

Now the attacker must hit two precise moments, at unknown times.

## Common Questions

**Do attackers need expensive equipment?** Not any more. Open hardware costing a few hundred dollars can do this on unprotected chips.

**Do these attacks work remotely?** Power and glitching need physical access. Timing attacks can sometimes work across a network.

**Should every product defend against this?** No. It depends on your threat model, and on what one stolen key would unlock.

**Does hardware AES solve it?** It helps with timing, but plain hardware AES can still leak through power unless it was designed to resist this.

## Under the Hood

CMOS logic draws most of its current when bits change, so a power trace reflects data, which is the root cause of DPA. Hardware countermeasures include masking, shuffling the order of operations, and adding random noise.

Glitch detectors watch the supply and clock, and secure elements add shields and sensors. General-purpose MCUs usually offer far less, and many vendor read-out protections have been bypassed by glitching. Open tools like ChipWhisperer make these attacks affordable, so they are no longer limited to expensive labs.

## Real-World Applications

**Payment cards.** Smart cards are heavily certified against these attacks.

**Automotive keys.** Key fobs have been cloned using power analysis.

**Game consoles.** Voltage glitching has been used to bypass secure boot.

**Crypto wallets.** Hardware wallets have had seeds extracted by glitching.

## Common Mistakes

### Mistake 1: Using memcmp for secrets

**What goes wrong:** Timing reveals how many bytes matched.

**How to avoid it:** Use a constant-time comparison.

### Mistake 2: Secret-dependent branches

**What goes wrong:** Code that branches on key bits leaks through timing and cache.

**How to avoid it:** Use vetted crypto libraries written to run in constant time.

### Mistake 3: One key across all devices

**What goes wrong:** One lab attack breaks every product.

**How to avoid it:** Use per-device keys, so an attack on one device stays on that one device.

## Debugging and Troubleshooting

**Symptom:** A crypto operation time varies with input

**Possible Cause:** Secret-dependent branches or table lookups.

**Investigation Method:** Measure thousands of runs using a GPIO and scope, and compare groups of inputs.

**Resolution:** Switch to constant-time code or hardware crypto.

**Symptom:** Unexplained resets or odd behaviour in protected code during testing

**Possible Cause:** A glitch detector firing, or a marginal supply.

**Investigation Method:** Scope the core rail and read reset-cause flags.

**Resolution:** Fix power integrity, and treat repeated detections as an attack.

## Design Considerations and Best Practices

**Match defences to the threat model.** A thermostat rarely justifies DPA hardening. A payment terminal must have it.

**Limit what one device can reveal.** Per-device keys contain the damage better than any countermeasure.

**Use protected hardware for valuable keys.** Secure elements are designed and tested for this.

**Fail safely and count failures.** Repeated faults can lock the device or wipe its keys.

## Expert Notes

**Duplicate checks need the compiler's cooperation.** An optimiser may merge two identical checks into one. Use `volatile` or hardened libraries so that they remain.

**Avoid boolean results for security decisions.** A value of 0 or 1 is easy to flip with a glitch. Multi-bit constants far apart in value are harder to fault into the right answer.

**Random delays raise the cost, but do not stop the attack.** They force the attacker to collect more data. Combine them with other defences.

## Summary

Chips leak secrets through timing and power, and they can be pushed into mistakes with glitches. These attacks skip the mathematics and go after the hardware. Use constant-time code, duplicate critical checks, keep keys unique to each device, and put valuable keys in hardware that is built to resist physical attack.

## Related Topics

**Prerequisites**

- Threat Modelling
- HSMs and Secure Key Storage

**Next Topics**

- Secure Boot Chain
