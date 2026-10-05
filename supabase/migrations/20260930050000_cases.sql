-- Cases created by the dispute assistant (docs/contracts.md K3, docs/verification.md).
-- Owner: Miguel (2026-09-30). Reviewed by Carlos (supabase/ is the data folder).
--
-- A row is written for every dispute that goes to review (PL-7) or to a person (PL-1/2/6/8, repeated clarification),
-- then re-read before the customer is told it exists. No raw transcript is stored: only facts the system
-- verified, what the customer stated, checks done and open questions (the brief's "structured handoff").
--
-- Access: only the server (secret key, bypasses RLS) reads or writes. RLS is on with NO policies, and the browser
-- roles lose every privilege, so the publishable key in the browser can't see or touch a single case.

create table public.cases (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,             -- shown to the customer, e.g. GT-7F3K2Q9A
  idempotency_key     text not null unique,             -- conversation + transaction: a repeated "yes" never makes two cases
  created_at          timestamptz not null default now(),
  kind                text not null check (kind in ('review', 'handoff')),
  status              text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  rule                text not null,                    -- the policy rule that decided it (PL-n or DLG-clarify)
  reason              text,                             -- hand-off reason (high_risk, no_match, ...); null for reviews
  conversation_id     uuid not null,
  customer_id         text not null,
  intent              text not null,                    -- unrecognized_charge | wrongful_fee | ...
  language            text not null check (language in ('es', 'pt')),
  transaction_id      text,                             -- the matched transaction, if any
  summary             text not null,                    -- one line for the agent, built by code (not by a model)
  verified_facts      jsonb not null default '[]'::jsonb, -- [{fact, source}] read from our own systems
  customer_statements jsonb not null default '{}'::jsonb, -- what the customer said: amount, expectedAmount, date, merchant
  checks_done         jsonb not null default '[]'::jsonb,
  open_questions      jsonb not null default '[]'::jsonb,
  prompt_versions     jsonb not null default '{}'::jsonb  -- which model/prompt versions produced the conversation
);

create index cases_customer_created_idx on public.cases (customer_id, created_at desc);
create index cases_open_idx on public.cases (status, created_at desc) where status <> 'closed';

alter table public.cases enable row level security;
revoke all on table public.cases from anon, authenticated;

comment on table public.cases is 'Dispute reviews and hand-offs created by the assistant. Server-only (secret key). See docs/verification.md.';
