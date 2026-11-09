import assert from "node:assert/strict";
import { fromPiconero, toPiconero } from "../src/lib/monero-rpc";
import { usdToXmr } from "../src/lib/xmr-rate";
import { calculateVendorLevelFromSales } from "../src/lib/meritocracy";

import { hasStaffPermission, STAFF_PERMISSIONS } from "../src/lib/staff-permissions";

const moderator = { role: "STAFF", isBanned: false, staffPermissions: [...STAFF_PERMISSIONS] };
for (const permission of STAFF_PERMISSIONS) {
  assert.equal(hasStaffPermission(moderator, permission), ["products", "orders", "support"].includes(permission));
  assert.equal(hasStaffPermission({ ...moderator, role: "ADMIN" }, permission), true);
  assert.equal(hasStaffPermission({ ...moderator, isBanned: true }, permission), false);
}
assert.equal(hasStaffPermission({ ...moderator, staffPermissions: [] }, "support"), false);
assert.equal(hasStaffPermission({ ...moderator, role: "BUYER" }, "products"), false);

function almostEqual(actual: number | { toNumber(): number }, expected: number, epsilon = 0.000000000001) {
  const numeric = typeof actual === "number" ? actual : actual.toNumber();
  assert.ok(Math.abs(numeric - expected) <= epsilon, `${actual} !== ${expected}`);
}

almostEqual(fromPiconero(toPiconero(1)), 1);
almostEqual(fromPiconero(toPiconero("0.000000000001")), 0.000000000001);
almostEqual(fromPiconero(toPiconero("12.345678901234")), 12.345678901234);

almostEqual(usdToXmr(500, 534.82), 0.9348939830223252);

assert.equal(calculateVendorLevelFromSales(0), 1);
assert.equal(calculateVendorLevelFromSales(4), 1);
assert.equal(calculateVendorLevelFromSales(5), 2);
assert.equal(calculateVendorLevelFromSales(15), 3);
assert.equal(calculateVendorLevelFromSales(30), 4);
assert.equal(calculateVendorLevelFromSales(60), 5);

console.log(JSON.stringify({ ok: true, tests: 9 }, null, 2));
