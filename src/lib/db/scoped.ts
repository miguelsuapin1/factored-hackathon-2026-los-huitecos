// Customer-scoped database access (D-006). The ONLY way the lookup reads customer data.
//
// It connects as the Postgres role lookup_reader (SUPABASE_LOOKUP_DB_URL), which row-level security applies to, and
// opens a transaction that first sets app.customer_id to the signed-in customer (as-customer.ts). The policies in
// supabase/migrations/20261001010000_step8_login_rls.sql then hide every other customer's rows, so even a query that
// forgets its WHERE clause can't leak. The secret key (which skips RLS) is never used for customer data.
import "server-only";
import postgres from "postgres";
import { makeAsCustomer } from "./as-customer";

export type { AsCustomer, ScopedSql } from "./as-customer";

let sql: postgres.Sql | null = null;

export function lookupConfigured() {
  return !!process.env.SUPABASE_LOOKUP_DB_URL;
}

function client() {
  const url = process.env.SUPABASE_LOOKUP_DB_URL;
  if (!url) throw new Error("SUPABASE_LOOKUP_DB_URL is not configured");
  // Transaction pooler (port 6543): no prepared statements. One connection per function instance is plenty.
  sql ??= postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 5, ssl: "require" });
  return sql;
}

/** Runs `work` in one transaction that can only see `session.customerId`'s rows. */
export const asCustomer = makeAsCustomer(client);
