// Evaluation report generator (build step 18): harness runs (evals/run.ts) → reports/eval_<name>.md.
// The input runs are copied to evals/results/<name>/ and committed with the report, so it can be regenerated:
//   npm run eval:report -- --name <name> evals/results/<name>/*.json
// Usage: npm run eval:report -- [--name local] [run.json ...]   (default: the newest run of each suite in evals/runs/)
// Context figures (historical human service, intent baseline) are quoted from their own generated reports at run time,
// never copied by hand.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { AttackResult } from "./attacks";
import type { Case, PersonaCase } from "./case";
import { BREAK } from "./cases/break";
import { STEP17 } from "./cases/step17";
import { TC } from "./cases/tc";
import { percentile, summarize, type CaseRun, type Group, type Rate, type Summary } from "./metrics";

const ROOT = process.cwd();
const SUITES: Record<string, readonly (Case | PersonaCase)[]> = { tc: TC, step17: STEP17, break: BREAK };
const SUITE_TITLE: Record<string, string> = {
  tc: "TC-01…TC-21 (team-written scripts, docs/test-conversations.md)",
  step17: "Step 17 personas (LLM-drafted, edited by Luis Pedro)",
  break: "Step 19 break-it (synthetic, adversarial)",
};

type RunFile = {
  run: { startedAt: string; base: string; commit: string; suite: string; repeat: number; fallback: boolean; case: string | null };
  results: (CaseRun & { lookupSource?: string })[];
  attacks?: AttackResult[];
};

/** Long notes are cut at a word boundary; the full text is in the case file. */
const shorten = (t: string, max = 160) => (t.length <= max ? t : `${t.slice(0, t.lastIndexOf(" ", max))}…`);
const pct = (r: Rate) => (r.of ? `${((100 * r.n) / r.of).toFixed(1)}% (${r.n}/${r.of})` : "n/a (0 cases)");
const ms = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(1)} s`);
const usd = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(4)}`);

/** Rows of a markdown table in a generated report: its header and separator, plus the rows `keep` selects. */
function quoteTable(file: string, keep: (row: string) => boolean): string {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return `_${file} not found._`;
  const lines = fs.readFileSync(full, "utf8").split("\n");
  for (let i = 0; i < lines.length - 2; i++) {
    if (!lines[i].startsWith("|") || (!lines[i + 1].startsWith("|:") && !lines[i + 1].startsWith("|-"))) continue;
    let j = i + 2;
    const rows: string[] = [];
    for (; j < lines.length && lines[j].startsWith("|"); j++) if (keep(lines[j])) rows.push(lines[j]);
    if (rows.length) return [lines[i], lines[i + 1], ...rows].join("\n");
    i = j;
  }
  return `_No matching rows in ${file}._`;
}

/** The newest run file of each suite in evals/runs/. */
function newestRuns(): string[] {
  const dir = path.join(ROOT, "evals", "runs");
  if (!fs.existsSync(dir)) return [];
  const newest = new Map<string, { file: string; at: string }>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunFile;
      if (!d.run?.suite || d.run.case) continue; // single-case runs are for debugging, not the report
      const prev = newest.get(d.run.suite);
      if (!prev || d.run.startedAt > prev.at) newest.set(d.run.suite, { file: path.join(dir, f), at: d.run.startedAt });
    } catch {}
  }
  return [...newest.values()].map((x) => x.file);
}

function groupTable(title: string, groups: Record<string, Group>) {
  const rows = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, g]) => `| ${k} | ${g.cases} | ${pct(g.passed)} | ${pct(g.safeResolution)} |`);
  return [`| ${title} | Cases | Passed | Safe automated resolution |`, "|---|---|---|---|", ...rows].join("\n");
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string", default: "local" } } });
  const name = values.name;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("--name: lowercase letters, digits and dashes only");
  const inputs = positionals.length ? positionals : newestRuns();
  if (!inputs.length) throw new Error("no runs: run `npm run eval` first, or pass run files");
  const runs = inputs.map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(f, "utf8")) as RunFile }));

  // Keep the inputs with the report so the numbers can be regenerated from the repo.
  const resultsDir = path.join(ROOT, "evals", "results", name);
  fs.mkdirSync(resultsDir, { recursive: true });
  for (const r of runs) {
    const dest = path.join(resultsDir, `${r.data.run.suite}.json`);
    if (path.resolve(r.file) !== path.resolve(dest)) fs.copyFileSync(r.file, dest);
  }

  const items: { suite: string; c: Case | PersonaCase; r: CaseRun }[] = [];
  for (const { data } of runs) {
    const defs = new Map((SUITES[data.run.suite] ?? []).map((c) => [c.id, c]));
    for (const r of data.results) {
      const c = defs.get(r.id);
      if (c) items.push({ suite: data.run.suite, c, r });
    }
  }
  const all = summarize(items);
  const bySuite = Object.fromEntries(Object.keys(SUITES).filter((s) => items.some((x) => x.suite === s))
    .map((s) => [s, summarize(items.filter((x) => x.suite === s))])) as Record<string, Summary>;
  const attacks = runs.flatMap((r) => r.data.attacks ?? []);

  const turnsAll = runs.flatMap((r) => r.data.results.filter((x) => !x.invalid && !x.skipped)
    .flatMap((x) => x.turns as { intent?: { model: string; ms: number; fallbackReason: string | null } }[]));
  const intentMs = turnsAll.flatMap((t) => (t.intent ? [t.intent.ms] : []));
  // A forced fallback (TF-1's outage simulation, or --fallback) is by design: the app reports it as "forced (…)".
  const forced = (t: (typeof turnsAll)[number]) => t.intent?.fallbackReason?.startsWith("forced") ?? false;
  const failedPrimary = turnsAll.filter((t) => t.intent?.fallbackReason && !forced(t)).length;
  const fallbackTurns = turnsAll.filter((t) => t.intent?.model === "e5small" && !forced(t)).length;
  const forcedTurns = turnsAll.filter(forced).length;
  const humanReport = fs.existsSync(path.join(ROOT, "reports/intent_eval_human.md"));
  const local = runs.every((r) => /localhost|127\.0\.0\.1/.test(r.data.run.base));
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(`# Evaluation report: ${name}`, "",
    `_Generated by \`evals/report.ts\` on ${new Date().toISOString()}. Do not edit by hand. Inputs (copied to \`evals/results/${name}/\`):_`, "",
    "| Suite | Run started | Commit | App | Repeats | Forced fallback |", "|---|---|---|---|---|---|",
    ...runs.map(({ data: d }) => `| ${d.run.suite} | ${d.run.startedAt} | ${d.run.commit} | ${d.run.base} | ${d.run.repeat} | ${d.run.fallback ? "yes" : "no"} |`), "");

  add("## Read this first", "",
    `- **${local ? "Offline" : "Deployed app"}, not production traffic.** ${local ? "Run against a local `npm run dev`." : ""} Label every number here as offline (docs/challenge.md).`,
    `- **Intent model:** ${fallbackTurns ? `**${fallbackTurns} of ${turnsAll.length} turns ran on the e5-small fallback**, not production's Cohere model; results describe degraded mode.` : "production model (Cohere) on every turn."}${forcedTurns ? ` ${forcedTurns} turn(s) used the fallback on purpose (forced outage simulation, e.g. TF-1).` : ""}`,
    `- **Messages are not human-written.** TC cases are team-written, step-17 personas LLM-drafted and edited, break-it cases synthetic. The honest measure is the human-written set (step 16)${humanReport ? ", quoted under *Context*." : ", not yet run."}`,
    `- **Small samples:** ${all.graded} graded cases. Treat differences of a few cases as noise; breakdowns by language and segment even more so.`,
    ...(all.invalid ? [`- **${all.invalid} case(s) invalid** (run against the stand-in lookup for customers it has no data for) and excluded from every number.`] : []),
    ...(all.skipped ? [`- **${all.skipped} case(s) skipped** (no password for their login) and excluded.`] : []),
    "");

  add("## System vs. baseline (same cases)", "",
    "The baseline is **human-only service**: every conversation handed to a person, which is how disputes are handled today. It is computed on the same cases, so the comparison is like-for-like; the historical numbers in *Context* are not.", "",
    "| Metric | System | Human-only baseline |", "|---|---|---|",
    `| Safe automated resolution (in-scope cases) | ${pct(all.safeResolution)} | ${pct(all.humanOnly.safeResolution)} |`,
    `| Automation attempted (all cases) | ${pct(all.attempted)} | 0.0% |`,
    `| Containment (ended without a person) | ${pct(all.containment)} | ${pct(all.humanOnly.containment)} |`,
    `| Missed hand-offs (cases that needed a person) | ${pct(all.missedHandoffs)} | 0 |`,
    `| Unnecessary hand-offs (cases that didn't) | ${pct(all.unnecessaryHandoffs)} | ${pct(all.humanOnly.unnecessaryHandoffs)} |`,
    `| Unsafe: wrong actions | ${pct(all.wrongActions)} | 0 |`,
    `| Unsafe: leaks (secret or another customer's charge) | ${pct(all.leaks)} | 0 |`,
    `| Cases passing every expectation | ${pct(all.passed)} | n/a |`, "");

  add("### Definitions", "",
    "- **In scope:** cases whose expected outcome includes resolving it (a dispute to review, a status to explain). Out of scope: refusals, hand-offs by design, clarifications.",
    "- **Safe automated resolution:** an in-scope case the system resolved itself, passing every expectation (right rule, right charge, case verified), with no wrong action and no leak; over all in-scope cases.",
    "- **Automation attempted:** the system acted itself (resolved, or tried to and failed to write the case, V2), over all cases.",
    "- **Containment:** the conversation ended without a person. Alone it doesn't prove the problem was solved.",
    "- **Wrong action:** a review opened on a turn that didn't expect one (e.g. without the customer's confirmation). **Leak:** a secret from the message in a reply or the state token, or another customer's charge matched.",
    "- Outcomes follow docs/contracts.md K1: `open_review`/`explain_status`/`status_answer` resolved, `handoff` handed off, `answer` to a refund demand refused, questions asked.", "");

  add("## By suite", "", "| Suite | Cases | Passed | Safe automated resolution | Wrong actions | Leaks | Unnecessary hand-offs |", "|---|---|---|---|---|---|---|",
    ...Object.entries(bySuite).map(([s, m]) => `| ${SUITE_TITLE[s] ?? s} | ${m.graded} | ${pct(m.passed)} | ${pct(m.safeResolution)} | ${pct(m.wrongActions)} | ${pct(m.leaks)} | ${pct(m.unnecessaryHandoffs)} |`), "");
  add("## By language and segment (small samples)", "", groupTable("Language", all.byLanguage), "", groupTable("Segment", all.bySegment), "");

  add("## Latency and cost", "",
    "| | Value |", "|---|---|",
    `| Turn latency p50 / p95 (${all.turnMs.n} turns) | ${ms(all.turnMs.p50)} / ${ms(all.turnMs.p95)} |`,
    `| of which intent step p50 / p95 | ${ms(percentile(intentMs, 50))} / ${ms(percentile(intentMs, 95))} |`,
    `| Conversation latency p50 / p95 | ${ms(all.caseMs.p50)} / ${ms(all.caseMs.p95)} |`,
    `| Cost, total (Haiku reply + extraction) | ${usd(all.cost.total)} |`,
    `| Cost per attempted case | ${usd(all.cost.perAttempted)} |`,
    `| Cost per successful resolution | ${usd(all.cost.perResolution)} |`,
    `| Replies that fell back to a template | ${pct(all.templateReplies)} |`, "",
    "_Latency is the wall-clock time of each request as the harness saw it (pacing waits excluded). Embedding (Cohere) cost is not priced by the app and is excluded; on the fallback model it is zero._",
    ...(failedPrimary ? ["", `_**${failedPrimary} turns first tried Cohere and failed before falling back**, so their intent step includes that failed attempt: these latencies overstate what production (Cohere available) would show._`] : []),
    "");

  add("## Model and prompt versions", "", "| Version | Turns |", "|---|---|",
    ...Object.entries(all.versions).sort().map(([v, n]) => `| ${v} | ${n} |`), "");

  add("## Run-to-run variance", "");
  if (all.variance.length) {
    add("| Case | Passed / runs |", "|---|---|", ...all.variance.map((v) => `| ${v.id} | ${v.passed} / ${v.runs} |`), "");
  } else {
    add("_Every case ran once. Re-run with `--repeat 3` to measure variance (docs/lessons-learned.md P19: one bug showed up 1 run in 9)._", "");
  }

  if (attacks.length) {
    add("## Break-it: protocol attacks", "", "| Attack | Class | Result |", "|---|---|---|",
      ...attacks.map((a) => `| ${a.id} ${a.title} | ${a.attack} | ${"skipped" in a ? `skipped: ${a.skipped}` : a.pass ? "held" : `**failed**: expected ${a.expected}, got ${a.actual}`} |`), "");
  }
  const breakItems = items.filter((x) => x.suite === "break" && x.r.grade && !x.r.invalid);
  if (breakItems.length) {
    const classes = [...new Set(breakItems.map((x) => ("attack" in x.c && x.c.attack) || "other"))].sort();
    add("## Break-it: conversation probes by class", "", "| Class | Probes | Passed | Wrong actions | Leaks |", "|---|---|---|---|---|",
      ...classes.map((k) => {
        const m = summarize(breakItems.filter((x) => (("attack" in x.c && x.c.attack) || "other") === k));
        return `| ${k} | ${m.graded} | ${pct(m.passed)} | ${m.wrongActions.n} | ${m.leaks.n} |`;
      }), "");
  }

  const failed = items.filter((x) => x.r.grade && !x.r.invalid && !x.r.grade.pass);
  add("## Failed cases", "");
  if (failed.length) {
    add("| Case | Outcome (expected) | First mismatch | Note |", "|---|---|---|---|",
      ...failed.map(({ c, r }) => {
        const g = r.grade!;
        const m = g.mismatches[0];
        const first = g.leaks.length ? `leak: ${g.leaks.join(", ")}` : m ? `turn ${m.turn} ${m.field}: ${JSON.stringify(m.actual)} (expected ${JSON.stringify(m.expected)})` : "outcome";
        const note = ("knownGap" in c && c.knownGap) || c.note || "";
        return `| ${c.id}${r.run > 1 ? ` #${r.run}` : ""} | ${g.outcome} (${([] as string[]).concat(g.expected).join(" or ")}) | ${first.replace(/\|/g, "\\|")} | ${shorten(note).replace(/\|/g, "\\|")} |`;
      }), "", "_Diagnosis and fixes: docs/evaluation-findings.md._", "");
  } else add("_None._", "");

  add("## Context (not like-for-like)", "",
    "**Historical human service, complaint contacts** (organizer data; different cases, live not offline). Quoted from `reports/contact_reasons.md`:", "",
    quoteTable("reports/contact_reasons.md", (row) => row.startsWith("| Queja")), "",
    "**Intent classifier vs. the keyword-rules baseline** on the sealed test set (single messages, not conversations). Quoted from `reports/intent_eval_cohere-mv3.md`:", "",
    quoteTable("reports/intent_eval_cohere-mv3.md", (row) => /^\| (keyword|embed_lr) /.test(row)), "",
    ...(humanReport ? ["**Intent classifier vs. the keyword-rules baseline on human-written messages** (step 16; single first messages, not conversations). Quoted from `reports/intent_eval_human.md`:", "",
      quoteTable("reports/intent_eval_human.md", (row) => /^\| (Served model|Keyword rules) /.test(row)), ""] : []));

  const out = path.join(ROOT, "reports", `eval_${name}.md`);
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`wrote ${path.relative(ROOT, out)} from ${runs.length} run(s): ${all.graded} graded cases, ${attacks.length} attacks`);
}

try {
  main();
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exitCode = 2;
}
