// The evaluation report's numbers (build step 18), computed from harness runs. Definitions follow the brief's required
// metrics (docs/challenge.md "Required evaluation metrics") and are restated in the generated report.
// Pure functions, no I/O: tested in metrics.test.ts.
import type { Case, Outcome, PersonaCase } from "./case";
import type { Grade } from "./grade";

/** What metrics need from one graded case run (a subset of run.ts's CaseResult). */
export type CaseRun = {
  id: string;
  run: number;
  login: string;
  skipped?: string;
  invalid?: string;
  grade?: Grade;
  turns: {
    httpStatus: number;
    ms: number;
    intent?: { model: string; modelVersion: string };
    reply?: { promptVersion: string; costUsd: number; source: string };
    extraction?: { promptVersion: string; costUsd: number };
  }[];
};

/** K5 customers' segments (docs/contracts.md K5). */
export const SEGMENT: Record<string, string> = {
  "demo.mx": "Basic", "otro.mx": "Basic", "pendiente.ar": "Premium", "rechazado-sin-codigo.co": "Plus", "ambiguo.mx": "Plus",
};

export type Rate = { n: number; of: number };
const rate = (n: number, of: number): Rate => ({ n, of });

export type Group = { cases: number; passed: Rate; safeResolution: Rate };

export type Summary = {
  graded: number;
  skipped: number;
  invalid: number;
  passed: Rate;
  inScope: number;
  safeResolution: Rate; // in-scope cases resolved correctly, with no wrong action and no leak
  attempted: Rate; // cases where the system acted itself (resolved, or tried to and failed)
  containment: Rate; // ended without a person
  missedHandoffs: Rate; // over cases that needed a person
  unnecessaryHandoffs: Rate; // over cases that didn't
  wrongActions: Rate;
  leaks: Rate;
  turnMs: { p50: number | null; p95: number | null; n: number };
  caseMs: { p50: number | null; p95: number | null };
  cost: { total: number; perAttempted: number | null; perResolution: number | null };
  templateReplies: Rate; // replies that fell back to a fixed template (R5)
  byLanguage: Record<string, Group>;
  bySegment: Record<string, Group>;
  versions: Record<string, number>; // "intent cohere-mv3@51ee21d", "reply reply-v7", ... → turns
  variance: { id: string; passed: number; runs: number }[]; // cases run more than once
  humanOnly: { safeResolution: Rate; containment: Rate; unnecessaryHandoffs: Rate }; // the baseline, same cases
};

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const expectedOf = (c: Case | PersonaCase): Outcome[] => ([] as Outcome[]).concat(c.outcome);
const caseCost = (r: CaseRun) => r.turns.reduce((s, t) => s + (t.reply?.costUsd ?? 0) + (t.extraction?.costUsd ?? 0), 0);

export function summarize(items: readonly { c: Case | PersonaCase; r: CaseRun }[]): Summary {
  const graded = items.filter((x) => x.r.grade && !x.r.invalid && !x.r.skipped);
  const g = (x: { r: CaseRun }) => x.r.grade!;
  const safe = (x: { r: CaseRun }) => !g(x).wrongAction && g(x).leaks.length === 0;
  const inScope = graded.filter((x) => expectedOf(x.c).includes("resolved"));
  const resolvedOk = (x: (typeof graded)[number]) => g(x).outcome === "resolved" && g(x).pass && safe(x);
  const attempted = graded.filter((x) => g(x).outcome === "resolved" || g(x).outcome === "failed");
  const needPerson = graded.filter((x) => expectedOf(x.c).every((o) => o === "handed_off"));
  const noPerson = graded.filter((x) => !expectedOf(x.c).includes("handed_off"));
  const turns = graded.flatMap((x) => x.r.turns.filter((t) => t.httpStatus === 200));
  const totalCost = graded.reduce((s, x) => s + caseCost(x.r), 0);
  const resolutions = inScope.filter(resolvedOk).length;

  const group = (key: (x: (typeof graded)[number]) => string) => {
    const out: Record<string, Group> = {};
    for (const x of graded) {
      const k = key(x);
      const gr = (out[k] ??= { cases: 0, passed: rate(0, 0), safeResolution: rate(0, 0) });
      gr.cases++;
      gr.passed.of++;
      if (g(x).pass) gr.passed.n++;
      if (expectedOf(x.c).includes("resolved")) {
        gr.safeResolution.of++;
        if (resolvedOk(x)) gr.safeResolution.n++;
      }
    }
    return out;
  };

  const versions: Record<string, number> = {};
  for (const t of turns) {
    for (const v of [
      t.intent && `intent ${t.intent.model}@${t.intent.modelVersion}`,
      t.reply && `reply ${t.reply.promptVersion}`,
      t.extraction && `extraction ${t.extraction.promptVersion}`,
    ]) if (v) versions[v] = (versions[v] ?? 0) + 1;
  }

  const runsById = new Map<string, CaseRun[]>();
  for (const x of graded) runsById.set(x.r.id, [...(runsById.get(x.r.id) ?? []), x.r]);
  const variance = [...runsById.entries()].filter(([, rs]) => rs.length > 1)
    .map(([id, rs]) => ({ id, passed: rs.filter((r) => r.grade!.pass).length, runs: rs.length }));

  return {
    graded: graded.length,
    skipped: items.filter((x) => x.r.skipped).length,
    invalid: items.filter((x) => x.r.invalid).length,
    passed: rate(graded.filter((x) => g(x).pass).length, graded.length),
    inScope: inScope.length,
    safeResolution: rate(resolutions, inScope.length),
    attempted: rate(attempted.length, graded.length),
    containment: rate(graded.filter((x) => g(x).outcome !== "handed_off").length, graded.length),
    missedHandoffs: rate(needPerson.filter((x) => g(x).missedHandoff).length, needPerson.length),
    unnecessaryHandoffs: rate(noPerson.filter((x) => g(x).unnecessaryHandoff).length, noPerson.length),
    wrongActions: rate(graded.filter((x) => g(x).wrongAction).length, graded.length),
    leaks: rate(graded.filter((x) => g(x).leaks.length > 0).length, graded.length),
    turnMs: { p50: percentile(turns.map((t) => t.ms), 50), p95: percentile(turns.map((t) => t.ms), 95), n: turns.length },
    caseMs: {
      p50: percentile(graded.map((x) => x.r.turns.reduce((s, t) => s + t.ms, 0)), 50),
      p95: percentile(graded.map((x) => x.r.turns.reduce((s, t) => s + t.ms, 0)), 95),
    },
    cost: {
      total: totalCost,
      perAttempted: attempted.length ? attempted.reduce((s, x) => s + caseCost(x.r), 0) / attempted.length : null,
      perResolution: resolutions ? totalCost / resolutions : null,
    },
    templateReplies: rate(turns.filter((t) => t.reply?.source === "template").length, turns.length),
    byLanguage: group((x) => x.c.lang),
    bySegment: group((x) => SEGMENT[x.c.login] ?? "other"),
    versions,
    variance,
    humanOnly: {
      safeResolution: rate(0, inScope.length),
      containment: rate(0, graded.length),
      unnecessaryHandoffs: rate(noPerson.length, noPerson.length),
    },
  };
}
