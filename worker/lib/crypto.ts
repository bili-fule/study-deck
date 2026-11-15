/**
 * Password hashing and token primitives.
 *
 * Workers WebCrypto (workerd) currently rejects PBKDF2 iteration counts above
 * 100,000 unless the deployment raises the cap; 100,000 is therefore the
 * strongest iteration count that is guaranteed to work on production Workers.
 * The encoded hash records the algorithm and iteration count so the scheme can
 * be upgraded without a database migration (existing hashes keep verifying).
 * See docs/BACKEND.md.
 */
export const PASSWORD_SCHEME = "pbkdf2-sha256";
export const PASSWORD_ITERATIONS = 100_000;

const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;
const MIN_VERIFY_ITERATIONS = 10_000;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Cryptographically secure random token; base64url without padding. */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    DERIVED_KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_SCHEME) return false;
  const iterations = Number.parseInt(parts[1]!, 10);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_VERIFY_ITERATIONS ||
    iterations > PASSWORD_ITERATIONS
  ) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64UrlDecode(parts[2]!);
    expected = base64UrlDecode(parts[3]!);
  } catch {
    return false;
  }
  if (salt.byteLength !== SALT_BYTES || expected.byteLength !== DERIVED_KEY_BITS / 8) {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  // Workers-native constant-time comparison; both buffers are fixed 32 bytes.
  return crypto.subtle.timingSafeEqual(actual, expected);
}
