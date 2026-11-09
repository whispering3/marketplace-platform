export function isPgpArmoredMessage(value: string | undefined | null): value is string {
  if (!value) return false;
  if (value.length > 65_536) return false;
  const trimmed = value.trim();
  return trimmed.startsWith("-----BEGIN PGP MESSAGE-----")
    && trimmed.endsWith("-----END PGP MESSAGE-----")
    && !trimmed.slice("-----BEGIN PGP MESSAGE-----".length).includes("-----BEGIN PGP MESSAGE-----");
}

export function requirePgpArmoredMessage(value: string | undefined | null, fieldName: string): string {
  if (!isPgpArmoredMessage(value)) {
    throw new Error(`${fieldName}MustBePgpEncrypted`);
  }
  return value.trim();
}
