import { createHash, randomBytes } from "node:crypto";

// RFC 7616, qop=auth. A new cnonce per exchange prevents nonce-count reuse across instances.
export function digestAuthorization(challenge: string, input: {
  username: string; password: string; method: string; uri: string; cnonce?: string;
}) {
  if (!/^Digest\s/i.test(challenge)) throw new Error("UnsupportedRpcAuthentication");
  const fields: Record<string, string> = {};
  for (const match of challenge.slice(7).matchAll(/([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g)) {
    fields[match[1].toLowerCase()] = (match[2] ?? match[3]).replace(/\\(.)/g, "$1");
  }
  const algorithm = (fields.algorithm || "MD5").toUpperCase();
  if (!["MD5", "MD5-SESS", "SHA-256", "SHA-256-SESS"].includes(algorithm) || !fields.realm || !fields.nonce) {
    throw new Error("UnsupportedRpcDigestChallenge");
  }
  if (!fields.qop?.split(",").map((value) => value.trim()).includes("auth")) throw new Error("RpcDigestAuthRequired");
  const hash = (value: string) => createHash(algorithm.startsWith("SHA-256") ? "sha256" : "md5").update(value).digest("hex");
  const cnonce = input.cnonce || randomBytes(16).toString("hex");
  const nc = "00000001";
  let ha1 = hash(`${input.username}:${fields.realm}:${input.password}`);
  if (algorithm.endsWith("-SESS")) ha1 = hash(`${ha1}:${fields.nonce}:${cnonce}`);
  const response = hash(`${ha1}:${fields.nonce}:${nc}:${cnonce}:auth:${hash(`${input.method}:${input.uri}`)}`);
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const values = { username: input.username, realm: fields.realm, nonce: fields.nonce, uri: input.uri, response, cnonce, ...(fields.opaque ? { opaque: fields.opaque } : {}) };
  return "Digest " + Object.entries(values).map(([name, value]) => `${name}=${quote(value)}`).join(", ") + `, algorithm=${algorithm}, qop=auth, nc=${nc}`;
}
