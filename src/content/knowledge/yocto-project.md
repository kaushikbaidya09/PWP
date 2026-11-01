---
title: "The Yocto Project: Building Your Own Linux"
brief: "How layers, recipes and images combine to produce a repeatable custom Linux distribution for an embedded product."
order: 45
phase: 8
tags: ["Yocto", "BitBake", "Layers", "Recipes", "BSP"]
---

Ubuntu is fine on a desktop, but an embedded product needs something else: only the packages you chose, your own patches, an exact toolchain and a build you can repeat in five years. Yocto does not give you a distribution. It gives you tools to build your own.

## The Fundamental Problem

Assembling a Linux system by hand means cross-compiling hundreds of packages in the right order, with matching versions. Doing this once is hard, and doing it the same way every time, across a team, is harder. A pre-built distribution avoids that work but carries unwanted software and leaves you dependent on someone else's choices.

## The Big Picture

![Layers provide recipes, BitBake builds them, and the result is a flashable image](/diagrams/yocto_layers.svg)

### In Plain Terms

Think of Yocto as a large automated kitchen. A recipe says how to cook one dish: where to get the ingredients and how to prepare them. A layer is a cookbook: a group of related recipes from one source, such as the vendor or your own team. BitBake is the chef who reads everything, works out the order and does the cooking. The image is the finished meal.

To change a dish, you do not rewrite the cookbook. You add a note on top of it, called a bbappend.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Poky** | The Yocto reference distribution and build system. |
| **BitBake** | The task engine that runs the build. |
| **Recipe (.bb)** | Instructions for building one piece of software. |
| **bbappend** | A change to an existing recipe from another layer. |
| **Layer** | A folder of related recipes, named `meta-*`. |
| **MACHINE** | The target hardware. |
| **DISTRO** | System-wide policy, such as the init system. |
| **Image** | The final root filesystem and bootable output. |
| **SDK** | A cross-toolchain for application developers. |

## How It Works

### Step 1: Set up the environment

Get Poky and your layers, then `source oe-init-build-env`, which creates a build directory.

### Step 2: Configure

`local.conf` selects MACHINE, and `bblayers.conf` lists the layers.

### Step 3: Build

`bitbake core-image-minimal` reads all recipes, resolves dependencies and runs tasks.

### Step 4: Each recipe runs its tasks

Tasks such as `do_fetch`, `do_patch`, `do_compile` and `do_install` run in parallel where possible.

### Step 5: Package and assemble

Packages are put together into a root filesystem and image.

### Step 6: Deploy

The results land in `tmp/deploy/images/<machine>/`, ready for flashing.

## A Closer Look: How One Image Is Put Together

Yocto can feel like magic, so let us follow a single package.

You ask for an image. An image recipe is mostly a list of packages. BitBake reads the list and looks up the recipe for each one, plus everything those depend on, often hundreds of recipes.

Take one recipe. BitBake runs a series of steps for it. `do_fetch` downloads the source. `do_unpack` extracts it. `do_patch` applies your changes. `do_configure` and `do_compile` build it with the cross-compiler. `do_install` copies the results into a temporary folder that looks like the target's filesystem. `do_package` splits them into packages.

Finally, the image recipe installs those packages into a root filesystem, and turns it into a flashable file.

Why so many steps? Because each is saved separately. If you change a patch, only the steps after `do_patch` run again. Everything else comes from the cache. That is what makes a build of an entire operating system practical.

## A Worked Example: Adding Your Application

Create a layer and a recipe for a C application built with CMake:

```bitbake
SUMMARY = "Sensor service"
LICENSE = "CLOSED"
SRC_URI = "git://git.example.com/sensor.git;protocol=https;branch=main"
SRCREV = "4f2a9c1d..."
S = "${WORKDIR}/git"

inherit cmake systemd

SYSTEMD_SERVICE:${PN} = "sensor.service"
```

Add it to the image in a custom image recipe, or with `IMAGE_INSTALL:append = " sensor"`. Now `bitbake my-image` fetches the source at that exact commit, cross-compiles it, packages it and places it in the image.

To change a vendor kernel, do not edit their layer. Add `linux-imx_%.bbappend` in your own layer, with your patch in `SRC_URI`. Your change stays separate, so vendor updates remain easy to take.

## Common Questions

**Is Yocto a Linux distribution?** No. It is a set of tools for making your own.

**Why is the first build so slow?** It builds the compiler and everything else from source. Later builds reuse the cached results.

**What is the difference between DEPENDS and RDEPENDS?** `DEPENDS` is needed to build a recipe, and `RDEPENDS` is needed for it to run on the target.

**Yocto or Buildroot?** Buildroot is simpler and good for small fixed systems. Yocto is more flexible for product families and larger teams.

## Under the Hood

BitBake hashes every task's inputs: source, patches, variables and dependencies. If the hash has not changed, it reuses the result from the shared state cache, `sstate-cache`. That is why the first build takes hours and later ones take minutes.

Each recipe builds in its own work folder with its own sysroot, containing only declared dependencies. Forgetting a `DEPENDS` line can work by accident on one machine, then fail on another.

`devtool modify` checks out a recipe's source so you can work on it directly, and `bitbake -e recipe | grep ^VAR=` shows how a variable was finally set.

## Real-World Applications

**SoC vendors.** NXP, TI and others ship BSP layers.

**Automotive.** AGL and many infotainment systems are built with Yocto.

**Industrial gateways.** Long-life products need reproducible builds.

**Licence compliance.** Yocto can produce a manifest and SBOM of every package.

## Common Mistakes

### Mistake 1: Editing other people's layers

**What goes wrong:** Vendor updates become painful merges.

**How to avoid it:** Use your own layer and bbappends.

### Mistake 2: Using AUTOREV in releases

**What goes wrong:** Builds fetch the latest commit, so results differ day to day.

**How to avoid it:** Pin `SRCREV` for releases.

### Mistake 3: Putting settings in local.conf

**What goes wrong:** Your product works only on one developer's machine.

**How to avoid it:** Move settings into a layer's machine or distro config.

## Debugging and Troubleshooting

**Symptom:** A task fails during `do_compile`

**Possible Cause:** A missing dependency or a source problem.

**Investigation Method:** Read the log in `tmp/work/.../temp/log.do_compile`.

**Resolution:** Add it to `DEPENDS`, or open `bitbake -c devshell recipe` to reproduce it.

**Symptom:** A change has no effect on the image

**Possible Cause:** The wrong layer priority, or a bbappend that does not match.

**Investigation Method:** Run `bitbake-layers show-appends` and `bitbake -e`.

**Resolution:** Fix the file name or priority.

## Design Considerations and Best Practices

**Keep builds reproducible.** Pin layers with a manifest, and build in a container.

**Share sstate and downloads.** A team mirror saves many hours.

**Start small.** Begin with `core-image-minimal` and add only what you need.

**Keep an LTS release.** Yocto LTS versions receive long-term fixes.

## Expert Notes

**Learn to read `bitbake -e`.** Most confusion comes from where a variable got its value, and this command shows the full history.

**Keep your image small on purpose.** Each extra package adds attack surface and update size. Add things only when a requirement calls for them.

**Budget disk space.** Builds can need well over 50 GB, and running out halfway through gives confusing errors.

## Summary

Yocto is a system for building your own Linux. Recipes describe how to build each package, layers organise them, and BitBake runs everything to produce an image. It has a steep learning curve, but in return you get a small, repeatable system. Keep your changes in your own layer, pin your versions, and let the cache do the heavy work.

## Related Topics

**Prerequisites**

- Linux Boot Flow

**Next Topics**

- Cross-Compilation and Toolchains
- OTA on Embedded Linux
