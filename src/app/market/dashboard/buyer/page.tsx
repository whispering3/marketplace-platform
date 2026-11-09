import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { updateOrderStatusAction, sendOrderChatAction, submitReviewAction } from "@/app/actions/orders";
import { checkOrderLifecycle } from "@/lib/order-lifecycle";
import { toggleFavoriteAction } from "@/app/actions/favorites";
import { updateSecuritySettingsAction } from "@/app/actions/auth";
import { verifyCurrentDomain } from "@/lib/mirrors";

export const dynamic = 'force-dynamic';

export default async function BuyerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; success?: string; error?: string; orderId?: string }>
}) {
  const session = await verifyAuth();
  const { tab, success, error, orderId: activeOrderId } = await searchParams;
  const currentTab = tab || "orders";

  const { host, status } = await verifyCurrentDomain();

  // Fetch Buyer Stats
  const buyerStats = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { privateMirrors: true, referrals: { select: { username: true, joinDate: true } } }
  });
  const affiliateCommissions = await prisma.affiliateCommission.findMany({
    where: { referrerId: session.userId as string },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const affiliateTotals = affiliateCommissions.reduce(
    (totals, commission) => ({
      paidXMR: (totals.paidXMR + Number(commission.commissionXMR)),
      generatedFeesXMR: (totals.generatedFeesXMR + Number(commission.marketFeeXMR)),
    }),
    { paidXMR: 0, generatedFeesXMR: 0 },
  );

  // Trigger Lazy Auto-Finalize
  await checkOrderLifecycle();

  // Fetch Real Orders
  const orders = await prisma.order.findMany({
    where: {
      buyerId: session.userId,
      status: (currentTab === "history") ? "COMPLETED" : { not: "COMPLETED" }
    },
    include: {
      vendor: { select: { username: true, level: true, badges: true } },
      product: { select: { title: true, productType: true } },
      disputeTicket: { select: { id: true, status: true } },
      supportTicket: { select: { id: true, status: true } },
      messages: { include: { sender: { select: { username: true, role: true } } }, orderBy: { createdAt: 'asc' } }
    },
    orderBy: { createdAt: "desc" }
  });

  // Fetch Favorites
  const favorites = await prisma.favorite.findMany({
    where: { userId: session.userId },
    include: { product: { include: { vendor: { select: { username: true } } } } }
  });

  const handleFinalize = async (formData: FormData) => {
    "use server";
    const oId = formData.get("orderId")?.toString();
    if (oId) await updateOrderStatusAction(oId, "COMPLETED");
  };

  const tabStyle = (active: boolean) => ({
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: active ? '#222' : '#050505',
    color: active ? '#f26822' : '#888',
    textDecoration: 'none',
    border: '1px solid #444',
    borderBottom: active ? 'none' : '1px solid #444',
    marginBottom: '-1px',
    fontWeight: active ? 'bold' : 'normal',
    marginRight: '5px'
  });

  const activeOrder = activeOrderId ? orders.find(o => o.id === activeOrderId) : null;

  return (
    <div className="box">
      {/* ANTI-PHISHING ANCHOR (Military OpSec Display) */}
      <div style={{ backgroundColor: status === 'UNAUTHORIZED' ? '#330000' : '#001a1a', border: `1px solid ${status === 'UNAUTHORIZED' ? '#ff0000' : '#004d4d'}`, padding: '10px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <div>
            <span style={{ fontSize: '9px', color: status === 'UNAUTHORIZED' ? '#ff0000' : '#008b8b', textTransform: 'uppercase' }}>🛡️ Phishing Protocol Anchor:</span><br/>
            <strong style={{ fontSize: '15px', color: status === 'UNAUTHORIZED' ? '#ff0000' : '#00ffff' }}>
                {status === 'UNAUTHORIZED' ? 'UNAUTHORIZED DOMAIN' : `"${buyerStats?.antiPhishingPhrase || 'NOT_SET'}"`}
            </strong>
         </div>
         <div style={{ fontSize: '10px', color: status === 'UNAUTHORIZED' ? '#ff0000' : '#008b8b', textAlign: 'right' }}>
            {status === 'PRIMARY' ? '🛡️ PRIMARY SITE VERIFIED' : status === 'OFFICIAL_MIRROR' ? '🛡️ OFFICIAL MIRROR VERIFIED' : '🚨 UNAUTHORIZED DOMAIN'}<br/>
            <code style={{ color: status === 'UNAUTHORIZED' ? '#ff0000' : '#00ffff', fontSize: '11px' }}>{host}</code>
         </div>
      </div>

      {success && <div style={{ padding: '10px', backgroundColor: '#1b331b', color: '#addfad', marginBottom: '15px', border: '1px solid #2e592e', fontSize: '12px' }}>SUCCESS: {success}</div>}
      {error && <div style={{ padding: '10px', backgroundColor: '#331b1b', color: '#ff8c8c', marginBottom: '15px', border: '1px solid #592e2e', fontSize: '12px' }}>ERROR: {error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
         <h2 style={{ margin: 0 }}>Sovereign Dashboard</h2>
         <div style={{ fontSize: '11px', color: '#666' }}>
            LVL {buyerStats?.level} | XP {buyerStats?.xp} | <span style={{ color: '#f26822' }}>{buyerStats?.badges || '[TRAINEE]'}</span>
         </div>
      </div>

      <div style={{ borderBottom: '1px solid #444', marginBottom: '20px' }}>
        <a href="?tab=orders" style={tabStyle(currentTab === "orders")}>🛒 Orders</a>
        <a href="?tab=history" style={tabStyle(currentTab === "history")}>📦 History</a>
        <a href="?tab=watchlist" style={tabStyle(currentTab === "watchlist")}>⭐ Watchlist ({favorites.length})</a>
        <a href="?tab=affiliate" style={tabStyle(currentTab === "affiliate")}>🤝 Affiliate Bureau</a>
        <a href="?tab=settings" style={tabStyle(currentTab === "settings")}>⚙️ Security</a>
      </div>

      {currentTab === "orders" && (
         <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
               <h3>Active Escrows</h3>
               {orders.length === 0 && <p style={{ color: '#444' }}>No active transmissions.</p>}
               {orders.map(o => (
                  <a key={o.id} href={`?tab=orders&orderId=${o.id}`} style={{ textDecoration: 'none' }}>
                     <div style={{ padding: '10px', border: '1px solid #222', marginBottom: '10px', backgroundColor: activeOrderId === o.id ? '#1a1a1a' : '#050505', borderLeft: (o.status === 'SHIPPED') ? '3px solid #f26822' : '1px solid #222' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                           <strong style={{ fontSize: '13px', color: '#ccc' }}>{o.product.title}</strong>
                           <span style={{ fontSize: '10px', color: '#f26822' }}>{o.status}</span>
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: '5px' }}>VENDOR: {o.vendor.username} | {o.totalXMR.toString()} XMR</div>
                     </div>
                  </a>
               ))}
            </div>

            <div style={{ flex: 1.5, backgroundColor: '#070707', border: '1px solid #222', padding: '20px', minHeight: '400px' }}>
               {activeOrder ? (
                  <div>
                     {(() => {
                       const supportTicket = activeOrder.disputeTicket || activeOrder.supportTicket;

                       return (
                     <>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #222', paddingBottom: '10px', marginBottom: '20px' }}>
                        <div>
                           <h3 style={{ margin: 0, color: '#f26822' }}>Order Intelligence: #{activeOrder.id.slice(0,8)}</h3>
                           <small style={{ color: '#666' }}>{activeOrder.product.title} @ {activeOrder.totalXMR.toString()} XMR</small>
                        </div>
                        {activeOrder.status === 'SHIPPED' && (
                           <form action={handleFinalize}>
                              <input type="hidden" name="orderId" value={activeOrder.id} />
                              <button type="submit" className="success" style={{ fontWeight: 'bold' }}>RELEASE ESCROW</button>
                           </form>
                        )}
                     </div>

                     {/* CHAT TERMINAL */}
                     <div style={{ height: '250px', overflowY: 'auto', backgroundColor: '#000', padding: '10px', border: '1px solid #1a1a1a', marginBottom: '15px' }}>
                        {activeOrder.messages.length === 0 && <p style={{ color: '#333', textAlign: 'center', marginTop: '100px' }}>Secure communication terminal open. Encrypt messages via PGP.</p>}
                        {activeOrder.messages.map(m => (
                           <div key={m.id} style={{ marginBottom: '15px', textAlign: m.sender.role === 'BUYER' ? 'right' : 'left' }}>
                              <div style={{ fontSize: '9px', color: m.sender.role === 'BUYER' ? '#f26822' : '#4caf50' }}>{m.sender.username} @ {m.createdAt.toLocaleTimeString()}</div>
                              <div style={{ display: 'inline-block', maxWidth: '80%', padding: '8px', backgroundColor: m.sender.role === 'BUYER' ? '#1a1005' : '#051a05', fontSize: '10px', color: '#ccc', textAlign: 'left', border: '1px solid #333' }}>
                                 {m.content}
                              </div>
                           </div>
                        ))}
                     </div>
                     <form action={sendOrderChatAction}>
                        <input type="hidden" name="orderId" value={activeOrder.id} />
                        <textarea name="content" rows={3} placeholder="Encrypted transmission..." required style={{ width: '100%', marginBottom: '10px', fontSize: '11px' }} />
                        <button type="submit" style={{ width: '100%', fontSize: '11px' }}>SEND MESSAGE</button>
                     </form>

                     <div style={{ marginTop: '18px', padding: '14px', border: '1px solid #3a2b00', backgroundColor: '#0f0b02' }}>
                        <h4 style={{ margin: '0 0 8px 0', color: '#ffb300', fontSize: '12px' }}>ORDER SUPPORT / DISPUTE</h4>
                        {supportTicket ? (
                           <a href={`/market/support/${supportTicket.id}`} style={{ color: '#ffb300', textDecoration: 'none', fontWeight: 'bold', fontSize: '12px' }}>
                              OPEN SUPPORT CHANNEL ({supportTicket.status})
                           </a>
                        ) : (
                           <form action="/api/support/order-ticket" method="post">
                              <input type="hidden" name="orderId" value={activeOrder.id} />
                              <input type="hidden" name="priority" value="HIGH" />
                              <p style={{ margin: '0 0 8px 0', color: '#777', fontSize: '11px' }}>
                                 Opens a shared encrypted channel with you, the vendor, and staff.
                              </p>
                              <textarea name="content" rows={4} required placeholder="-----BEGIN PGP MESSAGE-----" style={{ width: '100%', marginBottom: '10px', fontSize: '10px' }} />
                              <button type="submit" style={{ width: '100%', fontSize: '11px', fontWeight: 'bold', backgroundColor: '#3a2b00', color: '#ffce54', border: '1px solid #ffb300' }}>
                                 OPEN ORDER TICKET
                              </button>
                           </form>
                        )}
                     </div>
                     </>
                       );
                     })()}
                  </div>
               ) : <div style={{ textAlign: 'center', color: '#333', marginTop: '150px' }}>Select an active escrow to communicate or finalize.</div>}
            </div>
         </div>
      )}

      {currentTab === "watchlist" && (
        <div className="grid-catalog">
           {favorites.map(fav => (
              <div key={fav.id} className="card">
                 <strong><a href={`/market/product/${fav.product.id}`}>{fav.product.title}</a></strong><br/>
                 <small>By: {fav.product.vendor.username}</small>
                 <form action={toggleFavoriteAction} style={{ marginTop: '10px' }}>
                    <input type="hidden" name="productId" value={fav.product.id} />
                    <button type="submit">[ UNSUB ]</button>
                 </form>
              </div>
           ))}
        </div>
      )}

      {currentTab === "affiliate" && (
         <div className="box" style={{ backgroundColor: '#0a0a0c', borderColor: '#4caf50' }}>
            <h3 className="success">Sovereign Growth Bureau (Affiliates)</h3>
            <p style={{ fontSize: '12px', color: '#888' }}>Earn 10% of the market commission for every completed purchase your referrals make.</p>

            <div style={{ padding: '15px', backgroundColor: '#000', border: '1px solid #1a1a1a', marginBottom: '20px' }}>
               <small style={{ color: '#4caf50', fontSize: '10px' }}>YOUR UNIQUE REFERRAL CODE:</small><br/>
               <code style={{ fontSize: '18px', color: '#fff' }}>{buyerStats?.affiliateCode}</code>
               <p style={{ fontSize: '9px', color: '#555', marginTop: '5px' }}>Example Link: {process.env.ONION_URL}/auth/register?ref={buyerStats?.affiliateCode}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '20px' }}>
              <div className="box" style={{ margin: 0 }}><small>Recruits</small><br/><strong>{buyerStats?.referrals.length || 0}</strong></div>
              <div className="box" style={{ margin: 0 }}><small>Commissions Paid</small><br/><strong className="success">{affiliateTotals.paidXMR.toFixed(5)} XMR</strong></div>
              <div className="box" style={{ margin: 0 }}><small>Generated Fees</small><br/><strong>{affiliateTotals.generatedFeesXMR.toFixed(5)} XMR</strong></div>
            </div>

            <h4>Your Referral Army ({buyerStats?.referrals.length})</h4>
            <table className="dark-table" style={{ width: '100%', fontSize: '11px' }}>
               <thead><tr><th>Recruit</th><th>Enlisted At</th><th>Status</th></tr></thead>
               <tbody>
                  {buyerStats?.referrals.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#333' }}>No active recruits in your Bureau.</td></tr>}
                  {buyerStats?.referrals.map(r => (
                     <tr key={r.username}><td>{r.username}</td><td>{r.joinDate.toLocaleDateString()}</td><td className="success">ACTIVE</td></tr>
                  ))}
               </tbody>
            </table>

            <h4 style={{ marginTop: '25px' }}>Commission Ledger ({affiliateCommissions.length})</h4>
            <table className="dark-table" style={{ width: '100%', fontSize: '11px' }}>
               <thead><tr><th>Date</th><th>Order</th><th>Market Fee</th><th>Commission</th><th>Status</th></tr></thead>
               <tbody>
                  {affiliateCommissions.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#333' }}>No credited affiliate commissions yet.</td></tr>}
                  {affiliateCommissions.map((commission) => (
                    <tr key={commission.id}>
                      <td>{commission.createdAt.toLocaleDateString()}</td>
                      <td>{commission.orderId.slice(0, 10)}</td>
                      <td>{commission.marketFeeXMR.toFixed(5)} XMR</td>
                      <td className="success">{commission.commissionXMR.toFixed(5)} XMR</td>
                      <td>{commission.status}</td>
                    </tr>
                  ))}
               </tbody>
            </table>
         </div>
      )}

      {currentTab === "settings" && (
         <div style={{ maxWidth: '400px' }}>
            <h3>Account Security Settings</h3>
            <form action={updateSecuritySettingsAction}>
               <label>New 6-Digit PIN (Numeric):</label>
               <input type="password" name="newPin" maxLength={6} placeholder="******" style={{ width: '100%', marginBottom: '15px' }} />

               <label>Current PIN (required):</label>
               <input type="password" name="currentPin" maxLength={6} required placeholder="******" style={{ width: '100%', marginBottom: '15px' }} />

               <button type="submit" style={{ width: '100%', padding: '12px' }}>Update Security Settings</button>
            </form>
         </div>
      )}

      {currentTab === "history" && (
         <table className="dark-table" style={{ width: '100%', verticalAlign: 'top' }}>
            <thead><tr><th>Date</th><th>Product</th><th>Delivery</th><th>Rating & Feedback</th><th>Status</th></tr></thead>
            <tbody>
               {orders.length === 0 && <tr><td colSpan={5}>No past records.</td></tr>}
               {orders.map(o => (
                  <tr key={o.id} style={{ verticalAlign: 'top' }}>
                     <td style={{ width: '110px' }}>{o.createdAt.toLocaleDateString()}</td>
                     <td>
                        <strong>{o.product.title}</strong><br/>
                        <small style={{ color: '#666' }}>Vendor: {o.vendor.username}</small>
                     </td>
                     <td>
                        {o.digitalPayloadReceived ? (
                           <div style={{ border: '1px solid #214421', backgroundColor: '#061106', padding: '10px' }}>
                              <div style={{ color: '#4caf50', fontSize: '10px', fontWeight: 'bold', marginBottom: '6px' }}>DIGITAL DELIVERY</div>
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '130px', overflowY: 'auto', color: '#d6ffd6', fontSize: '11px', lineHeight: 1.4 }}>{o.digitalPayloadReceived}</pre>
                           </div>
                        ) : (
                           <span style={{ color: '#666', fontSize: '11px' }}>
                              {o.product.productType === "DIGITAL" ? "Delivery pending." : "Physical order."}
                           </span>
                        )}
                     </td>
                     <td>
                        {o.reviewDone ? (
                           <span className="success" style={{ fontSize: '11px' }}>Feedback submitted</span>
                        ) : (
                           <form action={submitReviewAction}>
                              <input type="hidden" name="orderId" value={o.id} />
                              <label style={{ display: 'block', color: '#aaa', fontSize: '10px', marginBottom: '4px' }}>Rating</label>
                              <select name="rating" defaultValue="5" required style={{ width: '100%', marginBottom: '8px', backgroundColor: '#050505', color: '#ddd', border: '1px solid #333', padding: '8px' }}>
                                 <option value="5">5 - Excellent</option>
                                 <option value="4">4 - Good</option>
                                 <option value="3">3 - Neutral</option>
                                 <option value="2">2 - Poor</option>
                                 <option value="1">1 - Critical</option>
                              </select>
                              <textarea name="comment" rows={3} maxLength={1000} placeholder="Write feedback for this product..." style={{ width: '100%', marginBottom: '8px', fontSize: '11px' }} />
                              <button type="submit" style={{ width: '100%', fontSize: '11px' }}>SUBMIT FEEDBACK</button>
                           </form>
                        )}
                     </td>
                     <td className="success">{o.status}</td>
                  </tr>
               ))}
            </tbody>
         </table>
      )}
    </div>
  );
}
