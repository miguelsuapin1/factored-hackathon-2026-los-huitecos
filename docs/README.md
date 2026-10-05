# Documentation guide

Ordered by what the challenge assesses ([challenge.md](challenge.md), our summary of the official brief). Every decision entry names who made it and when.

| What the judges assess | Read |
|---|---|
| **1. Problem supported by data** | [contact-reason-analysis.md](contact-reason-analysis.md): why disputes · [data-issues.md](data-issues.md): every data problem found and how it is handled · [impact.md](impact.md): projected agent time saved and what it costs |
| **2. Functioning AI system** | [walkthrough.md](walkthrough.md): a guided tour of the system and its key decisions · [conversation.md](conversation.md): memory, extraction, confirmation (C1–C17) · [reply-generation.md](reply-generation.md): how replies are phrased and checked (R1–R7; R8–R9 in handoff.md and policy.md) |
| **3. Controlled automation** | [policy.md](policy.md): what may be answered, confirmed, refused or handed off (PL-1–PL-11) · [verification.md](verification.md): cases written and read back (V1–V5) · [handoff.md](handoff.md): structured hand-off and privacy (H1–H5) |
| **4. Data and ML practice** | [data-pipeline.md](data-pipeline.md): bronze → silver → gold → serving, with checks · [decisions.md](decisions.md): architecture decisions (D-001–D-006) · [intent-model.md](intent-model.md): the learned component vs. its baseline, splits, thresholds (D1–D18) |
| **5. Measured quality and failures** | [evaluation.md](evaluation.md): harness, test sets, metrics (EV-1–EV-6) · [evaluation-findings.md](evaluation-findings.md): what failed and how it was fixed · [test-conversations.md](test-conversations.md): the scripted scenarios |
| **6. Route to operation** | [contracts.md](contracts.md): the interfaces between components (chat API, lookup, hand-off, trace) · [lessons-learned.md](lessons-learned.md): what we tried, what broke, what replaced it |

Generated evidence lives in [../reports](../reports) (never hand-edited).
