// In-memory case store for unit tests (and local runs without SUPABASE_SECRET_KEY). Same behaviour as the Supabase
// store: idempotent create, read back by id. Hooks let tests simulate failures and silent write loss.
import { randomUUID } from "node:crypto";
import { newReference, type CaseInput, type CaseRecord, type CaseStore } from "./types";

export function memoryStore(opts: { failCreate?: boolean; loseWrites?: boolean; corrupt?: (r: CaseRecord) => CaseRecord } = {}): CaseStore & { rows: CaseRecord[] } {
  const rows: CaseRecord[] = [];
  return {
    source: "memory",
    rows,
    async create(input: CaseInput) {
      if (opts.failCreate) throw new Error("store unavailable");
      const existing = rows.find((r) => r.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const record: CaseRecord = { ...input, id: randomUUID(), reference: newReference(), createdAt: new Date().toISOString(), status: "open" };
      if (!opts.loseWrites) rows.push(record);
      return record;
    },
    async get(id: string) {
      const r = rows.find((row) => row.id === id) ?? null;
      return r && opts.corrupt ? opts.corrupt(r) : r;
    },
  };
}
