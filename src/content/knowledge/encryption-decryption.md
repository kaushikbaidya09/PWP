---
title: "Encryption and Decryption: From AES to Authenticated Encryption"
brief: "How block ciphers, modes of operation and AEAD turn a key into usable protection, and why reusing a nonce can break everything."
order: 31
phase: 7
tags: ["AES", "AES-GCM", "ChaCha20", "AEAD", "Nonce"]
---

AES itself encrypts exactly 16 bytes. A firmware image or sensor log is far larger, so something must define how those 16-byte blocks combine. That choice, the mode of operation, decides whether a design is secure. Teams regularly use a strong cipher in a weak mode and end up with data that is scrambled but not protected.

## The Fundamental Problem

Encrypting each block separately with the same key leaks patterns, because identical plaintext blocks produce identical ciphertext. Encrypted data also needs protection against tampering, which a cipher alone does not give. And encrypting the same message twice must not produce the same output, or an observer can tell when values repeat.

## The Big Picture

Modern designs use AEAD: authenticated encryption with associated data. One operation gives confidentiality and integrity together.

![Plaintext is encrypted into ciphertext with a tag, then decrypted back into plaintext](/diagrams/aead_flow.svg)

### In Plain Terms

Encryption scrambles data in a way that only someone with the key can reverse. Decryption is that reversal. Think of a safe: the key does not change what is inside, it only controls who can get to it.

AES is like a machine that scrambles exactly 16 bytes at a time. A mode of operation is the set of instructions for feeding it a long message. Counter mode, used by GCM, does something neat. Instead of scrambling your data directly, it scrambles the numbers 1, 2, 3 and so on to make a long random-looking stream, then mixes that stream with your message using XOR. XOR is reversible: mixing with the same stream again gives back the original.

That leads to the most important rule. The stream depends on the key and the nonce. If you use the same pair twice, you get the same stream twice, and an attacker who compares the two messages can cancel the stream out. It is like a one-time pad used twice.

The tag is the tamper seal. Think of it as a fingerprint of the sealed message that only key holders can produce. The receiver checks the seal before trusting anything inside.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Plaintext / ciphertext** | The readable data, and its encrypted form. |
| **Block cipher** | Transforms fixed-size blocks under a key. AES uses 128-bit blocks. |
| **Mode of operation** | The rule that applies a block cipher to data of any length, such as CTR or GCM. |
| **Nonce / IV** | A number used once with a key, so identical messages encrypt differently. It does not have to be secret. |
| **AEAD** | Encryption that also produces an authentication tag. AES-GCM, AES-CCM and ChaCha20-Poly1305 are examples. |
| **Associated data (AAD)** | Data sent in the clear, such as a header, that the tag still protects. |
| **Tag** | A short value proving that ciphertext and AAD are unchanged. |

## How It Works

### Step 1: Pick a unique nonce

For AES-GCM this is normally 96 bits. A message counter is the safest choice on embedded devices, as long as it survives resets and never repeats under the same key.

### Step 2: Encrypt

GCM runs AES in counter mode: it encrypts successive counter values to make a keystream, then XORs that with the plaintext. Ciphertext is therefore the same length as the plaintext.

### Step 3: Compute the tag

The ciphertext and AAD pass through an authenticator, producing a 16-byte tag. The device sends nonce, AAD, ciphertext and tag.

### Step 4: Verify, then decrypt

The receiver recomputes the tag and compares it in constant time. If it does not match, the message is rejected and nothing is released to the application.

## Choosing a Mode

| Mode | Authenticated | Use it for |
| --- | --- | --- |
| ECB | No | Never for real data; it leaks patterns. |
| CBC | No | Legacy only; needs a separate MAC and random IVs. |
| CTR | No | A building block; add a MAC. |
| GCM | Yes | Default where AES hardware exists. |
| CCM | Yes | Constrained links such as BLE and Zigbee. |
| ChaCha20-Poly1305 | Yes | Fast in software on devices without AES hardware. |

## A Worked Example: Encrypting a Sensor Reading

A device wants to send the 12-byte reading `temp=21.5;ok` to a gateway with AES-128-GCM.

**Header.** The device ID and message type must stay readable so the gateway can route the packet, but they must not be altered. They go in as associated data: not encrypted, yet covered by the tag.

**Nonce.** The device uses its message counter, say 1041, padded to 12 bytes. It saves progress so the number can never repeat, even after a reset.

**Encrypt.** AES encrypts counter blocks to produce a keystream, which is XORed with the 12 bytes. The output is 12 unreadable bytes. Note that encryption did not make the message longer.

**Tag.** A 16-byte tag is computed over the header and ciphertext. The packet carries header, nonce, ciphertext and tag: 28 bytes of overhead on a 12-byte reading. On LoRa or NB-IoT links that matters, which is why shorter tags are sometimes used, with less forgery protection.

**Decrypt.** The gateway recomputes the tag first. If even one bit of the header or ciphertext changed, the tags differ and the packet is dropped. Only then does it decrypt.

## Under the Hood

On a typical MCU, the AES peripheral takes a key and data block through registers or DMA, and finishes a block in tens of clock cycles. That offloads the CPU, but it creates new concerns. Keys in peripheral registers can be read by privileged code, and some parts offer key slots that software can use but not read.

GCM's tag uses multiplication in a special number field called GHASH. Some MCUs accelerate this and others do it in software, which can make the tag slower than the encryption.

DMA is common for large transfers. Remember that with cached memory, such as on a Cortex-M7, the CPU and DMA can see different data. Cache must be cleaned or invalidated around each transfer, or the output is silently wrong.

Decryption time also needs care. If a device takes visibly longer to reject one bad message than another, that difference can leak information, so comparison and error handling should not depend on secret data.

## Real-World Applications

**Network traffic.** TLS 1.3 uses only AEAD ciphers, mostly AES-GCM and ChaCha20-Poly1305.

**Low-power radios.** BLE and Zigbee use AES-CCM, which needs only AES encryption hardware and has low overhead.

**Storage.** Android and Linux full-disk encryption use AES-XTS, since a sector must keep its exact size.

**Firmware protection.** Some vendors encrypt images to protect intellectual property, and pair that with a signature for authenticity.

## Common Mistakes

### Mistake 1: Reusing a nonce

**What goes wrong:** Two GCM messages with the same key and nonce share a keystream. XORing them reveals information about both plaintexts, and the authentication key can be recovered, allowing forgery.

**How to avoid it:** Use a persistent counter. If the counter state might be lost, rotate the key.

### Mistake 2: Using decrypted data before checking the tag

**What goes wrong:** Streaming APIs tempt code into acting on plaintext that later fails verification.

**How to avoid it:** Buffer the message and release nothing until the tag verifies.

### Mistake 3: Comparing tags with memcmp

**What goes wrong:** An early exit leaks timing that helps an attacker forge a tag byte by byte.

**How to avoid it:** Use a constant-time comparison from your crypto library.

## Debugging and Troubleshooting

**Symptom:** Decryption returns an authentication failure on every message

**Possible Cause:** Key, nonce or associated data differs between the two sides. A one-byte header difference is enough.

**Investigation Method:** Compare all inputs in hex on both sides, then test with a published AES-GCM test vector.

**Resolution:** Fix the mismatch. Agree on byte order and exact AAD contents in the protocol specification.

**Symptom:** Encryption output is correct on the bench, but wrong on some messages with DMA

**Possible Cause:** Stale data caused by cache, or a buffer that is not correctly aligned.

**Investigation Method:** Disable the cache to see if the problem disappears.

**Resolution:** Clean and invalidate cache lines around DMA, or use non-cacheable buffers.

## Design Considerations and Best Practices

**Choose a nonce strategy first.** It decides your storage needs and failure modes. A counter is simple but must survive resets. A random 96-bit nonce is safe only for a limited number of messages per key.

**Rotate keys.** GCM has usage limits, and rotation limits the damage of any leak. Session keys from a handshake make this automatic.

**Keep tags full length unless you must trim them.** A shorter tag makes forgery easier. Only shorten it after working out how many attempts an attacker gets.

**Use a tested library.** mbedTLS, wolfSSL and PSA Crypto have been reviewed by many people. Small mistakes in crypto code do not cause crashes; they silently destroy the security.

## Expert Notes

**Flash encryption is a different problem.** Encrypted external flash needs random access and no room for tags, so XTS or vendor modes are used. They hide data but do not fully detect tampering.

**Counters after reset.** Save the counter ahead in steps, and on boot skip past the last saved value. Skipping numbers is harmless; repeating them is not.

## Summary

Encryption scrambles data so that only someone with the key can read it, and decryption reverses that. AES scrambles only 16 bytes at a time, so a mode decides how to handle longer data. Choose a mode that also adds a tag, a tamper seal, so changes are detected: AES-GCM is the usual choice. Two rules matter most. Never use the same nonce twice with the same key, and never trust decrypted data until the tag has been checked.

## Related Topics

**Prerequisites**

- Symmetric and Asymmetric Keys

**Next Topics**

- Hashes, MACs and Digital Signatures
- TLS
