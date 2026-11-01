---
title: "Security Goals: Confidentiality, Integrity and Authenticity"
brief: "The three properties every secure embedded system must provide, what attack each one stops, and which cryptographic tool delivers it."
order: 29
phase: 7
tags: ["Confidentiality", "Integrity", "Authenticity", "Threat Model"]
---

A connected sensor sends a temperature reading to a cloud server. An attacker on the same network could read it, change 21 °C to 95 °C so a safety system shuts a plant down, or send fake readings from a device that does not exist. These are three different attacks, and encryption alone stops only the first.

Security engineering starts by naming exactly what must be protected. Almost every requirement reduces to three goals: confidentiality, integrity and authenticity. Knowing which one you need tells you which tool to use.

## The Fundamental Problem

Embedded data crosses channels you do not control: Wi-Fi, cellular links, CAN buses, and flash chips that can be desoldered. Anyone with access to those channels can read, change, replay or forge what passes through.

The obvious fix, "just encrypt it", is the classic mistake. Encryption hides data, but it does not by itself prove that data is unchanged or who sent it. With a stream-style cipher, flipping one bit of ciphertext flips the same bit of plaintext, and the receiver decrypts it without noticing.

## The Big Picture

Each goal answers a different question, and each has its own tool. Modern protocols such as TLS combine all three.

![Confidentiality uses encryption, integrity uses a MAC, and authenticity uses a signature](/diagrams/security_goals.svg)

### In Plain Terms

Think about sending a letter that matters. Confidentiality is the sealed envelope: nobody on the way can read it. Integrity is a wax seal that breaks if someone opens it and changes the contents. Authenticity is your handwriting and signature: the reader knows the letter really came from you.

Each protection is separate. A sealed envelope can still be forged by someone pretending to be you. A signed postcard can be read by every postal worker. Secure systems usually need all three, so it helps to ask about each one separately instead of asking "is it secure?"

There is a fourth idea, freshness. Imagine someone photographs your signed note saying "let the bearer in", then shows it again next month. The note is genuine, but the moment has passed. Replaying an old valid message is one of the most common attacks on simple devices.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Confidentiality** | Only authorised parties can read the data. Provided by encryption. |
| **Integrity** | Any change to the data is detected. Provided by MACs, AEAD tags and signatures. |
| **Authenticity** | The data really came from who it claims. Provided by MACs (shared key) or signatures (private key). |
| **Non-repudiation** | The sender cannot later deny sending. Requires signatures, because a shared MAC key is held by both sides. |
| **Freshness** | The message is new, not a replay of an old one. Provided by nonces, counters or timestamps. |
| **Threat model** | A written statement of what you protect, from whom, and what you assume they can do. |

## How It Works

### Step 1: Write the threat model

List the assets (firmware, keys, sensor data, commands) and the attackers (remote, on the local network, or holding the device). A smart lock and a weather sensor need very different protection.

### Step 2: Map each asset to a goal

A firmware image is usually public, so it needs integrity and authenticity, not confidentiality. A Wi-Fi password needs confidentiality. A door-unlock command needs authenticity and freshness, because a replayed valid command still opens the door.

### Step 3: Choose the tool

Use authenticated encryption for data in transit, signatures for firmware, and a protocol such as TLS when two devices must talk over a network. Do not design your own protocol.

### Step 4: Protect the keys

Every tool above depends on a secret key. If an attacker reads it from flash, all three goals fall at once. Key storage is therefore part of the design, not an afterthought.

## A Worked Example: A Smart Door Lock

Consider a lock that opens when a phone sends an "unlock" message over Bluetooth. Let us add protections one at a time and see what each one fixes.

**No protection.** The message is plain text. Anyone nearby with a cheap radio can see it and send their own. The lock opens for anybody.

**Add encryption only.** Now the message is unreadable, which feels safe. But the attacker does not need to read it. They simply record the encrypted message and play it back. The lock decrypts it and opens. Confidentiality did not help, because the problem was never secrecy.

**Add a MAC.** The lock now checks that the message was produced by someone holding the secret key. The attacker cannot create a new message, which gives authenticity and integrity. Replay still works, because the recorded message is still valid.

**Add a challenge.** The lock first sends a random number, and the phone must include that number in its protected reply. Each exchange is different, so a recording is useless. Freshness is solved.

Notice what happened. Encryption, the first thing most people reach for, solved none of the real problems. Naming the goal first leads straight to the right tool.

## Under the Hood

These goals are built from a small number of mathematical tools. Encryption gives confidentiality by making output look random to anyone without the key. A MAC gives integrity and authenticity by mixing a secret key into a fingerprint of the data. A signature does the same using a private key, so verifiers need no secret at all.

On a microcontroller, each tool has a cost. AES and SHA-256 are usually handled by a hardware peripheral and take microseconds. Signature checks take much longer and need more stack. This is why a design typically uses a signature once, at boot or at connection time, and then uses symmetric tools for everything else.

Freshness has its own hardware needs. A counter must survive a reset, so it needs flash, EEPROM or a dedicated monotonic counter. Flash wears out, so counters are written in steps. A random challenge needs a good hardware random number generator, because a predictable challenge is no challenge at all.

## Real-World Applications

**Automotive.** A brake command on CAN must be authentic and fresh, while its value is not secret. AUTOSAR SecOC therefore adds a truncated MAC and a freshness counter without encrypting the data.

**Medical.** An insulin pump needs all of the goals: patient data is confidential, and a dose command must be authentic, unmodified and fresh.

**Consumer IoT.** A firmware update is usually public, so signing it matters far more than encrypting it. A Wi-Fi password stored on the device is the opposite: it needs confidentiality above all.

**Industrial.** In plant control, availability and integrity come before secrecy. Nobody minds a valve position being seen, but it must never be forged.

## Common Mistakes

### Mistake 1: Treating encryption as integrity

**What goes wrong:** Encrypted commands are accepted without a check, so an attacker alters them in transit without ever decrypting them.

**How to avoid it:** Use an AEAD mode such as AES-GCM, or add a MAC.

### Mistake 2: Forgetting replay

**What goes wrong:** A captured, perfectly valid "unlock" message works again next week.

**How to avoid it:** Include a counter or a server-issued nonce and reject anything already seen.

### Mistake 3: Encrypting firmware instead of signing it

**What goes wrong:** Firmware is encrypted with a key shared by every device. One extracted key lets an attacker build and install firmware for the whole fleet.

**How to avoid it:** Sign firmware with a private key that never leaves the build system. Devices hold only the public key.

## Debugging and Troubleshooting

**Symptom:** Valid messages are randomly rejected after a device restarts

**Possible Cause:** The replay counter was reset to zero, so new messages look older than the last accepted one.

**Investigation Method:** Log the received counter and the stored counter on both sides around a reboot.

**Resolution:** Persist the counter, or restore it with a safe jump forward at boot.

**Symptom:** The system passes all tests, but a recorded message still works

**Possible Cause:** Tests only checked valid and malformed messages, never old valid ones.

**Investigation Method:** Capture real traffic, then send it again unchanged.

**Resolution:** Add replay tests to the test plan and require a nonce or counter.

## Design Considerations and Best Practices

**Decide per asset, not per product.** Applying the same protection everywhere wastes CPU time and may still miss the real risk. A table of asset, goal and tool makes gaps obvious.

**Protect in the right layer.** If data crosses several hops, protection between each hop leaves it exposed inside every gateway. End-to-end protection stays valid through untrusted middleboxes.

**Fail closed.** When a check fails, reject the message and record the event. A device that "continues anyway" has no security at all.

**Keep room to change.** Algorithms age, and a device may stay in the field for fifteen years. Leave space for longer keys and a way to update algorithms.

## Expert Notes

**Availability is a security goal too.** Many textbooks add it to the list. A device that can be knocked offline by malformed packets has a security problem even if no data leaks.

**Most breaks do not attack the mathematics.** Real attacks go after debug ports, leaked keys, weak random numbers and logic errors. Strong algorithms simply move the attacker to the weakest remaining link.

**Write down what you are not protecting.** Stating that you do not defend against a lab with a decapped chip is a useful decision. It keeps the budget focused on the attackers who will actually appear.

## Summary

Security comes down to three separate questions. Can outsiders read this? That is confidentiality. Has it been changed? That is integrity. Did it really come from who it claims? That is authenticity. Each question has its own tool, and encryption alone answers only the first. You also need to check that a message is new, so an old recording cannot be replayed. Start by deciding which questions matter for each piece of data, use standard tools for those, and guard the keys.

## Related Topics

**Next Topics**

- Symmetric and Asymmetric Keys
- Hashes, MACs and Digital Signatures
- Embedded Security Fundamentals
