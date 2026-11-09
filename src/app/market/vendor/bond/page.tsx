import { verifyAuth } from "@/lib/session";
import { createSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buyVendorBondAction } from "@/app/actions/vendor";
import { formatVendorBondLabel, getVendorBondQuote, VENDOR_BOND_USD } from "@/lib/vendor-bond";
import { redirect } from "next/navigation";

export default async function VendorBond({
   searchParams,
}: {
   searchParams: Promise<{ error?: string; success?: string }>
}) {
  const res = await searchParams;
  const session = await verifyAuth();

  const user = await prisma.user.findUnique({
     where: { id: session.userId as string },
     select: { walletBalanceXMR: true, hasPaidBond: true }
  });

  const bondQuote = await getVendorBondQuote();
  const bondPriceXMR = bondQuote.xmrAmount;

  const refreshVendorAccessAction = async () => {
     "use server";
     const currentSession = await verifyAuth();
     const currentUser = await prisma.user.findUnique({
        where: { id: currentSession.userId as string },
        select: { id: true, username: true, role: true, hasPaidBond: true, staffId: true },
     });

     if (!currentUser?.hasPaidBond) {
        return redirect("/market/vendor/bond?error=BondRequired");
     }

     const role = currentUser.role === "ADMIN" ? "ADMIN" : "VENDOR";
     if (currentUser.role !== role) {
        await prisma.user.update({
           where: { id: currentUser.id },
           data: { role },
        });
     }

     await createSession(currentUser.id, role, currentUser.username, currentUser.staffId || undefined);
     return redirect("/market/dashboard/vendor");
  };

  if (user?.hasPaidBond) {
     return (
        <div className="box success" style={{ textAlign: 'center' }}>
           <h2>BOND ACTIVE</h2>
           <p>You have already cleared the Anti-Sybil waiver. Your Commercial Dashboard is unlocked.</p>
           <form action={refreshVendorAccessAction}>
              <button type="submit" className="button">Go to Dashboard</button>
           </form>
        </div>
     );
  }

  return (
    <div className="box" style={{ maxWidth: '920px', margin: '0 auto', borderColor: '#cbb360' }}>
      {res.error && <div className="danger" style={{ padding: '10px', marginBottom: '15px' }}>⚠ ERROR: {res.error}</div>}

      <h2 style={{ color: '#cbb360', margin: '0 0 5px 0' }}>Become a Vendor</h2>
      <p style={{ fontSize: '13px', color: '#ccc' }}>
        Activate a seller account after paying the vendor bond. Orders run through platform escrow, and your dashboard unlocks listings, fulfillment, support, promotion controls, and withdrawals.
      </p>
      <hr/>

      <div className="vendor-bond-layout">
         <div className="box" style={{ flex: '1.5', backgroundColor: '#050505' }}>
            <h3 className="danger" style={{ margin: '0 0 15px 0' }}>Seller Operating Rules</h3>
            <ul style={{ fontSize: '12px', lineHeight: '1.8', color: '#aaa' }}>
               <li><strong>Lawful listings only:</strong> illegal goods, stolen data, malware, and counterfeit items are forbidden.</li>
               <li><strong>Accurate fulfillment:</strong> describe stock, shipping windows, and refund terms honestly.</li>
               <li><strong>Escrow required:</strong> attempts to move customers off-platform may suspend selling privileges.</li>
               <li><strong>Compliance review:</strong> disputed or suspicious listings may be paused pending staff review.</li>
               <li><strong>PGP-first support:</strong> buyer contact and dispute records stay encrypted through the platform.</li>
            </ul>
         </div>

         <div className="box" style={{ flex: '1', backgroundColor: '#0c0c0e', textAlign: 'center' }}>
            <h3 style={{ margin: 0, color: '#f26822' }}>Fee: {formatVendorBondLabel(bondQuote)}</h3>
            <p style={{ fontSize: '10px', color: '#777' }}>
              USD reference: ${VENDOR_BOND_USD}. XMR/USD: ${bondQuote.xmrUsd.toFixed(2)} ({bondQuote.source}).
            </p>
            <p style={{ fontSize: '11px', color: '#666' }}>Current balance: <strong>{user?.walletBalanceXMR.toFixed(4)} XMR</strong></p>

            <form action={buyVendorBondAction} style={{ marginTop: '20px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: '#ffaaaa', textAlign: 'left', marginBottom: '15px' }}>
                  <input type="checkbox" required /> I have read the guidelines and agree to the 4% market fee.
               </label>

               <button
                  type="submit"
                  className="danger"
                  disabled={user ? (Number(user.walletBalanceXMR) < bondPriceXMR) : true}
                  style={{ width: '100%', padding: '12px', fontSize: '15px', fontWeight: 'bold' }}
               >
                  {user && (Number(user.walletBalanceXMR) < bondPriceXMR) ? "INSUFFICIENT BALANCE" : "PAY BOND & ACTIVATE"}
               </button>
            </form>

            {user && (Number(user.walletBalanceXMR) < bondPriceXMR) && (
               <p style={{ fontSize: '10px', color: '#555', marginTop: '10px' }}>
                  Please deposit at least {bondPriceXMR.toFixed(4)} XMR into your <a href="/market/wallet">Personal Wallet</a> to continue.
               </p>
            )}
         </div>
      </div>
    </div>
  );
}
