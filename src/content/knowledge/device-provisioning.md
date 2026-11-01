---
title: "Device Provisioning: Giving Each Device Its Identity"
brief: "How devices get unique keys and certificates at the factory or in the field, without exposing secrets along the way."
order: 38
phase: 7
tags: ["Provisioning", "Factory", "Device Identity", "CSR", "Key Injection"]
---

Every freshly built device is identical. Same chip, same firmware, no identity. Yet in the field, each must prove who it is, connect to the right account and hold keys unlike any other unit. Provisioning is the step that turns a blank device into a unique, trusted one.

## The Fundamental Problem

The factory is a security problem of its own. Contract manufacturers handle thousands of devices, and many people and machines can touch them. If secret keys pass through a factory PC in plain form, then anyone with access to that PC can copy them. A design can be strong on paper and still lose its keys on the production line.

## The Big Picture

The safest pattern lets the device create its own key, so the secret never exists anywhere else.

![The device generates a key, sends a request to a factory CA, and receives a signed certificate](/diagrams/provisioning.svg)

### In Plain Terms

Think of issuing a bank card. In a weak process, a clerk writes down your PIN and posts it. In a good process, you choose the PIN yourself on a secure keypad, and nobody else ever sees it. The bank only records that this card is genuine.

Provisioning works the same way. The device generates its private key inside protected hardware and shows only the public half to the factory. The factory vouches for that public key by issuing a certificate. Nothing secret travels at all.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Provisioning** | Loading identity, keys and configuration onto a device. |
| **Key injection** | Writing a key generated elsewhere into a device. |
| **On-device generation** | The device creates its own key, so it never leaves. |
| **Factory CA** | The authority issuing device certificates during production. |
| **Pre-provisioned secure element** | A chip that arrives from the vendor with keys and certificates already inside. |
| **Claiming** | Linking a device to a customer's account once deployed. |

## How It Works

### Step 1: Connect to the test station

After functional testing, a factory station talks to the device over USB, UART or a test jig.

### Step 2: Generate a key pair

The device creates a key pair in its secure element or protected storage, using its TRNG.

### Step 3: Create a CSR

The device signs a CSR with its private key and returns it, along with its serial number.

### Step 4: Issue the certificate

The factory system, connected to a CA or HSM, checks that the request is expected and signs a certificate.

### Step 5: Store and lock

The certificate is written to the device, and debug ports are locked. The station records the serial number and result.

## A Closer Look: Why the Key Should Never Travel

There are two ways for a device to get a private key. One: a computer creates the key and sends it to the device. Two: the device creates the key itself. The difference is bigger than it sounds.

In the first way, the key exists outside the device, even if only for a moment. It passed through a program, some memory and perhaps a log file. Anyone who compromises that computer gets the keys of every unit it touched, perhaps thousands. It is like a locksmith keeping a copy of every key made.

In the second way, there is nothing to steal. The device keeps the private key and hands over only the public key. The certificate authority signs that public key, and that signature is what makes it trusted. A certificate is public information, so the factory can see it without harm.

This turns a difficult secrecy problem into an easier one. You no longer have to keep the factory's computers perfectly secret. You just have to control who is allowed to request certificates.

## A Worked Example: Ten Thousand Gateways

A company builds gateways at a contract factory. A station scans the serial label and sends a command over USB. The gateway's secure element generates a P-256 key and the station sends the CSR to a cloud CA over an authenticated link. The CA issues a certificate with the serial number in the subject.

The factory PC only ever saw public data. If it is infected, the attacker gets a list of certificates, which are public anyway. They could try to request bogus certificates, so the CA only accepts serial numbers from an approved list and enforces a production quota. An unusual burst of requests raises an alert.

In the field, the gateway connects with mTLS. The customer scans a QR code to claim it, and the cloud links that serial number to their account.

## Common Questions

**Why not just use the same key on every unit?** Because one extraction would break the whole fleet, and the server could not tell devices apart.

**What if the device cannot generate keys?** Inject keys over an encrypted channel, or use a secure element that arrives pre-loaded by the chip vendor.

**Is a serial number an identity?** No. It is a label anybody can copy. Identity comes from proving ownership of a private key.

**When should provisioning happen?** Usually at the end of factory testing, so that faulty units do not consume certificates.

## Under the Hood

Without a secure element, the key is often stored in flash, protected by read-out locks or encrypted with a device-unique hardware key. Many chips offer a PUF, which derives a unique key from tiny silicon differences so that no key is stored at all.

The factory link needs its own protection, using station certificates and audit logs. Stations also need to survive network outages, and some systems hold a limited batch of pre-authorised certificates locally, which is one reason quotas matter.

## Real-World Applications

**Secure elements.** Vendors sell chips pre-loaded with keys, which reduces factory risk.

**Cloud IoT.** AWS and Azure offer fleet provisioning, where a device swaps a claim credential for its own certificate.

**Consumer products.** QR codes on packaging link a device to an owner during setup.

**Automotive.** Each ECU receives keys at the plant, using secure key-loading procedures.

## Common Mistakes

### Mistake 1: One shared key in the image

**What goes wrong:** The same key ships in every firmware image, and one extraction compromises everything.

**How to avoid it:** Keep secrets out of images, and provision per device.

### Mistake 2: Leaving keys on factory PCs

**What goes wrong:** Injected keys remain in logs and temporary files.

**How to avoid it:** Generate keys on the device, or inject them only through encrypted channels.

### Mistake 3: No inventory record

**What goes wrong:** Nobody can tell a genuine device from a clone.

**How to avoid it:** Record every provisioned serial and reject unknown ones.

## Debugging and Troubleshooting

**Symptom:** Devices pass the factory test but fail to connect in the field

**Possible Cause:** The certificate is not registered, the chain is missing, or the clock is wrong.

**Investigation Method:** Inspect the stored certificate with `openssl x509 -noout -text`, then test with a PC client.

**Resolution:** Add a real connection test to the end of the production line.

**Symptom:** Key generation fails for a small share of units

**Possible Cause:** A bus problem or a TRNG error.

**Investigation Method:** Log error codes and check the hardware on failing boards.

**Resolution:** Retry a limited number of times, and fail the unit if the error persists.

## Design Considerations and Best Practices

**Make provisioning resumable.** A power cut mid-way should never leave a half-configured unit that looks finished.

**Design for line time.** Key generation and signing add seconds per unit, which is a real cost at volume.

**Plan rework.** Decide how to wipe and re-provision a returned unit safely.

**Separate test and production keys.** Test certificates must never work on production servers.

## Expert Notes

**Provisioning is a CA interface.** Whatever can request certificates can mint trusted devices. Treat the factory system with the same care as the CA.

**Quotas catch quiet abuse.** A contract manufacturer could build extra units on the side. Limiting certificates to the agreed production count makes overruns visible.

**Think about the end of life.** Decide how a returned or sold device gets wiped, and how its identity is cancelled.

## Summary

Provisioning gives each identical device its own identity. The best approach lets the device generate its own private key, so the secret never leaves it, and asks a factory CA to certify the public half. Protect the factory link, keep records of every unit, and test real connections before devices ship.

## Related Topics

**Prerequisites**

- PKI and X.509 Certificates
- HSMs and Secure Key Storage

**Next Topics**

- mTLS and TLS-PSK
- Secure Boot Chain
