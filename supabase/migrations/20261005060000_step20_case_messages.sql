-- Step 20: agent console (decision D-007). Owner: Carlos (Person 2, 2026-10-05).
--
-- The live conversation between a bank agent and the customer once a hand-off case is accepted. One row per message,
-- tied to the case it belongs to (public.cases, Miguel's table, unchanged: this only references it). The case's own
-- `status` column (open → in_progress → closed) is the request's state; nothing new is needed for it.
--
-- Access: the same rule as public.cases. RLS on, NO policies, browser roles revoked: only the server (secret key)
-- reads or writes. The agent console and the customer's chat poll server routes, which check who is asking.
-- What's stored: the customer's messages are masked before insert (src/lib/privacy/mask.ts, H4), like everything else.

create table public.case_messages (
  id         bigint generated always as identity primary key,
  case_id    uuid not null references public.cases (id) on delete cascade,
  created_at timestamptz not null default now(),
  sender     text not null check (sender in ('customer', 'agent', 'system')),
  body       text not null check (char_length(body) between 1 and 1000)
);

create index case_messages_case_idx on public.case_messages (case_id, id);

alter table public.case_messages enable row level security;
revoke all on table public.case_messages from anon, authenticated;

comment on table public.case_messages is 'Agent ↔ customer messages after a hand-off is accepted (step 20). Server-only (secret key). Customer text masked before insert.';
