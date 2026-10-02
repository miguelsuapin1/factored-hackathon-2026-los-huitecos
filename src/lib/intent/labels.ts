// Display names for intents and models (safe to import in client components).
export const INTENT_LABELS: Record<string, { en: string; es: string; pt: string }> = {
  unrecognized_charge: { en: "Unrecognized charge", es: "Cargo no reconocido", pt: "Cobrança não reconhecida" },
  wrongful_fee: { en: "Wrongful fee", es: "Cobro indebido", pt: "Cobrança indevida" },
  transaction_status: { en: "Transaction status", es: "Estado de una transacción", pt: "Status de uma transação" },
  balance_check: { en: "Balance check", es: "Consulta de saldo", pt: "Consulta de saldo" },
  move_money: { en: "Move money (always refused)", es: "Mover dinero", pt: "Movimentar dinheiro" },
  human_agent: { en: "Talk to a person", es: "Hablar con una persona", pt: "Falar com uma pessoa" },
  out_of_scope: { en: "Out of scope", es: "Fuera de alcance", pt: "Fora do escopo" },
};

export const MODEL_LABELS: Record<string, { name: string; where: string }> = {
  "cohere-mv3": { name: "Cohere Embed Multilingual v3", where: "Amazon Bedrock · primary" },
  e5small: { name: "multilingual-e5-small", where: "In-app · fallback" },
  jev: { name: "Jev 1.13 (TypeSafe)", where: "TypeSafe API · experiment" },
};
