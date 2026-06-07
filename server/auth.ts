import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_BYTES = 32;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type SessionToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [, salt, expectedKey] = passwordHash.split("$");
  if (!salt || !expectedKey) {
    return false;
  }

  const actual = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedKey, "base64url");
  return (
    actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
  );
}

export function createSessionToken(): SessionToken {
  const token = randomBytes(SESSION_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
