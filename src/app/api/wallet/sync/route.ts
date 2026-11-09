import { NextRequest, NextResponse } from "next/server";
import { requiredProductionEnv } from "@/lib/env";
import { syncIncomingDeposits } from "@/lib/wallet-sync";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = requiredProductionEnv("WALLET_SYNC_SECRET", "development_wallet_sync_secret_change_before_deploy");
  const authorization = request.headers.get("authorization");
  const cronSecret = request.headers.get("x-wallet-sync-secret");
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

  return constantTimeEquals(bearerSecret, secret) || constantTimeEquals(cronSecret, secret);
}

function constantTimeEquals(candidate: string | null | undefined, expected: string) {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

async function handler(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncIncomingDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[WALLET_SYNC_FAILED]", error);
    return NextResponse.json({ ok: false, error: error.message || "Wallet sync failed" }, { status: 503 });
  }
}

export const POST = handler;
