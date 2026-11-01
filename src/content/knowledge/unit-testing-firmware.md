---
title: "Unit Testing Firmware: Testing Without Hardware"
brief: "How to structure firmware so that logic runs on a PC, using mocks for hardware to catch bugs in seconds, not days."
order: 60
phase: 10
tags: ["Unit Testing", "Mocks", "Unity", "CMock", "Test Doubles"]
---

Many embedded teams say firmware cannot be unit tested, because it needs the hardware. So testing means flashing a board and watching an LED. Yet most firmware bugs are in plain logic: state machines, parsers, calculations. None of that needs a board, if the code is arranged properly.

## The Fundamental Problem

Testing on hardware is slow and hard to automate, and rare cases are difficult to create. How do you test a sensor failure, or a counter wrap after 49 days? When logic is tangled up with register writes, it cannot run anywhere else, so nobody tests it until it is on a real board.

## The Big Picture

![Application logic is tested on a PC by replacing the hardware layer with a mock](/diagrams/unit_test.svg)

### In Plain Terms

Pilots train in flight simulators. The controls are real, while the aircraft is simulated, so they can practise an engine failure safely and repeat it a hundred times.

A unit test is a flight simulator for your code. The logic is real, but the hardware layer is replaced by a stand-in called a mock. You can tell it "the sensor just failed" and check what your code does, thousands of times per second, on your laptop.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Unit test** | A small automated test of one piece of logic. |
| **Test double** | A stand-in for a real dependency. |
| **Mock** | A double that also checks how it was called. |
| **Stub** | A double that returns fixed values. |
| **Dependency injection** | Passing in a dependency so that it can be replaced. |
| **Unity / CMock** | A small C test framework and mock generator. |
| **Coverage** | How much code the tests run. |

## How It Works

### Step 1: Separate logic from hardware

Put register access behind a small interface.

### Step 2: Build for the host

Compile the logic with `gcc` on your PC, along with the tests.

### Step 3: Replace the hardware layer

Link a mock in place of the real driver.

### Step 4: Arrange, act, assert

Set up the case, call the code and check the result.

### Step 5: Automate

Run the tests on every commit.

## A Closer Look: Separating Logic From Hardware

The whole approach depends on one habit, so let us see it in a small change.

Here is code that cannot be tested:

```c
void check_level(void)
{
    if (ADC1->DR > 3000)
        GPIOA->BSRR = (1 << 5);
}
```

It reads a register and writes a register, so it can only run on one specific chip. The decision, "above 3000, turn on", is trapped inside.

Now split it:

```c
bool level_high(uint32_t raw) { return raw > 3000; }

void check_level(void)
{
    if (level_high(adc_read()))
        led_on();
}
```

`level_high` is pure logic: same input, same output, no hardware. You can test it in one line. `adc_read` and `led_on` are thin wrappers, simple enough to check by hand on the board.

The result is thin code at the edges, and testable logic at the centre. This also makes the code easier to port, since only the thin layer changes when the chip does.

## A Worked Example: Testing a Temperature Alarm

Logic should turn on a fan above 80 °C, and off below 70 °C. It depends on a small interface:

```c
int  sensor_read(int *temp);   /* returns 0 on success */
void fan_set(bool on);

void thermal_step(void)
{
    int t;
    if (sensor_read(&t) != 0) { fan_set(true); return; }
    if (t > 80) fan_set(true);
    else if (t < 70) fan_set(false);
}
```

The test file supplies a fake version, so no hardware is needed:

```c
static int fake_temp, fake_err;
static bool fan_on;
int sensor_read(int *t) { *t = fake_temp; return fake_err; }
void fan_set(bool on)   { fan_on = on; }

void test_fan_on_when_sensor_fails(void)
{
    fake_err = -1;
    thermal_step();
    TEST_ASSERT_TRUE(fan_on);
}
```

That failure case would be awkward on a real board, needing a broken wire. Here it takes one line, and runs in microseconds. Add tests for 80, 81, 70 and 69 degrees, because bugs like to hide at boundaries.

## Common Questions

**Isn't this extra work?** At first. It repays itself the first time a test catches a bug in seconds.

**How much should I test?** Focus on decisions, calculations, parsers and failure handling. Thin register wrappers need less.

**Where do tests live?** Beside the source, in a `test` folder, built by a separate host target.

**What about legacy code?** Add tests around code as you change it. You do not need to test it all at once.

## Under the Hood

Host and target differ. `int` may be a different size, and byte order or alignment might not match. Fixed-width types reduce this, and some tests can also run on the target or an emulator such as QEMU.

Link-time substitution is the simplest C approach: build the test with `fake_sensor.c` in place of `sensor.c`. Function pointer tables offer more flexibility, with a small cost at runtime.

Coverage comes from `gcov`, built with `--coverage`. High coverage shows what ran, not whether the results were checked. Sanitizers can be added on the host build, to catch memory bugs during tests.

## Real-World Applications

**Parsers.** Protocol decoders are tested with thousands of malformed inputs.

**State machines.** Every transition is tested without hardware.

**Control logic.** Filters and limits are checked against known values.

**Safety projects.** ISO 26262 expects unit testing with coverage.

## Common Mistakes

### Mistake 1: Testing only the happy path

**What goes wrong:** Error handling never runs until the field.

**How to avoid it:** Test each failure return.

### Mistake 2: Register access everywhere

**What goes wrong:** Nothing can run off-target.

**How to avoid it:** Keep hardware behind thin drivers.

### Mistake 3: Over-mocking

**What goes wrong:** Tests only repeat the code's call order, and break on any refactor.

**How to avoid it:** Test behaviour, not internal steps.

## Debugging and Troubleshooting

**Symptom:** Test passes on host but fails on the target

**Possible Cause:** Type sizes, alignment or endianness.

**Investigation Method:** Print `sizeof` values, and run the test on the target.

**Resolution:** Use fixed-width types, and do not cast buffers.

**Symptom:** Tests fail randomly

**Possible Cause:** State left over from an earlier test.

**Investigation Method:** Run tests alone and in different orders.

**Resolution:** Reset state in `setUp`.

## Design Considerations and Best Practices

**Design for testing.** Small functions with clear inputs are also better designs.

**Write a test for each bug.** The bug can then never return unnoticed.

**Keep tests fast.** They only get run if they take seconds.

**Do not chase 100%.** Focus on logic, boundaries and failures.

## Expert Notes

**Time is a dependency.** Code calling a real clock is hard to test. Pass the time in, or use a fake clock, so that a 49-day wrap takes one line to check.

**Fuzz your parsers on the host.** libFuzzer finds input bugs that nobody would think to write.

**A test that never fails proves nothing.** Break the code on purpose, and confirm that the test notices.

## Summary

Most firmware bugs live in plain logic, and that logic can be tested on a PC if hardware sits behind a small interface. Mocks act like a flight simulator, letting you create failures that are hard to produce on a board. Keep hardware access thin, test boundaries and errors, and run tests on every commit.

## Related Topics

**Prerequisites**

- Firmware Architecture Patterns
- State Machines

**Next Topics**

- Hardware-in-the-Loop Testing
- Static Analysis and CI
