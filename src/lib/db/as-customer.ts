// The customer-scoped transaction (D-006), independent of where the connection comes from so tests can run it
// against a local Postgres. Production wiring (env, server-only) is in scoped.ts.
import type postgres from "postgres";
import type { CustomerSession } from "@/lib/lookup/types";

export const STATEMENT_TIMEOUT_MS = 4000;

export type ScopedSql = postgres.TransactionSql;
export type AsCustomer = <T>(session: CustomerSession, work: (tx: ScopedSql) => Promise<T>) => Promise<T>;

/** Every unit of work runs in one transaction that first sets app.customer_id (transaction-local), so the RLS policies
 *  on customers/products/transactions only show that customer's rows. No customer → refuse before touching the DB. */
export function makeAsCustomer(client: () => postgres.Sql): AsCustomer {
  return async (session, work) => {
    const customerId = session.customerId;
    if (typeof customerId !== "string" || !customerId) throw new Error("no customer in session");
    const result = await client().begin(async (tx) => {
      await tx`select set_config('app.customer_id', ${customerId}, true),
                      set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
      return work(tx);
    });
    return result as Awaited<ReturnType<typeof work>>;
  };
}
