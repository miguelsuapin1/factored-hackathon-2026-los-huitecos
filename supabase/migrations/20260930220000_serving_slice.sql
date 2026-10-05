-- The serving slice: the part of the gold layer the app reads at runtime.
-- Owner: Carlos (2026-09-30). Source: BigQuery gold_serving.* (pipeline/dbt/models/gold/serving),
-- loaded by pipeline/load_supabase.py. Contents and size: reports/serving_slice.md. Contract: docs/contracts.md K2.
--
-- Access (same rule as public.cases): RLS is on with NO policies and the browser roles lose every privilege,
-- so only the server (secret key, bypasses RLS) can read. Migration 20261001010000 adds per-customer policies on top.
-- Minimised on purpose: first name only, document number as SHA-256, product number last 4 digits, no is_fraud.

create table public.customers (
  customer_id            text primary key,
  first_name             text,
  country                text not null check (country in ('MX', 'CO', 'AR')),
  timezone               text not null,
  segment                text,
  customer_status        text not null,
  document_type          text,
  document_number_sha256 text,                     -- login; never the raw number
  cohort_reasons         text[] not null,          -- why this customer is in the slice (stratified_sample, scenario:*, ...)
  data_source            text not null check (data_source in ('organizer', 'team_synthetic'))
);

create table public.products (
  product_id           text primary key,
  customer_id          text not null references public.customers (customer_id),
  product_type         text not null,
  currency             text not null,
  product_status       text,
  product_number_last4 text,
  opening_date         date
);

create table public.transactions (
  transaction_id         text primary key,
  customer_id            text not null references public.customers (customer_id),
  product_id             text references public.products (product_id),   -- null for the synthetic demo charges
  transaction_ts         timestamptz not null,                           -- UTC, as delivered
  transaction_date_local date not null,                                  -- the customer's calendar day: filter on this
  transaction_type       text,
  amount                 numeric(18, 2) not null,
  currency               text not null,                                  -- the record's own currency (data issue A5)
  amount_usd             numeric(18, 2),
  merchant_name          text,
  merchant_category      text,
  transaction_status     text not null check (transaction_status in ('Approved', 'Declined', 'Pending', 'Reversed')),
  response_code          text,                                           -- never interpreted (data issue E7)
  channel                text,
  transaction_country    text,                                           -- ISO
  is_foreign             boolean not null default false,
  fraud_score            numeric(6, 2),                                  -- policy engine only (PL-6), never shown
  data_source            text not null check (data_source in ('organizer', 'team_synthetic'))
);

create table public.fx_rates (
  date            date not null,
  source_currency text not null,
  target_currency text not null,
  exchange_rate   numeric(18, 8) not null,
  primary key (date, source_currency, target_currency)
);

create table public.agent_pools (
  country       text not null,
  pool          text not null,       -- fraud | complaints | portuguese_speakers | general
  active_agents integer not null,
  primary key (country, pool)
);

-- One row per load: which BigQuery build is being served (lineage from Supabase back to the warehouse).
create table public.data_version (
  id              bigint generated always as identity primary key,
  loaded_at       timestamptz not null default now(),
  source          text not null,     -- e.g. bigquery:project-d49391de-51c4-49bf-aae.gold_serving
  git_commit      text,
  row_counts      jsonb not null,
  demo_today      date not null
);

-- The lookup (K2): always by customer, then by date or amount.
create index transactions_customer_date_idx on public.transactions (customer_id, transaction_date_local desc);
create index transactions_customer_amount_idx on public.transactions (customer_id, amount);
create index products_customer_idx on public.products (customer_id);

alter table public.customers    enable row level security;
alter table public.products     enable row level security;
alter table public.transactions enable row level security;
alter table public.fx_rates     enable row level security;
alter table public.agent_pools  enable row level security;
alter table public.data_version enable row level security;
revoke all on table public.customers, public.products, public.transactions, public.fx_rates,
                    public.agent_pools, public.data_version from anon, authenticated;

comment on table public.transactions is 'Serving slice of gold_serving.serving_transactions. Server-only until step 8 policies. See docs/contracts.md K2.';
comment on table public.customers is 'Minimised customers of the serving slice. Server-only until step 8 policies.';
