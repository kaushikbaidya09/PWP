---
title: "Watchdog Timers: Recovering Automatically From Hangs"
brief: "Independent and window watchdogs, where to feed them from, and designing firmware that recovers instead of hanging."
order: 20
phase: 5
tags: ["Watchdog", "IWDG", "WWDG", "Reset"]
---

Imagine a medical infusion pump deployed in a hospital. Three weeks after installation, a nurse notices the display has frozen.

Embedded systems routinely run in environments where a human cannot intervene quickly or at all. A motor controller inside a factory robot, a remote weather station on a mountain, a gateway in a home security panel.

## The Fundamental Problem

Software crashes in ways that are not obvious. The most visible crash is a hard fault or an unhandled exception where the CPU jumps to a fault handler and execution clearly stops.

The naive approach is to add more defensive checks and error handling inside the code. That is necessary but insufficient.

## The Big Picture

At the system level, a watchdog timer is a down-counter peripheral clocked by an independent oscillator. The firmware must write a specific value (called a "kick" or "feed" or "refresh") to a register before the counter reaches zero.

The watchdog sits in a supervisory role. It does not participate in normal data flow.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Watchdog Timeout Period** | The maximum interval allowed between successive kicks of the watchdog. |
| **Kick / Feed / Refresh** | The act of writing a specific value (often a key sequence) to the watchdog reload register to restart the counter. |
| **Independent Watchdog (IWDG)** | A watchdog peripheral clocked by the MCU's internal low-speed oscillator (LSI), separate from the main system clock. |
| **Window Watchdog (WWDG)** | A watchdog that adds a second constraint: you must NOT kick it too early, only within a defined time window before expiry. |
| **Reset Cause Register** | A status register (for example, RCC_CSR on STM32, MCUSR on AVR) that records the source of the last reset: power-on, external pin, watchdog, software, brown-out. |
| **LSI Oscillator** | The Low-Speed Internal oscillator used by the IWDG on STM32 and similar devices. |

## How It Works

![Watchdog Timer Operation](/diagrams/watchdog_timer.svg)

### Step 1: Clock and prescaler configuration

Before the watchdog counter starts running, the firmware configures the clock source and prescaler. For the STM32 IWDG, the LSI oscillator must be enabled and stable before the IWDG is unlocked.

### Step 2: Reload value configuration

The reload register (IWDG_RLR on STM32) holds the value that is copied into the down-counter each time the watchdog is kicked. The product of the reload value and the clock period after prescaling gives you the timeout window.

### Step 3: Watchdog start

Writing 0xCCCC to IWDG_KR starts the counter. On STM32, this is a one-way door.

### Step 4: Periodic kick in firmware

The firmware must write 0xAAAA to IWDG_KR before the counter expires. In a bare-metal main loop, this is typically done at the bottom of the loop after all critical tasks have run.

### Step 5: Window enforcement (WWDG only)

For the window watchdog, the firmware must also ensure the kick does not happen too early. The WWDG_CR register contains the counter value, and WWDG_CFR contains the window threshold.

### Step 6: Reset cause check on startup

After any reset, the startup code reads the reset cause register before clearing it. The relevant bit for a watchdog reset on STM32 is IWDGRSTF in RCC_CSR (or WWDGRSTF for the window watchdog).

### Step 7: Recovery action

A reset alone is not a recovery strategy. A well-designed system uses the watchdog reset as a trigger, then executes a deliberate recovery sequence: reload safe parameter defaults, flush any partially written data, renegotiate communications with external devices, and enter a reduced-functionality safe state if the system cannot confirm full health.

## Under the Hood

When the IWDG counter on an STM32 reaches zero, the peripheral asserts the internal reset signal directly to the reset controller, bypassing the NVIC and the CPU entirely. The CPU does not execute another instruction.

The LSI oscillator used by the IWDG runs independently of the main system clock tree. It is not derived from the HSE crystal or the PLL.

## Real-World Applications

**Automotive.** Every ECU in a modern vehicle runs a watchdog, typically enforced by an external supervisory IC (such as a TI TPS65xxx or Infineon TLF35584) that is separate from the microcontroller itself. This external watchdog adds a second layer: even a total MCU lockup that corrupts the internal watchdog registers cannot prevent the external device from asserting the reset.

**Industrial.** PLCs and motor drives use watchdog timers to handle communication loss and CPU faults. A Modbus RTU slave, for example, may use a watchdog to detect loss of master communication: if no valid frame arrives within 500 ms, the watchdog resets the output state to a safe default (outputs off, motor coasts to stop) even if the CPU is still running other tasks.

## Common Mistakes

**Kicking the Watchdog Unconditionally at the Top of the Loop** — What goes wrong: the watchdog is fed before any work is done, so a task that hangs inside the loop body still gets its kick at the next iteration start. The watchdog never fires because the main loop is still making progress past the kick point, even though critical tasks are frozen. Avoid by kicking only AFTER all critical tasks have completed, or by using a per-task check-in pattern with a supervisor.

**Disabling the Watchdog During Debugging and Forgetting to Re-Enable It** — What goes wrong: the code is developed and tested with the watchdog disabled or with a very long timeout to avoid nuisance resets during breakpoint debugging. The production firmware ships with the watchdog effectively inactive. Avoid by using a debug build flag that explicitly sets a long timeout (e.g., 30 seconds) rather than disabling entirely, and by having a CI check that the watchdog is configured in the release build.

**Ignoring the Reset Cause Register** — What goes wrong: the firmware boots identically after a watchdog reset and a power-on reset. The root cause of a field failure is never captured. A device resets 50 times per day and nobody knows because it recovers seamlessly.

## Debugging and Troubleshooting

**Symptom:** System resets unexpectedly during normal operation, no hard fault logged.

**Possible Cause:** Watchdog timeout due to a task or code path taking longer than expected.

**Investigation Method:** Read RCC_CSR (STM32) or MCUSR (AVR) at startup and log the reset cause.

**Resolution:** Identify the code path that caused the delay.

**Symptom:** Infinite reset loop immediately after power-on, system never reaches main.

**Possible Cause:** Watchdog timeout set too short for the startup sequence.

**Investigation Method:** Disable the hardware watchdog option byte temporarily.

**Resolution:** Increase the watchdog reload value, or add a watchdog kick at the end of each major initialization phase in the startup code.

## Design Considerations and Best Practices

**Use a Task Check-in Pattern in Rtos Systems** — Rather than kicking the watchdog in a single location, have each critical task set a bit in a shared bitmask when it completes its work. A low-priority watchdog task checks that all bits are set before kicking the hardware watchdog and then clears the bitmask.

**Design the timeout to be meaningful, not just long enough.** The timeout should be the shortest value that accommodates the worst-case legitimate execution time, plus a safety margin. A 10-second watchdog on a 10 ms control loop means the system can be stuck for 10 seconds before recovery.

## Expert Notes

**The watchdog is a contract, not a reset button.** Junior engineers often treat the watchdog as a fallback reset mechanism and design the kick to happen as often as possible to avoid false trips. This defeats the purpose entirely.

**External Watchdog Ics Add a Layer That Internal Watchdogs Cannot** — The internal IWDG on an STM32 resets the MCU, but the MCU's internal logic controls whether the IWDG is enabled and how it is configured. In high-reliability designs, an external supervisory IC (like the Maxim DS1233 or TI TPS3813) watches the MCU from outside.

## Summary

The watchdog timer is one of the most powerful reliability tools in embedded systems, but only when used with deliberate intent. The hardware mechanism is simple: a down-counter that resets the system if not periodically refreshed. The design challenge is ensuring that the refresh is a meaningful health assertion, not a blind servicing of the counter.

Understanding the difference between the IWDG and WWDG is essential. The IWDG runs on an independent clock and is immune to main clock failures; it is your last line of defense. The WWDG enforces timing regularity and catches runaway fast execution; it is a precision timing correctness check.

## Related Topics

**Prerequisites**

- Timers and Counters: Understanding MCU timer peripherals, prescalers, and counter modes
- Bare-Metal Architecture: Main loop structure, interrupt handling, startup code, and reset sequences

**Next Topics**

- Fault Handling and Crash Analysis: Hard faults, MPU violations, fault register decoding, and post-mortem debugging
- Power Management Fundamentals: Sleep modes, stop modes, standby modes, and their interaction with peripheral state including watchdog timers
