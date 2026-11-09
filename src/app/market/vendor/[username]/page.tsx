import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notFound } from "next/navigation";
import { sendMessageAction } from "@/app/actions/messages";

export default async function VendorStorefront({ params }: { params: Promise<{ username: string }> }) {
  const resolvedParams = await params;
  const session = await getSession();

  const vendor = await prisma.user.findUnique({
    where: { username: resolvedParams.username },
    include: {
      products: {
        include: { reviews: true },
        where: { quantity: { gt: 0 }, isPaused: false, moderationStatus: "APPROVED" }
      },
      vendorOrders: {
        where: { status: "COMPLETED" },
        select: { id: true }
      }
    }
  });

  if (!vendor || vendor.isBanned || !vendor.hasPaidBond || (vendor.role !== "VENDOR" && vendor.role !== "ADMIN")) {
    return notFound();
  }

  if (vendor.isVacationMode) vendor.products = [];

  // Stats Calculation
  const totalSales = vendor.vendorOrders.length;
  let totalRating = 0;
  let reviewCount = 0;

  vendor.products.forEach(p => {
    p.reviews.forEach(r => {
      totalRating += r.rating;
      reviewCount++;
    });
  });

  const avgRating = reviewCount > 0 ? (totalRating / reviewCount).toFixed(1) : "N/A";
  const positivePercent = reviewCount > 0 ? Math.round((totalRating / (reviewCount * 5)) * 100) : 100;

  // Advanced Intelligence Metrics
  const avgDispatch = vendor.dispatchedOrdersCount > 0
    ? (vendor.totalDispatchHours / vendor.dispatchedOrdersCount).toFixed(1)
    : "N/A";

  const disputeSuccess = vendor.disputesTotal > 0
    ? Math.round((vendor.disputesWon / vendor.disputesTotal) * 100)
    : "N/A";
  const canContactVendor = !!session?.userId && session.userId !== vendor.id;

  return (
    <div className="box" style={{ borderColor: '#f26822' }}>

      {/* 1. VENDOR HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #333', paddingBottom: '20px', marginBottom: '20px' }}>
         <div>
            <h1 style={{ margin: 0, color: '#f26822', fontSize: '32px' }}>{vendor.username}</h1>
            <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
               <span className="success">Level {Math.floor(vendor.trustScore / 20)} Trusted Vendor</span>
               <span style={{ color: '#888' }}>| Member since {vendor.joinDate.toLocaleDateString()}</span>
            </div>

            <div style={{ display: 'flex', gap: '20px', marginTop: '15px' }}>
               <div style={{ backgroundColor: '#0a0d0a', border: '1px solid #1a331a', padding: '5px 12px' }}>
                  <div style={{ fontSize: '9px', color: '#4caf50', textTransform: 'uppercase' }}>Avg. Dispatch</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{avgDispatch}h</div>
               </div>
               <div style={{ backgroundColor: '#0d0a0a', border: '1px solid #331a1a', padding: '5px 12px' }}>
                  <div style={{ fontSize: '9px', color: '#f44336', textTransform: 'uppercase' }}>Dispute Success</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{disputeSuccess !== "N/A" ? `${disputeSuccess}%` : "100%"}</div>
               </div>
            </div>
         </div>
         <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{positivePercent}%</div>
            <div style={{ fontSize: '10px', color: '#888' }}>POSITIVE FEEDBACK ({reviewCount} REVIEWS)</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>Average Rating: {avgRating}/5</div>
            <div style={{ fontSize: '12px', color: '#ff9800', marginTop: '5px' }}>Total Sales: {totalSales}</div>
         </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>

         {/* LEFT: TERMS & PGP */}
         <div style={{ flex: 1 }}>
            <div className="box" style={{ backgroundColor: '#0c0a00', border: '1px solid #320' }}>
               <h3 style={{ margin: '0 0 10px 0', color: '#f26822', fontSize: '14px' }}>VENDOR TERMS OF SERVICE (ToS)</h3>
               <p style={{ whiteSpace: 'pre-wrap', fontSize: '12px', color: '#ccc', lineHeight: '1.6' }}>
                  {(vendor as any).vendorTerms || "This vendor has not specified any public terms of service. Standard market rules apply."}
               </p>
            </div>

            <div className="box" style={{ marginTop: '20px' }}>
               <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>PGP PUBLIC KEY</h3>
               <textarea
                  readOnly
                  rows={8}
                  defaultValue={vendor.pgpPublicKey || "NO PUBLIC KEY REGISTERED"}
                  style={{ width: '100%', fontSize: '9px', backgroundColor: '#000', color: '#666' }}
               />
            </div>

            <div className="box" style={{ marginTop: '20px', borderColor: '#004d4d', backgroundColor: '#061010' }}>
               <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#00bcd4' }}>CONTACT VENDOR</h3>
               {canContactVendor ? (
                  <form action={sendMessageAction}>
                     <input type="hidden" name="receiver" value={vendor.username} />
                     <p style={{ fontSize: '11px', color: '#888', lineHeight: '1.5' }}>
                        Encrypt your message locally with this vendor's public key, then paste only the PGP message block below.
                     </p>
                     <textarea
                        name="payload"
                        rows={8}
                        required
                        placeholder={`-----BEGIN PGP MESSAGE-----\n...`}
                        style={{ width: '100%', fontSize: '10px', backgroundColor: '#000', color: '#ddd', border: '1px solid #244' }}
                     />
                     <button type="submit" style={{ width: '100%', marginTop: '10px', padding: '10px', fontWeight: 'bold', backgroundColor: '#003b3b', border: '1px solid #00bcd4', color: '#00e5ff' }}>
                        SEND PGP MESSAGE
                     </button>
                  </form>
               ) : (
                  <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
                     Sign in with a buyer account to contact this vendor through encrypted messaging.
                  </p>
               )}
            </div>
         </div>

         {/* RIGHT: PRODUCT GRID */}
         <div style={{ flex: 1.5 }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Current Operation Inventory ({vendor.products.length})</h3>
            <div className="grid-catalog" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
               {vendor.products.map(prod => (
                  <div className="card" key={prod.id} style={{ padding: '10px' }}>
                     <a href={`/market/product/${prod.id}`} style={{ textDecoration: 'none' }}>
                        <div style={{ height: '100px', backgroundColor: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '10px' }}>[ IMG ]</div>
                        <div style={{ marginTop: '8px' }}>
                           <strong style={{ fontSize: '13px', color: '#f26822' }}>{prod.title}</strong>
                           <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '5px', color: '#fff' }}>{prod.priceXMR.toFixed(4)} XMR</div>
                           <div style={{ fontSize: '10px', color: '#666', marginTop: '3px' }}>Ships to: {prod.shipsTo}</div>
                        </div>
                     </a>
                  </div>
               ))}
            </div>
         </div>

      </div>

    </div>
  );
}
