// Matching rules shared by every TransactionLookup (docs/contracts.md K2), so the stand-in (mock.ts) and the Supabase
// lookup (sql.ts) can't drift apart. Pure functions, unit-tested through both lookups.
import type { LookupQuery, TransactionMatch } from "./types";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** ±1% of the amount the customer said (at least one cent), in the record's own currency. */
export function amountTolerance(amount: number) {
  return Math.max(0.01, amount * 0.01);
}

/** Amount and date window: the hard filters. `day` is the customer's local calendar day (YYYY-MM-DD). */
export function inWindow(r: { amount: number; day: string }, q: LookupQuery) {
  if (q.amount !== undefined && Math.abs(r.amount - q.amount) > amountTolerance(q.amount)) return false;
  if (q.dateFrom && r.day < q.dateFrom) return false;
  if (q.dateTo && r.day > q.dateTo) return false;
  return true;
}

/** Merchant and currency narrow the result only if something still matches: customers misname both. Then score and cap. */
export function narrowAndScore<R extends Omit<TransactionMatch, "score">>(hits: R[], q: LookupQuery): (R & { score: number })[] {
  const narrow = (list: R[], keep: (r: R) => boolean) => (list.some(keep) ? list.filter(keep) : list);
  let result = hits;
  let merchantHit = false;
  let currencyHit = false;
  if (q.merchant) {
    const m = fold(q.merchant);
    const keep = (r: R) => !!r.merchant && (fold(r.merchant).includes(m) || m.includes(fold(r.merchant)));
    merchantHit = result.some(keep);
    result = narrow(result, keep);
  }
  if (q.currency) {
    const keep = (r: R) => r.currency === q.currency;
    currencyHit = result.some(keep);
    result = narrow(result, keep);
  }
  const score = 0.6 + (merchantHit ? 0.3 : 0) + (currencyHit ? 0.1 : 0);
  return result.slice(0, q.limit ?? 5).map((r) => ({ ...r, score }));
}
