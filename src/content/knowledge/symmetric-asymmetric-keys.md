---
title: "Symmetric and Asymmetric Keys: Choosing the Right Cryptography"
brief: "How shared-key and public-key cryptography differ, why real systems use both, and what key exchange and key sizes mean on small devices."
order: 30
phase: 7
tags: ["AES", "ECC", "RSA", "ECDH", "Key Exchange"]
---

A fleet of 10,000 devices must talk securely to one server. Give them all the same secret and one extracted device compromises the fleet. Give each its own secret and the server must store and protect 10,000 of them. How can two parties that have never met agree on a secret over a network anyone can read?

Cryptography answers this with two kinds of key. Almost every secure system, including TLS, uses both, because each solves the problem the other cannot.

## The Fundamental Problem

Fast encryption needs both sides to hold the same secret, but delivering that secret safely is itself a secure-communication problem. Public-key cryptography breaks this circle, yet it is far too slow to protect bulk data, particularly on a microcontroller.

## The Big Picture

Symmetric keys do the bulk work. Asymmetric keys handle the introduction: they prove identity and establish the shared secret.

![Asymmetric cryptography agrees a session key, and symmetric cryptography encrypts the data](/diagrams/key_types.svg)

### In Plain Terms

A symmetric key works like a house key: the same key locks and unlocks, and everyone who needs entry must have a copy. It is simple and fast, but handing out copies safely is the hard part.

An asymmetric key pair works like a padlock and its key. You can hand open padlocks to the whole world. Anyone can snap one shut around a message, but only you hold the key that opens it. The public key is the padlock; the private key is the key that never leaves your pocket.

Key exchange is even cleverer. A well-known analogy uses paint. Two people each start with a shared common colour and add their own secret colour. They swap the mixtures in public, then each adds their secret colour again. Both end up with the same final colour, while an onlooker who saw only the mixtures cannot separate the paint to work out the result. ECDH does this with mathematics instead of paint.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Symmetric key** | One secret shared by both sides, used to encrypt and decrypt. Example: AES. |
| **Asymmetric key pair** | A private key kept secret and a mathematically linked public key that can be shared freely. |
| **RSA** | Public-key system based on factoring large numbers. Needs large keys. |
| **ECC** | Elliptic-curve cryptography. Far smaller keys for the same strength, which suits embedded devices. |
| **ECDH / ECDHE** | Key agreement on elliptic curves: each side combines its private key with the other's public key and both reach the same secret. The final E means ephemeral: new keys every session. |
| **Forward secrecy** | Stealing a long-term key later does not expose past sessions, because the session keys were ephemeral. |
| **KDF** | Key derivation function. Turns a shared secret into properly distributed session keys. Example: HKDF. |

## How It Works

### Step 1: Each side creates a key pair

In ECDHE, the device and server each generate a fresh private key from a strong random source and compute the matching public key.

### Step 2: They swap public keys

Public keys can cross an open network. An eavesdropper sees both but cannot compute the secret from them.

### Step 3: Each computes the same secret

Each side multiplies its own private key by the other's public key. The maths gives both the same result without that result ever being sent.

### Step 4: Derive session keys

The shared secret goes through a KDF to produce AES keys. All further traffic uses fast symmetric encryption.

### Step 5: Authenticate the exchange

Plain ECDH does not show who is on the other end, so a man-in-the-middle could run one exchange with each side. A signature made with a long-term private key, checked through a certificate, closes that gap.

## Key Sizes

Keys of different types are not comparable by length. These sizes give roughly equal strength:

| Security level | Symmetric | ECC | RSA |
| --- | --- | --- | --- |
| 112-bit | 3DES (legacy) | 224-bit | 2048-bit |
| 128-bit | AES-128 | 256-bit (P-256) | 3072-bit |
| 256-bit | AES-256 | 521-bit | 15360-bit |

On a Cortex-M, a P-256 operation in software can take hundreds of milliseconds, while hardware AES encrypts in microseconds. That gap is why asymmetric cryptography is used once per session and symmetric for everything after.

## A Worked Example: A Sensor Connects to the Cloud

A sensor has just woken up and must send a reading. It has never exchanged a secret with this server session before.

The sensor generates a new temporary private key and its public key. This takes tens to hundreds of milliseconds in software, or far less with hardware help. It sends the public key to the server, in full view of anyone listening.

The server does the same and sends back its own public key, along with a signature proving it is the genuine server. The sensor checks that signature.

Now each side combines its own private key with the other's public key, and they arrive at the same number. Neither side ever sent it. They feed this number into a KDF to produce AES keys.

From here the sensor uses AES, which takes microseconds per block. When the session ends, both sides destroy the temporary keys. If an attacker recorded everything and steals the server's long-term key next year, they still cannot recover this session. That is forward secrecy.

The pattern to remember: asymmetric cryptography for the first few messages, symmetric cryptography for everything after.

## Under the Hood

AES works by repeatedly substituting and shuffling bytes for 10 rounds with a 128-bit key. These are simple operations, which is why hardware does them so quickly.

ECC uses a very different idea. Points on a curve can be "multiplied" by a number. Going forward is easy: given a number and a starting point, you can compute the result. Going backward is believed to be infeasible: given the result, you cannot find the number. The private key is that number, and the public key is the resulting point.

That forward step involves hundreds of big-number operations on 256-bit values. A 32-bit CPU must work through them in small pieces, so RAM use and time both climb. Many MCUs add a public-key accelerator, such as the PKA block on STM32 parts, to do this work faster.

Implementation also matters. A naive ECC routine takes different time depending on key bits, and that timing can leak the key. Good libraries use constant-time code, which is another reason not to write your own.

## Real-World Applications

**Wi-Fi WPA3.** A password-based key exchange sets up a session, then AES protects the traffic.

**Bluetooth LE Secure Connections.** ECDH on P-256 agrees a key during pairing, and AES-CCM encrypts the link.

**Firmware updates.** The device stores a public key and verifies vendor signatures. A symmetric-only design would have to store a secret capable of forging firmware.

**Automotive networks.** In-vehicle ECUs often use shared symmetric keys for speed, because a CAN frame cannot wait for a signature check.

## Common Mistakes

### Mistake 1: One symmetric key across a product line

**What goes wrong:** Extracting the key from one unit breaks every unit.

**How to avoid it:** Give each device a unique key, derived or provisioned at manufacture.

### Mistake 2: Weak random numbers

**What goes wrong:** Keys generated from a timer or an unseeded PRNG can be predicted, so the mathematics no longer matters.

**How to avoid it:** Use the hardware TRNG and check its health status.

### Mistake 3: Unauthenticated key exchange

**What goes wrong:** ECDH without identity checks lets a man-in-the-middle read everything.

**How to avoid it:** Always authenticate the exchange with a certificate or a pre-shared key.

## Debugging and Troubleshooting

**Symptom:** Both sides complete key exchange, but decryption fails immediately

**Possible Cause:** The sides derived different keys, often because of byte order, a different KDF input or a different curve.

**Investigation Method:** On test keys only, print the shared secret and derived key on both sides and compare them.

**Resolution:** Align encoding and KDF parameters, and test against known vectors from the standard.

**Symptom:** Key generation occasionally hangs or fails on boot

**Possible Cause:** The TRNG clock is not enabled, or a health test has failed.

**Investigation Method:** Check the RNG status and error flags and confirm its clock source.

**Resolution:** Enable the clock, handle seed errors and never fall back to a weak generator.

## Design Considerations and Best Practices

**Use the smallest tool that fits.** If only two parts of one product must trust each other, a provisioned symmetric key can be enough. Adding public-key maths brings code size and latency.

**Budget for the handshake, not just the data.** Measure the energy of each key exchange. On a battery device the handshake can use more power than the data it protects, so reuse sessions where you can.

**Separate keys by purpose.** Do not encrypt and authenticate with one key. Derive different keys with a KDF, so a weakness in one use does not spread.

**Prefer hardware acceleration.** It is faster and uses less energy. It may also be more resistant to side-channel attacks, but confirm that in the vendor documentation.

## Expert Notes

**Prefer ECC on constrained devices.** A P-256 public key is 64 bytes of coordinates; an equivalent RSA key is around 384 bytes, and RSA private-key operations are far slower.

**Plan for post-quantum change.** A large quantum computer would break RSA and ECC, but not AES with adequate key lengths. NIST has standardised ML-KEM and ML-DSA. Products with long field lives should keep their cryptography updatable.

## Summary

Symmetric cryptography uses one shared key, like a house key: it is fast, but getting a copy safely to the other side is hard. Asymmetric cryptography uses a public key and a private key, like an open padlock and its key: it solves the sharing problem, but it is slow. Real systems use both. The slow method agrees on a secret once, then the fast method protects all the data. Give every device its own keys, and always use a true random source to create them.

## Related Topics

**Prerequisites**

- Security Goals

**Next Topics**

- Encryption and Decryption
- Hashes, MACs and Digital Signatures
- TLS
