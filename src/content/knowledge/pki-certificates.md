---
title: "PKI and X.509 Certificates: How Devices Learn Whom to Trust"
brief: "What a certificate contains, how chains of trust are validated, and how devices get certificates, renew them and handle revocation."
order: 33
phase: 7
tags: ["PKI", "X.509", "CA", "CSR", "CRL", "OCSP"]
---

A device connects to `api.example.com` and receives a public key. Signatures can prove the server holds the matching private key, but nothing yet says that this key belongs to that server. An attacker could offer their own key just as easily.

Public key infrastructure solves this by having a trusted authority vouch for the link between a name and a key. The result is a certificate.

## The Fundamental Problem

A device cannot store the public key of everything it might ever talk to, and those keys change. It needs one small, stable thing to trust, from which it can check everything else. PKI gives it exactly that: a root certificate installed in advance.

## The Big Picture

Trust flows down a chain. The root signs an intermediate, the intermediate signs the end-entity certificate, and the device walks up the chain until it reaches a root it already holds.

![A root CA signs an intermediate CA, which signs a device certificate](/diagrams/pki_chain.svg)

### In Plain Terms

A certificate is like a passport. It states a name, carries a photo that ties it to the holder, and is issued by an authority that border officers already trust. The officer has never met you and does not need to. They trust the government that issued the passport, and they can check it is genuine.

In a certificate, the name is the server or device name, the photo is the public key, and the issuing government is the certificate authority. The device acting as border officer holds a small list of authorities it trusts: its trust store.

A passport alone proves little, because anyone can steal one. That is why the officer also compares your face with the photo. In TLS, the matching step is proving you hold the private key, by signing something fresh. A certificate is public information. The private key is the real secret.

Chains exist for practical reasons. A government does not personally stamp every passport; it authorises local offices. Likewise, a root CA signs an intermediate CA and then goes offline, so the most valuable key is rarely exposed.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Certificate** | A signed document binding a public key to an identity. X.509 is the standard format. |
| **CA** | Certificate authority: the party that signs certificates. |
| **Root CA** | A self-signed anchor of trust, kept offline. Its certificate ships in the trust store. |
| **Intermediate CA** | A CA signed by the root that does the daily signing, so the root can stay offline. |
| **CSR** | Certificate signing request: a public key plus identity, signed with the private key to prove possession. |
| **SAN** | Subject Alternative Name: the extension listing the host names a certificate is valid for. |
| **CRL / OCSP** | Revocation checks: a signed list of revoked serial numbers, or a live query to the CA. |

## Inside a Certificate

| Field | Purpose |
| --- | --- |
| Subject | Who the certificate identifies |
| Issuer | Which CA signed it |
| Validity | Not-before and not-after dates |
| Public key | The key being certified |
| Key Usage / Extended Key Usage | What the key may do, such as server or client authentication |
| Basic Constraints | Whether this certificate may act as a CA |
| Signature | The issuer's signature over all of the above |

## How It Works

### Step 1: Generate the key pair on the device

The private key is created inside the device or its secure element and never leaves.

### Step 2: Create a CSR

The device builds a CSR. The CA checks identity using a factory record or a provisioning credential.

### Step 3: The CA issues a certificate

The CA signs the certificate and returns it. Certificates are public, so this step needs integrity, not secrecy.

### Step 4: Validate the peer

During a connection the device checks that each signature chains to a trusted root, that dates are valid, that the name matches the SAN, that key usage is allowed, and optionally that it is not revoked.

### Step 5: Renew before expiry

Automate renewal. An expired certificate takes a working fleet offline just as surely as an attack.

You can inspect a real chain from a host:

```bash
openssl s_client -connect example.com:443 -showcerts
openssl verify -CAfile root.pem -untrusted intermediate.pem device.pem
```

## A Worked Example: Connecting to a Cloud Server

A device connects to `mqtt.example.com`. Its firmware holds one root certificate.

The server sends two certificates: its own and an intermediate. The device starts at the bottom.

**Is the server certificate signed by the intermediate?** The device uses the intermediate's public key to check the signature. It passes.

**Is the intermediate signed by the root?** The device uses the stored root public key. It passes, and this link ties the chain to something the device already trusted.

**Is each certificate in date?** The device compares with its clock. This is why time matters.

**Is it for this server?** The SAN lists `mqtt.example.com`. A certificate for any other name would be rejected here.

**May it be used for this?** Key usage permits server authentication, and the intermediate is marked as a CA.

**Does the server own it?** The server signs handshake data with its private key, and the device checks that with the public key in the certificate. Without this, anyone could replay a public certificate.

If every check passes, the device knows it is talking to the real server. Look at a real certificate on a PC with:

```bash
openssl x509 -in device.pem -noout -text
```

## Under the Hood

Certificates are encoded in ASN.1 DER, a compact binary format, and PEM is simply the same data in Base64 with header lines. Parsing DER means walking nested tag-length-value fields. Certificate parsers have historically been a source of vulnerabilities, because they process untrusted input early, before authentication has finished. Keep the library updated.

Memory is a practical limit. A single certificate is commonly 500 to 1500 bytes for ECC, and larger for RSA. Chain checking also needs the public-key operations themselves: one signature check for each link.

Trust stores can live in flash as DER arrays. For a private PKI, one or two roots are often enough, saving both flash and validation time compared to a browser's hundred or more.

## Real-World Applications

**HTTPS and MQTT.** Devices validate a cloud endpoint against a root in firmware.

**Device identity.** AWS IoT and Azure IoT identify each device by its own certificate.

**Vehicle charging.** ISO 15118 Plug and Charge uses a PKI, so a car can authenticate itself to a charger.

**Code signing.** A signing certificate links a release key to a company, often with its own CA hierarchy.

## Common Mistakes

### Mistake 1: Disabling verification

**What goes wrong:** Setting `verify=none` during bring-up and shipping it means any certificate is accepted, so encryption protects you from nobody.

**How to avoid it:** Use a private test CA during development, and treat disabled verification as a release blocker.

### Mistake 2: Skipping the host name check

**What goes wrong:** A valid certificate for any other site from the same CA is accepted, so an attacker with a cheap certificate can impersonate your server.

**How to avoid it:** Set the expected name in your TLS library, or pin your private CA.

### Mistake 3: No valid clock

**What goes wrong:** A device without a battery-backed RTC boots in 1970, so every certificate looks not-yet-valid.

**How to avoid it:** Keep a secure time source, or at least enforce a firmware build date as a minimum time.

### Mistake 4: Baking in one server certificate

**What goes wrong:** When the pinned certificate rotates, devices cannot connect, and so cannot fetch the fix.

**How to avoid it:** Pin a long-lived root or several CAs, and keep the trust store updatable.

## Debugging and Troubleshooting

**Symptom:** The handshake fails with a certificate verification error

**Possible Cause:** Missing intermediate, wrong root or expired certificate.

**Investigation Method:** Run `openssl s_client -connect host:port -showcerts` and read the verify result. Check dates with `openssl x509 -noout -dates`.

**Resolution:** Have the server send the full chain, or install the correct root.

**Symptom:** Fresh devices fail all connections, but work after running for a while

**Possible Cause:** The clock is wrong until NTP syncs, so certificates appear not yet valid.

**Investigation Method:** Log the device time at the first TLS attempt.

**Resolution:** Sync time first, and use the firmware build date as a minimum.

**Symptom:** The chain validates on a PC, but fails on the device

**Possible Cause:** The device lacks the signature algorithm or curve, or has too little memory to parse the chain.

**Investigation Method:** Print the library's verify flags and check its enabled algorithms.

**Resolution:** Enable the algorithm or use a shorter ECDSA chain.

## Design Considerations and Best Practices

**Separate CAs by purpose.** Use different CAs for device identity, server identity and code signing, so that a compromise of one does not spread.

**Pick lifetimes that match your update ability.** Roots last decades and intermediates years. Device certificates should be renewed automatically, well ahead of expiry.

**Keep at least two roots.** A second root allows a planned migration if the first must be retired.

**Treat provisioning as a security process.** The factory step that issues device certificates is effectively a CA interface, so it deserves access control and logs.

## Expert Notes

**Private PKI suits fleets.** Devices only ever talk to your servers, so running your own CA gives full control over lifetimes and identity, with no reliance on public CA policy.

**Revocation is hard on small devices.** CRLs can be large and OCSP needs connectivity. Short-lived certificates are often the practical alternative: rather than revoke, simply do not renew.

## Summary

A certificate is like a passport for a public key: it states who the key belongs to, and a trusted authority vouches for it. A device stores a small list of authorities it trusts, and follows the chain of signatures from any certificate back to one of them. It also checks the name and dates, and that the other side really holds the private key. Certificates are public; the private key is the real secret. Keep the device clock sensible, and renew certificates automatically.

## Related Topics

**Prerequisites**

- Hashes, MACs and Digital Signatures

**Next Topics**

- TLS
- mTLS and TLS-PSK
- HSMs and Secure Key Storage
