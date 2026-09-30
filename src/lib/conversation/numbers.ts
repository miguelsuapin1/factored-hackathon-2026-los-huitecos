// Numbers as customers write them ("350", "1.250,00", "12.50"). Used to check that an extracted amount, or a number
// in a reply, is one the customer actually wrote (docs/conversation.md C3, C9). No runtime imports: unit-tested
// directly with node --test.

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

/** Every value a written number could mean: separators as thousands ("1.250" → 1250) or the last one as decimals. */
export function numberCandidates(token: string): number[] {
  const values = new Set<number>([Number(token.replace(/[.,]/g, ""))]);
  const decimal = token.match(/^(.*)[.,](\d{1,2})$/);
  if (decimal) values.add(Number(`${decimal[1].replace(/[.,]/g, "") || "0"}.${decimal[2]}`));
  return [...values].filter(Number.isFinite);
}

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER_TOKEN) ?? []).flatMap(numberCandidates);
}

/** Number tokens in `text` that can't be read as any of the allowed values. */
export function unallowedNumbers(text: string, allowed: Iterable<number>): string[] {
  const ok = new Set(allowed);
  return (text.match(NUMBER_TOKEN) ?? []).filter((t) => !numberCandidates(t).some((v) => ok.has(v)));
}
