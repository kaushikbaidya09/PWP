---
title: "Linux IPC: How Processes Talk to Each Other"
brief: "Pipes, Unix sockets, shared memory and message queues compared, with guidance on choosing the right one for a modular system."
order: 48
phase: 8
tags: ["IPC", "Sockets", "Shared Memory", "Pipes", "Message Queues"]
---

Good embedded Linux systems split into separate processes: one for the network, one for sensors, one for the GUI. If the network code crashes, the GUI stays up. But processes cannot read each other's memory, so they need a way to communicate. Choosing that mechanism shapes the whole design.

## The Fundamental Problem

Virtual memory keeps processes apart, which is exactly what makes them safe. To cooperate, they must pass data through something the kernel provides. Different needs pull in different directions: large buffers want speed, commands want simple delivery, and a crash on one side must not hang the other.

## The Big Picture

![Two processes exchange data through the kernel using sockets, or directly through shared memory](/diagrams/linux_ipc.svg)

### In Plain Terms

Imagine two offices that cannot enter each other's rooms. A pipe is a tube between them: one drops notes in, and the other pulls them out. A socket is a phone line: both can talk, and either can hang up. A message queue is a shared mailbox of separate envelopes. Shared memory is a whiteboard in the corridor both can see: very fast, but you need rules, or both will write at the same time.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Pipe** | A one-way byte stream, often between parent and child. |
| **FIFO** | A named pipe, visible as a file. |
| **Unix domain socket** | Two-way local communication through a file path. |
| **POSIX message queue** | Whole messages with priorities. |
| **Shared memory** | A memory region mapped into several processes. |
| **Semaphore** | A counter used to coordinate access. |
| **D-Bus** | A higher-level message bus for system services. |

## Choosing a Mechanism

| Mechanism | Best for | Watch out for |
| --- | --- | --- |
| Pipe | Simple parent-child streams | One-way only |
| Unix socket | Most local services | Copies data |
| Message queue | Small prioritised messages | Size limits |
| Shared memory | Large, fast data, such as frames | You must add synchronisation |
| D-Bus | System events and control | Too slow for streams |

## How It Works

### Step 1: Agree on a meeting point

Processes share a path, such as `/run/sensor.sock`, or a name for shared memory.

### Step 2: Connect

A server calls `bind` and `listen`, and a client calls `connect`.

### Step 3: Exchange data

`send` and `recv` copy bytes through the kernel.

### Step 4: Frame messages

A stream has no boundaries, so add a length header, or use `SOCK_SEQPACKET` or a serialisation format.

### Step 5: Handle disconnects

If one side dies, the other sees end of file or an error, and reconnects.

## A Closer Look: The Difference Between a Stream and a Message

One idea trips up nearly everyone using sockets or pipes: a stream has no message boundaries.

Say a process sends "HELLO" then "WORLD" with two `send` calls. You might expect two `recv` calls to return those two words. But a stream socket is more like a water pipe. It carries a flow of bytes, with no record of where one send ended. The reader may receive "HELLOWORLD" at once, or "HEL" then "LOWORLD".

It appears to work during testing, since small messages on an idle system usually arrive as sent. Then under load the pattern changes and parsing breaks.

The fix is to add your own boundaries. A simple way is a length header: send a 4-byte length, then that many bytes. The reader loops until it has all of them. Another way is a socket type that keeps boundaries: `SOCK_SEQPACKET` or `SOCK_DGRAM` for Unix sockets deliver one message per read.

Once you think of streams as bytes and not messages, many strange IPC bugs disappear.

## A Worked Example: Sensor Service and GUI

A sensor service publishes readings and a GUI displays them. A Unix socket is the natural fit: the service creates `/run/sensor.sock`, and the GUI connects.

If the GUI crashes, `send` returns an error. The service closes that client and carries on. When systemd restarts the GUI, it simply reconnects. This separation is why the system stays alive.

Now add a camera at 30 frames per second, with 2 MB per frame. Copying 60 MB a second through a socket wastes CPU, so frames go into shared memory. The socket stays as the control path, carrying only a small message: "frame 812 is ready in slot 2". Combining the two gives both speed and clean signalling, and this is a very common pattern. On Linux, a `memfd` shared file descriptor can even be passed over the socket.

## Common Questions

**Which should I use first?** A Unix domain socket. It suits most needs and is easy to change later.

**Why not use TCP on localhost?** It works, but Unix sockets are simpler and faster, and they support file permissions.

**Is shared memory always best for speed?** Only for large data. For small messages, the extra synchronisation can outweigh the savings.

**What is D-Bus for?** System-level control and events between services. It is not meant for high-rate data.

## Under the Hood

Sockets and pipes copy data twice: into a kernel buffer and out again. Each direction involves system calls and sometimes a context switch. That is cheap for small messages and costly for video.

Shared memory involves no copy, since both processes map the same physical pages. But CPU caches and ordering still apply, so lock-free use needs atomics, or use process-shared mutexes with `PTHREAD_PROCESS_SHARED`. If a process dies while holding such a lock, others can wait forever. A robust mutex reports that to the next owner.

Unix sockets also let you check who connected, with `SO_PEERCRED`, which is useful for access control.

## Real-World Applications

**systemd and journald.** Logging uses Unix sockets.

**Display systems.** Wayland uses sockets and shared buffers.

**Bluetooth.** BlueZ exposes its API over D-Bus.

**Camera pipelines.** Frames pass by shared buffer rather than by copy.

## Common Mistakes

### Mistake 1: Assuming one send equals one receive

**What goes wrong:** A stream socket joins or splits messages, so parsing breaks.

**How to avoid it:** Add framing and read until complete.

### Mistake 2: Blocking on a slow client

**What goes wrong:** One stuck reader stalls the whole service.

**How to avoid it:** Use non-blocking sockets and `poll`, with a limit per client.

### Mistake 3: Shared memory without sync

**What goes wrong:** Readers see half-written data.

**How to avoid it:** Use a lock, a sequence counter or separate buffer slots.

## Debugging and Troubleshooting

**Symptom:** `bind` fails with "Address already in use"

**Possible Cause:** A socket file remains from a previous run.

**Investigation Method:** Check the path with `ls -l` and `ss -xl`.

**Resolution:** `unlink` the path before binding, or use systemd socket activation.

**Symptom:** The server dies quietly when a client disconnects

**Possible Cause:** SIGPIPE from writing to a closed socket.

**Investigation Method:** Run it under `strace` and look for SIGPIPE.

**Resolution:** Ignore the signal, or send with `MSG_NOSIGNAL`.

## Design Considerations and Best Practices

**Default to Unix sockets.** They are simple, flexible and work with `poll`.

**Define a real protocol.** Version your messages, so that processes can update separately.

**Plan for restarts.** Each side must survive the other's crash.

**Set permissions.** Socket file modes control which users can connect.

## Expert Notes

**Plan your schema across versions.** Services update at different times, so include a version number from the first release.

**Prefer `poll` over a thread per client.** A single event loop handles many connections with far fewer race conditions.

**Permissions are your security boundary.** A world-writable socket lets any local process send commands. Set ownership deliberately.

## Summary

Processes cannot see each other's memory, so they talk through the kernel. Unix sockets suit most local services, and shared memory suits large data but needs its own synchronisation. Pipes and message queues fit simple cases, and D-Bus suits system control. Use a socket for control and shared memory for bulk data, and design every side to survive the other's restart.

## Related Topics

**Prerequisites**

- POSIX Threads
- Kernel vs User Space

**Next Topics**

- systemd for Embedded
- Protocol Buffers
