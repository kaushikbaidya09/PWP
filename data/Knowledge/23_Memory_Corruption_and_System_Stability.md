---
id: memory-corruption-and-system-stability
tags: ['Corruption', 'Overflow', 'Heap', 'Stability']
---

# Memory Corruption and System Stability in Embedded Systems

You are three weeks from shipping a medical infusion pump firmware. The device has passed functional testing. Then, during a 72-hour stress run, the pump locks up. No error code. No obvious trigger. The watchdog fires and the system resets. You reproduce it twice more over the next day. The root cause turns out to be a stack overflow in an interrupt handler that silently overwrote a critical state variable -- one that the scheduler depended on to decide whether to continue delivering medication.

Memory corruption is the single most common cause of mysterious, intermittent failures in embedded systems. Unlike a desktop application where the OS catches a segfault and kills the offending process, a microcontroller typically has no such safety net. When memory corruption occurs on a bare-metal Cortex-M4, the processor keeps running -- executing whatever bytes happen to follow the corrupted region, interpreting garbage data as instructions or configuration. The failure mode can be immediate, or it can be a slow degradation that takes hours or days to manifest.

What makes this topic difficult is not any single concept in isolation. Stack overflows, heap fragmentation, buffer overflows, and dangling pointers are each individually understandable. The difficulty is that these problems interact, hide behind unrelated symptoms, and are often introduced by code that looks completely correct on inspection. A buffer overflow in one module may not crash until a completely different module accesses the memory that was silently overwritten.

This article targets engineers who already understand memory architecture (stack, heap, .data, .bss regions) and who have worked with concurrent systems. You should be comfortable with concepts like interrupt preemption, RTOS tasks, and basic linker scripts. If those terms are unfamiliar, review the Memory Architecture and Concurrency and Synchronization articles first.

By the end of this article, you will understand how each class of memory corruption arises, why naive approaches fail to catch it early, how to configure the ARM Cortex-M Memory Protection Unit to catch violations at runtime, how to use canary values to detect overflow before it causes damage, and how to apply a systematic set of design practices that reduce the probability of these failures reaching production.

## The Fundamental Problem

A microcontroller's memory map is flat. On an STM32F4, you have a contiguous address space where your stack lives next to your heap, which lives next to your global variables, which lives next to your peripheral registers. The CPU does not inherently know that a write to address 0x20001F00 is crossing a stack boundary -- it simply writes. There is no hardware fence between the end of a local variable array and the return address sitting below it on the stack. That absence of enforcement is what makes memory corruption possible.

The naive approach to avoiding these problems is programmer discipline: allocate the right sizes, never write past array bounds, always free memory correctly, never dereference a freed pointer. This works well enough during development when code paths are simple and well-exercised. It fails in production because real systems have dozens of modules written by different engineers over different time periods, integration surfaces that nobody fully tested, and edge cases in protocol parsing or sensor data handling that only trigger under specific runtime conditions. Human discipline does not scale to that complexity.

The fundamental engineering failure is treating memory safety as a code-review problem rather than an architecture problem. Code review catches obvious mistakes. Architecture -- choosing appropriate data structures, configuring hardware protection units, building in runtime assertions -- is what catches the non-obvious ones. The goal of this article is to shift your mental model from "avoid mistakes" to "make mistakes detectable and contained the moment they occur."

## The Big Picture

Memory corruption problems fall into two broad categories: spatial errors (writing or reading outside the intended memory region) and temporal errors (accessing memory after its lifetime has ended). Stack overflow and buffer overflow are spatial errors. Dangling pointers are temporal errors. Heap fragmentation is neither a corruption problem directly, but it creates the conditions under which allocation failures lead to NULL pointer dereferences and undefined behavior that produces corruption-like symptoms.

The ARM Cortex-M Memory Protection Unit (MPU) is the primary hardware mechanism for catching spatial errors at runtime. Canary values are a software mechanism that provides a secondary detection layer. Together, they form a detection-in-depth approach: the MPU catches access violations as they happen, and canaries detect overflows that the MPU missed because the write landed inside a permitted region but outside the intended data structure.

The diagram below shows the memory layout of a typical Cortex-M RTOS system, the protection mechanisms layered on top of it, and the failure modes associated with each region.

<div class="detail-diagram">
<img src="../assets/svg/diagrams/memory_layout.svg" alt="Cortex-M RTOS Memory Layout with Protection" loading="lazy">
</div>

Figure 1: Layered memory protection in a Cortex-M RTOS system

## Key Concepts and Terminology

**Stack Overflow** — A condition where function call depth or local variable usage causes the stack pointer to move beyond the allocated stack region. On Cortex-M devices, the stack grows downward. If the stack pointer decrements past the bottom of the stack allocation, it begins overwriting heap data, global variables, or another task's stack. The CPU does not detect this unless an MPU region is configured to fault on access to that address range.

**Heap Fragmentation** — A condition that develops over time when dynamic memory is allocated and freed in patterns that leave small, non-contiguous free blocks scattered across the heap. A subsequent allocation request for a large block may fail even though the total free bytes exceed the request size, because no single contiguous free block is large enough. In embedded systems, this eventually causes malloc to return NULL, which uninstrumented code often ignores, leading to NULL pointer dereferences.

**Buffer Overflow** — Writing data past the end of an allocated buffer. This is the classic spatial error: a fixed-size array of N bytes receives N+K bytes of input, and the extra K bytes overwrite whatever follows the array in memory. In firmware, this most commonly occurs in serial protocol parsers, string handling, and DMA transfer destinations where the input length is not validated against the buffer size before the copy.

**Buffer Underflow** — Writing before the beginning of a buffer. Less common than overflow but equally dangerous. Typically caused by a negative array index or pointer arithmetic that moves the pointer backward past the buffer origin.

**Dangling Pointer** — A pointer that still holds the address of a memory region that has been freed, gone out of scope, or otherwise invalidated. Reading through a dangling pointer returns stale or garbage data. Writing through a dangling pointer corrupts whatever currently occupies that address -- potentially a completely unrelated data structure. This is a temporal error because the problem is about WHEN the access occurs relative to the memory's lifetime.

**Memory Protection Unit (mpu)** — A hardware unit in ARM Cortex-M3/M4/M7/M33 and other architectures that allows software to define memory regions with specific access permissions (read-only, read-write, execute, no-access) and privilege levels. An access that violates the configured permissions triggers a MemManage fault, giving the system a deterministic and immediate indication of the violation rather than silent corruption.

**Canary Value** — A known sentinel value written to a specific memory location (typically the boundary between a stack and adjacent memory, or between heap blocks) that is checked periodically or at task-switch time. If the value has been overwritten, an overflow or corruption event has occurred. The term comes from the historical use of canary birds in coal mines to detect toxic gas early.

**Use-After-Free** — A subclass of dangling pointer error where a heap-allocated block is freed and then accessed again before (or after) the allocator reuses that memory for a different allocation. This can cause subtle data corruption where two logically unrelated objects share the same physical memory at overlapping times.

**Wild Pointer** — A pointer that was never initialized and contains an arbitrary or zero value. Dereferencing an uninitialized pointer on a Cortex-M device may read from address 0x00000000 (the vector table in flash) or write to a peripheral register if the garbage value falls in the peripheral address range. Both outcomes are difficult to trace.

**Memory Fence / Barrier** — A CPU instruction or compiler directive that enforces ordering of memory operations. In the context of corruption, memory barriers matter when compiler optimizations or out-of-order execution cause stores to appear in a different sequence than the source code implies, affecting the validity of canary checks and atomic flag patterns.

## How It Works

### Step 1: The Overflow Begins a Function Is Called and the Cpu Decrements the Stack Pointer (sp) to Make Room for Local Variables. on a Cortex-M Device in Full-Descending Stack Mode, This Means Sp Moves to Lower Addresses. If the Total Size of Local Variables, Saved Registers, and the Return Address Exceeds the Available Stack Space, Sp Crosses the Stack's Bottom Boundary. the Hardware Has No Awareness of This Crossing -- It Simply Writes to Whatever Address Sp Points To.

### Step 2: Adjacent Memory Is Silently Overwritten the Bytes Immediately Below the Stack in Memory Belong to Something Else: Another Task's Stack in an Rtos, the Heap Metadata Block Headers, or Global Variables. As the Overflowed Function Writes to Its Local Variables, Those Writes Land in the Adjacent Region. the Owning Module Has No Indication That Its Memory Has Been Modified. If a Heap Block Header Is Corrupted, the Heap Allocator's Internal Linked List Is Now Broken -- the Next Call to Malloc or Free Will Either Return Nonsense or Hard Fault. If a Global Variable Is Overwritten, the Module Using It Will Observe Unexpected State.

### Step 3: The Return Address Is Overwritten in a Severe Overflow, the Stack Pointer Descends Far Enough That the Return Address Itself (pushed Onto the Stack When the Function Was Called) Is Overwritten with Garbage. When the Function Returns, the Cpu Loads This Garbage Value Into the Program Counter (pc). the Processor Attempts to Execute Code at That Invalid Address. on Cortex-M, If the Address Falls Outside Mapped Flash, a Hardfault or Busfault Fires. If the Address Happens to Land Inside Valid Flash, Execution Continues From the Wrong Location -- a Far More Dangerous Outcome Because the System Continues Running.

### Step 4: The Symptom Appears in an Unrelated Location Because the Corruption Happened in One Place but Manifested Elsewhere, the Symptom Typically Points to the Wrong Module. the Watchdog Fires During a Uart Transmission Routine Because the Uart Transmit Buffer Pointer -- Which Was the Global That Got Overwritten -- Is Now Pointing to Address Zero. the Engineer Debugging This Will Spend Hours Inspecting the Uart Driver Before Realizing the Driver Is the Victim, Not the Cause.

### Step 5: The Mpu Fires (if Configured Correctly) If a No-Access Mpu Region Has Been Configured at the Bottom of Each Task's Stack, the First Write Into That Guard Region Triggers a Memmanage Fault Immediately When the Overflow Crosses the Boundary. the Fault Handler Captures the Faulting Address (available in the Mmfar Register), the Faulting Instruction (pc From the Stacked Exception Frame), and the Task Context. the Engineer Now Has Precise Information: Which Task Overflowed, by How Much, and From Which Line of Code.

### Step 6: The Canary Check Provides a Second Line of Detection at Each Rtos Task Switch, the Scheduler Checks Whether the Canary Value at the Bottom of the Outgoing Task's Stack Is Still Intact. If the Canary Has Been Modified, the Scheduler Calls an Application-Defined Hook (for Example, Vapplicationstackoverflowhook in Freertos) Before the Overflow Propagates Further. This Catches Overflows That Occurred Inside the Stack's Legitimate Range but Past the Canary -- Overflows That the Mpu Guard Region Did Not Detect Because the Guard Region Is Only at the Absolute Boundary.

## Under the Hood

On ARM Cortex-M3/M4/M7, the MPU supports up to 8 or 16 configurable regions (8 on M3/M4, 16 on M7). Each region is defined by a base address, a size (which must be a power of two and at least 32 bytes), and a set of permissions encoded in the MPU_RASR register. The permissions include access type (no-access, read-only, read-write), privilege level (privileged-only versus user-accessible), and execute-never (XN) bit. Setting XN on the data SRAM region prevents execution of injected shellcode -- relevant for systems that accept arbitrary data over external interfaces.

When the MPU detects an access violation, it escalates to the MemManage exception (exception number 4 on Cortex-M). The faulting address is saved in the MMFAR register and the MMARVALID bit in the CFSR register tells you whether that address is valid. The CFSR also encodes whether the fault was a data access violation (DACCVIOL) or an instruction fetch violation (IACCVIOL). The CPU stacks the exception frame automatically before entering the fault handler, so registers R0-R3, R12, LR, PC, and xPSR are preserved. Reading the stacked PC from the frame gives you the exact instruction that caused the violation.

Heap fragmentation operates through the allocator's free block list. A typical embedded allocator like the FreeRTOS heap_4 implementation maintains a linked list of free blocks sorted by address. Each free block contains a size field and a pointer to the next free block embedded in the first bytes of the block. A buffer overflow that writes past the end of an allocated block can corrupt the size field or the next-pointer of the adjacent free block. The allocator does not validate these fields on each access, so the corrupted list is not detected until a subsequent malloc or free traverses into the corrupted region and either writes to an invalid address or returns a nonsensical block pointer.

Dangling pointer bugs are invisible to the MPU when the freed memory has been reallocated before the dangling access occurs. The MPU does not know that the memory was freed and reused -- it only enforces the permission settings for the region, which remain read-write throughout. This is why tools like heap poisoning (filling freed blocks with a known byte pattern like 0xDE or 0xAB) are useful: they make dangling pointer reads return an obviously wrong value rather than stale but plausible data, and dangling pointer writes corrupt a distinctive pattern that shows up clearly in a memory dump.

The Cortex-M stack pointer behavior at exception entry is also a source of subtle bugs. When an exception occurs, the CPU automatically pushes 8 words (32 bytes) onto the stack of the interrupted context before entering the handler. If the interrupted task's stack has fewer than 32 bytes of headroom, this automatic push itself causes an overflow. The resulting fault is a stacking error (STKERR bit in CFSR), not a MemManage fault, and it escalates directly to HardFault if MemManage is not enabled. Engineers who size task stacks exactly to observed peak usage without this interrupt overhead margin encounter intermittent HardFaults under interrupt load.

## Real-World Applications

AUTOMOTIVE (AUTOSAR, ISO 26262) In AUTOSAR-compliant ECUs (engine control units, ABS controllers), the OS layer (OSEK/ AUTOSAR OS) mandates stack monitoring for each task and ISR category. The MPU is configured with distinct regions per software component to enforce memory partitioning between safety-critical and non-safety-critical partitions. A fuel injection timing miscalculation caused by a stack overflow in a lower-priority task corrupting a shared data structure is a safety-critical defect under ISO 26262, requiring full root-cause analysis and design change documentation.

MEDICAL DEVICES (FDA 510k / IEC 62304) Infusion pumps, ventilators, and glucose monitors running on Cortex-M4 or M7 devices use stack canaries and MPU partitioning as required evidence of memory safety in their software hazard analysis. IEC 62304 Class C software (where failure can cause death) requires that unintended memory access be considered as a hazard. A dangling pointer in the dose calculation module is not just a software bug -- it is a potential safety incident requiring regulatory reporting.

INDUSTRIAL (PLC, SCADA) Programmable logic controllers and industrial controllers frequently run user-uploaded ladder logic or function blocks alongside firmware. Buffer overflows in the protocol parsers for Modbus, EtherNet/IP, or PROFINET have historically been exploitable entry points. Industrial firmware engineers use buffer length validation at every protocol parsing boundary and separate MPU regions for user-uploaded code pages.

CONSUMER ELECTRONICS (IoT, Wearables) A wearable device on an nRF52840 processing BLE advertisement packets is a classic buffer overflow target. The advertisement payload length field is attacker-controlled. Without an explicit check that the declared length does not exceed the receive buffer size before copying, a malformed advertisement packet can overwrite stack data in the BLE host stack. Several public CVEs against embedded BLE stacks (BlueBorne, SweynTooth) are precisely this class of vulnerability.

AEROSPACE Avionics software under DO-178C prohibits dynamic memory allocation after initialization entirely, eliminating heap fragmentation and use-after-free as a class. All memory is statically allocated at build time. Stack sizes are analytically bounded using call graph analysis tools. This is the most conservative approach and is warranted for the certification level, though it requires significant up-front analysis.

## Common Mistakes

MISTAKE 1: SIZING STACK BY "IT WORKS IN TESTING" What goes wrong: Task stack sizes are tuned to the minimum observed depth during development. Under production conditions (higher interrupt rates, longer call chains in edge-case code paths, recursive parsing), the stack overflows intermittently. How to avoid it: Use the MPU guard region plus FreeRTOS uxTaskGetStackHighWaterMark() to measure actual peak usage over extended soak tests, then add a minimum 20% safety margin on top of the worst observed case.

MISTAKE 2: IGNORING THE RETURN VALUE OF MALLOC What goes wrong: malloc returns NULL when allocation fails (due to fragmentation or exhaustion). Code that does not check the return value proceeds to dereference NULL, writing to address 0x00000000, which on Cortex-M contains the initial stack pointer value from the vector table -- in flash, typically read-only -- causing a HardFault that looks completely unrelated to the failed allocation. How to avoid it: Treat malloc return value checking as a hard coding standard. In MISRA C:2025, Rule 21.3 restricts malloc/free in safety-critical code -- avoid them post-init.

MISTAKE 3: USING strcpy, sprintf WITHOUT LENGTH CHECKS What goes wrong: strcpy and sprintf do not take a destination buffer size argument. A source string longer than the destination causes a buffer overflow. This is especially dangerous in protocol parsers and debug logging code where string length is input-dependent. How to avoid it: Use strlcpy, snprintf, or memcpy with explicit length parameters everywhere. Statically analyze for unsafe string functions (PC-lint, Polyspace, cppcheck all flag these by default).

MISTAKE 4: USING POINTERS TO LOCAL VARIABLES AFTER FUNCTION RETURN What goes wrong: A function returns a pointer to one of its local variables. The calling code stores this pointer and uses it later. The local variable's stack frame has been overwritten by subsequent function calls by the time the pointer is dereferenced. The data read is garbage from a later stack frame. How to avoid it: Never return pointers to local variables. Enable the -Wreturn-local-addr GCC warning flag. For data that must outlive a function, use static allocation or explicitly pass a caller-owned buffer as a parameter.

MISTAKE 5: DEALLOCATING MEMORY AND LEAVING THE POINTER NON-NULL What goes wrong: free(ptr) is called but ptr still holds the old address. A later code path checks if ptr is non-NULL (assuming non-NULL means valid) and dereferences it. The memory has been reallocated to a different object; the write corrupts that object. How to avoid it: Immediately set ptr = NULL after every free(). This is a house style rule, not an optional cleanup. A second free(NULL) is defined as a no-op in C11; a second free(ptr) where ptr is non-NULL is undefined behavior.

MISTAKE 6: HEAP AND STACK GROWING TOWARD EACH OTHER What goes wrong: In a single-threaded bare-metal system with the heap starting after .bss and the stack at the top of RAM growing downward, deep call chains combined with heap growth can cause a collision with no hardware detection. The stack silently overwrites heap data or vice versa. How to avoid it: Place a no-access MPU region at the address where heap top and stack bottom are expected to meet. Alternatively, use a linker assertion that verifies heap_end + minimum_stack_size does not exceed RAM_END.

MISTAKE 7: ASSUMING DMA BUFFERS ARE SAFE BECAUSE "HARDWARE WRITES THEM" What goes wrong: A DMA transfer is configured with a destination address and a byte count. If the DMA count register is misconfigured (for example, set to the total FIFO depth rather than the actual data length), the DMA engine writes past the end of the destination buffer. This happens outside the CPU, so no instruction-level watchpoint or MPU access check fires -- the MPU only intercepts CPU-initiated accesses on most Cortex-M implementations. How to avoid it: Validate DMA transfer lengths against buffer sizes in the DMA configuration code. Use the DMA transfer-complete interrupt to verify received byte count before processing.

## Debugging and Troubleshooting

**Symptom:** System resets (watchdog) intermittently, no repeatable trigger.

**Possible Cause:** Stack overflow in a task or ISR corrupting the RTOS scheduler state or a critical global variable. Investigation: Enable FreeRTOS stack overflow detection (configCHECK_FOR_STACK_OVERFLOW set to 2). Add vApplicationStackOverflowHook that disables the watchdog and logs the task name. Also configure MPU guard regions at the bottom of each task stack. Run a 24-hour soak test. If no hook fires, use uxTaskGetStackHighWaterMark() on each task at regular intervals and log the minimum free stack across the run.

**Resolution:** Increase the stack size of the task identified by the hook or high watermark measurement. If the overflow is in an ISR, audit the ISR for local variable usage and reduce call depth.

**Symptom:** HardFault with CFSR showing IBUSERR or PRECISERR, PC pointing to an address in the middle of a valid function but wrong context.

**Possible Cause:** Return address overwritten by stack overflow; CPU branched to a garbage address that happened to land in valid flash. Investigation: In the HardFault handler, read the stacked PC from the exception frame (MSP or PSP depending on EXC_RETURN value in LR). Disassemble the instruction at that address. If it does not make sense in context, the return address was corrupted. Examine the stacked LR to find the intended return address. Enable MPU guard regions and reproduce.

**Resolution:** Identify the overflowing function using the MPU fault location. Reduce local variable size, increase stack allocation, or split the function.

**Symptom:** malloc returns non-NULL but subsequent write causes HardFault at a seemingly unrelated address.

**Possible Cause:** Heap metadata corruption from a prior buffer overflow into an adjacent allocated block. The allocator returned a block whose header was corrupted; the returned "pointer" points to metadata, not user data. Investigation: Add heap integrity checking if your allocator supports it (heap_5 in FreeRTOS has limited support; custom allocators can add block-header magic number checks). Fill all freed blocks with a known byte pattern (heap poisoning). Inspect memory around the returned pointer in the debugger before the write that faults.

**Resolution:** Find the allocation that wrote past its bounds using size-mismatch analysis: compare the actual write size to the requested allocation size at each allocation site.

**Symptom:** A global variable contains a valid but stale value from a previous operating cycle, causing incorrect behavior. No fault, no assertion.

**Possible Cause:** Dangling pointer write: a freed buffer was reused by a new allocation that happens to overlap the global variable's logical counterpart in a different data structure. Or a buffer overflow reached the global variable from an adjacent stack frame. Investigation: Set a hardware data watchpoint on the global variable's address using the Cortex-M DWT (Data Watchpoint and Trace) unit. The DWT supports up to 4 watchpoints on Cortex-M4. Configure a write watchpoint on the variable; the debugger will halt at the exact instruction that performs the unexpected write.

**Resolution:** Address the identified write path -- either fix the overflow, correct the pointer lifetime, or add bounds checking at the identified write site.

## Design Considerations and Best Practices

1. CONFIGURE MPU GUARD REGIONS FOR EVERY STACK FROM DAY ONE Do not wait until you have a stack overflow to add MPU protection. Configuring a 32-byte no-access guard region at the bottom of each task stack and the MSP stack adds negligible overhead and converts silent corruption into an immediate, diagnosable fault. Set this up in your RTOS port initialization before any application code runs. On Cortex-M, regions must be power-of-two sized and aligned; a 32-byte region is the smallest valid size.

2. NEVER USE DYNAMIC ALLOCATION AFTER INITIALIZATION IN SAFETY-CRITICAL PATHS Allocate all resources during system startup, before the operational phase begins. This eliminates heap fragmentation from long-running operations and removes malloc failure as a runtime hazard. This approach is required by MISRA C:2025 and DO-178C for the highest criticality levels, and it is good practice everywhere. If you genuinely need dynamic behavior, use a fixed-size memory pool allocator (O(1) allocation, no fragmentation) rather than a general-purpose heap.

3. INSTRUMENT EVERY ASSERT TO LOG CONTEXT BEFORE HALTING An assertion failure in production that just halts the processor tells you nothing. An assertion failure that first writes the file, line, task name, and stack pointer to a non-volatile log and THEN halts gives you actionable diagnostic data. Use a macro that expands to this behavior. The cost is a few bytes of flash per assertion site and a small amount of NVRAM -- a worthwhile investment for any fielded device.

4. VALIDATE ALL EXTERNAL-FACING INPUT LENGTHS BEFORE COPYING Every byte of data that arrives from outside the processor (UART, SPI, I2C, CAN, BLE, Ethernet) must have its length validated against the destination buffer size before any copy operation. This is not an optional hardening step -- it is the primary defense against buffer overflows caused by malformed or malicious input. Write a wrapper function for each external input path that enforces this check, and route all input through it.

5. SET ptr = NULL IMMEDIATELY AFTER free(ptr) This is a simple mechanical discipline that eliminates the use-after-free and double-free classes of bugs. It does not require a tool or a compiler flag -- it is a coding standard rule that can be enforced in code review. If you are using a static analysis tool, enable the check for non-NULL pointers after free.

6. INCLUDE STACK DEPTH MEASUREMENT IN REGULAR SYSTEM TELEMETRY In an RTOS system, log the minimum free stack size for each task periodically (hourly, or at each system state transition). If a task's minimum free stack is shrinking over time, the system is experiencing a stack growth path that will eventually overflow. Catching this trend before it becomes a crash is far less expensive than debugging a field failure.

7. KEEP ISRs MINIMAL AND STACK-CHEAP Interrupt service routines share the MSP stack (or their own if using a separate ISR stack). Deep call chains in ISRs are expensive in stack space and increase interrupt latency. An ISR should set a flag or write to a queue and return. All processing logic should execute in task context, where the stack is isolated and the MPU region is configured appropriately.

8. USE COMPILER WARNINGS AS ERRORS IN CI -Wall -Wextra -Werror in GCC (or equivalent in IAR/ARMCC) catches a substantial fraction of memory error patterns at compile time: uninitialized variable use, implicit truncation, return-of-local-address, array subscript out of range (for compile-time-known indices). Treat warnings as errors in your continuous integration pipeline so they cannot accumulate.

## Expert Notes

**The Mpu Does Not Protect Against All Overflows** — ONLY THOSE THAT CROSS A REGION BOUNDARY A stack overflow that writes 4 bytes past the bottom of the stack will trigger the MPU guard fault. A stack overflow that writes 512 bytes past and lands in the guard region will also trigger it. But if your guard region is sized too large relative to the overflow distance, the first violating write may be inside the legitimate stack range (overwriting another local variable or the canary) before crossing into the guard. This is why BOTH the MPU guard AND the canary are necessary. The canary detects overflows within the stack region; the MPU catches overflows past it.

HEAP FRAGMENTATION IS A SLOW FAILURE, NOT AN IMMEDIATE ONE Engineers who test with a fixed scenario often dismiss fragmentation as a theoretical concern because their test allocations and frees look balanced. Fragmentation is a property of LONG-TERM ALLOCATION PATTERNS, particularly when allocations of different sizes are interleaved. Run your heap under the actual production message traffic (varying sizes, varying lifetimes) for at least several hours. Measure heap minimum free space over time. A heap that starts at 80% free and stabilizes at 40% free is healthy. One that slowly drifts to 5% free and then fails is not.

THE CORTEX-M EXCEPTION STACKING OVERHEAD CATCHES ENGINEERS OFF GUARD Every Cortex-M exception entry pushes 8 words (32 bytes) automatically, and if the FPU is enabled and lazy stacking is disabled (or the FPU registers are in use), an additional 18 words (72 bytes) of FPU context are pushed. An interrupt that fires at exactly the wrong moment can cause a 104-byte stack consumption event that was never visible in any test scenario. Engineers sizing stacks should account for the worst-case nested interrupt depth multiplied by the full exception frame size.

STATIC ANALYSIS FINDS WHAT CODE REVIEW MISSES, BUT HAS LIMITS Tools like PC-lint, Polyspace, Coverity, and cppcheck catch many buffer overflow and dangling pointer patterns through static analysis. However, they cannot analyze runtime conditions: a buffer overflow that only occurs when the input length field in a protocol message exceeds a specific threshold is not statically detectable if that threshold depends on runtime data. Static analysis is a complement to runtime protection, not a replacement for it.

MEMORY CORRUPTION IN MULTI-CORE OR DMA SYSTEMS IS HARDER TO ATTRIBUTE On devices with DMA controllers or multiple CPU cores (STM32H7 with its M7 + M4 cores, for example), memory corruption can originate from a DMA misconfiguration or a second-core write that bypasses the primary core's MPU entirely. A MemManage fault on Core 0 may have been caused by a preceding write from Core 1 that left the memory in an inconsistent state. When debugging corruption on multi-core or DMA-heavy systems, check DMA configuration registers and inter-core communication buffers first.

## Summary

Memory corruption in embedded systems is not a single failure mode -- it is a class of failures united by the common theme of a processor accessing memory in ways that were not intended, in ways the hardware does not natively prevent, and in ways that often manifest far from the original fault site. Stack overflow, buffer overflow, dangling pointers, and heap fragmentation each have distinct causes and detection strategies, but they share the same consequence: silent, unpredictable system behavior that is expensive to reproduce and diagnose.

The practical defense is layered: hardware enforcement through the MPU catches spatial violations at the boundary the moment they occur. Software canaries provide a secondary detection layer for overflows that land inside permitted regions. Runtime assertions and heap integrity checks surface logical violations before they propagate. And design discipline -- no post-init dynamic allocation in safety paths, strict input length validation, null-after-free, ISR minimization -- reduces the surface area of vulnerabilities in the first place.

Debugging these failures effectively requires understanding the CPU's exception frame structure, the DWT watchpoint hardware, and your RTOS's stack monitoring hooks well enough to extract maximum information from the moment of failure. A fault handler that captures the full context (stacked PC, SP, PSP versus MSP, CFSR, MMFAR, task name) before halting or resetting transforms a mysterious intermittent crash into a traceable, fixable defect.

The mental model to retain is this: in an embedded system without OS-level process isolation, memory safety is a PROPERTY YOU MUST DELIBERATELY ENGINEER, not a guarantee the platform provides. Every allocation, every pointer, every external input, and every stack size is a decision with a safety consequence. The engineers whose firmware does not fail in production are not the ones who never made mistakes -- they are the ones who built systems that caught their mistakes before shipping.

## Related Topics

Prerequisites: - Memory Architecture (stack layout, heap, .data/.bss, linker scripts, address maps) - Concurrency and Synchronization (RTOS tasks, ISR interaction, shared data hazards)

Next Topics: - Embedded Security Fundamentals (attack surfaces, secure boot, code injection defenses, MPU as a security boundary) - Fault Handling (HardFault anatomy, fault handler design, fault logging, recovery strategies, watchdog integration)
