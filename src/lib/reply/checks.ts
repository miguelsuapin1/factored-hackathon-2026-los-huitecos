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

/** R9: in a pure explanation (status answers), the reply may not offer an action the system won't take next
 * ("podemos investigarlo", "puedo abrir una revisión"): only PL-9's own offer is backed by code (S2). */
const UNBACKED_OFFER = /\b(investig\w*|averigu\w*|revis(ar|emos|arlo|arla|ión)|abrir (una|un) |analis(ar|amos)|verific(ar|amos)|contesta[çc][aã]o|reclamaç[aã]o)/iu;

export function unbackedOffer(reply: string) {
  return reply.match(UNBACKED_OFFER)?.[0] ?? null;
}

