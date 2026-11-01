---
title: "Memory Corruption and System Stability: When Bad Writes Crash Firmware"
brief: "Stack overflows, buffer overruns and dangling pointers: how corruption spreads and how MPU guards and canaries catch it."
order: 23
phase: 5
tags: ["Corruption", "Overflow", "Heap", "Stability"]
---

You are three weeks from shipping a medical infusion pump firmware. The device has passed functional testing.

Memory corruption is the single most common cause of mysterious, intermittent failures in embedded systems. Unlike a desktop application where the OS catches a segfault and kills the offending process, a microcontroller typically has no such safety net.

## The Fundamental Problem

A microcontroller's memory map is flat. On an STM32F4, you have a contiguous address space where your stack lives next to your heap, which lives next to your global variables, which lives next to your peripheral registers.

The naive approach to avoiding these problems is programmer discipline: allocate the right sizes, never write past array bounds, always free memory correctly, never dereference a freed pointer. This works well enough during development when code paths are simple and well-exercised.

## The Big Picture

Memory corruption problems fall into two broad categories: spatial errors (writing or reading outside the intended memory region) and temporal errors (accessing memory after its lifetime has ended). Stack overflow and buffer overflow are spatial errors.

The ARM Cortex-M Memory Protection Unit (MPU) is the primary hardware mechanism for catching spatial errors at runtime. Canary values are a software mechanism that provides a secondary detection layer.

The diagram below shows the memory layout of a typical Cortex-M RTOS system, the protection mechanisms layered on top of it, and the failure modes associated with each region.

![Cortex-M RTOS Memory Layout with Protection](/diagrams/memory_layout.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Stack Overflow** | A condition where function call depth or local variable usage causes the stack pointer to move beyond the allocated stack region. |
| **Heap Fragmentation** | A condition that develops over time when dynamic memory is allocated and freed in patterns that leave small, non-contiguous free blocks scattered across the heap. |
| **Buffer Overflow** | Writing data past the end of an allocated buffer. |
| **Buffer Underflow** | Writing before the beginning of a buffer. |
| **Dangling Pointer** | A pointer that still holds the address of a memory region that has been freed, gone out of scope, or otherwise invalidated. |
| **Memory Protection Unit (MPU)** | A hardware unit in ARM Cortex-M3/M4/M7/M33 and other architectures that allows software to define memory regions with specific access permissions (read-only, read-write, execute, no-access) and privilege levels. |

## How It Works

### Step 1: The overflow begins

A function is called and the CPU decrements the stack pointer (SP) to make room for local variables. On a Cortex-M device in full-descending stack mode, this means SP moves to lower addresses.

### Step 2: Adjacent memory is silently overwritten

The bytes immediately below the stack in memory belong to something else: another task's stack in an RTOS, the heap metadata block headers, or global variables. As the overflowed function writes to its local variables, those writes land in the adjacent region.

### Step 3: The return address is overwritten

In a severe overflow, the stack pointer descends far enough that the return address itself (pushed onto the stack when the function was called) is overwritten with garbage. When the function returns, the CPU loads this garbage value into the program counter (PC).

### Step 4: The symptom appears in an unrelated location

Because the corruption happened in one place but manifested elsewhere, the symptom typically points to the wrong module. The watchdog fires during a UART transmission routine because the UART transmit buffer pointer — which was the global that got overwritten — is now pointing to address zero.

### Step 5: The MPU fires (if configured correctly)

If a no-access MPU region has been configured at the bottom of each task's stack, the first write into that guard region triggers a MemManage fault immediately when the overflow crosses the boundary. The fault handler captures the faulting address (available in the MMFAR register), the faulting instruction (PC from the stacked exception frame), and the task context.

### Step 6: The canary check provides a second line of detection

At each RTOS task switch, the scheduler checks whether the canary value at the bottom of the outgoing task's stack is still intact. If the canary has been modified, the scheduler calls an application-defined hook (for example, vApplicationStackOverflowHook in FreeRTOS) before the overflow propagates further.

## Under the Hood

On ARM Cortex-M3/M4/M7, the MPU supports up to 8 or 16 configurable regions (8 on M3/M4, 16 on M7). Each region is defined by a base address, a size (which must be a power of two and at least 32 bytes), and a set of permissions encoded in the MPU_RASR register.

When the MPU detects an access violation, it escalates to the MemManage exception (exception number 4 on Cortex-M). The faulting address is saved in the MMFAR register and the MMARVALID bit in the CFSR register tells you whether that address is valid.

## Real-World Applications

**Automotive (AUTOSAR, iso 26262).** In AUTOSAR-compliant ECUs (engine control units, ABS controllers), the OS layer (OSEK/ AUTOSAR OS) mandates stack monitoring for each task and ISR category. The MPU is configured with distinct regions per software component to enforce memory partitioning between safety-critical and non-safety-critical partitions.

**Medical devices (fda 510k / IEC 62304).** Infusion pumps, ventilators, and glucose monitors running on Cortex-M4 or M7 devices use stack canaries and MPU partitioning as required evidence of memory safety in their software hazard analysis. IEC 62304 Class C software (where failure can cause death) requires that unintended memory access be considered as a hazard.

## Common Mistakes

### Mistake 1: Sizing stack by "it works in testing"

**What goes wrong:** Task stack sizes are tuned to the minimum observed depth during development. Under production conditions (higher interrupt rates, longer call chains in edge-case code paths, recursive parsing), the stack overflows intermittently.

**How to avoid it:** Use the MPU guard region plus FreeRTOS uxTaskGetStackHighWaterMark() to measure actual peak usage over extended soak tests, then add a minimum 20% safety margin on top of the worst observed case.

### Mistake 2: Ignoring the return value of malloc

**What goes wrong:** malloc returns NULL when allocation fails (due to fragmentation or exhaustion). Code that does not check the return value proceeds to dereference NULL, writing to address 0x00000000, which on Cortex-M contains the initial stack pointer value from the vector table — in flash, typically read-only — causing a HardFault that looks completely unrelated to the failed allocation.

**How to avoid it:** Treat malloc return value checking as a hard coding standard. In MISRA C:2025, Rule 21.3 restricts malloc/free in safety-critical code — avoid them post-init.

### Mistake 4: Using pointers to local variables after function return

**What goes wrong:** A function returns a pointer to one of its local variables. The calling code stores this pointer and uses it later.

**How to avoid it:** Never return pointers to local variables. Enable the -Wreturn-local-addr GCC warning flag.

## Debugging and Troubleshooting

**Symptom:** System resets (watchdog) intermittently, no repeatable trigger.

**Possible Cause:** Stack overflow in a task or ISR corrupting the RTOS scheduler state or a critical global variable.

**Resolution:** Increase the stack size of the task identified by the hook or high watermark measurement.

**Symptom:** HardFault with CFSR showing IBUSERR or PRECISERR, PC pointing to an address in the middle of a valid function but wrong context.

**Possible Cause:** Return address overwritten by stack overflow; CPU branched to a garbage address that happened to land in valid flash.

**Resolution:** Identify the overflowing function using the MPU fault location.

## Design Considerations and Best Practices

1. CONFIGURE MPU GUARD REGIONS FOR EVERY STACK FROM DAY ONE Do not wait until you have a stack overflow to add MPU protection. Configuring a 32-byte no-access guard region at the bottom of each task stack and the MSP stack adds negligible overhead and converts silent corruption into an immediate, diagnosable fault. Set this up in your RTOS port initialization before any application code runs. On Cortex-M, regions must be power-of-two sized and aligned; a 32-byte region is the smallest valid size.

2. NEVER USE DYNAMIC ALLOCATION AFTER INITIALIZATION IN SAFETY-CRITICAL PATHS Allocate all resources during system startup, before the operational phase begins.

## Expert Notes

**The Mpu Does Not Protect Against All Overflows** — ONLY THOSE THAT CROSS A REGION BOUNDARY A stack overflow that writes 4 bytes past the bottom of the stack will trigger the MPU guard fault. A stack overflow that writes 512 bytes past and lands in the guard region will also trigger it.

**Heap fragmentation is a slow failure, not an immediate one.** Engineers who test with a fixed scenario often dismiss fragmentation as a theoretical concern because their test allocations and frees look balanced. Fragmentation is a property of LONG-TERM ALLOCATION PATTERNS, particularly when allocations of different sizes are interleaved.

## Summary

Memory corruption in embedded systems is not a single failure mode — it is a class of failures united by the common theme of a processor accessing memory in ways that were not intended, in ways the hardware does not natively prevent, and in ways that often manifest far from the original fault site. Stack overflow, buffer overflow, dangling pointers, and heap fragmentation each have distinct causes and detection strategies, but they share the same consequence: silent, unpredictable system behavior that is expensive to reproduce and diagnose.

The practical defense is layered: hardware enforcement through the MPU catches spatial violations at the boundary the moment they occur. Software canaries provide a secondary detection layer for overflows that land inside permitted regions. Runtime assertions and heap integrity checks surface logical violations before they propagate.

## Related Topics

**Prerequisites**

- Memory Architecture (stack layout, heap, .data/.bss, linker scripts, address maps)
- Concurrency and Synchronization (RTOS tasks, ISR interaction, shared data hazards)

**Next Topics**

- Embedded Security Fundamentals (attack surfaces, secure boot, code injection defenses, MPU as a security boundary)
- Fault Handling and Crash Analysis (HardFault anatomy, fault handler design, fault logging, recovery strategies, watchdog integration)
