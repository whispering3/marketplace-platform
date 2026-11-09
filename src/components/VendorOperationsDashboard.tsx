import type { getVendorOperations } from "@/lib/vendor-operations";
import { addVendorWhitelistAction, removeVendorWhitelistAction } from "@/app/actions/vendor";

type Operations = Awaited<ReturnType<typeof getVendorOperations>>;

function xmr(value: number) {
  return `${value.toFixed(5)} XMR`;
}

function dateTime(value: Date) {
  return value.toLocaleString("en-US", { timeZone: "UTC" });
}

function Metric({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "green" | "amber" | "cyan" }) {
  return (
    <article className={`vendor-operation-metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

export default function VendorOperationsDashboard({ data }: { data: Operations }) {
  const { metrics, period } = data;

  return (
    <div className="vendor-operations">
      <header className="vendor-operations-header">
        <div>
          <span className="vendor-eyebrow">OPERATIONAL COMMAND CENTER</span>
          <h3>Store performance</h3>
          <p>Sales, fulfillment, withdrawals, disputes and trusted buyers for the selected UTC period.</p>
        </div>
        <form method="get" className="vendor-period-filter">
          <input type="hidden" name="tab" value="operations" />
          <label>From<input type="date" name="from" defaultValue={period.from} /></label>
          <label>To<input type="date" name="to" defaultValue={period.to} /></label>
          <button type="submit">APPLY</button>
          <a href="?tab=operations">LAST 30 DAYS</a>
        </form>
      </header>

      <section className="vendor-operation-metrics" aria-label="Vendor operational metrics">
        <Metric label="NET SALES" value={xmr(metrics.netSalesXMR)} note={`${metrics.completedSales} completed sale(s) · gross ${xmr(metrics.grossSalesXMR)}`} tone="green" />
        <Metric label="AVERAGE ORDER" value={xmr(metrics.averageOrderXMR)} note={`${metrics.orders} order(s) created in period`} tone="cyan" />
        <Metric label="OPEN ORDERS" value={String(metrics.openOrders)} note="Current status among orders created in period" tone={metrics.openOrders ? "amber" : "neutral"} />
        <Metric label="DISPUTES OPENED" value={String(metrics.disputesOpened)} note={`${metrics.disputeRate.toFixed(1)}% of period orders`} tone={metrics.disputesOpened ? "amber" : "neutral"} />
        <Metric label="LISTINGS CREATED" value={String(metrics.listingsCreated)} note={`${metrics.activeListings} active · ${metrics.totalListings} total`} />
        <Metric label="WITHDRAWN" value={xmr(metrics.withdrawnXMR)} note={`${metrics.completedWithdrawals} completed withdrawal(s)`} tone="green" />
        <Metric label="WITHDRAWAL REQUESTS" value={xmr(metrics.requestedWithdrawalXMR)} note={`${metrics.withdrawalRequests} submitted · ${xmr(metrics.pendingWithdrawalXMR)} pending`} />
        <Metric label="WHITELIST ADDED" value={String(metrics.whitelistAdded)} note={`${metrics.whitelistTotal} trusted buyer(s) total`} tone="cyan" />
      </section>

      <div className="vendor-operations-grid">
        <section className="box vendor-operation-panel">
          <div className="vendor-panel-heading"><div><small>REVENUE LEDGER</small><h4>Recent completed sales</h4></div><span>{period.from} — {period.to}</span></div>
          <div className="vendor-table-wrap">
            <table className="vendor-operation-table">
              <thead><tr><th>Date (UTC)</th><th>Listing</th><th>Gross</th><th>Net</th></tr></thead>
              <tbody>
                {data.recentSales.length === 0 && <tr><td colSpan={4}>No completed sales in this period.</td></tr>}
                {data.recentSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{dateTime(sale.createdAt)}</td><td>{sale.product.title}</td>
                    <td>{sale.totalXMR.toFixed(5)}</td><td className="vendor-positive">{sale.totalXMR.minus(sale.marketFeeXMR).toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="box vendor-operation-panel">
          <div className="vendor-panel-heading"><div><small>PAYOUT CONTROL</small><h4>Withdrawal activity</h4></div><span>{metrics.pendingWithdrawals} pending</span></div>
          <div className="vendor-table-wrap">
            <table className="vendor-operation-table">
              <thead><tr><th>Requested (UTC)</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {data.recentWithdrawals.length === 0 && <tr><td colSpan={3}>No withdrawal requests in this period.</td></tr>}
                {data.recentWithdrawals.map((withdrawal) => (
                  <tr key={withdrawal.id}>
                    <td>{dateTime(withdrawal.createdAt)}</td><td>{withdrawal.amountXMR.toFixed(5)}</td><td>{withdrawal.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="box vendor-operation-panel vendor-whitelist-panel">
        <div className="vendor-panel-heading">
          <div><small>TRUSTED BUYERS</small><h4>Buyer whitelist</h4></div>
          <span>{metrics.whitelistTotal} total</span>
        </div>
        <p>Maintain your private list of trusted customer identities. This list is informational and does not bypass checkout, escrow or marketplace rules.</p>
        <form action={addVendorWhitelistAction} className="vendor-whitelist-form">
          <label><span>Buyer username</span><input name="username" required minLength={3} maxLength={32} autoComplete="off" placeholder="buyer_alias" /></label>
          <button type="submit">ADD TO WHITELIST</button>
        </form>
        <div className="vendor-whitelist-list">
          {data.whitelistEntries.length === 0 && <span className="vendor-empty-state">No trusted buyers added.</span>}
          {data.whitelistEntries.map((entry) => (
            <article key={entry.id}>
              <div><strong>{entry.buyer.username}</strong><small>Trust {entry.buyer.trustScore} · added {dateTime(entry.createdAt)}</small></div>
              <form action={removeVendorWhitelistAction}>
                <input type="hidden" name="entryId" value={entry.id} />
                <button type="submit" className="danger" aria-label={`Remove ${entry.buyer.username} from whitelist`}>REMOVE</button>
              </form>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
