---
title: "TLS: Securing a Connection Step by Step"
brief: "How the TLS 1.3 handshake combines key exchange, certificates and AEAD into one secure channel, and what it costs on embedded hardware."
order: 34
phase: 7
tags: ["TLS 1.3", "HTTPS", "MQTTS", "Handshake", "mbedTLS", "OpenSSL"]
---

Every previous article in this phase supplies one piece: key exchange, certificates, signatures and AEAD. TLS is the protocol that assembles them. It secures HTTPS, MQTT over TLS and most device-to-cloud traffic.

On embedded systems TLS is often the most expensive thing the device does, in RAM, flash and time, so it pays to know what happens inside it.

## The Fundamental Problem

Two parties with no shared secret must, over a network an attacker controls, agree on keys, confirm who they are talking to, and detect any interference. Every step must also resist tampering, including the negotiation itself, or an attacker could force weaker settings.

## The Big Picture

TLS 1.3 completes in one round trip. Everything after the server's hello is already encrypted.

![TLS 1.3 handshake sequence between client and server](/diagrams/tls13_handshake.svg)

### In Plain Terms

Imagine two strangers who need a private talk in a crowded room where anyone may be listening, or even pretending to be one of them. TLS is the routine they follow.

First they say hello and agree on how to communicate. Then, using the paint trick from key exchange, they agree on a secret that listeners cannot work out. Next the server shows its ID card, its certificate, and proves that it really owns it. Finally both sides confirm they saw the same conversation, so nobody secretly altered it. After that, everything is sealed with the shared key.

So TLS has two phases. The handshake is slow and rare: it decides who you are talking to and what key to use. The record phase is fast and constant: it encrypts the data. Almost all the embedded pain comes from the handshake, and almost all the ongoing traffic is in the record phase.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Handshake** | The opening exchange that authenticates the peer and establishes keys. |
| **Record layer** | Splits application data into records and protects each one with AEAD. |
| **Cipher suite** | The chosen algorithms. In TLS 1.3, for example `TLS_AES_128_GCM_SHA256`. |
| **Key share** | An ephemeral ECDHE public key sent in the hello message. |
| **SNI** | Server Name Indication: the host name the client asks for. Normally sent in clear. |
| **Session resumption** | Reusing a ticket from an earlier session to skip certificate work. |
| **0-RTT** | Sending data in the first flight when resuming. Fast, but open to replay. |

## How It Works

### Step 1: ClientHello

The client sends supported versions, cipher suites, signature algorithms, a random value, and an ECDHE key share.

### Step 2: ServerHello

The server picks the parameters and returns its own key share. Both sides can now compute the shared secret and derive handshake keys with HKDF.

### Step 3: Server authenticates (encrypted)

The server sends EncryptedExtensions, its Certificate chain, and CertificateVerify: a signature over the handshake so far, proving it owns the private key. It ends with Finished, a MAC over the whole transcript.

### Step 4: Client verifies

The client validates the certificate chain and host name, checks CertificateVerify and Finished, then sends its own Finished. Any tampering with the earlier messages makes the transcript MAC fail.

### Step 5: Application data

Both sides derive application keys and protect every record with AEAD, using a sequence number to stop replay and reordering.

## TLS 1.3 Compared With 1.2

| Topic | TLS 1.2 | TLS 1.3 |
| --- | --- | --- |
| Round trips | 2 | 1 |
| Key exchange | RSA or (EC)DHE | (EC)DHE or PSK only |
| Forward secrecy | Optional | Always with certificates |
| Ciphers | Many, including CBC | AEAD only |
| Server certificate | Sent in clear | Encrypted |

## A Worked Example: A Sensor Publishes Over MQTT

A battery sensor connects to a broker on port 8883. It opens a TCP connection first, since TLS runs on top of TCP.

**ClientHello goes out.** The sensor offers TLS 1.3, `TLS_AES_128_GCM_SHA256` and a fresh P-256 key share. It also names the server.

**ServerHello comes back.** The broker accepts and returns its own key share. At this moment both sides can compute the same secret. An eavesdropper has seen both public values and cannot.

**The server proves itself.** Its certificate chain arrives encrypted. The sensor checks the chain against its stored root, compares the name and checks the date. It then verifies CertificateVerify, which shows that the server holds the private key.

**Finished messages.** Each side sends a MAC over everything said so far. If an attacker had changed any earlier byte, such as removing a strong cipher from the offer, these values would not match, and the connection would fail.

**Application data.** The sensor sends its MQTT packets, now inside AEAD records.

On a Cortex-M4 at 100 MHz without crypto acceleration, this handshake can take seconds. Sending one reading afterwards takes milliseconds. The lesson is simple: avoid repeating handshakes needlessly. Keep the connection open, or resume the session.

## Under the Hood

TLS 1.3 derives keys through a schedule built on HKDF. The ECDHE secret feeds handshake keys, which then lead to application keys. Separate keys are used in each direction, and each phase has its own, so a problem in one does not expose another.

Each record is at most 16 KB of plaintext. The AEAD nonce is built from a per-direction IV XORed with a sequence number, which guarantees it never repeats within a session. Records are numbered implicitly, so a dropped or reordered record makes authentication fail. That is why plain TLS needs a reliable transport. For UDP there is DTLS, which handles loss and reordering.

Memory is the main embedded concern. The library needs input and output buffers, a handshake transcript hash, parsed certificates and stack for ECC, and the peak occurs during the handshake. A common mbedTLS setup needs tens of kilobytes of RAM, so measure it on your target.

## Real-World Applications

**IoT clouds.** AWS IoT Core and Azure IoT Hub require TLS for device connections.

**Web interfaces.** Routers and printers serve HTTPS, often with a self-signed certificate, which browsers rightly warn about.

**OTA downloads.** HTTPS protects the transfer, while a firmware signature still protects the image itself.

**Industrial protocols.** Modbus/TCP Security wraps Modbus in TLS, and OPC UA has its own similar security layer.

## Common Mistakes

### Mistake 1: Ignoring memory limits

**What goes wrong:** The connection fails or crashes because TLS needs up to around 16 KB for each record buffer, plus room for the certificate chain and stack during ECC.

**How to avoid it:** Measure peak usage. Use the Maximum Fragment Length or Record Size Limit extensions if the server supports them.

### Mistake 2: Weak random numbers

**What goes wrong:** Predictable ephemeral keys break the entire session, whatever the cipher.

**How to avoid it:** Seed the DRBG from the hardware TRNG and fail hard if it is unavailable.

### Mistake 3: Accepting verification failures

**What goes wrong:** Library defaults or debug flags let handshakes succeed with bad certificates. In mbedTLS, for example, `MBEDTLS_SSL_VERIFY_OPTIONAL` continues after failure.

**How to avoid it:** Use `VERIFY_REQUIRED`, set the expected host name, and test with a deliberately bad certificate.

### Mistake 4: Blocking the system during the handshake

**What goes wrong:** ECC in software stalls lower-priority work and can trip the watchdog.

**How to avoid it:** Run TLS in its own task, use crypto hardware, and feed the watchdog correctly.

## Debugging and Troubleshooting

**Symptom:** The handshake fails with a memory allocation error

**Possible Cause:** Heap or buffers are too small for the certificate chain or record size.

**Investigation Method:** Enable the library's debug output and track peak heap.

**Resolution:** Increase the heap, shrink the chain, or negotiate a smaller record size.

**Symptom:** The connection times out only on slow devices

**Possible Cause:** ECC takes longer than the server or watchdog timeout allows.

**Investigation Method:** Time each handshake stage and capture traffic with Wireshark.

**Resolution:** Use crypto acceleration, session resumption or longer timeouts.

**Symptom:** A handshake failure alert arrives right after ClientHello

**Possible Cause:** No common version, cipher or curve.

**Investigation Method:** Test the server with `openssl s_client -tls1_3` and read ClientHello in Wireshark.

**Resolution:** Align enabled cipher suites and groups on both sides.

## Design Considerations and Best Practices

**Keep connections alive when power allows.** One handshake and many records costs far less than repeated connections. On deep-sleep devices, compare the cost of resumption with staying connected.

**Use session resumption.** A ticket lets a later handshake skip certificate checks, which saves energy and time.

**Limit what you enable.** Fewer cipher suites mean less code and fewer paths to attack. One or two suites are usually enough for a closed system.

**Do not disable checks to fix bugs.** If validation fails, find the reason. A workaround that skips it removes the point of TLS.

## Expert Notes

**Cut handshake cost.** Use short chains and ECDSA certificates rather than RSA, resume sessions, and offload ECC to a secure element.

**Avoid 0-RTT on devices.** Early data can be replayed, which is dangerous for any command with an effect.

**Check from a host.** This confirms the version, cipher and chain your server actually offers:

```bash
openssl s_client -connect example.com:443 -tls1_3 -brief
```

## Summary

TLS is the routine two strangers follow to talk privately on a network anyone can listen to. They agree on a secret key, the server proves its identity with a certificate, and both confirm nobody changed the conversation. After that, all data is encrypted and tamper-checked. The first part, the handshake, is slow and uses a lot of memory on small devices, while sending data afterwards is fast. So plan for the memory, always check certificates, and reuse connections where you can.

## Related Topics

**Prerequisites**

- Symmetric and Asymmetric Keys
- PKI and X.509 Certificates

**Next Topics**

- mTLS and TLS-PSK
- HSMs and Secure Key Storage
