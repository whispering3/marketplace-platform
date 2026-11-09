"use server";

import { prisma } from "@/lib/db";
import { hashPin, isValidPinFormat } from "@/lib/pin";
import { requiredProductionEnv } from "@/lib/env";
import { constantTimeStringEquals, isStrongPassword, isValidUsername, normalizeUsername } from "@/lib/auth-hardening";
import crypto from "crypto";
import { redirect } from "next/navigation";

// Internal helper for synchronous, secure hashing (pbkdf2)
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 600000, 64, "sha512").toString("hex");
}

/**
 * PRODUCTION SETUP: INITIAL ADMIN CREATION
 * This should only work once.
 */
export async function initializeMarketStaffAction(formData: FormData) {
  const setupKey = formData.get("setup_key")?.toString(); // Recommended to set in .env
  const username = normalizeUsername(formData.get("username")?.toString() || "");
  const password = formData.get("password")?.toString();
  const pin = formData.get("pin")?.toString();
  const msid = formData.get("msid")?.toString();

  // 1. Check if ANY admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  });

  if (existingAdmin) {
    return redirect("/auth/login?error=SystemAlreadyInitialized");
  }

  // 2. Security: Verify setup key if provided in ENV
  const platformSetupKey = requiredProductionEnv("SETUP_KEY", "development_setup_key_change_before_deploy");
  if (!constantTimeStringEquals(setupKey, platformSetupKey)) {
    return redirect("/auth/login?error=InvalidSetupKey");
  }

  if (!username || !password || !isValidUsername(username) || !isStrongPassword(password) || !isValidPinFormat(pin) || !msid) {
    return redirect("/auth/login?error=MissingSetupFields");
  }

  const userSalt = crypto.randomBytes(32).toString("hex");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(829471)`;
      if (await tx.user.findFirst({ where: { role: "ADMIN" } })) {
        throw new Error("SystemAlreadyInitialized");
      }
      await tx.user.create({
        data: {
          username,
          passwordHash: hashPassword(password, userSalt),
          passwordSalt: userSalt,
          pin: hashPin(pin),
          staffId: msid,
          role: "ADMIN",
          hasPaidBond: true,
          trustScore: 100,
        },
      });
      await tx.platformWallet.upsert({
        where: { id: "market_wallet" },
        update: {},
        create: { id: "market_wallet", balanceXMR: 0, totalEarned: 0 },
      });
    });
  } catch (e) {
     console.error("Setup Error:", e);
     return redirect("/auth/login?error=DatabaseSetupFailure");
  }
  return redirect("/auth/login?success=AdminInitialized");
}
