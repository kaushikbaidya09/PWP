---
id: interrupts
tags: ['NVIC', 'ISR', 'Priority', 'Latency']
---

# Interrupts: How Embedded Systems React to Events

Imagine you are building a safety system for an industrial press. A physical emergency stop button must halt the machine within 2 milliseconds of being pressed. Your main loop is busy running a PID controller, updating a display, and logging sensor data over UART. By the time your main loop finishes its current iteration and checks the button state, 50 milliseconds may have passed. The machine has already caused injury. This is not a hypothetical edge case -- it is the exact class of problem that interrupts were designed to solve.

Interrupts exist because the real world is asynchronous. External events -- a button press, a byte arriving over UART, a timer reaching its count, a voltage threshold being crossed -- do not wait for your software to be ready. They happen on their own schedule, often with strict timing requirements that cannot be met by polling inside a sequential loop. The interrupt mechanism gives the CPU a way to immediately suspend what it is doing, handle the urgent event, and then resume exactly where it left off.

Nearly every peripheral in a modern microcontroller can generate interrupts: timers, UART receivers, SPI transfer completions, ADC conversions, GPIO pin changes, I2C events, DMA completions, and more. Understanding how to use them correctly is not optional for an embedded engineer. It separates firmware that works on the bench from firmware that works reliably in the field, under load, with multiple concurrent events happening simultaneously.

By the end of this article, you will understand why polling fails for time-critical events, how the CPU detects and responds to an interrupt at the hardware level, what an Interrupt Service Routine is and how to write one correctly, how interrupt priorities are configured on ARM Cortex-M processors, what context saving means and why it is done automatically, how interrupt latency is measured and minimized, and what mistakes cause the most production failures in interrupt-driven firmware.

## The Fundamental Problem

The naive approach to reacting to external events is polling: you periodically check whether something has happened. In your main loop, you call a function that reads a GPIO pin, or checks a UART status register, or inspects an ADC result register. If the flag is set, you handle the event. If not, you continue. This works well in textbooks and works acceptably when your only job is to monitor a single slow sensor. In real systems, it breaks down quickly.

The first problem with polling is LATENCY. The time between when an event occurs and when your code reacts to it is bounded by how often you poll. If your main loop takes 10 milliseconds to execute and the button check happens once per loop, worst-case latency is 10 milliseconds. If you add more features to the loop, latency grows. In a motor control system where you need to respond to a fault signal within 100 microseconds, a polling loop that runs at 1 kHz is simply insufficient.

The second problem is CPU UTILIZATION. Polling a UART receive register 10,000 times per second waiting for a byte that arrives once per second means 9,999 out of every 10,000 checks found nothing. The CPU burned time checking for nothing. In power-sensitive designs, this wastes energy and prevents the CPU from entering low-power sleep states. In busy systems, it steals cycles from work that actually needs doing.

The third problem is DETERMINISM. When multiple peripherals all need attention, a polling approach forces you to service them in sequence. If peripheral A is being polled at the moment peripheral B generates an event, peripheral B waits. There is no inherent priority. Real systems have events of different urgency -- a fault condition matters more than a display refresh -- and polling provides no mechanism to enforce that ordering.

## The Big Picture

At the highest level, an interrupt is a hardware-triggered diversion of CPU execution. The peripheral signals the CPU through a dedicated hardware line. The CPU finishes its current instruction, saves the state of whatever it was doing, and jumps to a special function called an Interrupt Service Routine (ISR). When the ISR completes, the CPU restores the saved state and resumes normal execution as if the diversion never happened. The software that was interrupted does not know it was paused.

Between the peripheral and the CPU, there is a hardware block called the interrupt controller. On ARM Cortex-M processors this is the NVIC (Nested Vectored Interrupt Controller), which is part of the CPU core itself. The NVIC receives interrupt requests from all peripherals, applies priority rules, determines which interrupt the CPU should handle, and drives the exception entry mechanism. On AVR processors, the interrupt controller is simpler -- it is essentially a priority encoder that maps interrupt vectors to fixed addresses in flash.

The diagram below shows the flow from hardware event to ISR execution and back.

<div class="detail-diagram">
<img src="../assets/svg/diagrams/interrupt_flow.svg" alt="Hardware Interrupt to ISR execution flow" loading="lazy">
</div>

## Key Concepts and Terminology

**Interrupt Request (irq)** — A signal sent by a peripheral to the CPU indicating that the peripheral needs attention. On Cortex-M devices, each peripheral has an assigned IRQ number. The NVIC uses this number to look up the priority and vector address for that interrupt. An IRQ is pending until the CPU services it or software explicitly clears it.

**Interrupt Service Routine (isr)** — The function that executes when a specific interrupt fires. Also called an interrupt handler. The ISR must be short, non-blocking, and must not call functions that could re-enter the same interrupt or block waiting for resources. The address of each ISR is stored in the vector table in flash memory.

**Vector Table** — A table in memory (usually at the start of flash, address 0x00000000 on Cortex-M) containing the addresses of all ISR functions. Each entry in the table corresponds to one exception or interrupt source. When an interrupt fires, the CPU reads the appropriate entry from this table to find where to jump. On STM32, the vector table is defined in the startup assembly file and can be relocated using the VTOR register.

**Nvic (nested Vectored Interrupt Controller)** — The interrupt controller built into all ARM Cortex-M processors. It manages up to 240 external interrupt sources plus the internal core exceptions (HardFault, SysTick, PendSV, etc.). The NVIC supports configurable priorities, can enable or disable individual interrupts, and provides nesting -- a higher-priority interrupt can preempt a lower-priority ISR that is currently running.

**Interrupt Priority** — A numerical value assigned to each interrupt that determines its urgency relative to other interrupts. On Cortex-M, lower numerical values mean higher priority (priority 0 is highest). The number of implemented priority bits varies by device -- Cortex-M0 implements 2 bits (4 levels), Cortex-M4 commonly implements 4 bits (16 levels), and Cortex-M7 implements up to 8 bits (256 levels). Only the high-order bits are implemented; the low-order bits always read as zero.

**Context Saving / Exception Entry** — When the CPU accepts an interrupt, it automatically saves a set of registers onto the current stack. On Cortex-M this is called the exception frame and includes PC, PSR, LR, R0-R3, and R12. This allows the compiler to generate normal C code inside the ISR without worrying about which registers it uses -- the CPU has already preserved the caller's state. The compiler is still responsible for saving any additional registers the ISR uses (callee-saved registers).

**Interrupt Latency** — The time between when a peripheral asserts its IRQ line and when the first instruction of the ISR begins executing. On Cortex-M3/M4, the minimum interrupt latency from an interrupt being accepted is 12 clock cycles. Real-world latency includes any time the interrupt spent pending while a higher-priority or same-priority task was running, plus memory wait states.

**Interrupt Pending** — An interrupt is pending when the peripheral has asserted its request but the CPU has not yet serviced it. An interrupt can be pending while the CPU is inside another ISR of equal or higher priority. Pending interrupts are held by the NVIC and will be serviced when the CPU's priority level drops below the interrupt's configured priority.

**Preemption** — When a higher-priority interrupt fires while the CPU is inside a lower-priority ISR, the CPU suspends the lower ISR, saves another context frame, and jumps to the higher-priority ISR. When that ISR returns, execution resumes in the lower-priority ISR. This nesting behavior is automatic on Cortex-M and is one of its key advantages over simpler controllers like AVR.

**Critical Section** — A region of code that must execute atomically -- it must not be interrupted partway through, because partial execution would leave shared data in an inconsistent state. Critical sections are typically protected by temporarily disabling interrupts. On Cortex-M this is done with CPSID/CPSIE instructions or by raising the BASEPRI register to mask all interrupts below a given priority.

## How It Works

STEP 1: THE PERIPHERAL ASSERTS ITS IRQ LINE A peripheral generates an interrupt request when a specific condition is met: the UART receive data register becomes full, a timer counter matches its compare value, a GPIO pin transitions from low to high. Each peripheral has an internal status register with flag bits that record what happened, and a corresponding enable register that determines whether that condition is allowed to generate an interrupt. Both must be true: the event flag must be set AND the interrupt enable bit must be set. If the enable bit is clear, the event is logged in the status register but no IRQ is asserted. On STM32, for a USART, this is the SR (status register) and CR1 (control register 1) pairing.

STEP 2: THE NVIC EVALUATES THE REQUEST The IRQ line from the peripheral reaches the NVIC. The NVIC checks whether the interrupt is globally enabled (via the ISER register), and what priority it has been assigned (via the IPR registers). It compares this priority against the CPU's current execution priority. If the incoming interrupt has a numerically lower (higher urgency) priority value than what the CPU is currently executing, the interrupt preempts immediately. If it has equal or lower urgency, it is marked as pending and waits.

STEP 3: EXCEPTION ENTRY AND CONTEXT PUSH When the CPU decides to take the interrupt, it completes the current instruction (most instructions), then automatically pushes eight registers onto the active stack: xPSR, PC, LR, R12, R3, R2, R1, R0. This happens in hardware with no software involvement. The CPU also sets the LR register to a special EXC_RETURN value (such as 0xFFFFFFF9 or 0xFFFFFFFD) that encodes which stack was in use and how to return. This automatic push is what makes Cortex-M interrupts compatible with C code -- the ISR can be written as an ordinary C function and the ABI is respected.

STEP 4: VECTOR FETCH AND ISR ENTRY The CPU reads the vector table. The base address of the vector table is held in the VTOR (Vector Table Offset Register). The IRQ number is multiplied by 4 and added to the vector table base to find the address of the ISR. The CPU loads this address into the PC and begins executing the ISR. On Cortex-M3 and later, the vector fetch and the context save happen in parallel using a technique called tail-chaining and late-arrival optimization, which reduces latency.

STEP 5: ISR EXECUTES The ISR function runs. The first thing the ISR MUST do is clear the interrupt pending flag in the peripheral's status register. If the flag is not cleared, the interrupt will fire again immediately after the ISR returns, creating an infinite interrupt loop that starves the main loop. On some peripherals (like STM32 TIM), clearing the flag is done by writing a 0 to the specific bit in the SR register. The ISR performs whatever minimal work is needed -- reading a received byte into a ring buffer, setting a flag variable, writing to an output register -- and returns.

STEP 6: CONTEXT RESTORATION AND RESUME When the ISR executes its return instruction, the CPU detects the special EXC_RETURN value in LR. This triggers exception return: the CPU pops the eight saved registers back off the stack, restoring PC, xPSR, LR, and R0-R3 to their values before the interrupt. Execution resumes at exactly the instruction that was about to execute when the interrupt was taken. The interrupted code has no knowledge that it was paused.

## Under the Hood

The Cortex-M exception entry mechanism is engineered for both speed and C-language compatibility. The automatic push of 8 registers (the exception frame) corresponds exactly to the ARM Procedure Call Standard's caller-saved registers. This means the ISR function can use R0-R3 and R12 freely without manually saving them -- the hardware already did it. Any additional registers the ISR uses (R4-R11, which are callee-saved in the AAPCS) will be pushed/popped by the compiler-generated prologue/epilogue of the ISR function itself, exactly like a normal function call. This split responsibility keeps ISR entry fast while still generating correct code.

On Cortex-M3/M4/M7, the NVIC uses a priority grouping scheme that divides the priority byte into two fields: preemption priority and sub-priority. Preemption priority determines whether one interrupt can preempt another. Sub-priority breaks ties when two interrupts of the same preemption priority are both pending at the same time -- it determines which one runs first, but neither can preempt the other. This grouping is set globally via AIRCR.PRIGROUP and applies to all interrupts. Misunderstanding this is a common source of bugs: engineers sometimes expect a sub-priority difference to allow preemption, but it does not.

Tail-chaining is a hardware optimization that reduces the overhead when two interrupts fire back to back. Normally, returning from an ISR takes 12 cycles (to pop the exception frame), and entering the next ISR takes 12 cycles (to push a new frame). With tail-chaining, the CPU detects that another interrupt is pending on return and skips the pop/push cycle entirely -- it simply fetches the new vector and jumps. The old exception frame already on the stack serves the new ISR. This reduces back-to-back ISR overhead from 24 cycles to 6 cycles on Cortex-M3. In systems with high interrupt rates (e.g., motor control with many timer interrupts), tail-chaining is a meaningful performance benefit.

The BASEPRI register on Cortex-M3/M4/M7 is an important tool for critical sections. Writing a value N to BASEPRI masks all interrupts with a priority numerically >= N. This allows you to protect a critical section while still allowing high-priority interrupts (like a watchdog or safety fault handler) to run. This is preferable to PRIMASK (which disables all maskable interrupts) in systems where truly safety-critical interrupts must remain enabled at all times. FreeRTOS uses this mechanism extensively -- configMAX_SYSCALL_INTERRUPT_PRIORITY defines the threshold below which interrupts can safely call FreeRTOS API functions.

On AVR processors (ATmega328, ATmega2560), the interrupt mechanism is considerably simpler. There is no NVIC and no hardware priority among user-defined interrupts. When an interrupt fires, the global interrupt enable bit (I-bit in SREG) is automatically cleared, preventing nested interrupts. The ISR runs to completion, then RETI restores the SREG (re-enabling the I-bit) and resumes the main code. If you want higher-priority interrupts to preempt lower-priority ones on AVR, you must manually re-enable interrupts (sei()) at the start of the lower-priority ISR -- a technique that requires careful design to avoid race conditions.

## Real-World Applications

AUTOMOTIVE Modern automotive ECUs (Engine Control Units) rely on interrupts for crank and cam position sensing. The engine crank signal fires a GPIO interrupt on every tooth of the reluctor wheel. At 6000 RPM with a 60-2 tooth wheel, that is approximately 5800 interrupts per second. Each interrupt must capture the current timer value with microsecond precision to calculate instantaneous engine speed and determine ignition timing. The interrupt latency must be short and deterministic. Using polling for this task is impossible.

INDUSTRIAL Industrial motion controllers use timer interrupts to run control loops at fixed intervals. A servo drive running a 20 kHz current control loop uses a PWM timer interrupt to sample ADC results, compute a new duty cycle, and update the PWM compare register -- all within a 50 microsecond window. Missing the deadline causes control instability. The ISR priority must be the highest in the system, and the ISR execution time must be profiled and guaranteed to be less than the period.

MEDICAL Pulse oximeters use photodiode ADC conversion complete interrupts to trigger sample processing. The ADC fires an interrupt at 1 kHz, the ISR stores the sample in a ring buffer, and a background task computes the SpO2 algorithm on batches of samples. Using interrupts here decouples the time-critical sample acquisition from the computationally intensive algorithm, preventing sample loss without requiring the algorithm to run at 1 kHz.

CONSUMER ELECTRONICS Wireless earbuds use SPI DMA transfer complete interrupts to refill audio codec buffers. The codec requests a new audio frame every 1 millisecond. The DMA engine transfers the next audio buffer to the codec and fires an interrupt on completion. The ISR queues the next DMA transfer and updates the write pointer. The audio continues uninterrupted without the CPU being involved in every byte transfer.

IOT / LOW POWER IoT sensors spend most of their time in deep sleep. A GPIO interrupt connected to a PIR motion detector wakes the MCU from stop mode on Cortex-M. The MCU handles the event, transmits a radio packet, and returns to sleep. Without interrupt-driven wake, the MCU would either poll continuously (consuming milliamps instead of microamps) or miss events entirely.

## Common Mistakes

MISTAKE: Not clearing the interrupt flag in the ISR What goes wrong: The ISR returns, the flag is still set, the CPU immediately re-enters the ISR. The main loop never runs. The system appears to hang or behave erratically. How to avoid: The first line of every ISR (or at minimum before the ISR returns) should clear the specific status flag in the peripheral register. Read the datasheet carefully -- some flags are cleared by reading a register, some require writing a specific bit, some require writing the entire register with the cleared value.

MISTAKE: Doing too much work inside an ISR What goes wrong: The ISR calls blocking functions, performs heavy computation, waits for another peripheral, or calls library functions not designed for ISR context. Other interrupts are delayed, timing requirements are missed. How to avoid: ISRs should do the minimum necessary: read data into a buffer, set a flag, post a semaphore to an RTOS task. Defer all processing to the main loop or an RTOS task. If an ISR takes more than a few microseconds, it probably needs redesigning.

MISTAKE: Sharing data between ISR and main loop without protection What goes wrong: The ISR writes a multi-byte variable (say, a 32-bit counter on a 16-bit MCU, or a struct) while the main loop reads it partway through. The main loop reads a partially updated value -- a data race. The bug appears intermittently and is very hard to reproduce. How to avoid: Declare shared variables as volatile. For variables larger than the native atomic read/write width, disable interrupts around the read/write in the main loop (critical section). On Cortex-M4, 32-bit aligned reads and writes of 32-bit variables are atomic; struct updates are not.

MISTAKE: Misconfiguring interrupt priority on Cortex-M What goes wrong: The engineer sets a priority value without understanding the PRIGROUP setting or the number of implemented priority bits. Two interrupts that should be able to preempt each other cannot because they have the same preemption priority field. Or an RTOS API is called from an ISR with a priority higher than configMAX_SYSCALL_INTERRUPT_PRIORITY, causing a FreeRTOS assertion or memory corruption. How to avoid: Always verify PRIGROUP before assigning priorities. When using FreeRTOS, ensure all ISRs that call FreeRTOS API functions have priorities numerically >= configMAX_SYSCALL_INTERRUPT_PRIORITY (lower urgency). Use FromISR variants of all FreeRTOS calls inside ISRs.

MISTAKE: Forgetting that volatile is not sufficient for concurrency What goes wrong: The engineer marks a shared flag as volatile, which ensures the compiler always reads it from memory rather than caching it in a register. But on a multi-core system or with DMA, volatile does not prevent memory ordering issues. The data written by the ISR may not be visible to the CPU in the expected order. How to avoid: On single-core Cortex-M (which has no memory reordering for data accesses by the CPU itself), volatile is sufficient for shared flags. For DMA-accessed memory, use memory barriers or appropriate cache maintenance if on Cortex-M7 with D-cache enabled.

MISTAKE: Enabling an interrupt before the ISR is properly configured What goes wrong: The NVIC enable is set before the peripheral is fully initialized, or before the vector table is correctly set up. A spurious interrupt fires during initialization, jumps to address 0 or an uninitialized vector, and the system faults. How to avoid: Configure the peripheral completely, clear any pre-existing pending flags, and only then enable the interrupt in the NVIC. The sequence is: configure peripheral, clear status flags, enable peripheral interrupt, enable NVIC.

MISTAKE: Using printf or malloc inside an ISR What goes wrong: printf calls newlib functions that may use internal locks (mutexes) which themselves use RTOS primitives. malloc is not re-entrant. These calls from ISR context cause deadlocks or heap corruption. How to avoid: Never call standard library I/O or memory allocation functions from ISR context. Use dedicated debug mechanisms that are ISR-safe, such as writing to a ring buffer that the main loop reads.

## Debugging and Troubleshooting

**Symptom:** System hangs immediately or main loop stops running

**Possible Cause:** ISR is in an infinite loop because the interrupt flag was not cleared. The CPU keeps re-entering the ISR.

**Investigation Method:** Attach a debugger and halt execution. Check the program counter -- it will be inside the ISR. Check the peripheral status register for the interrupt flag. Toggle a GPIO at the start and end of the ISR and observe with an oscilloscope: if you see a continuous high signal or a very high-frequency toggle, the ISR is running continuously.

**Resolution:** Add code to clear the interrupt flag before the ISR returns. Confirm the clearing method for your specific peripheral in the datasheet.

**Symptom:** Intermittent data corruption in a variable shared between ISR and main loop

**Possible Cause:** Data race on a multi-byte variable. The ISR preempts the main loop in the middle of a multi-step read or write.

**Investigation Method:** Add a data integrity check -- store a known pattern alongside the variable and verify it on every read. Enable assertions during testing. Use a logic analyzer to correlate ISR firings with the corruption events. If using FreeRTOS, run the stack overflow checking and heap integrity check options.

**Resolution:** Wrap the access to the shared variable in the main loop with a critical section (disable/enable interrupts). Alternatively, redesign to use a lock-free ring buffer or pass data through RTOS queues.

**Symptom:** Interrupt-driven communication (UART, SPI) loses bytes under load

**Possible Cause:** A higher-priority ISR is running for too long, delaying the UART receive ISR past the time when a second byte arrives. The UART overruns and the first byte is overwritten before it is read.

**Investigation Method:** Measure ISR execution times using the DWT cycle counter on Cortex-M (DWT->CYCCNT). Profile each ISR and calculate worst-case execution time. Compare against the communication bit rate to determine the maximum ISR budget.

**Resolution:** Reduce the execution time of high-priority ISRs. Offload processing to deferred task context. Consider using DMA for the UART instead of byte-by-byte interrupts.

**Symptom:** HardFault occurs shortly after startup, seemingly at random

**Possible Cause:** An interrupt fires before initialization is complete (enabled too early), or an ISR uses a null function pointer (uninitialized vector table entry).

**Investigation Method:** In the HardFault handler, capture the stacked PC value to identify which instruction caused the fault. On Cortex-M, the stacked PC is at SP+24 at fault entry. Read CFSR (Configurable Fault Status Register) for INVPC (invalid PC load) or IACCVIOL (instruction access violation) flags.

**Resolution:** Ensure all interrupt enables happen after full peripheral initialization. Verify the vector table is correctly linked and that all ISR function names match between the vector table definition and the actual function implementations.

## Design Considerations and Best Practices

KEEP ISRs AS SHORT AS POSSIBLE. This is the single most important rule. An ISR occupies the CPU exclusively (relative to lower-priority interrupts) for its entire execution. Every microsecond spent inside an ISR is a microsecond that other interrupts are delayed. The pattern of reading data into a buffer in the ISR and processing it in the main loop (or RTOS task) is the correct architecture for nearly all cases.

ALWAYS DECLARE SHARED VARIABLES AS VOLATILE. Without volatile, the compiler may cache the variable in a register and never re-read it from memory. The main loop could loop forever on a stale value even though the ISR updated it. Volatile tells the compiler that the variable can change outside its knowledge and must always be read from and written to its actual memory location.

ASSIGN INTERRUPT PRIORITIES WITH A PLAN. Before enabling any interrupts, document all interrupts in the system, their timing requirements, and their priority assignments. On Cortex-M, decide on a PRIGROUP setting and stick to it. Assign priorities based on timing urgency and FreeRTOS compatibility constraints. Treat the priority table as a design artifact that must be reviewed and maintained.

NEVER CALL BLOCKING FUNCTIONS FROM AN ISR. Blocking on a mutex, calling delay functions, waiting for a peripheral to be ready, or calling any function whose execution time is unbounded will cause priority inversion, watchdog resets, and missed deadlines. If you are considering blocking in an ISR, the correct solution is to restructure the design to use deferred processing.

USE THE DWT CYCLE COUNTER TO PROFILE ISRS. On Cortex-M3 and later, the Data Watchpoint and Trace (DWT) unit contains a free-running cycle counter (DWT->CYCCNT). Enable it at startup and snapshot it at ISR entry and exit. Log the maximum observed execution time. For production firmware, add an assertion that the ISR execution time never exceeds the defined budget.

DESIGN YOUR INTERRUPT PRIORITY SCHEME AROUND YOUR WORST-CASE LATENCY REQUIREMENT. Identify the interrupt with the tightest latency requirement. Assign it the highest priority. Work outward from there. A motor control current loop that must run every 50 microseconds gets higher priority than a UART logger that has a 1 millisecond buffer.

CLEAR STALE INTERRUPT FLAGS BEFORE ENABLING INTERRUPTS. After configuring a peripheral, there may be a stale pending interrupt from prior activity (power-on transients, previous runs). Clear the interrupt flag register and the NVIC pending bit before enabling the interrupt. This prevents a spurious ISR execution at the moment you enable the interrupt.

WHEN USING FREERTOS, ONLY CALL FROMISRVARIANT API FUNCTIONS. FreeRTOS maintains its own priority masking for its internal data structures. Calling the non-ISR versions from interrupt context will corrupt the scheduler. Always use xSemaphoreGiveFromISR, xQueueSendFromISR, and so on. And always check the pxHigherPriorityTaskWoken parameter and call portYIELD_FROM_ISR if it returns pdTRUE.

## Expert Notes

THE CORTEX-M PRIORITY NUMBERING IS A COMMON TRAP. Priority 0 is the HIGHEST priority and priority 255 is the LOWEST. This is counterintuitive. Junior engineers frequently invert this, assigning priority 0 to low-urgency interrupts and high values to critical ones, then wondering why their critical interrupt keeps being delayed. Additionally, because only the high-order bits of the 8-bit priority field are implemented, writing priority 1 to a device that implements 4 bits actually sets the field to 0x10 after bit-alignment -- which may behave identically to priority 0 or priority 16 depending on how the register is written. Always use the CMSIS NVIC_SetPriority function and the NVIC_EncodePriority helper, never write raw values to the IP registers directly.

THE EXCEPTION FRAME STORES THE PC OF THE NEXT INSTRUCTION TO EXECUTE, NOT THE ONE THAT WAS INTERRUPTED. When you inspect the stacked PC during a HardFault or while debugging an ISR timing issue, you are seeing where execution will RESUME after the ISR, not where it was when the interrupt was taken. This matters when you are trying to correlate an interrupt to a specific point in your main loop code for timing analysis.

VOLATILE DOES NOT MEAN ATOMIC ON ALL PLATFORMS. On a Cortex-M0 or M0+ (which uses 16-bit Thumb instructions), a 32-bit variable read or write may require two 16-bit bus transactions. An interrupt between those two transactions reads a half-updated value. On Cortex-M3 and above with LDREX/STREX, you have atomic read-modify-write primitives available. But for simple flag variables (uint8_t or uint32_t on aligned addresses on Cortex-M3+), a single volatile read or write is atomic. Know your architecture and your data sizes.

TAIL-CHAINING AND LATE ARRIVAL CHANGE YOUR LATENCY ANALYSIS. If you are measuring interrupt latency with a logic analyzer (toggling a GPIO at ISR entry vs the triggering event), be aware that back-to-back interrupts will show lower latency due to tail-chaining. This is correct behavior, but if you are calculating worst-case latency for certification, you need to account for the case where your interrupt arrives while another ISR is running and must wait for its completion plus the full 12-cycle entry overhead, not the 6-cycle tail-chain overhead.

THE INTERRUPT LATENCY SPEC ON CORTEX-M IS A MINIMUM. The 12-cycle figure is the latency from interrupt being accepted to first instruction of ISR, measured with zero wait-state flash and no other interrupts running. In real systems with flash wait states (most STM32 runs flash at multiple wait states above 24 MHz), the vector fetch and instruction fetches add wait-state cycles. With the ART accelerator (prefetch and cache) on STM32F4, this is mitigated but not eliminated. For hard real-time latency guarantees, measure on your actual hardware at your actual clock speed, not from the datasheet minimum.

## Summary

Interrupts are the fundamental mechanism by which embedded software responds to the asynchronous, real-time nature of the physical world. Polling, the naive alternative, fails because it introduces unbounded and growing latency, wastes CPU cycles, and provides no way to prioritize urgent events over routine ones. The interrupt mechanism solves all three problems by having the hardware itself divert the CPU to handle an event the moment it occurs.

On ARM Cortex-M processors, the interrupt path runs from peripheral to NVIC to CPU exception entry. The hardware automatically saves the caller context (exception frame) on the stack, fetches the ISR address from the vector table, and executes the ISR as a normal C function. On return, the context is automatically restored. The NVIC supports nested interrupts, configurable priorities, and hardware optimizations like tail-chaining that minimize overhead in high-interrupt-rate systems.

The most critical rules for writing correct interrupt-driven firmware are: keep ISRs short and non-blocking, always clear the interrupt flag, declare all shared variables volatile, protect multi-byte shared variables with critical sections, and understand the priority numbering and PRIGROUP configuration for Cortex-M. Violations of these rules produce bugs that are intermittent, hard to reproduce in the lab, and catastrophic in the field.

The mental model to retain is this: an interrupt is a hardware-enforced function call with automatic context save and restore, triggered by a peripheral signal rather than a software instruction. The ISR is not magic -- it is a C function running in a special execution context with strict constraints on what it can do. Design your ISR as the smallest possible bridge between the hardware event and the rest of your firmware. Everything else belongs in the main loop or a task.

## Related Topics

Prerequisites: - CPU Execution Model (register file, program counter, stack pointer, instruction fetch-decode-execute cycle) - Clock System Fundamentals (clock sources, PLL, bus prescalers, peripheral clock gating)

Next Topics: - Event-Driven Systems (designing firmware architecture around interrupt-generated events) - Concurrency and Synchronization (mutexes, semaphores, atomic operations, preventing data races) - RTOS Fundamentals (tasks, scheduler, how interrupts integrate with an RTOS kernel)
