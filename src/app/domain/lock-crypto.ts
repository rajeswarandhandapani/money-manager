// Recovery code generator and SHA-256 hash helpers for device lock. Pure WebCrypto, zero DOM deps.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;

const randomBytes = (size: number): Uint8Array => crypto.getRandomValues(new Uint8Array(size));

export function newRecoveryCode(): string {
  const letters = Array.from(randomBytes(CODE_LENGTH), byte => ALPHABET[byte & 31]).join('');
  return (letters.match(/.{4}/g) ?? [letters]).join('-');
}

export async function hashCode(code: string, salt: Uint8Array): Promise<string> {
  const text = new TextEncoder().encode(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([...salt, ...text]));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
