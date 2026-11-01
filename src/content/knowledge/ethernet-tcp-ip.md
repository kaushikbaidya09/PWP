---
title: "Ethernet and TCP/IP: Networking on Embedded Devices"
brief: "How data travels through Ethernet, IP, TCP and UDP, and what running a network stack means on a small device."
order: 53
phase: 9
tags: ["Ethernet", "TCP", "UDP", "lwIP", "Sockets"]
---

A device calls `send()` and data reaches a server on the other side of the world. In between, the bytes are wrapped, routed, lost and resent, without your code knowing. Understanding those layers is what lets you solve the problems that appear when a network is slow or unreliable.

## The Fundamental Problem

Networks are built from many different links and they lose packets. One program cannot deal with cables, routing and retries all at once. Layers split this up: each one solves one problem and relies on the layer below it. On a small device, each layer also costs RAM, so you need to know what you are paying for.

## The Big Picture

![Application data is wrapped by TCP, then IP, then Ethernet before going on the wire](/diagrams/tcp_ip.svg)

### In Plain Terms

Think of posting a letter. You write a message (application data) and put it in an envelope with a person's name (a port). The postal system adds a street address (IP) and moves it between towns. A local van carries it down each road (Ethernet). Each stage reads only its own label.

TCP is registered mail: every item is numbered and tracked, and anything lost is sent again. UDP is a postcard: quick and simple, but it might not arrive.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **MAC address** | The hardware address on a local network. |
| **IP address** | The logical address used for routing. |
| **Port** | A number identifying a service on a device. |
| **TCP** | Reliable, ordered byte stream. |
| **UDP** | Simple datagrams, with no delivery guarantee. |
| **MTU** | Largest packet on a link, usually 1500 bytes. |
| **ARP** | Finds the MAC address for an IP address. |
| **DHCP / DNS** | Gets an IP address, and turns names into addresses. |
| **lwIP** | A small TCP/IP stack for MCUs. |

## How It Works

### Step 1: Connect

The app opens a socket, and DNS turns the host name into an IP address.

### Step 2: Handshake

TCP exchanges SYN, SYN-ACK and ACK to set up the connection.

### Step 3: Wrap

Data gets a TCP header, then an IP header, then an Ethernet header.

### Step 4: Send

The MAC hardware sends the frame through the PHY, using DMA.

### Step 5: Route

Routers read the IP header and forward the packet to the next hop.

### Step 6: Acknowledge

The receiver confirms the data, and TCP resends what is missing.

## A Closer Look: What TCP Really Promises

TCP is often described as "reliable", and that word misleads people.

TCP guarantees that bytes arrive in order, without gaps or corruption, as long as the connection works. It does not guarantee delivery. When you call `send`, the data goes into a local buffer, and the function returns right away. The bytes might be delivered later, or never.

So how does it stay reliable? Every byte has a sequence number. The receiver sends back acknowledgements saying "I have everything up to here". If an acknowledgement does not arrive in time, the sender transmits the data again, waiting longer each time.

If the network fails, TCP keeps retrying quietly, which can go on for many minutes before it gives up. During that time, your application sees no error.

That is why a device needs its own heartbeat. TCP tells you when something is definitely wrong, but it may take a long time. If your device has to know quickly that a server is gone, only an application-level check can tell it.

## A Worked Example: A Failing Long Connection

A device holds a TCP connection to a server, then someone unplugs the network cable upstream. The device sees nothing wrong: no packet arrives to say that the link is gone, so `send()` succeeds, because data simply goes into a local buffer. Minutes pass with no error.

This surprises many engineers. `send()` returning success means "the kernel took it", not "the server received it". The fix has several parts. Turn on TCP keepalive, or better, add an application-level heartbeat. Use a timeout on every read. Make the protocol acknowledge important data.

Now consider a lost-packet case. On a noisy link TCP retransmits, and everything behind the lost segment waits. A sensor sending a live value may not want this: an old reading is useless, so UDP may suit it better.

Inspect real traffic with:

```bash
tcpdump -i eth0 -w capture.pcap port 8883
ss -tn
```

## Common Questions

**When should I use UDP?** When fresh data matters more than complete data, like live sensor values, or when you add your own reliability.

**What is a port?** A number that says which program on a device should receive the data.

**Why can a phone reach the internet with a private address?** Routers use NAT to share one public address.

**What is the difference between MAC and IP addresses?** A MAC address identifies hardware on the local link. An IP address is used for routing across networks.

## Under the Hood

Ethernet hardware has two parts: the MAC in the SoC and the PHY chip that handles the cable. They connect through RMII or RGMII, and an MDIO bus configures the PHY. Frames move through DMA descriptor rings, so the CPU is not involved in each byte.

TCP keeps send and receive buffers, along with window sizes that control flow. On Linux these are generous, but with lwIP you set them directly, and a small window limits throughput. Each connection also costs RAM, so an MCU can handle only a few.

Nagle's algorithm holds small writes back to combine them, which can add delay to interactive traffic. `TCP_NODELAY` disables this.

## Real-World Applications

**Industrial.** Modbus TCP and EtherNet/IP use Ethernet on factory floors.

**Automotive.** Automotive Ethernet carries cameras and diagnostics.

**Gateways.** A CAN to Ethernet bridge carries bus traffic over UDP.

**Cloud devices.** Most connect through TCP and TLS.

## Common Mistakes

### Mistake 1: Treating TCP as messages

**What goes wrong:** One `recv` returns half a message, or two together.

**How to avoid it:** Add framing with a length field.

### Mistake 2: Ignoring dead connections

**What goes wrong:** A device believes that it is connected for hours.

**How to avoid it:** Use heartbeats and timeouts.

### Mistake 3: No reconnect backoff

**What goes wrong:** Thousands of devices hammer a recovering server.

**How to avoid it:** Use exponential backoff with random jitter.

## Debugging and Troubleshooting

**Symptom:** Link is up, but nothing connects

**Possible Cause:** Bad IP, gateway or DNS settings.

**Investigation Method:** Run `ip addr`, `ip route` and ping the gateway, then a name.

**Resolution:** Fix the configuration or the DHCP setup.

**Symptom:** Low throughput on a fast link

**Possible Cause:** Small TCP window, retransmits or a duplex mismatch.

**Investigation Method:** Measure with `iperf3` and study the capture in Wireshark.

**Resolution:** Raise buffers and check the PHY link settings.

## Design Considerations and Best Practices

**Expect failure.** Links drop, and a device should recover alone.

**Use timeouts everywhere.** Any network call without one can hang forever.

**Choose TCP or UDP deliberately.** Reliability versus freshness is a design choice.

**Size lwIP for real traffic.** Test with worst-case bursts.

## Expert Notes

**Bufferbloat hides problems.** Large buffers can make a slow link look fine, with long delays. Measure latency as well as throughput.

**Learn to read a Wireshark capture.** Retransmissions, resets and zero windows tell the story quickly.

**TIME_WAIT is normal.** Closed sockets linger on purpose. Use `SO_REUSEADDR` for a server that restarts.

## Summary

Networking uses layers: Ethernet moves frames locally, IP routes packets, and TCP or UDP deliver data to the right service. TCP is reliable and ordered, like registered mail, and UDP is quick, like a postcard. Remember that a successful send does not mean the data arrived, so use timeouts, heartbeats and framing, and always plan for reconnection.

## Related Topics

**Prerequisites**

- DMA
- Linux IPC

**Next Topics**

- MQTT
- REST and WebSockets
- TLS
