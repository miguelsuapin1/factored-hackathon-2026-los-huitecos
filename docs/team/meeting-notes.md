# Kickoff meeting notes (2026-09-25)

**Key idea:** don't build a chatbot — build a **customer-service system**.

## Pick one use case
1. Account / Payment Inquiries
2. Card Support
3. Transaction Disputes
4. Credit-Product Info & Eligibility

**Context:** Latin American banking problem → bilingual **Spanish + Portuguese**.
It should understand the customer, use the right tools, take the appropriate actions — a small, intelligent banking service that could go to production.

## Minimum requirements
- Escalate when necessary
- Maintain conversational context
- Clarify ambiguous requests
- Retrieve trusted information
- Use tools securely
- Execute appropriate workflows
- Verify that actions actually happened
- Know when **NOT** to act
- Hand off to a human when needed — a **structured handoff** that transfers verified facts and open questions, *not* the raw transcript: what has been done, what is still unsolved?

## Prove it works (demo)
1. Establish a baseline
2. Build the proposed system
3. Evaluate against the baseline

## Technical rigor
- Data quality contracts
- Reproducible preparation
- Valid labels
- Leakage prevention — strict train/eval set isolation

## Six focus topics
1. Data-backed baseline
2. Grounded AI core
3. Controlled automation
4. Data & ML discipline
5. Measured failures
6. Route to operation (deterministic setups)

## Disciplines (none mandatory — pick the strongest, leave none weak)
- **AI:** production backend, structured JSON handoffs
- **ML:** LLM/RAG orchestration, prompt-injection defenses
- **Data engineering:** strong ETL/ELT pipeline, customer-record isolation
- **Data analysis:** identify patterns

## Make it a real service
Judges want to see we care about **observability, reliability, security, reproducibility**.
Be creative — avoid the typical solution/presentation. Replicable results.
Leave notes and be honest about what's missing.

**Final takeaway:** build something that works, prove that it works, and make sure it knows when NOT to act.

## Platform note
Organizers recommend Snowflake, AWS, Azure or Databricks. We don't have access yet, so we start on Supabase + Vercel and will evaluate switching later (see `decisions.md`).
