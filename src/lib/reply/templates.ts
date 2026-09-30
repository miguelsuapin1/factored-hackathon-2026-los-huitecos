// What each reply must convey (decided by code, never by the model), plus deterministic Spanish/Portuguese
// replies used whenever Haiku is unavailable or its output fails validation.
import type { IntentLabel } from "@/lib/intent/model";

export type Lang = "es" | "pt";

/** Instructions to Haiku for a confident intent: what to say, and what never to say. */
export const GUIDANCE: Record<IntentLabel, string> = {
  unrecognized_charge:
    "Acknowledge that the customer doesn't recognize a charge and say you'll help review it. Ask for the date and the approximate amount (or the merchant name) so the charge can be found. Do not promise a refund or reversal.",
  wrongful_fee:
    "Acknowledge that the customer thinks a charge or fee is wrong. Ask which charge it is (date and amount) and briefly why it's wrong, for example duplicated, a different amount, or a fee that shouldn't apply. Do not promise a refund.",
  transaction_status:
    "Acknowledge that the customer wants to know what happened with a transaction. Ask for the date and amount, or the merchant or recipient, so it can be checked.",
  balance_check:
    "Say you can help with that and ask which account or card they want to check. Do not state or guess any balance, limit or amount.",
  move_money:
    "Explain politely that this chat can't move money: no refunds, reversals, transfers or payments. Offer instead to open a review of the charge or to connect them with an agent.",
  human_agent:
    "Confirm that you'll connect them with an agent. Ask for a one-line summary of the issue so the agent has context.",
  out_of_scope:
    "Say briefly that this assistant helps with card and account charges: charges they don't recognize, fees they think are wrong, the status of a transaction, and balances. For anything else, suggest the bank's other service channels. If it's a greeting, greet back and say what you can help with. Do not answer unrelated questions.",
};

/** How each intent is described when asking the customer to choose between two. */
export const OPTION_TEXT: Record<IntentLabel, string> = {
  unrecognized_charge: "a charge they don't recognize",
  wrongful_fee: "a charge or fee they think is wrong",
  transaction_status: "the status of a transaction",
  balance_check: "their balance or account movements",
  move_money: "a refund or a money transfer",
  human_agent: "talking to a person",
  out_of_scope: "something else",
};

export function clarifyGuidance(a: IntentLabel, b: IntentLabel) {
  return `The message is ambiguous. Ask ONE short clarifying question that offers two options: ${OPTION_TEXT[a]}, or ${OPTION_TEXT[b]}. Do not assume either one.`;
}

const OPTION_LOCAL: Record<Lang, Record<IntentLabel, string>> = {
  es: {
    unrecognized_charge: "un cargo que no reconoces",
    wrongful_fee: "un cobro que consideras incorrecto",
    transaction_status: "el estado de una transacción",
    balance_check: "tu saldo o movimientos",
    move_money: "un reembolso o una transferencia",
    human_agent: "hablar con una persona",
    out_of_scope: "otro tema",
  },
  pt: {
    unrecognized_charge: "uma cobrança que você não reconhece",
    wrongful_fee: "uma cobrança que você considera errada",
    transaction_status: "o status de uma transação",
    balance_check: "seu saldo ou movimentações",
    move_money: "um reembolso ou uma transferência",
    human_agent: "falar com uma pessoa",
    out_of_scope: "outro assunto",
  },
};

const TEMPLATES: Record<Lang, Record<IntentLabel, string>> = {
  es: {
    unrecognized_charge:
      "Entiendo que no reconoces un cargo; te ayudo a revisarlo. ¿Me indicas la fecha y el monto aproximado, o el nombre del comercio?",
    wrongful_fee:
      "Entiendo que un cobro te parece incorrecto. ¿Me dices cuál es (fecha y monto) y por qué crees que está mal?",
    transaction_status:
      "Claro, revisemos esa transacción. ¿Me compartes la fecha y el monto, o el comercio o destinatario?",
    balance_check: "Con gusto te ayudo. ¿Qué cuenta o tarjeta quieres consultar?",
    move_money:
      "Por este chat no puedo mover dinero: no hago reembolsos, reversiones ni transferencias. Sí puedo abrir una revisión del cargo o comunicarte con un asesor. ¿Qué prefieres?",
    human_agent: "Te comunico con un asesor. ¿Me cuentas en una frase el problema para pasarle el contexto?",
    out_of_scope:
      "Te puedo ayudar con cargos que no reconoces, cobros incorrectos, el estado de una transacción o tu saldo. Para otros temas, usa los demás canales del banco.",
  },
  pt: {
    unrecognized_charge:
      "Entendi que você não reconhece uma cobrança; vou te ajudar a revisar. Pode me informar a data e o valor aproximado, ou o nome do estabelecimento?",
    wrongful_fee:
      "Entendi que uma cobrança parece errada. Pode me dizer qual é (data e valor) e por que acha que está errada?",
    transaction_status:
      "Claro, vamos verificar essa transação. Pode me passar a data e o valor, ou o estabelecimento ou destinatário?",
    balance_check: "Com prazer. Qual conta ou cartão você quer consultar?",
    move_money:
      "Por este chat não consigo movimentar dinheiro: não faço reembolsos, estornos nem transferências. Posso abrir uma revisão da cobrança ou te passar para um atendente. O que prefere?",
    human_agent: "Vou te passar para um atendente. Pode resumir o problema em uma frase para eu passar o contexto?",
    out_of_scope:
      "Posso ajudar com cobranças que você não reconhece, cobranças erradas, o status de uma transação ou seu saldo. Para outros assuntos, use os outros canais do banco.",
  },
};

export function templateReply(lang: Lang, intent: IntentLabel, decision: "act" | "ask", second?: IntentLabel) {
  if (decision === "ask" && second) {
    const o = OPTION_LOCAL[lang];
    return lang === "es"
      ? `Para ayudarte mejor: ¿se trata de ${o[intent]} o de ${o[second]}?`
      : `Para te ajudar melhor: é sobre ${o[intent]} ou sobre ${o[second]}?`;
  }
  return TEMPLATES[lang][intent];
}

const PT_MARKERS = /\b(você|vocês|não|meu|minha|quero|cartão|cobrança|cobraram|dinheiro|tá|pra|obrigad[oa]|olá|oi|fatura|saque|poupança|está|falar|atendente|conta)\b|[ãõç]/giu;
const ES_MARKERS = /\b(usted|tarjeta|cargo|cobro|cobraron|dinero|quiero|mi|gracias|hola|plata|reconozco|hablar|asesor|cuenta|está)\b|[ñ¿¡]/giu;

/** Cheap language guess for the template path (Haiku detects language itself on the main path). */
export function guessLanguage(text: string): Lang {
  const pt = text.match(PT_MARKERS)?.length ?? 0;
  const es = text.match(ES_MARKERS)?.length ?? 0;
  return pt > es ? "pt" : "es";
}

// ---- Multi-turn moves (build step 11, docs/conversation.md C7–C8) ----

type DetailsView = {
  amount: number | null;
  expectedAmount: number | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
};

const MONTHS: Record<Lang, string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
};

const money = (v: number, currency: string | null) => `${Number.isInteger(v) ? v : v.toFixed(2)}${currency ? ` ${currency}` : ""}`;
const day = (iso: string, lang: Lang) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[lang][m - 1]}`;
};

/** The known details as short phrases in the customer's language (given to Haiku pre-formatted, and used by templates). */
function knownParts(d: DetailsView, lang: Lang) {
  const es = lang === "es";
  const parts: string[] = [];
  if (d.amount !== null) parts.push(`${es ? "cargo de" : "cobrança de"} ${money(d.amount, d.currency)}`);
  if (d.expectedAmount !== null) parts.push(`${es ? "debía ser" : "deveria ser"} ${money(d.expectedAmount, d.currency)}`);
  if (d.date !== null) parts.push(`${es ? "del" : "de"} ${day(d.date, lang)}`);
  if (d.merchant !== null) parts.push(`${es ? "en" : "em"} ${d.merchant}`);
  return parts;
}

const MISSING_TEXT: Record<Lang, Record<"amount" | "date", string>> = {
  es: { amount: "el monto del cargo", date: "la fecha aproximada del cargo" },
  pt: { amount: "o valor da cobrança", date: "a data aproximada da cobrança" },
};
const MISSING_EN = { amount: "the amount of the charge", date: "the date of the charge (approximate is fine)" };

const join = (items: string[], lang: Lang) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "e"} ${items.at(-1)}`;

export type ReplyPlanInput = {
  move: "ask_clarify" | "ask_details" | "confirm" | "ask_correction" | "confirmed" | "answer" | "handoff";
  intent: IntentLabel; // the working intent (or the model's top intent when there is none)
  clarifyOptions: [IntentLabel, IntentLabel] | null;
  clarifyAttempts: number;
  details: DetailsView;
  missing: ("amount" | "date")[];
};

export type ReplyPlan = { instruction: string; templates: Record<Lang, string> };

/** Code decides what each move's reply must say (R1): an instruction for Haiku plus the fixed ES/PT fallback. */
export function planReply(p: ReplyPlanInput, lang: Lang): ReplyPlan {
  const known = knownParts(p.details, lang);
  const knownText = known.length ? known.join(", ") : "nothing yet";
  const both = (f: (l: Lang) => string) => ({ es: f("es"), pt: f("pt") });

  switch (p.move) {
    case "ask_clarify": {
      const [a, b] = p.clarifyOptions ?? [p.intent, "out_of_scope"];
      const again = p.clarifyAttempts > 0 ? "The customer's last answer didn't make it clear yet. " : "";
      return {
        instruction: again + clarifyGuidance(a, b),
        templates: both((l) => templateReply(l, a, "ask", b)),
      };
    }
    case "ask_details":
      return {
        instruction: `The customer is disputing ${OPTION_TEXT[p.intent]}. Already known: ${knownText}. Briefly acknowledge what's known (you may restate those details exactly as written here), then ask ONLY for: ${p.missing.map((m) => MISSING_EN[m]).join(" and ")}. Do not ask again for anything already known. Do not promise a refund.`,
        templates: both((l) => {
          const k = knownParts(p.details, l);
          const ask = join(p.missing.map((m) => MISSING_TEXT[l][m]), l);
          return l === "es"
            ? `${k.length ? `Anotado: ${k.join(", ")}. ` : ""}¿Me indicas ${ask}?`
            : `${k.length ? `Anotado: ${k.join(", ")}. ` : ""}Pode me informar ${ask}?`;
        }),
      };
    case "confirm":
      return {
        instruction: `Restate these details of ${OPTION_TEXT[p.intent]} exactly as written here and ask the customer to confirm with yes or no before the charge is reviewed: ${knownText}. Do not say a claim was opened or that anything was resolved.`,
        templates: both((l) =>
          l === "es"
            ? `Para confirmar: ${knownParts(p.details, l).join(", ")}. ¿Es correcto? (sí / no)`
            : `Para confirmar: ${knownParts(p.details, l).join(", ")}. Está correto? (sim / não)`,
        ),
      };
    case "ask_correction":
      return {
        instruction: `The customer said these details are not right: ${knownText}. Ask which one is wrong (amount, date or merchant) and the correct value.`,
        templates: both((l) =>
          l === "es" ? "Entendido. ¿Qué dato no es correcto: el monto, la fecha o el comercio? ¿Cuál es el correcto?"
            : "Entendi. Qual dado não está correto: o valor, a data ou o estabelecimento? Qual é o correto?",
        ),
      };
    case "confirmed":
      return {
        instruction: `Thank the customer: the details are confirmed (${knownText}) and the charge will now be checked against their account. Do not say a claim was opened or a refund issued, and give no timeframe.`,
        templates: both((l) =>
          l === "es" ? "Gracias, datos confirmados. Ahora revisaremos ese cargo en tu cuenta."
            : "Obrigado, dados confirmados. Agora vamos verificar essa cobrança na sua conta.",
        ),
      };
    case "handoff":
      return {
        instruction: "After two questions it's still not clear what the customer needs. Say you'll pass the conversation to an agent who can help, and ask them to describe the issue briefly in their own words. Do not promise any outcome.",
        templates: both((l) =>
          l === "es" ? "Para ayudarte mejor, te paso con un asesor. ¿Me cuentas en una frase qué ocurrió?"
            : "Para te ajudar melhor, vou te passar para um atendente. Pode me contar em uma frase o que aconteceu?",
        ),
      };
    case "answer":
      return { instruction: GUIDANCE[p.intent], templates: both((l) => TEMPLATES[l][p.intent]) };
  }
}
