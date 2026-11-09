import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SignJWT } from "jose";
import { generateKey, readPrivateKey, createMessage, sign, encrypt, readKey, readMessage, decrypt } from "openpgp";
import { chromium } from "@playwright/test";
import { hashPin } from "../src/lib/pin";

function rawHttpStatus(port: number, path: string, host: string) {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET", headers: { Host: host } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode || 0));
    });
    request.once("error", reject);
    request.end();
  });
}

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Browser tests require local PostgreSQL");
  const database = `market_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(database, /^market_test_[a-f0-9]{32}$/);
  url.pathname = "/postgres"; url.search = "";
  const control = new Pool({ connectionString: url.toString() });
  let db: PrismaClient | undefined;
  let pool: Pool | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let created = false;
  const secret = randomBytes(48).toString("hex");
  const sentinelKey = new TextEncoder().encode(`${secret}:signing:sentinel:v1`);
  const sessionKey = new TextEncoder().encode(`${secret}:signing:session:v1`);
  const base = "http://127.0.0.1:3014";
  const artifacts = join(tmpdir(), "market-browser-review");
  try {
    // Never attach to an existing process at the test port.
    const occupied = await fetch(`${base}/api/live`).then(() => true).catch(() => false);
    assert.ok(!occupied, "Port 3014 is in use");
    await control.query(`CREATE DATABASE "${database}"`); created = true;
    url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString() });
    for (const name of (await readdir("prisma/migrations")).sort()) {
      if (/^\d/.test(name)) await pool.query(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
    }
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const password = "BrowserTestPassword123!";
    const vendor = await db.user.create({ data: {
      username: "browser_vendor", role: "VENDOR", hasPaidBond: true, pin: hashPin("123456"),
      passwordHash: pbkdf2Sync(password, "browser-salt", 600000, 64, "sha512").toString("hex"), passwordSalt: "browser-salt",
      walletBalanceXMR: "1.234567890123", isPhraseViewed: true, antiPhishingPhrase: "exclusive test phrase",
    } });
    const pgp = await generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Browser Test" }], format: "armored" });
    await db.user.update({ where: { id: vendor.id }, data: { pgpPublicKey: pgp.publicKey } });
    const admin = await db.user.create({ data: { username: "browser_admin", role: "ADMIN", passwordHash: "test-only", pin: hashPin("123456"), pgpPublicKey: pgp.publicKey, isPhraseViewed: true } });
    const moderator = await db.user.create({ data: { username: "browser_moderator", role: "STAFF", passwordHash: "test-only", pin: hashPin("123456"), pgpPublicKey: pgp.publicKey, isPhraseViewed: true, staffPermissions: ["products", "support", "orders", "wallets", "system", "users"] } });
    const listing = await db.product.create({ data: { title: "Browser review listing", description: "Listing awaiting review", priceXMR: "0.2", vendorId: vendor.id, moderationStatus: "PENDING_REVIEW", isPaused: true } });
    const hiddenListing = await db.product.create({ data: { title: "Private pending listing", description: "Must not be exposed by URL", priceXMR: "0.3", vendorId: admin.id, moderationStatus: "PENDING_REVIEW", isPaused: true } });
    const ticket = await db.supportTicket.create({ data: { userId: vendor.id, subject: "Browser support case", category: "OTHER" } });
    const hiddenTicket = await db.supportTicket.create({ data: { userId: admin.id, subject: "Private support case", category: "OTHER" } });
    await db.marketConfig.create({ data: { id: "global_config" } });
    await db.withdrawalRequest.create({ data: { userId: vendor.id, amountXMR: "0.5", address: "test-only-address" } });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3014", "--hostname", "127.0.0.1"], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NODE_ENV: "production", DATABASE_URL: url.toString(), SESSION_SECRET: secret, ADMIN_URL_SECRET: "staff-e2e", ADMIN_MSID: "BROWSER-STAFF", ONION_URL: "127.0.0.1", PUBLIC_ONION_MIRRORS: "", XMR_RPC_URL: "http://127.0.0.1:9/json_rpc", XMR_RPC_TIMEOUT_MS: "100" },
    });
    server.stderr?.on("data", (chunk) => console.log("TEST SERVER:", String(chunk).replace(/\?[^\s"<>]+/g, "?omitted")));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
      assert.equal(server.exitCode, null, "Test server exited unexpectedly");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, "Web health stays up without RPC");
    assert.deepEqual(await health.json(), { ok: true }, "Public health does not expose deployment metadata");
    assert.equal((await fetch(`${base}/api/health/wallet`)).status, 401);
    assert.equal((await fetch(`${base}/api/wallet/sync`)).status, 405, "Wallet mutation rejects GET");
    assert.equal((await fetch(`${base}/auth/logout`, { redirect: "manual" })).status, 405, "Logout rejects GET CSRF");
    assert.equal(await rawHttpStatus(3014, "/api/live", "attacker.invalid"), 421, "Forged hosts are rejected");
    assert.equal((await fetch(`${base}/api/sentinel/start`, { method: "POST", headers: { Origin: "https://foreign.example" }, redirect: "manual" })).status, 403, "Sentinel mutation rejects foreign origins");
    const rejected = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { Origin: "https://foreign.example" }, body: new URLSearchParams({ username: vendor.username, password }), redirect: "manual" });
    assert.equal(rejected.status, 403);
    const sentinel = await new SignJWT({ verified: true }).setProtectedHeader({ alg: "HS256" }).setIssuer("olympus-market").setAudience("olympus-sentinel").setIssuedAt().setExpirationTime("1h").sign(sentinelKey);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.addCookies([{ name: "os_sentinel_v2", value: sentinel, url: base, httpOnly: true, sameSite: "Strict" }]);
    const page = await context.newPage();
    const loginHeaders = (await context.request.get(`${base}/auth/login`)).headers();
    assert.equal(loginHeaders["cache-control"], "no-store, max-age=0");
    assert.equal(loginHeaders["cross-origin-opener-policy"], "same-origin");
    assert.equal(loginHeaders["cross-origin-resource-policy"], "same-origin");
    assert.equal(loginHeaders["x-permitted-cross-domain-policies"], "none");
    assert.equal(loginHeaders["x-xss-protection"], "0");
    const legacySession = await new SignJWT({ userId: admin.id, role: "ADMIN", sessionVersion: 0 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    const legacyDenied = await fetch(`${base}/staff-e2e`, { headers: { Cookie: `os_sentinel_v2=${sentinel}; os_sid_v2=${legacySession}` }, redirect: "manual" });
    assert.ok(legacyDenied.headers.get("location")?.includes("/auth/login"), "Legacy unscoped session tokens are rejected");
    page.on("requestfailed", (request) => { if (request.isNavigationRequest()) console.log("FAILED", new URL(request.url()).pathname, request.failure()?.errorText); });
    const adminProbe = await context.request.get(`${base}/staff-e2e/verify`, { maxRedirects: 0 });
    assert.equal(adminProbe.status(), 307);
    assert.equal(new URL(adminProbe.headers().location, base).origin, base);
    await page.goto(`${base}/auth/login?step=phrase_reveal&userId=${vendor.id}&token=forged`);
    assert.ok(!(await page.content()).includes("exclusive test phrase"), "Forged token must not disclose the phrase");
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("script-src")) console.log("BROWSER:", message.text().replace(/\?[^\s"<>]+/g, "?omitted")); });
    const apiLogin = await context.request.post(`${base}/api/auth/login`, { headers: { Origin: base }, form: { username: vendor.username, password }, maxRedirects: 0 });
    assert.equal(apiLogin.status(), 303);
    assert.ok(apiLogin.headers().location.startsWith("/auth/login"), "Redirect stays on the current mirror");
    assert.ok(!/[?&](token|userId|cid)=/.test(apiLogin.headers().location), "Authentication secrets never enter redirect URLs");
    await page.goto(`${base}/auth/login`);
    await page.locator('input[name="username"]').fill(vendor.username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([page.waitForURL(/step=verify_url/, { waitUntil: "domcontentloaded" }), page.locator('form[action="/api/auth/login"] button[type="submit"]').click()]);
    await Promise.all([page.waitForURL(/step=2fa/, { waitUntil: "domcontentloaded" }), page.locator('form[action="/api/auth/complete"] button[type="submit"]').click()]);
    const encryptedChallenge = await page.locator('textarea[readonly]').inputValue();
    const decryptedChallenge = await decrypt({
      message: await readMessage({ armoredMessage: encryptedChallenge }),
      decryptionKeys: await readPrivateKey({ armoredKey: pgp.privateKey }),
    });
    const loginToken = String(decryptedChallenge.data).match(/[A-F0-9]{12}/)?.[0];
    assert.ok(loginToken, "PGP login challenge contains a token");
    await page.locator('input[name="pgp_token"]').fill(loginToken);
    await Promise.all([page.waitForURL(/\/market/, { waitUntil: "domcontentloaded" }), page.locator('form[action="/api/auth/pgp"] button[type="submit"]').click()]);
    await page.goto(`${base}/market/wallet?success=WithdrawalAwaitingApproval`);
    assert.ok((await page.textContent("body"))?.includes("The amount has been reserved"));
    assert.ok(!(await page.textContent("body"))?.includes("TRANSACTION TRANSMITTED"));
    assert.equal(await page.locator('label[for="withdraw-address"]').count(), 1);
    assert.equal((await page.goto(`${base}/market/product/${hiddenListing.id}`))?.status(), 404, "Pending listings are hidden from unrelated users");
    assert.equal((await page.goto(`${base}/market/support/${hiddenTicket.id}`))?.status(), 404, "Support tickets enforce participant ownership");
    await mkdir(artifacts, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      // evaluate is test instrumentation; page scripts remain disabled.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.ok(!overflow, `Document overflows at ${width}px`);
      await page.screenshot({ path: join(artifacts, `wallet-${width}.png`), fullPage: true });
    }
    const adminSessionId = randomUUID();
    await db.authSession.create({ data: { id: adminSessionId, userId: admin.id, role: "ADMIN", expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const adminToken = await new SignJWT({ userId: admin.id, role: "ADMIN", sessionVersion: 0, sessionId: adminSessionId }).setProtectedHeader({ alg: "HS256" }).setIssuer("olympus-market").setAudience("olympus-session").setSubject(admin.id).setIssuedAt().setExpirationTime("30m").sign(sessionKey);
    await context.addCookies([{ name: "os_sid_v2", value: adminToken, url: base, httpOnly: true, sameSite: "Strict" }]);
    const staffResponse = await page.goto(`${base}/staff-e2e/verify`);
    assert.equal(staffResponse?.status(), 200);
    const challenge = await page.locator('input[name="challenge"]').inputValue();
    const signature = await sign({ message: await createMessage({ text: challenge }), signingKeys: await readPrivateKey({ armoredKey: pgp.privateKey }), detached: true });
    await page.locator('input[name="msid"]').fill("BROWSER-STAFF");
    await page.locator('input[name="pin"]').fill("123456");
    await page.locator('textarea[name="signature"]').fill(signature);
    await Promise.all([page.waitForURL(/success=ACCESS_GRANTED/, { waitUntil: "domcontentloaded" }), page.locator('button[type="submit"]').click()]);
    for (const tab of ["overview", "users", "wallets", "logs", "support"]) {
      const response = await page.goto(`${base}/staff-e2e?tab=${tab}`);
      assert.equal(response?.status(), 200, `Admin tab ${tab}`);
      assert.ok(!(await page.textContent("body"))?.includes("Application error"));
    }
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    await page.goto(`${base}/staff-e2e`);
    assert.ok(page.url().includes("/auth/login"), "Revoked session cannot access staff pages");
    const moderatorSessionId = randomUUID();
    await db.authSession.create({ data: { id: moderatorSessionId, userId: moderator.id, role: "STAFF", expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const moderatorToken = await new SignJWT({ userId: moderator.id, role: "STAFF", sessionVersion: 0, sessionId: moderatorSessionId }).setProtectedHeader({ alg: "HS256" }).setIssuer("olympus-market").setAudience("olympus-session").setSubject(moderator.id).setIssuedAt().setExpirationTime("30m").sign(sessionKey);
    await context.addCookies([{ name: "os_sid_v2", value: moderatorToken, url: base, httpOnly: true, sameSite: "Strict" }]);
    await page.goto(`${base}/moderator`);
    assert.ok(page.url().includes("/moderator/verify"));
    assert.equal(await page.locator('input[name="msid"]').count(), 0, "Moderators must not need the master administrator ID");
    const moderatorChallenge = await page.locator('input[name="challenge"]').inputValue();
    const moderatorSignature = await sign({ message: await createMessage({ text: moderatorChallenge }), signingKeys: await readPrivateKey({ armoredKey: pgp.privateKey }), detached: true });
    await page.locator('input[name="pin"]').fill("123456");
    await page.locator('textarea[name="signature"]').fill(moderatorSignature);
    await Promise.all([page.waitForURL(/success=ACCESS_GRANTED/, { waitUntil: "domcontentloaded" }), page.locator('button[type="submit"]').click()]);
    assert.equal(new URL(page.url()).pathname, "/moderator");
    assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
    assert.ok((await page.textContent("body"))?.includes("Browser review listing"));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(!await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `Moderator overflow at ${width}px`);
      await page.screenshot({ path: join(artifacts, `moderator-${width}.png`), fullPage: true });
    }
    const reviewFormLocator = page.locator(`form:has(input[name="productId"][value="${listing.id}"])`);
    const reviewForm = await reviewFormLocator.evaluate((form) => Object.fromEntries(Array.from(new FormData(form as HTMLFormElement).entries(), ([key, value]) => [key, String(value)])));
    await reviewFormLocator.locator('select[name="decision"]').selectOption("APPROVED");
    await reviewFormLocator.locator('textarea[name="note"]').fill("Reviewed in browser integration test");
    await Promise.all([page.waitForURL(/success=ProductModerated/, { waitUntil: "domcontentloaded" }), reviewFormLocator.getByRole("button", { name: "Save review" }).click()]);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: listing.id } })).moderationStatus, "APPROVED");
    assert.equal(new URL(page.url()).pathname, "/moderator", "Moderator actions return to their workspace");
    await page.goto(`${base}/moderator?tab=support`);
    assert.ok((await page.textContent("body"))?.includes(ticket.subject));
    await page.locator(`a[href="/market/support/${ticket.id}"]`).click();
    assert.equal(new URL(page.url()).pathname, `/market/support/${ticket.id}`);
    assert.equal(await page.locator('textarea[name="content"]').count(), 1);
    const encryptedReply = await encrypt({ message: await createMessage({ text: "Browser moderator reply" }), encryptionKeys: await readKey({ armoredKey: pgp.publicKey }) });
    await page.locator('textarea[name="content"]').fill(encryptedReply);
    await Promise.all([page.waitForURL(/success=ReplySent/, { waitUntil: "domcontentloaded" }), page.locator('form:has(textarea[name="content"]) button[type="submit"]').click()]);
    assert.equal((await db.ticketMessage.findFirstOrThrow({ where: { ticketId: ticket.id } })).senderRole, "STAFF");
    await page.goto(`${base}/staff-e2e?tab=wallets`);
    assert.equal(new URL(page.url()).pathname, "/moderator", "Moderator cannot enter administrator workspace");
    assert.equal(await page.locator('a[href*="tab=wallets"]').count(), 0);
    // Chromium accepts Secure cookies on loopback HTTP; APIRequestContext does not.
    // Forward this isolated test context's cookies explicitly for direct endpoint checks.
    const moderatorCookies = (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join("; ");
    const adminApiDenied = await context.request.post(`${base}/api/admin/announcements/expire`, { headers: { Origin: base, Cookie: moderatorCookies }, form: { announcementId: "missing" }, maxRedirects: 0 });
    assert.equal(adminApiDenied.status(), 403, "Administrative APIs reject moderators");
    await db.user.update({ where: { id: moderator.id }, data: { staffPermissions: [] } });
    const forbiddenReview = await context.request.post(`${base}/moderator`, { headers: { Origin: base, Cookie: moderatorCookies }, multipart: { ...reviewForm, decision: "REJECTED" }, maxRedirects: 0 });
    assert.ok(forbiddenReview.status() >= 400, `Server action checks revoked permissions (${forbiddenReview.status()})`);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: listing.id } })).moderationStatus, "APPROVED");
    await db.user.update({ where: { id: moderator.id }, data: { staffPermissions: ["products"] } });
    const deniedTicket = await page.goto(`${base}/market/support/${ticket.id}`);
    assert.equal(deniedTicket?.status(), 404, "Revoked support permission applies immediately");
    await page.goto(`${base}/moderator?tab=support`);
    assert.ok(!(await page.textContent("body"))?.includes(ticket.subject));
    await db.user.update({ where: { id: moderator.id }, data: { sessionVersion: { increment: 1 } } });
    await page.goto(`${base}/moderator`);
    assert.ok(page.url().includes("/auth/login"), "Revoked moderator session is denied");
    console.log(`PASS: browser without JavaScript, login, phrase protection, CSRF, wallet, mobile/desktop, real PGP staff verification, five admin tabs, separate moderator workspace, moderation persistence, live permission revocation and session revocation. Screenshots: ${artifacts}`);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => server!.once("exit", resolve)); }
    await db?.$disconnect();
    if (pool && !pool.ended) await pool.end();
    if (created) { await control.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [database]); await control.query(`DROP DATABASE "${database}"`); }
    await control.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
