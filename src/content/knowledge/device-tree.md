---
title: "Device Tree: How Linux Learns About Your Hardware"
brief: "What a device tree is, how to read nodes and properties, and how the kernel uses it to match hardware with drivers."
order: 43
phase: 8
tags: ["Device Tree", "DTS", "DTB", "Overlays", "Bindings"]
---

On a PC, hardware announces itself: plug in a card and Linux can find it. An I2C sensor on an embedded board says nothing. The kernel cannot detect it, or even know the bus exists. Something has to tell Linux what is on the board, and that something is the device tree.

## The Fundamental Problem

Arm boards are all different, with different peripherals at different addresses wired to different pins. Early kernels described each board in C code, so one kernel was needed for every board, and the source filled up with thousands of board files. Hardware description needed to move out of the kernel and into data.

## The Big Picture

![A device tree source compiles to a blob, which the kernel uses to match devices with drivers](/diagrams/device_tree.svg)

### In Plain Terms

Think of a floor plan for a new office, handed to the building manager on the first day. The plan says: there is a printer in room 3, a phone on desk 7. The manager does not need to search the building. They read the plan, then send the right technician to each item.

The device tree is that floor plan, the kernel is the manager, and the drivers are the technicians. The same kernel works on a new board just by reading a different floor plan.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **DTS / DTSI** | Device tree source text. DTSI files are shared includes. |
| **DTC** | The device tree compiler. |
| **DTB** | The compiled binary loaded by the bootloader. |
| **Node** | One item of hardware in the tree. |
| **Property** | A named value in a node, such as `reg`. |
| **compatible** | The string that links a node to a driver. |
| **Binding** | The documented rules for a device's properties. |
| **Overlay** | A patch applied on top of a tree. |

## How It Works

### Step 1: Describe the chip

The vendor provides a `.dtsi` listing all the SoC's peripherals, mostly with `status = "disabled"`.

### Step 2: Describe the board

Your `.dts` includes it, enables what is used and adds what is connected.

### Step 3: Compile and load

`dtc` produces a DTB. U-Boot loads it and passes the address to the kernel.

### Step 4: Match drivers

The kernel walks the tree. For each enabled node it searches for a driver listing the same `compatible` string, then calls that driver's `probe`.

## A Closer Look: How a Node Finds Its Driver

Reading a device tree feels abstract until you follow one single line: `compatible`.

Inside a driver's source code, there is a small table that says, in effect, "I can handle devices named `ti,tmp102`". When the kernel boots and registers that driver, it remembers the table.

The kernel also walks through the tree and creates a device for each enabled node. Whenever a device and a driver are both known, it compares strings. If a device's `compatible` value matches an entry in the driver's table, the kernel calls the driver's `probe` function, passing it that node.

Now `probe` reads the other properties. `reg` tells it the address, and `interrupts` tells it which interrupt to use. That is why a driver never needs hard-coded numbers. All the details specific to the board live in the tree.

So when something does not work, ask three questions in order. Is the node enabled? Does the string match a driver? Is that driver built? These cover most device tree problems.

## A Worked Example: Adding an I2C Sensor

A temperature sensor at address 0x48 sits on I2C bus 1, with an alert line on GPIO 12:

```dts
&i2c1 {
    status = "okay";
    clock-frequency = <400000>;

    temp@48 {
        compatible = "ti,tmp102";
        reg = <0x48>;
        interrupt-parent = <&gpio3>;
        interrupts = <12 IRQ_TYPE_LEVEL_LOW>;
    };
};
```

`&i2c1` modifies a node already defined in the SoC file, and `status = "okay"` turns it on. `reg` is the I2C address here, and the `@48` matches it. `compatible` tells the kernel to use the `tmp102` driver. On boot the driver probes, and the sensor appears as a `hwmon` device. No driver code changed: you only described the wiring.

Check it from a running system:

```bash
ls /proc/device-tree/
dmesg | grep -i tmp102
```

## Common Questions

**Is the device tree code?** No. It is a description, and it does not run. Drivers read it.

**Why does `compatible` have a vendor prefix?** To avoid name clashes between companies, as in `ti,tmp102`.

**Can I change it without rebuilding the kernel?** Yes. The DTB is a separate file, loaded by the bootloader.

**What is the difference between .dts and .dtsi?** A `.dtsi` is a shared include, usually for the SoC. A `.dts` is the final file for a specific board.

## Under the Hood

A DTB is a flat binary containing a structure block and a strings block, and the kernel builds a tree of `device_node` structures early during boot. For each device node, the platform or bus code creates a device object, and the driver core tries matching drivers by comparing the `compatible` list, which runs from most specific to most general.

Pin muxing is described here too. The `pinctrl` properties tell the kernel which function each pin should use. Many "my driver loaded but nothing happens" problems are really missing pin settings.

`phandles`, such as `<&gpio3>`, are numeric references between nodes, and this is how a device points at its clock, interrupt controller or regulator.

## Real-World Applications

**Custom boards.** A new carrier board often needs only a new `.dts`.

**Raspberry Pi.** Add-on HATs are enabled using overlays.

**Yocto BSPs.** Layers carry board device trees as part of the build.

**Product variants.** One kernel supports many hardware versions.

## Common Mistakes

### Mistake 1: Forgetting status = "okay"

**What goes wrong:** The node exists but is disabled, so no driver probes.

**How to avoid it:** Check the compiled tree, not just your source.

### Mistake 2: Compatible string typos

**What goes wrong:** No driver matches, and no error appears.

**How to avoid it:** Copy it from the binding documentation.

### Mistake 3: Missing pinmux

**What goes wrong:** The peripheral is configured, but the pins still act as GPIO.

**How to avoid it:** Add the `pinctrl` entries, and check with a scope.

## Debugging and Troubleshooting

**Symptom:** The device does not appear and there are no errors

**Possible Cause:** Disabled node, wrong compatible or driver not built.

**Investigation Method:** Look in `/proc/device-tree` and `/sys/bus/*/drivers`, and decompile with `dtc -I dtb -O dts`.

**Resolution:** Fix the node, or enable the driver in the kernel configuration.

**Symptom:** The driver reports a probe failure, code -517

**Possible Cause:** That is `-EPROBE_DEFER`: a clock, regulator or GPIO it needs is not ready.

**Investigation Method:** Read `/sys/kernel/debug/devices_deferred`.

**Resolution:** Make sure the provider driver is enabled and that its node is correct.

## Design Considerations and Best Practices

**Describe hardware, not behaviour.** The tree should say what is wired, not how software should act.

**Keep board data out of drivers.** Put addresses and pins in the tree, so one driver supports many boards.

**Use the shared include structure.** SoC, carrier and product layers avoid copying.

**Validate your files.** `make dtbs_check` checks nodes against the bindings.

## Expert Notes

**Trust the compiled tree, not the source.** With many includes and overrides, what you wrote may not be what booted. Decompile `/proc/device-tree` to see the truth.

**Bindings are a stable contract.** Once a binding is merged upstream, it should not change, because old device trees must keep working.

**Do not put configuration in it.** A device tree describes hardware. Settings that software should choose belong elsewhere.

## Summary

The device tree is a floor plan of your board, written as text and compiled into a binary that the bootloader hands to the kernel. It lets one kernel run on many boards, because the kernel matches each node to a driver through its `compatible` string. Most problems come down to a disabled node, a wrong string or missing pin settings.

## Related Topics

**Prerequisites**

- Linux Boot Flow

**Next Topics**

- Linux Device Drivers
- The Yocto Project
