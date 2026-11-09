import assert from "node:assert/strict";
import { createServer } from "node:http";
import { digestAuthorization } from "../src/lib/http-digest";

async function main() {
  const header = digestAuthorization('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"', {
    username: "Mufasa", password: "Circle Of Life", method: "GET", uri: "/dir/index.html", cnonce: "0a4f113b",
  });
  assert.ok(header.includes('response="6629fae49393a05397450978507c4ef1"'), "RFC digest reference vector");
  assert.throws(() => digestAuthorization("Basic realm=rpc", { username: "test", password: "test", method: "POST", uri: "/" }));
  let requests = 0;
  let mode: "success" | "timeout" | "error" = "success";
  const server = createServer(async (request, response) => {
    requests++;
    for await (const chunk of request) { void chunk; }
    if (mode === "timeout") return;
    if (mode === "error") { response.writeHead(500).end(); return; }
    if (!request.headers.authorization) {
      response.writeHead(401, { "WWW-Authenticate": 'Digest realm="rpc", nonce="test-nonce", qop="auth", algorithm=MD5' }).end();
      return;
    }
    const cnonce = /cnonce="([^"]+)"/.exec(request.headers.authorization)![1];
    assert.equal(request.headers.authorization, digestAuthorization('Digest realm="rpc", nonce="test-nonce", qop="auth", algorithm=MD5', {
      username: "rpc-user", password: "rpc-password", method: "POST", uri: "/json_rpc", cnonce,
    }));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ result: { version: 1 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.XMR_RPC_URL = `http://127.0.0.1:${address.port}/json_rpc`;
  process.env.XMR_RPC_USER = "rpc-user";
  process.env.XMR_RPC_PASS = "rpc-password";
  process.env.XMR_RPC_TIMEOUT_MS = "300";
  try {
    const { callRpc } = await import("../src/lib/monero-rpc");
    assert.equal((await callRpc("get_version")).version, 1);
    assert.equal(requests, 2);
    mode = "error"; requests = 0;
    await assert.rejects(callRpc("transfer"));
    assert.equal(requests, 1, "Never retry a daemon failure");
    mode = "timeout"; requests = 0;
    await assert.rejects(callRpc("transfer"));
    assert.equal(requests, 1, "Never retry an uncertain transfer");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  console.log("Digest RPC: reference vector, authenticated HTTP, timeout and failure checks passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
