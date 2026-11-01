---
title: "Hashes, MACs and Digital Signatures: Proving Integrity and Authenticity"
brief: "How hashes fingerprint data, how MACs and signatures prove who produced it, and why a signature is what secures firmware updates."
order: 32
phase: 7
tags: ["SHA-256", "HMAC", "ECDSA", "Ed25519", "Signature"]
---

A device downloads a firmware update. Before writing it to flash it needs to answer two questions: is this exactly what was released, and did the vendor really release it? A checksum answers neither against an attacker, who can modify the image and recalculate the checksum in seconds.

Hashes, MACs and digital signatures form a ladder. Each adds a guarantee the one before lacks.

## The Fundamental Problem

CRCs detect accidental errors, not deliberate ones, because anyone can compute them. To resist an attacker, a check must depend on something the attacker does not have: a secret key. The next problem is who holds that key. If every device stores it, every device can also forge.

## The Big Picture

Signing uses a private key held only by the producer. Verifying uses the public key, which can safely be stored on every device.

![Firmware is signed with a private key, verified with a public key, then booted](/diagrams/sign_verify.svg)

### In Plain Terms

A hash is a fingerprint for data. Feed in any file and you get a short fixed-size value. Change one bit and the fingerprint looks completely different. You cannot rebuild the file from the fingerprint, just as you cannot rebuild a person from a fingerprint. But anyone can compute a hash, so it proves nothing about who made the data.

A MAC is a fingerprint mixed with a secret password. Only people who know the password can produce the right value. It is like a club whose members share a secret stamp: a stamped letter must come from a member, but you cannot tell which member.

A digital signature is like a personal seal that only you own, with a free public tool that lets anybody check it. Only one person can make it, and everyone can check it. That is why it suits firmware: thousands of devices can check a vendor's signature without any of them being able to create one.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Hash** | A one-way function producing a fixed-size fingerprint. SHA-256 outputs 32 bytes. No key is involved. |
| **Collision resistance** | It is infeasible to find two inputs with the same hash. MD5 and SHA-1 have lost this property. |
| **MAC** | A tag computed from data and a shared secret key. HMAC and CMAC are common. |
| **Digital signature** | A value only the private-key holder can create and anyone with the public key can check. |
| **ECDSA** | Elliptic-curve signature scheme. A P-256 signature is 64 bytes in raw form. |
| **Ed25519** | A modern signature scheme with deterministic signing, avoiding per-signature randomness failures. |

## Comparing the Three

| Tool | Key | Proves | Who can verify | Who can forge |
| --- | --- | --- | --- | --- |
| Hash | None | Matches a trusted reference | Anyone | Anyone, if the reference is not protected |
| MAC | Shared secret | Integrity and authenticity | Key holders | Any key holder |
| Signature | Key pair | Integrity, authenticity, non-repudiation | Anyone with public key | Only the private-key holder |

## How It Works

### Step 1: Hash the data

The signer computes SHA-256 over the firmware image. Signing the short hash is far cheaper than processing the whole file.

### Step 2: Sign the hash

The signer applies the private key, normally inside an HSM on the build system, and attaches the signature to the image.

### Step 3: Verify on the device

The bootloader recomputes the hash and uses the public key from protected storage to check the signature.

### Step 4: Act only on success

If verification fails, the image is rejected and the device stays on its current firmware.

## A Worked Example: Signing a Firmware Release

The build server finishes `firmware.bin`, which is 512 KB. An engineer triggers a release.

**Fingerprint.** SHA-256 reduces the 512 KB image to 32 bytes.

**Sign.** The hash goes to an HSM, which signs it with the vendor's private key. The private key never appears in the build system's memory. The 64-byte signature is attached to the image.

**Deliver.** The update travels through a CDN and over Wi-Fi. None of those need to be trusted, since any change will be detected.

**Check on the device.** The bootloader hashes the received image, then uses the public key stored in protected memory to check the signature. This might take a few hundred milliseconds in software.

**Decide.** A pass means the new image is installed. A failure means it is discarded and the old firmware keeps running.

Now imagine an attacker changes one byte of the image. The hash changes completely, so the signature check fails. To succeed, they need a signature matching their modified image, and that requires the private key, which is locked in the HSM.

You can try the same flow on a PC:

```bash
openssl dgst -sha256 -sign private.pem -out firmware.sig firmware.bin
openssl dgst -sha256 -verify public.pem -signature firmware.sig firmware.bin
```

## Under the Hood

SHA-256 processes data in 64-byte blocks, mixing each block into a 32-byte internal state over 64 rounds. It can be fed in small pieces, which lets a bootloader hash a large image without holding it all in RAM.

HMAC runs the hash twice with the key mixed in, which closes the weakness of simply hashing a key plus the data.

ECDSA verification is much slower than hashing, since it uses curve arithmetic. Verification also uses no secrets, so it does not need to be side-channel resistant. Signing is the sensitive operation, which is why it happens in protected hardware.

CRC is useful but different. It is designed to catch random noise and has no resistance to deliberate changes. Keep CRCs for flash and bus errors, and do not treat them as security.

## Real-World Applications

**Secure boot.** Each boot stage verifies the next stage's signature, forming a chain from immutable ROM.

**Automotive SecOC.** CAN messages carry a truncated CMAC, because signatures are too slow and too large for CAN frames.

**TLS.** Certificates carry signatures, and record protection uses AEAD tags.

**Software packages.** Linux distributions sign package lists so that mirrors do not need to be trusted.

## Common Mistakes

### Mistake 1: Using a plain hash as protection

**What goes wrong:** A SHA-256 sent beside the file protects nothing, since an attacker replaces both.

**How to avoid it:** Hash only with a trusted reference. Otherwise use a MAC or signature.

### Mistake 2: Reusing the ECDSA nonce

**What goes wrong:** ECDSA needs a unique secret value for each signature. Reusing or leaking it reveals the private key, as happened with the PlayStation 3 signing key.

**How to avoid it:** Use a vetted library with RFC 6979 deterministic nonces, or use Ed25519.

### Mistake 3: Public key stored in writable flash

**What goes wrong:** An attacker replaces the public key, then signs their own firmware.

**How to avoid it:** Store the key or its hash in ROM, OTP or a locked region.

### Mistake 4: Time-of-check to time-of-use

**What goes wrong:** The image is verified in external flash, then re-read for execution after an attacker has swapped the chip contents.

**How to avoid it:** Verify the exact copy you will run, ideally in internal memory.

## Debugging and Troubleshooting

**Symptom:** A correctly signed image fails verification on the device, but passes on a PC

**Possible Cause:** The device is hashing a different byte range, often including the signature field, padding or a header.

**Investigation Method:** Print the hash on both sides and compare them. Check exactly where the range starts and ends.

**Resolution:** Define the signed range precisely in the image format.

**Symptom:** Signature length or parsing errors

**Possible Cause:** Mixing formats. OpenSSL outputs ECDSA signatures in DER, of varying length, while many embedded libraries expect a raw 64-byte form.

**Investigation Method:** Inspect the first bytes; DER signatures begin with 0x30.

**Resolution:** Convert between formats in the signing tool.

## Design Considerations and Best Practices

**Hash while you stream.** Update the hash as blocks arrive so that RAM use stays small. Still treat nothing as valid until the final check succeeds.

**Sign metadata too.** Version, target hardware and length belong inside the signed area. Otherwise an attacker can install a valid image for the wrong product.

**Plan for key compromise.** Store more than one public key slot, so a leaked signing key can be retired by an update signed with the backup key.

**Protect the signing process.** A strong key is useless if any developer can ask the server to sign anything. Require approval and keep logs.

## Expert Notes

**Signatures do not stop rollback.** An old, vulnerable image still has a valid signature. Pair verification with a monotonic version counter.

**Use HMAC, not hash(key + data).** Simple constructions with SHA-256 are open to length-extension attacks. HMAC is designed to avoid them.

## Summary

A hash is a fingerprint of data, and anyone can make one. A MAC is a fingerprint mixed with a shared secret, so only key holders can make it. A signature uses a private key to create it and a public key to check it, so anyone can verify but only one party can sign. That makes signatures ideal for firmware: every device can check an update, and none of them can forge one. Keep the private key off the device, and keep the public key where it cannot be changed.

## Related Topics

**Prerequisites**

- Encryption and Decryption

**Next Topics**

- PKI and X.509 Certificates
- Bootloaders and Firmware Updates
