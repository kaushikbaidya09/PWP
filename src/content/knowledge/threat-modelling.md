---
title: "Threat Modelling: Finding Weaknesses Before Attackers Do"
brief: "A practical way to list what you are protecting, who might attack it and how, using STRIDE to choose security work that matters."
order: 39
phase: 7
tags: ["Threat Model", "STRIDE", "Attack Surface", "Risk"]
---

Security work has no natural end. You could always add another check, another layer, another test. Without a method, teams protect what feels important and miss the door left open. Threat modelling is a simple structured conversation that shows where the real risks are, before the design is fixed.

## The Fundamental Problem

Security flaws found after release are expensive, sometimes needing a recall. Yet nobody can defend against everything. Engineers need a way to decide which risks matter for this product and which can be accepted. "Make it secure" is not a requirement anyone can test.

## The Big Picture

The process asks four plain questions, in order.

![What are we building, what can go wrong, what will we do, and did it work](/diagrams/threat_model.svg)

### In Plain Terms

Imagine securing your home. You do not begin by buying random locks. You walk around and ask: what is valuable here, who might want it, and how could they get in? You may notice that the front door has a great lock, while the back window is open.

Threat modelling is that walk around, done on a diagram of your system. It costs a few hours with a whiteboard, and it usually finds problems that no amount of code review would find.

## Key Concepts and Terminology

| Term | What it means |
| --- | --- |
| **Asset** | Something worth protecting: keys, firmware, data, safety functions. |
| **Threat** | Something that could go wrong. |
| **Vulnerability** | A weakness that lets a threat happen. |
| **Attack surface** | Every point where an attacker can touch the system. |
| **Trust boundary** | A line where data moves between different levels of trust. |
| **STRIDE** | A checklist of six threat types. |
| **Mitigation** | A change that reduces a risk. |

## How It Works

### Step 1: Draw the system

Sketch the components and data flows. Mark trust boundaries, such as device to cloud, or application to kernel.

### Step 2: List assets and attackers

Name what matters and who might go after it: a remote hacker, a curious owner, or a competitor with lab equipment.

### Step 3: Apply STRIDE at each boundary

Ask about each type of threat at every crossing.

| Letter | Threat | Goal it attacks |
| --- | --- | --- |
| S | Spoofing | Authenticity |
| T | Tampering | Integrity |
| R | Repudiation | Accountability |
| I | Information disclosure | Confidentiality |
| D | Denial of service | Availability |
| E | Elevation of privilege | Authorisation |

### Step 4: Rate and decide

For each threat, estimate how likely it is and how bad it would be. Fix it, reduce it, transfer it or accept it, and write the decision down.

### Step 5: Check and repeat

Turn mitigations into tests. Revisit the model when the design changes.

## A Closer Look: Thinking at the Trust Boundary

The most useful idea in threat modelling is the trust boundary. It is simply a line on your diagram where data moves from a place you control into one you do not, or the other way.

The door of your home is a boundary. Inside, you relax. At the door, you check who is there. Software is similar. Data from your own function is usually safe. Data arriving over Wi-Fi might come from anyone, so it must be checked.

Bugs and attacks cluster at these lines, because that is where assumptions change. A parser reading a network packet sits on a boundary. So does a kernel driver handling a request from an application, and a bootloader reading an image from storage.

So you do not need to study every line of a system. Find the boundaries, and ask what could go wrong at each one. Could someone pretend to be the sender? Change the data? Read it? Flood it? This turns an overwhelming question, "is it secure?", into a short list of specific ones.

## A Worked Example: A Connected Thermostat

The diagram shows a phone app, a cloud service, the thermostat and a debug UART on the board.

At the **Wi-Fi link**: Spoofing means a fake server sends commands. Mitigation: TLS with certificate checks.

At the **update path**: Tampering means malicious firmware. Mitigation: signed images and secure boot.

At the **UART**: Elevation means root access from a header on the board. A thief with a screwdriver is not the main concern for a thermostat, but one extracted Wi-Fi password is the owner's own loss. The team disables the shell and accepts the remaining risk.

At the **cloud API**: Denial of service means many devices going offline. Mitigation: local control continues to work if the cloud is down.

Notice the last one is a design choice, not a cryptographic one. Threat modelling often leads there.

## Common Questions

**Do I need special tools?** No. A whiteboard and a table are enough to start.

**How long should it take?** A few hours for a small product, and short updates afterwards.

**What is the difference between a threat and a vulnerability?** A threat is what could happen, such as someone forging a command. A vulnerability is the specific weakness that allows it, such as a missing signature check.

**Who should attend?** Anyone who knows the system, including people from hardware, firmware, cloud and support.

## Under the Hood

Teams often score risk with CVSS or simple high, medium and low ratings. Precision matters less than consistency. In automotive, ISO/SAE 21434 requires threat analysis and risk assessment, called TARA, and the EU Cyber Resilience Act pushes in the same direction for connected products.

Attack trees are a useful companion. Start with the attacker's goal at the top, then branch out into every way of reaching it. The cheapest branch shows where effort should go first.

## Real-World Applications

**Automotive.** ISO/SAE 21434 makes TARA a formal part of vehicle development.

**Medical.** Regulators expect a threat model in premarket submissions for connected devices.

**Consumer IoT.** ETSI EN 303 645 sets baseline expectations such as no default passwords.

**Industrial.** IEC 62443 divides plants into zones and conduits, a similar way to think about boundaries.

## Common Mistakes

### Mistake 1: Doing it once at the end

**What goes wrong:** Findings arrive when the hardware is fixed and nothing can change.

**How to avoid it:** Start during architecture, and revisit it at each major change.

### Mistake 2: Only thinking about remote hackers

**What goes wrong:** The team ignores physical access, factory staff and supply chains.

**How to avoid it:** List every realistic attacker, including insiders.

### Mistake 3: Writing a report nobody uses

**What goes wrong:** The model sits in a folder, disconnected from the work.

**How to avoid it:** Turn each mitigation into a ticket with a test.

## Debugging and Troubleshooting

**Symptom:** The session produces a long, unranked list

**Possible Cause:** No agreed scale, or the scope is too broad.

**Investigation Method:** Check whether each item names an asset and an attacker.

**Resolution:** Rate quickly, then fix only the top items first.

**Symptom:** A penetration test finds issues the model missed

**Possible Cause:** A data flow was missing from the diagram.

**Investigation Method:** Compare the diagram with the actual design.

**Resolution:** Update the diagram, and feed each finding back into the model.

## Design Considerations and Best Practices

**Keep it light.** A short session done regularly beats a long one never repeated.

**Include different people.** Firmware, hardware, cloud and support staff each see different risks.

**Record accepted risks.** A deliberate decision protects the team and informs future changes.

**Reuse earlier models.** Most products in a family share the same threats.

## Expert Notes

**Start from the attacker's motive.** People attack for money, data or access. Asking "what would be worth stealing here?" focuses the discussion quickly.

**Beware of assumptions like "nobody would do that".** Write the assumption down instead. If it later turns out to be false, you know what to revisit.

**The fleet is the real target.** One compromised device is an incident. A flaw that scales across all devices is a crisis, so rate those threats higher.

## Summary

Threat modelling is a planned walk around your own system, asking what is valuable, how it could be attacked and what to do about it. Draw the system, use STRIDE at each trust boundary, rank the risks and record decisions. It is cheap, it finds design problems early, and it directs security effort where it counts.

## Related Topics

**Prerequisites**

- Security Goals
- Embedded Security Fundamentals

**Next Topics**

- Side-Channel and Fault Attacks
- Device Provisioning
