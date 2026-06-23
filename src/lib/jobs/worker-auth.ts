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
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = (await scrypt(token, salt, 64)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}
