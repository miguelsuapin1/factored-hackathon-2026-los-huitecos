// Customer-scoped database access (step 8, D-006). The ONLY way the lookup (step 10) reads customer data.
//
// It connects as the Postgres role lookup_reader (SUPABASE_LOOKUP_DB_URL), which row-level security applies to, and
// opens a transaction that first sets app.customer_id to the signed-in customer. The policies in
// supabase/migrations/20261001010000_step8_login_rls.sql then hide every other customer's rows, so even a query that
// forgets its WHERE clause can't leak. The secret key (which skips RLS) is never used for customer data.
import "server-only";
import postgres from "postgres";
import type { CustomerSession } from "@/lib/lookup/types";

const STATEMENT_TIMEOUT_MS = 4000;
let sql: postgres.Sql | null = null;

function client() {
  const url = process.env.SUPABASE_LOOKUP_DB_URL;
  if (!url) throw new Error("SUPABASE_LOOKUP_DB_URL is not configured");
  // Transaction pooler (port 6543): no prepared statements. One connection per function instance is plenty.
  sql ??= postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 5, ssl: "require" });
  return sql;
}

export type ScopedSql = postgres.TransactionSql;

/** Runs `work` in one transaction that can only see `session.customerId`'s rows. */
export async function asCustomer<T>(session: CustomerSession, work: (tx: ScopedSql) => Promise<T>): Promise<T> {
  const customerId = session.customerId;
  if (typeof customerId !== "string" || !customerId) throw new Error("no customer in session");
  const result = await client().begin(async (tx) => {
    await tx`select set_config('app.customer_id', ${customerId}, true),
                    set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
    return work(tx);
  });
  return result as T;
}
