---
title: "USB Fundamentals: Hosts, Devices and Endpoints"
brief: "How USB enumeration, endpoints, transfer types and device classes work, and what that means for firmware."
order: 51
phase: 9
tags: ["USB", "Enumeration", "Endpoints", "CDC", "HID"]
---

UART is two wires and a baud rate. USB looks similar from the outside, yet it needs thousands of lines of firmware. The reason is that USB does far more: one host discovers any device you plug in, works out what it is, gives it power and loads the right driver, all without configuration.

## The Fundamental Problem

Before USB, each peripheral had its own port, driver and settings. Users had to match baud rates and interrupts by hand. A single universal bus needed devices to describe themselves, share bandwidth fairly, and work when plugged in while the machine was running. That flexibility requires a protocol, not just wires.

## The Big Picture

![A USB host enumerates a device, then exchanges data through its endpoints](/diagrams/usb_basics.svg)

### In Plain Terms

Think of a hotel reception. A new guest arrives (plug in). Reception asks who they are and what they need (enumeration), gives them a room number (address), and assigns services. Guests never start a conversation on their own. Reception goes around asking each room "anything for me?" and rooms answer only when asked.

That is the key idea of USB: the host controls everything. A device can only send when asked. Each room can also have several doors for different purposes, and these are endpoints.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Host** | The controller in charge, usually a PC or embedded Linux board. |
| **Device** | The peripheral that responds. |
| **Enumeration** | The host discovering and configuring a device. |
| **Endpoint** | A data channel on a device. Endpoint 0 is for control. |
| **Descriptor** | Data structures in which a device describes itself. |
| **Class** | A standard device type, such as HID or CDC, that needs no custom driver. |
| **VID / PID** | Vendor and product IDs. |
| **Full / High Speed** | 12 Mbit/s and 480 Mbit/s. |

## Transfer Types

| Type | Used for | Guarantee |
| --- | --- | --- |
| Control | Setup and commands | Delivered, on endpoint 0 |
| Bulk | Storage, serial data | Delivered, no timing promise |
| Interrupt | Keyboards, sensors | Regular polling |
| Isochronous | Audio, video | Fixed timing, no retries |

## How It Works

### Step 1: Attach

A pull-up resistor on D+ or D− signals the speed, and the host sees it.

### Step 2: Reset and read descriptors

The host resets the device, then asks endpoint 0 for its device descriptor.

### Step 3: Assign an address

The host gives the device a unique address.

### Step 4: Read configuration

The host reads configuration, interface and endpoint descriptors.

### Step 5: Load a driver and transfer

The operating system matches the class or VID and PID, and data starts flowing.

## A Closer Look: What Enumeration Actually Is

Enumeration sounds complicated, but it is just a short interview that happens the moment you plug something in.

The host notices a new device, because a pull-up resistor changes the voltage on a data line. It resets the device, so that it starts from a known state. At this point the device has no address, so it answers on a default one, address 0.

The host asks: "What are you?" The device sends a device descriptor containing its vendor ID, product ID and maximum packet size. The host then gives it a unique address, like a room number, and all further talk uses that number.

Next it asks: "What can you do?" The device sends its configuration, listing interfaces and endpoints. An interface might say "I am a serial port", which is the CDC class.

Finally the operating system matches this information to a driver. If the class is standard, no install is needed. Everything from here depends on those descriptors being correct, which is why a single wrong byte can mean "USB device not recognised".

## A Worked Example: A USB Serial Port

Many embedded boards appear as a serial port using the CDC class. When plugged in, the firmware's descriptors say: "I am a CDC device with a control interface and two bulk endpoints". The PC loads its built-in driver, and `/dev/ttyACM0` appears, with no driver to install.

Your `printf` goes into a buffer, and the USB stack puts it in a bulk IN endpoint. It waits there until the host polls that endpoint. If no application has the port open, or the host stops reading, the buffer fills up. Code that blocks here can freeze your firmware: a classic bug that disappears once a terminal is opened.

Check what the host sees with:

```bash
lsusb -v
dmesg | tail
```

## Common Questions

**Can two devices talk to each other directly?** Not over standard USB. Everything goes through the host. USB On-The-Go lets a device take the host role.

**Why does USB need a clock so accurate?** Timing is carried in the signal, and both ends must stay in step.

**What is the difference between Vendor ID and class?** The ID names a product, and the class says what kind of device it is.

**Is USB-C a faster protocol?** USB-C is a connector. The speed depends on the USB version in use.

## Under the Hood

Full-speed USB splits time into 1 ms frames, and high speed into 125 µs microframes. The host schedules transactions in them, so a device responds within strict timing. Firmware cannot do this alone, so the USB peripheral handles packets in hardware and uses endpoint buffers. Firmware only supplies data and handles events.

Data travels differentially on D+ and D− with NRZI encoding and bit stuffing, with CRCs on each packet. Bulk transfers retry on error using ACK and NAK handshakes. A NAK just means "not ready yet", and this is normal.

USB needs an accurate clock, with a tolerance tighter than most UARTs. Many MCUs use a crystal or sync an internal oscillator to USB frames.

## Real-World Applications

**Debug consoles.** CDC gives a serial port with no extra chip.

**Firmware update.** DFU class lets a tool flash a device over USB.

**Human interface.** Keyboards and custom controls use HID, with no driver.

**Data capture.** High-speed bulk transfers move sensor data to a host.

## Common Mistakes

### Mistake 1: Blocking on USB writes

**What goes wrong:** Firmware hangs when no host is reading.

**How to avoid it:** Use non-blocking writes and drop or buffer data.

### Mistake 2: Inaccurate clock

**What goes wrong:** Enumeration fails on some PCs.

**How to avoid it:** Use a crystal or clock recovery.

### Mistake 3: Wrong descriptor lengths

**What goes wrong:** The device is not recognised.

**How to avoid it:** Start from a working class example.

## Debugging and Troubleshooting

**Symptom:** "Device descriptor read" errors in `dmesg`

**Possible Cause:** Clock error, signal problems or firmware not answering in time.

**Investigation Method:** Use a USB protocol analyser, or Wireshark with usbmon.

**Resolution:** Fix the clock, keep the interrupt fast, and check the data lines.

**Symptom:** Data stops after a burst

**Possible Cause:** Buffer full, or a stalled endpoint.

**Investigation Method:** Log the state of the endpoint.

**Resolution:** Clear the stall and handle flow control.

## Design Considerations and Best Practices

**Use standard classes.** They avoid custom drivers on every platform.

**Protect the port.** Add ESD protection, and keep the differential pair routed well.

**Follow power rules.** Devices should only draw 100 mA until configured.

**Handle disconnects.** Treat unplugging as normal, at any moment.

## Expert Notes

**Buy a cheap protocol analyser, or use usbmon.** USB problems are nearly impossible to guess at. Seeing the traffic usually ends the mystery.

**Windows, Linux and macOS behave differently.** They request descriptors in a different order and timing, so test on all of them.

**Handle suspend.** A host can suspend the bus, and a device must then draw very little current. Bus-powered products must take this into account.

## Summary

USB is a host-controlled bus. When plugged in, a device describes itself through descriptors, and the host assigns an address and loads a driver. Data then moves through endpoints when the host asks for it. Use standard classes when you can, have an accurate clock, and never let firmware block on a port that nobody is reading.

## Related Topics

**Prerequisites**

- Serial Communication Fundamentals

**Next Topics**

- Linux Device Drivers
- Bootloaders and Firmware Updates
