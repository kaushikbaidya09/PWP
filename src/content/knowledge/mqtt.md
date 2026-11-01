---
title: "MQTT: Lightweight Messaging for Connected Devices"
brief: "How publish/subscribe works through a broker, what QoS levels really promise, and how to handle unreliable links."
order: 54
phase: 9
tags: ["MQTT", "Publish Subscribe", "Broker", "QoS", "IoT"]
---

HTTP makes a device ask a server for everything. For a sensor on a poor connection, that is a poor fit: heavy headers, repeated connections, and no way for the server to push commands. MQTT flips the model. Devices send small messages to topics, and anyone interested receives them.

## The Fundamental Problem

Connected devices have thin, unreliable links. They go offline often. A dashboard, a logger and an alert service may all want one sensor's data, and the sensor should not have to know about each of them. Connecting every device to every consumer directly becomes unmanageable.

## The Big Picture

![A sensor publishes to a broker, which forwards messages to subscribers](/diagrams/mqtt_flow.svg)

### In Plain Terms

Think of a radio station. A sensor is like a reporter who sends news to the station, tagged with a channel name. Listeners tune in to the channels they care about. The reporter has no idea who is listening, and listeners never meet the reporter. The station, called a broker, sits in the middle and passes everything along.

Because both sides talk only to the broker, you can add a new listener at any time without changing the device.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Broker** | The server that receives and routes messages. |
| **Topic** | A label such as `site1/sensor4/temp`. |
| **Publish / Subscribe** | Send to a topic, or ask to receive from one. |
| **Wildcard** | `+` matches one level and `#` matches the rest. |
| **QoS** | The delivery level: 0, 1 or 2. |
| **Retained message** | The last value, kept for new subscribers. |
| **Last Will** | A message the broker sends if a client vanishes. |
| **Clean session** | Whether the broker keeps state across connections. |

## QoS Levels

| QoS | Promise | Cost | Use for |
| --- | --- | --- | --- |
| 0 | At most once | Lowest | Frequent readings |
| 1 | At least once, may duplicate | Medium | Most events |
| 2 | Exactly once | Highest | Rare, critical cases |

## How It Works

### Step 1: Connect

The client opens TCP, usually TLS on port 8883, and sends CONNECT.

### Step 2: Subscribe

A client asks for topics such as `site1/+/cmd`.

### Step 3: Publish

A device sends a message. The MQTT header can be as small as two bytes.

### Step 4: Route

The broker delivers it to all matching subscribers.

### Step 5: Keep alive

Small PING packets confirm that the link is alive, and the broker notices when a client goes silent.

## A Closer Look: What QoS Really Means

QoS causes more misunderstanding than any other part of MQTT, so here it is plainly.

**QoS 0** is "send and forget". The message goes out once. If it is lost, nobody knows. It is like shouting across a room.

**QoS 1** is "send until confirmed". The sender keeps the message and repeats it until it gets a PUBACK. This means it always arrives, but if the acknowledgement was lost, the receiver sees it twice. It is like a text message you resend because you saw no reply.

**QoS 2** is a four-step handshake that makes sure it is delivered exactly once. It is slower and needs more stored state.

Now the important point. Remember that MQTT already runs on TCP, so why add this at all? Because TCP's guarantee ends when a connection breaks. If the link drops, data in flight can vanish, and QoS 1 covers exactly that gap.

Most systems use QoS 1 and make handling safe against duplicates. Setting a value to 25 twice is harmless, whereas "add 5" twice is not.

## A Worked Example: Handling a Device Going Offline

A sensor connects with a Last Will on `site1/sensor4/status` saying `offline`, and publishes `online` with the retain flag.

It publishes readings at QoS 0, since a lost reading will be replaced within seconds. Alerts go at QoS 1, so these get resent until acknowledged, and the receiver must handle a duplicate.

Now the cellular link drops. The broker misses the keep-alive and publishes the Last Will, so the dashboard shows `offline` immediately, with no polling. Meanwhile the device stores alerts in a local queue. When the link returns, it reconnects, publishes `online` and sends the backlog.

Try it from a PC with Mosquitto tools:

```bash
mosquitto_sub -h broker.local -t 'site1/#' -v
mosquitto_pub -h broker.local -t site1/sensor4/temp -m '21.5'
```

## Common Questions

**Do I need to run my own broker?** Not necessarily. Cloud services provide one, and Mosquitto is simple to run locally.

**Is MQTT secure by default?** No. Use TLS and authentication.

**How do I send a command to a device?** The device subscribes to its own topic, such as `device/42/cmd`.

**What happens to messages while a device is offline?** With a persistent session and QoS 1, the broker can queue them. Otherwise they are lost.

## Under the Hood

MQTT runs on TCP, so it inherits reliable ordered delivery, but only over one connection. QoS handles the gap when a connection breaks mid-message: QoS 1 stores a message until PUBACK arrives, and QoS 2 adds a four-way handshake.

QoS applies per hop. Publisher to broker and broker to subscriber are separate, and the delivered level is the lower of the two. MQTT does not provide end-to-end confirmation, so applications that need it add their own acknowledgement.

MQTT 5 adds reason codes, user properties, message expiry and shared subscriptions. Payload format is your choice, and the broker never reads it, which is why Protocol Buffers pair well with it.

## Real-World Applications

**Cloud IoT.** AWS IoT Core and Azure IoT Hub support MQTT.

**Home automation.** Home Assistant commonly uses a Mosquitto broker.

**Industry.** Sparkplug defines a standard structure for industrial data.

**Fleet commands.** Devices subscribe to their own command topic.

## Common Mistakes

### Mistake 1: Using QoS 2 everywhere

**What goes wrong:** Extra traffic and state, with little benefit.

**How to avoid it:** Make handlers tolerate duplicates, and use QoS 1.

### Mistake 2: Duplicate client IDs

**What goes wrong:** Two clients keep disconnecting each other.

**How to avoid it:** Use a unique ID per device.

### Mistake 3: Open wildcard access

**What goes wrong:** Any device can read or command the others.

**How to avoid it:** Use per-device topic rules on the broker.

## Debugging and Troubleshooting

**Symptom:** The client connects and drops in a loop

**Possible Cause:** Duplicate client ID, or a keep-alive too short for the link.

**Investigation Method:** Read the broker log.

**Resolution:** Use unique IDs and a longer keep-alive.

**Symptom:** Subscriber sees nothing

**Possible Cause:** Topic mismatch: topics are case sensitive, and a leading `/` adds a level.

**Investigation Method:** Subscribe to `#` to see everything.

**Resolution:** Fix the topic string.

## Design Considerations and Best Practices

**Design the topic tree early.** It is hard to change across a fleet.

**Always use TLS and per-device auth.** Port 1883 sends data in clear.

**Keep messages small.** Use binary formats on metered links.

**Add jitter to reconnects.** Fleets reconnect together after an outage.

## Expert Notes

**Retained messages act as a state store.** A new subscriber gets the last value at once, which is ideal for status and configuration.

**Do not make topics too clever.** A simple, predictable structure outlives a clever one.

**Watch the broker as well.** A few devices with a wildcard subscription can create a large fan-out and heavy load.

## Summary

MQTT is a publish and subscribe protocol: devices send messages to named topics through a broker, like reporters and listeners using a radio station. It suits small devices and poor links. Choose QoS 0 for frequent readings and QoS 1 for events, use Last Will to detect lost devices, and secure every connection with TLS and per-device access rules.

## Related Topics

**Prerequisites**

- Ethernet and TCP/IP
- TLS

**Next Topics**

- Protocol Buffers
- REST and WebSockets
