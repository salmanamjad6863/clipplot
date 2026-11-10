import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./api";

/** AES-256-GCM for secrets at rest (YouTube refresh token). Key = TOKEN_ENCRYPTION_KEY (64 hex chars). */
function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new HttpError(503, "TOKEN_ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

/** → "v1.<iv>.<tag>.<ciphertext>" (base64url) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized encrypted token format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
