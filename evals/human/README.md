# Human-written test messages (build step 16)

The honest test of the intent model. Every other test set in this repo was written by the people (or the LLM) who wrote the rules and the training phrases, so its scores are an upper bound (docs/intent-model.md D1, D8). These messages are written **by people, by hand**, and are scored once, unseen ([docs/evaluation.md](../../docs/evaluation.md) EV-5).

## Who writes them

Anyone except an LLM: team members, friends, family. **Don't look at `data/phrases/` or the test conversations first**: write the way you'd message your bank. A native Brazilian-Portuguese writer is the most valuable contributor (the Portuguese training phrases were never reviewed by one).

## What to write

One message per row in `messages.csv`, exactly as a customer would type it in a bank chat, the first message of a conversation. Spanish or Portuguese; any style: formal, casual, short, typos, slang, emoji.

Aim for **60+ messages**: about half Spanish and half Portuguese, every label below, and **about 1 in 5 genuinely ambiguous**. Over-represent what the model card says is weakest: ATM cash the customer didn't withdraw, and very short messages of two or three words. Write your own words: an exact copy of a training phrase is rejected.

The labels, as defined in [data/phrases/LABELING_GUIDE.md](../../data/phrases/LABELING_GUIDE.md) (authoritative, with its tie-break rules):

| Label | The customer… |
|---|---|
| `unrecognized_charge` | sees a charge, withdrawal or transfer they didn't make or don't recognize at all (unknown merchant, possible fraud, cloned or lost card) |
| `wrongful_fee` | recognizes the charge or the bank fee but says it's wrong: duplicated, wrong amount, a fee that shouldn't apply, charged after cancelling |
| `transaction_status` | asks what happened to a specific transaction or an existing claim: declined, pending, not arrived, refund timing, "how is my claim going?" |
| `balance_check` | asks for balances, amounts owed, limits or recent movements, with no problem attached |
| `move_money` | asks the assistant to move money itself: refund, reverse, transfer, pay, credit compensation |
| `human_agent` | asks for a person: advisor, supervisor, call, phone number, escalation |
| `out_of_scope` | anything else: other products (loans, insurance, card blocking), app access, branch info, greetings, thanks |

If two labels are equally right, mark the row `ambiguous=true` and put the second one in `alt_label`.

## Columns

| Column | Value |
|---|---|
| `id` | `H` + a number, never reused: `H001`, `H002`, … |
| `lang` | `es` or `pt` |
| `label` | one of the seven labels |
| `ambiguous` | `true` or `false` |
| `alt_label` | the other plausible label when ambiguous, empty otherwise |
| `author` | initials (who wrote it) |
| `written_on` | `YYYY-MM-DD` |
| `source` | always `human` |
| `text` | the message (quote it if it has commas; at most 500 characters) |

## Rules

- **Label after writing**, and have a **second person check every label** (label quality is part of the evaluation). Disagree? Discuss, or mark it ambiguous.
- **No real personal data:** no real card numbers, IDs, names or phones. Invented ones are fine.
- **Frozen once scored.** The scorer keeps a hash per id in `manifest.json` and refuses edits to scored rows: a fix is a new row with a new id. Never edit a message, or its label, after seeing what the model said: that's tuning on the test set.
- **Never use these messages for training or threshold tuning.** They don't go into `data/phrases/` or `split_manifest.json`.

## Scoring

```bash
npm run dev                                       # the app the model is served from
uv run python pipeline/score_human.py             # → reports/intent_eval_human.md
uv run python pipeline/score_human.py --from evals/results/human/predictions.json   # re-score without the app
```

The scorer checks every row, rejects exact copies of training phrases, classifies each message through the app's `/api/classify` (Cohere in production, the e5-small fallback without Bedrock: the report says which) and runs the keyword-rules baseline on the same messages.
