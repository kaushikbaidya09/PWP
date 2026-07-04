'use strict';
/**
 * scripts/gen_svg_diagrams.js
 * Generates SVG diagram files for all MD architecture diagrams.
 * Output : assets/svg/diagrams/<snake_case>.svg
 * Also   : copies existing project SVGs to snake_case names
 *         + updates all img src refs in data/**\/*.md to snake_case
 * Usage  : node scripts/gen_svg_diagrams.js
 */

const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'assets', 'svg', 'diagrams');
const DATA = path.join(__dirname, '..', 'data');

/* ── Colour palette ──────────────────────────────────────────────────────── */
const C = {
    hw: { stroke: '#1d4ed8', fill: '#dbeafe', text: '#1e3a8a' },
    sw: { stroke: '#065f46', fill: '#d1fae5', text: '#064e3b' },
    kern: { stroke: '#5b21b6', fill: '#ede9fe', text: '#4c1d95' },
    isr: { stroke: '#991b1b', fill: '#fee2e2', text: '#7f1d1d' },
    queue: { stroke: '#0e7490', fill: '#cffafe', text: '#164e63' },
    gray: { stroke: '#374151', fill: '#f9fafb', text: '#111827' },
    warn: { stroke: '#92400e', fill: '#fef3c7', text: '#78350f' },
    app: { stroke: '#166534', fill: '#dcfce7', text: '#14532d' },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* Rounded rect + vertically-centred multi-line text */
function box(x, y, w, h, text, col, fs) {
    col = col || C.gray;
    fs = fs || 13;
    var lines = Array.isArray(text) ? text : String(text).split('\n');
    var lh = Math.round(fs * 1.55);
    var startY = Math.round(y + h / 2 - ((lines.length - 1) * lh) / 2);
    var cx = Math.round(x + w / 2);

    var parts = [
        '<rect x="' +
            x +
            '" y="' +
            y +
            '" width="' +
            w +
            '" height="' +
            h +
            '"' +
            ' rx="8" fill="' +
            col.fill +
            '" stroke="' +
            col.stroke +
            '" stroke-width="2"/>',
    ];
    lines.forEach(function (l, i) {
        if (l === '') return;
        parts.push(
            '<text x="' +
                cx +
                '" y="' +
                (startY + i * lh) +
                '"' +
                ' text-anchor="middle" dominant-baseline="middle"' +
                ' fill="' +
                col.text +
                '" font-size="' +
                fs +
                '">' +
                esc(l) +
                '</text>'
        );
    });
    return parts.join('\n  ');
}

/* Straight arrow from point to point with optional mid-label */
function arr(x1, y1, x2, y2, label) {
    var parts = [
        '<line x1="' +
            Math.round(x1) +
            '" y1="' +
            Math.round(y1) +
            '"' +
            ' x2="' +
            Math.round(x2) +
            '" y2="' +
            Math.round(y2) +
            '"' +
            ' stroke="#6b7280" stroke-width="2" marker-end="url(#arr)"/>',
    ];
    if (label) {
        parts.push(
            '<text x="' +
                Math.round((x1 + x2) / 2) +
                '" y="' +
                (Math.round((y1 + y2) / 2) - 9) +
                '"' +
                ' text-anchor="middle" dominant-baseline="middle"' +
                ' fill="#9ca3af" font-size="11">' +
                esc(label) +
                '</text>'
        );
    }
    return parts.join('\n  ');
}

/* Build and write SVG file */
function save(name, w, h, elements) {
    var body = elements.filter(Boolean).join('\n  ');
    var content = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg"',
        '     viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">',
        '  <defs>',
        "    <style>text{font-family:'DM Sans',ui-sans-serif,system-ui,sans-serif;font-weight:500}</style>",
        '    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">',
        '      <polygon points="0 0,8 3,0 6" fill="#6b7280"/>',
        '    </marker>',
        '  </defs>',
        '  <rect width="' + w + '" height="' + h + '" fill="#ffffff"/>',
        '  ' + body,
        '</svg>',
    ].join('\n');
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name + '.svg'), content);
    console.log('  ✓', name + '.svg');
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. GENERATE KNOWLEDGE DIAGRAMS
   ═════════════════════════════════════════════════════════════════════════*/
console.log('Generating Knowledge SVG diagrams...\n');

/* foreground_background — 08_Bare_Metal_Architecture */
save('foreground_background', 800, 570, [
    box(
        80,
        30,
        640,
        60,
        'HARDWARE EVENTS  (Timer overflow · UART Rx · GPIO edge · ADC complete · ...)',
        C.hw
    ),
    arr(400, 90, 400, 170, 'interrupt fires / preempts'),
    box(
        80,
        170,
        640,
        120,
        [
            'FOREGROUND: Interrupt Service Routines',
            '— minimal work: read register, set flag, push to buffer',
            '— sets event flags visible to background loop',
            '— returns control to wherever background was running',
        ],
        C.isr,
        13
    ),
    arr(400, 290, 400, 380, 'ISR sets flag, returns'),
    box(
        80,
        380,
        640,
        160,
        [
            'BACKGROUND: The Superloop',
            '',
            'while(1) {',
            '    module_buttons_run();     module_sensor_run();',
            '    module_comms_run();       module_display_run();',
            '    module_fault_run();',
            '}',
        ],
        C.sw,
        13
    ),
]);

/* interrupt_flow — 04_Interrupts */
save('interrupt_flow', 700, 640, [
    box(40, 40, 220, 80, ['PERIPHERAL', '(UART, Timer, GPIO, ADC)'], C.hw),
    box(440, 40, 220, 80, ['NVIC', '(Cortex-M)'], C.kern),
    arr(260, 80, 440, 80, 'IRQ line asserted'),
    arr(550, 120, 550, 230, 'interrupt request'),
    box(
        440,
        230,
        220,
        210,
        [
            'CPU',
            '',
            '1. Finish current instruction',
            '2. Save context (push regs)',
            '3. Fetch interrupt vector',
            '4. Jump to ISR',
        ],
        C.sw,
        13
    ),
    arr(550, 440, 550, 530),
    box(440, 530, 220, 70, ['ISR Handler', '(clear flag, post event)'], C.isr),
    box(40, 530, 220, 70, ['Resume interrupted', 'background code'], C.app, 13),
    arr(440, 565, 260, 565, 'restore context'),
]);

/* rtos_arch — 09_RTOS_Fundamentals */
save('rtos_arch', 700, 490, [
    box(60, 40, 160, 80, ['Motor Task', 'Priority 3'], C.app),
    box(270, 40, 160, 80, ['Comms Task', 'Priority 2'], C.app),
    box(480, 40, 160, 80, ['UI Task', 'Priority 1'], C.app),
    arr(140, 120, 210, 230),
    arr(350, 120, 350, 230, 'blocking API / notifications'),
    arr(560, 120, 490, 230),
    box(60, 230, 580, 80, ['RTOS KERNEL', 'Scheduler  ·  Context Switch  ·  Tick Timer'], C.kern),
    arr(350, 310, 350, 410, 'hardware events / ISR'),
    box(60, 410, 580, 80, ['HARDWARE', 'SysTick  ·  NVIC  ·  Peripherals  ·  SRAM'], C.hw),
]);

/* sync_layers — 10_Concurrency_and_Synchronization */
save('sync_layers', 700, 430, [
    box(40, 40, 190, 60, ['Task A  (Priority HIGH)'], C.isr, 13),
    box(40, 120, 190, 60, ['Task B  (Priority MED)'], C.warn, 13),
    box(40, 200, 190, 60, ['Task C  (Priority LOW)'], C.sw, 13),
    box(40, 280, 190, 60, ['ISR  (NMI / IRQ)'], C.kern, 13),
    arr(230, 70, 310, 155),
    arr(230, 150, 310, 160),
    arr(230, 230, 310, 165),
    arr(230, 310, 310, 345),
    box(
        310,
        100,
        360,
        120,
        ['GLOBAL STATE / RAM', 'ring buffer  ·  peripheral register', 'linked list  /  queue'],
        C.hw,
        12
    ),
    arr(490, 220, 490, 300),
    box(
        310,
        300,
        360,
        100,
        ['SYNCHRONIZATION', 'Mutex  ·  Semaphore', 'Spinlock  ·  Critical section'],
        C.queue,
        12
    ),
]);

/* gpio_internals — 11_GPIO_Fundamentals */
save('gpio_internals', 760, 570, [
    box(80, 20, 600, 50, ['APB / AHB Bus'], C.queue, 15),
    arr(185, 70, 185, 140),
    box(80, 140, 160, 70, ['Mode', 'Register'], C.hw),
    arr(240, 175, 290, 165),
    arr(240, 175, 290, 255),
    box(290, 130, 200, 60, ['Input Mode → Schmitt Trigger'], C.sw, 12),
    box(290, 220, 200, 70, ['Output Mode', 'Push-Pull / Open-Drain'], C.sw, 12),
    arr(490, 255, 490, 370, 'output drive'),
    box(200, 370, 360, 70, ['GPIO  PAD'], C.kern, 17),
    arr(370, 440, 280, 490),
    arr(450, 440, 570, 490),
    box(80, 490, 200, 60, ['Pull-Up / Pull-Down', '(switchable)'], C.gray, 12),
    box(490, 490, 190, 60, ['EXTI Line  →  NVIC'], C.isr, 13),
]);

/* watchdog_timer — 20_Watchdog_Timers + 12_Timers_and_Counters */
save('watchdog_timer', 740, 530, [
    box(
        60,
        50,
        200,
        140,
        ['Application Firmware', '', '[Task 1]', '[Task 2]', '[Task 3]'],
        C.app,
        13
    ),
    arr(260, 120, 360, 120, 'periodic kick'),
    box(
        360,
        50,
        260,
        140,
        ['Watchdog Timer (IWDG / WWDG)', '', 'Down-counter', 'LSI / IWDG oscillator'],
        C.kern,
        13
    ),
    arr(490, 190, 490, 300, 'counter expires'),
    box(360, 300, 260, 70, ['Reset Logic', '(RST pin)'], C.isr),
    arr(420, 370, 160, 440),
    arr(490, 370, 490, 440),
    box(60, 440, 200, 70, ['Log reset cause', '(backup register)'], C.warn, 13),
    box(360, 440, 260, 70, ['Execute recovery sequence'], C.sw, 13),
]);

/* adc_chain — 13_Analog_Systems */
save('adc_chain', 700, 980, [
    box(200, 20, 300, 60, ['PHYSICAL WORLD'], C.gray),
    arr(350, 80, 350, 160, 'raw signal'),
    box(
        200,
        160,
        300,
        90,
        ['Sensor / Transducer', '(thermocouple, microphone,', 'strain gauge, ...)'],
        C.hw,
        12
    ),
    arr(350, 250, 350, 340, 'raw voltage'),
    box(
        200,
        340,
        300,
        100,
        ['Signal Conditioning', '(amplify · level-shift', 'anti-alias filter · impedance buffer)'],
        C.sw,
        12
    ),
    arr(350, 440, 350, 530, 'conditioned voltage'),
    box(200, 530, 300, 90, ['MCU ADC', 'Sample-Hold → Compare → Register'], C.kern, 13),
    arr(350, 620, 350, 710, 'digital count'),
    box(200, 710, 300, 90, ['Firmware', '(scale, calibrate, filter)'], C.app, 13),
    arr(350, 800, 350, 890, 'processed value'),
    box(200, 890, 300, 90, ['DAC → Output Conditioning', '→ Actuator / Load'], C.isr, 12),
]);

/* dma_arch — 14_DMA */
save('dma_arch', 740, 430, [
    box(60, 40, 220, 70, ['CPU', '(Cortex-M core)'], C.sw),
    box(460, 40, 220, 70, ['DMA CONTROLLER', '(DMA1 / DMA2)'], C.kern),
    arr(170, 110, 320, 200),
    arr(570, 110, 420, 200),
    box(200, 200, 340, 60, ['AHB BUS MATRIX'], C.queue, 15),
    arr(220, 260, 130, 350),
    arr(370, 260, 370, 350),
    arr(500, 260, 580, 350),
    box(40, 350, 180, 70, ['Flash / SRAM', 'code + data'], C.hw, 13),
    box(280, 350, 180, 70, ['SRAM', 'buffers'], C.hw),
    box(500, 350, 180, 70, ['Peripheral Bus', '(APB)'], C.gray),
]);

/* serial_frame — 15_Serial_Communication_Fundamentals */
save('serial_frame', 1080, 300, [
    box(20, 130, 150, 90, ['CPU / DMA', 'TRANSMITTER'], C.sw, 13),
    arr(170, 175, 220, 175, 'parallel'),
    box(220, 130, 170, 90, ['TX Shift Register', '(Serialize', 'parallel → serial)'], C.kern, 12),
    arr(390, 175, 440, 175, 'serial bits'),
    box(
        440,
        60,
        200,
        230,
        ['PHYSICAL WIRE(S)', '', 'Sync:', 'DATA + CLOCK lines', '', 'Async:', 'DATA line only'],
        C.hw,
        12
    ),
    arr(640, 175, 690, 175, 'serial bits'),
    box(690, 130, 170, 90, ['RX Shift Register', '(Deserialize', 'serial → parallel)'], C.kern, 12),
    arr(860, 175, 910, 175, 'parallel'),
    box(910, 130, 150, 90, ['CPU / DMA', 'RECEIVER'], C.sw, 13),
]);

/* uart_flow — 16_UART_Explained */
save('uart_flow', 840, 280, [
    box(30, 50, 170, 80, ['Application', 'Software', '(writes byte)'], C.app, 12),
    arr(200, 90, 250, 90),
    box(250, 50, 160, 80, ['TX FIFO', '(8–16 bytes)'], C.queue, 13),
    arr(410, 90, 460, 90),
    box(460, 50, 180, 80, ['Shift Register', '(parallel → serial)'], C.sw, 12),
    arr(640, 90, 700, 90),
    box(700, 50, 130, 80, ['TX Pin', '(3.3V TTL)'], C.hw, 12),
    box(380, 200, 220, 60, ['Baud Rate Generator', '(CLK ÷ divisor)'], C.kern, 13),
    arr(550, 200, 550, 130),
]);

/* spi_conn — 17_SPI_Explained */
save('spi_conn', 700, 340, [
    box(220, 30, 260, 90, ['MCU  (SPI Master)', 'SCK · MOSI · MISO', 'CS0 · CS1 · CS2'], C.sw, 13),
    arr(350, 120, 350, 170),
    box(40, 170, 620, 40, ['Shared  SCK / MOSI / MISO  bus'], C.queue, 13),
    arr(120, 210, 120, 250, 'CS0'),
    arr(350, 210, 350, 250, 'CS1'),
    arr(580, 210, 580, 250, 'CS2'),
    box(40, 250, 160, 70, ['Device 0', '(CS0)'], C.hw),
    box(270, 250, 160, 70, ['Device 1', '(CS1)'], C.hw),
    box(500, 250, 160, 70, ['Device 2', '(CS2)'], C.hw),
]);

/* i2c_bus — 18_I2C_Explained */
save('i2c_bus', 720, 500, [
    box(60, 40, 240, 80, ['I²C MASTER', '(MCU / CPU)'], C.kern),
    arr(350, 80, 350, 210),
    arr(350, 80, 350, 290),
    box(60, 210, 600, 40, ['SDA  (data)  — open-drain, pull-up to VCC'], C.queue, 13),
    box(60, 290, 600, 40, ['SCL  (clock) — open-drain, pull-up to VCC'], C.queue, 13),
    arr(150, 330, 150, 400),
    arr(360, 330, 360, 400),
    arr(570, 330, 570, 400),
    box(60, 400, 180, 80, ['Slave 0x50', '(EEPROM)'], C.hw, 13),
    box(270, 400, 180, 80, ['Slave 0x48', '(Temp sensor)'], C.hw, 13),
    box(480, 400, 180, 80, ['Slave 0x68', '(IMU)'], C.hw, 13),
]);

/* can_bus — 19_CAN_Bus_Explained */
save('can_bus', 780, 310, [
    box(30, 30, 160, 100, ['NODE A (ECU)', 'STM32F4', 'CAN Controller', 'TJA1050'], C.sw, 12),
    box(220, 30, 160, 100, ['NODE B (BCM)', 'STM32G0', 'CAN Controller', 'TJA1050'], C.sw, 12),
    box(410, 30, 160, 100, ['NODE C (ABS)', 'dsPIC33', 'CAN Controller', 'MCP2551'], C.sw, 12),
    box(600, 30, 160, 100, ['NODE D (DASH)', 'Custom MCU', 'CAN Controller', 'TJA1050'], C.sw, 12),
    arr(110, 130, 110, 240),
    arr(300, 130, 300, 240),
    arr(490, 130, 490, 240),
    arr(680, 130, 680, 240),
    box(
        30,
        240,
        750,
        50,
        ['CAN BUS — CANH / CANL differential pair — 120Ω terminators at each end'],
        C.hw,
        13
    ),
]);

/* event_pipeline — 06_Event_Driven_Systems */
save('event_pipeline', 840, 470, [
    box(20, 40, 140, 60, ['Button GPIO'], C.hw, 13),
    box(20, 120, 140, 60, ['UART RX'], C.hw, 13),
    box(20, 200, 140, 60, ['Timer TIM2'], C.hw, 13),
    box(20, 280, 140, 60, ['ADC EOC'], C.hw, 13),
    box(20, 360, 140, 60, ['SPI TC'], C.hw, 13),
    arr(160, 70, 220, 70, 'IRQ'),
    arr(160, 150, 220, 150, 'IRQ'),
    arr(160, 230, 220, 230, 'IRQ'),
    arr(160, 310, 220, 310, 'IRQ'),
    arr(160, 390, 220, 390, 'IRQ'),
    box(220, 40, 150, 60, ['EXTI ISR'], C.isr, 13),
    box(220, 120, 150, 60, ['USART ISR'], C.isr, 13),
    box(220, 200, 150, 60, ['TIM ISR'], C.isr, 13),
    box(220, 280, 150, 60, ['ADC ISR'], C.isr, 13),
    box(220, 360, 150, 60, ['SPI ISR'], C.isr, 13),
    arr(370, 70, 440, 230, 'post()'),
    arr(370, 150, 440, 230, 'post()'),
    arr(370, 230, 440, 230, 'post()'),
    arr(370, 310, 440, 230, 'post()'),
    arr(370, 390, 440, 230, 'post()'),
    box(440, 110, 170, 240, ['EVENT', 'QUEUE', '', 'FIFO', 'event_loop()'], C.queue),
    arr(610, 230, 680, 70),
    arr(610, 230, 680, 150),
    arr(610, 230, 680, 230),
    arr(610, 230, 680, 310),
    box(680, 40, 160, 60, ['btn_handler()'], C.app, 13),
    box(680, 120, 160, 60, ['uart_handler()'], C.app, 13),
    box(680, 200, 160, 60, ['adc_handler()'], C.app, 13),
    box(680, 280, 160, 60, ['tick_handler()'], C.app, 13),
]);

/* debug_probe — 22_Embedded_Debugging */
save('debug_probe', 700, 660, [
    box(140, 30, 420, 80, ['HOST PC', 'GDB / IDE  (Keil, IAR, VS Code + cortex-debug)'], C.app, 13),
    arr(350, 110, 350, 210, 'USB (HID / CDC)'),
    box(140, 210, 420, 80, ['DEBUG PROBE', 'J-Link  ·  ST-LINK  ·  CMSIS-DAP'], C.sw, 13),
    arr(350, 290, 350, 380, 'JTAG (4–5 pin)  or  SWD (2 pin)'),
    box(
        140,
        380,
        420,
        150,
        [
            'CoreSight Debug Subsystem',
            'DAP → AHB-AP → AHB bus',
            'FPB (breakpoints)  ·  DWT (watchpoints)',
            'ITM (trace)  ·  TPIU → SWO pin',
        ],
        C.kern,
        12
    ),
    arr(350, 530, 350, 590),
    box(140, 590, 420, 60, ['Application CPU + Peripherals'], C.hw, 13),
]);

/* memory_layout — 23_Memory_Corruption_and_System_Stability */
save('memory_layout', 700, 680, [
    box(
        80,
        20,
        540,
        80,
        ['FLASH (Read-Only Code)   .text · .rodata', 'MPU: read + execute only — write faults'],
        C.hw,
        13
    ),
    box(
        80,
        115,
        540,
        70,
        ['SRAM — .data (initialized globals)   .bss (zero-initialized globals)'],
        C.sw,
        13
    ),
    box(80, 200, 540, 70, ['Heap  (dynamic allocation)   canary at heap boundary'], C.warn, 13),
    box(
        80,
        285,
        540,
        70,
        ['Task A Stack  [CANARY at bottom]   MPU: no-access below canary'],
        C.isr,
        13
    ),
    box(
        80,
        370,
        540,
        70,
        ['Task B Stack  [CANARY at bottom]   MPU: no-access below canary'],
        C.isr,
        13
    ),
    box(80, 455, 540, 70, ['ISR / Main Stack (MSP)   [CANARY at bottom]'], C.kern, 13),
    box(
        80,
        540,
        540,
        80,
        ['Peripheral Registers (Memory-Mapped)', 'MPU: privileged access only from user tasks'],
        C.queue,
        13
    ),
]);

/* linker_map — 24_Linker_Scripts_Explained */
save('linker_map', 760, 910, [
    box(230, 30, 280, 60, ['Source Files  (.c, .s)'], C.sw),
    arr(370, 90, 370, 170, 'compile'),
    box(230, 170, 280, 60, ['Compiler / Assembler'], C.gray),
    arr(370, 230, 370, 310),
    box(230, 310, 280, 70, ['Object Files  (.o)', 'relocatable — no fixed addresses'], C.hw, 12),
    arr(370, 380, 370, 460),
    arr(180, 430, 230, 490, 'linker script'),
    box(
        40,
        380,
        160,
        90,
        ['Linker Script  (.ld)', 'MEMORY regions', 'SECTIONS layout'],
        C.gray,
        11
    ),
    box(230, 460, 280, 60, ['LINKER'], C.queue, 16),
    arr(510, 490, 560, 490),
    box(560, 460, 180, 60, ['ELF Executable'], C.kern),
    arr(650, 520, 650, 590),
    box(560, 590, 180, 60, ['.bin / .hex', '(objcopy)'], C.warn, 13),
    arr(650, 650, 650, 710),
    box(560, 710, 180, 60, ['Flash Programmer'], C.app),
    arr(650, 770, 650, 830),
    box(
        540,
        830,
        200,
        100,
        ['MCU Flash', '0x08000000  .vectors', '0x08000100  .text', '0x0800xxxx  .data init'],
        C.hw,
        11
    ),
    box(
        230,
        830,
        200,
        100,
        ['MCU SRAM', '0x20000000  .data', '0x2000xxxx  .bss', 'Heap ↑     ↓ Stack'],
        C.sw,
        11
    ),
]);

/* bootloader_flash — 25_Bootloaders_and_Firmware_Updates */
save('bootloader_flash', 760, 780, [
    box(230, 30, 280, 60, ['POWER ON / RESET'], C.hw),
    arr(370, 90, 370, 180),
    box(230, 180, 280, 80, ['BOOTLOADER', '(protected flash — never updated)'], C.kern),
    arr(370, 260, 370, 340),
    box(230, 340, 280, 70, ['Update flag set?\nNew image valid?'], C.warn),
    arr(310, 415, 150, 510, 'YES'),
    arr(430, 415, 590, 510, 'NO (valid app)'),
    box(
        40,
        510,
        220,
        110,
        ['FIRMWARE UPDATE', '— erase active bank', '— copy / swap', '— verify CRC'],
        C.isr,
        13
    ),
    box(
        470,
        510,
        220,
        110,
        ['JUMP TO APP', '— set Stack Pointer', '— jump to reset', '   handler'],
        C.sw,
        13
    ),
    arr(150, 620, 150, 700),
    box(40, 700, 220, 70, ['Boot new image', '(rollback if verify fails)'], C.app, 13),
]);

/* power_domains — 26_Power_Management_Fundamentals */
save('power_domains', 760, 430, [
    box(30, 30, 700, 50, ['VDD POWER DOMAIN'], C.hw, 15),
    box(70, 120, 190, 70, ['CPU', 'Cortex-M'], C.kern),
    box(290, 120, 190, 70, ['SRAM1  /  SRAM2'], C.sw),
    box(510, 120, 190, 70, ['Peripherals', 'AHB / APB'], C.queue),
    box(30, 250, 700, 50, ['ALWAYS-ON DOMAIN  (VBAT / VSW)'], C.warn, 14),
    box(70, 340, 150, 70, ['RTC'], C.gray),
    box(250, 340, 150, 70, ['LSE'], C.gray),
    box(430, 340, 270, 70, ['Backup Registers'], C.gray),
]);

/* clock_tree — 05_Clock_System_Fundamentals */
save('clock_tree', 820, 470, [
    box(30, 40, 170, 60, ['HSE', '4–26 MHz crystal'], C.hw, 12),
    box(30, 120, 170, 60, ['HSI', '16 MHz internal RC'], C.hw, 12),
    box(30, 200, 170, 60, ['LSE', '32.768 kHz'], C.hw, 12),
    box(30, 280, 170, 60, ['LSI', '~32 kHz RC'], C.hw, 12),
    arr(200, 70, 270, 110),
    arr(200, 150, 270, 115),
    box(270, 80, 150, 60, ['PLL'], C.kern, 16),
    arr(420, 110, 480, 110),
    box(480, 80, 170, 60, ['SYSCLK', '168 MHz'], C.queue, 13),
    arr(650, 110, 710, 110),
    box(710, 80, 100, 60, ['CPU Core'], C.isr),
    arr(565, 140, 565, 220),
    box(480, 220, 170, 60, ['AHB Bus', '÷ 1..512'], C.sw, 13),
    arr(510, 280, 430, 370, '÷ 1..16'),
    arr(630, 280, 660, 370, '÷ 1..16'),
    box(350, 370, 170, 80, ['APB1  (slow)', 'USART2-5, I2C', 'SPI2-3, DAC'], C.app, 11),
    box(570, 370, 200, 80, ['APB2  (fast)', 'USART1/6', 'SPI1, ADC'], C.app, 11),
]);

/* security_arch — 27_Embedded_Security_Fundamentals */
save('security_arch', 720, 630, [
    box(30, 30, 660, 50, ['APPLICATION PROCESSOR'], C.hw, 15),
    box(
        70,
        120,
        270,
        180,
        [
            'SECURE WORLD  (TrustZone)',
            '',
            'Key storage',
            'Crypto operations',
            'Attestation & sealing',
        ],
        C.kern,
        13
    ),
    box(
        390,
        120,
        270,
        180,
        ['NORMAL WORLD', '', 'RTOS / bare-metal app', 'Peripheral drivers', 'Application logic'],
        C.sw,
        13
    ),
    arr(210, 300, 340, 380),
    arr(510, 300, 395, 380),
    box(205, 380, 310, 80, ['SECURE BOOTLOADER', '(ROM or signed first-stage)'], C.isr),
    arr(300, 460, 140, 545),
    arr(400, 460, 560, 545),
    box(40, 545, 230, 80, ['INTERNAL FLASH', '(CRP enabled)', 'Signed firmware'], C.hw, 12),
    box(440, 545, 230, 80, ['SECURE ELEMENT', 'external IC or', 'embedded HSM'], C.kern, 12),
]);

/* state_machine — 07_State_Machines */
save('state_machine', 800, 630, [
    box(60, 40, 200, 80, ['HARDWARE / ISRs', '(GPIO, UART, Timer)'], C.hw),
    box(540, 40, 200, 80, ['PERIPHERAL DRIVERS', '(SPI, I2C, ADC)'], C.hw),
    arr(160, 120, 370, 220, 'events'),
    arr(640, 120, 430, 220, 'callbacks'),
    box(280, 220, 240, 80, ['EVENT QUEUE', '(ring buffer / flags)'], C.queue),
    arr(400, 300, 400, 380),
    box(
        220,
        380,
        360,
        90,
        ['STATE MACHINE DISPATCHER', 'current state · transition table', 'entry / exit actions'],
        C.kern,
        13
    ),
    arr(310, 470, 160, 540),
    arr(490, 470, 640, 540),
    box(60, 540, 200, 80, ['OUTPUT ACTIONS', '(HAL, actuators,', 'display updates)'], C.sw, 13),
    box(
        540,
        540,
        200,
        80,
        ['APPLICATION LOGIC', '(business rules,', 'data processing)'],
        C.app,
        13
    ),
]);

/* mcu_boot_flow — 01_MCU_Boot_Sequence */
save('mcu_boot_flow', 700, 730, [
    box(210, 30, 280, 70, ['POWER ON / RESET', '(internal RC, registers cleared)'], C.hw, 12),
    arr(350, 100, 350, 190),
    box(
        210,
        190,
        280,
        80,
        ['Vector Table Fetch', 'Word 0: Initial SP', 'Word 1: Reset Handler addr'],
        C.kern,
        12
    ),
    arr(350, 270, 350, 360),
    box(
        210,
        360,
        280,
        110,
        [
            'Reset Handler',
            '— copy .data  flash → RAM',
            '— zero .bss in RAM',
            '— optional: SystemInit()',
        ],
        C.sw,
        12
    ),
    arr(350, 470, 350, 560),
    box(210, 560, 280, 70, ['C Runtime Init', '__libc_init_array()  /  C++ ctors'], C.gray, 12),
    arr(350, 630, 350, 700),
    box(210, 700, 280, 60, ['main()'], C.app, 16),
]);

/* memory_map — 02_Memory_Architecture */
save('memory_map', 660, 680, [
    box(160, 30, 460, 80, ['0xFFFFFFFF  Vendor-specific / Reserved'], C.gray, 13),
    box(
        160,
        125,
        460,
        80,
        ['0xE0000000  Private Peripheral Bus (PPB)', 'NVIC · SysTick · DWT · ITM'],
        C.kern,
        13
    ),
    box(160, 220, 460, 70, ['0xA0000000  External Device / Bus'], C.gray, 13),
    box(160, 305, 460, 70, ['0x60000000  External RAM'], C.hw, 13),
    box(
        160,
        390,
        460,
        80,
        ['0x40000000  Peripheral Registers', 'GPIO · USART · SPI · I2C · ADC'],
        C.queue,
        13
    ),
    box(160, 485, 460, 80, ['0x20000000  SRAM', 'Variables · Stack · Heap'], C.sw, 13),
    box(160, 580, 460, 80, ['0x00000000  Code (Flash)', 'vectors · .text · .rodata'], C.isr, 13),
]);

/* firmware_layers — 28_Firmware_Architecture_Patterns */
save('firmware_layers', 780, 640, [
    box(90, 40, 600, 80, ['APPLICATION LAYER', 'product logic, system coordination'], C.app),
    arr(390, 120, 390, 180, 'calls down'),
    box(90, 180, 600, 80, ['MIDDLEWARE LAYER', 'protocol stacks, algorithms, utilities'], C.sw),
    arr(390, 260, 390, 320, 'calls down'),
    box(90, 320, 600, 80, ['DRIVER LAYER', 'per-device protocol sequencing'], C.queue),
    arr(390, 400, 390, 460, 'calls down'),
    box(
        90,
        460,
        600,
        80,
        ['HARDWARE ABSTRACTION LAYER  (HAL)', 'peripheral capability interfaces'],
        C.kern
    ),
    arr(390, 540, 390, 600, 'calls down'),
    box(
        90,
        600,
        600,
        60,
        ['BSP / REGISTERS — MCU-specific, board-specific configuration'],
        C.hw,
        12
    ),
]);

/* ═══════════════════════════════════════════════════════════════════════════
   2. COPY & RENAME PROJECT SVGs  (kebab → snake, preserve original content)
   ═════════════════════════════════════════════════════════════════════════*/
console.log('\nCopying project SVGs to snake_case names...\n');

var projectSvgs = ['bldc-foc', 'can-eth-gateway', 'iot-gateway', 'linux-bsp', 'ota-bootloader'];
projectSvgs.forEach(function (kebab) {
    var src = path.join(OUT, kebab + '.svg');
    var dest = path.join(OUT, kebab.replace(/-/g, '_') + '.svg');
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('  ✓ copied', path.basename(dest));
    } else {
        console.log('  ⚠ not found:', kebab + '.svg  (skipped)');
    }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. UPDATE img src REFERENCES in data/**\/*.md  (kebab → snake)
   ═════════════════════════════════════════════════════════════════════════*/
console.log('\nUpdating img src references in MD files...\n');

var MDpattern = /src="\.\.\/assets\/svg\/diagrams\/([^"]+)\.svg"/g;

function walkMd(dir) {
    fs.readdirSync(dir).forEach(function (name) {
        var full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
            walkMd(full);
            return;
        }
        if (!name.endsWith('.md')) return;

        var original = fs.readFileSync(full, 'utf8');
        var updated = original.replace(MDpattern, function (match, stem) {
            var snake = stem.replace(/-/g, '_');
            return 'src="../assets/svg/diagrams/' + snake + '.svg"';
        });
        if (updated !== original) {
            fs.writeFileSync(full, updated, 'utf8');
            console.log('  updated', path.relative(DATA, full));
        }
    });
}
walkMd(DATA);

console.log('\nAll done.');
