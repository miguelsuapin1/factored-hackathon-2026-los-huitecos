# Requests from the evaluation track (steps 16–19)

What the evidence track (Luis Pedro) needs from Miguel and Carlos, and what it found that needs a fix. Each item says what to do, why, and how we'll know it's done. Details and evidence: [evaluation-findings.md](evaluation-findings.md). Tick an item by editing this file in your PR, with `(Name, YYYY-MM-DD)`.

Opened 2026-10-01 (Luis Pedro).

## For everyone

| # | Request | Why | Done when | Priority |
|---|---|---|---|---|
| T1 | **Write human test messages** (step 16): each of us, plus friends or family, writes customer messages by hand in `evals/human/messages.csv`, following `evals/human/README.md`, without looking at `data/phrases/` first. A second person checks each label. A native Brazilian-Portuguese writer is the most valuable. | Every number so far comes from text written by us or an LLM; the judges' honest number is this one (docs/intent-model.md D1, D8). | 60+ messages, about half ES and half PT, every label, about 1 in 5 ambiguous; `uv run python pipeline/score_human.py` writes `reports/intent_eval_human.md`. | **High** |

## For Miguel

| # | Request | Why | Done when | Priority |
|---|---|---|---|---|
| M1 | **Fix EF-1:** when 3+ charges match and the customer gave no date (and didn't say they don't remember), ask for the date before handing off. Today a merchant that can't narrow the charges, even one that matched nothing ("Netflix"), sends the customer to a person on the first message. | 4/4 live runs of TC-02, plus persona TC17-27; customers who would be served in one more turn are handed off, and the agent gets a case about a charge that doesn't exist. Root cause at `resolve.ts:113` + `decide.ts` `decideOnLookup`. | The reproduction test in EF-1 passes; `npm run eval -- --case TC-02` and `-- --suite step17 --case TC17-27` pass; `npm test` green. | **High** |
| M2 | **Fix EF-4:** mask PINs, passwords and CVVs written *before* their label ("4821 es mi pin", "4821 é minha senha", "987 es el cvv"). | They reach Cohere, Haiku and the client-readable state token unmasked, and the customer gets no warning. Deterministic. | The six rows in EF-4 are masked, "350 es el monto" is not, `npm test` green, `npm run eval -- --suite break --case PR-2` passes. | **High** |
| M3 | **Cohere for evaluation:** share the `bedrock` AWS profile (IAM user `latam-bank-bedrock`, embeddings only) with Luis Pedro, out of band, or say we should evaluate against a Vercel preview instead. | Every number so far is on the e5-small fallback (`fallbackReason: "bedrock auth"`), not the production model; EF-2, PI-4 and PI-5 can't be judged without it. Mind the 20 requests/min quota: the harness paces at 15 turns/min. | `npm run eval` shows `model: cohere-mv3` in its turn records. | **High** |
| M8 | **Let the harness through preview protection:** Vercel → Project Settings → Deployment Protection → **Protection Bypass for Automation** → create a secret, and share it with Luis Pedro out of band (it goes in `.env.local` as `VERCEL_AUTOMATION_BYPASS_SECRET`; the harness and `score_human.py` send it as `x-vercel-protection-bypass`). Checked 2026-10-01: previews answer `vercel_auth_enabled: true`, so nothing reaches the app. | Previews run Cohere with no AWS keys on anyone's laptop: the fastest way to production-model numbers (an alternative to M3). The production URL isn't protected, but running the harness there writes test cases into production's case data and spends the live Cohere quota, so we won't do it without your OK. | `npm run eval -- --base <preview URL>` runs and its turn records show `model: cohere-mv3`. | **High** |
| M4 | **Review and merge** the stacked branches, in order (each builds on the previous): `lpcuellar/demo-customers` (K5) → `lpcuellar/eval-harness` (harness, TC and step-17 cases, findings) → `lpcuellar/step-19-break-it` (break-it suite, this file) → `lpcuellar/step-18-report` (report generator, first report) → `lpcuellar/step-16-human` (human-message scorer) → `lpcuellar/cost-sensitivity` (threshold vs. cost weights). PRs #16–#21; merging the last one brings all six. | `package.json` gains `npm run eval` and `npm test` now also runs `evals/` (151 tests); `evals/` is type-checked with the app, so `next build` covers it; `.gitignore` gains `/evals/runs/`. No app code changes. | Merged with "Create a merge commit"; production still green. | Medium |
| M5 | **Decide EF-2** after the Cohere re-run (M3): status questions get "A or B?" when the runner-up label isn't a charge intent, and "ni idea" during that question drops the topic. | Measured on the fallback only; may not reproduce on Cohere. | Luis Pedro posts the Cohere result here; you decide fix or no fix. | Medium |
| M6 | **Update stale docs (EF-3)**, your files: TC-07 in `test-conversations.md` and the comment above `TRX-DEMO…0007` in `mock.ts` (now PL-10, not PL-2); TC-02/03/05/06 predate step 12 / C15; `contracts.md` K1 `resolvedBy` lacks `words` and the `move`/`pending` lists predate steps 12–14; `policy.md` "Proposal (not built)" was built as C15. | The step-18 report and judges read these docs. | The lines match the code. | Low |
| M7 | *Optional:* expose lookup and case-write timing in the `/api/chat` response (today only in the log line, K4), as a K1 change. | The step-18 latency breakdown can only use intent, extraction and reply times; Vercel logs aren't persisted. | `conversation.policy.lookup.ms` and `conversation.case.ms` in the response; `contracts.md` K1 updated. | Low |

**FYI.** Harness runs write real rows to `public.cases`, tagged `prompt_versions.environment = "local"`, as the smoke sweep does: 135 such rows on 2026-10-01 (63 hand-offs, 72 reviews). Filter on `environment` in the agent console; clean up only if you want to.

## For Carlos

| # | Request | Why | Done when | Priority |
|---|---|---|---|---|
| C1 | **Share the `SUPABASE_LOOKUP_DB_URL` line** from your `.env.local` (written by `pipeline/seed_test_users.py`) with Luis Pedro, out of band. **Please don't re-run the seed script for this:** it rotates the `lookup_reader` password and all 12 test logins, which would break the live app and the shared passwords. | Without it the app uses the stand-in lookup, which only has demo.mx's and otro.mx's charges, so every test on pendiente.ar and rechazado-sin-codigo.co finds nothing; the harness marks them invalid (BD-6, TC17-11/12/21/32). | `npm run eval -- --suite step17` shows no "invalid" lines. | **High** |
| C2 | **Keep K5 stable:** tell Luis Pedro before reloading the serving slice in a way that changes the five K5 customers' rows, or before rotating test passwords. | The expected outcomes in `evals/cases/` quote those exact charges ([contracts.md](contracts.md) K5). | Ongoing. | Medium |
| C3 | *Optional:* add test logins for two organizer customers with a clean high-risk charge: `CLI-I57AUINJWKZB` (MX Premium, 56.00 USD, Empresa Telefónica, 2026-05-25, fraud 73.09) and `CLI-HTX9ITCO0IMR` (CO, 49,618.78 COP, Tienda General, 2026-06-09, fraud 63.43). Both unique within ±1% and ±3 days (checked 2026-10-01). | PL-6 (high risk → a person) is only testable on demo.mx's synthetic charge; `fraude.co`'s only ≥30 charge is a merchant-less deposit. Adding logins only adds rows; it shouldn't need a rotation, but follow C1's warning. | Two new rows in `test-users.local.md`; K5 updated in `contracts.md`. | Low |

## Waiting on these (Luis Pedro)

| Unblocked by | Then |
|---|---|
| M3 or M8 (Cohere) | Re-run all suites on Cohere with `--repeat 3` (run-to-run variance is a required metric); settle EF-2, PI-4, PI-5; produce the step-18 numbers on the production model. |
| C1 (lookup URL) | Run the four invalid personas and BD-6 against the real data. |
| M1, M2 (fixes) | Re-run TC-02, TC17-27 and PR-2 and mark EF-1 / EF-4 fixed in the findings. |
| C3 (optional logins) | Add real-data PL-6 cases to K5 and the suites. |
| T1 (human messages) | Score them on Cohere, report the honest intent numbers vs. keyword rules, re-run the Banking77 comparison on them. |

## How to run the evaluation

```bash
npm run dev                                 # with .env.local; test-users.local.md for the non-demo logins
npm run eval                                # TC-01…TC-21
npm run eval -- --suite step17              # personas (step 17)
npm run eval -- --suite break               # break-it cases and protocol attacks (step 19)
npm run eval -- --case TC-02 --repeat 3     # one case, repeated
```

Results go to `evals/runs/` (git-ignored). Each run is paced at 15 turns/min (`--rate`) for the Cohere quota; don't run it while the live demo is being judged.
