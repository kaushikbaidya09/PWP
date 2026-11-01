---
title: "Cross-Compilation and Toolchains: Building for Another CPU"
brief: "Why embedded code is built on a PC for a different processor, what a toolchain contains, and how sysroots and CMake fit together."
order: 46
phase: 8
tags: ["Toolchain", "Cross Compile", "Sysroot", "CMake", "GCC"]
---

Compile a program on your laptop, copy it to an Arm board, and it refuses to run: "Exec format error". The file is x86 machine code, and the board's CPU cannot read it. Building for embedded targets means producing code for a machine other than the one doing the building.

## The Fundamental Problem

The target is usually slower and smaller than a PC, and an MCU has no operating system to run a compiler on. So you build on a powerful host, but the output has to suit the target's instruction set, ABI and libraries. If the compiler picks up the host's headers or libraries by mistake, the result breaks in confusing ways.

## The Big Picture

![Source code on an x86 host passes through a cross compiler to produce a binary for an Arm target](/diagrams/cross_compile.svg)

### In Plain Terms

Imagine writing a book in English that must be printed for readers in Japan. You stay at your own desk (the host), but a translator (the cross-compiler) produces the Japanese edition (the target binary). You cannot read the result yourself, and that is fine, since it was never meant for you.

The sysroot is the translator's reference shelf: a copy of the target's libraries and headers, so the work matches what readers there actually have.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Host** | The machine running the compiler. |
| **Target** | The machine that will run the output. |
| **Toolchain** | Compiler, assembler, linker, C library and tools together. |
| **Triplet** | A name such as `aarch64-linux-gnu`: CPU, OS, ABI. |
| **Sysroot** | A folder holding the target's headers and libraries. |
| **ABI** | The binary rules: how functions pass arguments and lay out data. |
| **libc** | The C library: glibc, musl or newlib. |

## How It Works

### Step 1: Compile

`aarch64-linux-gnu-gcc` turns C into Arm64 assembly and then object files, using headers from the sysroot.

### Step 2: Link

The linker joins object files with libraries from the sysroot and produces an executable.

### Step 3: Check the output

`file app` shows the target architecture.

### Step 4: Deploy

Copy the file to the board with `scp`, or package it.

### Step 5: Debug remotely

`gdbserver` runs on the target, and `gdb-multiarch` connects from the host.

## A Closer Look: What the Compiler Needs to Know

When you compile `#include <stdio.h>`, a question arises: whose `stdio.h`? Your PC has one, and it describes your PC's C library. The board has a different one.

For a native build, this never comes up. For cross-compiling, everything has two copies. There is the compiler, which runs on your PC, and its output, which runs on the board. There are the build tools for your PC, and the libraries for the board.

A sysroot solves this by being a miniature copy of the target's `/usr`. It holds the target's headers and libraries. When you pass `--sysroot=/opt/sdk/...`, the compiler looks there first, and ignores your PC's system folders.

Three things must agree: the CPU instructions, the ABI and the C library. The triplet in a compiler's name, such as `aarch64-linux-gnu`, states these. Get them right, and a program built on your laptop runs on the board on the first try.

## A Worked Example: Building With CMake

A toolchain file tells CMake about the target:

```cmake
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER aarch64-poky-linux-gcc)
set(CMAKE_SYSROOT /opt/sdk/sysroots/aarch64-poky-linux)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

Then build and check:

```bash
cmake -B build -DCMAKE_TOOLCHAIN_FILE=arm64.cmake
cmake --build build
file build/app
```

The output should say "ARM aarch64". The `ONLY` lines matter: they stop CMake from finding the host's OpenSSL instead of the target's. On a Yocto project, `bitbake -c populate_sdk my-image` creates an SDK with this sysroot, so application developers need not run full image builds.

## Common Questions

**Why not compile on the board?** You can on bigger boards, but it is slow, and it needs compilers and headers on the device. MCUs cannot do it at all.

**What is the difference between arm-none-eabi and arm-linux-gnueabihf?** The first targets bare metal with no OS. The second targets Linux, using glibc and hard-float.

**Should I link statically?** It avoids library mismatches and makes a larger file. Consider licensing and security updates as well.

**What does the `file` command tell me?** The architecture a binary was built for, which is the fastest sanity check.

## Under the Hood

A C compiler builds against headers that describe structures, and a program links against particular library versions. Building against a newer glibc than the target has gives an error like "GLIBC_2.34 not found" when you run it, since symbols are versioned.

Flags must match the CPU. On 32-bit Arm, `-mfloat-abi=hard` and `softfp` differ in how floats are passed, so mixing them fails to link. On MCUs, `-mcpu=cortex-m4 -mthumb` chooses instructions, and the newlib C library is used in place of glibc.

Dynamic programs need the interpreter named in their ELF header, such as `/lib/ld-linux-aarch64.so.1`. If it is missing, the shell says "No such file or directory", even though the file exists.

## Real-World Applications

**Yocto and Buildroot.** Both build a matching toolchain as part of the system.

**MCU firmware.** `arm-none-eabi-gcc` targets chips with no OS.

**CI pipelines.** Containers hold a pinned toolchain.

**Multi-arch containers.** Docker can build for Arm from x86 hosts.

## Common Mistakes

### Mistake 1: Linking host libraries

**What goes wrong:** The build fails with "file in wrong format", or finds the wrong headers.

**How to avoid it:** Set the sysroot, and restrict CMake's search paths.

### Mistake 2: Toolchain differs across machines

**What goes wrong:** Builds work for one developer and not for another.

**How to avoid it:** Pin the toolchain in a container or SDK.

### Mistake 3: Mismatched float ABI

**What goes wrong:** Linker errors, or wrong values at runtime.

**How to avoid it:** Use the same flags across all libraries.

## Debugging and Troubleshooting

**Symptom:** "No such file or directory" when running a file that exists

**Possible Cause:** The dynamic loader named in the binary does not exist on the target.

**Investigation Method:** Run `readelf -l app | grep interpreter`.

**Resolution:** Build with the correct toolchain, or use a static link.

**Symptom:** "version GLIBC_x not found"

**Possible Cause:** Built against a newer library than the target has.

**Investigation Method:** Compare with `objdump -T app | grep GLIBC`.

**Resolution:** Build using the target's sysroot.

## Design Considerations and Best Practices

**Treat the toolchain as a dependency.** Version it, just as you would source code.

**Use the SDK from your image.** That guarantees headers match the device.

**Prefer hermetic builds.** Containers stop host files from leaking in.

**Run tests on host too.** Hardware-independent code can be tested natively.

## Expert Notes

**`CFLAGS` from the environment can poison builds.** A flag meant for the host may leak into a cross-build. Hermetic environments prevent it.

**Different compilers find different bugs.** Build with both GCC and Clang if you can. Disagreements often reveal real problems.

**Record the toolchain version in your image.** When a field bug appears years later, you need to rebuild exactly that binary.

## Summary

Cross-compiling means building on a powerful PC for a different CPU, like translating a book for readers elsewhere. A toolchain holds the compiler and libraries, and a sysroot supplies the target's files. Most problems come from mixing up host and target, so pin your toolchain, set the sysroot and check the output with `file`.

## Related Topics

**Prerequisites**

- Linker Scripts Explained
- The Yocto Project

**Next Topics**

- Debugging on Linux
- Static Analysis and CI
