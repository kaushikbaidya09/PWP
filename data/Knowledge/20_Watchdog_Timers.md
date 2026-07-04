---
id: watchdog-timers
tags: ['Watchdog', 'IWDG', 'WWDG', 'Reset']
---

# Watchdog Timers: Designing Systems That Recover

Imagine a medical infusion pump deployed in a hospital. Three weeks after installation, a nurse notices the display has frozen. The pump is no longer delivering medication. Nobody pressed a button, no alarm fired, and the firmware developer is unreachable on a Sunday morning. The root cause, discovered days later, was a rare race condition in the communication stack that locked up the scheduler. The pump had no way to detect that it had stopped doing useful work, and no mechanism to pull itself out of that state. This is not a hypothetical. Variants of this scenario happen in the field across every domain where embedded systems run unattended.

Embedded systems routinely run in environments where a human cannot intervene quickly or at all. A motor controller inside a factory robot, a remote weather station on a mountain, a gateway in a home security panel. These systems must be able to detect when they have gone wrong and do something about it without waiting for an engineer to arrive with a JTAG probe. The watchdog timer exists to solve exactly this problem. It is one of the oldest and most universally implemented peripherals in microcontrollers, and yet it is also one of the most commonly misused or underused.

Understanding the watchdog timer properly means understanding it not just as a counter that triggers a reset, but as a contract between the hardware and the firmware. The firmware says: "I am healthy and executing correctly." The hardware says: "Prove it periodically, or I will reset you." That contract, when designed well, can turn a bricked field deployment into a self-healing system.

By the end of this article, you will understand how watchdog timers work at the register level, the difference between independent and window watchdogs, how to design a meaningful feeding strategy that actually detects real failures, and how to build a recovery architecture that goes beyond a simple reset.

## The Fundamental Problem

Software crashes in ways that are not obvious. The most visible crash is a hard fault or an unhandled exception where the CPU jumps to a fault handler and execution clearly stops. Firmware engineers have become reasonably good at catching those. The harder class of failures are the ones where the CPU is still running, interrupts are still firing, and the stack looks healthy, but the system is no longer doing what it is supposed to do. A task that processes sensor data has entered an infinite loop because a flag was never cleared. A state machine received an unexpected event and transitioned to a state with no exit path. A priority inversion caused a critical task to starve. From the outside, the system looks alive. From a functional standpoint, it is dead.

The naive approach is to add more defensive checks and error handling inside the code. That is necessary but insufficient. Defensive code only protects against failure modes the developer anticipated. Field deployments expose systems to electromagnetic interference, brown-outs, cosmic ray bit flips in SRAM, and interaction patterns between subsystems that were never tested together. No amount of in-code checking fully covers the space of real-world failures. You need a mechanism that operates outside the normal execution context, one that does not depend on the software being in a good enough state to run its own health checks.

A software-only watchdog, such as a timer interrupt that checks a flag and resets via NVIC, is better than nothing but it has a fundamental weakness: if the failure mode affects the interrupt system or the memory where the flag lives, the software watchdog fails along with everything else. What you need is a peripheral that is largely independent of the main execution path, runs off its own clock source, and can assert a reset signal directly at the hardware level regardless of what the CPU is doing. That is exactly what the hardware watchdog timer provides.

## The Big Picture

At the system level, a watchdog timer is a down-counter peripheral clocked by an independent oscillator. The firmware must write a specific value (called a "kick" or "feed" or "refresh") to a register before the counter reaches zero. If the counter expires, the hardware asserts a system reset signal, pulling the MCU back to a known state. The firmware's job is to ensure that the kick only happens when real, meaningful work is being done, not just to blindly service the counter as fast as possible.

The watchdog sits in a supervisory role. It does not participate in normal data flow. It watches the system from outside and acts as a hardware-enforced liveness check. In a well-designed system, the watchdog reset path is treated with the same respect as a power-on reset: the firmware checks the reset cause register on startup, logs the event, and attempts a clean recovery before returning to normal operation.

Below is the overall flow of a system using a watchdog timer:

## Key Concepts and Terminology

**Watchdog Timeout Period** — The maximum interval allowed between successive kicks of the watchdog. Determined by the counter reload value and the clock prescaler. If this period expires without a kick, the hardware resets the MCU. Choosing this value requires understanding the worst-case execution time of your main loop or task set.

**Kick / Feed / Refresh** — The act of writing a specific value (often a key sequence) to the watchdog reload register to restart the counter. The terminology varies by vendor and engineer. On STM32 IWDG, this is writing 0xAAAA to IWDG_KR. The key insight is that WHERE and WHEN you kick matters enormously; doing it in the wrong place defeats the purpose.

**Independent Watchdog (iwdg)** — A watchdog peripheral clocked by the MCU's internal low-speed oscillator (LSI), separate from the main system clock. Because it runs on its own clock, it continues counting even if the main PLL fails or the CPU clock tree is misconfigured. On STM32 devices, the IWDG cannot be stopped once started except by a reset. This makes it suitable as the last line of defense.

**Window Watchdog (wwdg)** — A watchdog that adds a second constraint: you must NOT kick it too early, only within a defined time window before expiry. Kicking outside the window (too early) also triggers a reset. This is the critical distinction from a simple watchdog. The WWDG catches runaway code that is cycling too fast as well as code that is too slow or stuck.

**Reset Cause Register** — A status register (for example, RCC_CSR on STM32, MCUSR on AVR) that records the source of the last reset: power-on, external pin, watchdog, software, brown-out. Firmware MUST check this on startup to distinguish a watchdog reset from a normal power-on so that recovery logic can be applied appropriately.

**Lsi Oscillator** — The Low-Speed Internal oscillator used by the IWDG on STM32 and similar devices. Typically 32 kHz with a tolerance of plus or minus 10 to 30 percent depending on temperature and device variant. The imprecision means your watchdog timeout period has real uncertainty; always add margin.

**Prescaler** — A divider applied to the watchdog clock before it reaches the down-counter. On STM32 IWDG, prescaler values of 4, 8, 16, 32, 64, 128, and 256 are available. Combining prescaler and reload value gives you the timeout period. For example, at 32 kHz with prescaler 32 and reload value 1000, timeout is approximately 1 second.

**Window Value (wwdg)** — The upper bound of the valid kick window in a window watchdog. The counter must be below this value but above 0x40 (the reset threshold) when the kick occurs. Getting this wrong causes unexpected resets that are difficult to debug because they look like correct behavior on the surface.

**Early Wakeup Interrupt (ewi)** — A feature of the STM32 WWDG that fires an interrupt one clock cycle before the counter would reach the reset threshold. Firmware can use this interrupt to log a diagnostic record or attempt a graceful shutdown before the hardware reset occurs. Not a substitute for correct feeding but a valuable diagnostic tool.

**Watchdog Enable Protection** — On STM32, once the IWDG is started, it cannot be disabled by software. Some devices allow watchdog configuration via option bytes (hardware watchdog mode), meaning the watchdog starts at power-on regardless of firmware initialization. Engineers working on these devices must handle the watchdog from the very first instruction of their startup code.

## How It Works

<div class="detail-diagram">
<img src="../assets/svg/diagrams/watchdog_timer.svg" alt="Watchdog Timer Operation" loading="lazy">
</div>

STEP 1: CLOCK AND PRESCALER CONFIGURATION Before the watchdog counter starts running, the firmware configures the clock source and prescaler. For the STM32 IWDG, the LSI oscillator must be enabled and stable before the IWDG is unlocked. The prescaler divides the LSI frequency down to a manageable rate. Writing 0x5555 to IWDG_KR unlocks the prescaler and reload registers, which are write-protected by default. If you skip the unlock write, your configuration writes are silently ignored.

STEP 2: RELOAD VALUE CONFIGURATION The reload register (IWDG_RLR on STM32) holds the value that is copied into the down-counter each time the watchdog is kicked. The product of the reload value and the clock period after prescaling gives you the timeout window. For example, to get a one-second timeout with LSI at 32 kHz and prescaler of 32: period after prescaling is 32/32000 = 1 ms per count, so a reload of 1000 gives 1000 ms. Always budget for LSI tolerance; if your application needs 1 second of margin, configure for 800 ms and document why.

STEP 3: WATCHDOG START Writing 0xCCCC to IWDG_KR starts the counter. On STM32, this is a one-way door. The counter begins decrementing immediately. At this point the firmware has committed to servicing the watchdog periodically or accepting a reset. Some devices allow the hardware watchdog to be enabled through fuse bits or option bytes, which means the counter starts even before main() is reached, imposing a timing constraint on the startup sequence including PLL lock, memory initialization, and any bootloader stages.

STEP 4: PERIODIC KICK IN FIRMWARE The firmware must write 0xAAAA to IWDG_KR before the counter expires. In a bare-metal main loop, this is typically done at the bottom of the loop after all critical tasks have run. In an RTOS environment, a dedicated watchdog task receives notifications from each critical task; it only kicks the watchdog after all of them have checked in. This structure means a single stuck task blocks the watchdog kick, triggering a reset. The kick takes effect immediately: on writing 0xAAAA, the hardware reloads the counter from IWDG_RLR and restarts the count.

STEP 5: WINDOW ENFORCEMENT (WWDG ONLY) For the window watchdog, the firmware must also ensure the kick does not happen too early. The WWDG_CR register contains the counter value, and WWDG_CFR contains the window threshold. A valid kick happens only when the counter is between the window value and 0x40. If the code feeds the watchdog immediately after the previous feed, the counter will still be above the window threshold and a reset fires. This is intentional: the WWDG is designed for applications where timing regularity is itself a safety requirement, such as motor control loops where a runaway condition looks like fast cycling.

STEP 6: RESET CAUSE CHECK ON STARTUP After any reset, the startup code reads the reset cause register before clearing it. The relevant bit for a watchdog reset on STM32 is IWDGRSTF in RCC_CSR (or WWDGRSTF for the window watchdog). If this bit is set, the firmware knows the previous run ended in a watchdog timeout, not a normal power cycle. This allows the firmware to log the event to non-volatile memory, display a diagnostic indicator, skip the normal initialization sequence in favor of a recovery mode, or notify a remote server. After reading the flag, clear it by writing the RMVF bit so subsequent resets can be categorized correctly.

STEP 7: RECOVERY ACTION A reset alone is not a recovery strategy. A well-designed system uses the watchdog reset as a trigger, then executes a deliberate recovery sequence: reload safe parameter defaults, flush any partially written data, renegotiate communications with external devices, and enter a reduced-functionality safe state if the system cannot confirm full health. Counting consecutive watchdog resets in retained RAM (memory marked as NOT cleared by the startup code) allows the firmware to escalate: one reset triggers a soft recovery, three resets triggers a full factory reset, five consecutive resets with no clean boot in between could signal an unresolvable failure requiring human intervention.

## Under the Hood

When the IWDG counter on an STM32 reaches zero, the peripheral asserts the internal reset signal directly to the reset controller, bypassing the NVIC and the CPU entirely. The CPU does not execute another instruction. The pipeline is flushed. All peripheral registers except those in the backup domain and retained RAM regions revert to reset values. This is a cold reset from the CPU's perspective, with the important exception that the RCC reset cause flags preserve the reason. This hard reset behavior is intentional: it ensures that a corrupted stack, a blown interrupt vector table, or a CPU in a locked mode cannot prevent the reset from completing.

The LSI oscillator used by the IWDG runs independently of the main system clock tree. It is not derived from the HSE crystal or the PLL. This means that even if the main clock configuration fails (a surprisingly common failure mode when engineers experiment with PLL multiplier settings), the IWDG keeps running. The flip side is that LSI is not trimmed as precisely as HSE. On STM32F4 devices, the LSI is specified at 32 kHz typical but can vary from 17 kHz to 47 kHz across temperature and voltage. This 40 percent worst-case variation is significant. If you configure a 1-second timeout period and the LSI is running fast, you may actually get 600 ms. Always verify the actual timeout with a logic analyzer during hardware bring-up.

The WWDG is clocked from PCLK1 (the APB1 bus clock), not the LSI. This makes it more predictable in terms of frequency tolerance, but it also means that if the main clock fails, the WWDG stops. It is therefore used as a timing correctness watchdog within a normally running system, not as an independent safety net against clock failure. On STM32, the recommended approach is to run BOTH: IWDG as the independent last-resort watchdog and WWDG for timing window enforcement on critical control loops.

At the Cortex-M architecture level, the WFI (Wait For Interrupt) instruction puts the CPU in sleep mode but does NOT stop the IWDG counter. This is intentional: a system asleep too long is just as stuck as one spinning in a loop. If your application uses sleep modes, the wakeup and processing cycle must complete and kick the watchdog within the timeout window. This interacts with tickless idle in RTOS configurations: if the scheduler suspends the system tick and the watchdog task for a power optimization sleep, the sleep duration must be bounded to less than the watchdog timeout period.

On AVR microcontrollers (ATmega328P, for example), the watchdog uses the internal 128 kHz oscillator and the WDTCSR register. A critical hardware detail: on newer AVR devices, enabling the watchdog requires a timed sequence. You must set both WDE and WDCE simultaneously in one write, then within four clock cycles write the final configuration with WDCE cleared. Missing this sequence leaves the watchdog in an indeterminate state. Also, on AVR, the bootloader and application share the watchdog state. If the bootloader enables the watchdog and the application does not service it, the application will be reset as soon as the timeout expires. This catches many engineers off guard during first bring-up.

## Real-World Applications

AUTOMOTIVE Every ECU in a modern vehicle runs a watchdog, typically enforced by an external supervisory IC (such as a TI TPS65xxx or Infineon TLF35584) that is separate from the microcontroller itself. This external watchdog adds a second layer: even a total MCU lockup that corrupts the internal watchdog registers cannot prevent the external device from asserting the reset. In ISO 26262 ASIL-B and above applications, the watchdog feeding mechanism itself is subject to functional safety analysis. The feeding sequence must be designed so that only correct execution of the safety function produces the correct feed pattern, not just any live code.

INDUSTRIAL PLCs and motor drives use watchdog timers to handle communication loss and CPU faults. A Modbus RTU slave, for example, may use a watchdog to detect loss of master communication: if no valid frame arrives within 500 ms, the watchdog resets the output state to a safe default (outputs off, motor coasts to stop) even if the CPU is still running other tasks. This is sometimes implemented as a software watchdog serviced only by the communication receive handler, separate from the hardware watchdog.

MEDICAL IEC 62304 (software for medical devices) explicitly calls out the use of watchdog timers as a software safety mechanism. Infusion pumps, patient monitors, and implantable device programmers all use watchdogs. A key requirement is that the watchdog reset event be logged in a manner accessible to post-market surveillance. This drives the retained RAM pattern: watchdog reset counters and a circular fault log in memory that survives resets.

IOT AND CONSUMER ELECTRONICS Remote IoT nodes that run on battery for months at a time use watchdogs to recover from protocol stack deadlocks, which are a known failure mode in TCP/IP and BLE implementations. Many production IoT devices log watchdog reset counts to their cloud backend. A device with more than one watchdog reset per week is flagged for investigation. This kind of observability turns the watchdog from a silent recovery mechanism into a quality signal that surfaces firmware bugs that would otherwise be invisible in field deployments.

AEROSPACE Radiation-hardened microcontrollers used in satellites and avionics have watchdog timers designed to recover from single-event upsets (SEUs), where a cosmic ray or proton flips a bit in the CPU registers or SRAM. The watchdog timeout is often set to cover the worst-case scrubbing cycle time, and the recovery sequence includes ECC memory scrubbing and re-initialization of critical data structures from ROM.

## Common Mistakes

**Kicking the Watchdog Unconditionally at the Top of the Loop** — What goes wrong: the watchdog is fed before any work is done, so a task that hangs inside the loop body still gets its kick at the next iteration start. The watchdog never fires because the main loop is still making progress past the kick point, even though critical tasks are frozen. Avoid by kicking only AFTER all critical tasks have completed, or by using a per-task check-in pattern with a supervisor.

**Disabling the Watchdog During Debugging and Forgetting to Re-Enable It** — What goes wrong: the code is developed and tested with the watchdog disabled or with a very long timeout to avoid nuisance resets during breakpoint debugging. The production firmware ships with the watchdog effectively inactive. Avoid by using a debug build flag that explicitly sets a long timeout (e.g., 30 seconds) rather than disabling entirely, and by having a CI check that the watchdog is configured in the release build.

**Ignoring the Reset Cause Register** — What goes wrong: the firmware boots identically after a watchdog reset and a power-on reset. The root cause of a field failure is never captured. A device resets 50 times per day and nobody knows because it recovers seamlessly. Avoid by reading and logging the reset cause register on every startup.

**Configuring an Unrealistic Timeout** — What goes wrong: engineers set the timeout to 10 seconds because "that is plenty of time." A hard fault handler or a DMA stall takes the system down for 10 seconds before recovery, which may be completely unacceptable in context. Alternatively, a 50 ms timeout is set but the startup code with PLL initialization takes 80 ms, causing an infinite reset loop on cold boot. Avoid by measuring actual worst-case loop and startup times and setting the timeout to 2x the measured worst case.

**Kicking the Watchdog Inside an Isr** — What goes wrong: if the main task hangs but interrupts are still firing, the ISR kicks the watchdog continuously and the system never resets. The firmware appears alive because the ISR is running, but no application work is being done. Avoid: the main task context must be in the kick path, not an ISR.

**Using a Software Watchdog Only and Calling It Done** — What goes wrong: the software watchdog timer callback runs in the same interrupt context as everything else. A global interrupt disable that never ends, a runaway priority inversion, or a corrupted NVIC vector table defeats the software watchdog entirely. Avoid by using hardware watchdog as the final safety net and treating software watchdogs as application-level health checks only.

**Failing to Handle the Watchdog in the Bootloader** — What goes wrong: a hardware watchdog enabled via option bytes starts counting before the bootloader executes. If the bootloader does not service it, the application is reset before it can start. Worse, if a firmware update is in progress when the timeout fires, the flash write may be interrupted, leaving corrupt firmware. Avoid by ensuring the bootloader kicks the watchdog during long flash operations and that the update sequence is designed to be restartable.

## Debugging and Troubleshooting

**Symptom:** System resets unexpectedly during normal operation, no hard fault logged.

**Possible Cause:** Watchdog timeout due to a task or code path taking longer than expected.

**Investigation Method:** Read RCC_CSR (STM32) or MCUSR (AVR) at startup and log the reset cause. Add a timestamp log at each watchdog kick. Use a scope or logic analyzer on a GPIO toggled at the kick point to measure actual kick intervals versus the configured timeout.

**Resolution:** Identify the code path that caused the delay. Optimize it, or increase the watchdog timeout if the delay is legitimate and acceptable.

**Symptom:** Infinite reset loop immediately after power-on, system never reaches main.

**Possible Cause:** Watchdog timeout set too short for the startup sequence. Common when the hardware watchdog is enabled via option bytes and the PLL lock, flash wait state configuration, or external RAM initialization takes longer than the timeout.

**Investigation Method:** Disable the hardware watchdog option byte temporarily. Measure startup time from reset vector to first main() instruction using a logic analyzer on a GPIO set early in startup.

**Resolution:** Increase the watchdog reload value, or add a watchdog kick at the end of each major initialization phase in the startup code.

**Symptom:** WWDG reset fires even though the main loop timing looks correct.

**Possible Cause:** Kicking the WWDG too early (counter still above the window threshold). This is the classic window watchdog trap: the kick occurs before the window opens.

**Investigation Method:** Read WWDG_CR at the point of the kick. Compare the counter value to WWDG_CFR window value. If counter > window value, the kick is too early.

**Resolution:** Add a delay or restructure the loop so the kick happens later in the cycle, inside the valid window. Alternatively, adjust the window and timeout values to match the actual loop timing.

**Symptom:** Watchdog resets occur only in the field, never reproducible in the lab.

**Possible Cause:** Temperature, EMI, or voltage variation causing slower execution (flash wait states, clock drift) or causing a code path that is rarely triggered in controlled test conditions. Also possible: the LSI is running near its slow end in cold environments, making the actual timeout shorter than nominal.

**Investigation Method:** Enable the reset cause log and the watchdog reset counter in retained RAM. Retrieve fault logs from returned units. Add worst-case stress testing (extended temperature soak, power supply variation, RF injection) to the test suite.

**Resolution:** Add margin to the watchdog timeout (target 50 percent of worst-case loop time). Review all code paths that could lengthen execution under stress. If using IWDG with LSI, verify LSI frequency at temperature extremes during DVT.

## Design Considerations and Best Practices

**Use a Task Check-in Pattern in Rtos Systems** — Rather than kicking the watchdog in a single location, have each critical task set a bit in a shared bitmask when it completes its work. A low-priority watchdog task checks that all bits are set before kicking the hardware watchdog and then clears the bitmask. This design means the watchdog only fires if any one critical task fails to check in, not just if the watchdog task itself is alive. This is the correct implementation in any preemptive scheduler.

DESIGN THE TIMEOUT TO BE MEANINGFUL, NOT JUST LONG ENOUGH - The timeout should be the shortest value that accommodates the worst-case legitimate execution time, plus a safety margin. A 10-second watchdog on a 10 ms control loop means the system can be stuck for 10 seconds before recovery. Ask: what is the worst acceptable outage duration? Set the timeout accordingly.

**Retain Watchdog Reset Counters Across Resets** — Place a reset counter and a compact fault log structure in RAM that is excluded from the startup zero-initialization. Mark it with a magic number to detect first power-on. Use this data to implement escalating recovery responses and to transmit diagnostics to a backend or display to a service technician.

**Always Read and Clear the Reset Cause Flags Early in Startup** — Read the register before any other peripheral initialization clears it. Some HAL initialization functions (including STM32 HAL_Init) may modify or clear status registers as a side effect. Store the reset cause in a RAM variable immediately, then proceed with initialization.

**Kick the Watchdog Conservatively During Long Operations** — If a legitimate long operation exists (large flash erase, external memory initialization, lengthy calibration), kick the watchdog at appropriate checkpoints within that operation rather than extending the timeout globally. This preserves the protection elsewhere in the system while accommodating the known long operation.

**Test the Watchdog Reset Path Explicitly** — Write a test mode that deliberately skips the watchdog kick and confirms that the reset fires within the expected window. Verify recovery behavior: does the system reach the correct operating state after a watchdog reset? This test should be part of every hardware bring-up checklist.

**Account for Lsi Tolerance in Iwdg Timeout Calculations** — Never use the nominal LSI frequency for your timeout calculation in a safety-critical or reliability- critical application. Use the worst-case fast frequency from the datasheet. If the LSI can be as fast as 47 kHz on your STM32 variant, calculate your reload value based on 47 kHz, not 32 kHz.

**Do Not Kick the Watchdog in Exception Handlers** — A hard fault handler, bus fault handler, or NMI handler should NOT kick the watchdog. Let the watchdog fire and produce a clean reset. Use the exception handler only to save diagnostic information to retained memory. Kicking the watchdog from a fault handler keeps a faulting system alive and thrashing indefinitely.

## Expert Notes

THE WATCHDOG IS A CONTRACT, NOT A RESET BUTTON - Junior engineers often treat the watchdog as a fallback reset mechanism and design the kick to happen as often as possible to avoid false trips. This defeats the purpose entirely. The kick must be a meaningful assertion: "I have completed my required work this cycle." If you kick before doing the work, you have no protection. The value of the watchdog comes entirely from the meaning of the kick point.

**External Watchdog Ics Add a Layer That Internal Watchdogs Cannot** — The internal IWDG on an STM32 resets the MCU, but the MCU's internal logic controls whether the IWDG is enabled and how it is configured. In high-reliability designs, an external supervisory IC (like the Maxim DS1233 or TI TPS3813) watches the MCU from outside. This catches cases where the MCU's option bytes are corrupted, or where a program bug disables the internal watchdog. If you are designing for automotive functional safety or medical device compliance, the system-level watchdog architecture requires independent layers.

**Watchdog Resets in Production Are a Quality Metric** — A system that never triggers its watchdog in normal operation is not necessarily better than one that triggers rarely. The question is whether you are collecting and analyzing that data. Production deployments should report watchdog reset events to telemetry. A product team that tracks watchdog reset rates by firmware version will catch regressions that testing misses. If you are not logging watchdog resets, you are flying blind.

**The Wwdg Catches a Class of Bugs the Iwdg Cannot** — Runaway code that hammers a loop hundreds of times faster than expected is not caught by a simple timeout watchdog because the code never stalls long enough. The window watchdog's early-kick detection specifically targets this. In motor control, an inverter switching loop that somehow runs at 10x the intended frequency due to a timer misconfiguration is dangerous; the WWDG can catch it where the IWDG cannot.

**Startup Watchdog Behavior Is Often Overlooked Until It Bites** — Engineers test their watchdog implementation in a running system but forget to test it under the following conditions: cold start after a long power-off, firmware update completion, startup after a brown-out reset, and startup after a watchdog reset itself. Each of these can produce a different startup timing profile. The watchdog initialization must be robust across all of them, and this should be part of the hardware bring-up test protocol.

## Summary

The watchdog timer is one of the most powerful reliability tools in embedded systems, but only when used with deliberate intent. The hardware mechanism is simple: a down-counter that resets the system if not periodically refreshed. The design challenge is ensuring that the refresh is a meaningful health assertion, not a blind servicing of the counter. Every production embedded system that runs unattended should have a watchdog, and it should be designed from the beginning, not bolted on at the end.

Understanding the difference between the IWDG and WWDG is essential. The IWDG runs on an independent clock and is immune to main clock failures; it is your last line of defense. The WWDG enforces timing regularity and catches runaway fast execution; it is a precision timing correctness check. In high-reliability designs, both are used simultaneously for different failure modes. On platforms like STM32, both peripherals are available, and using only one leaves a gap in coverage.

Recovery architecture matters as much as the detection mechanism. A reset without a recovery strategy produces a system that fails and bounces, not a system that heals. Retained RAM, reset cause logging, escalating recovery responses, and telemetry reporting transform a watchdog from a reset trigger into a self-healing and observable system. These are not optional refinements; they are the difference between a product that survives in the field and one that generates support calls.

The mental model to retain is this: the watchdog timer is a hardware-enforced contract between your firmware and the physical world. Your code must EARN the right to kick the watchdog by completing its required work. The system must be designed so that only a healthy execution of the intended function produces the kick. Everything else -- the timeout value, the clock source, the reset cause logging, the recovery sequence -- is in service of making that contract meaningful and making failures visible and recoverable.

## Related Topics

Prerequisites: - Timers and Counters: Understanding MCU timer peripherals, prescalers, and counter modes - Bare-Metal Architecture: Main loop structure, interrupt handling, startup code, and reset sequences

Next Topics: - Fault Handling and Crash Analysis: Hard faults, MPU violations, fault register decoding, and post-mortem debugging - Power Management: Sleep modes, stop modes, standby modes, and their interaction with peripheral state including watchdog timers
