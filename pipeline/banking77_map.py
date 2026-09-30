"""Map Banking77 categories to our 7 intents (training only, docs/decisions.md D-004).

The mapping is a labelling judgment by the team (Miguel with Claude, 2026-09-30), following
data/phrases/LABELING_GUIDE.md and its tie-break rules. A category our guide can't place cleanly is EXCLUDED
rather than forced. Only data/external/banking77/train.csv is read; test.csv is never opened by any script.

Run: uv run python pipeline/banking77_map.py   (after scripts/download_banking77.sh)
Writes data/external/banking77/mapped.json: [{id, text, category, label}] for the included rows.
"""
import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "external" / "banking77" / "train.csv"
OUT = ROOT / "data" / "external" / "banking77" / "mapped.json"

# category -> our label, or None to exclude. Reason in the comment; "guide" = LABELING_GUIDE.md.
MAPPING: dict[str, str | None] = {
    # unrecognized_charge: a charge/withdrawal the customer didn't make or doesn't recognize (guide rule 1)
    "card_payment_not_recognised": "unrecognized_charge",
    "cash_withdrawal_not_recognised": "unrecognized_charge",
    "direct_debit_payment_not_recognised": "unrecognized_charge",
    # wrongful_fee: recognizes the charge or bank fee but says it's wrong (duplicated, wrong amount/rate, fee) (rules 1-2)
    "transaction_charged_twice": "wrongful_fee",
    "extra_charge_on_statement": "wrongful_fee",
    "card_payment_fee_charged": "wrongful_fee",
    "cash_withdrawal_charge": "wrongful_fee",
    "transfer_fee_charged": "wrongful_fee",
    "top_up_by_card_charge": "wrongful_fee",
    "top_up_by_bank_transfer_charge": "wrongful_fee",
    "exchange_charge": "wrongful_fee",
    "card_payment_wrong_exchange_rate": "wrongful_fee",
    "wrong_exchange_rate_for_cash_withdrawal": "wrongful_fee",
    "wrong_amount_of_cash_received": "wrongful_fee",
    # transaction_status: what happened to a specific transaction: declined, pending, not arrived, refund timing,
    # what "reversed" means (guide)
    "declined_card_payment": "transaction_status",
    "declined_cash_withdrawal": "transaction_status",
    "declined_transfer": "transaction_status",
    "pending_card_payment": "transaction_status",
    "pending_cash_withdrawal": "transaction_status",
    "pending_transfer": "transaction_status",
    "pending_top_up": "transaction_status",
    "failed_transfer": "transaction_status",
    "top_up_failed": "transaction_status",
    "top_up_reverted": "transaction_status",
    "reverted_card_payment?": "transaction_status",
    "transfer_not_received_by_recipient": "transaction_status",
    "Refund_not_showing_up": "transaction_status",
    "balance_not_updated_after_bank_transfer": "transaction_status",
    "balance_not_updated_after_cheque_or_cash_deposit": "transaction_status",
    # move_money: asks the assistant to move money itself: refund, reverse, cancel a transfer (guide; always refused)
    "request_refund": "move_money",
    "cancel_transfer": "move_money",
    # out_of_scope: other products, card support, app/identity, general questions (guide, incl. rule 3:
    # a lost card with no charges is card support)
    **{c: "out_of_scope" for c in [
        "activate_my_card", "age_limit", "apple_pay_or_google_pay", "atm_support", "automatic_top_up",
        "beneficiary_not_allowed", "card_about_to_expire", "card_acceptance", "card_arrival", "card_delivery_estimate",
        "card_linking", "card_not_working", "card_swallowed", "change_pin", "contactless_not_working",
        "country_support", "disposable_card_limits", "edit_personal_details", "exchange_rate", "exchange_via_app",
        "fiat_currency_support", "get_disposable_virtual_card", "get_physical_card", "getting_spare_card",
        "getting_virtual_card", "lost_or_stolen_card", "lost_or_stolen_phone", "order_physical_card",
        "passcode_forgotten", "pin_blocked", "receiving_money", "supported_cards_and_currencies", "terminate_account",
        "top_up_by_cash_or_cheque", "top_up_limits", "topping_up_by_card", "transfer_into_account", "transfer_timing",
        "unable_to_verify_identity", "verify_my_identity", "verify_source_of_funds", "verify_top_up",
        "virtual_card_not_working", "visa_or_mastercard", "why_verify_identity",
    ]},
    # EXCLUDED: "my card is compromised" may or may not come with charges (guide rule 3 splits on that); forcing
    # either label would teach the model the wrong boundary.
    "compromised_card": None,
}
# Our balance_check and human_agent intents have no Banking77 counterpart: they get no external data.


def main() -> None:
    rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
    missing = sorted({r["category"] for r in rows} - MAPPING.keys())
    if missing:
        raise SystemExit(f"unmapped categories: {missing}")
    mapped = [{"id": f"B77-{i:05d}", "text": r["text"].strip(), "category": r["category"], "label": MAPPING[r["category"]]}
              for i, r in enumerate(rows) if MAPPING[r["category"]] is not None]
    OUT.write_text(json.dumps(mapped, ensure_ascii=False))
    by_label = Counter(m["label"] for m in mapped)
    excluded = sum(1 for r in rows if MAPPING[r["category"]] is None)
    print(f"{len(mapped)} of {len(rows)} rows mapped ({excluded} excluded); by label: {dict(by_label)}")


if __name__ == "__main__":
    main()
