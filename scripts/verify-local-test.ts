import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { SignJWT } from "jose";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createMessage, decrypt, generateKey, readMessage, readPrivateKey, sign } from "openpgp";
import { Pool } from "pg";

dotenv.config({ path: ".local-test/runtime.env", override: true });

const baseUrl = "http://localhost:3000";
const accounts = {
  buyer: { username: "demo_buyer", password: "DemoBuyer#2026!", destination: "/market" },
  vendor: { username: "demo_vendor", password: "DemoVendor#2026!", destination: "/market/dashboard/vendor" },
  moderator: { username: "demo_moderator", password: "DemoModerator#2026!", pin: "445566", destination: "/moderator" },
  admin: { username: "demo_admin", password: "DemoAdmin#2026!", pin: "112233", msid: process.env.ADMIN_MSID, destination: `/${process.env.ADMIN_URL_SECRET}` },
} as const;

async function createContext(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret, "SESSION_SECRET is missing from .local-test/runtime.env");
  const sentinel = await new SignJWT({ verified: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("olympus-market")
    .setAudience("olympus-sentinel")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(`${secret}:signing:sentinel:v1`));
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies([{ name: "os_sentinel_v2", value: sentinel, url: baseUrl, httpOnly: true, sameSite: "Strict" }]);
  return context;
}

async function submitLogin(page: Page, username: string, password: string) {
  await page.goto(`${baseUrl}/auth/login`);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/step=verify_url/, { waitUntil: "domcontentloaded" }),
    page.locator('form[action="/api/auth/login"] button[type="submit"]').click(),
  ]);
  assert.ok((await page.textContent("body"))?.includes("DOMAIN VERIFICATION STATUS"), `${username}: URL verification was not shown`);
  await Promise.all([
    page.waitForURL(/(step=2fa|step=pgp_setup|\/market)/, { waitUntil: "domcontentloaded" }),
    page.locator('form[action="/api/auth/complete"] button[type="submit"]').click(),
  ]);
}

async function submitPgpChallenge(
  page: Page,
  privateKey: Awaited<ReturnType<typeof readPrivateKey>>,
  destination: RegExp,
) {
  const armoredMessage = await page.locator("textarea[readonly]").inputValue();
  const decrypted = await decrypt({ message: await readMessage({ armoredMessage }), decryptionKeys: privateKey });
  const token = String(decrypted.data).match(/Login verification token:\s*(\S+)/)?.[1];
  assert.ok(token, "The PGP login token could not be decrypted");
  await page.locator('input[name="pgp_token"]').fill(token);
  await Promise.all([
    page.waitForURL(destination, { waitUntil: "domcontentloaded" }),
    page.locator('form[action="/api/auth/pgp"] button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
}

async function completePgpLogin(page: Page, account: keyof typeof accounts) {
  const privateKey = await readPrivateKey({ armoredKey: await readFile(`.local-test/${account}-private-key.asc`, "utf8") });
  const destination = account === "admin" || account === "moderator"
    ? /\/(moderator|staff-local-[^/]+)\/verify/
    : /\/market/;
  await submitPgpChallenge(page, privateKey, destination);
  return privateKey;
}

async function verifyMandatoryPgpEnrollment(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  username: string,
  password: string,
  publicKey: string,
  privateKeyArmored: string,
) {
  const privateKey = await readPrivateKey({ armoredKey: privateKeyArmored });
  const firstContext = await createContext(browser);
  try {
    const page = await firstContext.newPage();
    await submitLogin(page, username, password);
    assert.ok(page.url().includes("step=pgp_setup"), "An account without PGP was not sent to mandatory enrollment");
    assert.match((await page.textContent("body")) || "", /PGP verification is required on this login and every future login/);
    await page.locator('textarea[name="pgp_public_key"]').fill(publicKey);
    await Promise.all([
      page.waitForURL(/step=2fa.*enrolled=1/, { waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "SAVE KEY AND VERIFY 2FA" }).click(),
    ]);
    await submitPgpChallenge(page, privateKey, /\/market/);
    assert.ok(new URL(page.url()).pathname.startsWith("/market"), "First login did not finish after PGP enrollment");
  } finally {
    await firstContext.close();
  }

  const returningContext = await createContext(browser);
  try {
    const page = await returningContext.newPage();
    await submitLogin(page, username, password);
    assert.ok(page.url().includes("step=2fa"), "Returning login did not require PGP 2FA");
    assert.ok(!page.url().includes("step=pgp_setup"), "Returning user was incorrectly sent through enrollment again");
    await submitPgpChallenge(page, privateKey, /\/market/);
  } finally {
    await returningContext.close();
  }
}

async function completeStaffVerification(page: Page, account: "admin" | "moderator", privateKey: Awaited<ReturnType<typeof readPrivateKey>>) {
  const credentials = accounts[account];
  const challengeInput = page.locator('input[name="challenge"]');
  try {
    await challengeInput.waitFor({ state: "attached", timeout: 60_000 });
  } catch {
    throw new Error(`${account}: staff challenge did not render at ${page.url()}\n${(await page.textContent("body"))?.slice(0, 500)}`);
  }
  const challenge = await challengeInput.inputValue();
  const signature = await sign({ message: await createMessage({ text: challenge }), signingKeys: privateKey, detached: true });
  if (account === "admin") {
    assert.ok(accounts.admin.msid, "ADMIN_MSID is missing from .local-test/runtime.env");
    await page.locator('input[name="msid"]').fill(accounts.admin.msid);
  } else {
    assert.equal(await page.locator('input[name="msid"]').count(), 0, "Moderator must not receive the administrator MSID field");
  }
  await page.locator('input[name="pin"]').fill(credentials.pin);
  await page.locator('textarea[name="signature"]').fill(signature);
  await Promise.all([
    page.waitForURL(/success=ACCESS_GRANTED/, { waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Verify and open workspace" }).click(),
  ]);
}

async function verifyAccount(context: BrowserContext, account: keyof typeof accounts, notificationId?: string) {
  const page = await context.newPage();
  const credentials = accounts[account];
  await submitLogin(page, credentials.username, credentials.password);
  const privateKey = await completePgpLogin(page, account);
  if (account === "admin" || account === "moderator") {
    await completeStaffVerification(page, account, privateKey);
  }
  assert.ok(new URL(page.url()).pathname.startsWith(credentials.destination), `${account}: unexpected destination ${page.url()}`);
  if (account === "vendor") assert.equal(new URL(page.url()).searchParams.get("tab"), "operations", "Vendor login must open the Operations tab");
  assert.ok(!(await page.textContent("body"))?.includes("Application error"), `${account}: application error rendered`);
  if (account === "buyer" && notificationId) {
    await page.goto(`${baseUrl}/market/inbox`);
    const notificationInput = page.locator(`input[name="notificationId"][value="${notificationId}"]`);
    assert.equal(await notificationInput.count(), 1, "Buyer notification was not rendered");
    await Promise.all([
      page.waitForURL(/success=NotificationDeleted/, { waitUntil: "domcontentloaded" }),
      notificationInput.locator("..").getByRole("button", { name: /Delete notification:/ }).click(),
    ]);
    assert.equal(await page.locator(`input[name="notificationId"][value="${notificationId}"]`).count(), 0, "Deleted notification is still visible");
  }
  if (account === "vendor") {
    await page.goto(`${baseUrl}/market/dashboard/vendor?tab=settings`);
    const vacationToggle = page.locator('input[name="vacationMode"]');
    assert.ok(await vacationToggle.isDisabled(), "Vacation mode must be disabled while the vendor has open orders or disputes");
    assert.match((await page.textContent("body")) || "", /Resolve \d+ open order\(s\) and \d+ dispute\(s\)/);

    // Bypass the disabled HTML control to prove the server action also enforces the rule.
    await vacationToggle.evaluate((element) => element.removeAttribute("disabled"));
    await vacationToggle.check();
    await Promise.all([
      page.waitForURL(/error=VacationBlocked/, { waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "Update Storefront Settings" }).click(),
    ]);
    assert.match((await page.textContent("body")) || "", /Vacation mode cannot be activated/);
    assert.ok(await page.locator('input[name="vacationMode"]').isDisabled(), "Rejected activation must leave vacation mode off");

    await page.goto(`${baseUrl}/market/dashboard/vendor?tab=operations`);
    assert.equal(await page.locator(".vendor-operation-metric").count(), 8, "Operational KPI grid is incomplete");
    assert.equal(await page.locator('input[name="from"][type="date"]').count(), 1, "Operations start-date filter is missing");
    assert.equal(await page.locator('input[name="to"][type="date"]').count(), 1, "Operations end-date filter is missing");
    await page.locator('input[name="username"]').fill(accounts.buyer.username);
    await Promise.all([
      page.waitForURL(/success=BuyerWhitelisted/, { waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "ADD TO WHITELIST" }).click(),
    ]);
    const whitelistEntry = page.locator(".vendor-whitelist-list article").filter({ hasText: accounts.buyer.username });
    assert.equal(await whitelistEntry.count(), 1, "Whitelisted buyer is not shown in operations");
    await Promise.all([
      page.waitForURL(/success=BuyerRemovedFromWhitelist/, { waitUntil: "domcontentloaded" }),
      whitelistEntry.getByRole("button", { name: `Remove ${accounts.buyer.username} from whitelist` }).click(),
    ]);
    assert.equal(await page.locator(".vendor-whitelist-list article").filter({ hasText: accounts.buyer.username }).count(), 0, "Removed buyer is still whitelisted");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(!await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `Operations dashboard overflows at ${width}px`);
    }
  }
  await page.close();
  console.log(`PASS ${account}: ${credentials.destination}`);
}

async function main() {
  assert.equal(process.env.DEMO_DATABASE_NAME, "market_demo_localhost", "Verification requires the isolated local demo database");
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, "Local server is not healthy at http://localhost:3000");
  const requestedAccount = process.argv[2] as keyof typeof accounts | undefined;
  assert.ok(!requestedAccount || requestedAccount in accounts, `Unknown account: ${requestedAccount}`);
  const selectedAccounts = requestedAccount ? [requestedAccount] : Object.keys(accounts) as Array<keyof typeof accounts>;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let notificationId: string | undefined;
  let enrollmentUserId: string | undefined;
  let enrollmentCredentials: { username: string; password: string; publicKey: string; privateKey: string } | undefined;
  if (selectedAccounts.includes("buyer")) {
    notificationId = `local-test-${randomUUID()}`;
    await pool.query(
      `INSERT INTO "Notification" ("id", "userId", "title", "content", "type")
       SELECT $1, "id", 'Disposable local notification', 'Created to verify user-controlled deletion.', 'SYSTEM'
       FROM "User" WHERE "username" = $2`,
      [notificationId, accounts.buyer.username],
    );
    const suffix = randomBytes(4).toString("hex");
    const username = `pgp_first_${suffix}`;
    const password = "FirstLoginPGP#2026";
    const salt = randomBytes(32).toString("hex");
    enrollmentUserId = `local-pgp-${randomUUID()}`;
    const generatedKey = await generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "First Login Test" }], format: "armored" });
    await pool.query(
      `INSERT INTO "User" ("id", "username", "passwordHash", "passwordSalt", "role", "isPhraseViewed", "antiPhishingPhrase", "affiliateCode")
       VALUES ($1, $2, $3, $4, 'BUYER', true, 'First Login PGP Test', $5)`,
      [enrollmentUserId, username, pbkdf2Sync(password, salt, 600000, 64, "sha512").toString("hex"), salt, `affiliate-${suffix}`],
    );
    enrollmentCredentials = { username, password, publicKey: generatedKey.publicKey, privateKey: generatedKey.privateKey };
  }
  const browser = await chromium.launch({ headless: true });
  try {
    if (enrollmentCredentials) {
      await verifyMandatoryPgpEnrollment(browser, enrollmentCredentials.username, enrollmentCredentials.password, enrollmentCredentials.publicKey, enrollmentCredentials.privateKey);
    }
    for (const account of selectedAccounts) {
      const context = await createContext(browser);
      try {
        await verifyAccount(context, account, notificationId);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (notificationId) await pool.query(`DELETE FROM "Notification" WHERE "id" = $1`, [notificationId]);
    if (enrollmentUserId) {
      await pool.query(`DELETE FROM "PgpChallenge" WHERE "userId" = $1`, [enrollmentUserId]);
      await pool.query(`DELETE FROM "AuthChallenge" WHERE "userId" = $1`, [enrollmentUserId]);
      await pool.query(`DELETE FROM "User" WHERE "id" = $1`, [enrollmentUserId]);
    }
    await pool.end();
  }
  console.log("PASS: all generated local credentials completed their real authentication flow.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
