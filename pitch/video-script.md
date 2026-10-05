# Video script: GT Bank Dispute Desk (English, about 3 minutes)

The voice-over is about 430 spoken words, read at about 145 words a minute. The waits between turns are cut in editing.

The demo uses four conversations from the evaluation suite. Each one passed 3 out of 3 runs against the deployed app with Cohere on 2026-10-04 (`reports/eval_production-cohere.md`):

- **TC-11** (normal dispute)
- **TC-07** (ambiguous charge)
- **TC-09** (asks for a person, Portuguese)
- **TC-04** (fraud-risk hand-off)

All four use the shared demo account. It signs in as `CLI-DEMO00000001`, the same customer as the `demo.mx` test login (`src/app/api/login/route.ts`, `docs/contracts.md` K5).

The app's API code hasn't changed since those runs; the only later merge was the visual rebrand. So the decisions on screen will match the tests: the move, the rule, which charge is matched, and the case written. The reply *wording* will not match. Claude Haiku phrases it fresh every time, so the narration never quotes it.

Every claim below was checked against the code, reports and live database on 2026-10-05. What changed from the Spanish draft, and why, is in [Fact-check](#fact-check-what-changed-from-the-spanish-draft).

## Before you record

1. **Account and data.**
   - Sign in at https://latam-bank-service-sigma.vercel.app with the shared demo account.
   - The app's clock is fixed at 2026-06-17, the last day of the organizer data (`src/lib/conversation/clock.ts`). "10 de junio" works whatever today's date is.
2. **Browser window.**
   - Use a desktop window at least 960 px wide, so the **Understanding** panel sits beside the chat.
   - Zoom until the panel's text is readable at 1080p. It is the on-screen proof of the narration: it shows "Masked before processing", the policy rule, and "written and read back".
3. **Toggles.**
   - Leave **Simulate AWS outage** off.
   - (**Use Jev** only appears on preview deployments.)
4. **Conversations.**
   - Click **New conversation** before every case. All four use the same customer.
   - Type or paste the messages **exactly** as written; they are the tested ones.
   - Masking is pattern-based. "mi pin es 4821" is caught. "mi PIN es el 1234" and the Portuguese "o PIN do cartão é 1234" are **not** (checked with `src/lib/privacy/mask.ts` on 2026-10-05). Don't improvise PIN phrasings on camera.
5. **TC-09 (Portuguese).**
   - In 1 of 3 production runs, the hand-off reply promised an agent "agora" (now). The code's speed check doesn't catch that word.
   - If your take says "agora", record it again. Otherwise the video shows the opposite of what the architecture section claims.
6. **Writes are real.** Every confirmed review or hand-off writes a real row to `public.cases`. That is expected.
7. **For the hand-off segment.** Note the case number (GT-…) that TC-04 shows. Then do one of these:
   - Open Supabase → Table Editor → `public.cases`, filter by that reference, and record 4 seconds of `verified_facts`, `checks_done` and `open_questions`.
   - If you can't open Supabase, use [handoff-case.png](handoff-case.png). It is the real row from the evaluation run. Say "here is the case from our test run", because its number won't match your take.
8. **Editing.**
   - Each reply takes about 3 seconds. Record straight through, then speed up the waits.
   - Add the English captions below; judges may not read Portuguese.

## Script

### 0:00–0:22 · The problem

**On screen:** the deck's cover, then the contact-reasons chart.

> In the organizers' data, complaints are 17% of contacts but 23% of agent hours, and fewer than half are solved on first contact. Four in ten formal complaints dispute a charge or a fee, something we can check against the records. So we built one workflow: dispute intake, in Spanish and Portuguese.

### 0:22–1:28 · Demo

**On screen:** the live app, signed in, with the Understanding panel in view.

**Case 1: normal resolution (Spanish, TC-11).**
Type `No reconozco un cargo de 350 dólares del 10 de junio en mi tarjeta 4111 1111 1111 1111, mi pin es 4821`, then `sí`.

> First, a normal dispute, in Spanish. The customer even types their card number and PIN; code masks both before any model sees them. It finds the charge in this customer's own records and asks to confirm. Only after the "yes" does it open a review, and the case number was written to the database and read back first.

**Case 2: ambiguous (Spanish, TC-07).**
New conversation. Type `Me cobraron 25 dólares el 11 de junio y no lo reconozco`. If time allows, also type `Fue en Tienda Don José` to show the pick.

> Second, an ambiguous one: two charges match. Instead of guessing, it lists both and lets the customer pick.

**Case 3: the customer asks for a person (Portuguese, TC-09).**
New conversation. Click the chip `Quero falar com um atendente`, then type `Cobraram duas vezes a minha fatura do cartão`.

> Third, in Portuguese: the customer asks for a person. It asks for one line of context, then hands off with a case number.

**Case 4: policy decides a person is needed (Spanish, TC-04).**
New conversation. Type `No reconozco un cargo de 120 dólares del 3 de junio`, then `sí`. Then cut to the case record: the Supabase row, or `handoff-case.png`.

> Last: nobody asked for a person, but this charge's fraud score is high, so after the "yes", policy hands it off, without telling the customer why. The specialist gets no transcript. They get this: the request, verified facts with their sources, the checks it ran, and open questions.

The Understanding panel shows "PL-6: high fraud score". That panel is our inspector, not part of what a customer would get. If you'd rather not explain that, crop it for this case.

### 1:28–2:13 · Architecture

**On screen:** [architecture-turn.png](architecture-turn.png), then [architecture-data.png](architecture-data.png) for the last ~6 seconds.

> Our core decision: the model classifies, code decides, and the LLM only reads and writes. A classifier we trained on Cohere embeddings reads the intent; when unsure, it asks. Claude Haiku pulls out the amount, date and merchant; code keeps only what the customer wrote. Eleven policy rules in code then choose: explain, ask, open a review, or hand off. Haiku words that choice; if it invents a number, code swaps in a template. No money ever moves. Underneath, raw data lands in BigQuery as-is, dbt builds silver and gold, and every row is kept or quarantined with a reason. Postgres row-level security lets each customer read only their own rows.

### 2:13–2:45 · Evidence

**On screen:** the deck's metrics slide. Check that the slide's wording matches the phrasings below; see the fact-check.

> On 24 clear messages a teammate wrote by hand, the classifier was right 83% of the time; keyword rules, 50%. The rules acted wrongly on half; the model on none, because when it's unsure, it asks. Then we ran 56 test conversations, three times each, against the live app, prompt-injection and cross-customer attacks included: zero wrong actions, zero leaks, a three-second median reply, and under a cent of LLM cost per successful resolution.

### 2:45–3:03 · Limits and close

**On screen:** the deck's cover, with the URL.

> These are offline results, on synthetic data and team-written tests. Our Portuguese still needs a native review, and ATM withdrawals are our weak spot. But when it's unsure, it asks; when it can't help, a person gets a verified case. GT Bank Dispute Desk.

**If you need to cut seconds:**

- Drop "Instead of guessing," in Case 2.
- Drop "something we can check against the records" in the problem.

**Optional swap:** "the specialists' console isn't built yet" for "ATM withdrawals are our weak spot". It is the more product-level limit, and the hand-off segment shows a database row, not a console.

## English captions for the demo

The reply captions are the gist of what the app answered in the production runs. The exact wording varies from run to run.

| Case | Customer (on screen) | Caption | System reply, caption |
|---|---|---|---|
| 1 | No reconozco un cargo de 350 dólares del 10 de junio en mi tarjeta 4111 1111 1111 1111, mi pin es 4821 | "I don't recognize a $350 charge from June 10 on my card 4111 1111 1111 1111, my PIN is 4821." | "Never share your PIN, CVV or passwords in a chat; we never ask for them. I found a 350 USD charge at Super Ahorro on June 10. Is this the one?" |
| 1 | sí | "Yes." | "Your dispute is registered with case number GT-…. Our disputes team will review it." |
| 2 | Me cobraron 25 dólares el 11 de junio y no lo reconozco | "I was charged $25 on June 11 and I don't recognize it." | "I found two 25 USD charges: Tienda Don José on June 11 and Super Ahorro on June 12. Which one don't you recognize?" |
| 2 | Fue en Tienda Don José | "It was at Tienda Don José." | "I found a 25 USD charge at Tienda Don José on June 11. Is this the one?" |
| 3 | Quero falar com um atendente | "I want to talk to an agent." | "Sure. Can you tell me in one line what it's about, so the agent has context?" |
| 3 | Cobraram duas vezes a minha fatura do cartão | "They charged my card bill twice." | "Got it: you were charged twice on your card bill. An agent will take it from here. Case number GT-…." |
| 4 | No reconozco un cargo de 120 dólares del 3 de junio | "I don't recognize a $120 charge from June 3." | "I found a 120 USD charge at Conciertos Live on June 3. Is this the one?" |
| 4 | sí | "Yes." | "A specialist will take your case with the details already confirmed. Your case number is GT-…." |

## Fact-check: what changed from the Spanish draft

Each change was checked against the repo on 2026-10-05.

| Spanish draft | Problem | Now | Evidence |
|---|---|---|---|
| "En el banco, las quejas son el 17 %… Por eso elegimos… disputas" | The numbers are right. But nothing in the call data links "Queja" calls to disputes, so "por eso" skips a step. | Adds the bridge: 4 in 10 formal complaints dispute a charge or a fee, and those can be checked against the records. | `reports/contact_reasons.md`; `docs/contact-reason-analysis.md` §2 and its "Honest caveat" |
| "Claude Haiku **solo** pone la respuesta en palabras" | False. Haiku also extracts the amount, date and merchant. Code keeps only what the customer wrote. Your own slide (box 3b) says so. | "Haiku pulls out the amount, date and merchant; code keeps only what the customer wrote… Haiku words that choice." | `src/lib/conversation/extract.ts` (`ground()`) |
| "el código rechaza cualquier número **o promesa de plazo**…" | The number check is solid: any digit the customer or the record didn't give → template. The speed check is a fixed phrase list. "agora", "mañana" and "pronto" pass, and TC-09 said "agora" in a production run. | Narration keeps only the number check. The slide says "stock promises of speed". | `src/lib/reply/checks.ts`, `compose.ts`; `evals/results/production-cohere/tc.json` (TC-09 run 1) |
| Hand-off: "la solicitud, los hechos verificados, las acciones tomadas y las preguntas abiertas" | The case table has no "actions taken" or "evidence" columns. It has the request, `verified_facts` (each with a source), `checks_done` and `open_questions`. TC-09's own case has `verified_facts: []`. | Shows TC-04's case (3 sourced facts, 5 checks, a fraud question) and says "the request, verified facts with their sources, the checks it ran, and open questions". | `supabase/migrations/20260930050000_cases.sql`; live rows GT-5EETTXDQ (TC-04) and GT-YYEWX89N (TC-09) |
| Only the customer-asks hand-off (TC-09) was shown | The brief's human-required case is about judgment. A customer asking for a person is routing; PL-6 is the system deciding. | TC-04 is now a main case. TC-09 stays, shorter, for Portuguese. | `docs/challenge.md` ("Must demo"); `src/lib/policy/decide.ts` |
| "pipeline bronze, silver y gold en BigQuery **con dbt**" | Bronze is loaded by a Python script; dbt builds silver and gold. | "raw data lands in BigQuery as-is, dbt builds silver and gold" | `pipeline/bigquery/bronze_bq.py` |
| "con mensajes escritos por personas… 83 % / 50 %… en la mitad de los casos" | One person wrote all 31 messages. The percentages are over the 24 clear ones. | "On 24 clear messages a teammate wrote by hand…" | `reports/intent_eval_human.md`; `evals/human/messages.csv` |
| "En **168 conversaciones** de prueba" | It is 56 distinct conversations run 3 times each. | "56 test conversations, three times each" | `reports/eval_production-cohere.md` (Repeats = 3; run-to-run table) |
| "incluidos… **sesiones vencidas**" | The expired-session attacks (S-4, S-5, C-4) were *skipped* on the deployed app, because they need the signing secret. They held only in local runs. They are also separate from the 168. | Mentions prompt injection and cross-customer attacks, which are in the 168. | `reports/eval_production-cohere.md` (protocol attacks); `reports/eval_local-fallback.md` |
| "menos de un centavo de dólar por **disputa resuelta**" | $0.0082 is LLM spend divided by 72 "successful resolutions": 39 reviews opened plus 33 status answers. These are completed intakes, not resolved disputes. Embeddings are excluded. | "under a cent of LLM cost per successful resolution" (the brief's metric name) | `reports/eval_production-cohere.md` (Latency and cost); `evals/metrics.ts` |
| Timings: 15 s for the close | The draft's close needed about 200 words a minute; the problem and evidence segments about 165. | Rebalanced to about 145 words a minute everywhere. | word counts |

Two things are true but are **not** worth claiming:

- **"100% safe automated resolution vs 0%".** The human-only baseline is 0% by construction.
- **Any comparison with the historical 43.6% first-contact resolution.** The report itself says those numbers are not like-for-like.

## Slides in this folder

[architecture-turn.png](architecture-turn.png) and [architecture-data.png](architecture-data.png) are the English versions of the two Spanish architecture slides, at the same 2000 × 1125 size.

Wording fixes, one-turn slide:

- **Mask:** the list was incomplete; it now also names passwords and IDs, and adds logs.
- **Details:** "code keeps only what the customer actually wrote".
- **Dialogue:** "No *review* opens without a yes". Hand-off cases are created without one.
- **PL-1:** "ask once, then a person".
- **PL-7:** "score under 30".
- **Hand-off callout:** now names the real fields.
- **Reply check:** "stock promises of speed".
- **Trace:** "time and cost per step".
- **Footer:** "The LLM never picks the action". Its extraction does steer which charge is searched.
- **Pills:** now carry denominators.

Wording fixes, data slide:

- **Row count:** 23.5M rows (~19M is the data dictionary's figure).
- **Data errors:** "no duplicates or late loads, but nulls, broken links, no MXN". The organizer's promised duplicates and late loads aren't in the data (`docs/data-issues.md` A1–A3).
- **Orphan keys:** "nulled and flagged", not quarantined.
- **Quarantine:** 0 organizer rows rejected; proven with fixtures.
- **Gold analytics:** "confirms the workflow choice". The evaluation baseline isn't computed from gold.
- **Serving:** "≈10 MB loaded; tested against a 100 MB budget".
- **data_version:** logs each load. It is not a freshness policy.
- **Footer:** dbt tests run "on every build"; there is no CI.

[handoff-case.png](handoff-case.png) is new. It shows the real TC-04 case row next to what the customer saw.

Sources and re-rendering: [slides/README.md](slides/README.md).
