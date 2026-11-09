import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { money } from "@/lib/money";
import { requestWithdrawAction, generateDepositAddressAction } from "@/app/actions/wallet";

const statuses: Record<string, string> = { AWAITING_APPROVAL: "Awaiting approval", PROCESSING: "Transfer processing", NEEDS_REVIEW: "Under staff review", COMPLETED: "Sent", REJECTED: "Rejected · balance returned", ACTIVE: "Ready for deposit", USED: "Deposit detected" };
const errors: Record<string, string> = { InvalidPIN: "Incorrect PIN. Check your details and try again.", InvalidMoneroAddress: "Unable to validate the Monero address. Check the address and try again.", InsufficientBalance: "The amount exceeds your available balance.", MoneroConnectionRefused: "The wallet service is unavailable. Try again later.", MissingData: "Enter the address and PIN.", InvalidAmount: "Enter a valid amount with up to 12 decimal places.", WithdrawalNotAllowed: "Withdrawals are available to eligible vendors." };
const format = (value: Parameters<typeof money>[0]) => `${money(value).toFixed(12)} XMR`;

export default async function PersonalWallet({ searchParams }: { searchParams: Promise<{ success?: string; error?: string; page?: string }> }) {
  const session = await verifyAuth();
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page || "1", 10) || 1));
  const [user, pending, processing, count, deposits] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.userId }, include: { depositAddresses: { orderBy: { createdAt: "desc" }, take: 10 }, withdrawals: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 } } }),
    prisma.withdrawalRequest.aggregate({ where: { userId: session.userId, status: "AWAITING_APPROVAL" }, _sum: { amountXMR: true } }),
    prisma.withdrawalRequest.aggregate({ where: { userId: session.userId, status: { in: ["PROCESSING", "NEEDS_REVIEW"] } }, _sum: { amountXMR: true } }),
    prisma.withdrawalRequest.count({ where: { userId: session.userId } }),
    prisma.processedWalletPayment.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return <div className="wallet-page">
    <header><h1>My wallet</h1><p>Check your balance and track deposits and withdrawal requests.</p></header>
    {params.success === "WithdrawalAwaitingApproval" && <div className="wallet-notice" role="status">Request recorded. The amount has been reserved and is awaiting staff approval.</div>}
    {params.error && <div className="wallet-notice wallet-error" role="alert">{errors[params.error] || "Unable to complete the request. Check your details or contact support."}</div>}
    <dl className="wallet-summary">
      <div><dt>Available</dt><dd>{format(user.walletBalanceXMR)}</dd></div>
      <div><dt>Reserved for approval</dt><dd>{format(pending._sum.amountXMR || 0)}</dd></div>
      <div><dt>Processing or under review</dt><dd>{format(processing._sum.amountXMR || 0)}</dd></div>
    </dl>
    <div className="wallet-columns">
      <section className="wallet-card"><h2>Deposit Monero</h2><p>Generate an address and send XMR on the Monero network. Your balance becomes available after the required confirmations.</p>
        <form action={generateDepositAddressAction}>
          <label htmlFor="deposit-amount">Expected amount in XMR (optional)</label><input id="deposit-amount" name="expected_amount" type="number" min="0" step="0.000000000001" inputMode="decimal" />
          <label htmlFor="deposit-pin">Account PIN</label><input id="deposit-pin" name="pin" type="password" required autoComplete="off" inputMode="numeric" />
          <button type="submit">Generate deposit address</button>
        </form>
        <h3>Recent addresses</h3>{!user.depositAddresses.length && <p>You have not generated an address yet.</p>}
        {user.depositAddresses.map((address) => <details key={address.id} className="wallet-address"><summary>{address.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })} · {statuses[address.status] || "Under review"}</summary><p className="wallet-monospace">{address.address}</p><small>Select the entire address to copy it. Check every character before sending.</small></details>)}
      </section>
      <section className="wallet-card"><h2>Request withdrawal</h2>
        {user.role === "VENDOR" ? <><p>Your request reserves the amount for approval. The platform charges no withdrawal fee.</p>
          <form action={requestWithdrawAction}>
            <label htmlFor="withdraw-address">Destination Monero address</label><input id="withdraw-address" name="withdraw_addr" required autoComplete="off" spellCheck={false} />
            <label htmlFor="withdraw-amount">Amount in XMR (leave empty to withdraw all available funds)</label><input id="withdraw-amount" name="amount" type="number" min="0.000000000001" max={user.walletBalanceXMR.toFixed(12)} step="0.000000000001" inputMode="decimal" />
            <label htmlFor="withdraw-pin">Account PIN</label><input id="withdraw-pin" name="pin" type="password" required autoComplete="off" inputMode="numeric" />
            <button type="submit" disabled={user.walletBalanceXMR.lte(0)}>Request withdrawal approval</button>
          </form></> : <p>Withdrawals are available to eligible vendor accounts.</p>}
        <p>If a request is under review, wait for staff to investigate before trying again.</p>
      </section>
    </div>
    <section className="wallet-card"><h2>Withdrawal history</h2>
      <div className="wallet-table" tabIndex={0} role="region" aria-label="Withdrawal history, scroll horizontally"><table><thead><tr><th>Date (UTC)</th><th>Amount</th><th>Status</th><th>Destination and receipt</th></tr></thead>
        <tbody>{!user.withdrawals.length && <tr><td colSpan={4}>No requests on this page.</td></tr>}{user.withdrawals.map((withdrawal) => <tr key={withdrawal.id}>
          <td>{withdrawal.createdAt.toLocaleString("en-US", { timeZone: "UTC" })}</td><td>{format(withdrawal.amountXMR)}</td><td>{statuses[withdrawal.status] || "Under review"}</td>
          <td><details><summary>View details</summary><p className="wallet-monospace">{withdrawal.address}</p>{withdrawal.txHash && <p className="wallet-monospace">Transaction: {withdrawal.txHash}</p>}<small>Request: {withdrawal.id}</small></details></td>
        </tr>)}</tbody></table></div>
      <nav className="wallet-pagination" aria-label="Withdrawal pages">{page > 1 && <a href={`?page=${page - 1}`}>Previous</a>}<span>Page {page}</span>{page * 20 < count && <a href={`?page=${page + 1}`}>Next</a>}</nav>
    </section>
    <section className="wallet-card"><h2>Recent credited deposits</h2>{!deposits.length && <p>No credited deposits yet. Deposits awaiting confirmation are not shown here.</p>}{deposits.map((deposit) => <details key={deposit.id} className="wallet-address"><summary>{format(deposit.amountXMR)} · {deposit.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })}</summary><p className="wallet-monospace">{deposit.txHash}</p></details>)}</section>
  </div>;
}
