---
title: "GPIO Fundamentals: Controlling and Reading Digital Pins"
brief: "What happens inside a pin: push-pull versus open-drain, pull resistors, input sampling, debouncing and alternate functions."
order: 11
phase: 3
tags: ["GPIO", "Registers", "Pull-Up", "Open-Drain"]
---

You are building a firmware module for a new product. The schematic arrives and you are told: "The LED is on PA5, the button is on PC13.

GPIO stands for General Purpose Input/Output. It is the most fundamental peripheral in any microcontroller: a pin that the firmware can directly control or read.

## The Fundamental Problem

A microcontroller I/O pin is ultimately a transistor structure connecting to a pad. The transistor can be driven by the digital logic inside the chip.

The naive approach would be: an output pin drives the pad high or low, an input pin reads the voltage on the pad. That is sufficient for controlling a single LED in a lab.

## The Big Picture

At the system level, GPIO is a peripheral block that sits between the MCU core (or its bus matrix) and the physical pads. The core writes to registers to control direction, output value, pull resistors, output type, and speed.

On ARM Cortex-M microcontrollers such as the STM32F4 series, the GPIO peripheral is accessed through an APB or AHB bus, is clock-gated (the clock must be enabled before the registers can be written), and has one register bank per port (PORTA, PORTB, etc.), with each port managing up to 16 pins. The interrupt function is handled by a separate EXTI (External Interrupt/Event Controller) block that connects to GPIO lines and routes them to the NVIC.

The diagram below shows the electrical structures inside a typical GPIO pin. Not every MCU implements all of these, but STM32 and most ARM Cortex-M parts do.

![GPIO Pin Internal Electrical Structure](/diagrams/gpio_internals.svg)

## Key Concepts and Terminology

**Mode Register** — On STM32 this is GPIOx_MODER.

**Push-Pull Output** — An output configuration where the pin is driven actively to both VDD and GND.

**Open-Drain Output** — An output configuration where only the NMOS is active.

**Pull-Up Resistor** — A resistor connected from the signal line to VDD.

**Pull-Down Resistor** — A resistor connected from the signal line to GND.

**Schmitt Trigger** — An input buffer with hysteresis.

## How It Works

### Step 1: Enable the GPIO clock

On STM32 and most ARM Cortex-M parts, peripheral clocks are gated by default to save power. Writing to the GPIO registers before enabling the clock produces no effect, and on some families the write may corrupt the register or cause a bus fault.

### Step 2: Configure the pin mode

Write the mode bits for the target pin in GPIOx_MODER. For an output LED on PA5, set bits 11:10 to 01 (output mode).

### Step 3: Configure output type (for outputs) write GPIOx_OTYPER

Bit 5 = 0 selects push-pull for PA5 (LED). Bit 5 = 1 selects open-drain.

### Step 4: Configure pull resistors write GPIOx_PUPDR

For the button on PC13 (which connects to GND when pressed on the Nucleo board), configure pull-up: bits 27:26 = 01. The line then reads high when the button is open and low when pressed.

### Step 5: Configure speed write GPIOx_OSPEEDR

For an LED blinked at 1 Hz, low speed (00) is correct and produces the least EMI. For a high-speed SPI clock line at 50 MHz, high speed (11) is required to meet rise/fall time requirements.

### Step 6: Drive or read the pin

To drive an output, write to GPIOx_ODR (output data register) or, preferably, write to GPIOx_BSRR (bit set/reset register). BSRR is an atomic write: the upper 16 bits reset individual pins and the lower 16 bits set individual pins.

### Step 7: Configure interrupt (if needed)

To generate an interrupt on button press, configure SYSCFG_EXTICR to connect PC13 to EXTI13. Set EXTI_FTSR (falling-edge trigger) for active-low button.

## Under the Hood

The push-pull output stage uses a complementary pair of MOSFET transistors. The PMOS source connects to VDD and its gate is driven by the output logic.

The open-drain configuration disables the PMOS gate drive. Only the NMOS can be enabled, pulling the pad to GND.

## Real-World Applications

**Automotive.** In body control modules, GPIO drives relay coils through transistor buffers, reads door ajar switches, and controls indicator LEDs. Open-drain outputs are common because they interface easily with the high-side switches used to drive inductive loads.

**Consumer electronics.** A laptop trackpad uses GPIO interrupts to wake the host processor when a finger touch is detected. The touchpad controller asserts an active-low interrupt line (open-drain output from the touchpad IC, pulled up on the PCB).

## Common Mistakes

**Forgetting to Enable the Peripheral Clock** — The GPIO registers appear writable but the values have no effect. The pin behaves as if in reset state. Symptom: LED never lights, button reads wrong.

**Configuring Alternate Function Mode Without Setting the Af Number** — The pin is set to alternate function mode but GPIOx_AFR is left at reset value (AF0, typically JTAG). The peripheral (SPI, UART) is connected to the wrong function at the pad. The peripheral registers show activity but the pin does not change.

**Using Odr with Read-Modify-Write in an Isr** — Code does GPIOA->ODR |= GPIO_PIN_5 in an ISR and also in main(). A context switch between the read and write in main() means the ISR update is overwritten. Avoidance: always use BSRR for atomic bit manipulation.

## Debugging and Troubleshooting

**Symptom:** Output pin does not change state when register is written.

**Possible Cause:** GPIO peripheral clock not enabled, or pin is still in default input mode.

**Investigation Method:** Attach debugger, halt CPU, read RCC_AHB1ENR to verify clock bit, read GPIOx_MODER to verify output mode is configured.

**Resolution:** Add clock enable before any GPIO write.

**Symptom:** Input pin reads incorrect logic level.

**Possible Cause:** Pull resistor misconfigured or missing; external signal not reaching the pad; pin in analog mode.

**Investigation Method:** Read GPIOx_IDR in debugger while probing the pad with an oscilloscope or multimeter.

**Resolution:** Verify MODER is set to input mode (00).

## Design Considerations and Best Practices

**Define the Default State of Every Pin** — Before writing a line of firmware, fill in a pin table: for each GPIO, document its direction, default output level, pull configuration, and what happens to it during reset, sleep, and programming. This prevents floating pins that draw current and prevents unintended actuator states during firmware updates.

**Use Bsrr for All Output Operations** — ODR read-modify-write is safe only in single-threaded code with no interrupts that also touch the same port. BSRR eliminates the race entirely at no performance cost.

## Expert Notes

**The Jtag/swd Pins Are Gpio After Boot** — On most STM32 devices, PA13 (SWDIO), PA14 (SWCLK), PB3, PB4, and PA15 have alternate function 0 configured as debug interface pins on reset. If your design uses those pads for GPIO, you must explicitly remap them in firmware.

**Internal Pull Resistors Change Value with Temperature and Process** — The 40kohm nominal internal pull-up on an STM32 can range from 10kohm to 110kohm across production lots and temperature extremes. This is not a typo.

## Summary

GPIO is the entry point to embedded hardware control. It appears simple on the surface but exposes meaningful electrical choices that directly affect reliability, power consumption, signal integrity, and safety. The configuration registers on modern ARM Cortex-M microcontrollers are not arbitrary; each register field maps to a physical structure inside the pin cell that solves a specific electrical problem.

The most consequential decisions in GPIO design are output type (push-pull versus open-drain for bus compatibility), pull resistor direction and value (defining the idle state and limiting rise time), and interrupt configuration (edge selection, EXTI mapping, and ISR clearing). Secondary but important decisions are slew rate (EMI), current limits (protection), and default states during reset and sleep (power and safety). Each of these has a right answer derivable from the schematic and the datasheet; none requires guessing.

## Related Topics

**Prerequisites**

- MCU Boot Sequence (understanding reset state of peripherals and clock configuration)
- Memory Architecture (understanding memory-mapped registers and peripheral address maps)

**Next Topics**

- Timers and Counters (GPIO output compare and input capture use GPIO pins in alternate function mode)
- SPI Explained (SPI MOSI, MISO, SCK, and CS are GPIO pins in alternate function mode with specific drive requirements)
- I2C Explained (I2C requires open-drain GPIO configuration; pull-up resistor calculation is the first design step)
