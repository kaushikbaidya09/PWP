---
id: bare-metal-architecture
tags: ['HAL', 'Architecture', 'Bare-metal']
---

# Bare-Metal Architecture: Building Systems Without an RTOS

You are three weeks into a new embedded project. The hardware is a small STM32F030 microcontroller driving an LED matrix, reading four buttons, and sending periodic UART status messages to a host. Your manager suggests dropping in FreeRTOS to "keep things organized." You spend a day wiring up tasks, a scheduler, and semaphores. Then you discover the chip has 4 KB of RAM. FreeRTOS eats 2 KB before your application even starts. You are out of memory before you have written a single line of real logic.

This scenario plays out constantly in embedded development. An RTOS is a powerful tool, but it is not always the right tool. For a large class of real products -- from simple sensor nodes to industrial I/O modules to consumer appliances -- the firmware runs without any operating system at all. This approach is called bare-metal programming, and it is not a fallback for engineers who do not know better. It is a deliberate architectural choice with clear tradeoffs.

Bare-metal firmware runs directly on the hardware. There is no kernel, no scheduler provided by a third party, no task abstraction. The firmware has complete, unmediated access to every register, every peripheral, every cycle. That directness is both its strength and its hazard. It demands that the engineer think carefully about program flow, timing, and responsiveness -- things that an RTOS would otherwise manage automatically.

Understanding bare-metal architecture also makes you a better RTOS programmer. When you understand what the superloop is actually doing, why cooperative scheduling breaks down under load, and what event flags really represent at the hardware level, you can make informed decisions about when to add an OS and what that OS is buying you.

By the end of this article, you will understand how bare-metal firmware is structured, why the superloop pattern is universal and where it fails, how cooperative scheduling works and how to implement it, how event flags allow interrupt-driven logic to communicate cleanly with foreground code, and what design disciplines keep bare-metal systems maintainable in production.

## The Fundamental Problem

A microcontroller can only execute one instruction at a time. But real systems need to do many things: read sensors, update displays, respond to button presses, transmit data, and handle faults. The fundamental problem of embedded firmware architecture is how to give the illusion of simultaneous progress on multiple tasks when the hardware is inherently sequential.

The naive approach is to write everything in sequence inside main(). Read the sensor, then check the button, then send the UART byte, then update the display, repeat forever. This works fine as long as every operation completes quickly and nothing is time-sensitive. But sensors may need 50 ms to convert. UART transmits may block waiting for a buffer. Button debounce requires waiting 20 ms. The moment any one operation blocks, everything else stalls. A button press that arrives during a sensor conversion is missed. A UART byte that needs to be sent is delayed. The system becomes unresponsive.

An RTOS solves this by introducing preemptive multitasking: a scheduler interrupts running tasks on a timer tick and switches between them. But preemption has costs. Every task needs a dedicated stack. Context switches take CPU time. Shared data requires mutexes and semaphores. On a small MCU with 4 KB RAM, those costs are prohibitive. Even on a larger MCU, the complexity may not be justified when the system's behavior is simple enough to reason about without it.

Bare-metal architecture solves the same problem differently. Instead of running tasks in parallel, it structures the program so that no single operation ever blocks for long. It uses interrupts to capture time-critical events immediately, and it uses flags and state machines to defer the non-urgent work to a central loop that processes it when it gets to it. The result is a system that is responsive without preemption, predictable without a scheduler, and lean enough to fit in constrained memory.

## The Big Picture

A bare-metal system has two execution contexts: the FOREGROUND (interrupt service routines) and the BACKGROUND (the main loop). The foreground is event-driven and runs at any time, preempting the background. The background runs continuously, polling state and processing deferred work. These two contexts communicate through shared variables -- typically flags, ring buffers, or state variables -- that are set by the foreground and consumed by the background.

The background loop is called the SUPERLOOP. It is an infinite loop inside main() that calls every module in the system in a fixed sequence. Each module is written to be NON-BLOCKING: it does a small increment of work and returns immediately. Modules that need to track progress over time use state machines. Modules that need to know something happened use event flags set by ISRs. The result is a cooperative system: every module yields control voluntarily on each pass through the loop.

The diagram below shows the overall structure:

<div class="detail-diagram">
<img src="../assets/svg/diagrams/foreground_background.svg" alt="Foreground/Background Bare-Metal Architecture" loading="lazy">
</div>

The key insight is that the superloop never stops. It cycles through every module, every pass. The modules themselves use flags and state machines to decide whether they have work to do on any given pass. If a module has nothing to do, it returns in a few cycles. The overall loop rate becomes a measure of system responsiveness.

## Key Concepts and Terminology

**Superloop** — The infinite while(1) loop that forms the backbone of bare-metal firmware. It calls each module in sequence, repeatedly, forever. The superloop itself has no knowledge of time or priority; it simply iterates. The burden of non-blocking behavior falls entirely on the modules it calls.

**Foreground Context** — The execution context of interrupt service routines. ISRs run at hardware-defined priority levels and can preempt the background at any instruction boundary. On ARM Cortex-M, the NVIC manages up to 240 external interrupt lines, each with configurable priority. Foreground context is inherently asynchronous.

**Background Context** — The main execution context, running in the superloop. This is where application logic lives. The background is preemptible by any enabled interrupt. It has no inherent time guarantees -- its cycle time depends entirely on how long each module takes per iteration.

**Event Flag** — A variable (typically a volatile uint8_t or uint32_t bit field) that an ISR sets to signal that something has happened. The background reads and clears the flag during its next pass. An event flag bridges the asynchronous foreground with the sequential background. It is the primary IPC mechanism in bare-metal systems.

**Cooperative Scheduling** — A scheduling model where each piece of code voluntarily yields control after a bounded amount of work. Unlike preemptive scheduling, no external mechanism forces a context switch. Correctness depends on every module obeying the non-blocking contract.

**Latency** — The time between an event occurring and the firmware responding to it. In bare-metal systems, latency has two components: ISR latency (time to enter the ISR after the hardware event, typically a few cycles on Cortex-M) and processing latency (time for the background to reach the module that handles the event, which depends on loop cycle time).

**Loop Cycle Time** — The total time for one complete pass through the superloop. This sets the worst-case response time for any event handled in the background. If the loop cycle time is 5 ms, a button press may not be processed for up to 5 ms after it is flagged. Loop cycle time must be measured and bounded, not assumed.

**State Machine** — A construct that divides a multi-step process into discrete states, advancing one step per call without blocking. Instead of "wait until ADC is done," a state machine has a WAIT_FOR_ADC state that returns immediately if conversion is not yet complete, and transitions to the next state when the flag is set.

**Critical Section** — A region of code that must execute atomically with respect to interrupts. When background code reads a multi-byte variable that an ISR can modify, a torn read is possible unless interrupts are briefly disabled. On ARM, this is done with __disable_irq() / __enable_irq() or LDREX/STREX for finer control.

**Tick** — A periodic hardware timer interrupt that advances a software time base. Many bare-metal systems run a 1 ms tick (like SysTick on ARM Cortex-M) to enable non-blocking delays and timeouts. Modules check elapsed tick count rather than spinning in a delay loop.

## How It Works

STEP 1: SYSTEM INITIALIZATION BEFORE THE LOOP BEGINS

When reset is released, the CPU begins executing from the reset vector. On ARM Cortex-M, the startup code (written in assembly or provided by the vendor) initializes the stack pointer, copies initialized data from flash to RAM, zeros the BSS segment, and calls main(). Inside main(), the firmware runs through system initialization: clock configuration (setting PLL multipliers, AHB/APB prescalers), peripheral initialization (GPIO direction, UART baud rate, SPI mode), NVIC configuration (enabling interrupts, setting priorities), and module initialization (resetting state machines, clearing flags). Only after all initialization is complete does execution enter the superloop. This ordering matters -- enabling an interrupt before the handler is ready is a common source of startup crashes.

STEP 2: THE SUPERLOOP BEGINS AND CALLS THE FIRST MODULE

Execution falls into the while(1) loop. Each call to a module is a function call to a non-blocking run function, conventionally named module_run() or module_process(). The module checks its state, checks any relevant flags, does the minimum work needed, updates its internal state, and returns. From the superloop's perspective, this is just a function call that returns in bounded time. The loop does not know or care what the module did -- it simply moves to the next call.

STEP 3: AN INTERRUPT FIRES DURING THE LOOP

While the background is executing (anywhere in the loop, at any instruction), a hardware event occurs -- a UART byte arrives, a GPIO edge triggers, a timer expires. The CPU hardware automatically saves the program counter, processor status register, and scratch registers onto the current stack (the process stack on Cortex-M with an RTOS, or the main stack in bare-metal). It then jumps to the ISR. The ISR runs to completion -- it should do the minimum necessary work: read the hardware register (clearing the hardware flag), push data to a ring buffer or set an event flag, and return. On return, the CPU restores the saved context and the background continues from exactly where it was interrupted.

STEP 4: THE BACKGROUND CONSUMES THE EVENT FLAG

On the next pass through the loop, the module that owns that event reaches its flag check. It sees the flag set, clears it atomically, and processes the event. For a UART receive module, this might mean pulling bytes from the receive ring buffer and advancing a protocol parser state machine. For a button module, it might mean starting a debounce timer. The module does not process the entire event in one call -- it does one step, updates its state, and returns. If there is more work, the next pass will continue it.

STEP 5: TIMEOUTS AND NON-BLOCKING DELAYS VIA THE TICK

A SysTick or general-purpose timer ISR fires every 1 ms and increments a global volatile uint32_t tick counter. Modules that need to wait -- for a debounce period, a sensor conversion time, a retransmit timeout -- record the tick count at the start of the wait and compare on each pass. "Has 20 ms elapsed since I set this timestamp?" is a non-blocking check. The module returns immediately if the time has not elapsed. This eliminates all busy-wait delays from the background, keeping loop cycle time short and deterministic.

STEP 6: THE LOOP REPEATS AND CYCLE TIME IS MAINTAINED

After all modules have been called once, the loop wraps around and starts again. The cycle time for one complete pass is the sum of the execution times of all module calls for that pass. Because modules are non-blocking, each call is short. A typical bare-metal superloop on an STM32 running at 48 MHz might complete a full pass in under 100 microseconds when there is nothing urgent to process, and under 1 ms even under heavy load. This cycle time is the system's background response latency, and it should be measured with a GPIO toggle and oscilloscope during integration testing.

## Under the Hood

On ARM Cortex-M, the transition from background to ISR context is handled entirely in hardware. When an interrupt fires, the CPU executes an automatic push of eight registers (PC, PSR, R0-R3, R12, LR) onto the stack -- this is called exception entry stacking and takes a fixed number of cycles (12 cycles on M0, fewer on M4 with late-arriving optimization). The CPU then loads the handler address from the vector table in flash and jumps to it. On ISR return, the special EXC_RETURN value in LR signals to the CPU to unstacked those registers and resume the background. This is why ISRs on Cortex-M do not need a special return instruction -- the hardware manages the context switch.

The volatile keyword is essential to correctness in bare-metal systems. When a variable is shared between an ISR and the background, the compiler must not optimize away reads or writes to it. Without volatile, the compiler may cache the variable in a register and never re-read it from memory, so changes made by the ISR are invisible to the background code. Every event flag, every ISR-modified counter, and every shared buffer pointer MUST be declared volatile. This is not optional and not a performance concern -- it is a correctness requirement.

Multi-byte variables require special attention. On a 32-bit Cortex-M, a 32-bit read is atomic. But if you read a 32-bit variable that is updated by an ISR in two separate 16-bit writes (which the compiler may generate for some operations), you can read a torn value: the high half from before the ISR fired and the low half from after. The safe pattern is to disable interrupts briefly around the read, or to use atomic operations available in C11 or vendor-provided intrinsics. On Cortex-M3/M4, the LDREX/STREX instructions provide a load-linked/store-conditional primitive for lock-free updates.

Memory layout matters directly in bare-metal systems. The linker script places the vector table at the start of flash (or wherever the VTOR register points). Each entry is a 32-bit address: the reset value of the stack pointer at offset 0, the reset handler at offset 4, NMI at offset 8, HardFault at offset 12, and so on up through all peripheral IRQ vectors. If an interrupt fires for which no handler has been installed, execution typically falls to the default handler (usually an infinite loop) -- this is how many bare-metal bugs first manifest as a hung system with no error output.

Loop cycle time is not always constant. If a module has a burst of work to do -- a full UART frame arrived, or the display needs a full refresh -- that pass through the loop takes longer. This jitter in loop cycle time is a fundamental property of cooperative scheduling: one module that does too much work on a single pass degrades the responsiveness of everything else. Profiling the worst-case pass time under maximum load is a required validation step before releasing bare-metal firmware.

## Real-World Applications

### Automotive

Body control modules (BCMs) in vehicles often run bare-metal firmware on mid-range MCUs such as the NXP S32K or Renesas RH850. These modules control power windows, door locks, lighting, and mirror adjusters. The I/O is highly repetitive: scan inputs, apply debounce, drive outputs, manage timing. A superloop with cooperative modules maps naturally to this workload, and the absence of an OS scheduler removes one class of nondeterminism in a safety-relevant system. LIN bus drivers in these modules are classic examples of ISR-driven ring buffers consumed by a background state machine.

### Industrial

Programmable logic controllers (PLCs) and industrial I/O modules frequently run bare-metal on processors such as the STM32F4 or TI Tiva C. A fixed scan cycle -- analogous to the superloop -- is central to IEC 61131-3 programming models. The firmware reads all digital and analog inputs at the top of the scan, runs the logic program, and writes all outputs at the end. Determinism of cycle time is a contractual requirement in many industrial applications, and bare-metal firmware provides it more reliably than a preemptive OS without careful tuning.

### Consumer Electronics

Small appliances -- microwave ovens, dishwashers, HVAC thermostats -- run on 8-bit AVR or PIC controllers with 512 bytes to 2 KB of RAM. An RTOS is simply not possible on these platforms. The firmware is a superloop with a 1 ms tick, button scan, display refresh, and a heating element or motor control state machine. Millions of these devices ship every year running straightforward bare-metal code that has been in production for decades.

### Medical

Class II medical devices (blood glucose meters, infusion pump UI controllers, vital sign monitors) often use bare-metal firmware in the interest of determinism, auditability, and regulatory simplicity. An RTOS introduces a third-party software component that must be qualified under IEC 62304. Bare-metal firmware has a simpler software architecture that is easier to validate. The tradeoff is that the engineer must rigorously bound all loop cycle times and prove responsiveness requirements are met without the scheduler's help.

### Iot / Wireless Sensor Nodes

Low-power IoT nodes on Nordic nRF52 or STM32L0 series often run bare-metal to minimize power consumption. The pattern is: wake on RTC interrupt, set a flag, the superloop processes the wakeup, takes a sensor reading via state machine, packages the data, triggers a BLE or LoRa transmission, then enters a low-power sleep mode. The entire active window may be under 10 ms. An RTOS tick running at 1000 Hz would prevent deep sleep and destroy battery life.

## Common Mistakes

**Blocking Inside the Superloop** — A module calls HAL_Delay() or spins waiting for a hardware flag inside its run function. This stalls the entire loop for the duration of the delay. Every other module misses its scheduled processing time. Replace all blocking waits with timestamp comparisons against the tick counter. If the HAL provides only blocking APIs (as STM32 HAL often does by default), write non-blocking wrappers using the IT or DMA variants.

**Non-Volatile Event Flags** — The event flag variable is declared as uint8_t flag instead of volatile uint8_t flag. The compiler optimizes the background loop into a read that never re-fetches the variable from memory, so the flag set by the ISR is never seen. The symptom is a system that appears to stop responding to events after the first few seconds of operation.

**Missing Critical Sections on Multi-Byte Reads** — A 32-bit timestamp is read by the background while the SysTick ISR is in the middle of incrementing it. The background reads a value that is one increment in progress, getting a number that is neither the old value nor the new value. Protect all multi-byte shared variable reads with a brief interrupt disable, or use a read-twice-compare pattern for read-only tick timestamps.

**Unbounded Module Execution Time** — A module iterates over a large array, parses an entire packet, or does floating-point math in a loop. The loop cycle time balloons on certain inputs. All module run functions must have a measurable, input-independent upper bound on execution time. Use a GPIO toggle and an oscilloscope to verify worst-case timing.

**Flag Cleared Before Data Consumed** — The background clears the event flag at the top of the handler before reading the data the ISR placed alongside it. If another interrupt fires between the flag clear and the data read, the new data overwrites the old, and the old data is silently lost. Always read the data first, then clear the flag, or use a ring buffer where the read and remove operations are coupled.

**Priority Inversion via Busy-Wait in Isr** — An ISR waits for a hardware peripheral to become ready (polls a status register in a loop). While the ISR is spinning, no lower-priority interrupt can fire, and the background is completely blocked. ISRs must NEVER busy-wait. If the peripheral is not ready, set a flag and return. Use interrupt chaining (enable the "ready" interrupt and handle it in its own ISR).

**No Mechanism to Detect Loop Overrun** — The design assumes loop cycle time is 1 ms, but nothing monitors it. Under load or due to a regression, cycle time grows to 10 ms and timing-sensitive logic breaks. Add a watchdog or a GPIO toggle measured by an oscilloscope or logic analyzer to detect loop overrun in integration testing.

## Debugging and Troubleshooting

**Symptom:** System stops responding to a specific event after running normally for some time.

**Possible Cause:** The event flag is not volatile, or the flag is being set and cleared in the same ISR (e.g., the ISR reads the data and clears the hardware flag, but inadvertently also clears the software event flag before the background processes it).

**Investigation Method:** Set a GPIO high at the start of the ISR and low when the ISR returns. Set a second GPIO high when the background clears the software flag. Capture both on a logic analyzer. Verify the timing and sequence of set/clear operations. Inspect the disassembly of the background loop to confirm the compiler is re-reading the flag variable from memory on each iteration.

**Resolution:** Add volatile to the flag declaration. Separate the hardware interrupt clear (done in ISR) from the software event flag clear (done in background after data read).

---

**Symptom:** System hangs immediately on startup with no output.

**Possible Cause:** An interrupt fires during initialization before its handler is ready, landing in the default HardFault or infinite-loop default handler.

**Investigation Method:** Connect a debugger (J-Link or ST-Link). Halt the CPU. Read the PC register. If it is inside the default handler or at address 0xFFFFFFFE, an unhandled exception occurred. Enable fault status registers (CFSR, HFSR on Cortex-M3/M4) and read them. Check which peripheral interrupt fired prematurely.

**Resolution:** Move peripheral interrupt enable to the END of the initialization sequence for that peripheral, after all state machines and buffers are initialized. Never enable an interrupt before the corresponding handler is ready to process it.

---

**Symptom:** A state machine gets stuck in an intermediate state and never completes its sequence.

**Possible Cause:** The event flag that triggers the next state transition is being set and immediately cleared by the background before the state machine checks it, or the flag is set by an ISR that fires faster than the loop cycle time, causing intermediate events to be missed.

**Investigation Method:** Add a counter that increments each time the flag is set (in the ISR) and each time it is consumed (in the background). Log or transmit these counters via UART. If the set counter increments faster than the consume counter, events are being lost.

**Resolution:** Replace the single-bit event flag with a ring buffer or an event counter (an integer that the ISR increments and the background decrements). This captures every event even when they arrive faster than the loop can process them.

---

**Symptom:** Loop cycle time is much longer than expected, causing missed timing deadlines.

**Possible Cause:** One module is taking longer than expected per call -- either due to a blocking API, a long computation, or an unexpected code path triggered by a specific input.

**Investigation Method:** Instrument each module call in the superloop with a GPIO toggle (high before call, low after). Capture all channels on a logic analyzer. The channel that stays high the longest identifies the offending module. Then instrument inside that module to find the specific code path.

**Resolution:** Refactor the offending module to limit per-call work. Move long computations into a multi-step state machine. Replace blocking HAL calls with non-blocking interrupt-driven equivalents.

## Design Considerations and Best Practices

BOUND EVERY MODULE'S WORST-CASE EXECUTION TIME

Measure it with hardware GPIO and an oscilloscope during development, not by reading code. Compilers, cache effects, and peripheral timing all contribute to actual execution time in ways that are invisible from source code alone. Document the measured worst-case for each module and sum them to verify the system-level loop cycle time budget.

TREAT EVENT FLAGS AS ONE-SHOT SIGNALS, NOT STATE

A flag should mean "this event happened once." If the ISR fires twice before the background runs, a single flag loses one event. Use a saturating counter or ring buffer when events can arrive in bursts. Reserve single-bit flags for events where only the most recent occurrence matters (such as "new ADC result available" when you only ever want the latest reading).

### Initialize All Modules Before Entering the Superloop

Set every module's internal state, clear every flag, configure every peripheral, and enable every interrupt only after all initialization is complete. An interrupt that fires before its handler is ready is one of the most common causes of startup crashes. The initialization sequence is as much a part of the architecture as the loop itself.

KEEP ISRs AS SHORT AS POSSIBLE

An ISR that runs for 100 microseconds is blocking every lower-priority interrupt for that entire duration. The recommended pattern is: read the hardware status register, push data to a ring buffer or set a flag, clear the hardware interrupt flag, and return. All processing belongs in the background. This is called the "defer to background" pattern and it is the single most important ISR design rule.

### Make the Tick Counter Rollover-Safe

The 32-bit tick counter used for non-blocking delays will wrap to zero after approximately 49 days at 1 ms resolution. Timeout comparisons using subtraction (elapsed = now - start) handle rollover correctly because unsigned integer subtraction wraps in the same way. Comparisons using greater-than operators do not handle rollover correctly. Use the subtraction pattern universally.

### Use a Module-Per-Concern Architecture

Each module owns one concern (buttons, UART, sensor, display, fault detection) and exposes an init() function and a run() function. Modules communicate through well-defined interfaces (function calls, shared state structures) rather than direct global variable access. This discipline makes bare-metal code testable on a host machine and maintainable as the project grows.

### Validate Responsiveness Under Worst-Case Load

Test the system with all events firing simultaneously, not in sequence. Inject UART traffic while also triggering button presses and forcing ADC conversions. Measure loop cycle time under this load. Bare-metal systems are prone to unexpected latency spikes when multiple events coincide; this must be characterized before release.

### Document Shared Variables Explicitly

Every variable shared between an ISR and the background should have a comment identifying who writes it and who reads it. This is not documentation for its own sake -- it is the information a reviewer needs to verify that volatile is applied and that critical sections are correct. Missing this discipline is a consistent source of subtle concurrency bugs in production firmware.

## Expert Notes

THE LOOP CYCLE TIME IS YOUR CONTRACT WITH THE SYSTEM

Junior engineers often treat the superloop as "fast enough" without measuring it. Senior engineers treat the worst-case loop cycle time as a hard specification, like a timing requirement. They measure it at integration time, add margin, and re-measure it every time a new module is added. When a customer reports intermittent missed events in the field, the first question an experienced engineer asks is: what changed the loop cycle time?

COOPERATIVE SCHEDULING FAILS GRACEFULLY, BUT ONLY IF YOU BUILD IN DETECTION

When a preemptive RTOS has a problem, the watchdog fires or a task misses a deadline and you get a defined fault. When cooperative scheduling has a problem (a module starts taking too long), the system silently degrades. Responses become slower, timing becomes less accurate, but nothing crashes. This can hide problems in development testing and only reveal them in the field under specific load conditions. The remedy is to actively monitor loop cycle time in the firmware itself, assert on violations during development builds, and log worst-case values in production builds.

VOLATILE ALONE IS NOT ENOUGH FOR COMPLEX SHARED DATA

Volatile prevents compiler optimization from caching a variable, but it does not prevent the processor from reordering memory accesses. On ARM Cortex-M, the memory ordering model is weakly ordered for normal memory. For most bare-metal flag patterns this is not a problem because the interrupt entry and exit are defined memory barriers. But if you are writing a lock-free ring buffer with multiple producer/consumer relationships, you need to understand memory barriers and may need dmb instructions. This is a topic where "it works in testing" is not the same as "it is correct."

AN RTOS IS NOT ALWAYS MORE COMPLEX THAN BARE-METAL

There is a threshold where a bare-metal system with many modules, complex event dependencies, and real-time deadlines becomes harder to reason about than a simple RTOS with three tasks and two mutexes. Experienced engineers know that threshold and switch tools when it is crossed. The decision is not "bare-metal is simple, RTOS is complex" -- it is "which tool makes the behavior of this specific system easiest to reason about, test, and maintain?"

THE STARTUP CODE IS PART OF YOUR FIRMWARE, NOT A BLACK BOX

Many junior engineers treat the vendor-provided startup assembly as untouchable. In production firmware, you need to understand what it does: what it initializes, what it does not initialize, what assumptions it makes about memory layout. Bugs in the startup code (wrong BSS zero-fill, wrong stack pointer initialization, missing FPU enable on Cortex-M4) cause failures that are impossible to diagnose without understanding the startup sequence. Read it once, carefully, for every new platform you work on.

## Summary

Bare-metal architecture is a deliberate choice for systems where memory is constrained, determinism is required, or complexity does not justify an RTOS. The superloop provides a simple and reliable execution framework: a fixed-sequence, continuously-running loop that calls non-blocking module functions. The entire system's responsiveness depends on keeping every module's per-call execution time short and bounded. This is not a limitation to work around -- it is a discipline that forces clean module boundaries and testable code.

Interrupts are the foreground layer that makes bare-metal systems responsive to asynchronous events. The ISR-to-background communication pattern -- ISR sets a flag or pushes to a ring buffer, background consumes it on the next pass -- is the fundamental IPC mechanism of bare-metal firmware. Getting this pattern right requires volatile on shared variables, critical sections on multi-byte data, and ring buffers or counters when events can arrive faster than the loop can process them. These are not advanced topics; they are entry-level requirements for any bare-metal system that must be correct in production.

Cooperative scheduling works because every module trusts every other module to yield promptly. When one module breaks that contract -- by blocking, by doing unbounded work, by busy-waiting in an ISR -- the entire system degrades. Detecting and preventing this degradation requires active instrumentation: GPIO timing measurements during integration, loop cycle time monitoring in firmware, and worst-case load testing before release. These disciplines apply equally to RTOS-based systems, but in bare-metal firmware they are the only defense against scheduling failures.

The mental model to retain is this: a bare-metal system is a round-robin of non-blocking state machines, driven by a foreground of minimal ISRs that signal work to be done. Every decision in the architecture -- how modules communicate, how timeouts are handled, how events are queued -- flows from the requirement that the loop must always keep turning, and that any module that breaks this rule breaks the entire system.

## Related Topics

Prerequisites: - MCU Boot Sequence (startup code, vector table, memory initialization) - Interrupts (NVIC configuration, ISR entry/exit, interrupt priorities on ARM Cortex-M, volatile and shared data)

Next Topics: - RTOS Fundamentals (tasks, scheduler, context switching, when bare-metal is no longer sufficient) - Event-Driven Systems (event queues, publish-subscribe patterns, extending bare-metal cooperative scheduling toward more structured event handling)
