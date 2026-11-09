import { NextResponse } from "next/server";
import { getXmrUsdQuote } from "@/lib/xmr-rate";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getXmrUsdQuote());
}
