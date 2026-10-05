// The transaction lookup against Supabase (docs/contracts.md K2). Producer: Carlos.
//
// Reads public.transactions through a customer-scoped transaction (src/lib/db/as-customer.ts): row-level security
// limits every query to the signed-in customer, and the WHERE customer_id below is a second, redundant guard.
// Amount and date are filtered in SQL (indexes from the serving-slice migration); merchant and currency narrowing and
// the score come from match.ts, the same code the stand-in uses, so both answer the same questions the same way.
// `date` is the customer's LOCAL timestamp (no zone), like the stand-in's fixtures: the dialogue reads day and month
// from it, and transaction_date_local is the day the customer saw (data issue A2).
import type postgres from "postgres";
import type { AsCustomer, ScopedSql } from "@/lib/db/as-customer";
import { amountTolerance, narrowAndScore } from "./match";
import type { CustomerSession, LookupQuery, TransactionLookup, TransactionMatch, TransactionStatus } from "./types";

/** Enough rows for any window the dialogue asks for (the slice has ~11 transactions per customer per year). */
const CANDIDATE_CAP = 200;

type DbRow = {
  transaction_id: string; date: string; amount: number; currency: string; merchant_name: string | null;
  transaction_status: TransactionStatus; response_code: string | null; channel: string | null;
  transaction_country: string | null; fraud_score: number | null;
};

const toMatch = (r: DbRow): Omit<TransactionMatch, "score"> => ({
  transactionId: r.transaction_id,
  date: r.date,
  amount: Number(r.amount),
  currency: r.currency,
  merchant: r.merchant_name,
  status: r.transaction_status,
  responseCode: r.response_code,
  channel: r.channel,
  country: r.transaction_country,
  fraudScore: r.fraud_score === null ? null : Number(r.fraud_score),
});

function select(tx: ScopedSql, customerId: string, filters: postgres.PendingQuery<postgres.Row[]>) {
  return tx<DbRow[]>`
    select t.transaction_id,
           to_char(t.transaction_ts at time zone c.timezone, 'YYYY-MM-DD"T"HH24:MI:SS') as date,
           t.amount::float8 as amount, t.currency, t.merchant_name, t.transaction_status, t.response_code,
           t.channel, t.transaction_country, t.fraud_score::float8 as fraud_score
    from public.transactions t
    join public.customers c on c.customer_id = t.customer_id
    where t.customer_id = ${customerId} ${filters}
    order by t.transaction_ts desc, t.transaction_id
    limit ${CANDIDATE_CAP}`;
}

export function sqlLookup(asCustomer: AsCustomer): TransactionLookup {
  return {
    source: "supabase",
    async findTransactions(session: CustomerSession, q: LookupQuery) {
      const rows = await asCustomer(session, (tx) => {
        const amount = q.amount !== undefined
          ? tx`and abs(t.amount - ${q.amount}::numeric) <= ${amountTolerance(q.amount)}::numeric`
          : tx``;
        const from = q.dateFrom ? tx`and t.transaction_date_local >= ${q.dateFrom}::date` : tx``;
        const to = q.dateTo ? tx`and t.transaction_date_local <= ${q.dateTo}::date` : tx``;
        return select(tx, session.customerId, tx`${amount} ${from} ${to}`);
      });
      return narrowAndScore(rows.map(toMatch), q);
    },
    async getTransaction(session: CustomerSession, transactionId: string) {
      const rows = await asCustomer(session, (tx) => select(tx, session.customerId, tx`and t.transaction_id = ${transactionId}`));
      return rows.length ? { ...toMatch(rows[0]), score: 1 } : null;
    },
  };
}
