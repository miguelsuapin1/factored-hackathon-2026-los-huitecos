// Sensitive-data masking at the door (docs/handoff.md H4). Runs on every customer message before anything else, so a
// card number, PIN or CVV never reaches Cohere, Haiku, the logs, the conversation state or the cases table.
// Pure code, no runtime imports (tested by mask.test.ts).

export type MaskKind = "card" | "secret" | "email";

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
const LONG_NUMBER = /(?<![\d.,])\d(?:[ -]?\d){12,18}(?![\d.,])/g;
// A PIN, CVV, password or code followed by its value: "mi pin es 1234", "cvv: 123", "senha 9876", "clave abc123".
const SECRET = /\b(pin|nip|cvv2?|cvc|cv2|clave|contrase[ñn]a|password|senha|c[oó]digo de seguridad|c[oó]digo de seguran[çc]a|token|otp)\b(\s*(?:es|era|é|:|=|de)?\s*)([A-Za-z0-9]{3,12})/giu;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

export function maskSensitive(text: string): { text: string; masked: MaskKind[] } {
  const masked = new Set<MaskKind>();
  let out = text.replace(SECRET, (_m, label: string, sep: string) => {
    masked.add("secret");
    return `${label}${sep}[oculto]`;
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
