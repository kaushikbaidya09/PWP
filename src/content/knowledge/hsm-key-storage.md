---
title: "HSMs and Secure Key Storage: Keeping Private Keys Private"
brief: "How HSMs, secure elements and TPMs keep keys out of reach, and how firmware uses them through PKCS#11 and OpenSSL providers."
order: 36
phase: 7
tags: ["HSM", "Secure Element", "TPM", "PKCS#11", "OpenSSL Provider"]
---

Every article in this phase ends at the same dependency: a secret key. If an attacker reads a private key from flash with a debug probe, certificates, TLS and signatures all still work, but now they work for the attacker.

A hardware security module changes the rule. Instead of loading a key into memory to use it, firmware sends data to a separate protected device that performs the operation and returns only the result.

## The Fundamental Problem

Software cannot protect a key from software that runs at the same privilege, or from someone with physical access. A key in application RAM can leak through memory bugs, core dumps or debug ports. A key in flash can be read directly, and even encrypted storage needs another key somewhere.

## The Big Picture

The key lives behind a hardware boundary. The application holds only a reference to it.

![An application sends data to an HSM and receives a signature, while the private key stays inside](/diagrams/hsm_boundary.svg)

### In Plain Terms

Think of a bank's safety-deposit vault with a clerk inside. You never take the valuables home. You pass a document through a small window, the clerk stamps it using the seal kept inside, and passes it back. You get the stamped document, but you never touch the seal.

An HSM is that clerk. The application passes in a hash and gets back a signature. The private key stays inside the vault. Even if an attacker fully controls the application, there is nothing to copy. They can ask the clerk to stamp things while they are in control, but they cannot walk off with the seal. Once the device is cleaned up, that attacker has nothing left.

The sizes vary. A secure element is a tiny vault on a circuit board, costing around a dollar or so. A TPM is a standardised version common in PCs. A network HSM is a large rack-mounted vault used by CAs and signing servers. The idea is the same in all of them: use the key without ever exposing it.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **HSM** | Hardware security module: a tamper-resistant device that stores keys and performs cryptography. |
| **Secure element** | A small dedicated security chip on the device's board, usually over I2C or SPI. |
| **TPM** | Trusted Platform Module: a standardised security chip with key storage and measured boot. |
| **TEE** | Trusted execution environment: an isolated CPU mode, such as Arm TrustZone. |
| **Non-exportable key** | A key that hardware will use but never reveal. |
| **PKCS#11** | A standard C API, known as Cryptoki, for talking to cryptographic tokens. |
| **OpenSSL provider** | An OpenSSL 3 plug-in that routes operations to custom implementations, including hardware. |

## Choosing a Protection Level

| Option | Protects against | Typical use |
| --- | --- | --- |
| Internal flash + read-out protection | Casual extraction | Low-cost devices |
| TEE / TrustZone | Compromised normal-world software | SoCs with Arm security extensions |
| Secure element / TPM | Software compromise, most physical attacks | Connected products, device identity |
| Network or PCIe HSM | Strong physical attack, with certification | Signing servers, CAs, factories |

## How It Works

### Step 1: Generate the key inside the hardware

The device creates the key from its internal TRNG and marks it non-exportable. It returns the public key, which goes into a CSR.

### Step 2: Refer to keys by handle

The application stores a label or slot number, not key bytes. Stealing it gains nothing.

### Step 3: Route operations to the hardware

The TLS library needs a signature during the handshake. Rather than computing it in software, it passes the hash through a provider or PKCS#11 module to the HSM.

### Step 4: Control use

The HSM enforces policy: key usage limits, authentication PINs, and sometimes attestation that proves a key was created inside it.

## Integrating With TLS

On Embedded Linux, OpenSSL 3 selects implementations through providers. An application can load a certificate as usual but reference the private key by a URI, so TLS works unchanged while signing happens in hardware. Each request passes from the application to OpenSSL, then to the HSM provider and its driver, and finally to the HSM over I2C, SPI or PCIe.

Writing a custom provider means implementing key management and signature operations for the hardware. Application code stays the same, and only the private key operation moves. On MCUs, mbedTLS offers a similar route through the PSA Crypto driver interface.

## A Worked Example: A TLS Connection With an HSM

An Embedded Linux gateway must connect with mTLS, and its private key is inside a secure element on the I2C bus.

**At the factory.** The gateway asks the chip to generate a key pair. The chip keeps the private key in slot 0 and returns the public key. A CSR is built, the CA signs it, and the certificate is stored in ordinary flash. It is public, so that is fine.

**At start-up.** The application loads the certificate from a file. For the private key, it gives OpenSSL a reference such as a URI, rather than key bytes. The HSM provider takes care of everything else.

**During the handshake.** OpenSSL reaches the CertificateVerify step and needs a signature. It calls the provider, which sends the 32-byte hash over I2C. The secure element signs internally and returns the signature. The whole operation takes tens of milliseconds, and the private key has never been in RAM.

**After the handshake.** Session keys are derived on the main CPU, so AES traffic runs at full speed. The HSM protects identity, not every packet.

**If the gateway is hacked.** The attacker can use the key while they remain inside, but they cannot copy it. Fix the software and rotate the device's access, and the identity is safe again. With a key file on disk, you would have to replace the identity altogether.

## Under the Hood

A secure element is a small computer of its own, with a protected CPU, its own memory and a TRNG. It is built to resist physical attack, with shields against probing, sensors for abnormal voltage or temperature, and countermeasures against power analysis.

Commands normally use a defined protocol, such as APDU-style packets or vendor-specific commands over I2C or SPI. Slots hold keys with policies attached: for example, sign only, no export, or usable only after a PIN or an authenticated session.

OpenSSL 3 replaced the older engine API with providers. A provider registers implementations of key management, signatures and key exchange. When it loads a key by URI, OpenSSL keeps an opaque handle instead of key material. The same application code then works with software keys or hardware keys.

PKCS#11 is an older, wider standard. Applications open a session with a token, find objects and call `C_Sign`. A PKCS#11 module on Linux can bridge the same hardware to many programs. To explore a token, use `pkcs11-tool --list-objects`, and to see what OpenSSL has loaded, use `openssl list -providers`.

## Real-World Applications

**Device identity.** Secure elements such as NXP EdgeLock and Microchip ATECC parts store IoT device keys.

**Code signing.** Vendors keep firmware signing keys in network HSMs or cloud KMS services.

**Certificate authorities.** Public CAs must keep their keys in certified HSMs.

**Payments and SIMs.** Bank cards and SIM cards are secure elements in everyday use.

## Common Mistakes

### Mistake 1: Reading the key out to use it

**What goes wrong:** A key loaded from a secure chip into RAM for software signing gets none of the benefit.

**How to avoid it:** Use the chip's sign and ECDH commands so the key never leaves.

### Mistake 2: Plain bus between host and chip

**What goes wrong:** An attacker probes I2C or SPI, then reads secrets or issues commands from their own controller.

**How to avoid it:** Enable the encrypted, authenticated session the device provides, and bind it to the host with a pairing key.

### Mistake 3: The HSM as a free signing oracle

**What goes wrong:** Malware on the host cannot read the key, but it can ask the HSM to sign anything.

**How to avoid it:** Secure the host with secure boot, restrict key usage, and rate-limit or authorise operations.

### Mistake 4: Ignoring performance

**What goes wrong:** A secure element may take tens of milliseconds to sign, and doing this on every operation stalls the system.

**How to avoid it:** Use the HSM for identity at the handshake, then use fast session keys for data.

## Debugging and Troubleshooting

**Symptom:** OpenSSL reports that it cannot load the private key

**Possible Cause:** The provider is not loaded, or the key URI or slot is wrong.

**Investigation Method:** Run `openssl list -providers`, check `openssl.cnf`, and confirm the slot with the vendor's tool.

**Resolution:** Fix the configuration, or load the provider explicitly in code.

**Symptom:** Signing fails intermittently under load

**Possible Cause:** Two threads share one bus or session, or the chip went to sleep mid-transaction.

**Investigation Method:** Capture I2C with a logic analyzer and look at error codes.

**Resolution:** Serialise access with a mutex and handle wake and retry.

**Symptom:** Handshakes suddenly become very slow

**Possible Cause:** Slow bus speed or retries on a noisy line.

**Investigation Method:** Time each HSM command and scope the signal lines.

**Resolution:** Raise the clock within limits, and fix pull-ups or routing.

## Design Considerations and Best Practices

**Generate keys in the hardware whenever possible.** A key injected from outside existed somewhere else, even if briefly.

**Limit each key to one job.** Separate keys for identity, signing and encryption, with matching slot policies, reduce the damage of misuse.

**Design for failure.** Chips can fail, and non-exportable keys cannot be restored. Devices need re-provisioning, and signing keys need a controlled backup.

**Mind wear and cost.** Secure elements limit how often slots and counters can be written. Do not put a counter updated every second into one.

## Expert Notes

**Certification levels mean something specific.** FIPS 140-3 and Common Criteria describe tested properties. Check what was actually evaluated rather than relying on the label.

**Side channels still matter.** Software crypto on an MCU can leak keys through power and timing. Dedicated security hardware adds countermeasures, which is another reason to keep signing inside it.

**Plan for key lifecycle.** Cover generation, backup where allowed, rotation and destruction. Decide at design time how a device is decommissioned.

## Summary

Every security system depends on keeping a private key secret, and software alone cannot fully do that. An HSM is like a vault with a clerk inside: your program passes data in and gets a signature back, while the key never comes out. Even an attacker who takes over the software cannot copy the key. Sizes range from a tiny secure element chip to a rack-mounted unit. Create keys inside the hardware, protect the link to it, and remember that a hacked program can still ask the vault to sign things.

## Related Topics

**Prerequisites**

- mTLS and TLS-PSK
- PKI and X.509 Certificates

**Next Topics**

- Embedded Security Fundamentals
- Bootloaders and Firmware Updates
