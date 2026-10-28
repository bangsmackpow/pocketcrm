/**
 * Generates an unguessable 128-bit cryptographic URL-safe portal token for public document access.
 */
export function generatePortalToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
