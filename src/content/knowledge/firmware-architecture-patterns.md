---
title: "Firmware Architecture Patterns: Organising Code So It Can Grow"
brief: "Layering HAL, drivers, BSP and application code so firmware stays portable, testable and maintainable as it grows."
order: 28
phase: 6
tags: ["HAL", "Driver", "BSP", "Architecture"]
---

You have just been handed a codebase for a motor drive controller. The original developer left the company.

This article is about how to prevent that outcome by choosing and applying a deliberate firmware architecture from the start. It covers the three-layer model that separates hardware from application logic, the hardware abstraction layer (HAL) and what makes a good one, device drivers and how they differ from the HAL, the board support package (BSP) and its role as the hardware-specific glue, component-based partitioning of application logic, the dependency rules that keep layers decoupled, interface design principles that enable portability and testability, and the anti-patterns that appear most often in production firmware that has grown beyond its original design.

![Firmware Architecture Layers: App → Middleware → Driver → HAL → BSP](/diagrams/firmware_layers.svg)

## The Core Problem

Ad-hoc firmware works fine when a project has one developer, one MCU variant, one set of features, and a short lifetime. As soon as any of those conditions changes, the lack of architecture begins to impose a compounding tax.

The cost of tight coupling compounds over time because it makes every future change more expensive. A firmware codebase that starts with no architecture does not stay small.

## Architectural Layers

The three-layer model is the most widely applied architecture in production embedded firmware. It divides the codebase into an application layer at the top, a middleware layer in the middle, and a hardware layer at the bottom.

The hardware layer consists of the hardware abstraction layer (HAL) and the board support package (BSP). Its responsibility is to present the rest of the firmware with a stable, MCU-independent interface to the hardware.

## The Hardware Abstraction Layer (HAL)

The hardware abstraction layer is a collection of API functions that expose peripheral capabilities — serial buses, GPIO, timers, ADC, DMA — without exposing any hardware-specific register details. Its purpose is to place a stable boundary between software that needs a capability and hardware that provides it.

A well-designed HAL API has a consistent structure across all peripherals. An init() function accepts a configuration structure and prepares the peripheral for use; it returns a status code, never void.

## Device Drivers

A device driver is software that manages a specific external component — a sensor, actuator, memory chip, or display — by issuing a sequence of HAL calls. The HAL abstracts a peripheral bus; the driver abstracts a component.

The canonical example of driver-over-HAL architecture is a SPI NOR flash driver sitting on top of a SPI HAL. The flash device has a specific command set: 0x03 for Read, 0x02 for Page Program, 0x20 for Sector Erase, 0x05 for Read Status Register.

## The Board Support Package (BSP)

The board support package is the bridge between a specific printed circuit board and the generic HAL interface. If the HAL defines what a GPIO or SPI peripheral looks like in the abstract, the BSP defines where each GPIO pin is connected on this specific board, which SPI peripheral serves which device, and how the clocks are configured on this specific MCU at this specific frequency.

Typical contents of a BSP include the system clock configuration function that sets PLL multipliers, AHB and APB prescalers, and flash wait states for the target operating frequency; GPIO initialization that sets direction, pull configuration, alternate function, and output speed for every pin on the board; interrupt routing that assigns peripheral interrupt lines to NVIC channels and sets priority levels; a board identifier constant that higher-level code can query if it needs to branch on hardware variant; and a board_init() function that calls all of the above in the correct order. The BSP is compiled once per board variant.

## Component-Based Architecture

As firmware grows beyond a few thousand lines, a flat three-layer model with large monolithic source files in each layer becomes unmanageable. Component-based architecture extends the layered model by further partitioning each layer into independent components, each of which owns a single concern, exposes an explicit interface, and has no direct dependencies on the internal state of other components at the same layer.

Initialization ordering is one of the practical challenges in component-based firmware. Components have dependencies — a UART driver must be initialized before a console logging component that uses it — but if these dependencies are encoded implicitly through the order of calls in main(), they become fragile.

## Layered Dependency Rules

The rule that upper layers call lower layers and lower layers never call upper layers is not just a stylistic preference; it is a structural property that determines whether the firmware is testable and portable. If a driver calls a function in the application layer, the driver can no longer be tested in isolation — testing the driver requires instantiating the application.

## Interface Design Principles

An opaque handle is the C pattern for encapsulating component state behind an interface. Instead of exposing a struct with named fields that callers can access directly, the component declares a handle as a pointer to a forward-declared (incomplete) struct type.

Function pointer tables implement polymorphism in C without virtual dispatch overhead. A driver interface is defined as a struct containing function pointers: one for init, one for read, one for write, one for status, one for deinit.

## Porting and Testability

The practical payoff of a clean layered architecture appears most clearly in two scenarios: porting to a new MCU and unit testing without hardware. Porting is reduced to swapping the BSP and the HAL implementations.

Unit testing without hardware requires that the code under test has no direct dependencies on hardware registers. In a well-layered architecture, the driver layer and above have no such dependencies — they call only HAL functions.

## Common Anti-Patterns

The god module is a source file that accumulates responsibility for everything: it initializes hardware, runs the main control algorithm, handles communication, manages error recovery, and maintains global state for every other module. God modules form because they are the path of least resistance when adding a feature: find the one place where everything is accessible and add the new code there.

Register-banging scattered through the application layer is the failure mode where hardware register writes appear in files that are supposed to contain application logic. A product manager reads a spec change that requires a different UART baud rate; the engineer searching for the UART configuration finds it split across three application files because the original developer wrote USART2->BRR = 0x1A1 wherever they needed the UART to work.

## Real-World Example

A concrete project structure illustrates how these principles map to a real directory layout. Suppose the project is a battery management system (BMS) firmware for an STM32G4 MCU.

The drivers/ directory contains one subdirectory per external device: drivers/bq76952/ for the Texas Instruments BQ76952 battery monitor IC, drivers/m25p80/ for a SPI NOR flash. Each driver directory contains a header exposing the driver's public API (bq76952.h declaring bq76952_init(), bq76952_read_voltage(), bq76952_read_current(), bq76952_set_alert_threshold()) and an implementation source.

## Choosing Your Architecture

The three-layer model with component-based partitioning is not the correct choice for every project. The cost of the architecture is upfront: defining interfaces before writing implementations requires more thought at the start, and the additional file structure adds build system complexity.

An RTOS changes the architecture in specific ways but does not change the layering principle. With an RTOS, the application layer is partitioned into tasks rather than cooperative module run() functions, and inter-component communication uses RTOS queues and semaphores rather than direct function calls and flags.

## Key Takeaways

The three-layer model — application, middleware, hardware — is the foundational structure that separates what the firmware does from how it does it on a specific piece of silicon, and this separation is what makes firmware portable and testable. The HAL defines a stable interface between capability-level code and register-level code; its anatomy follows a consistent init/read/write/status/deinit pattern with explicit error returns on every function. The BSP is the only legitimate location for board-specific constants and pin assignments; isolating it here means a board revision or MCU swap touches one directory, not every source file.

## Further Reading

Jacob Beningo's "Reusable Firmware Development" (Apress, 2017) is the primary reference for the HAL and component-based patterns described in this article; it provides C code examples for Cortex-M that directly illustrate the init/read/write/status/deinit API structure and the opaque handle pattern.

## Related Topics

**Prerequisites**

- Bare-Metal Architecture
- RTOS Fundamentals

**Next Topics**

- Low-Level Design
- Unit Testing Firmware
- Static Analysis and CI
