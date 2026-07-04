---
id: analog-systems
tags: ['ADC', 'DAC', 'Sampling', 'Signal']
---

# Analog Systems: ADCs, DACs and Real-World Signals

Your firmware reads a sensor value and returns 2047 at room temperature. You tweak the gain resistor, recompile, and now it returns 2048. Was that a 0.5 degree change or 50 degrees? You have no idea, because you skipped the math that ties raw register counts back to real-world volts and units. That gap between the physical world and a number in a register is exactly what analog peripherals exist to bridge, and misunderstanding that bridge is one of the most common sources of silent, hard-to-reproduce bugs in embedded products.

Microcontrollers live in a digital world of ones and zeros, but the physical world is relentlessly analog. Temperature, pressure, vibration, audio, battery voltage, motor current, humidity -- all of these are continuously varying electrical quantities. An Analog-to-Digital Converter (ADC) is the hardware that samples that continuous signal and produces a discrete integer the CPU can process. A Digital-to-Analog Converter (DAC) does the reverse: it takes a number from firmware and drives a real voltage onto a wire. Understanding both peripherals -- and the signal chain around them -- is not optional for any engineer working with sensors, audio, power management, or motor control.

The theory here is not academic. Sampling rate errors cause aliased noise that looks like a slow drift. Incorrect reference voltages produce readings that are consistently off by a fixed ratio. Missing an anti-aliasing filter means production boards fail intermittently in electrically noisy environments while your quiet lab bench passes every test. These are real failure modes that have shipped in real products.

The coverage in this article goes from the physics of sampling to register- level MCU configuration. Examples are drawn from the STM32 family (ARM Cortex-M), the AVR ATmega series, and general ARM Cortex-M peripheral conventions where applicable.

By the end of this article, you will understand how the Nyquist theorem constrains your sampling rate, how ADC resolution determines your measurement precision, how reference voltages set your full-scale range, what signal conditioning is required before the ADC input pin, how a DAC reconstructs an analog signal from digital codes, and what the most common design and firmware mistakes look like in practice.

## The Fundamental Problem

The physical world is continuous. A temperature sensor produces a voltage that changes smoothly and without interruption. A microcontroller register is discrete: it holds a finite integer, sampled at a specific moment in time. Bridging these two realities requires making two irrecoverable decisions: WHEN to sample (time discretization) and HOW PRECISELY to represent the value (amplitude discretization). Both decisions introduce error, and neither can be undone after the fact.

The naive approach is to wire a sensor directly to a GPIO pin, read it as high or low, and threshold-compare. That works for a limit switch. It fails completely the moment you need to know HOW HOT, HOW LOUD, or HOW FAST. The next naive step is to assume the ADC peripheral handles everything: just connect the wire, call the read function, and trust the number. That fails because ADC peripherals are extremely sensitive to noise on the reference voltage pin, input impedance mismatches, aliased high-frequency signals, and supply voltage coupling. An ADC does not know whether the signal on its input is valid -- it faithfully digitizes whatever voltage appears there, including noise and interference.

The constraint that makes this non-obvious is the Nyquist-Shannon Sampling Theorem. You cannot recover a signal from samples if the signal contains frequency components above half your sampling rate. Violate that rule and high-frequency interference folds down into your measurement band, corrupting every reading permanently. No amount of digital filtering recovers it after the fact. The fix (an anti-aliasing filter) must be in hardware, before the ADC input pin. Most junior engineers encounter this failure for the first time when a system that passed bench testing fails in a production environment with switching power supplies or motor drivers nearby.

## The Big Picture

<div class="detail-diagram">
<img src="../assets/svg/diagrams/adc_chain.svg" alt="ADC Signal Chain Architecture" loading="lazy">
</div>

An analog acquisition chain has five distinct stages. Signals enter from the physical world as voltages (or currents that a conditioning circuit converts to voltages), pass through signal conditioning hardware, are sampled and digitized by the ADC peripheral inside the MCU, and the resulting integers are processed by firmware. The DAC path is the reverse: firmware writes integers, the DAC produces a voltage, and an output driver stage buffers that voltage to drive a load.

Understanding the system-level position matters because errors introduced at any stage are invisible to all later stages. Noise on the analog power rail corrupts every reading regardless of how sophisticated your digital filtering is. An impedance mismatch between the sensor and the ADC input causes a systematic gain error that no calibration coefficient removes if it is temperature-dependent.

The overall flow:

## Key Concepts and Terminology

**Sampling** — The act of measuring the instantaneous value of a continuous signal at a specific moment in time. A sample-and-hold (S/H) circuit inside the ADC briefly connects the input to a capacitor, then disconnects it so the ADC core can measure a stable voltage. The acquisition time is the minimum period the S/H must remain connected; violating it causes the sampled voltage to be partially settled, producing a soft error that varies with source impedance and signal slew rate.

**Nyquist Frequency** — The maximum signal frequency that can be correctly reconstructed from a given sample rate, equal to exactly half the sample rate. If your ADC runs at 10 kHz, the Nyquist frequency is 5 kHz. Any signal energy above 5 kHz aliases (folds) into the 0-5 kHz band and is indistinguishable from real low-frequency content. This is not a software limitation; it is a mathematical consequence of the sampling process.

**Resolution** — The number of distinct output codes an ADC can produce, expressed in bits. A 12-bit ADC produces 4096 codes (0 to 4095). Resolution determines the SMALLEST CHANGE in input voltage the ADC can distinguish, called the least-significant bit (LSB) size: LSB = Vref / 2^N. A 12-bit ADC with a 3.3V reference has an LSB of approximately 0.8 mV. More bits means finer granularity but does not mean better accuracy if the noise floor is larger than one LSB.

REFERENCE VOLTAGE (Vref) - The voltage that defines the full-scale input range of the ADC. A reading of 4095 on a 12-bit ADC means the input equals Vref. A reading of 0 means the input is at GND (or the negative reference). Every measurement is proportional to Vref, so noise, drift, or error in Vref directly multiplies into every reading. Many ADC accuracy problems traced to production are actually instability in the reference source.

**Signal Conditioning** — Any analog processing applied to a sensor signal before it reaches the ADC input. Common operations include amplification (to use the full ADC range), level shifting (to center a bipolar signal within a unipolar ADC range), low-pass anti-aliasing filtering (mandatory), overvoltage protection (clamp diodes or resistors), and impedance buffering (op-amp follower to reduce source impedance).

**Anti-Aliasing Filter** — A low-pass filter placed BEFORE the ADC input that attenuates signal energy above the Nyquist frequency. It must be a hardware filter -- it cannot be implemented in firmware because aliased content has already been mixed into valid frequencies by the time the MCU sees the samples. A simple first-order RC filter is often adequate for slow signals; higher-order active filters are required for audio and precision applications.

**Dnl and Inl** — Differential Non-Linearity and Integral Non-Linearity are static accuracy specifications on the ADC datasheet. DNL is the worst-case deviation of any single step from the ideal 1-LSB step. INL is the worst- case deviation of the transfer function from a straight line across the full range. Missing codes occur when DNL exceeds -1 LSB. These errors exist in hardware and cannot be corrected by firmware averaging.

**Oversampling and Decimation** — Sampling faster than required and then averaging groups of samples to effectively increase resolution. Oversampling by a factor of 4x gains 1 effective bit of resolution (provided the noise floor is white). On an STM32 with a 12-bit ADC, oversampling by 256 and right-shifting by 4 yields 16-bit effective resolution on slow signals. This is a legitimate technique but only works when there is sufficient dithering noise present.

**Dac Settling Time** — The time required for the DAC output to reach and remain within a specified error band of its final value after a code change. Writing codes faster than the settling time allows causes the output waveform to be distorted because the analog output has not finished settling before the next value is written. This is especially important when generating audio or control waveforms at high update rates.

**Enob (effective Number of Bits)** — The actual number of noise-free bits a real ADC delivers, accounting for all noise sources. An ADC advertised as 12 bits may deliver only 10 ENOB in your circuit due to supply noise, PCB layout coupling, and thermal noise. ENOB = (SINAD - 1.76) / 6.02. It is the single most honest specification of real-world ADC performance.

## How It Works

### Step 1: Signal Arrives at the Adc Input Pin. the Conditioned Analog Voltage (within 0v to Vref) Appears at the Adc Multiplexer Input. Most Mcu Adcs Have a Multiplexed Input That Can Connect One of Several Analog Channels to the Shared Adc Core. the Multiplexer Switching Introduces a Brief Settling Transient. Firmware Selects the Channel by Writing to a Channel Selection Register (e.g., Stm32 Adc Sqr Registers for Regular Sequences, or Atmega Mux Bits in Admux).

### Step 2: Sample-and-Hold Acquires the Signal. the Adc Internally Connects the Selected Input to a Small Sampling Capacitor (typically 1-10 Pf) for a Programmable Number of Clock Cycles Called the Sampling Time. During This Window the Capacitor Charges to the Input Voltage. the Source Impedance of Your Signal and the Mcu Input Impedance Form an Rc Circuit; If the Sampling Time Is Too Short Relative to That Rc Time Constant, the Capacitor Does Not Fully Charge and the Sampled Voltage Is Lower Than the True Input. the Stm32 Adc Datasheet Specifies a Maximum Recommended Source Impedance (typically Under 50 Kohm for Standard Configurations) and Calculates Minimum Sampling Cycles for a Given Source Impedance. Always Verify This in Your Design.

### Step 3: Successive Approximation Conversion (sar Adc). the Most Common Mcu Adc Architecture Is the Successive Approximation Register (sar) Converter. After the S/h Capacitor Is Isolated, the Adc Core Performs a Binary Search. It First Tests Whether the Input Is Above or Below Vref/2 by Comparing to an Internal Dac Set to Midscale. the Result Sets the Msb. It Then Bisects Again for the Next Bit, and Repeats N Times for an N-Bit Conversion. This Requires Exactly N Clock Cycles Per Conversion (plus Overhead). a 12-Bit Sar Adc Therefore Takes 12 Comparison Steps. Conversion Time = (sampling Time + 12 Cycles) / Adc Clock Frequency.

### Step 4: Result Written to Register. the Final Binary Code Is Written to the Adc Data Register (e.g., Stm32 Adc_dr, Atmega Adch/adcl). on Mcus with Left or Right Alignment Options, Firmware Must Read From the Correct Bit Positions. the Stm32 Hal Default Is Right-Aligned. Firmware Reads This Register And, If Dma Is Not Used, Must Do So Before the Next Conversion Completes and Overwrites the Value. an Eoc (end of Conversion) Flag Is Set; Firmware Either Polls This Flag or Responds to the Adc Interrupt.

### Step 5: Firmware Scales the Raw Count to Engineering Units. the Raw Adc Code Is a Dimensionless Integer From 0 to 4095. Converting It to a Physical Quantity Requires Knowing Vref, the Sensor Transfer Function, and Any Amplifier Gain. the Sequence Is: Voltage_mv = (raw_count * Vref_mv) / 4095 Sensor_output_mv = Voltage_mv / Gain Temperature_c = (sensor_output_mv - Offset_mv) / Sensitivity_mv_per_c Each Step Can Be a Source of Error If Vref Is Assumed Rather Than Measured, or If the Gain or Sensitivity Values Come From Nominal Datasheet Values Rather Than Per-Unit Calibration.

### Step 6: Dac Converts Code to Voltage. for Dac Output, Firmware Writes a Code to the Dac Data Holding Register (stm32 Dac_dhr12r1, for Example). the Dac Core -- Typically an R-2r Ladder Network or String Dac -- Converts This Code to a Proportional Analog Voltage: Vout = (code / 4095) * Vref_dac. the Output Buffer (if Enabled) Drives the Voltage Onto the Output Pin. the Dac Output Requires a Reconstruction Low-Pass Filter on the Output If the Application Is Sensitive to the Staircase Artifacts From Discrete Code Steps -- Audio Amplifiers and Precision Control Loops Always Need This.

## Under the Hood

At the register level, an STM32 ADC peripheral has a clock prescaler that divides the APB2 clock down to an ADC clock (maximum typically 36 MHz on STM32F4, 14 MHz on STM32F1). The conversion time is directly determined by this clock and the programmed sampling time. Engineers frequently maximize conversion speed by minimizing sampling time, then observe noisy readings on high-impedance sources. The fix is to either buffer the source with an op-amp to lower its impedance, or increase the sampling time in the SMP bits. There is always a tradeoff between throughput and accuracy.

The internal reference voltage on STM32 devices (VREFINT, nominally 1.21V) is available as an ADC channel. Reading VREFINT and comparing to its factory-calibrated value stored in ROM (at address 0x1FFF7A2A on STM32F4) allows firmware to calculate the ACTUAL supply voltage and correct all ADC readings for supply variation. This technique is essential in battery- powered devices where Vdd (and therefore Vref, if using Vdd as the reference) changes as the battery discharges. Ignoring this produces readings that drift 5-10% across a battery discharge cycle.

CPU interaction with the ADC in polling mode is expensive. A 12-bit SAR conversion at a 14 MHz ADC clock takes roughly 1 microsecond, but the CPU sits in a polling loop waiting for the EOC flag. At higher sample rates (audio at 44.1 kHz) this consumes all available CPU bandwidth. The correct architecture for any application requiring sustained ADC throughput is DMA: the ADC peripheral triggers the DMA controller on each EOC, the DMA writes the result directly to a buffer in RAM, and the CPU is only interrupted when the buffer is half-full or full. This is why DMA is the next topic after ADC fundamentals.

The DAC on STM32 devices includes a triangle-wave and noise generation mode built into the hardware. More importantly, it supports DMA-triggered operation where a timer overflow triggers the DAC to load the next sample from a circular DMA buffer. This is the correct approach for audio output or arbitrary waveform generation. Writing samples from an interrupt service routine instead introduces jitter proportional to the worst-case interrupt latency of all other ISRs in the system, which degrades audio quality and control loop stability.

The AVR ATmega ADC uses a successive approximation architecture clocked from a prescaled division of the system clock. The ADC requires a clock between 50 kHz and 200 kHz for full 10-bit accuracy; running faster reduces effective resolution. This is documented in the ATmega328P datasheet Section 28.4 and is frequently violated by engineers who simply use the highest prescaler that still fits within conversion time budget without checking the accuracy specification.

## Real-World Applications

**Automotive** — Battery management systems (BMS) in electric vehicles sample cell voltages at 12-16 bit resolution across 96 or more cells, typically using specialized multi-channel sigma-delta ADC ICs rather than MCU built-in ADCs, because the required accuracy (1 mV resolution on a 4V cell) exceeds what a typical MCU ADC delivers reliably. MCU internal ADCs are used for lower-precision tasks: throttle position sensors, temperature monitoring, current sensing on motor phases. Anti-aliasing is critical in automotive because switching regulators and motor drive PWM generate substantial conducted noise.

**Industrial** — 4-20 mA current loop sensors are the standard in process control. The receiver converts the current to a voltage (typically 1-5V across a 250 ohm shunt) and feeds an ADC. The 4 mA live-zero enables wire-break detection. MCU ADCs at 12-bit are adequate for most process variables (temperature, pressure, flow) where sensor accuracy itself is 1-2% of full scale.

**Medical** — Pulse oximeters sample two wavelengths of LED-illuminated photodiode signal at 50-1000 Hz. Signal conditioning includes a transimpedance amplifier, a two-stage bandpass filter to isolate the AC plethysmograph component from the large DC ambient light component, and careful shielding. ADC resolution of 16-24 bits is typical because the AC signal of interest is less than 1% of the full-scale DC value.

**Audio / Consumer** — A microphone in a smartphone or a voice-activated IoT device feeds an audio ADC (often a sigma-delta converter running at 3.072 MHz oversampling rate, decimating to 48 kHz at 24-bit effective resolution). MCU built-in ADCs (SAR, 12-bit) are NOT suitable for audio; dedicated audio codec ICs communicate with the MCU over I2S. Engineers who attempt to record audio with a built-in ADC in polling mode produce audio that is at best 8-bit quality with timing jitter artifacts.

**Aerospace** — MEMS IMUs (accelerometers, gyroscopes) used in flight controllers output analog voltages (or more commonly, SPI/I2C digital interfaces with internal ADCs). When analog interfaces are used, the signal chain must account for vibration-induced aliasing: a 10 kHz structural resonance on a drone frame aliases into the control bandwidth if the sampling rate is below 20 kHz and no anti-aliasing filter is present.

## Common Mistakes

**Using Vdd As the Adc Reference Without Decoupling** — VDD fluctuates with load current and switching regulator noise. Since all readings are ratiometric to the reference, every current transient on the supply appears as a corresponding spike in ADC readings. Avoid by using the internal bandgap reference where precision is required, or provide a dedicated low- noise LDO for the AVDD/Vref pin with separate PCB power plane routing.

**Ignoring Acquisition Time for High-Impedance Sources** — A 100 kohm sensor source impedance and a 10 pF sampling capacitor form a 1 microsecond RC time constant. A sampling time of 3 ADC clock cycles at 14 MHz is 214 ns -- less than one time constant. The sampled voltage will be 87% settled, introducing a systematic error that varies with signal slew rate. Always calculate the required sampling time using the formula in the ADC section of the MCU datasheet.

**Omitting the Anti-Aliasing Filter** — "My signal only changes slowly so I don't need a filter" is the most common justification for skipping it. The signal may be slow, but conducted RF interference, switch-mode PSU ripple, and processor clock harmonics are not. A simple 10 kohm / 100 nF RC filter on the ADC input with a 160 Hz cutoff costs two passive components and protects against interference at all frequencies above that cutoff.

**Reading Adc Results Without Checking Eoc** — Polling the data register before the EOC flag is set returns a previous conversion result or an indeterminate value. In STM32 HAL, HAL_ADC_PollForConversion with a timeout handles this; in register-level code, check the EOC bit in ADC_SR before reading ADC_DR.

**Assuming Linearity Across the Full Range** — Most MCU ADCs perform poorly near the supply rails. Input voltages within 100-200 mV of GND or Vref often show increased DNL and INL. The usable range is typically 5-95% of the reference voltage. Design signal conditioning to keep normal operating values within this range.

**Forgetting Dac Output Impedance** — The STM32 DAC output buffer, when enabled, can source/sink only a few milliamps. Driving a low-impedance load (a speaker, a resistive network) without an external op-amp buffer causes the output voltage to sag. When the output buffer is disabled, the DAC output impedance is several kilohms -- unsuitable for any low-impedance load.

**Writing Dac Samples From an Isr at High Rate** — Interrupt-driven DAC updates at audio rates (44.1 kHz) consume 44,100 interrupt entries and exits per second plus associated context save/restore overhead. Any ISR with higher priority will introduce jitter in DAC updates. Use timer- triggered DMA to transfer from a circular buffer without CPU involvement.

## Debugging and Troubleshooting

**Symptom:** ADC readings drift slowly upward over temperature.

**Possible Cause:** Vref is derived from VDD, which changes as the MCU heats up and its power consumption shifts. Alternatively, the sensor or conditioning amplifier has a temperature coefficient that was not accounted for. Investigation: Measure VDD at the AVDD pin with a DMM during warmup. Read the internal VREFINT channel and compare to the factory calibration value to separate supply drift from sensor drift.

**Resolution:** Use a dedicated voltage reference IC (e.g., REF3033) for AVDD if precision is required. If using VDD as Vref, implement the VREFINT ratio correction in firmware.

**Symptom:** ADC readings are noisy and jittery, standard deviation is several LSBs.

**Possible Cause:** Insufficient decoupling on AVDD/Vref pin, high PCB impedance between AVDD decoupling capacitor and the pin, or digital switching noise coupling into the analog supply through shared ground plane. Investigation: Probe AVDD with a 100 MHz oscilloscope (AC coupled, 20 mV per division). Look for switching noise correlated with CPU clock or DMA activity. Measure AGND to DGND voltage to check for ground bounce.

**Resolution:** Add 100 nF ceramic capacitor as close as physically possible to the AVDD pin. Add 10 uF bulk capacitor on the analog supply rail. Ensure AGND and DGND are joined at only one point (star ground near the MCU).

**Symptom:** DAC output waveform has visible staircase steps and high-frequency spurious content.

**Possible Cause:** No reconstruction (smoothing) filter on the DAC output. The staircase waveform contains energy at the DAC update rate and its harmonics. Investigation: Probe the DAC output pin with a scope. Apply FFT. Observe spectral content at the update frequency and harmonics.

**Resolution:** Add a first-order RC low-pass filter on the DAC output pin with cutoff frequency below half the DAC update rate but above the maximum desired output frequency. For audio, a higher-order active filter is required.

**Symptom:** ADC reads maximum value (4095) even when the input signal is well below Vref.

**Possible Cause:** ADC input is floating (no connection) and is being pulled up by internal ESD structures or coupling. Alternatively, the channel selection register is not configured correctly and the ADC is sampling the wrong channel or an unconnected channel. Investigation: Verify channel selection register configuration. Probe the physical pin with a DMM to confirm the expected voltage is present. Check for correct analog pin configuration in GPIO registers (STM32 requires the pin to be configured in ANALOG mode, not INPUT, for ADC use).

**Resolution:** Set the GPIO pin to analog mode. Verify MUX/sequence register selects the intended channel. Ensure no pull-up resistors are active on the pin.

## Design Considerations and Best Practices

1. SEPARATE ANALOG AND DIGITAL POWER PLANES, JOINED AT ONE POINT. MCU datasheets show AVDD and DVDD as separate pins for a reason. Route analog and digital power separately on the PCB and join them at a single star point near the MCU, ideally through a ferrite bead. This prevents high-frequency digital switching current from flowing through the analog supply path and coupling noise into ADC readings.

2. **Place Adc Decoupling Capacitors As Close As Possible to the Pin.** The effectiveness of a decoupling capacitor is determined by the inductance of the PCB trace between the capacitor and the pin. A 100 nF capacitor placed 10 mm from the AVDD pin is significantly less effective than one placed 0.5 mm away. Use a 100 nF ceramic in parallel with a 10 uF electrolytic or tantalum.

3. **Always Calculate the Minimum Sampling Time From Source Impedance.** The formula is in every MCU ADC datasheet. The STM32F4 ADC datasheet provides Table 66 with minimum sampling cycles as a function of source impedance. Use the formula: t_acq > (R_source + R_switch) * C_sampling * ln(2^(N+2)). This is not optional for high-impedance sources.

4. **Implement an Anti-Aliasing Filter for Every Analog Input.** Even if you believe the signal bandwidth is well below Nyquist, conducted interference in a real installation is not predictable. A 10k/100nF RC filter costs cents and eliminates an entire class of field failures. For applications with defined bandwidth requirements, set the filter cutoff to half the minimum practical sample rate, not half the maximum possible sample rate.

5. **Calibrate Against a Known Reference at Board Bring-Up.** Factory ADC calibration compensates for internal offset and gain errors in the ADC core (STM32 provides a CAL bit in ADC_CR2 that runs an internal self-calibration). This does NOT calibrate the external signal chain. Board-level calibration with a known voltage source, combined with storing the resulting gain/offset coefficients in flash, is the only way to achieve accurate measurements on production boards.

6. **Use Oversampling to Increase Effective Resolution on Slow Signals.** For signals with bandwidth below 100 Hz (temperature, pressure), running the ADC at its maximum rate and averaging 16 or 64 samples in firmware adds 2 or 3 effective bits of resolution at no hardware cost, provided the noise floor is sufficient to dither the LSBs.

7. **Use Timer-Triggered Dma for Any Sustained Adc or Dac Operation.** Polling wastes CPU cycles waiting for EOC. Interrupt-driven acquisition adds context switch overhead and jitter. Timer-triggered DMA achieves precise sample timing with zero CPU overhead during acquisition. The CPU is only involved when the DMA buffer is half-full or full.

8. **Verify Adc Input Voltage Range Before Power-Up.** ADC input pins on most MCUs cannot tolerate voltages above VDD or below GND without damage. Add Schottky diode clamps (or use the MCU's built-in protection understanding its current limits) on any input that could exceed these limits during fault conditions. A sensor with a shorted supply lead can easily drive an input to 5V on a 3.3V MCU.

## Expert Notes

THE NOISE FLOOR SETS YOUR REAL RESOLUTION, NOT THE BIT COUNT. Engineers spend time selecting a 16-bit ADC and then route it next to a 48 MHz oscillator on a shared power rail and wonder why they get 8 ENOB. The hardware datasheet bit count is the ceiling; your PCB layout and power supply design determine where you actually end up. Always measure ENOB on a real board with the actual power supply and PCB before committing to a resolution-dependent design decision.

THE VREFINT CALIBRATION TRICK IS ESSENTIAL FOR BATTERY APPLICATIONS. On STM32 devices, the factory calibration value of VREFINT is written in ROM at a specific address. By reading VREFINT with the ADC and comparing to this factory value, firmware can compute VDD accurately without a dedicated voltage reference IC. This is documented in the STM32 application notes but is rarely mentioned in entry-level tutorials. Implement this in any design where VDD is not regulated to high precision.

THE SIGMA-DELTA ADC ARCHITECTURE BEHAVES VERY DIFFERENTLY FROM SAR. Sigma-delta ADCs used in audio codecs and precision measurement ICs trade conversion speed for resolution by massively oversampling and digitally filtering. They have a settling time (related to the digital filter group delay) that means you CANNOT multiplex a sigma-delta ADC between channels quickly -- the filter must settle after each channel switch. Engineers who mux a sigma-delta ADC at SAR speeds get meaningless readings.

GROUND IMPEDANCE IS THE SOURCE OF MOST UNEXPLAINED ADC NOISE. When an ADC reading is noisy and the power supply looks clean, measure the voltage between the analog ground reference pin and the MCU AGND pin under load. A few milliohms of PCB trace impedance carrying 100 mA of digital supply current produces hundreds of microvolts of error -- equal to several LSBs on a 12-bit ADC. This is why star-grounding the analog ground is not optional in precision applications.

CAPACITIVE COUPLING BETWEEN ADC CHANNELS IS REAL. On multiplexed ADCs with internal channel switching, residual charge on the sampling capacitor from the previous channel affects the first sample on the next channel. The fix is to sample each channel twice and discard the first reading, or to insert a dummy conversion between channel switches. This effect is visible in datasheets as a "channel-to-channel crosstalk" specification and is proportional to the ratio of the previous channel's residual charge to the sampling time.

## Summary

ADCs and DACs are the boundary between the digital firmware world and the physical world of continuous signals. ADC resolution determines the granularity of your measurements, but the Nyquist theorem, signal conditioning quality, reference voltage stability, and PCB layout determine whether that resolution is actually achievable in practice. A 12-bit ADC can deliver 6 effective bits in a poorly designed system, or 14 effective bits with oversampling in a well-designed one.

The signal chain must be designed from both ends simultaneously. Hardware engineers define Vref, gain, filtering, and protection. Firmware engineers must understand these hardware choices to correctly scale raw counts to physical units, select appropriate sampling times, implement oversampling where needed, and choose the right peripheral operating mode (polling, interrupt, or DMA). Neither side can treat the other as a black box without producing systems that fail in the field.

The most critical practical rule is: HARDWARE PROBLEMS REQUIRE HARDWARE FIXES. Aliased noise cannot be filtered in firmware after it has been digitized. Reference voltage drift cannot be corrected by software averaging. Ground noise coupling cannot be eliminated by digital filtering. Understanding the physical root cause of measurement error is what separates engineers who solve problems from engineers who add more averaging and hope for the best.

The mental model to retain: an ADC takes a snapshot of a voltage at one instant, with a precision limited by its bit count and its noise floor, and referenced to a voltage you provide. Everything in the chain before that snapshot -- the sensor, the amplifier, the filter, the reference, the PCB -- determines whether that snapshot represents reality. Everything after it -- scaling, calibration, filtering, DMA -- determines whether your firmware uses that snapshot correctly.

## Related Topics

Prerequisites: - GPIO Fundamentals (analog pin configuration, I/O voltage levels, pin protection structures) - Timers and Counters (ADC trigger sources, sample rate generation, DAC update timing, PWM as a DAC alternative)

Next Topics: - DMA (Direct Memory Access: timer-triggered ADC/DAC transfers, circular buffers, removing CPU from data acquisition loops) - Serial Communication Fundamentals (SPI/I2C to external ADC and DAC ICs, audio I2S protocol, interfacing precision converter ICs that exceed MCU built-in ADC performance)
