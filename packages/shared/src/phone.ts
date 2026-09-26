/**
 * Normalises phone numbers to E.164. Defaults to Pakistan (+92) for local formats:
 * "0300 1234567", "03001234567", "923001234567", "+92 300-1234567", "0092300..." → "+923001234567".
 * Returns null when the input can't be a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = "92"): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = defaultCountryCode + digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  // Pakistani mobiles: +92 3XX XXXXXXX (12 digits total)
  if (digits.startsWith("92") && digits[2] === "3" && digits.length !== 12) return null;
  return `+${digits}`;
}
