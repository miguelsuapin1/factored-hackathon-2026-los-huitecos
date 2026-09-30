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

// ---- Multi-turn moves (steps 11–12, docs/conversation.md C7–C8, docs/policy.md) ----

type DetailsView = {
  amount: number | null;
  expectedAmount: number | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
};

type MatchView = { date: string; amount: number; currency: string; merchant: string | null };

type HandoffReason = "repeated_clarification" | "no_match" | "ambiguous" | "high_risk" | "record_unavailable" | "tool_failure";

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

/** The matched transaction as the record shows it (its own currency and merchant, never the customer's wording). */
function matchText(m: MatchView, lang: Lang) {
  const es = lang === "es";
  const where = m.merchant ? ` ${es ? "en" : "em"} ${m.merchant}` : "";
  return `${es ? "un cargo de" : "uma cobrança de"} ${money(m.amount, m.currency)}${where}, ${es ? "el" : "em"} ${day(m.date, lang)}`;
}

const MISSING_TEXT: Record<Lang, Record<"amount" | "date", string>> = {
  es: { amount: "el monto del cargo", date: "la fecha aproximada del cargo" },
  pt: { amount: "o valor da cobrança", date: "a data aproximada da cobrança" },
};
const MISSING_EN = { amount: "the amount of the charge", date: "the date of the charge (approximate is fine)" };

const join = (items: string[], lang: Lang) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "e"} ${items.at(-1)}`;

export type ReplyPlanInput = {
  move:
    | "ask_clarify" | "ask_details" | "confirm" | "ask_correction" | "confirmed" | "status_update" | "answer" | "handoff"
    | "no_match" | "ask_narrow" | "explain_status" | "open_review" | "record_failed";
  intent: IntentLabel; // the working intent (or the model's top intent when there is none)
  clarifyOptions: [IntentLabel, IntentLabel] | null;
  clarifyAttempts: number;
  details: DetailsView;
  missing: ("amount" | "date")[];
  match: MatchView | null;
  explainRule: "PL-3" | "PL-4" | "PL-5" | null;
  handoffReason: HandoffReason | null;
  status: "open" | "confirmed" | "review" | "handoff" | "closed";
  caseRef: string | null; // set only when the case was written and read back (step 13, V1)
};

export type ReplyPlan = { instruction: string; templates: Record<Lang, string> };

const HANDOFF_EN: Record<HandoffReason, string> = {
  repeated_clarification: "After two questions it's still not clear what the customer needs. Say you'll pass the conversation to an agent who can help, and ask them to describe the issue briefly in their own words.",
  no_match: "You couldn't find a charge matching the details the customer gave, even after they checked them. Say an agent will continue with the details already collected, so they don't need to repeat them.",
  ambiguous: "Several charges match and it's still not clear which one the customer means. Say an agent will continue with the details already collected, so they don't need to repeat them.",
  high_risk: "Say that a specialist agent will take over this case, with the details already confirmed, so they don't need to repeat them. Do not mention fraud, scores, risk or why.",
  record_unavailable: "Say the charge can't be checked automatically right now, so an agent will continue with the details already confirmed.",
  tool_failure: "Say the account's movements can't be checked right now, so an agent will continue with the details already collected.",
};

const HANDOFF_LOCAL: Record<Lang, Record<HandoffReason, string>> = {
  es: {
    repeated_clarification: "Para ayudarte mejor, te paso con un asesor. ¿Me cuentas en una frase qué ocurrió?",
    no_match: "No logré ubicar ese cargo con los datos que me diste. Un asesor continuará con tu caso usando esos datos, así no tienes que repetirlos.",
    ambiguous: "Hay más de un cargo que coincide. Un asesor continuará con tu caso usando los datos que ya me diste.",
    high_risk: "Un asesor especializado continuará con tu caso, con los datos que ya confirmaste; no necesitas repetirlos.",
    record_unavailable: "No puedo revisar ese cargo automáticamente en este momento. Un asesor continuará con los datos que ya confirmaste.",
    tool_failure: "No puedo consultar tus movimientos en este momento. Un asesor continuará con los datos que ya me diste.",
  },
  pt: {
    repeated_clarification: "Para te ajudar melhor, vou te passar para um atendente. Pode me contar em uma frase o que aconteceu?",
    no_match: "Não consegui localizar essa cobrança com os dados informados. Um atendente vai continuar com o seu caso usando esses dados, sem que você precise repeti-los.",
    ambiguous: "Há mais de uma cobrança que corresponde. Um atendente vai continuar com o seu caso usando os dados que você já informou.",
    high_risk: "Um atendente especializado vai continuar com o seu caso, com os dados que você já confirmou; não precisa repeti-los.",
    record_unavailable: "Não consigo verificar essa cobrança automaticamente agora. Um atendente vai continuar com os dados que você já confirmou.",
    tool_failure: "Não consigo consultar suas movimentações agora. Um atendente vai continuar com os dados que você já informou.",
  },
};

/** Code decides what each move's reply must say (R1): an instruction for Haiku plus the fixed ES/PT fallback. */
export function planReply(p: ReplyPlanInput, lang: Lang): ReplyPlan {
  const known = knownParts(p.details, lang);
  const knownText = known.length ? known.join(", ") : "nothing yet";
  const both = (f: (l: Lang) => string) => ({ es: f("es"), pt: f("pt") });
  const matched = p.match ? matchText(p.match, lang) : null;
  const noRefund = "Do not promise a refund, and give no timeframe.";

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
      if (p.match) {
        return {
          instruction: `In the customer's account you found this charge: ${matched}. Restate it exactly as written here and ask the customer to confirm with yes or no that this is the charge they mean. Do not say a claim was opened or that anything was resolved.`,
          templates: both((l) =>
            l === "es"
              ? `Encontré ${matchText(p.match!, l)}. ¿Es este el cargo al que te refieres? (sí / no)`
              : `Encontrei ${matchText(p.match!, l)}. É essa a cobrança que você quer contestar? (sim / não)`,
          ),
        };
      }
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
        instruction: `The customer said this is not the right charge or the details are wrong (${knownText}). Ask which detail is wrong (amount, date or merchant) and the correct value.`,
        templates: both((l) =>
          l === "es" ? "Entendido. ¿Qué dato no es correcto: el monto, la fecha o el comercio? ¿Cuál es el correcto?"
            : "Entendi. Qual dado não está correto: o valor, a data ou o estabelecimento? Qual é o correto?",
        ),
      };
    case "no_match":
      return {
        instruction: `No charge matching these details was found in the customer's account around that date: ${knownText}. Ask them to check the amount and the date, and to tell you the merchant name if they know it. Do not suggest they are wrong or that the charge doesn't exist.`,
        templates: both((l) =>
          l === "es" ? "No encontré un cargo con esos datos cerca de esa fecha. ¿Puedes revisar el monto y la fecha, y decirme el comercio si lo conoces?"
            : "Não encontrei uma cobrança com esses dados perto dessa data. Pode conferir o valor e a data, e me dizer o estabelecimento se souber?",
        ),
      };
    case "ask_narrow":
      return {
        instruction: `More than one charge in the customer's account matches ${knownText}. Ask for the merchant name or the exact date so you can tell which one they mean. Do not list the charges.`,
        templates: both((l) =>
          l === "es" ? "Hay más de un cargo que coincide. ¿Me dices el nombre del comercio o la fecha exacta para identificarlo?"
            : "Há mais de uma cobrança que corresponde. Pode me dizer o nome do estabelecimento ou a data exata para identificá-la?",
        ),
      };
    case "explain_status": {
      const rule = p.explainRule ?? "PL-3";
      const en = {
        "PL-3": "is still pending: it hasn't been finalized. Explain that a pending charge can still change or be cancelled, so it can't be disputed yet; if it's still there once it's finalized, they can write again. Don't promise it will disappear.",
        "PL-4": "appears as reversed: the amount was returned to their account. Say so, and that no dispute is needed. Do not say when it shows in the balance.",
        "PL-5": "was declined, so it wasn't charged to their account. Say so, and that no dispute is needed. Do not give a reason for the decline.",
      }[rule];
      return {
        instruction: `In the customer's account, ${matched} ${en}`,
        templates: both((l) => {
          const t = matchText(p.match!, l);
          const text = {
            es: { "PL-3": `Encontré ${t}, pero aún está pendiente: no se ha completado y todavía puede cambiar o anularse, así que no se puede reclamar por ahora. Si sigue ahí cuando se complete, escríbenos de nuevo.`, "PL-4": `Encontré ${t}, y aparece como revertido: el monto se devolvió a tu cuenta, así que no hace falta abrir un reclamo.`, "PL-5": `Encontré ${t}, pero fue rechazado, así que no se cobró a tu cuenta. No hace falta abrir un reclamo.` },
            pt: { "PL-3": `Encontrei ${t}, mas ela ainda está pendente: não foi concluída e ainda pode mudar ou ser cancelada, então não dá para contestar por enquanto. Se continuar quando for concluída, fale com a gente de novo.`, "PL-4": `Encontrei ${t}, e ela aparece como estornada: o valor voltou para a sua conta, então não é preciso abrir uma contestação.`, "PL-5": `Encontrei ${t}, mas ela foi recusada, então não foi cobrada na sua conta. Não é preciso abrir uma contestação.` },
          };
          return text[l][rule];
        }),
      };
    }
    case "open_review":
      // Only reached with a verified case (V1): now it IS registered, and the reference is real.
      return {
        instruction: `Tell the customer their dispute of ${matched} has been registered with case number ${p.caseRef}, which they should keep; the disputes team will review it and tell them the result. Give the case number exactly as written. ${noRefund}`,
        templates: both((l) =>
          l === "es" ? `Listo: registramos tu reclamo por ${matchText(p.match!, l)}. Tu número de caso es ${p.caseRef}. El equipo de reclamos lo revisará y te informaremos el resultado.`
            : `Pronto: registramos sua contestação de ${matchText(p.match!, l)}. O número do seu caso é ${p.caseRef}. A equipe de contestações vai analisá-la e você será informado do resultado.`,
        ),
      };
    case "record_failed":
      return {
        instruction: `The case could not be registered right now because of a technical problem. Say so plainly: nothing has been registered yet. ${p.match ? "Ask them to reply \"sí\" (or \"sim\") in a few minutes to try again; the details are kept." : "Ask them to write again in a few minutes."} Do not say anything was sent, opened or passed to an agent. ${noRefund}`,
        templates: both((l) =>
          l === "es" ? `No pude registrar tu caso por un problema técnico; todavía no quedó registrado. ${p.match ? "Guardé los datos: responde \"sí\" en unos minutos para intentarlo de nuevo." : "Por favor escríbenos de nuevo en unos minutos."}`
            : `Não consegui registrar o seu caso por um problema técnico; ainda não ficou registrado. ${p.match ? "Guardei os dados: responda \"sim\" em alguns minutos para tentar de novo." : "Por favor, escreva de novo em alguns minutos."}`,
        ),
      };
    case "confirmed":
      return {
        instruction: `Thank the customer: the details are confirmed (${knownText}) and the charge will now be checked against their account. ${noRefund}`,
        templates: both((l) =>
          l === "es" ? "Gracias, datos confirmados. Ahora revisaremos ese cargo en tu cuenta."
            : "Obrigado, dados confirmados. Agora vamos verificar essa cobrança na sua conta.",
        ),
      };
    case "status_update": {
      const where = { review: "is already with the disputes team for review", handoff: "has already been passed to an agent", closed: "was already answered", confirmed: "is being checked", open: "is open" }[p.status];
      return {
        instruction: `The customer's case about this charge ${where}. Say so briefly and ask if there's anything else you can help with. ${noRefund}`,
        templates: both((l) =>
          l === "es" ? "Tu caso sobre ese cargo ya está en curso. ¿Hay algo más en lo que te pueda ayudar?"
            : "O seu caso sobre essa cobrança já está em andamento. Posso ajudar com mais alguma coisa?",
        ),
      };
    }
    case "handoff": {
      const reason = p.handoffReason ?? "repeated_clarification";
      const ref = p.caseRef ? ` Give them their case number, exactly as written: ${p.caseRef}.` : "";
      return {
        instruction: `${HANDOFF_EN[reason]}${ref} Do not promise any outcome or say how soon the agent will reply ("right away", "shortly", "in minutes").`,
        templates: both((l) => HANDOFF_LOCAL[l][reason] + (p.caseRef ? (l === "es" ? ` Tu número de caso es ${p.caseRef}.` : ` O número do seu caso é ${p.caseRef}.`) : "")),
      };
    }
    case "answer":
      return { instruction: GUIDANCE[p.intent], templates: both((l) => TEMPLATES[l][p.intent]) };
  }
}
