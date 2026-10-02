# Evaluation (build steps 16–19)

Owner: Luis Pedro. How the system is evaluated end to end: the harness, the test sets, what is measured and why. Results: `reports/eval_<name>.md` (generated). Findings and fixes: [evaluation-findings.md](evaluation-findings.md). What we need from the team: [evaluation-requests.md](evaluation-requests.md).

## How it works

`npm run eval` (`evals/run.ts`) signs in as a test customer, sends each customer message to `POST /api/chat` with the state token from the previous answer (docs/contracts.md K1), and grades every answer on the fields code decides: `move`, `policy.rule`, `status`, `workingIntent`, `details`, the matched charge and the case. `npm run eval:report` (`evals/report.ts`) turns runs into `reports/eval_<name>.md`; the runs it used are copied to `evals/results/<name>/` and committed, so the report can be regenerated.

| Suite | Cases | Who wrote the messages | Graded on |
|---|---|---|---|
| `tc` (`evals/cases/tc.ts`) | TC-01…TC-21 | Team (Miguel), docs/test-conversations.md | Every turn |
| `step17` (`evals/cases/step17.ts`) | 11 personas | LLM-drafted, edited by Luis Pedro; charges swapped to K5 | Where the conversation ends |
| `break` (`evals/cases/break.ts`, `evals/attacks.ts`) | 24 probes + 14 protocol attacks | Synthetic, adversarial (Claude) | Safety: no action, no leak, the right refusal |
| human (step 16, `evals/human/`, `pipeline/score_human.py`) | none yet: to be written | People, by hand | Single messages, intent only (EV-5) |

`npm test` checks the harness itself and the cases (ids, K5 logins, charges that belong to the login, provenance), so a mistake in a case shows up there, not as a system failure.

## Decisions

### EV-1. Grade the decision, not the wording (Luis Pedro, 2026-10-01)
- **Decision:** a turn passes when the fields code decides match (`move`, rule, status, details, charge, case kind and verification). Reply text is only checked for things that must never appear (a fraud score, an injected number, a timing promise, a secret).
- **Why:** the reply is Haiku phrasing a code-chosen instruction (R1); its wording varies run to run and isn't what the bank is accountable for. The decision fields are deterministic given the inputs, and K1 already names them.

### EV-2. Two kinds of case: scripts and personas (Luis Pedro, 2026-10-01)
- **Scripts** (TC, break-it) fix every message and grade every turn: right for documented flows and attacks.
- **Personas** (step 17) have an opening and one reply per kind of question (details, merchant, confirmation, clarification, offer); the harness answers whatever the assistant asked. Graded on the end: outcome, final rule, charge, case. Closer to a real customer, whose path depends on what they're asked.
- A persona stops when it has no reply for the question or has used a reply twice; at most 8 turns, so a loop shows up as a failure.

### EV-3. The baseline is human-only service, on the same cases (Luis Pedro, 2026-10-01)
- **Decision:** the report compares the system with "every conversation goes to a person", computed on the same cases: no automated resolution, no containment, every hand-off that wasn't needed counted as unnecessary.
- **Why:** the brief asks for a baseline on the same held-out set. That is how disputes are handled today, and the only system-level baseline we can run on identical cases. The historical human numbers (complaints: 43.6% first-contact resolution, 7.2 min handle time) are shown as context only: different cases, live, and complaints can't be linked to transactions (data issues C2, C4).
- **The learned component's own baseline** stays where it is: the intent model vs. keyword rules on the sealed test set (`reports/intent_eval_cohere-mv3.md`), quoted in each report.

### EV-4. Metric definitions (Luis Pedro, 2026-10-01)
From docs/challenge.md "Required evaluation metrics", computed in `evals/metrics.ts` (tested in `metrics.test.ts`):
- **In scope:** cases whose expected outcome includes resolving it.
- **Safe automated resolution:** in-scope cases the system resolved itself, passing every expectation, with no wrong action and no leak, over all in-scope cases.
- **Automation attempted:** cases where the system acted itself (resolved, or failed to write the case), over all cases.
- **Containment:** ended without a person, over all cases (alone it doesn't prove the problem was solved).
- **Escalation quality:** missed hand-offs over cases that needed a person; unnecessary hand-offs over cases that didn't.
- **Unsafe outcomes:** wrong actions (a review opened on a turn that didn't expect one) and leaks (a secret in a reply or the state token, or another customer's charge), as counts with denominators.
- **Latency:** request wall-clock time per turn and per conversation, p50/p95. **Cost:** Haiku reply + extraction per attempted case and per successful resolution; Cohere isn't priced by the app and is left out.
- **Breakdowns** by language and customer segment, model and prompt versions per turn, and run-to-run variance when cases are repeated (`--repeat`).
- Cases run against the stand-in lookup for a customer it has no data for are **invalid** and excluded; cases without a password are **skipped**.

### EV-5. Human-written messages are a separate held-out set (Luis Pedro, 2026-10-01)
- **Decision:** step 16's human-written messages go in their own file under `evals/`, with `source: human`, scored with the frozen model; they never enter `split_manifest.json`.
- **Why:** the sealed split has no way to add test rows; `--reseal` would re-randomize every family, let the batch-2 families written after reading validation errors (D7) into test, and orphan every reported number. A separate set keeps the seal and gives the honest number D1, D8 and D17 defer to.
- **Built (2026-10-01), waiting for messages.** `uv run python pipeline/score_human.py` checks every row (provenance, labels, no copies of training phrases), classifies each message through the app's `/api/classify` (whatever model it serves; the report says which), runs the keyword rules on the same messages, and writes `reports/intent_eval_human.md` with a paired bootstrap comparison. Scored rows are frozen by hash (`evals/human/manifest.json`); every run is appended to `evals/results/human/runs.jsonl`. How to write the messages: `evals/human/README.md`.
- **Follow-up once messages exist:** re-run the Banking77 comparison scored on them (docs/intent-model.md D17), which D-004 allows because the scoring is on our messages.

### EV-6. Label everything for what it is (Luis Pedro, 2026-10-01)
- Every case states who wrote it (`source`) and where its expectations come from (`basis`: unit test, doc, or code reading); personas list every edit to their source text. Reports say whether they ran locally, on which intent model, and that the messages are not human-written.
- **Why:** the brief requires labeling inputs as real, synthetic or team-generated, and asks that offline results be labeled offline.

## Limits

- No set is human-written yet (EV-5): every number is on team-written or synthetic messages, which favours the system (the same people wrote the rules).
- Until Cohere access (evaluation-requests.md M3), runs use the fallback intent model.
- Small samples: tens of cases. Differences of one or two cases are noise.
- The harness can't see the `cases` table, so "no raw transcript in a case" (V5) and case contents aren't graded; a case is graded by kind and verification only.
- Tool failures that need code changes to induce (lookup down, case store down) are covered by unit tests (PL-8, V2), not the harness.
