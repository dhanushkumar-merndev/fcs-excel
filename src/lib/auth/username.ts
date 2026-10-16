/**
 * Staff sign in with a username. Supabase Auth still needs an email, so username-only accounts get
 * an internal address on the reserved .invalid TLD, which can never receive mail.
 * Shared by the browser, server actions and scripts (no server-only imports).
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const USERNAME_RULES = "3–32 characters: lowercase letters, numbers, dot, dash or underscore.";
export const LOGIN_EMAIL_DOMAIN = "fcs-staff.invalid";
export const MIN_PASSWORD = 8;

export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const isValidUsername = (value: string) => USERNAME_PATTERN.test(value);
export const loginEmailFor = (username: string) => `${username}@${LOGIN_EMAIL_DOMAIN}`;

/** "Sakthi Gayathri" → "sakthi"; falls back to the joined name when the first word is too short. */
export function suggestUsername(fullName: string) {
  const words = fullName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const candidate = first.length >= 3 ? first : words.join("");
  return candidate.slice(0, 32);
}

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Readable random password (no 0/O, 1/l/I) for an admin to hand over. */
export function generatePassword(length = 10) {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return out;
}
