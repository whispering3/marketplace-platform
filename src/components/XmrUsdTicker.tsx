import { getXmrUsdQuote } from "@/lib/xmr-rate";

export async function XmrUsdTicker() {
  const rate = await getXmrUsdQuote();
  return <section className="xmr-rate-strip" aria-label="Monero reference price">
    <div><span>XMR/USD</span><strong>1 XMR = US$ {rate.xmrUsd.toFixed(2)}</strong>
      <small>{rate.source === "fallback" ? "Live quote unavailable: reference value only." : `Reference updated at ${new Date(rate.updatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Refresh the page to check again.`}</small>
    </div>
  </section>;
}
