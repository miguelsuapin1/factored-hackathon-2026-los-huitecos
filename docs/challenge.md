# Challenge brief (official, summarized)

Sources: *Factored AI & Data Hackathon 2026 — Problem Statement*, *Datathon 2026 Kickoff* (2026-09-25), *LATAM Bank Dataset Summary* and *Complete Data Dictionary* v1.0.0. The PDFs are kept outside the repo.

## Timeline & submission
- 10-day sprint, kicked off 2026-09-25.
- Submit to **hackathon.admin@factored.ai**:
  1. Public GitHub repo named **`factored-hackathon-2026-[team name]`**
  2. Link to the deployed tool
  3. 4–6 slide presentation
  4. Short **mandatory** video pitch: working demo + core architecture decisions
- "Submit your tool no matter what."
- Support: Slack community, `#technical-help` channel for mentors.
- Prizes: US$6,000 / 3,000 / 1,000. First place also gets an interview with Factored.

## The task
Build an AI-first banking **customer-service system** for **one** focused workflow: account/payment inquiries, card support, transaction-dispute intake, or credit-product info & eligibility. More workflows earn no bonus; depth and judgment do.
The flow is Understand → Decide → Act → Verify → Escalate. "AI should not be autonomous just because it can be."

Must demo: a **normal resolution**, an **ambiguous/unsupported request** (clarify or abstain), and a **human-required case** (structured handoff with request, verified facts, actions taken, evidence, open questions; no raw transcript). Interactions in **Spanish and Portuguese**. Report the limits of the data and of language coverage.

## What gets assessed
1. **Problem supported by data**: contact reasons, demand patterns, data quality, and operational constraints. These justify the workflow choice.
2. **Functioning AI system**: context, clarification, and answers grounded in permitted account/transaction/policy data. Report only verified actions.
3. **Controlled automation**: what can be answered, what needs confirmation, and when to abstain or transfer. **Permissions and policy are enforced outside model prose.**
4. **Data & ML practice**: repeatable prep with contracts, quality checks, lineage, and an update/freshness policy. **At least one learned component is evaluated against a baseline.** Valid labels, no leakage, and justified metrics/thresholds/splits.
5. **Measured quality & failures**: held-out eval including bad/missing data, expired sessions, unauthorized access, prompt injection, tool failures, and multilingual ambiguity.
6. **Route to operation**: tracing, bounded retries, safe fallback, reproducible setup, capacity limits, monitoring, access control, and data retention. Explanations come from sources, rules, and execution logs, not chain-of-thought.

Every team is scored on **data engineering and AI/ML rigor**. The judging areas are AI engineering (backend/frontend/deploy), data engineering (ETL), ML (model selection/tracking), data analytics (quality + insights), and docs/rationale.

## Boundaries
- Organizer-approved data only. Label each input as real, synthetic, or team-generated.
- Authenticate with a trusted test session or identity service. **A national ID or customer number alone is not proof of identity.** Enforce per-customer access in the service/tool layer.
- Credit workflows: keep conversation, risk estimate, and eligibility policy separate. The LLM never invents rules or approves credit. No real money movement.

## Required evaluation metrics (baseline vs. system on the same held-out set)
- **Safe automated resolution** rate (over all in-scope cases) and the share of cases where automation was attempted
- **Containment** (ended without transfer; this alone doesn't prove the problem was solved)
- **Escalation quality**: missed and unnecessary transfers
- **Unsafe outcomes**, as counts with denominators
- **p50/p95 latency and cost** per attempted case and per successful resolution
- Breakdowns by language and customer segment, with small-sample caveats. Report the number and mix of cases, label quality, model/prompt versions, and run-to-run variance. If an LLM judge is used, validate it against human labels. Label offline results as offline, not as production gains.

## Dataset (LATAM Bank v1.0.0, synthetic)
~19M rows, 13 tables, Mexico / Colombia / Argentina, 2023-06-17 → 2026-06-17, MXN/COP/ARS/USD.
Deliberate quality issues: ~2% duplicates, ~5% nulls, late-arriving partitions, schema evolution, and some orphan foreign keys.

| Table | Rows | Source | Partition |
|---|---|---|---|
| customers | 150K | Core Banking | monthly snapshot |
| products | 400K | Core Banking | monthly snapshot |
| branches | 350 | Internal | full snapshot |
| service_agents | 1.2K | Internal | monthly snapshot |
| marketing_campaigns | 200 | Internal | full snapshot |
| transactions | 5M | Core Banking | daily |
| call_center_interactions | 800K | Contact Center | daily |
| call_transcripts | 200K | Contact Center | daily |
| satisfaction_surveys | 250K | Contact Center | daily |
| digital_events | 10M | Digital Banking | daily |
| complaints (PQR) | 80K | PQR | daily |
| campaign_sends | 2M | Internal | daily |
| daily_exchange_rates | 3K | Reference | daily |

**All text is Spanish.** There is **no Portuguese** in the data, so Portuguese coverage comes from the team (team-generated phrases and test cases, labeled as such), and the README reports it as a limit.

**Data location:** the organizer's S3 bucket (read-only keys in the Data Dictionary); `scripts/download_data.sh` fetches it.
