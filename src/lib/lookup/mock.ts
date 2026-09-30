// Stand-in for the transaction lookup until Person 2's Supabase version exists (docs/contracts.md K2).
// SYNTHETIC FIXTURES, team-generated (Miguel, 2026-09-30): one demo customer whose recent charges each exercise a
// policy path in docs/policy.md. Merchant names, statuses and currencies follow the organizer data; the amounts,
// dates and scores were chosen for the test conversations. Dates sit just before the demo clock (2026-06-17).
import type { CustomerSession, LookupQuery, TransactionLookup, TransactionMatch } from "./types";

type Row = Omit<TransactionMatch, "score"> & { customerId: string };

const DEMO = "CLI-DEMO00000001";
const row = (r: Omit<Row, "customerId" | "channel" | "country"> & Partial<Row>): Row => ({
  customerId: DEMO, channel: "App", country: "MX", ...r,
});

export const FIXTURES: Row[] = [
  // TC-01: wrong amount → one approved match, low risk → review (PL-7)
  row({ transactionId: "TRX-DEMO0000000000001", date: "2026-06-10T13:42:10", amount: 350, currency: "USD", merchant: "Super Ahorro", status: "Approved", responseCode: "00", fraudScore: 12.4 }),
  // TC-02: Portuguese customer says "R$", the record is USD → currency is a preference, still matches
  row({ transactionId: "TRX-DEMO0000000000002", date: "2026-06-12T20:05:33", amount: 89.9, currency: "USD", merchant: "Cable TV", status: "Approved", responseCode: "00", fraudScore: 8.1, channel: "Web" }),
  // TC-03 / high risk: approved, fraud score above the cutoff → agent (PL-6)
  row({ transactionId: "TRX-DEMO0000000000003", date: "2026-06-03T02:17:48", amount: 120, currency: "USD", merchant: "Conciertos Live", status: "Approved", responseCode: "00", fraudScore: 41.7, channel: "Web" }),
  // Pending → explain, no case (PL-3)
  row({ transactionId: "TRX-DEMO0000000000004", date: "2026-06-16T09:30:02", amount: 45, currency: "USD", merchant: "Gasolinera Express", status: "Pending", responseCode: "05", fraudScore: 16.3 }),
  // Reversed → already returned, no case (PL-4)
  row({ transactionId: "TRX-DEMO0000000000005", date: "2026-06-05T18:11:27", amount: 230, currency: "USD", merchant: "Restaurante El Buen Sabor", status: "Reversed", responseCode: "14", fraudScore: 9.9 }),
  // Declined → nothing was charged (PL-5)
  row({ transactionId: "TRX-DEMO0000000000006", date: "2026-06-14T11:48:55", amount: 560, currency: "USD", merchant: "Empresa Telefónica", status: "Declined", responseCode: "51", fraudScore: 14.2 }),
  // Two charges of 25 two days apart → ambiguous without the merchant (PL-2)
  row({ transactionId: "TRX-DEMO0000000000007", date: "2026-06-11T08:02:14", amount: 25, currency: "USD", merchant: "Tienda Don José", status: "Approved", responseCode: "00", fraudScore: 11.0 }),
  row({ transactionId: "TRX-DEMO0000000000008", date: "2026-06-12T08:15:40", amount: 25, currency: "USD", merchant: "Super Ahorro", status: "Approved", responseCode: "00", fraudScore: 13.5 }),
  // Another customer's charge with the same amount as TC-01: must never be returned (scoping)
  row({ transactionId: "TRX-OTHER000000000001", customerId: "CLI-OTHER0000000001", date: "2026-06-10T10:00:00", amount: 350, currency: "USD", merchant: "Super Ahorro", status: "Approved", responseCode: "00", fraudScore: 5 }),
];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function strip(r: Row, score: number): TransactionMatch {
  const { customerId, ...rest } = r;
  void customerId; // never leaves the lookup
  return { ...rest, score };
}

export const mockLookup: TransactionLookup = {
  source: "mock",
  async findTransactions(session: CustomerSession, q: LookupQuery) {
    const own = FIXTURES.filter((r) => r.customerId === session.customerId);
    const hits = own.filter((r) => {
      const day = r.date.slice(0, 10);
      if (q.amount !== undefined && Math.abs(r.amount - q.amount) > Math.max(0.01, q.amount * 0.01)) return false;
      if (q.dateFrom && day < q.dateFrom) return false;
      if (q.dateTo && day > q.dateTo) return false;
      return true;
    });
    // Merchant and currency narrow the result only if something still matches: customers misname both.
    const narrow = (list: Row[], keep: (r: Row) => boolean) => (list.some(keep) ? list.filter(keep) : list);
    let result = hits;
    let merchantHit = false;
    let currencyHit = false;
    if (q.merchant) {
      const m = fold(q.merchant);
      const keep = (r: Row) => !!r.merchant && (fold(r.merchant).includes(m) || m.includes(fold(r.merchant)));
      merchantHit = result.some(keep);
      result = narrow(result, keep);
    }
    if (q.currency) {
      const keep = (r: Row) => r.currency === q.currency;
      currencyHit = result.some(keep);
      result = narrow(result, keep);
    }
    const score = 0.6 + (merchantHit ? 0.3 : 0) + (currencyHit ? 0.1 : 0);
    return result.slice(0, q.limit ?? 5).map((r) => strip(r, score));
  },
  async getTransaction(session: CustomerSession, transactionId: string) {
    const r = FIXTURES.find((f) => f.transactionId === transactionId && f.customerId === session.customerId);
    return r ? strip(r, 1) : null;
  },
};

export const DEMO_CUSTOMER_ID = DEMO;
