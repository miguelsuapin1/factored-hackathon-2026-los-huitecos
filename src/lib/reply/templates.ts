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
