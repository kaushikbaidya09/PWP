---
title: "REST and WebSockets: Talking to Servers From a Device"
brief: "When to use request and response over HTTP, when to keep a two-way WebSocket open, and how to make both reliable on devices."
order: 55
phase: 9
tags: ["REST", "HTTP", "WebSockets", "JSON", "API"]
---

A device needs to report status, fetch settings and sometimes obey a command right away. REST handles the first two easily, but it cannot push anything to the device. WebSockets can, at the cost of holding a connection open. Most connected products use both, each for what it does best.

## The Fundamental Problem

HTTP was built around one pattern: the client asks, the server answers. A server cannot begin a conversation. For live control, devices would have to poll constantly, which wastes data and still adds delay. But keeping connections open costs memory on both sides and needs careful reconnection logic.

## The Big Picture

![REST is one request and one response, while a WebSocket stays open in both directions](/diagrams/rest_ws.svg)

### In Plain Terms

REST is like sending a letter and waiting for a reply. Each exchange stands alone, and the post office remembers nothing about you. It is simple and very dependable.

A WebSocket is like a phone call. It takes a moment to set up, but then both people can speak at any time, without redialling. You pay for keeping the line open, so it only makes sense if you need to talk often or quickly.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **HTTP** | The request and response protocol of the web. |
| **REST** | A style of API built around resources and HTTP methods. |
| **Method** | GET reads, POST creates, PUT replaces, DELETE removes. |
| **Status code** | 200 OK, 401 unauthorised, 503 unavailable, and so on. |
| **WebSocket** | A long-lived two-way channel started from HTTP. |
| **Frame** | One message unit on a WebSocket. |
| **Ping / Pong** | Keep-alive frames. |
| **Idempotent** | Repeating a request has no extra effect. |

## How It Works

### REST Flow

The device opens HTTPS, sends `GET /v1/devices/42/config` with a token, and gets JSON with a status code. A retry is simple, as each request is complete on its own.

### WebSocket Flow

The device sends an HTTP request with `Upgrade: websocket`. The server answers `101 Switching Protocols`, and the same TCP connection now carries frames in both directions. Either side can send at any time.

## A Closer Look: What "Stateless" Means

REST calls are described as stateless, and this idea explains why they are so dependable.

Stateless means each request carries everything the server needs. It includes who you are, in a token, and what you want. The server keeps no memory of your previous request, so any server in a large cluster can answer it.

For a device, this is a gift. If a request fails, you simply send it again. If the server restarts, nothing is lost. There is no session to rebuild.

A WebSocket is the opposite. The connection itself holds state: which device this is, what it subscribed to. That is why it is quick, as nothing needs repeating. But if the connection dies, that state is gone, and both sides must rebuild it.

Now see why the two work together. REST is the reliable foundation, answering "what is the true state?" WebSocket is the fast path, saying "here is what just changed". If the fast path breaks, reconnect, ask REST for the truth, then carry on.

## A Worked Example: A Remote Control Device

A control device must report state and accept commands quickly.

**At boot, REST.** The device calls `GET /config`, then `POST /status`. Both can be retried, and the status code clearly shows success. If a `POST` response is lost, the device cannot tell if the server received it, so it sends a unique request ID and the server ignores repeats.

**During operation, WebSocket.** The device opens `wss://api.example.com/control`, which runs over TLS. The operator clicks a button and the server pushes `{"cmd":"gpio_set","pin":4,"value":1}` in milliseconds. The device replies with the result on the same socket.

**On link loss.** Pings fail, so the client closes, waits with growing delays and random jitter, then reconnects. It fetches current state through REST, because commands sent during the gap never arrived, and a socket has no history.

A REST call to fetch state plus a WebSocket for live events is a very common and reliable pattern.

## Common Questions

**Is a WebSocket the same as a raw TCP socket?** No. It runs on TCP, but adds framing, and it starts as HTTP so that it works through web infrastructure.

**Should I use MQTT or WebSockets?** MQTT suits device messaging with a broker. WebSockets suit direct two-way sessions, and browsers.

**Is JSON too big for devices?** On Linux, usually not. On small MCUs or metered links, consider a binary format.

**What does idempotent mean, simply?** Doing it twice gives the same result as doing it once.

## Under the Hood

HTTP/1.1 headers are text and can take hundreds of bytes per request, so frequent small updates waste bandwidth. A WebSocket frame adds only 2 to 14 bytes after setup. Client frames are masked with a random key, which exists to protect old proxies and is not security.

Long-lived connections have enemies: NAT gateways and proxies drop idle ones, often after a few minutes. Regular pings keep the path open and show that it is alive.

On MCUs each TLS connection needs a lot of RAM, and JSON parsing adds more. Libraries such as libcurl and libwebsockets suit Linux, while MCUs use smaller ones such as coreHTTP.

## Real-World Applications

**Device APIs.** Registration, configuration and firmware checks use REST.

**Remote consoles.** Terminals and control panels use WebSockets.

**Local web interfaces.** Devices host a page with live updates.

**Telemetry dashboards.** Browsers receive live data through sockets.

## Common Mistakes

### Mistake 1: Retrying non-idempotent calls blindly

**What goes wrong:** A timeout causes the action to happen twice.

**How to avoid it:** Use request IDs, and design idempotent operations.

### Mistake 2: Ignoring status codes

**What goes wrong:** A 500 error page is parsed as data.

**How to avoid it:** Check status first, and handle 401, 429 and 503.

### Mistake 3: No keep-alive

**What goes wrong:** The socket looks open but is dead.

**How to avoid it:** Send pings, and reconnect on a missed pong.

## Debugging and Troubleshooting

**Symptom:** The WebSocket disconnects at regular intervals

**Possible Cause:** A proxy or NAT idle timeout.

**Investigation Method:** Log close times and codes, and compare them to the idle period.

**Resolution:** Ping more often than the timeout.

**Symptom:** A request works with curl but fails on the device

**Possible Cause:** Missing headers, wrong time or TLS settings.

**Investigation Method:** Compare with `curl -v`, and enable library debug logs.

**Resolution:** Match headers and fix the clock.

## Design Considerations and Best Practices

**Version your API.** Devices stay in the field for years, so old versions must keep working.

**Use REST for state and sockets for events.** Each covers the other's weakness.

**Authenticate every connection.** Use mTLS or tokens, and always use `wss://`.

**Bound message sizes.** Reject oversized input before parsing.

## Expert Notes

**Respect `429` and `Retry-After`.** Servers tell you when to slow down, and a device that ignores this can get blocked.

**A fleet can attack your own server.** If every device retries at the same second, you create your own outage. Add random jitter.

**Tokens expire.** Devices that sleep for days need to handle a refresh gracefully, including when their clock is wrong.

## Summary

REST is like letters: one request, one reply, simple and easy to retry. A WebSocket is like a phone call: it stays open, and either side can speak immediately. Use REST for configuration and state, and WebSockets for live commands and events. Plan for lost connections with pings, backoff and a state refresh after reconnecting.

## Related Topics

**Prerequisites**

- Ethernet and TCP/IP
- TLS

**Next Topics**

- Protocol Buffers
- MQTT
