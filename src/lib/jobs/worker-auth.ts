import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function createWorkerToken() {
  return randomBytes(32).toString("base64url");
}

export async function hashWorkerToken(token: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(token, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("base64url")}`;
}

export async function verifyWorkerToken(token: string, storedHash: string) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;

  const [salt, hash] = parts;
  if (!salt || !hash || !isBase64Url(salt) || !isBase64Url(hash)) return false;

  try {
    const expected = Buffer.from(hash, "base64url");
    const actual = (await scrypt(token, salt, 64)) as Buffer;

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function readBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function isBase64Url(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
