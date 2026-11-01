---
title: "Embedded GUIs with LVGL: Screens on Small Devices"
brief: "How LVGL draws interfaces with little memory, how its display and input layers work, and how to keep a UI responsive."
order: 67
phase: 11
tags: ["LVGL", "GUI", "Display", "Framebuffer", "Touch"]
---

A washing machine with a colour touchscreen feels simple. Behind it, a small processor is redrawing pixels, handling touch and running the machine, often without a GPU and with limited RAM. LVGL is a popular C library that makes this possible, and most UI problems come from how it is connected to the rest of the system.

## The Fundamental Problem

A 480×320 screen at 16 bits per pixel needs about 300 KB for one full frame, and redrawing it all would take too long on a small CPU. Smooth interfaces need quick updates, while the same CPU has real work to do. Display chips and touch controllers also vary between products, so UI code must not depend on them.

## The Big Picture

![The application uses LVGL widgets, and LVGL talks to the display and touch drivers](/diagrams/lvgl_stack.svg)

### In Plain Terms

Imagine repainting a wall by hand. If you repaint the whole wall each time one small picture moves, you will never finish. So you only repaint the small patch that changed.

LVGL does the same. It tracks which parts of the screen changed, called dirty areas, and redraws just those. You describe the screen as objects, such as buttons and labels. LVGL works out the pixels, and a small driver you write copies them to the display.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Widget / object** | A UI element, such as a button or label. |
| **Screen** | A root object holding a whole page. |
| **Style** | Colours, fonts and spacing. |
| **Event** | A callback when something happens, such as a click. |
| **Draw buffer** | Memory where LVGL renders pixels. |
| **Flush callback** | Your function that sends pixels to the display. |
| **Tick** | LVGL's sense of elapsed time. |
| **Dirty area** | A region needing a redraw. |

## How It Works

### Step 1: Initialise

Call `lv_init`, then register your display and input drivers.

### Step 2: Build screens

Create widgets and set their styles and events.

### Step 3: Provide time

Tell LVGL how many milliseconds have passed.

### Step 4: Run the handler

A loop calls `lv_timer_handler`, which processes input and animations.

### Step 5: Redraw

LVGL renders dirty areas into the buffer, and calls your flush callback.

## A Closer Look: Why the UI Must Live on One Thread

Most LVGL problems come down to one fact: LVGL is not thread-safe, and it needs a steady heartbeat.

Inside, LVGL keeps lists of objects and dirty areas. While `lv_timer_handler` runs, it walks through those lists and draws. If another thread changes a label at that moment, the lists can be modified mid-walk. The result might be a wrong pixel, or a crash days later.

The cleanest design has one UI thread that owns everything LVGL. Its loop is simple:

```c
for (;;) {
    process_ui_messages();
    uint32_t wait = lv_timer_handler();
    sleep_ms(wait);
}
```

Other threads never touch LVGL. They post a message, such as "temperature is 21.5", and the UI thread applies it.

This matches how the rest of a good system works: one owner for each resource, and messages between them. It also keeps the screen responsive, as nothing slow runs on the UI thread. If something takes a long time, hand it to a worker, and show progress.

## A Worked Example: A Temperature Screen

```c
static lv_obj_t *label;

static void on_click(lv_event_t *e)
{
    fan_toggle();
}

void ui_create(void)
{
    label = lv_label_create(lv_screen_active());
    lv_label_set_text(label, "--.- C");

    lv_obj_t *btn = lv_button_create(lv_screen_active());
    lv_obj_align(btn, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_add_event_cb(btn, on_click, LV_EVENT_CLICKED, NULL);
}
```

LVGL is not thread-safe, and this is where projects go wrong. If a sensor thread calls `lv_label_set_text` while the GUI thread is drawing, you get random crashes. Keep all LVGL calls on one thread, and let others post updates:

```c
/* sensor thread */
msg_queue_put(&ui_queue, temp);

/* GUI thread, before lv_timer_handler() */
while (msg_queue_get(&ui_queue, &t))
    lv_label_set_text_fmt(label, "%d.%d C", t / 10, t % 10);
```

The UI stays smooth, and the sensor code knows nothing about the display. This separation also makes plug-in screens possible, and lets a UI framework support several display types.

## Common Questions

**Do I need a GPU?** No. LVGL runs on small MCUs, but a GPU or 2D accelerator helps with smoothness.

**How much memory does it need?** A small UI can run in tens of kilobytes of RAM, plus the display buffers.

**Can I design screens visually?** Yes. SquareLine Studio and LVGL's own tools can generate UI code.

**Does it work on Linux?** Yes, with DRM, framebuffer or SDL for testing on a PC.

## Under the Hood

Partial buffers save RAM: LVGL can render in strips, such as one-tenth of the screen height, and flush them one at a time. Two buffers with DMA let the CPU render while the last strip is being sent. Full-screen double buffering looks best, particularly on Linux, but needs more memory.

On Embedded Linux, LVGL can draw to DRM or a framebuffer, and read touch through `evdev`. Fonts and images take up the most flash, so include only the characters and sizes you need.

Fill and copy operations can use hardware, such as DMA2D on STM32 or a GPU, and this greatly reduces CPU load.

## Real-World Applications

**Appliances.** Touch panels on home devices.

**Medical and industrial.** Simple clear displays on instruments.

**Automotive.** Small cluster and auxiliary screens.

**Handheld tools.** Field devices with several display sizes.

## Common Mistakes

### Mistake 1: Calling LVGL from many threads

**What goes wrong:** Random crashes and display glitches.

**How to avoid it:** Use one UI thread and a message queue.

### Mistake 2: Blocking in event handlers

**What goes wrong:** The screen freezes during a slow operation.

**How to avoid it:** Hand the work to another thread.

### Mistake 3: Forgetting the flush-ready call

**What goes wrong:** One frame draws, and the display then stops.

**How to avoid it:** Call the flush-ready function when the transfer ends.

## Debugging and Troubleshooting

**Symptom:** The screen shows wrong colours

**Possible Cause:** Colour depth or byte order mismatch.

**Investigation Method:** Draw pure red, green and blue blocks.

**Resolution:** Fix the colour format or swap bytes.

**Symptom:** The UI feels slow

**Possible Cause:** Too much redraw, slow transfers or large shadows.

**Investigation Method:** Enable the performance monitor and check FPS and CPU.

**Resolution:** Reduce dirty areas, use DMA and simplify styles.

## Design Considerations and Best Practices

**Separate UI from logic.** Model data separately so screens can change easily.

**Plan memory early.** Display size sets buffer needs.

**Automate assets.** Scripts can convert images and strings for builds and languages.

**Design for touch.** Larger targets matter on small screens.

## Expert Notes

**Simulate on a PC.** Running the UI with SDL lets designers work without hardware, and speeds things up greatly.

**Plan for translation early.** German strings are longer, and some languages need different fonts. Layouts should allow for that.

**Measure with the real display.** Refresh limits and interface bandwidth decide what looks smooth, not the CPU alone.

## Summary

LVGL builds interfaces from objects and redraws only what has changed, so even small processors can run smooth screens. You supply a display flush, a touch input and a time source. Keep all LVGL calls on one thread, post updates through a queue, use DMA where you can, and keep UI code separate from product logic.

## Related Topics

**Prerequisites**

- POSIX Threads
- DMA

**Next Topics**

- Low-Level Design
- Kernel vs User Space
