---
title: "Clock System Fundamentals: Where a Microcontroller's Timing Comes From"
brief: "Oscillators, PLLs, bus prescalers and clock trees, and why a wrong clock setting breaks baud rates, timers and power budgets."
order: 5
phase: 1
tags: ["PLL", "Prescaler", "Oscillator", "HSI"]
---

You power up your STM32F4 board, flash your firmware, and the UART output is garbage. The baud rate is off by a factor of two, timers fire at the wrong intervals, and SPI transactions corrupt data.

The clock system is the substrate on which everything else runs. Every instruction the CPU executes, every bit a UART shifts out, every sample an ADC captures — all of it happens in lockstep with clock edges.

## The Fundamental Problem

A microcontroller needs a stable, accurate timing reference. The on-chip digital logic uses flip-flops that change state on clock edges.

The naive approach is to generate a clock signal on-chip using a simple RC oscillator: a resistor and capacitor create a charging curve, a comparator trips at a threshold, resets the capacitor, and repeats. This works, and every modern microcontroller includes one.

## The Big Picture

The clock system takes one or more source signals and distributes derived, scaled versions of those signals to every subsystem in the chip. Think of it as a tree: roots are the oscillators, the trunk is the system clock (SYSCLK), the main branches are the bus clocks (AHB, APB1, APB2 on STM32), and the leaves are the individual peripherals.

The PLL sits between the oscillator and the system clock. It accepts the low-frequency, accurate oscillator signal and produces a high-frequency output by phase-locking a voltage-controlled oscillator to a multiplied version of the input.

The following diagram shows the high-level structure for an STM32F4:

![STM32F4 Clock Tree Structure](/diagrams/clock_tree.svg)

## Key Concepts and Terminology

**Oscillator** — An oscillator is a circuit that produces a periodic signal without an external input.

**Crystal** — A piezoelectric crystal (usually quartz) that vibrates at a precise mechanical resonant frequency when electrically excited.

**Hse / Hsi** — High Speed External and High Speed Internal are STM32 naming conventions for the two main clock sources.

PLL (Phase-Locked Loop) - A feedback control system that synchronizes a voltage-controlled oscillator (VCO) to a reference frequency.

**Clock Tree** — The network of multiplexers, dividers, and gates that routes clock signals from sources to destinations within the chip.

**Bus Matrix / Ahb / Apb** — The AHB (Advanced High-performance Bus) is the highest-speed internal bus, connecting the CPU, DMA, and fast memory.

## How It Works

### Step 1: Reset state

At power-on reset, the STM32 starts executing from the HSI oscillator at its default frequency (16 MHz on F4 series). The PLL is off.

### Step 2: Configure flash wait states

Before increasing the clock, wait states must be programmed into the FLASH_ACR register. For STM32F4 running at 168 MHz with 3.3V supply, the datasheet specifies 5 wait states.

### Step 3: Enable and wait for HSE

Write to RCC_CR to enable the HSE oscillator. Poll the HSERDY flag until the hardware confirms the oscillator has stabilized.

### Step 4: Configure and enable the PLL

Write the PLL parameters (M, N, P, Q dividers) into RCC_PLLCFGR. Select HSE as the PLL source.

### Step 5: Configure AHB and APB dividers

Write the AHB prescaler (HPRE), APB1 prescaler (PPRE1), and APB2 prescaler (PPRE2) into RCC_CFGR. For STM32F4 at 168 MHz: AHB = /1 (168 MHz), APB1 = /4 (42 MHz), APB2 = /2 (84 MHz).

### Step 6: Switch SYSCLK to PLL

Write SW=0b10 in RCC_CFGR to select the PLL as the SYSCLK source. Poll SWS (the status bits) until the switch completes.

### Step 7: Enable peripheral clocks as needed

Use RCC_AHB1ENR, RCC_APB1ENR, RCC_APB2ENR to enable clock gates for each peripheral you will use. GPIOA clock, USART2 clock, SPI1 clock — each must be explicitly enabled.

## Under the Hood

The PLL is an analog circuit embedded in the digital chip. Its core is a VCO: a ring oscillator or LC oscillator whose frequency is controlled by a voltage.

Jitter deserves specific attention. The PLL output is not a perfect square wave with identical periods.

## Real-World Applications

**Automotive.** In an automotive body control module running on an STM32G0, the CSS (Clock Security System) is mandatory. A crystal failure at 20 degrees below zero Celsius — a real failure mode as solder joints fatigue and PCB warps — would cause the module to stop responding to CAN messages.

**Consumer electronics.** Wireless earbuds and IoT sensors have aggressive power budgets measured in micro-amperes during sleep. The clock system is central to achieving these targets.

## Common Mistakes

### Mistake 1: Writing to peripheral registers before enabling clock

**What goes wrong:** The peripheral appears dead. Register reads return reset values regardless of what you write.

**How to avoid it:** Always enable the peripheral clock in the RCC enable register before accessing any peripheral register. Make enabling the clock the first line of any peripheral initialization function.

### Mistake 2: Increasing CPU clock without setting flash wait states first

**What goes wrong:** The CPU reads corrupted instructions from flash, producing random crashes, hard faults, or silent calculation errors. This is one of the hardest bugs to diagnose because the symptoms look like corrupted firmware.

**How to avoid it:** Set flash wait states before changing any clock frequency. Read the datasheet table of wait states versus supply voltage and CPU frequency; it is device-specific.

### Mistake 3: Assuming the timer clock equals the APB clock

**What goes wrong:** Timer frequencies are off by a factor of two. PWM frequencies are wrong.

**How to avoid it:** Always check the clock tree diagram in the reference manual for the specific family. It is usually a figure in the RCC chapter that shows the multiplier path to each timer.

## Debugging and Troubleshooting

**Symptom:** UART output is garbage or missing characters at the expected baud rate.

**Possible Cause:** SYSCLK or APB clock is not at the expected frequency, causing the UART baud rate generator to produce the wrong baud rate.

**Investigation Method:** Use the MCO output pin (many STM32 devices support outputting SYSCLK / 4 or HSE on a GPIO) and measure it with an oscilloscope or frequency counter.

**Resolution:** Correct the clock configuration.

**Symptom:** System crashes or hard faults immediately after increasing CPU clock speed.

**Possible Cause:** Flash wait states were not updated before the clock frequency increase, causing the CPU to read corrupted instructions.

**Investigation Method:** In the debugger, check FLASH_ACR wait state bits.

**Resolution:** Set the correct wait state count in FLASH_ACR before writing to RCC_CFGR to switch the clock source.

## Design Considerations and Best Practices

1. ALWAYS CONFIGURE CLOCKS EXPLICITLY, NEVER RELY ON DEFAULTS The reset-default clock is the HSI RC oscillator. It is adequate for bring-up but never for production. Explicitly configure every clock parameter in your startup code, even if you intend to use the default values, so that the configuration is documented in code and auditable. Silent assumptions about reset defaults are a leading cause of subtle production failures when porting code to a new chip revision.

2. VERIFY CLOCK CONFIGURATION AT STARTUP WITH A WATCHDOG After completing clock initialization, before doing anything else, read back the RCC registers and verify the key parameters (SYSCLK source, PLL lock, divider values).

## Expert Notes

1. THE HSI IS MORE ACCURATE THAN ITS DATASHEET SUGGESTS, AT ROOM TEMPERATURE The STM32 HSI datasheet spec is plus or minus one percent. However, at room temperature after factory calibration, it is typically within 0.1 to 0.2 percent. This is good enough for UART at moderate baud rates in a controlled environment. Many production designs in consumer IoT products use HSI without a crystal to save BOM cost. The risk is behavior at temperature extremes. Know your operating environment before making this trade-off. The HSICAL and HSITRIM registers let you fine-tune the HSI frequency at runtime.

2. THE TIMER CLOCK DOUBLING RULE ONLY APPLIES TO TIMERS, NOT TO OTHER APB PERIPHERALS This trips up experienced engineers too.

## Summary

The clock system is the foundation of every temporal operation in a microcontroller. Oscillators provide raw frequency references — either stable-but-limited crystals or convenient-but-imprecise internal RC circuits. The PLL solves the frequency scaling problem by multiplying a low-frequency accurate reference up to the operating frequency needed by the CPU and high-speed logic.

Clock misconfiguration is uniquely dangerous because it is invisible to logic analysis. The code is correct, the registers are written, but time itself is wrong. Baud rates are off.

## Related Topics

**Prerequisites**

- MCU Boot Sequence (understanding reset state, startup code, what runs before main)
- Analog Systems (oscillators, RC circuits, feedback systems)

**Next Topics**

- Timers and Counters (depends directly on understanding timer clock sources and prescalers)
- Power Management Fundamentals (clock gating, sleep modes, dynamic frequency scaling)
- Serial Communication Fundamentals (all baud/speed calculations require correct clock knowledge)
- DMA (DMA timing depends on AHB clock and bus contention)
