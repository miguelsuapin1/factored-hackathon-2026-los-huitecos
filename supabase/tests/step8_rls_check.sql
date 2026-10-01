-- Step 8 isolation check (D-006). Runs as the role the lookup uses and fails loudly if any customer can see another
-- customer's rows. Run it with any SQL client connected as postgres (Supabase SQL editor, the connector, psql).
-- Read-only: everything happens in a transaction that is rolled back.
begin;
set local role lookup_reader;

do $$
declare n bigint;
begin
  -- 1. No customer in the session → nothing.
  select count(*) into n from public.transactions;
  if n <> 0 then raise exception 'FAIL no-setting: % transactions visible', n; end if;
  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'FAIL no-setting: % customers visible', n; end if;

  -- 2. Demo customer: a query with NO where clause returns only their own rows.
  perform set_config('app.customer_id', 'CLI-DEMO00000001', true);
  select count(*) into n from public.transactions where customer_id <> 'CLI-DEMO00000001';
  if n <> 0 then raise exception 'FAIL demo: % foreign transactions visible', n; end if;
  select count(*) into n from public.transactions;
  if n = 0 then raise exception 'FAIL demo: own transactions not visible'; end if;
  raise notice 'demo customer sees % own transactions', n;

  -- 3. Asking for another customer's charge by id or by customer id returns nothing (TC: unauthorized access).
  select count(*) into n from public.transactions where customer_id = 'CLI-OTHER0000000001';
  if n <> 0 then raise exception 'FAIL demo: can read CLI-OTHER0000000001'; end if;
  select count(*) into n from public.transactions where transaction_id = 'TRX-OTHER000000000001';
  if n <> 0 then raise exception 'FAIL demo: can read TRX-OTHER000000000001 by id'; end if;
  select count(*) into n from public.customers;
  if n <> 1 then raise exception 'FAIL demo: % customer rows visible (expected 1)', n; end if;
  select count(*) into n from public.products where customer_id <> 'CLI-DEMO00000001';
  if n <> 0 then raise exception 'FAIL demo: % foreign products visible', n; end if;

  -- 4. Switching the setting switches the customer (each request sets its own).
  perform set_config('app.customer_id', 'CLI-OTHER0000000001', true);
  select count(*) into n from public.transactions where customer_id <> 'CLI-OTHER0000000001';
  if n <> 0 then raise exception 'FAIL other: % foreign transactions visible', n; end if;

  -- 5. Empty or made-up ids see nothing.
  perform set_config('app.customer_id', '', true);
  select count(*) into n from public.transactions;
  if n <> 0 then raise exception 'FAIL empty id: % visible', n; end if;
  perform set_config('app.customer_id', ''' or ''1''=''1', true);
  select count(*) into n from public.transactions;
  if n <> 0 then raise exception 'FAIL injection-shaped id: % visible', n; end if;

  -- 6. Nothing beyond the three read tables, and no writes.
  begin
    perform 1 from public.cases limit 1;
    raise exception 'FAIL: lookup_reader can read cases';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.app_users limit 1;
    raise exception 'FAIL: lookup_reader can read app_users';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.transactions set amount = amount where false;
    raise exception 'FAIL: lookup_reader can update transactions';
  exception when insufficient_privilege then null;
  end;
end
$$;

select 'step 8 RLS check passed' as result;
rollback;
