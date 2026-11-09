import { FALLBACK_XMR_USD } from "@/lib/xmr-constants";

export { FALLBACK_XMR_USD };

export type XmrRateQuote = {
  xmrUsd: number;
  source: "coingecko" | "fallback";
  updatedAt: string;
};

export function usdToXmr(usdAmount: number, xmrUsd: number) {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    throw new Error("Invalid USD amount");
  }

  if (!Number.isFinite(xmrUsd) || xmrUsd <= 0) {
    throw new Error("Invalid XMR/USD rate");
  }

  return usdAmount / xmrUsd;
}

export async function getXmrUsdQuote(): Promise<XmrRateQuote> {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd",
      {
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(2000),
        headers: {
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Rate provider returned ${response.status}`);
    }

    const data = await response.json();
    const value = Number(data?.monero?.usd);

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Invalid XMR/USD payload");
    }

    return {
      xmrUsd: value,
      source: "coingecko",
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[XMR_USD_RATE_FAILED]", error);
    return {
      xmrUsd: FALLBACK_XMR_USD,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    };
  }
}
