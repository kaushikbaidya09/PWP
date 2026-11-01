---
title: "Bluetooth Low Energy: Small Data on Very Little Power"
brief: "How BLE devices advertise, connect and exchange data through GATT, and what makes the low power possible."
order: 52
phase: 9
tags: ["BLE", "GAP", "GATT", "Advertising", "Pairing"]
---

A fitness band sends data to a phone for weeks on a tiny battery. It manages that because BLE is built around one idea: stay asleep nearly all the time, and wake just long enough to swap a few bytes. Everything in the protocol follows from this.

## The Fundamental Problem

Classic Bluetooth was made for continuous streams such as audio, and it needs too much power for a coin cell. A sensor sends only small amounts of data, rarely. Radio is the biggest power drain, so the protocol must keep it off as much as possible while still letting devices find each other.

## The Big Picture

![A peripheral advertises, a central connects, and they exchange data through GATT](/diagrams/ble_roles.svg)

### In Plain Terms

Think of a shop with a sign in the window. The sign says what it sells, and it costs almost nothing to show. That is advertising: the sensor briefly announces itself, then sleeps. A customer who is interested walks in. That is the phone connecting.

Inside, the shop has labelled shelves. Each shelf has a clear label, and customers can read an item, change one, or ask to be told when it changes. The shelves are GATT services and characteristics. A heart rate sensor is a shop with a "Heart Rate" shelf.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Peripheral** | The small device that advertises, such as a sensor. |
| **Central** | The device that scans and connects, such as a phone. |
| **GAP** | Rules for discovery and connections. |
| **GATT** | Rules for how data is organised and exchanged. |
| **Service** | A group of related data, with a UUID. |
| **Characteristic** | One value inside a service. |
| **Notification** | The server pushes a change without being polled. |
| **Connection interval** | How often the two sides wake to talk. |
| **MTU** | The largest GATT payload. |

## How It Works

### Step 1: Advertise

The peripheral sends a short packet on three channels, then sleeps.

### Step 2: Scan and connect

A central hears the packet and sends a connection request.

### Step 3: Discover

The central reads which services and characteristics exist.

### Step 4: Exchange

The central reads and writes values, or subscribes to notifications.

### Step 5: Sleep between events

Both sides wake at each connection interval, and sleep otherwise.

## A Closer Look: How GATT Organises Data

GATT is where most BLE confusion happens, yet it is only a simple table of values.

Picture a filing cabinet. A **service** is a drawer, such as "Battery". A **characteristic** is a labelled folder within it, such as "Battery Level". Each one has a UUID, which is its label. Short 16-bit UUIDs are for standard types, and 128-bit ones are for your own.

Each characteristic has properties that say what you may do with it: read it, write it, or be told when it changes.

There are two roles here, and they are separate from the connection roles. The **server** holds the table, and is usually the sensor. The **client** uses it, and is usually the phone.

When you want live updates, the client switches on notifications by writing to a small setting attached to that characteristic, called the CCCD. After that, the server sends new values whenever it likes, without being asked. That is what lets a sensor stay asleep: nobody needs to keep polling it.

## A Worked Example: A Temperature Sensor

A sensor runs on a coin cell. It wakes every second to advertise for a few milliseconds, then sleeps at microamps. Its GATT table has one service with one characteristic:

```text
Service  Environmental Sensing (0x181A)
  Characteristic  Temperature (0x2A6E)  Read, Notify
```

A phone connects and enables notifications by writing to the characteristic's CCCD. The sensor now sends a value when the temperature changes. If nothing changes, little is sent, and the radio stays off.

Now look at the power trade-off. A 7.5 ms interval feels instant, but drains the battery quickly. A 1 s interval saves power but delays each reading. Slave latency lets the peripheral skip events when it has nothing to send, keeping the link alive and quiet. Choosing these numbers sets your battery life.

## Common Questions

**Is BLE the same as classic Bluetooth?** No. They share a name and radio band, but they are different protocols.

**How much data can BLE send?** Hundreds of kilobits per second at best in practice. It suits small data, not audio files.

**What range can I expect?** Often 10 to 30 metres indoors, depending on antenna, power and walls.

**Can one peripheral talk to many phones?** It can, but most small devices accept one connection at a time.

## Under the Hood

BLE uses 40 channels of 2 MHz in the 2.4 GHz band: three for advertising and 37 for data. It hops channel on every connection event to avoid Wi-Fi interference.

Radio takes about 5 to 15 mA while active, but only for milliseconds. Average current is what matters, and that depends on how often you wake.

Security comes through pairing. LE Secure Connections uses ECDH on P-256 to agree a key, and AES-CCM encrypts the link. "Just Works" pairing has no protection against a man-in-the-middle, so sensitive products need a passkey or numeric comparison.

On Linux, BlueZ exposes this over D-Bus, and `bluetoothctl` lets you scan and connect by hand.

## Real-World Applications

**Wearables.** Heart rate and step data sync with phones.

**Beacons.** iBeacon broadcasts only, with no connection.

**Provisioning.** Phones set up Wi-Fi details on smart devices.

**Failover links.** A gateway can fall back to Bluetooth when Ethernet is down.

## Common Mistakes

### Mistake 1: Advertising too often

**What goes wrong:** The battery lasts weeks instead of years.

**How to avoid it:** Use a longer interval, and shorten it only for pairing.

### Mistake 2: Assuming a large MTU

**What goes wrong:** Data is cut off at 20 bytes, the default payload.

**How to avoid it:** Negotiate the MTU, or split the data.

### Mistake 3: "Just Works" for sensitive data

**What goes wrong:** An attacker nearby can intercept pairing.

**How to avoid it:** Use authenticated pairing or add app-level security.

## Debugging and Troubleshooting

**Symptom:** A phone cannot find the device

**Possible Cause:** Not advertising, wrong flags or a scan filter.

**Investigation Method:** Use nRF Connect on a phone, or `bluetoothctl scan on`.

**Resolution:** Fix the advertising data.

**Symptom:** Frequent disconnects

**Possible Cause:** Supervision timeout, poor antenna or a clock error.

**Investigation Method:** Read the disconnect reason code, and capture with a BLE sniffer.

**Resolution:** Raise the timeout and check the 32 kHz clock.

## Design Considerations and Best Practices

**Measure average current.** Use a power profiler over a full cycle.

**Use standard services.** Adopted UUIDs work with existing apps.

**Keep data small.** Send only changes, in binary form.

**Test near Wi-Fi.** Crowded spectrum shows problems labs often hide.

## Expert Notes

**Phones set the rules.** You request connection settings, but iOS and Android decide what is accepted. Test on real phones.

**Antenna design beats software.** Poor range is usually a matching or placement problem, not a firmware one.

**Bond storage is a real resource.** Each bonded phone uses flash. Decide what happens once the list is full.

## Summary

BLE saves power by sleeping almost all the time. A peripheral briefly advertises, a central connects, and they swap small values through GATT, on a short regular schedule. The connection interval decides the balance between speed and battery. Use authenticated pairing for anything sensitive, and measure real current, not datasheet numbers.

## Related Topics

**Prerequisites**

- Power Management Fundamentals
- Symmetric and Asymmetric Keys

**Next Topics**

- MQTT
- Failover and Fault-Tolerant Design
