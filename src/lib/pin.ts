import crypto from "crypto";

const HASH_PREFIX = "pbkdf2_sha512";
const ITERATIONS = 600000;
const KEY_LENGTH = 64;

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidPinFormat(pin: string | undefined): pin is string {
  return !!pin && /^\d{6}$/.test(pin);
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto.pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, "sha512").toString("hex");
  return `${HASH_PREFIX}$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPin(input: string | undefined, stored: string | null | undefined): boolean {
  if (!input || !stored) return false;

  if (!stored.startsWith(`${HASH_PREFIX}$`)) {
    return timingSafeEqualText(input, stored);
  }

  const [, iterationsRaw, salt, expectedHash] = stored.split("$");
  const iterations = Number(iterationsRaw);
  if (!iterations || !salt || !expectedHash) return false;

  const actualHash = crypto.pbkdf2Sync(input, salt, iterations, KEY_LENGTH, "sha512").toString("hex");
  return timingSafeEqualText(actualHash, expectedHash);
}
