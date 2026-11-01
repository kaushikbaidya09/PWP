---
title: "Linux Device Drivers: Connecting Hardware to the Kernel"
brief: "How a Linux driver is structured: kernel modules, probe, character devices, interrupts and exposing hardware to applications."
order: 44
phase: 8
tags: ["Device Drivers", "Kernel Modules", "Char Device", "probe", "Platform Driver"]
---

Writing a driver on an MCU means writing registers. A Linux driver does that too, but it also has to live inside a large shared system: many processes, concurrency, power management and devices that appear and vanish. The hardware part is often small. Most of the job is fitting into the kernel's framework.

## The Fundamental Problem

Applications must not touch hardware directly, and each device behaves differently. The kernel needs one uniform way to talk to thousands of devices, and each device needs code that translates between that uniform interface and its own registers. That translator is the driver.

## The Big Picture

![An application uses a device file, which calls driver functions that access the hardware](/diagrams/device_driver.svg)

### In Plain Terms

A driver is like a translator at a meeting. The application speaks a standard language: open, read, write, close. The hardware speaks its own language of registers and interrupts. The driver sits in the middle, turning "read 16 bytes" into the exact register steps the chip needs.

Because the application only knows the standard language, you can swap the hardware and keep the application unchanged.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Kernel module** | Driver code that can be loaded at runtime as a `.ko` file. |
| **Bus** | The system a device sits on, such as I2C, SPI, USB or platform. |
| **probe** | The driver function called when a matching device is found. |
| **Character device** | A device accessed as a stream through `/dev`. |
| **file_operations** | The table of functions behind open, read, write and ioctl. |
| **devm_ functions** | Resource helpers that clean up automatically. |
| **Threaded IRQ** | An interrupt whose work runs in a kernel thread. |

## How It Works

### Step 1: Register the driver

The module registers a driver struct with its bus, listing the compatible strings it handles.

### Step 2: Match and probe

When a device matches, the kernel calls `probe`. Here the driver maps registers, gets clocks and interrupts, and sets up the hardware.

### Step 3: Expose an interface

The driver registers with a subsystem, or creates a character device, so that `/dev/mydev` appears.

### Step 4: Serve requests

Reads and writes reach the driver's `file_operations`. It talks to the hardware and copies data to and from user space.

### Step 5: Handle interrupts and removal

Interrupts wake waiting readers. `remove` undoes the setup when the device goes away.

## A Closer Look: Process Context and Interrupt Context

The rule that confuses new driver writers most is "you must not sleep in an interrupt". Here is why it exists.

In the kernel, code runs in one of two situations. In process context, it is working on behalf of some program, like a `read` call. If the data is not ready, the kernel can put that program to sleep and run something else. There is a task to come back to.

In interrupt context, the CPU has been pulled away from whatever it was doing. There is no program to put to sleep. If this code tried to wait, nothing could wake it, and the CPU would be stuck.

Anything that can wait is therefore banned in an interrupt: taking a mutex, allocating memory normally, or talking over I2C, which is slow and sleeps.

The solution is to split the work. The top half runs at once in interrupt context: acknowledge the hardware and return. The bottom half runs soon after, in a thread where sleeping is allowed. Threaded interrupts make that split simple.

## A Worked Example: A Minimal Platform Driver

This is a stripped-down driver matching a device tree node:

```c
static int demo_probe(struct platform_device *pdev)
{
    void __iomem *regs = devm_platform_ioremap_resource(pdev, 0);
    if (IS_ERR(regs))
        return PTR_ERR(regs);

    writel(0x1, regs + CTRL_REG);
    dev_info(&pdev->dev, "demo ready\n");
    return 0;
}

static const struct of_device_id demo_ids[] = {
    { .compatible = "acme,demo" },
    { }
};
MODULE_DEVICE_TABLE(of, demo_ids);

static struct platform_driver demo_driver = {
    .probe  = demo_probe,
    .driver = { .name = "demo", .of_match_table = demo_ids },
};
module_platform_driver(demo_driver);
MODULE_LICENSE("GPL");
```

Follow the flow. The device tree has a node with `compatible = "acme,demo"`. The kernel finds this table entry and calls `demo_probe`. `devm_platform_ioremap_resource` maps the register area and is released automatically, so there is no leak on failure. `writel` writes the register with the correct memory ordering, so plain pointer writes are not used.

## Common Questions

**Must a driver be a loadable module?** No. It can be built into the kernel, and this is common for drivers needed at boot.

**Do I always need to write a driver?** No. Many devices are already supported, and simple ones can be reached from user space.

**What is a platform device?** A device that cannot be discovered by itself, such as a peripheral inside an SoC. It is usually described in the device tree.

**Can a bad driver crash the system?** Yes. It runs with full privilege, which is why kernel code has such strict rules.

## Under the Hood

Kernel code runs in different contexts. In process context, code can sleep. In interrupt context it cannot, which means no `mutex_lock` and no `copy_to_user`. This is why many drivers use a threaded interrupt: a short handler acknowledges the hardware, and a kernel thread does slower work such as I2C transfers.

Concurrency is constant. Two processes can call your driver together, on several CPUs, while an interrupt arrives. Spinlocks protect data shared with interrupts, and mutexes protect the slower paths.

Memory for DMA needs special calls, such as `dma_alloc_coherent`, since a device may not see the same addresses as the CPU, and caches must be kept consistent.

## Real-World Applications

**Sensors.** The IIO subsystem handles ADCs and IMUs.

**Battery.** Power supply drivers report charge state to user space.

**Bluetooth and Wi-Fi.** Vendor drivers plug into the kernel's wireless stacks.

**Custom FPGA logic.** A simple platform driver exposes the registers.

## Common Mistakes

### Mistake 1: Sleeping in an interrupt

**What goes wrong:** The kernel prints "scheduling while atomic" and may crash.

**How to avoid it:** Use a threaded IRQ or a work queue.

### Mistake 2: Leaking on error paths

**What goes wrong:** Failed probes leave memory or interrupts claimed.

**How to avoid it:** Use `devm_` helpers wherever possible.

### Mistake 3: Writing a custom char device for everything

**What goes wrong:** Every application needs custom code, and nothing standard works.

**How to avoid it:** Use a subsystem such as IIO, input or LED if one exists.

## Debugging and Troubleshooting

**Symptom:** The module loads, but probe never runs

**Possible Cause:** A compatible mismatch, or a disabled device tree node.

**Investigation Method:** Check `/sys/bus/platform/drivers/` and the live tree.

**Resolution:** Align the strings and enable the node.

**Symptom:** A kernel oops on device access

**Possible Cause:** A null pointer or unmapped registers. Clock may also be off.

**Investigation Method:** Read the oops: it names the function and offset. Use `addr2line` on the vmlinux.

**Resolution:** Fix the pointer, and enable clocks before register access.

## Design Considerations and Best Practices

**Start from a similar driver.** Copying a good in-tree driver avoids many mistakes.

**Use regmap for bus devices.** It handles I2C and SPI register access, with caching.

**Log with dev_ functions.** Messages then name the device.

**Support unbind.** Test loading and unloading repeatedly to find leaks.

## Expert Notes

**`dev_err_probe` keeps logs clean.** It handles `-EPROBE_DEFER` correctly, so that a normal retry does not look like an error.

**Check every lock with lockdep.** `CONFIG_PROVE_LOCKING` finds potential deadlocks during development, even if the deadlock never actually happens.

**Upstream drivers are the best teachers.** Find a driver for a similar chip in the kernel source. It shows current practice better than any book.

## Summary

A Linux driver translates between the kernel's standard interfaces and a device's registers. The kernel calls `probe` when a device matches, and the driver sets up resources and exposes an interface. The difficult parts are concurrency and the rule against sleeping in interrupts. Use subsystems and `devm_` helpers, and keep the driver as small as you can.

## Related Topics

**Prerequisites**

- Kernel vs User Space
- Device Tree

**Next Topics**

- Debugging on Linux
- The Yocto Project
