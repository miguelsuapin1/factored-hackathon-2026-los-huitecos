"""Create the step-8 test logins and the lookup role's password (decision D-006).

What it does, in one database transaction (as postgres, SUPABASE_DB_URL in .env.local):
  1. Upserts the TEST_USERS below into public.app_users with fresh random passwords. Only PBKDF2 hashes go to the
     database (same format as src/lib/auth/password.ts).
  2. Gives the role lookup_reader a random password (first run, or with --rotate-role-password) and writes
     SUPABASE_LOOKUP_DB_URL to .env.local. Copy that value to Vercel as a Sensitive env var.
  3. Checks, connecting AS lookup_reader through the pooler (the path Vercel uses), that each test user sees only
     their own transactions and that no customer set means no rows.
  4. Writes the plaintext logins, with one real charge per user to try, to test-users.local.md (git-ignored).

Team-generated test accounts on top of the organizer's synthetic customers (label provenance: team_synthetic logins).
Never commit test-users.local.md or .env.local: the repo is public.

  uv run python pipeline/seed_test_users.py                         # create/refresh logins (+ role password if new)
  uv run python pipeline/seed_test_users.py --rotate-role-password  # also replace the lookup role's password
"""
import argparse
import base64
import hashlib
import hmac
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_supabase import ROOT, env_value  # noqa: E402  (same .env.local reader, Windows-safe)

ITERATIONS = 600_000  # keep equal to PBKDF2_ITERATIONS in src/lib/auth/password.ts
CREDENTIALS_FILE = ROOT / "test-users.local.md"

# username → (customer_id, scenario label, SQL filter that picks a charge worth trying for this user)
TEST_USERS = {
    "demo.mx":                 ("CLI-DEMO00000001",    "Miguel's synthetic demo customer (all policy paths)", "transaction_id = 'TRX-DEMO0000000000001'"),
    "otro.mx":                 ("CLI-OTHER0000000001", "Synthetic second customer: same 350 USD charge as demo (scoping)", "true"),
    "pendiente.ar":            ("CLI-ET8RX4AC7A0W",    "Pending charge (PL-3: explain, no case)", "transaction_status = 'Pending'"),
    "revertido.ar":            ("CLI-FHF58PJ3PK5U",    "Reversed charge (PL-4: already returned)", "transaction_status = 'Reversed'"),
    "rechazado.mx":            ("CLI-EJWEV3HH94KV",    "Declined with response code (PL-5)", "transaction_status = 'Declined' and response_code is not null"),
    "rechazado-sin-codigo.co": ("CLI-VAQ11UMRIQJJ",    "Declined without response code (PL-5, data issue E7)", "transaction_status = 'Declined' and response_code is null"),
    "fraude.co":               ("CLI-IG7OG4JOZ0UC",    "Approved, fraud score >= 30 (PL-6: agent)", "transaction_status = 'Approved' and fraud_score >= 30"),
    "extranjero.co":           ("CLI-2E1U2EX6TYXH",    "Foreign charge", "is_foreign"),
    "usd.mx":                  ("CLI-N1N1GK9GLVKV",    "Mexican customer charged in USD (data issue A5)", "currency = 'USD'"),
    "ambiguo.mx":              ("CLI-GMZJYO4I75ST",    "Similar amounts close together (PL-2: ask which)", "transaction_status = 'Approved'"),
    "suspendido.co":           ("CLI-BHJ7KIAHF2PG",    "Suspended customer", "true"),
    "sin-movimientos.mx":      ("CLI-8X0KESOCU4HW",    "No charges since March (nothing recent to match)", "true"),
}

ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/l/I


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def pbkdf2_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, 32)
    return f"pbkdf2-sha256${ITERATIONS}${b64url(salt)}${b64url(digest)}"


def scram_verifier(password: str) -> str:
    """Postgres SCRAM-SHA-256 verifier, computed here so the plain role password never reaches the server (or its
    statement statistics). Same construction as libpq's PQencryptPasswordConn."""
    salt, iterations = secrets.token_bytes(16), 4096
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", "sha256").digest()
    server_key = hmac.new(salted, b"Server Key", "sha256").digest()
    b64 = lambda x: base64.b64encode(x).decode()  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(hashlib.sha256(client_key).digest())}:{b64(server_key)}"


def new_password() -> str:
    return "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3))


def lookup_url(admin_url: str, role_password: str) -> str:
    """Same host as SUPABASE_DB_URL, user lookup_reader.<project ref>, transaction pooler port 6543."""
    u = urlsplit(admin_url)
    user = u.username or ""
    if "." not in user:
        raise SystemExit("SUPABASE_DB_URL should be the pooler URI (user postgres.<project ref>); see the docstring")
    ref = user.split(".", 1)[1]
    netloc = f"lookup_reader.{ref}:{quote(role_password, safe='')}@{u.hostname}:6543"
    return urlunsplit((u.scheme, netloc, u.path or "/postgres", "sslmode=require", ""))


def save_env(name: str, value: str) -> None:
    f = ROOT / ".env.local"
    lines = []
    if f.exists():
        raw = f.read_bytes()
        text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
        lines = [ln for ln in text.splitlines() if not ln.replace(" ", "").lstrip("﻿").startswith(f"{name}=")]
    lines.append(f"{name}={value}")
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rotate-role-password", action="store_true")
    a = ap.parse_args()

    import psycopg
    from psycopg import sql

    admin = env_value("SUPABASE_DB_URL")
    if not admin:
        raise SystemExit("SUPABASE_DB_URL is not set (put it in .env.local; see pipeline/load_supabase.py)")
    existing_lookup = env_value("SUPABASE_LOOKUP_DB_URL", required=False)
    set_role_password = a.rotate_role_password or not existing_lookup

    passwords = {u: new_password() for u in TEST_USERS}
    tries = {}
    with psycopg.connect(admin) as conn, conn.cursor() as cur:
        ids = [c for c, _, _ in TEST_USERS.values()]
        cur.execute("select customer_id, country, customer_status from public.customers where customer_id = any(%s)", (ids,))
        found = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        missing = sorted(set(ids) - set(found))
        if missing:
            raise SystemExit(f"these customers are not in public.customers (reload the slice?): {missing}")

        for username, (cid, label, _) in TEST_USERS.items():
            cur.execute(
                """insert into public.app_users (username, customer_id, password_hash, label)
                   values (%s, %s, %s, %s)
                   on conflict (username) do update set customer_id = excluded.customer_id,
                     password_hash = excluded.password_hash, label = excluded.label, disabled = false, updated_at = now()""",
                (username, cid, pbkdf2_hash(passwords[username]), label))
        for username, (cid, _, where) in TEST_USERS.items():
            cur.execute(f"""select transaction_date_local, amount, currency, merchant_name, transaction_status
                            from public.transactions where customer_id = %s and ({where})
                            order by transaction_date_local desc, transaction_id limit 1""", (cid,))
            tries[username] = cur.fetchone()

        if set_role_password:
            role_password = secrets.token_urlsafe(24).replace("-", "a").replace("_", "b")
            cur.execute(sql.SQL("alter role lookup_reader with login password {}").format(
                sql.Literal(scram_verifier(role_password))))
        conn.commit()
    print(f"app_users: {len(TEST_USERS)} test logins written (hashes only)")

    if set_role_password:
        existing_lookup = lookup_url(admin, role_password)
        save_env("SUPABASE_LOOKUP_DB_URL", existing_lookup)
        print("lookup_reader: new password; SUPABASE_LOOKUP_DB_URL saved to .env.local (copy it to Vercel, Sensitive)")

    # Prove isolation through the same door Vercel uses: the pooler, as lookup_reader.
    with psycopg.connect(existing_lookup, prepare_threshold=None, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute("select count(*) from public.transactions")
        if cur.fetchone()[0] != 0:
            raise SystemExit("FAIL: lookup_reader sees rows without a customer set")
        conn.rollback()
        for username, (cid, _, _) in TEST_USERS.items():
            cur.execute("select set_config('app.customer_id', %s, true)", (cid,))
            cur.execute("select count(*), count(*) filter (where customer_id <> %s) from public.transactions", (cid,))
            own, foreign = cur.fetchone()
            if foreign or own == 0:  # every test customer has transactions (sin-movimientos.mx: older ones)
                raise SystemExit(f"FAIL: {username} sees {own} own and {foreign} foreign transactions")
            conn.rollback()
    print("isolation: checked as lookup_reader through the pooler, every test user sees only their own rows")

    rows = []
    for username, (cid, label, _) in TEST_USERS.items():
        country, status = found[cid]
        t = tries[username]
        charge = f"{t[0]} · {t[1]:,.2f} {t[2]} · {t[3] or 'no merchant'} · {t[4]}" if t else "—"
        rows.append(f"| `{username}` | `{passwords[username]}` | {cid} | {country} · {status} | {label} | {charge} |")
    CREDENTIALS_FILE.write_text(
        "# GT Bank test logins (LOCAL ONLY — never commit, never paste in public)\n\n"
        "Generated by `pipeline/seed_test_users.py`. Running it again replaces every password.\n"
        "Each login sees only its own customer's data. The demo clock is 2026-06-17, so \"ayer\" = 2026-06-16.\n\n"
        "| Username | Password | Customer | Country · status | Scenario | A charge to try (local date · amount · merchant · status) |\n"
        "|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n\n"
        "Try: sign in, then e.g. \"No reconozco un cargo de <amount> en <merchant> el <date>\" (or in Portuguese).\n"
        "Cross-customer test: signed in as `otro.mx`, ask about the demo customer's charge TRX-DEMO0000000000001 — "
        "the assistant must not find it.\n",
        encoding="utf-8")
    print(f"credentials: {CREDENTIALS_FILE.name} (git-ignored)")


if __name__ == "__main__":
    main()
