---
title: "Power Management Fundamentals: Making Batteries Last Longer"
brief: "Sleep and stop modes, clock gating and dynamic frequency scaling: measuring current and stretching battery life."
order: 26
phase: 6
tags: ["Sleep", "Clock Gating", "Power", "LPM"]
---

Your product ships with a CR2032 coin cell rated for one year of field operation. Three months after deployment, the operations team starts filing support tickets: batteries are dying in six weeks.

Power management in embedded systems is not a single feature you enable at the end of a project. It is an architectural discipline that touches clock configuration, peripheral initialization, interrupt design, memory layout, and the real-time behavior of the application.

## The Fundamental Problem

A digital circuit dissipates power in two ways. DYNAMIC POWER is proportional to the switching activity: every time a logic gate changes state it charges and discharges parasitic capacitances, and that charge movement is current drawn from the supply. STATIC POWER is leakage current, which flows even when nothing is switching.

The naive approach to power saving is to simply run the application as written and trust that the MCU idles when there is nothing to do. This fails for a fundamental reason: the CPU does not idle on its own.

## The Big Picture

Think of MCU power management as a hierarchy of progressively deeper sleep states. At the top is RUN mode: all clocks active, CPU executing, peripherals operational.

The RTC (Real-Time Clock) plays a special architectural role. It is typically powered from a separate, always-on power domain that remains active even in the deepest standby modes.

![STM32 Power Domain Hierarchy](/diagrams/power_domains.svg)

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Sleep Mode** | The lightest low-power state. |
| **Stop Mode** | A deeper sleep state where most clocks are stopped, including HSI and HSE oscillators, but the core voltage regulator operates in low-power mode and SRAM contents are retained. |
| **Standby Mode** | The deepest standard sleep state. |
| **Clock Gating** | The mechanism by which individual peripheral clocks are enabled or disabled independently of the system clock. |
| **Dynamic Voltage and Frequency Scaling (dvfs)** | Adjusting the core supply voltage and CPU clock frequency at runtime to match computational demand. |
| **Wakeup Sources** | The set of events that can bring the MCU out of a low-power state. |

## How It Works

### Step 1: Configure the clock tree for the workload phase

Before entering any low-power state, the application should configure the clock tree to match what is actually needed. For an STM32F4 running a 168 MHz application loop, the sequence before entering sleep is to disable the PLL, switch the system clock source to HSI at 16 MHz, then disable HSE.

### Step 2: Gate clocks to all idle peripherals

Walk through every peripheral whose clock is enabled in RCC->AHB1ENR, RCC->APB1ENR, and RCC->APB2ENR. Disable the clock to any peripheral not needed during the upcoming sleep interval.

### Step 3: Configure wakeup sources

Decide what event should wake the MCU. If waking on a GPIO edge (button press, interrupt from external sensor), configure the EXTI line: set the trigger edge in EXTI->RTSR or EXTI->FTSR, enable the line in EXTI->IMR, and enable the corresponding NVIC interrupt.

### Step 4: Set the power regulator mode and sleep depth

For stop mode on STM32: set the PDDS bit in PWR->CR to 0 (stop mode, not standby), set the LPDS bit to 1 (low-power regulator in stop mode), and clear the WUF flag in PWR->CSR. The SLEEPDEEP bit in the ARM Cortex-M SCB->SCR register selects between sleep (0) and stop/standby (1).

### Step 5: Execute WFI or WFE

The actual entry into low-power mode is triggered by the WFI (Wait For Interrupt) or WFE (Wait For Event) instruction. In CMSIS, this is __WFI() or __WFE().

### Step 6: Handle wakeup

On wakeup from sleep, execution resumes at the instruction after WFI. On wakeup from stop mode, the MCU restarts from HSI at 16 MHz — any PLL configuration has been lost and must be restored before peripherals dependent on it will work correctly.

### Step 7: Verify current draw with measurement

This step is not optional. Calculated estimates of power consumption are frequently wrong.

## Under the Hood

When the ARM Cortex-M core executes WFI with SLEEPDEEP clear, it gates the processor clock internally but leaves the NVIC, SysTick (if configured), and all AHB/APB bus clocks active. The processor enters a low-power state but the bus fabric remains live.

In stop mode, the ARM core's internal clocks and the HSI/HSE/PLL oscillators are gated by the RCC before the regulator is placed in low-power mode. The internal state of the NVIC, MPU, FPU, and core registers is maintained in a retention latch structure powered by the low- power regulator.

## Real-World Applications

**Automotive.** Engine control units and body control modules use stop mode during vehicle-off states to maintain CAN bus monitoring capability (via EXTI wakeup from CAN activity on an I/O line) while reducing quiescent draw below the 1 mA budget that governs battery drain over a 30-day park. RTC wakeup is used in telematics units to send periodic position reports even when the vehicle is parked.

**Consumer electronics / WEARABLES.** Fitness trackers and smartwatches use a tight duty cycle: wake every 26 ms to service the accelerometer FIFO, wake every second to update the RTC display, wake on wrist gesture via an always-on accelerometer interrupt. The MCU spends over 95% of its time in stop mode.

## Common Mistakes

### Leaving peripheral clocks enabled

**What goes wrong:** Every STM32 peripheral whose clock is enabled contributes switching current to the active and sleep mode figures. Engineers commonly initialize all peripherals at startup and never disable their clocks.

**How to avoid it:** Adopt a policy of enabling peripheral clocks immediately before use and disabling them immediately after. Use a peripheral reference count if multiple code paths share a peripheral.

### Floating GPIO inputs in stop mode

**What goes wrong:** An unconnected input pin with the input buffer enabled oscillates near the switching threshold, causing the buffer to switch continuously and adding 50-200 uA per pin.

**How to avoid it:** Configure all unused GPIO pins as analog inputs (GPIO_MODE_ANALOG in STM32 HAL). Pins connected to open-drain outputs of powered-off devices should be pulled high or low to a defined state.

### Driving loads from GPIO outputs while sleeping

**What goes wrong:** LEDs, pull-up resistors, and external enable pins left in their active state continue to draw current while the MCU sleeps.

**How to avoid it:** Before entering any low-power mode, explicitly drive enable pins low and ensure no GPIO is sinking or sourcing current through a resistive path.

## Debugging and Troubleshooting

**Symptom:** Stop mode current is 10x higher than datasheet spec.

**Possible Cause:** Floating GPIO inputs, GPIO outputs driving loads, peripheral clocks not gated.

**Investigation Method:** Use a power profiler (PPK2 or Otii) to measure current with a shunt resistor in series with VDD.

**Resolution:** Configure unused GPIO as analog mode.

**Symptom:** MCU wakes from stop mode immediately without waiting for the wakeup event.

**Possible Cause:** EXTI pending bit or WUF flag was set before entering stop mode.

**Investigation Method:** Set a breakpoint immediately before WFI and inspect EXTI->PR, PWR->CSR.

**Resolution:** Clear EXTI->PR pending bits and call __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU) in the pre-sleep sequence.

## Design Considerations and Best Practices

1. DESIGN POWER MODES INTO THE ARCHITECTURE BEFORE WRITING APPLICATION CODE Power management added as an afterthought requires rewriting every code path that uses peripherals. Design the sleep/wake state machine and peripheral ownership model upfront. Retrofit is expensive and error-prone.

2. MEASURE FIRST, OPTIMIZE SECOND Never optimize power without a measurement baseline.

## Expert Notes

THE 2 uA FIGURE IS A THEORETICAL LOWER BOUND, NOT A TARGET Every datasheet for a Cortex-M MCU advertises a standby current figure below 5 uA. Real products rarely achieve this in the field.

**Stop mode is almost always the right choice for real-time systems.** Standby mode gets attention because it has the lowest current figure. But standby requires a full reset on wakeup, which costs 5-50 ms and requires full reinitialization of all peripherals, communication stacks, and application state.

## Summary

Power management is not a feature to enable at the end of a project — it is an architectural constraint that shapes every design decision from clock tree configuration to peripheral initialization order to interrupt handler structure. The core insight is that energy consumed per operation, not average current, is the right metric. You minimize energy per operation by completing work as quickly as possible and sleeping as deeply as possible for as long as possible between operations.

The STM32 and ARM Cortex-M ecosystem provides three primary sleep states: sleep (CPU halted, peripherals running), stop (clocks off, state retained, 10-50 us wakeup), and standby (core powered down, state lost, full reset on wakeup). Each state has a distinct tradeoff between current draw and wakeup cost. The correct choice depends on the required wakeup latency, the interval between wakeups, and whether application state can be efficiently reconstructed on wakeup.

## Related Topics

**Prerequisites**

- Clock System Fundamentals (RCC, PLL, HSI/HSE/LSE/LSI oscillators, bus prescalers)
- Interrupts (EXTI lines, interrupt priorities, NVIC enable/disable)
- GPIO Fundamentals (modes, pull-up/pull-down, analog mode)

**Next Topics**

- Watchdog Timers (IWDG/WWDG behavior across low-power modes, wakeup from standby via IWDG)
- Embedded Security Fundamentals (tamper detection using RTC backup domain, secure boot power sequencing)
- RTOS Fundamentals (FreeRTOS configUSE_TICKLESS_IDLE, LPTIM integration)
- DMA (running ADC/UART/SPI via DMA without CPU wakeup)
