---
title: "Linux Boot Flow: From Reset to Login Prompt"
brief: "What happens between power-on and a running Linux system: boot ROM, U-Boot, kernel, device tree and init."
order: 41
phase: 8
tags: ["Boot", "U-Boot", "Kernel", "initramfs", "Init"]
---

An MCU jumps to main() within milliseconds. An embedded Linux board goes through a long relay of stages first, and when one fails you may see only a blank console. Knowing what each stage does tells you where to look.

## The Fundamental Problem

Linux needs working DRAM, but DRAM is not available at reset. It must first be trained by code running from tiny on-chip SRAM. That code cannot be large, so one small program starts a bigger one, which starts a bigger one. Each stage prepares just enough hardware for the next.

## The Big Picture

![Boot ROM loads SPL, which loads U-Boot, which loads the kernel, which starts init](/diagrams/linux_boot.svg)

### In Plain Terms

Starting Linux is like opening a large restaurant. First, the owner unlocks the door and turns on the lights (boot ROM). Then a manager switches on the kitchen equipment (SPL sets up DRAM). The head chef checks the menu and brings in the staff (U-Boot loads the kernel). The staff organise everything (the kernel starts drivers), and finally the waiters begin serving guests (init starts your applications).

Each person only does their own job and hands over to the next.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Boot ROM** | Vendor code in the chip, the first code to run. |
| **SPL** | Secondary program loader: a small U-Boot stage that sets up DRAM. |
| **U-Boot** | The common embedded bootloader. Loads and starts the kernel. |
| **Device tree blob (DTB)** | A file describing the board's hardware for the kernel. |
| **Kernel command line** | Boot options, such as the console and root filesystem. |
| **initramfs** | A small temporary root filesystem in RAM. |
| **Init** | The first user-space process, PID 1, usually systemd. |

## How It Works

### Step 1: Boot ROM

The ROM reads boot pins or fuses to find the boot device, such as eMMC or SD. It loads the first image into on-chip SRAM.

### Step 2: SPL

SPL starts clocks and trains DRAM. On Arm64, Trusted Firmware usually loads here too. It then loads full U-Boot into DRAM.

### Step 3: U-Boot

U-Boot sets up storage and consoles and reads its environment. It loads the kernel and device tree into memory, sets the command line, and jumps to the kernel.

### Step 4: Kernel

The kernel decompresses if needed, starts memory management and the scheduler, then parses the device tree and probes drivers.

### Step 5: Root filesystem

The kernel mounts the root filesystem, sometimes via an initramfs that does early work, such as decrypting storage.

### Step 6: Init

The kernel runs `/sbin/init`. systemd then starts services, and your application comes up.

## A Closer Look: Why So Many Stages?

Newcomers often ask why one program cannot just start Linux. The answer is memory.

At reset, the only memory working is a small block of on-chip SRAM, often a few hundred kilobytes. Your external DRAM, with its gigabytes, is unusable until a controller has been set up and carefully trained for your board. U-Boot, at about a megabyte, does not fit in that small SRAM.

So a chain forms. The boot ROM can read a storage device and load a very small program into SRAM. That program, the SPL, does one big job: bring up DRAM. Now there is room, so it loads full U-Boot into DRAM. U-Boot has drivers for storage and networks, and it can read filesystems, so it can find and load the much larger kernel.

Each stage exists because the previous stage had too little memory or too little capability. It is like using a small ladder to reach a bigger ladder. Once you see this, the order stops being strange, and any failure tells you which ladder gave way.

## A Worked Example: Reading a Boot Log

Connect a serial console and watch the stages go by:

```text
U-Boot SPL 2023.04          <- DRAM setup
U-Boot 2023.04              <- full bootloader
Starting kernel ...         <- handover
[    0.000000] Booting Linux on physical CPU 0x0
[    1.204512] mmc0: new HS200 MMC card
[    2.318220] VFS: Mounted root (ext4 filesystem)
[    2.901113] Run /sbin/init as init process
```

The last line printed before a hang tells you which stage failed. A log that stops after "Starting kernel" usually means a wrong console setting or a bad device tree, since the kernel is running but cannot print. A panic saying it cannot mount root means the storage driver or `root=` setting is wrong.

## Common Questions

**What is the difference between U-Boot and the kernel?** U-Boot's job is to prepare and load. It runs once, then disappears. The kernel stays and runs the system.

**Why do I need an initramfs?** Often you do not. It helps when early work is required before the real root filesystem can be mounted, such as decrypting it.

**What is PID 1?** The first user-space process. If it dies, the kernel panics, so it must never exit.

**How can I make boot faster?** Measure first. Common savings come from removing unused drivers and services, and from reducing delays in the bootloader.

## Under the Hood

DRAM training is the classic pain point: the controller adjusts timing delays for each data line on your specific board. Wrong settings give errors that may appear only at certain temperatures.

The kernel prints early messages through `earlycon`, before the normal console driver loads. Adding `earlycon` to the command line is the first step for silent boots.

Initcalls run drivers in order, and a driver may return `-EPROBE_DEFER` when something it needs is not ready, so it retries later. Slow boot times often come from driver probes, which `initcall_debug` can measure.

## Real-World Applications

**Fast-boot products.** Cars and cameras trim every stage to reach the application within seconds.

**Dual boot.** A/B systems use U-Boot to select and roll back images.

**Network boot.** Developers load kernels through TFTP for rapid testing.

**Secure products.** Each stage verifies the next.

## Common Mistakes

### Mistake 1: Wrong console in bootargs

**What goes wrong:** The board looks dead, while it is booting fine with the output going elsewhere.

**How to avoid it:** Match `console=` to the right UART and baud, and use `earlycon`.

### Mistake 2: Device tree and kernel mismatch

**What goes wrong:** Hardware disappears or the kernel hangs.

**How to avoid it:** Build and deploy them together.

### Mistake 3: Stale U-Boot environment

**What goes wrong:** Old saved variables override your new defaults.

**How to avoid it:** Reset the environment after changes with `env default -a`.

## Debugging and Troubleshooting

**Symptom:** Nothing prints at all

**Possible Cause:** Boot pins are wrong, the image is at the wrong offset, or the UART is wired incorrectly.

**Investigation Method:** Check boot mode pins and try the vendor's recovery tool.

**Resolution:** Fix boot configuration and rewrite the bootloader at the correct offset.

**Symptom:** Kernel panic: unable to mount root filesystem

**Possible Cause:** Wrong `root=` value, or a missing storage or filesystem driver.

**Investigation Method:** Read the partition list printed just before the panic.

**Resolution:** Fix the argument or build the driver into the kernel.

## Design Considerations and Best Practices

**Keep a recovery path.** Always keep a way to reflash a board that will not boot.

**Measure boot time.** Use `systemd-analyze blame` and `initcall_debug` to find delays.

**Disable what you do not need.** Removing unused drivers speeds up boot and reduces attack surface.

**Lock it down for production.** Disable the U-Boot prompt and sign the images.

## Expert Notes

**Keep a UART on every board.** Most bring-up problems can be solved with a serial log, and nothing else gives the same early view.

**`earlycon` and `ignore_loglevel` save hours.** Together they show messages that would otherwise be lost or hidden.

**Boot time is mostly a few culprits.** A slow storage probe or a network wait usually dominates. Do not trim everything evenly.

## Summary

Linux boots as a relay. Boot ROM starts a small loader, which sets up DRAM and runs U-Boot, which loads the kernel and device tree. The kernel starts drivers, mounts the root filesystem and runs init, which starts your applications. A serial log shows how far it got, so that is always the first place to look.

## Related Topics

**Prerequisites**

- MCU Boot Sequence
- Bootloaders and Firmware Updates

**Next Topics**

- Device Tree
- Kernel vs User Space
- Secure Boot Chain
