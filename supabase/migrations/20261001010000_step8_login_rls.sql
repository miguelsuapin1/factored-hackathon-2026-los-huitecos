-- Per-customer test login + row-level security (decision D-006, docs/decisions.md).
-- Owner: Carlos (2026-10-01). Reviewed by Miguel in the PR.
--
-- How it works:
--   1. public.app_users holds the test logins: username → customer_id, password as a PBKDF2 hash (never plaintext).
--      Server-only, like public.cases: RLS on, no policies, browser roles revoked. The login route reads it with the
--      secret key, before any customer is known.
--   2. The lookup does NOT use the secret key (that skips RLS). It connects as lookup_reader, a role RLS applies to,
--      and opens every query with   select set_config('app.customer_id', '<id from the signed session>', true)
--      (transaction-local). The policies below only show rows of that customer, so even a query that forgets its
--      WHERE clause can't return someone else's data. No setting → no rows.
--   3. anon / authenticated (the browser keys) still get nothing: Miguel's rule holds.
--
-- lookup_reader is created without login here. pipeline/seed_test_users.py gives it a password (never in git).

-- 1. Test logins -----------------------------------------------------------------------------------------------
create table public.app_users (
  username      text primary key check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  -- No foreign key on purpose: the step-7 loader truncates public.customers on every reload, and a foreign key
  -- would block that (or cascade-delete the logins). The seed script and the loader check the link instead.
  customer_id   text not null unique,
  password_hash text not null check (password_hash like 'pbkdf2-sha256$%'),  -- pbkdf2-sha256$<iterations>$<salt>$<hash>
  label         text,                     -- which scenario this test user exercises
  disabled      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.app_users is 'Test logins (team-generated). Server-only. Passwords are PBKDF2 hashes; plaintext only in the gitignored local file written by pipeline/seed_test_users.py.';

alter table public.app_users enable row level security;
revoke all on table public.app_users from anon, authenticated;

-- 2. The role the lookup runs as -----------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'lookup_reader') then
    create role lookup_reader nologin noinherit nobypassrls;
  end if;
end
$$;
comment on role lookup_reader is 'Step 8: the transaction lookup connects as this role. Read-only, subject to RLS, sees one customer per transaction (app.customer_id).';

-- postgres may SET ROLE lookup_reader (drop to fewer privileges) so the isolation checks can run as the lookup does
-- (supabase/tests/step8_rls_check.sql). It does not inherit anything from it.
grant lookup_reader to postgres with inherit false, set true;

grant usage on schema public to lookup_reader;
grant select on table public.customers, public.products, public.transactions to lookup_reader;
-- Nothing else: no cases, no app_users, no data_version, no writes.

-- 3. Own rows only -------------------------------------------------------------------------------------------
-- (select current_setting(...)) is evaluated once per query, not per row. missing_ok = true → NULL → no rows.
create policy customers_own_rows on public.customers
  for select to lookup_reader
  using (customer_id = (select current_setting('app.customer_id', true)));

create policy products_own_rows on public.products
  for select to lookup_reader
  using (customer_id = (select current_setting('app.customer_id', true)));

create policy transactions_own_rows on public.transactions
  for select to lookup_reader
  using (customer_id = (select current_setting('app.customer_id', true)));
