---
title: "Analog Systems: Converting Real-World Signals to Numbers and Back"
brief: "How ADCs sample and convert real-world signals, what limits their accuracy, and how DACs turn codes back into voltages."
order: 13
phase: 3
tags: ["ADC", "DAC", "Sampling", "Signal"]
---

Your firmware reads a sensor value and returns 2047 at room temperature. You tweak the gain resistor, recompile, and now it returns 2048.

Microcontrollers live in a digital world of ones and zeros, but the physical world is relentlessly analog. Temperature, pressure, vibration, audio, battery voltage, motor current, humidity — all of these are continuously varying electrical quantities.

## The Fundamental Problem

The physical world is continuous. A temperature sensor produces a voltage that changes smoothly and without interruption.

The naive approach is to wire a sensor directly to a GPIO pin, read it as high or low, and threshold-compare. That works for a limit switch.

## The Big Picture

![ADC Signal Chain Architecture](/diagrams/adc_chain.svg)

An analog acquisition chain is a series of stages. Signals enter from the physical world as voltages (or currents that a conditioning circuit converts to voltages), pass through signal conditioning hardware, are sampled and digitized by the ADC peripheral inside the MCU, and the resulting integers are processed by firmware.

Understanding the system-level position matters because errors introduced at any stage are invisible to all later stages. Noise on the analog power rail corrupts every reading regardless of how sophisticated your digital filtering is.

## Key Concepts and Terminology

**Sampling** — The act of measuring the instantaneous value of a continuous signal at a specific moment in time.

**Nyquist Frequency** — The maximum signal frequency that can be correctly reconstructed from a given sample rate, equal to exactly half the sample rate.

**Resolution** — The number of distinct output codes an ADC can produce, expressed in bits.

**Reference voltage (vref).** The voltage that defines the full-scale input range of the ADC.

**Signal Conditioning** — Any analog processing applied to a sensor signal before it reaches the ADC input.

**Anti-Aliasing Filter** — A low-pass filter placed BEFORE the ADC input that attenuates signal energy above the Nyquist frequency.

## How It Works

### Step 1: Signal arrives at the ADC input pin

The conditioned analog voltage (within 0V to Vref) appears at the ADC multiplexer input. Most MCU ADCs have a multiplexed input that can connect one of several analog channels to the shared ADC core.

### Step 2: Sample-and-hold acquires the signal

The ADC internally connects the selected input to a small sampling capacitor (typically 1-10 pF) for a programmable number of clock cycles called the sampling time. During this window the capacitor charges to the input voltage.

### Step 3: Successive approximation conversion (SAR ADC)

The most common MCU ADC architecture is the Successive Approximation Register (SAR) converter. After the S/H capacitor is isolated, the ADC core performs a binary search.

### Step 4: Result written to register

The final binary code is written to the ADC data register (e.g., STM32 ADC_DR, ATmega ADCH/ADCL). On MCUs with left or right alignment options, firmware must read from the correct bit positions.

### Step 5: Firmware scales the raw count to engineering units

The raw ADC code is a dimensionless integer from 0 to 4095. Converting it to a physical quantity requires knowing Vref, the sensor transfer function, and any amplifier gain.

### Step 6: DAC converts code to voltage

For DAC output, firmware writes a code to the DAC data holding register (STM32 DAC_DHR12R1, for example). The DAC core — typically an R-2R ladder network or string DAC — converts this code to a proportional analog voltage: Vout = (code / 4095) * Vref_DAC.

## Under the Hood

At the register level, an STM32 ADC peripheral has a clock prescaler that divides the APB2 clock down to an ADC clock (maximum typically 36 MHz on STM32F4, 14 MHz on STM32F1). The conversion time is directly determined by this clock and the programmed sampling time.

The internal reference voltage on STM32 devices (VREFINT, nominally 1.21V) is available as an ADC channel. Reading VREFINT and comparing to its factory-calibrated value stored in ROM (at address 0x1FFF7A2A on STM32F4) allows firmware to calculate the ACTUAL supply voltage and correct all ADC readings for supply variation.

## Real-World Applications

**Automotive** — Battery management systems (BMS) in electric vehicles sample cell voltages at 12-16 bit resolution across 96 or more cells, typically using specialized multi-channel sigma-delta ADC ICs rather than MCU built-in ADCs, because the required accuracy (1 mV resolution on a 4V cell) exceeds what a typical MCU ADC delivers reliably. MCU internal ADCs are used for lower-precision tasks: throttle position sensors, temperature monitoring, current sensing on motor phases.

**Industrial** — 4-20 mA current loop sensors are the standard in process control. The receiver converts the current to a voltage (typically 1-5V across a 250 ohm shunt) and feeds an ADC.

## Common Mistakes

**Using Vdd As the Adc Reference Without Decoupling** — VDD fluctuates with load current and switching regulator noise. Since all readings are ratiometric to the reference, every current transient on the supply appears as a corresponding spike in ADC readings. Avoid by using the internal bandgap reference where precision is required, or provide a dedicated low- noise LDO for the AVDD/Vref pin with separate PCB power plane routing.

**Ignoring Acquisition Time for High-Impedance Sources** — A 100 kohm sensor source impedance and a 10 pF sampling capacitor form a 1 microsecond RC time constant. A sampling time of 3 ADC clock cycles at 14 MHz is 214 ns — less than one time constant. The sampled voltage will be 87% settled, introducing a systematic error that varies with signal slew rate.

**Omitting the Anti-Aliasing Filter** — "My signal only changes slowly so I don't need a filter" is the most common justification for skipping it. The signal may be slow, but conducted RF interference, switch-mode PSU ripple, and processor clock harmonics are not. A simple 10 kohm / 100 nF RC filter on the ADC input with a 160 Hz cutoff costs two passive components and protects against interference at all frequencies above that cutoff.

## Debugging and Troubleshooting

**Symptom:** ADC readings drift slowly upward over temperature.

**Possible Cause:** Vref is derived from VDD, which changes as the MCU heats up and its power consumption shifts.

**Resolution:** Use a dedicated voltage reference IC (e.g., REF3033) for AVDD if precision is required.

**Symptom:** ADC readings are noisy and jittery, standard deviation is several LSBs.

**Possible Cause:** Insufficient decoupling on AVDD/Vref pin, high PCB impedance between AVDD decoupling capacitor and the pin, or digital switching noise coupling into the analog supply through shared ground plane.

**Resolution:** Add 100 nF ceramic capacitor as close as physically possible to the AVDD pin.

## Design Considerations and Best Practices

1. SEPARATE ANALOG AND DIGITAL POWER PLANES, JOINED AT ONE POINT. MCU datasheets show AVDD and DVDD as separate pins for a reason. Route analog and digital power separately on the PCB and join them at a single star point near the MCU, ideally through a ferrite bead. This prevents high-frequency digital switching current from flowing through the analog supply path and coupling noise into ADC readings.

2. **Place Adc Decoupling Capacitors As Close As Possible to the Pin.** The effectiveness of a decoupling capacitor is determined by the inductance of the PCB trace between the capacitor and the pin. A 100 nF capacitor placed 10 mm from the AVDD pin is significantly less effective than one placed 0.5 mm away.

## Expert Notes

**The noise floor sets your real resolution, not the bit count.** Engineers spend time selecting a 16-bit ADC and then route it next to a 48 MHz oscillator on a shared power rail and wonder why they get 8 ENOB. The hardware datasheet bit count is the ceiling; your PCB layout and power supply design determine where you actually end up.

**The VREFINT calibration trick is essential for battery applications.** On STM32 devices, the factory calibration value of VREFINT is written in ROM at a specific address. By reading VREFINT with the ADC and comparing to this factory value, firmware can compute VDD accurately without a dedicated voltage reference IC.

## Summary

ADCs and DACs are the boundary between the digital firmware world and the physical world of continuous signals. ADC resolution determines the granularity of your measurements, but the Nyquist theorem, signal conditioning quality, reference voltage stability, and PCB layout determine whether that resolution is actually achievable in practice. A 12-bit ADC can deliver 6 effective bits in a poorly designed system, or 14 effective bits with oversampling in a well-designed one.

The signal chain must be designed from both ends simultaneously. Hardware engineers define Vref, gain, filtering, and protection. Firmware engineers must understand these hardware choices to correctly scale raw counts to physical units, select appropriate sampling times, implement oversampling where needed, and choose the right peripheral operating mode (polling, interrupt, or DMA).

## Related Topics

**Prerequisites**

- GPIO Fundamentals (analog pin configuration, I/O voltage levels, pin protection structures)
- Timers and Counters (ADC trigger sources, sample rate generation, DAC update timing, PWM as a DAC alternative)

**Next Topics**

- DMA (Direct Memory Access: timer-triggered ADC/DAC transfers, circular buffers, removing CPU from data acquisition loops)
- Serial Communication Fundamentals (SPI/I2C to external ADC and DAC ICs, audio I2S protocol, interfacing precision converter ICs that exceed MCU built-in ADC performance)
