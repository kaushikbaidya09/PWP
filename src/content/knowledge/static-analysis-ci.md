---
title: "Static Analysis and CI: Catching Bugs Before Release"
brief: "How compiler warnings, analysers and automated pipelines catch mistakes on every commit, and keep firmware builds repeatable."
order: 62
phase: 10
tags: ["Static Analysis", "CI", "clang-tidy", "cppcheck", "Sanitizers"]
---

A null pointer bug reaches a customer and costs weeks to diagnose. The same bug could have been flagged by a free tool in seconds. Static analysis reads code for mistakes, and continuous integration runs those checks and every test on every change, so problems surface minutes after they are written.

## The Fundamental Problem

People miss things in code review, particularly in rarely used error paths. Manual build steps vary by engineer. The later a bug is found, the more it costs: minutes at the desk, days in test, a recall in the field. Quality checks need to be automatic, or they stop happening once a deadline gets close.

## The Big Picture

![Each commit is built, analysed and tested before it can be merged](/diagrams/ci_pipeline.svg)

### In Plain Terms

Static analysis is a spell-checker for code. It does not run your program. It reads it and points out likely mistakes, such as a variable used before it was set.

CI is a tireless assistant who, every time anyone changes anything, rebuilds the whole project from clean, runs every check and reports the result. It never forgets a step, and never says "it works on my machine".

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Static analysis** | Finding bugs without running code. |
| **Dynamic analysis** | Finding bugs while code runs. |
| **Lint** | A tool that flags suspicious code. |
| **False positive** | A warning about code that is fine. |
| **CI** | Automatically building and testing each change. |
| **Pipeline** | The ordered steps CI performs. |
| **Artifact** | A saved build output. |
| **Gate** | A check that must pass before merging. |

## How It Works

### Step 1: Commit

A developer pushes a change and opens a merge request.

### Step 2: Build in a clean environment

A container with a pinned toolchain builds the firmware.

### Step 3: Analyse

Compiler warnings, `clang-tidy` and `cppcheck` run.

### Step 4: Test

Host unit tests run with sanitizers, then tests on real hardware.

### Step 5: Decide

If everything passes, the change can merge, and the image is saved.

## A Closer Look: What an Analyser Actually Does

A compiler checks that code is legal. A static analyser asks a harder question: is it likely to be correct?

It works by imagining paths through a function, without running it. Take this code:

```c
char *p = malloc(32);
if (flag) {
    free(p);
}
strcpy(p, "hello");
```

The analyser follows each branch. On the path where `flag` is true, `p` is freed and then used: a use-after-free. On either path, `malloc` might also have returned null. The program may run fine for years if `flag` is rarely true.

That is the strength of static analysis: it examines rarely used paths that tests never reach, such as error handling. It does not know your intent, though. It can warn about a path that can never really occur, and it can miss bugs that depend on values known only at runtime.

So treat findings as questions, and use it together with tests, not instead of them.

## A Worked Example: A Bug Caught in the Pipeline

A developer adds this function:

```c
int read_config(char *out, size_t len)
{
    char *p = malloc(len);
    if (!load(p)) {
        return -1;              /* leak */
    }
    strcpy(out, p);             /* possible overflow */
    free(p);
    return 0;
}
```

It compiles, and the happy-path test passes. The analyser reports a memory leak on the error path, an unchecked `malloc` result, and a risky `strcpy`. The developer fixes them in five minutes, before anyone reviews the code. On a device that retried `load` every minute, that leak would have crashed it after weeks in the field.

A minimal pipeline looks like this, in GitHub Actions style:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container: ghcr.io/acme/fw-toolchain:1.4
    steps:
      - uses: actions/checkout@v4
      - run: cmake -B build -DCMAKE_BUILD_TYPE=Release
      - run: cmake --build build
      - run: cppcheck --enable=warning --error-exitcode=1 src
      - run: ctest --test-dir build-host --output-on-failure
```

## Common Questions

**Which tool should I start with?** Compiler warnings, then `cppcheck` or `clang-tidy`. Both are free.

**What is the difference between CI and CD?** CI builds and tests each change. CD delivers the results automatically.

**Do small teams need this?** Yes. A simple pipeline saves more time when a team is small.

**How do I handle old code with many warnings?** Accept a baseline, then require that new code adds none.

## Under the Hood

Compiler warnings are the cheapest analysis. `-Wall -Wextra -Wconversion` catch a lot, and `gcc -fanalyzer` adds path checks. Tools such as `clang-tidy` and the Clang Static Analyzer follow possible paths through a function, tracking values along the way. More expensive tools such as Coverity or CodeQL analyse across the whole program.

No tool can be perfect: analysis of all program behaviour is impossible in general, so tools balance missed bugs against false alarms.

Sanitizers instrument code at compile time. ASan finds out-of-bounds access, UBSan finds undefined behaviour, and TSan finds data races. They need a host build or Linux target, since they use too much memory for MCUs.

Reproducible builds pin toolchains in containers, so the same commit gives the same binary.

## Real-World Applications

**Linux kernel.** Coccinelle and sparse check code, and bots test each patch.

**Automotive.** Tools support MISRA compliance evidence.

**Security.** CodeQL finds vulnerable patterns across large code.

**Releases.** CI signs and stores every firmware image.

## Common Mistakes

### Mistake 1: Warnings allowed

**What goes wrong:** Hundreds of warnings hide the one that matters.

**How to avoid it:** Use `-Werror`, with a clean baseline.

### Mistake 2: Slow pipelines

**What goes wrong:** People stop waiting for results.

**How to avoid it:** Keep the per-commit path fast, and move long tests to nightly runs.

### Mistake 3: Green builds with no hardware

**What goes wrong:** Everything passes, and the image does not boot.

**How to avoid it:** Add a smoke test on a real board.

## Debugging and Troubleshooting

**Symptom:** The pipeline fails, but the build works locally

**Possible Cause:** Different toolchain, or a file not committed.

**Investigation Method:** Run the same container on your machine.

**Resolution:** Develop in the container, and declare all dependencies.

**Symptom:** Analyser reports many false positives

**Possible Cause:** It cannot see macros or vendor headers.

**Investigation Method:** Check the compile database and include paths.

**Resolution:** Provide `compile_commands.json`, and suppress per line with a reason.

## Design Considerations and Best Practices

**Start with what you have.** Turning on compiler warnings is free.

**Only fail on new issues.** A baseline makes legacy code manageable.

**Store build info.** Embed commit and version in each image.

**Keep humans reviewing.** Tools catch patterns, while people catch design errors.

## Expert Notes

**Make the fast path very fast.** If feedback takes under ten minutes, people use it. If it takes an hour, they stop looking.

**Fail on the first problem you can act on.** A long report nobody reads changes nothing.

**Sign and store release artifacts.** A build you cannot trace to a commit is impossible to debug later.

## Summary

Static analysis reads code to find likely bugs, and CI runs those checks and all tests on every change, in a clean environment. Together they catch errors minutes after writing, when they are cheap to fix. Treat warnings as errors, keep pipelines fast, pin your toolchain, and add at least one test on real hardware.

## Related Topics

**Prerequisites**

- C Pitfalls in Embedded
- Cross-Compilation and Toolchains

**Next Topics**

- MISRA C
- Hardware-in-the-Loop Testing
