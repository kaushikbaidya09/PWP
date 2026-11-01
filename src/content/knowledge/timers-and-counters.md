---
title: "Timers and Counters: Measuring Time and Generating PWM"
brief: "Counters, prescalers and compare channels: generating PWM, measuring pulses with input capture and building time bases."
order: 12
phase: 3
tags: ["Timers", "PWM", "Capture", "Overflow"]
---

An LED needs to dim smoothly, a motor needs a 20 kHz drive signal, and a sensor reports its reading as the width of a pulse. A delay loop can do none of these reliably, because any interrupt throws off its timing. Timers solve this by keeping time in hardware, while the CPU does other work.

## The Fundamental Problem

Software timing depends on how long instructions take, and that changes with compiler settings, clock speed and interrupts. A loop tuned to wait one millisecond might wait three when an ISR lands in the middle of it. While the CPU is waiting, it also cannot do anything else. Embedded systems need timing that stays exact whatever the software is doing.

## The Big Picture

A timer is a hardware counter driven by a clock. Everything it does comes from comparing that count against values you choose.

![Animated PWM: the counter ramps to the top value, and the pin stays high until the count reaches the compare value](/diagrams/timer_pwm.svg)

### In Plain Terms

Think of a kitchen timer that ticks by itself while you cook. You do not stand and count seconds. You set it and get on with things, and it rings at the right moment.

A hardware timer is that kitchen timer. A prescaler sets how fast it ticks. A counter holds the current number. When the count reaches a value you chose, it can ring (raise an interrupt), or flip a pin directly, with no software involved at all.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Prescaler (PSC)** | Divides the input clock to set the tick rate. |
| **Counter (CNT)** | The register that increases on each tick. |
| **Auto-reload (ARR)** | The value at which the counter wraps to zero. |
| **Compare (CCR)** | A value that triggers an event when the counter matches it. |
| **PWM** | A square wave whose on-time carries the information. |
| **Duty cycle** | The percentage of each period the signal is high. |
| **Input capture** | Hardware that saves the count the moment a pin changes. |

## How It Works

### Step 1: Choose a tick rate

The prescaler divides the timer clock. With an 84 MHz clock and PSC = 83, the counter ticks at 1 MHz, once per microsecond.

### Step 2: Set the period

The counter runs from 0 to ARR, then wraps. With ARR = 999 at 1 MHz, the period is 1000 ticks, or 1 ms.

### Step 3: Choose what happens on a match

A compare value can raise an interrupt, or drive an output pin. In PWM mode, the pin stays high until the counter reaches CCR, then goes low until the wrap.

### Step 4: Start the timer

Enable the timer's clock, set the pin to its alternate function, and set the enable bit. The output now runs on its own.

### Step 5: Update safely

Preload registers hold new values until the next wrap, so changing the duty cycle mid-period does not cause a glitch.

## A Closer Look: The One Formula You Need

Almost every timer setting comes from one relationship:

```text
output frequency = timer clock / ((PSC + 1) x (ARR + 1))
```

The +1s are there because both registers count from zero. PSC = 83 divides by 84, and ARR = 999 gives 1000 ticks.

Why not put everything in one register? Because the two trade off against each other. To get 1 kHz from 84 MHz, you could use PSC = 0 and ARR = 83,999, or PSC = 83 and ARR = 999. Both give the same frequency, but they differ in resolution.

Resolution is how finely you can set the duty cycle, and it equals ARR + 1 steps. With ARR = 999, you have 1000 steps, or 0.1% each. With a large prescaler and a small ARR of 9, you get only 10 steps. So use the smallest prescaler that lets ARR fit in the counter: this gives the finest control.

## A Worked Example: Dimming an LED

You want an LED at 25% brightness, using 1 kHz PWM on an 84 MHz timer.

The eye cannot see 1 kHz flicker, so the LED looks steadily dim. PSC = 83 gives a 1 MHz tick, ARR = 999 gives 1 kHz, and CCR = 250 keeps the pin high for 250 of the 1000 ticks, which is 25%.

```c
TIM3->PSC  = 83;
TIM3->ARR  = 999;
TIM3->CCR1 = 250;                  /* 25% duty */
TIM3->CCMR1 |= (6 << 4) | (1 << 3);  /* PWM mode 1, preload on */
TIM3->CCER |= 1;                   /* enable channel 1 output */
TIM3->CR1  |= 1;                   /* start */
```

To fade the LED, a slow loop only needs to write new values to `CCR1`. The waveform never depends on the CPU, so the brightness stays stable even during heavy interrupt load.

## Common Questions

**What is the difference between a timer and a counter?** It is the same hardware. Counting a steady clock measures time, and counting external pulses counts events.

**Why does my timer run at twice the speed I expected?** On STM32, timers get double the APB clock when the APB prescaler is not 1.

**How do I measure a pulse width?** Use input capture: save the count at each edge, then subtract.

**Is SysTick a timer too?** Yes. It is a simple timer in the Cortex-M core, usually used for the system tick.

## Under the Hood

Timers usually run from the APB bus clock through their own clock gate, which must be enabled in the RCC first. On each tick the counter increases, and hardware comparators check it against the CCR registers every cycle, which is why output timing has no software jitter.

Input capture works the same way in reverse: a pin edge copies the counter into CCR at that instant. The ISR can run late, since the time has already been saved in hardware.

## Real-World Applications

**Motor control.** Advanced timers generate complementary PWM with dead time for H-bridges.

**Sensors.** Ultrasonic rangefinders and tachometers are read with input capture.

**Power.** Switching regulators and LED drivers use PWM to control energy.

## Common Mistakes

### Mistake 1: Off-by-one in PSC and ARR

**What goes wrong:** The frequency is slightly wrong, because the +1 was forgotten.

**How to avoid it:** Subtract one from each divider: PSC = 84 - 1.

### Mistake 2: Wrong wrap handling

**What goes wrong:** A comparison such as `now >= start + timeout` fails when the counter wraps. A 32-bit millisecond counter wraps after about 49.7 days.

**How to avoid it:** Use unsigned subtraction: `(now - start) >= timeout`.

### Mistake 3: Updating without preload

**What goes wrong:** Writing CCR mid-period can produce one wrong pulse, which matters in motor control.

**How to avoid it:** Enable preload, so that changes take effect at the next wrap.

## Debugging and Troubleshooting

**Symptom:** No PWM on the pin

**Possible Cause:** Peripheral clock off, wrong alternate function, or channel output not enabled.

**Investigation Method:** Read `CNT` in the debugger to see if it is counting, then check the pin with a scope.

**Resolution:** Enable the clock, set the alternate function, and set the CCER bit.

**Symptom:** The frequency is exactly double what was calculated

**Possible Cause:** The timer clock doubling rule on STM32.

**Investigation Method:** Compare the clock tree with the measured output.

**Resolution:** Use the real timer clock in your calculation.

## Design Considerations and Best Practices

**Let hardware do the timing.** Output compare and PWM never depend on interrupt latency, so prefer them over toggling pins in an ISR.

**Pick the PWM frequency for the load.** LEDs need to avoid visible flicker, and motors are often driven above 20 kHz to avoid audible noise.

## Expert Notes

**Timers can trigger each other.** One timer can start another or start an ADC conversion, giving precise sampling with no CPU involvement.

**Combine timers with DMA.** DMA can update CCR on every period, generating complex waveforms such as addressable LED data with almost no CPU load.

## Summary

A timer is a counter driven by a clock, keeping time in hardware while the CPU does other work. The prescaler sets the tick rate, auto-reload sets the period, and compare registers produce PWM or interrupts. Input capture measures pulses precisely. Use the frequency formula, remember the +1s, and let hardware handle anything that needs exact timing.

## Related Topics

**Prerequisites**

- Clock System Fundamentals
- GPIO Fundamentals

**Next Topics**

- Analog Systems
- DMA
- Watchdog Timers
