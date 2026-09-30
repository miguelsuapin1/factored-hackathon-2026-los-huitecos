// Sensitive-data masking at the door (docs/handoff.md H4). Runs on every customer message before anything else, so a
// card number, PIN or CVV never reaches Cohere, Haiku, the logs, the conversation state or the cases table.
// Pure code, no runtime imports (tested by mask.test.ts).

export type MaskKind = "card" | "secret" | "email" | "id" | "phone";

/** Luhn checksum: real card numbers pass it, most random long numbers don't. */
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// 13–19 digits, optionally grouped by spaces or dashes (card numbers; 18-digit CLABE accounts too).
// Not preceded/followed by a digit or by a separator+digit ("1.250,00" stays an amount), but ordinary punctuation
// after the number ("…1111, mi pin") must not stop the match: that bug let a card number through (lessons P14).
const LONG_NUMBER = /(?<!\d|\d[.,])\d(?:[ -]?\d){12,18}(?!\d|[.,]\d)/g;
// A PIN, CVV, password or code followed by its value: "mi pin es 1234", "cvv: 123", "senha 9876", "clave abc123".
const SECRET = /\b(pin|nip|cvv2?|cvc|cv2|clave|contrase[ñn]a|password|senha|c[oó]digo de seguridad|c[oó]digo de seguran[çc]a|token|otp)\b(\s*(?:es|era|é|:|=|de)?\s*)([A-Za-z0-9]{3,12})/giu;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// National IDs, only in formats that can't be an amount or a reference (docs/handoff.md H5):
const CURP = /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi; // Mexico, 18 characters
const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi; // Mexico tax id (companies 12, people 13 characters)
const CPF_FORMATTED = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g; // Brazil, 000.000.000-00 (check digits verified)
const CUIL = /(?<!\d)(?:20|23|24|27|30|33|34)-\d{8}-\d(?!\d)/g; // Argentina CUIL/CUIT, dashed
// Any ID or phone number right after its name: "mi DNI es 30123456", "cédula 1020304050", "CPF 12345678909",
// "celular: 55 1234 5678". A bare number without its label stays (it could be an amount or a reference).
const LABELLED_ID = /\b(dni|c[eé]dula|documento(?: de identidad)?|identidad|ine|rg|cpf|cuil|cuit|curp|rfc|pasaporte|passaporte)\b(\s*(?:es|é|:|n[uú]mero|no\.?|n[ºo°])?\s*)([A-Z0-9][A-Z0-9.\-]{4,17}[A-Z0-9])/giu;
const LABELLED_PHONE = /\b(tel[eé]fono|telefone|celular|cel|m[oó]vil|whatsapp|n[uú]mero de contacto)\b(\s*(?:es|é|:)?\s*)(\+?\d[\d\s-]{6,16}\d)/giu;
// A phone with a country code of the countries we serve (+52 MX, +55 BR, +57 CO, +54 AR).
const INTL_PHONE = /\+\s?(?:52|55|57|54)(?:[\s-]?\d){8,11}(?!\d)/g;

function cpfValid(formatted: string) {
  const d = formatted.replace(/\D/g, "").split("").map(Number);
  if (new Set(d).size === 1) return false;
  const check = (n: number) => {
    const sum = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === d[9] && check(10) === d[10];
}

export function maskSensitive(text: string): { text: string; masked: MaskKind[] } {
  const masked = new Set<MaskKind>();
  let out = text.replace(SECRET, (_m, label: string, sep: string) => {
    masked.add("secret");
    return `${label}${sep}[oculto]`;
  });
  // IDs and phones before card numbers, so a labelled 13+ digit ID isn't mistaken for a card.
  out = out.replace(LABELLED_PHONE, (_m, label: string, sep: string) => {
    masked.add("phone");
    return `${label}${sep}[teléfono]`;
  });
  out = out.replace(LABELLED_ID, (_m, label: string, sep: string) => {
    masked.add("id");
    return `${label}${sep}[documento]`;
  });
  const id = () => {
    masked.add("id");
    return "[documento]";
  };
  out = out.replace(CURP, id).replace(RFC, id).replace(CUIL, id);
  out = out.replace(CPF_FORMATTED, (m) => (cpfValid(m) ? id() : m));
  out = out.replace(INTL_PHONE, () => {
    masked.add("phone");
    return "[teléfono]";
  });
  out = out.replace(LONG_NUMBER, (m) => {
    const digits = m.replace(/[ -]/g, "");
    // 18 digits is the Mexican CLABE account format (no Luhn); otherwise require a valid card checksum.
    if (digits.length !== 18 && !luhn(digits)) return m;
    masked.add("card");
    return `****${digits.slice(-4)}`;
  });
  out = out.replace(EMAIL, () => {
    masked.add("email");
    return "[email]";
  });
  return { text: out, masked: [...masked] };
}
