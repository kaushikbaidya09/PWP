---
title: "MISRA C: Why the Rules Exist"
brief: "What MISRA C is, why safety-related firmware uses it, how to read the rules, and how to apply it without making code worse."
order: 59
phase: 10
tags: ["MISRA C", "Coding Standards", "Safety", "CWE"]
---

Many engineers first meet MISRA C as a long list of complaints from a tool. "No goto." "No dynamic memory." It can feel like bureaucracy. Each rule, however, exists because some C feature has caused real failures. Once you know why they are there, the rules make more sense, and you can apply them with judgment.

## The Fundamental Problem

C has many behaviours that are undefined or vary between compilers, and bugs in cars or medical devices can hurt people. Teams need a way to write C that avoids the dangerous parts, in a form that tools can check automatically. Relying on every engineer remembering every trap does not work.

## The Big Picture

![Code is checked against rules by a tool, and exceptions are recorded as deviations](/diagrams/misra_flow.svg)

### In Plain Terms

Think of the rules of the road. Keeping to one side is not about personal skill: a clear shared rule removes a whole class of accidents, for everyone. You may be an excellent driver, but the rule protects you from assumptions.

MISRA is road rules for C. It restricts legal but risky habits, so reviewers and tools can trust the code. Like road rules, it also allows exceptions, such as an ambulance through a red light, as long as they are justified and recorded.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **MISRA C** | Guidelines for using C in critical systems. |
| **Mandatory** | Must always be followed. |
| **Required** | Must be followed, unless there is a formal deviation. |
| **Advisory** | Recommended good practice. |
| **Directive** | Broader guidance not fully checkable by tools. |
| **Deviation** | A recorded, justified exception. |
| **CWE** | A catalogue of common software weaknesses. |

## How It Works

### Step 1: Choose the scope

Decide the version, such as MISRA C:2012 or later, and which code it applies to.

### Step 2: Configure a tool

Run a checker such as Cppcheck's addon, PC-lint, or Polyspace in the build.

### Step 3: Handle findings

Fix the code when you can. Each finding is a question: is this safe?

### Step 4: Record deviations

If a rule cannot be met, document why it is safe here.

### Step 5: Keep a compliance record

The record shows which rules are met and where deviations are.

## A Closer Look: How to Read a Rule

A MISRA rule can seem arbitrary until you ask what it is protecting you from. Take one example: do not rely on the order of side effects.

```c
a[i] = i++;         /* which i is used for the index? */
```

The C standard does not say which happens first, so two compilers could produce different results, and both would be correct. The code might pass every test on one compiler and fail on the next version.

MISRA does not say this code is always wrong. It says this code depends on something the language does not promise, and that is too risky when lives depend on it. Split it into two statements and the question disappears.

Almost every rule follows this pattern: it removes a place where a human reader and the compiler might disagree. When you meet a rule that seems pointless, look up its rationale. Knowing the failure it prevents tells you whether you are fixing a real risk, and what a good fix looks like.

## A Worked Example: Rules and Their Reasons

**Assignments in conditions are banned.**

```c
if (x = 5) { ... }    /* typo for == and always true */
```

**Every switch needs a default, and each case a break.** A missing `break` falls through silently, and a new enum value might be ignored.

**No dynamic allocation after start-up.** In a car ECU running for years, `malloc` can fragment memory and fail. The rule pushes you to static buffers with known sizes:

```c
static uint8_t rx_buf[RX_SIZE];   /* size known at compile time */
```

**Explicit conversions.** A rule on essential types catches this:

```c
uint32_t total = a16 * b16;   /* may overflow before widening */
uint32_t ok = (uint32_t)a16 * b16;
```

**Single exit is advisory.** This shows how judgment works: some teams find that early returns are clearer, and record that decision.

## Common Questions

**Do I have to follow it for non-safety projects?** No, but its ideas are still useful. Many teams adopt a subset.

**Is MISRA free?** The rules are sold as a document at a small cost. Some checkers are open source.

**Does it apply to C++?** There is a separate guideline, MISRA C++.

**Does it make code secure?** It helps, but CERT C and CWE focus on that goal directly.

## Under the Hood

MISRA C:2012 has many guidelines grouped by topic. Later versions added concurrency and security-related items, along with updates for newer C standards.

Tools parse code like a compiler, then check its structure. Some rules are decidable from a single file, while others need the whole program. Some are undecidable in general, so tools report possible problems, and humans must review them.

MISRA is not a security standard. CERT C and CWE address that, though they overlap. Compliance also does not prove correctness: code can follow every rule and still have the wrong logic.

## Real-World Applications

**Automotive.** ISO 26262 projects widely use MISRA C.

**Medical.** Device software teams use it to support their safety case.

**Aerospace.** Similar restrictions appear in avionics coding standards.

**Industrial.** IEC 61508 projects often adopt it.

## Common Mistakes

### Mistake 1: Adding casts to silence warnings

**What goes wrong:** The tool goes quiet, but the risky conversion stays, and is now hidden.

**How to avoid it:** Fix the types. Use casts deliberately.

### Mistake 2: Applying it late

**What goes wrong:** Thousands of findings appear at the end, and rushed fixes add bugs.

**How to avoid it:** Run the checker from day one.

### Mistake 3: Blanket suppressions

**What goes wrong:** Real issues are hidden with the noise.

**How to avoid it:** Suppress per line, with a reason.

## Debugging and Troubleshooting

**Symptom:** Thousands of findings from legacy code

**Possible Cause:** Checking everything at once, including vendor files.

**Investigation Method:** Group findings by rule and by folder.

**Resolution:** Set a baseline, exclude third-party code, and block only new violations.

**Symptom:** Different tools disagree

**Possible Cause:** Different rule interpretation or configuration.

**Investigation Method:** Read the rule and its rationale.

**Resolution:** Agree a team decision, and record it.

## Design Considerations and Best Practices

**Teach the reasons.** Rules followed without understanding produce ugly code.

**Run checks in CI.** Fast feedback costs far less than a final audit.

**Keep a small deviation list.** Each needs a reason and a reviewer.

**Combine with testing.** Style rules do not replace tests.

## Expert Notes

**Deviation is not failure.** A well-reasoned deviation shows mature engineering. A forced fix that hides a problem is worse.

**Vendor code rarely complies.** Isolate it behind your own interface, and record it as outside the scope.

**Readability counts.** If a rule makes code clearly harder to read, raise it with the team, rather than quietly working around it.

## Summary

MISRA C is a set of rules that steers code away from the dangerous parts of C, like road rules for firmware. Each rule exists because of a real class of bugs. Use a tool from the start, fix causes rather than silencing warnings, and record justified exceptions. Compliance supports safety, but it does not replace good design or testing.

## Related Topics

**Prerequisites**

- C Pitfalls in Embedded

**Next Topics**

- Static Analysis and CI
- Unit Testing Firmware
