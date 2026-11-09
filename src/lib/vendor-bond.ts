import { getXmrUsdQuote, usdToXmr } from "@/lib/xmr-rate";

export const VENDOR_BOND_USD = 500;

export type VendorBondQuote = {
  usdAmount: number;
  xmrAmount: number;
  xmrUsd: number;
  source: string;
  updatedAt: string;
};

export async function getVendorBondQuote(): Promise<VendorBondQuote> {
  const configured = process.env.VENDOR_BOND_XMR;

  if (configured) {
    const amount = Number(configured);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid VENDOR_BOND_XMR configuration");
    }

    const impliedRate = VENDOR_BOND_USD / amount;

    return {
      usdAmount: VENDOR_BOND_USD,
      xmrAmount: amount,
      xmrUsd: impliedRate,
      source: "env",
      updatedAt: new Date().toISOString(),
    };
  }

  const quote = await getXmrUsdQuote();

  return {
    usdAmount: VENDOR_BOND_USD,
    xmrAmount: usdToXmr(VENDOR_BOND_USD, quote.xmrUsd),
    xmrUsd: quote.xmrUsd,
    source: quote.source,
    updatedAt: quote.updatedAt,
  };
}

export function formatVendorBondLabel(quote: VendorBondQuote) {
  return `$${quote.usdAmount} equivalent / ${quote.xmrAmount.toFixed(4)} XMR`;
}
