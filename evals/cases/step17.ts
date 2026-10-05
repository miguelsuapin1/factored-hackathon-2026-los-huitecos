// Persona test conversations: responsive Brazilian-Portuguese personas from evals/cases/step17_source.csv (the long
// rows; the wide rows above them are an earlier draft of the same scenarios, with shifted columns).
// Provenance: LLM-drafted, edited by Luis Pedro (2026-09-30). The source amounts, dates and merchants exist for no
// customer with a login, so each was swapped for a real charge of an agreed customer (docs/contracts.md K5), keeping
// the wording; replies missing for the confirmation were added as a plain "sim". Every change is listed in `edits`.
// Synthetic, not human-written: these are not the judges' numbers (the human-written messages are).
import type { PersonaCase } from "../case";

const SOURCE = "LLM-drafted, edited by Luis Pedro (2026-09-30); charges swapped to K5 by Claude (2026-10-01)";
const base = { lang: "pt", source: SOURCE, basis: "doc" } as const;
const REVIEW = { kind: "review", verified: true } as const;
const HANDOFF = { kind: "handoff", verified: true } as const;

export const STEP17: readonly PersonaCase[] = [
  {
    ...base, id: "TC17-03", login: "demo.mx", outcome: "resolved", rules: ["C13", "PL-10", "C14", "PL-7"],
    title: "Doesn't remember the date: two charges listed, a half-remembered merchant picks one, review",
    persona: "homem de 39 anos, mora em SP, apressado e meio desconfiado do app",
    opening: "tem uma compra de uns 350 dolares no meu cartao q eu nao faço ideia do que seja",
    replies: {
      details: "valor é uns 350 dolares, mas a data eu nao lembro mesmo",
      merchant: "agora q vc falou acho q aparecia algo tipo Tienda Don José, mas nao tenho certeza",
      confirm: "sim, é essa",
      clarify: "é cobrança que eu nao reconheço",
      offer: "quero sim abrir contestação, eu nao fiz essa compra",
    },
    final: { rule: "PL-7", match: "TRX-DEMO0000000000009", case: REVIEW },
    edits: "'quase 500' / 'uns 497' → 'uns 350'; 'Tienda General' → 'Tienda Don José'.",
  },
  {
    ...base, id: "TC17-11", login: "pendiente.ar", outcome: "resolved", rules: ["PL-7", "PL-6"],
    title: "ATM withdrawal not made, formal: review; fraud score 29.60 sits just under the cutoff",
    persona: "mulher de 52 anos, brasileira vivendo na Colômbia, formal e preocupada",
    opening: "Boa tarde. Apareceu uma retirada em caixa eletrônico que eu não fiz. Estou com meu cartão aqui comigo.",
    replies: {
      details: "Foi no dia 23 de maio, valor 385,41 dólares",
      confirm: "sim",
      clarify: "Não reconheço essa retirada, eu não usei caixa eletrônico nesse dia.",
      offer: "Sim, por favor. Eu não fiz essa retirada.",
    },
    final: { rule: "PL-7", match: "TRX-E5OTG7YNKVLRYJPHC7U4", case: REVIEW },
    edits: "'11 de maio, 499,75' → '23 de maio, 385,41'.",
  },
  {
    ...base, id: "TC17-12", login: "rechazado-sin-codigo.co", outcome: "resolved", rules: ["PL-7"],
    title: "Withdrawal not made, written fast with a slashed date: review",
    persona: "jovem de 24 anos, Recife, escreve rápido e sem muita pontuação",
    opening: "oi apareceu uma retirada de 72,05 dolares no app e eu nao saquei nada",
    replies: {
      details: "foi dia 25/02 e o valor é 72.05 usd",
      confirm: "sim",
      clarify: "é uma retirada q eu nao reconheço",
    },
    final: { rule: "PL-7", match: "TRX-4SAR69NU78Q4GUDQ926N", case: REVIEW },
    edits: "'56,16' → '72,05'; '27/02' → '25/02'; confirm reply 'sim' added.",
  },
  {
    ...base, id: "TC17-13", login: "demo.mx", outcome: "resolved", rules: ["S1", "PL-5", "S3"],
    title: "Why was my payment declined: explained, the agent offer is declined, no case",
    persona: "homem de 31 anos, Belo Horizonte, calmo e objetivo",
    opening: "Queria entender por que meu pagamento de 560 dólares foi recusado.",
    replies: {
      details: "Foi em 14 de junho, 560 USD",
      offer: "Não precisa, obrigado. Eu só queria saber mesmo.",
      clarify: "É sobre um pagamento que foi recusado, quero entender o motivo.",
    },
    final: { rule: "PL-5", match: "TRX-DEMO0000000000006", case: null },
    edits: "'160,16' → '560'; '27 de março' → '14 de junho'.",
  },
  {
    ...base, id: "TC17-21", login: "rechazado-sin-codigo.co", outcome: "resolved", rules: ["S1", "PL-5", "E4"],
    title: "What happened to a COP payment (millions, mixed formats): declined, no reason on record",
    persona: "mulher de 44 anos, mora há anos na Colômbia, mistura um pouco formatos e está confusa",
    opening: "Oi, queria saber o que aconteceu com um pagamento meu de 7.323.195,33 pesos. No app ficou estranho.",
    replies: {
      details: "Foi no dia 26 de maio, valor 7.323.195,33 COP",
      clarify: "é outro assunto, quero entender o que aconteceu com esse pagamento",
    },
    final: { rule: "PL-5", match: "TRX-9SINWMOKM1OQBAFUPXBT", case: null },
    edits: "'4.986.658,99' → '7.323.195,33'; '8 de abril' → '26 de maio'.",
  },
  {
    ...base, id: "TC17-23", login: "demo.mx", outcome: "handed_off", rules: ["PL-6"],
    title: "Angry about an unknown merchant: high fraud score, a person, no mention of fraud",
    persona: "homem de 46 anos, Curitiba, irritado mas educado",
    opening: "Apareceu uma cobrança de Conciertos Live na minha conta e eu não tenho nada com essa empresa.",
    replies: {
      details: "3 de junho, 120 dólares",
      confirm: "sim",
      clarify: "É uma cobrança que eu não reconheço.",
    },
    final: { rule: "PL-6", match: "TRX-DEMO0000000000003", case: HANDOFF },
    edits: "'Servicios Públicos' → 'Conciertos Live'; '30 de abril, 1.239.281,41 pesos' → '3 de junho, 120 dólares'; confirm reply 'sim' added.",
  },
  {
    ...base, id: "TC17-26", login: "demo.mx", outcome: "handed_off", rules: ["C13", "PL-2"],
    title: "Senior asks about a Cable TV charge, doesn't know the day: monthly subscription, a person",
    persona: "mulher de 63 anos, interior de Goiás, pouco confortável com aplicativo",
    opening: "quero saber o que aconteceu com uma cobrança de Cable TV de 89,90 dólares",
    replies: {
      details: "o dia eu nao sei",
      clarify: "quero saber o que aconteceu com essa cobrança",
    },
    final: { rule: "PL-2", case: HANDOFF },
    edits: "'37930 pesos' → '89,90 dólares'; 'foi em janeiro, o dia eu nao sei' → 'o dia eu nao sei' (no January charge).",
    note: "Ends with a person today (EF-1) and after EF-1's fix too: the customer doesn't know the day.",
  },
  {
    ...base, id: "TC17-27", login: "demo.mx", outcome: "resolved", rules: ["C13", "PL-2", "PL-7"],
    title: "Never had cable TV, gives the date when asked: the April charge goes to review",
    persona: "homem de 28 anos, Salvador, direto e incomodado",
    opening: "tem 89,90 dolares de Cable TV no meu cartao, mas eu nunca tive tv a cabo",
    replies: {
      details: "12 de abril, 89.90 USD, aparece como Cable TV",
      confirm: "sim",
      clarify: "cobrança que eu nao reconheço",
    },
    final: { rule: "PL-7", match: "TRX-DEMO0000000000010", case: REVIEW },
    edits: "'403,78' → '89,90'; '5 de abril' → '12 de abril'; confirm reply 'sim' added.",
    note: "Expected to fail until EF-1 is fixed: amount + merchant hand off on turn 1, before the date is asked.",
  },
  {
    ...base, id: "TC17-32", login: "pendiente.ar", outcome: "resolved", rules: ["PL-7", "F"],
    title: "Detail-oriented customer in Argentina, ARS charge: review (null fraud score is not high risk)",
    persona: "mulher de 35 anos, São Paulo morando na Argentina, detalhista e educada",
    opening: "Olá, apareceu uma cobrança de Estación de Servicio de 4.093,50 pesos argentinos e eu nunca fiz isso.",
    replies: {
      details: "Foi em 2 de junho, valor 4.093,50 ARS, Estación de Servicio",
      confirm: "sim, essa mesma",
      clarify: "É uma cobrança que eu não reconheço.",
      offer: "Sim, quero contestar. Eu não fiz essa cobrança.",
    },
    final: { rule: "PL-7", match: "TRX-SXIOLJ5ZKWC1BEENJPHX", case: REVIEW },
    edits: "'Cable TV' → 'Estación de Servicio'; '9.849,66' → '4.093,50'; '16 de abril' → '2 de junho'; 'nunca assinei' → 'nunca fiz'.",
  },
  {
    ...base, id: "TC17-34", login: "demo.mx", outcome: "handed_off", rules: ["C3", "DLG-human", "H2"],
    title: "Impatient: asks for a person at the confirmation, the case carries the charge",
    persona: "homem de 40 anos, Rio de Janeiro, impaciente e quer atendimento humano",
    opening: "Dia 12 apareceu 25 dolares no Super Ahorro e eu nunca nem fui nessa loja",
    replies: {
      details: "dia 12 de junho, 25 USD, Super Ahorro",
      confirm: "quero falar com um atendente humano por favor",
      clarify: "é cobrança que eu nao reconheço",
      offer: "Sim, abre contestação. Eu não fiz essa compra.",
    },
    final: { rule: "DLG-human", match: "TRX-DEMO0000000000008", case: HANDOFF },
    edits: "'Hoje … 31.11' → 'Dia 12 … 25'; 'hoje, 17 de junho, 31.11' → 'dia 12 de junho, 25'.",
  },
  {
    ...base, id: "TC17-37", login: "demo.mx", outcome: "refused", rules: ["move_money", "C10"],
    title: "Demands a refund now and rejects review and agent: refused, nothing opened",
    persona: "mulher de 49 anos, Porto Alegre, muito irritada e exigente",
    opening: "quero que devolvam agora os 350 dolares que o Super Ahorro tirou da minha conta",
    replies: {
      offer: "não quero revisão nem atendente, eu quero meu dinheiro de volta agora",
      clarify: "é sobre esse débito do Super Ahorro, eu quero o estorno",
    },
    final: { case: null },
    edits: "'135.768,30 pesos' → '350 dolares'; 'Centro Comercial' → 'Super Ahorro'.",
  },
];
