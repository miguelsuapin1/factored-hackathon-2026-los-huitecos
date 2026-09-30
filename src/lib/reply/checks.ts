// Code checks on a reply, besides the number check (conversation/numbers.ts). Pure, tested by checks.test.ts.

/** R8: no reply may promise when something will happen: we don't control agents' or reviewers' timing. */
const TIMING_PROMISE = new RegExp(
  [
    "ahora mismo", "enseguida", "en breve", "de inmediato", "inmediatamente", "en unos minutos", "en minutos",
    "muy pronto", "lo antes posible", "en seguida",
    "agora mesmo", "em breve", "imediatamente", "em instantes", "em alguns minutos", "o mais r[aá]pido poss[ií]vel", "j[aá] j[aá]",
  ].map((p) => p.replace(/ /g, "\\s+")).join("|"),
  "iu",
);

export function timingPromise(reply: string) {
  return reply.match(TIMING_PROMISE)?.[0] ?? null;
}
