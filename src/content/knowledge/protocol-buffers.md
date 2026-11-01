---
title: "Protocol Buffers: Compact Data for Embedded Systems"
brief: "How schemas and binary encoding shrink messages, keep old and new firmware compatible, and fit on small devices."
order: 56
phase: 9
tags: ["Protobuf", "Serialization", "nanopb", "Schema", "JSON"]
---

A C struct sent directly over a link seems simple until the other side has different padding or byte order. JSON solves this, but turns a 4-byte number into a long string. Protocol Buffers sit in between: small binary messages with a clear contract, which can change over time without breaking devices already in the field.

## The Fundamental Problem

Devices and servers are written in different languages and updated at different times. A message format has to work across all of them, for years. It should be small on metered links, cheap to parse on an MCU, and allow a new field to be added without breaking every older device.

## The Big Picture

![A shared schema generates code for device and server, which exchange compact binary messages](/diagrams/protobuf_flow.svg)

### In Plain Terms

Imagine two people filling out a form. With JSON, each answer repeats the question: "name: Sam, age: 30". With Protocol Buffers, both sides hold the same numbered form. A message only says "1: Sam, 2: 30". It is much shorter, since the questions are never sent.

If the form gets a new question 3, old readers just skip it. Nothing breaks. That is why field numbers matter so much: they are the agreement, and they must never change.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Serialization** | Turning data structures into bytes. |
| **.proto file** | The schema that defines messages. |
| **protoc** | The compiler that generates code. |
| **Field number** | The identifier sent in place of the field name. |
| **Varint** | Variable-length integer: small values use fewer bytes. |
| **nanopb** | A small C implementation for MCUs. |
| **Backward compatibility** | New code reads old data. |
| **Forward compatibility** | Old code reads new data. |

## How It Works

### Step 1: Define the schema

Write messages in a `.proto` file, with a number for each field.

### Step 2: Generate code

`protoc` creates C, Python or Go code from it.

### Step 3: Encode

The sender fills a structure and calls the encoder.

### Step 4: Send

Bytes go over any link: MQTT, WebSocket or UART.

### Step 5: Decode

The receiver decodes into its own structure. Unknown fields are skipped.

## A Closer Look: How the Encoding Works

It helps to see the actual bytes. Take this message with `device_id = 42`.

Each field is sent as a small tag followed by a value. The tag holds the field number and a wire type, which says how to read the value. For field 1 with a varint, that tag is one byte: `0x08`. The value 42 fits in one byte: `0x2A`. So the whole field is just `08 2A`, two bytes, and the name "device_id" is not sent at all.

Varints are why small numbers are small. Each byte uses 7 bits for data, and the top bit means "more to come". So 300 takes two bytes, while 42 takes one.

Now see why old code can read new messages. When a decoder meets a tag it does not recognise, the wire type tells it how long that value is, so it can skip it and continue.

That is the design in a nutshell: no names, numbers instead, and enough information to skip what you do not understand.

## A Worked Example: A Sensor Reading

Define a message:

```protobuf
syntax = "proto3";

message Reading {
  uint32 device_id = 1;
  sint32 temp_centi = 2;
  uint32 uptime_s = 3;
}
```

With `device_id = 42`, `temp_centi = 2150` and `uptime_s = 90000`, the encoded message takes about 10 bytes. The same data in JSON:

```json
{"device_id":42,"temp_centi":2150,"uptime_s":90000}
```

That is 51 bytes, and the size difference is multiplied by every message on a metered link.

Using nanopb on an MCU:

```c
uint8_t buf[32];
pb_ostream_t s = pb_ostream_from_buffer(buf, sizeof buf);
Reading r = Reading_init_zero;
r.device_id = 42;
r.temp_centi = 2150;
pb_encode(&s, Reading_fields, &r);
```

A year later you add `uint32 battery_mv = 4;`. Old firmware skips field 4, and new servers see 0 from old devices. Nobody needs to update together.

## Common Questions

**Is it encryption?** No. It is only an encoding. Protect it with TLS.

**Can a person read it?** Not directly, but `protoc --decode_raw` shows it.

**Is it better than JSON?** It is smaller and has a schema. JSON is easier to read and debug. Choose per situation.

**What about CBOR or FlatBuffers?** CBOR is like binary JSON, with no required schema. FlatBuffers lets you read data without decoding it.

## Under the Hood

Each field starts with a tag combining the field number and wire type. Varints use 7 data bits per byte, with the top bit showing that more follow, so 42 fits one byte. Negative numbers in `int32` always take 10 bytes, while `sint32` uses ZigZag encoding, which keeps small negatives small. That is why `temp_centi` is `sint32`.

In proto3, a field equal to its default value, such as 0, is not sent at all. So a receiver cannot tell zero from absent, unless you mark it `optional`.

nanopb avoids dynamic allocation. Limits for strings and arrays are set in an `.options` file, so memory use stays known at compile time.

## Real-World Applications

**Device telemetry.** Small messages save cellular data.

**RPC.** gRPC uses protobuf between services.

**Device-server APIs.** One schema serves firmware and cloud teams.

**Inter-process messages.** Local services exchange typed data.

## Common Mistakes

### Mistake 1: Reusing a field number

**What goes wrong:** Old data is read as the wrong field.

**How to avoid it:** Mark removed numbers `reserved`.

### Mistake 2: Sending raw C structs

**What goes wrong:** Padding and byte order break compatibility.

**How to avoid it:** Use a defined format.

### Mistake 3: Treating input as trusted

**What goes wrong:** A crafted message overruns a buffer.

**How to avoid it:** Set size limits and check decode results.

## Debugging and Troubleshooting

**Symptom:** Decode fails, or fields look wrong

**Possible Cause:** Different schema versions, or the data was cut off.

**Investigation Method:** Decode with `protoc --decode_raw < msg.bin`.

**Resolution:** Align the schemas and add framing.

**Symptom:** nanopb reports that a field is too long

**Possible Cause:** The fixed size in `.options` is too small.

**Investigation Method:** Print `PB_GET_ERROR(&stream)`.

**Resolution:** Increase the limit.

## Design Considerations and Best Practices

**Keep schemas in one shared repository.** Every team should build from the same source.

**Add a version or type wrapper.** A top-level `oneof` lets one channel carry several messages.

**Scale numbers to integers.** Centidegrees cost less than floats, and avoid rounding.

**Frame your messages.** Protobuf has no built-in length marker on a stream.

## Expert Notes

**Treat field numbers as forever.** They are effectively your API. Numbers 1 to 15 fit a one-byte tag, so keep them for frequent fields.

**Fuzz your decoder.** Network input is hostile. Run a fuzzer against every message type.

**Keep compatibility tests.** Store sample messages from each old release, and check that new code still reads them.

## Summary

Protocol Buffers send small binary messages based on a shared numbered schema, so the field names never travel. A generated decoder skips anything it does not know, so old and new firmware keep working together. Never reuse a field number, use nanopb on MCUs, add framing, and treat every incoming message as untrusted input.

## Related Topics

**Prerequisites**

- Memory Architecture

**Next Topics**

- MQTT
- REST and WebSockets
- Linux IPC
