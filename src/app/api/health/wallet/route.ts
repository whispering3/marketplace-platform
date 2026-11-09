import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { callRpc } from "@/lib/monero-rpc";

export async function GET(request: Request) {
  const expected = process.env.WALLET_SYNC_SECRET;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || !candidate || Buffer.byteLength(expected) !== Buffer.byteLength(candidate) || !timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await callRpc("get_version");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
