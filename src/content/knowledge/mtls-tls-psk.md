---
title: "mTLS and TLS-PSK: Authenticating Both Ends"
brief: "How mutual TLS and pre-shared keys let a server identify each device, and how to choose between certificates and PSKs for a fleet."
order: 35
phase: 7
tags: ["mTLS", "TLS-PSK", "Device Identity", "Client Certificate"]
---

Standard TLS proves the server's identity to the client, not the reverse. That suits a web browser, where a password later identifies the user. A headless sensor has no user to type anything, yet the cloud must know which device is connecting and refuse clones.

Two TLS options solve this. Mutual TLS gives each device its own certificate. TLS-PSK skips certificates and relies on a secret shared in advance.

## The Fundamental Problem

Putting a token or password in firmware is weak: one value often ends up shared, it is sent to the server on every connection, and it is easily stolen. Device authentication should be part of the handshake and, ideally, should never reveal the secret.

## The Big Picture

Both methods extend the TLS handshake. They differ in what proves identity, and so in what the device must store and compute.

![A device authenticates to a server with a certificate in mTLS, or a shared key in TLS-PSK](/diagrams/mtls_psk.svg)

### In Plain Terms

Normal TLS is like checking a shop's licence on the wall before you hand over your money. You know who the shop is, but the shop knows nothing about you. Mutual TLS is like a secure building where the guard shows a badge and then checks yours too. Both sides prove their identity.

With mTLS the device holds a personal ID card, its certificate, and a private key that proves the card is really its own. The server does not keep a list of every device's secret. It only needs to know which authority issues valid cards.

TLS-PSK is more like a shared password that two friends agreed on in person. No ID cards are involved. Each side simply proves it knows the secret, and it does so without ever sending it. This is simple and quick, but the server must keep a copy of every secret, which makes that list very valuable.

Both approaches avoid the weakness of a plain password, since the secret itself never crosses the network.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **mTLS** | Mutual TLS: the client also presents a certificate and proves it holds the private key. |
| **Client certificate** | A certificate identifying a device, often with a serial number in the subject or SAN. |
| **CertificateRequest** | The server message asking the client to authenticate. |
| **PSK** | Pre-shared key: a symmetric secret both sides already hold. |
| **PSK identity** | A label telling the server which key to use. Sent in clear. |
| **psk_dhe_ke** | The TLS 1.3 mode combining a PSK with ECDHE to give forward secrecy. |
| **psk_ke** | PSK only: no ECDHE, and so no forward secrecy. |

## How It Works

### mTLS Flow

The server adds CertificateRequest to its flight. After validating the server, the client returns its Certificate and a CertificateVerify signed with its private key, then Finished. The server validates the chain against its device CA and maps the certificate to a device record.

The private key stays on the device and is never transmitted. A compromised server cannot impersonate the device, because it holds only public keys.

### TLS-PSK Flow

The client sends a PSK identity and a binder, a MAC proving knowledge of the key, in ClientHello. The server finds the key by identity and verifies the binder. With `psk_dhe_ke`, both sides also run ECDHE, and the session keys depend on both secrets.

No certificates or signatures are involved, which saves code, RAM, bandwidth and time.

## Choosing Between Them

| Factor | mTLS | TLS-PSK |
| --- | --- | --- |
| Stored on device | Private key, certificate, CA | Symmetric key, identity |
| Stored on server | Only CA and device records | Every device key, as secrets |
| Server breach | Does not expose device keys | Exposes all PSKs in that database |
| Handshake cost | Signatures and chain checks | Mostly hashing and AES |
| Footprint | Larger: X.509 parser, ECC | Smaller |
| Scales to large fleets | Well, using CAs | Needs key management |
| Revocation | Certificate expiry or lists | Remove the key from the server |
| Best for | Cloud-connected, capable devices | Very constrained or closed systems |

## A Worked Example: Two Ways to Onboard a Fleet

Imagine shipping 100,000 sensors. Here is how each option plays out.

**With mTLS.** On the factory line, each device generates a key pair and sends a CSR. The factory CA issues a certificate containing the serial number. Nothing secret leaves the device. Later, when a device connects, the server sees a certificate signed by the device CA, reads the serial number and looks up the account. If one device is stolen, you block that one certificate.

**With TLS-PSK.** The factory generates a random 128-bit key for each device, loads it into the device and stores a copy in a secure server database. When a device connects, it sends its identity, and the server looks up the key. Any stolen device exposes only its own key, but a stolen database exposes all 100,000.

Now picture how each behaves during a connection. The mTLS device must parse certificates and perform ECC signing and verification, needing more flash, RAM and time. The PSK device mostly runs hashes and AES, finishing much faster on a small MCU. A very small battery sensor may be able to afford PSK but not certificates.

Neither is simply better. mTLS trades device resources for easy management at scale. PSK trades management effort for very low device cost.

## Under the Hood

In mTLS, proof of identity is CertificateVerify: the client signs a hash of the handshake so far. Because the handshake includes fresh random values, a recorded signature cannot be replayed. This signature can be made inside a secure element, so the private key never has to enter RAM.

In TLS 1.3 PSK mode, ClientHello carries a binder, which is an HMAC over the hello message keyed from the PSK. This proves knowledge of the key before the server spends effort. The PSK then feeds the key schedule, so a client with the wrong key cannot produce valid Finished messages.

TLS 1.2 PSK works differently, with its own cipher suites such as `TLS_PSK_WITH_AES_128_GCM_SHA256` and `TLS_ECDHE_PSK_...` for forward secrecy. Check which your library and server support, since many cloud services do not offer PSK.

Session resumption in TLS 1.3 reuses this same PSK mechanism: a ticket is turned into a temporary PSK. So even a certificate-based device uses PSK logic when it resumes.

## Real-World Applications

**Cloud IoT.** AWS IoT Core uses X.509 client certificates as its main device identity.

**Service meshes.** Kubernetes platforms use mTLS between services, issuing short-lived certificates automatically.

**LwM2M and CoAP devices.** Constrained cellular sensors commonly use DTLS with PSK, because of tight flash and data budgets.

**Industrial networks.** Closed plant networks may use PSK, since only a few known peers ever connect.

## Common Mistakes

### Mistake 1: Same client certificate on every device

**What goes wrong:** A shared private key means one extraction impersonates the fleet, and the server cannot tell devices apart.

**How to avoid it:** Issue one key pair per device, generated on the device.

### Mistake 2: Low-entropy PSKs

**What goes wrong:** A PSK derived from a serial number or a password can be brute-forced offline from a captured handshake.

**How to avoid it:** Use at least 128 bits from a true random source, unique for each device.

### Mistake 3: Using psk_ke for long-lived keys

**What goes wrong:** If the PSK later leaks, an attacker can decrypt every recorded session.

**How to avoid it:** Prefer `psk_dhe_ke` when the device can afford ECDHE.

### Mistake 4: The same PSK for multiple roles

**What goes wrong:** Sharing a PSK among several peers lets any of them impersonate another, and RFC 9257 warns against this.

**How to avoid it:** Keep each PSK between exactly two parties.

## Debugging and Troubleshooting

**Symptom:** The server rejects the client with a certificate-required or bad-certificate alert

**Possible Cause:** The client did not send its certificate, or the server does not trust the issuing CA.

**Investigation Method:** Test from a PC: `openssl s_client -connect host:8883 -cert device.pem -key device.key`.

**Resolution:** Load the certificate and key correctly, and install the device CA on the server.

**Symptom:** A PSK handshake fails with a decrypt or bad-binder error

**Possible Cause:** Key bytes differ. A common cause is treating a hex string as text rather than binary.

**Investigation Method:** Compare key lengths and bytes on both sides using test keys only. Try `openssl s_client -psk <hexkey> -psk_identity <id>`.

**Resolution:** Agree on exact binary encoding and identity string.

## Design Considerations and Best Practices

**Choose by fleet size and device resources.** Small closed systems can manage PSKs. Large or open fleets benefit from a CA, because adding a device requires no change on the server.

**Plan revocation first.** Decide how a stolen device is blocked before you ship. A server-side allowlist of device IDs is often simpler than CRLs.

**Protect PSKs at rest on servers.** Keep them in an HSM or secrets manager, and limit which services can read them.

**Automate renewal.** Certificates expire. EST or a vendor device-management service can renew them over a working connection.

## Expert Notes

**The PSK identity is visible.** Avoid identities that reveal location or user information, as they cross the network in clear.

**Store the mTLS key in hardware.** A device certificate is only as strong as its private key. With a secure element or HSM, signing happens inside the chip and the key cannot be copied out.

**Provision at manufacture.** Use a secured factory step to generate keys, send CSRs and inject certificates. This step is often the weakest link in the whole chain.

## Summary

Normal TLS proves who the server is, but not who the device is. Two options fix that. With mTLS, each device has its own certificate and private key, like a personal ID card, and the server only needs to trust the authority that issued it. With TLS-PSK, both sides already share a secret, like a password agreed in advance. mTLS suits large fleets but needs more memory and time. PSK is smaller and faster, but the server must protect every key.

## Related Topics

**Prerequisites**

- TLS
- PKI and X.509 Certificates

**Next Topics**

- HSMs and Secure Key Storage
