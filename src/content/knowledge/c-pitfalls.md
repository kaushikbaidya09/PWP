---
title: "C Pitfalls in Embedded: Bugs the Compiler Will Not Warn About"
brief: "How volatile, undefined behaviour, integer promotion, alignment and padding cause real firmware bugs, and how to avoid them."
order: 58
phase: 10
tags: ["C", "volatile", "Undefined Behaviour", "Alignment", "Integer Promotion"]
---

A delay loop works perfectly until you turn on `-O2`, then it vanishes. A status flag is never seen by the main loop. A subtraction gives a huge number. The compiler was not wrong in any of these cases: C simply allows things that look safe and are not. Most embedded C bugs come from a small set of these traps.

## The Fundamental Problem

C was designed to give the compiler freedom to produce fast code. It assumes you follow the rules and never checks at runtime. Embedded code makes this harder: it touches hardware, shares data with interrupts, and depends on exact sizes and layouts. Code that seems to work may be relying on luck, and can break with a new compiler or optimisation level.

## The Big Picture

![The compiler optimises using the rules of C, so code that breaks those rules can change meaning](/diagrams/c_pitfalls.svg)

### In Plain Terms

Think of the compiler as a very efficient assistant who follows your instructions exactly as written, and assumes that you never make mistakes. If you ask it to check the mailbox a thousand times in a row, it reasons that nothing in your instructions changes the mailbox, so it checks once and remembers. It does not know that a postman exists.

`volatile` is how you say "someone else touches this". Undefined behaviour is a part of the contract: if you break it, the assistant owes you nothing.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **volatile** | Every read and write must really happen. |
| **Undefined behaviour** | The standard gives no meaning, so anything can happen. |
| **Integer promotion** | Small types convert to `int` in expressions. |
| **Alignment** | Data placed at addresses a CPU can access properly. |
| **Padding** | Unused bytes added inside a struct. |
| **Strict aliasing** | Rules about accessing an object through another type. |
| **Fixed-width types** | `uint32_t` and friends from `stdint.h`. |

## How It Works

### Step 1: The compiler reads your code

It builds a model assuming no undefined behaviour exists.

### Step 2: It optimises under the "as-if" rule

Any change is allowed if the visible behaviour stays the same, and that excludes hardware effects it cannot see.

### Step 3: Assumptions become facts

If code would overflow a signed int, the compiler may assume it never happens and remove your checks.

### Step 4: The bug appears

Debug builds work, while optimised builds behave differently.

## A Closer Look: What Undefined Behaviour Really Means

Most people think undefined behaviour means "you get a strange value". The truth is stranger.

When the C standard calls something undefined, it places no rules at all on what happens. More importantly, the compiler is allowed to assume it never occurs, and it uses that assumption to optimise.

Look at this:

```c
void process(int *p)
{
    int v = *p;          /* p is dereferenced here */
    if (p == NULL)       /* so the compiler may remove this check */
        return;
    use(v);
}
```

Reading `*p` when `p` is null is undefined. So the compiler reasons: "since the program read `*p`, `p` cannot be null, so this check is pointless", and it deletes the check.

Your safety code vanished, and no warning appeared. On an MCU, address 0 may even be readable, so the first line works and the bug stays silent.

That is why "it works on my board" proves nothing. The fix is to check first, and let warnings and sanitizers find the rest.

## A Worked Example: Five Classic Traps

**A missing volatile.** The flag is set in an ISR, but the compiler caches it:

```c
static bool done;              /* should be volatile */
void ISR(void) { done = true; }
while (!done) { }              /* may loop forever */
```

**Integer promotion.** Both values become `int`, so this is false:

```c
uint8_t a = 200, b = 100;
if ((uint8_t)(a + b) == (a + b)) { /* 44 vs 300 */ }
```

**Timer wrap.** Unsigned subtraction handles wrap correctly, so write this:

```c
if ((uint32_t)(now - start) >= timeout) { ... }   /* safe */
if (now >= start + timeout) { ... }               /* breaks on wrap */
```

**Shift overflow.** `1 << 31` shifts into the sign bit of an `int`, which is undefined. Write `1U << 31`.

**Struct over a wire.** Padding changes the layout:

```c
struct msg { uint8_t type; uint32_t value; };  /* usually 8 bytes */
```

Do not send it raw. Copy each field into a byte buffer.

## Common Questions

**When should I use volatile?** For hardware registers and variables changed by an ISR, and that is about all.

**Is `int` always 32 bits?** No. It is 16 bits on AVR. Use `uint32_t` when the size matters.

**Why does a struct have a different size than its members added up?** The compiler inserts padding to keep fields aligned.

**Is `-O0` safer?** It hides bugs, and does not fix them. Test at the level you ship.

## Under the Hood

`volatile` stops the compiler removing or merging accesses, and that is all. It gives no atomicity, and no ordering between CPUs. A 32-bit counter on an 8-bit AVR is read in four steps, and an interrupt may land in the middle. A Cortex-M7 can also reorder accesses, which is why barriers such as `__DMB()` exist.

Unaligned access is allowed by some CPUs, slow on others and a fault on Cortex-M0. Casting a `uint8_t*` from a buffer to `uint32_t*` is the usual cause, and it also breaks aliasing rules. `memcpy` is the correct tool, and compilers turn it into a simple load.

Signed overflow being undefined lets a compiler remove a check such as `if (x + 1 < x)`.

## Real-World Applications

**Registers.** Hardware access always uses volatile pointers.

**Protocols.** Parsers read fields byte by byte, to stay portable.

**Timers.** Millisecond counters use unsigned wrap-safe comparison.

**Safety code.** Standards such as MISRA C restrict these exact patterns.

## Common Mistakes

### Mistake 1: Using volatile for thread safety

**What goes wrong:** It compiles and seems to work, but races remain.

**How to avoid it:** Use atomics or disable interrupts around access.

### Mistake 2: Using plain char for bytes

**What goes wrong:** Its sign varies by platform, so comparisons change.

**How to avoid it:** Use `uint8_t`.

### Mistake 3: Delay loops

**What goes wrong:** The optimiser removes them, or timing changes with the clock.

**How to avoid it:** Use a hardware timer.

## Debugging and Troubleshooting

**Symptom:** Works at `-O0`, fails at `-O2`

**Possible Cause:** Undefined behaviour or missing `volatile`.

**Investigation Method:** Build with `-Wall -Wextra -fsanitize=undefined` on a host.

**Resolution:** Fix the code rather than reducing optimisation.

**Symptom:** HardFault on data access

**Possible Cause:** Unaligned pointer.

**Investigation Method:** Read the fault status registers and faulting address.

**Resolution:** Use `memcpy` or `__packed` access deliberately.

## Design Considerations and Best Practices

**Enable warnings as errors.** `-Wall -Wextra -Wconversion` catch many of these.

**Use fixed-width types.** The size of `int` differs between CPUs.

**Test with sanitizers on a host.** UBSan and ASan run core logic on a PC.

**Keep hardware access in one layer.** Limits where `volatile` and casts appear.

## Expert Notes

**Use `_Static_assert`.** It checks struct sizes and offsets at compile time, so that protocol layouts cannot silently change.

**Read-modify-write on registers is not atomic.** `REG |= BIT` can lose a change made by an ISR. Use set and clear registers if the chip has them.

**Know your promotion rules for shifts.** `uint8_t` values are promoted to `int` before shifting, so `x << 24` can hit the sign bit.

## Summary

The compiler follows the rules of C and assumes you do too, so code that breaks them can silently change meaning. Use `volatile` for hardware and ISR flags, but not for thread safety. Watch integer promotion, unsigned wrap, shifts, alignment and padding. Turn on strict warnings and sanitizers, since "it works" does not mean it is correct.

## Related Topics

**Prerequisites**

- CPU Execution Model
- Memory Corruption and System Stability

**Next Topics**

- MISRA C
- Static Analysis and CI
