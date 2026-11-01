---
title: "Kernel vs User Space: The Boundary That Protects Linux"
brief: "Why Linux separates applications from the kernel, how system calls cross that line, and how programs reach hardware through sysfs and ioctl."
order: 42
phase: 8
tags: ["Kernel", "User Space", "System Calls", "sysfs", "ioctl"]
---

On a bare-metal MCU, any line of code can write to any register. If your application has a bad pointer, the whole system goes with it. Linux works differently. Applications cannot touch hardware directly, and a crash in one program leaves the rest running. This separation changes how you write code for hardware.

## The Fundamental Problem

Many programs share one machine. If each could access hardware and all memory, one bug or one attacker could corrupt everything. Something must referee: share the CPU fairly, keep programs apart and control access to devices. That referee needs more privilege than the programs it controls.

## The Big Picture

![Applications in user space call the kernel through system calls, and the kernel talks to hardware](/diagrams/kernel_user.svg)

### In Plain Terms

Think of a bank. Customers stay in the public hall and cannot walk into the vault. To get money, they go to the counter and ask. The teller checks the request, goes into the vault and brings the result back.

User space is the public hall. The kernel is the staff area with the vault, where the hardware lives. The system call is the counter. It is slower than walking in yourself, but one badly behaved customer cannot empty the vault.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **User space** | Where normal programs run, with limited privilege and their own memory. |
| **Kernel space** | Privileged area with full access to memory and hardware. |
| **System call** | A controlled request from a program to the kernel, such as `read`. |
| **Virtual memory** | Each process sees private addresses, mapped by the MMU. |
| **Device node** | A file in `/dev` representing a device. |
| **sysfs** | Files under `/sys` showing device attributes. |
| **ioctl** | A system call for device-specific commands. |

## How It Works

### Step 1: The application makes a call

Your code calls `read(fd, buf, 16)`. The C library puts the arguments in registers.

### Step 2: The CPU changes mode

A special instruction, `svc` on Arm, switches the CPU to privileged mode and jumps to the kernel's entry point.

### Step 3: The kernel checks the request

The kernel validates the file descriptor and buffer address, and checks permissions.

### Step 4: The driver does the work

The kernel calls the driver's read function, which talks to the hardware and copies data to your buffer with `copy_to_user`.

### Step 5: Return

The CPU drops back to user mode, and the call returns the byte count.

## A Closer Look: What Virtual Memory Really Does

On a microcontroller, address 0x20000000 means one specific place in RAM. On Linux, an address in your program is more like a name in a private address book. The CPU's MMU looks it up to find the real location.

Every process has its own address book. Two programs can both use address 0x400000, and each reaches different physical memory. Neither has an entry for the other's memory, so one cannot read or damage the other. Kernel memory is in the book, but marked "not for you".

If a program uses an address with no entry, the MMU raises a page fault, and the kernel takes over. Sometimes that is normal: memory is often only really assigned on first use. If the address is invalid, the kernel stops that one program with a segmentation fault.

This explains why a user-space bug is a contained problem. A wild pointer hits an empty entry and only that program dies. In the kernel, there is no such safety net, and the same bug can bring down the whole system.

## A Worked Example: Reading a Sensor Three Ways

**sysfs, simplest.** Many Linux drivers expose values as files, so reading a temperature can be as simple as:

```bash
cat /sys/class/thermal/thermal_zone0/temp
```

Slow but easy, and good for occasional values.

**Device node with read and ioctl.** An I2C sensor can be reached through `/dev/i2c-1`:

```c
int fd = open("/dev/i2c-1", O_RDWR);
ioctl(fd, I2C_SLAVE, 0x48);
read(fd, buf, 2);
```

This is a user-space driver: fast to write, and a bug cannot crash the kernel.

**Kernel driver.** Needed when you must handle interrupts with low latency or share a device safely. The driver then exposes a simple interface back to applications.

The choice is about where the code should live, which is the real skill in Linux driver work.

## Common Questions

**Can a user program ever touch hardware directly?** Only if the kernel allows it, for example with `mmap` on a device. It is usually better to use a driver.

**Is user space always slower?** Each crossing has a cost, but work done within user space runs at full speed. Only the crossings are expensive.

**What is a segmentation fault?** Your program touched an address it does not have permission to use.

**When do I need a kernel driver?** When you need interrupts with low latency, DMA, or safe sharing of a device between programs.

## Under the Hood

A system call costs far more than a function call, partly because the CPU changes mode and may flush cached state. Reading a byte at a time from a device therefore performs badly. Buffering in large blocks, or using `mmap` to map memory directly, avoids this.

Each process has its own page tables, so address `0x400000` in two programs refers to different physical memory. A bad pointer causes a page fault, and the kernel sends SIGSEGV to that process only. A similar bug in a kernel driver causes an oops or panic, which is why kernel code must be so careful.

Kernel code can sleep or be interrupted, and interrupt handlers cannot sleep at all. These rules do not exist in user space, so moving code across the boundary means rethinking it.

## Real-World Applications

**GPIO.** Use `libgpiod` and `/dev/gpiochip*` rather than the older sysfs GPIO interface.

**Displays.** LVGL can draw through DRM or a framebuffer device.

**Networking.** Applications use sockets, and the kernel holds the protocol stack.

**CAN.** SocketCAN makes a CAN bus look like a network socket.

## Common Mistakes

### Mistake 1: Using /dev/mem in production

**What goes wrong:** Direct register access bypasses all protection and fights with kernel drivers.

**How to avoid it:** Use a proper driver or subsystem interface.

### Mistake 2: Running everything as root

**What goes wrong:** One bug gives an attacker full control of the device.

**How to avoid it:** Run services as limited users, and give only the permissions they need.

### Mistake 3: Dereferencing user pointers in the kernel

**What goes wrong:** A bad address crashes the system or opens a security hole.

**How to avoid it:** Use `copy_from_user` and `copy_to_user`, and check return values.

## Debugging and Troubleshooting

**Symptom:** A program fails with "Permission denied" on `/dev/...`

**Possible Cause:** The user lacks access to the device node.

**Investigation Method:** Run `ls -l /dev/...` and `id`.

**Resolution:** Set group ownership with a udev rule.

**Symptom:** Application is slow when talking to a device

**Possible Cause:** Too many small system calls.

**Investigation Method:** Count calls with `strace -c ./app`.

**Resolution:** Batch reads and writes, or use `mmap`.

## Design Considerations and Best Practices

**Prefer user space.** Code there is easier to debug and cannot bring down the system. Move to the kernel only when you need to.

**Use existing subsystems.** IIO, input, GPIO and SocketCAN give standard interfaces.

**Keep kernel code small.** Fewer lines in privileged mode means fewer dangerous bugs.

**Design interfaces carefully.** Once applications depend on an ioctl, changing it is painful.

## Expert Notes

**Everything is a file, until it is not.** `read` and `write` cover a lot, but drivers often add `ioctl` for the rest. Try to keep those interfaces small and documented.

**`/proc` and `/sys` are your live documentation.** `/proc/PID/maps` shows a process's memory, and `/sys` shows what the kernel knows about devices.

**Memory overcommit surprises people.** `malloc` can succeed and then the program gets killed on first use when memory really runs out. Embedded systems should set limits deliberately.

## Summary

Linux keeps applications in user space, away from the hardware, and only the kernel touches devices. Programs cross the line through system calls, like customers at a bank counter. This makes the system stable, but calls cost time. Keep code in user space when you can, and use kernel drivers only when you truly need them.

## Related Topics

**Prerequisites**

- Linux Boot Flow
- CPU Execution Model

**Next Topics**

- Linux Device Drivers
- Debugging on Linux
