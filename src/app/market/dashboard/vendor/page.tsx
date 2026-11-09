import { publishProductAction, promoteProductAction, uploadBulkItemsAction, togglePauseProductAction, deleteProductAction, updateProductAction, updateVendorSettingsAction, requestWithdrawalAction } from "@/app/actions/vendor";
import { verifyAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { sendOrderChatAction, updateOrderStatusAction } from "@/app/actions/orders";
import { MARKET_CATEGORIES } from "@/lib/constants";
import { redirect } from "next/navigation";
import { getVendorVacationBlockers } from "@/lib/vendor-vacation";
import { getVendorOperations } from "@/lib/vendor-operations";
import VendorOperationsDashboard from "@/components/VendorOperationsDashboard";

export default async function VendorDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; orderId?: string; error?: string; success?: string; openOrders?: string; openDisputes?: string; from?: string; to?: string }>
}) {
  const session = await verifyAuth();
  const res = await searchParams;
  const activeTab = res.tab || "overview";
  const activeOrderId = res.orderId || "";

  // Fetch real products
  const myProducts = await prisma.product.findMany({
    where: { vendorId: session.userId as string },
    orderBy: { createdAt: "desc" },
    include: { shippingOptions: true }
  });

  // Fetch real orders for this vendor
  const pendingOrders = await prisma.order.findMany({
    where: { vendorId: session.userId as string, status: { not: "COMPLETED" } },
    include: {
      buyer: { select: { username: true, level: true, badges: true, pgpPublicKey: true } },
      product: { select: { title: true, productType: true, category: true, subcategory: true } },
      disputeTicket: { select: { id: true, status: true } },
      supportTicket: { select: { id: true, status: true } },
      messages: { include: { sender: { select: { username: true, role: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" }
  });

  const vendor = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: {
      xp: true, level: true, badges: true, role: true, username: true, joinDate: true,
      privateMirrors: true, totalDispatchHours: true, dispatchedOrdersCount: true,
      disputesWon: true, disputesTotal: true, vendorTerms: true, pgpPublicKey: true,
      isVacationMode: true, walletBalanceXMR: true
    }
  });

  // Financial Intelligence Engine
  const allVendorOrders = await prisma.order.findMany({
    where: { vendorId: session.userId as string },
    include: { product: { select: { title: true } } }
  });

  const totalRevenue = allVendorOrders
    .filter(o => o.status === "COMPLETED")
    .reduce((sum, o) => sum + ((Number(o.totalXMR) - Number(o.marketFeeXMR))), 0);
  const completedSalesCount = allVendorOrders.filter(o => o.status === "COMPLETED").length;
  const vacationBlockers = await getVendorVacationBlockers(session.userId as string);
  const vacationActivationBlocked = !vendor?.isVacationMode && vacationBlockers.total > 0;
  const errorMessage = res.error === "VacationBlocked"
    ? `Vacation mode cannot be activated while you have ${res.openOrders || vacationBlockers.openOrders} open order(s) and ${res.openDisputes || vacationBlockers.openDisputes} unresolved dispute(s).`
    : res.error === "BuyerNotFound" ? "Buyer not found or unavailable for whitelisting."
      : res.error === "WhitelistLimitReached" ? "The whitelist limit of 500 buyers has been reached."
        : res.error === "WhitelistUsernameRequired" ? "Enter a buyer username."
          : res.error;
  const successMessage = res.success === "BuyerWhitelisted" ? "Buyer added to your whitelist."
    : res.success === "BuyerRemovedFromWhitelist" ? "Buyer removed from your whitelist."
      : res.success;
  const operations = activeTab === "operations"
    ? await getVendorOperations(session.userId as string, res.from, res.to)
    : null;

  const pendingRevenue = allVendorOrders
    .filter(o => ["ESCROW", "SHIPPED", "PENDING", "DISPUTE"].includes(o.status))
    .reduce((sum, o) => sum + ((Number(o.totalXMR) - Number(o.marketFeeXMR))), 0);

  const handleShip = async (formData: FormData) => {
    "use server";
    const orderId = formData.get("orderId")?.toString();
    if (orderId) {
      const result = await updateOrderStatusAction(orderId, "SHIPPED", formData);
      if (result && "error" in result && result.error) {
        redirect(`/market/dashboard/vendor?tab=overview&orderId=${orderId}&error=${encodeURIComponent(result.error)}`);
      }
      redirect(`/market/dashboard/vendor?tab=overview&orderId=${orderId}&success=OrderStatusUpdated`);
    }
  };

  const handleGenerateMirror = async () => {
    "use server";
    const { generatePrivateMirrorAction } = await import("@/app/actions/mirrors");
    await generatePrivateMirrorAction();
  };

  const getAutoFinalizeText = (shippedAt: Date | null) => {
    if (!shippedAt) return null;
    const deadline = new Date(shippedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();
    if (diff <= 0) return "Ready for release";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return `Auto-Finalizes in ${days}d`;
  };

  return (
    <div className="box">
      {res.error && <div style={{ color: '#fff', backgroundColor: '#d9534f', padding: '10px', marginBottom: '10px', fontSize: '13px' }}>ERROR: {errorMessage}</div>}
      {res.success && <div style={{ color: '#fff', backgroundColor: '#5cb85c', padding: '10px', marginBottom: '10px', fontSize: '13px' }}>SUCCESS: {successMessage}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <h2>Commercial Security Module (Vendor)</h2>
         <div style={{ fontSize: '11px', color: '#666' }}>ID: {session.userId?.slice(0, 8)} | v2.5.0-ELITE</div>
      </div>
      <hr/>

      <p style={{ marginBottom: '20px' }}>
        [ <a href="?tab=overview" style={activeTab === 'overview' ? { color: '#f26822', fontWeight: 'bold' } : { color: '#888' }}>Orders</a> ] -
        [ <a href="?tab=products" style={activeTab === 'products' ? { color: '#f26822', fontWeight: 'bold' } : { color: '#888' }}>Inventory</a> ] -
        [ <a href="?tab=operations" style={activeTab === 'operations' ? { color: '#f26822', fontWeight: 'bold' } : { color: '#888' }}>Operations</a> ] -
        [ <a href="?tab=reports" style={activeTab === 'reports' ? { color: '#f26822', fontWeight: 'bold' } : { color: '#888' }}>Reports & Finance</a> ] -
        [ <a href="?tab=settings" style={activeTab === 'settings' ? { color: '#f26822', fontWeight: 'bold' } : { color: '#888' }}>⚙️ Settings</a> ]
      </p>

      {activeTab === "overview" && (
        <div>
          {vendor && (vendor as any).level >= 5 && (
            <div style={{ padding: '15px', backgroundColor: '#ecf0f10d', border: '1px solid #004444', marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#00bcd4' }}>🛡️ VIP STEALTH LANDING (PERSONAL MIRROR)</h4>
                {(vendor as any).privateMirrors.length === 0 ? (
                  <form action={handleGenerateMirror}>
                      <button type="submit" style={{ backgroundColor: '#004444', color: '#fff', fontSize: '11px', fontWeight: 'bold', padding: '5px 15px', border: '1px solid #00bcd4', cursor: 'pointer' }}>GENERATE SOVEREIGN ACCESS LINK</button>
                  </form>
                ) : (
                  <div>
                      <div style={{ fontSize: '10px', color: '#008888' }}>YOUR UNIQUE VENDOR ENTRY:</div>
                      <code style={{ fontSize: '14px', color: '#00bcd4' }}>{(vendor as any).privateMirrors[0].domain}</code>
                      <p style={{ fontSize: '10px', color: '#005555', marginTop: '5px' }}>High-availability access during DDoS attacks. Share only with VIP customers.</p>
                  </div>
                )}
            </div>
          )}

          <h3>Active Customer Orders</h3>
          <div className="vendor-order-board">
             {pendingOrders.length === 0 && (
                <div className="vendor-order-empty">No active orders.</div>
             )}
             {pendingOrders.map(order => (
                <article key={order.id} className={activeOrderId === order.id ? "vendor-order-card active" : "vendor-order-card"}>
                  <a className="vendor-order-summary" href={`?tab=overview&orderId=${order.id}`}>
                    <strong>{order.product.title}</strong>
                    <span>{order.status}</span>
                    <small>{order.createdAt.toLocaleString()} / {order.buyer.username} / {order.totalXMR.toFixed(5)} XMR</small>
                  </a>

                  {activeOrderId === order.id && (
                    <section className="vendor-order-detail">
                      <dl>
                        <dt>Order ID</dt><dd>{order.id}</dd>
                        <dt>Buyer</dt><dd>{order.buyer.username} / level {order.buyer.level} / {order.buyer.badges || "no badge"}</dd>
                        <dt>Product</dt><dd>{order.product.title} / {order.product.productType} / {order.product.category} / {order.product.subcategory}</dd>
                        <dt>Total</dt><dd>{order.totalXMR.toFixed(5)} XMR</dd>
                        <dt>Escrow fee</dt><dd>{order.marketFeeXMR.toFixed(5)} XMR</dd>
                        <dt>Shipping</dt><dd>{order.shippingOptionName || "N/A"} / {order.shippingCostXMR.toFixed(5)} XMR</dd>
                        <dt>Payment</dt><dd>{order.paymentType} / {order.paymentConfirmed ? "confirmed" : "unconfirmed"}</dd>
                        <dt>Tracking</dt><dd>{order.trackingNumber || "Not set"}</dd>
                        <dt>Buyer PGP</dt><dd>{order.buyer.pgpPublicKey ? "Configured" : "Missing"}</dd>
                      </dl>

                      <div className="vendor-order-address">
                        <strong>Encrypted shipping address</strong>
                        <textarea readOnly rows={5} value={order.shippingPayload || "No physical address payload for this order."} />
                      </div>

                      <div className="vendor-order-status">
                        {order.status === "PENDING" ? (
                          <form action={handleShip}>
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="text" name="trackingNumber" placeholder="Tracking code or delivery note" />
                            <button type="submit">Mark as Shipped</button>
                          </form>
                        ) : (
                          <span>{order.status === "SHIPPED" ? getAutoFinalizeText(order.shippedAt) || "Waiting buyer release" : "Escrow locked"}</span>
                        )}
                      </div>

                      <div className="vendor-order-chat">
                        <header>
                          <strong>PGP chat with buyer</strong>
                          <small>{order.messages.length} messages</small>
                        </header>
                        <div>
                          {order.messages.length === 0 && <p>No messages yet. Keep every message PGP encrypted.</p>}
                          {order.messages.map(message => (
                            <article key={message.id} className={message.sender.role === "VENDOR" ? "outbound" : "inbound"}>
                              <small>{message.sender.username} / {message.createdAt.toLocaleString()}</small>
                              <pre>{message.content}</pre>
                            </article>
                          ))}
                        </div>
                        <form action={sendOrderChatAction}>
                          <input type="hidden" name="orderId" value={order.id} />
                          <input type="hidden" name="returnTo" value={`/market/dashboard/vendor?tab=overview&orderId=${order.id}&success=MessageSent`} />
                          <textarea name="content" rows={4} required placeholder="-----BEGIN PGP MESSAGE-----" />
                          <button type="submit">Send PGP Message</button>
                        </form>
                      </div>

                      <div className="vendor-order-support">
                        {(order.disputeTicket || order.supportTicket) ? (
                          <a href={`/market/support/${(order.disputeTicket || order.supportTicket)?.id}`}>
                            Open support channel ({(order.disputeTicket || order.supportTicket)?.status})
                          </a>
                        ) : (
                          <details>
                            <summary>Open support / dispute channel</summary>
                            <form action="/api/support/order-ticket" method="post">
                              <input type="hidden" name="orderId" value={order.id} />
                              <input type="hidden" name="priority" value="HIGH" />
                              <textarea name="content" rows={4} required placeholder="-----BEGIN PGP MESSAGE-----" />
                              <button type="submit">Open Shared Channel</button>
                            </form>
                          </details>
                        )}
                      </div>
                    </section>
                  )}
                </article>
             ))}
          </div>
        </div>
      )}

      {activeTab === "products" && (
        <div className="vendor-products-layout">
          <div>
            <h3>Manage Existing Inventory</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
               {myProducts.map(prod => (
                  <div key={prod.id} className="box" style={{ padding: '15px', backgroundColor: '#090909', border: prod.isPromoted ? '1px solid #f26822' : '1px solid #333' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                           <strong style={prod.isPromoted ? { color: '#f26822' } : {}}>{prod.title}</strong><br/>
                           <small style={{ color: '#666' }}>{prod.priceXMR.toString()} XMR | {prod.quantity} Stock</small>
                        </div>
                        <div style={{ textAlign: 'right', display: 'flex', gap: '5px' }}>
                           <form action={togglePauseProductAction} style={{ margin: 0 }}>
                              <input type="hidden" name="productId" value={prod.id} />
                              <button type="submit" style={{ fontSize: '10px', padding: '4px 8px', backgroundColor: (prod as any).isPaused ? '#4caf50' : '#f26822', color: '#000' }}>
                                 {(prod as any).isPaused ? "RESUME" : "PAUSE"}
                              </button>
                           </form>
                           <form action={deleteProductAction} style={{ margin: 0 }}>
                              <input type="hidden" name="productId" value={prod.id} />
                              <button type="submit" style={{ fontSize: '10px', padding: '4px 8px', backgroundColor: '#d9534f', color: '#fff' }}>DEL</button>
                           </form>
                        </div>
                     </div>

                     <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <form action={uploadBulkItemsAction} style={{ flex: 1 }}>
                           <input type="hidden" name="productId" value={prod.id} />
                           <textarea name="items" rows={1} placeholder="Bulk upload accounts..." style={{ width: '100%', fontSize: '9px', backgroundColor: '#111', color: '#ccc' }} />
                           <button type="submit" style={{ width: '100%', fontSize: '9px', padding: '3px' }}>Bulk Items Add</button>
                        </form>

                        {/* BOOST FORM */}
                        <form action={promoteProductAction} style={{ flex: 1, backgroundColor: '#111', padding: '5px', border: '1px solid #222' }}>
                           <input type="hidden" name="productId" value={prod.id} />
                           <select name="tier" style={{ width: '100%', fontSize: '9px', marginBottom: '3px', backgroundColor: '#000', color: '#f26822' }}>
                              <option value="3">⚡ 3 Days (0.50 XMR)</option>
                              <option value="7">🔥 7 Days (0.75 XMR)</option>
                              <option value="15">👑 15 Days (1.20 XMR)</option>
                           </select>
                           <button type="submit" style={{ width: '100%', fontSize: '9px', padding: '3px', backgroundColor: '#f26822', color: '#000', fontWeight: 'bold' }}>⚡ BOOST Exposure</button>
                        </form>
                     </div>
                     <details className="vendor-edit-listing">
                        <summary>Edit Listing</summary>
                        <form action={updateProductAction} className="vendor-listing-form compact">
                           <input type="hidden" name="productId" value={prod.id} />
                           <label>
                              <span>Title</span>
                              <input type="text" name="title" maxLength={120} required defaultValue={prod.title} />
                           </label>
                           <div className="vendor-form-grid two">
                              <label>
                                 <span>Price</span>
                                 <input type="number" step="0.0001" min="0.0001" name="price" required defaultValue={prod.priceXMR.toString()} />
                              </label>
                              <label>
                                 <span>Quantity</span>
                                 <input type="number" min="1" name="quantity" required defaultValue={prod.quantity} />
                              </label>
                           </div>
                           <div className="vendor-form-grid two">
                              <label>
                                 <span>Type</span>
                                 <select name="product_type" defaultValue={prod.productType}>
                                    <option value="PHYSICAL">Physical goods</option>
                                    <option value="DIGITAL">Digital content</option>
                                 </select>
                              </label>
                              <label>
                                 <span>Category</span>
                                 <select name="category" required defaultValue={prod.category}>
                                    {MARKET_CATEGORIES.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
                                 </select>
                              </label>
                           </div>
                           <label>
                              <span>Subcategory</span>
                              <select name="subcategory" required defaultValue={prod.subcategory}>
                                 {MARKET_CATEGORIES.map(cat => (
                                    <optgroup key={cat.id} label={cat.label}>
                                       {cat.subcategories.map(sub => <option key={`${prod.id}-${cat.id}-${sub}`} value={sub}>{sub}</option>)}
                                    </optgroup>
                                 ))}
                              </select>
                           </label>
                           <div className="vendor-form-grid two">
                              <label>
                                 <span>Ships from</span>
                                 <input type="text" name="ships_from" required defaultValue={prod.originShipsFrom} />
                              </label>
                              <label>
                                 <span>Ships to</span>
                                 <input type="text" name="ships_to" required defaultValue={prod.shipsTo} />
                              </label>
                           </div>
                           <label>
                              <span>Delivery note</span>
                              <input type="text" name="shipping_name_1" defaultValue={prod.shippingOptions[0]?.name || ""} />
                              <input type="hidden" name="shipping_cost_1" value="0" />
                           </label>
                           <label>
                              <span>Short description</span>
                              <textarea name="desc" rows={3} maxLength={500} required defaultValue={prod.description} />
                           </label>
                           <label>
                              <span>Full description</span>
                              <textarea name="full_desc" rows={5} required defaultValue={prod.fullDescription || prod.description} />
                           </label>
                           <label>
                              <span>Tags</span>
                              <input type="text" name="tags" defaultValue={prod.tags || ""} />
                           </label>
                           <fieldset className="vendor-image-fields">
                              <legend>Product images (up to 3)</legend>
                              <textarea name="image1" rows={3} defaultValue={prod.image1 || prod.imageUrl || ""} />
                              <textarea name="image2" rows={3} defaultValue={prod.image2 || ""} />
                              <textarea name="image3" rows={3} defaultValue={prod.image3 || ""} />
                           </fieldset>
                           <button type="submit">Save Edit</button>
                        </form>
                     </details>
                  </div>
               ))}
            </div>
          </div>

          <div>
            <h3>New Listing</h3>
            <form action={publishProductAction} className="vendor-listing-form">
               <label>
                  <span>Title</span>
                  <input type="text" name="title" maxLength={120} required placeholder="Product title" />
               </label>

               <div className="vendor-form-grid two">
                  <label>
                     <span>Price</span>
                     <input type="number" step="0.0001" min="0.0001" name="price" required placeholder="XMR" />
                  </label>
                  <label>
                     <span>Quantity</span>
                     <input type="number" min="1" name="quantity" required placeholder="Stock" />
                  </label>
               </div>

               <div className="vendor-form-grid two">
                  <label>
                     <span>Type</span>
                     <select name="product_type" defaultValue="PHYSICAL">
                        <option value="PHYSICAL">Physical goods</option>
                        <option value="DIGITAL">Digital content</option>
                     </select>
                  </label>
                  <label>
                     <span>Category</span>
                     <select name="category" required defaultValue={MARKET_CATEGORIES[0]?.label}>
                        {MARKET_CATEGORIES.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
                     </select>
                  </label>
               </div>

               <label>
                  <span>Subcategory</span>
                  <select name="subcategory" required defaultValue="Other">
                     {MARKET_CATEGORIES.map(cat => (
                        <optgroup key={cat.id} label={cat.label}>
                           {cat.subcategories.map(sub => <option key={`${cat.id}-${sub}`} value={sub}>{sub}</option>)}
                        </optgroup>
                     ))}
                  </select>
               </label>

               <div className="vendor-form-grid two">
                  <label>
                     <span>Ships from</span>
                     <input type="text" name="ships_from" required placeholder="Country, region, warehouse, or digital" />
                  </label>
                  <label>
                     <span>Ships to</span>
                     <input type="text" name="ships_to" required defaultValue="Worldwide" placeholder="Worldwide or specific countries/regions" />
                  </label>
               </div>

               <label>
                  <span>Delivery note</span>
                  <input type="text" name="shipping_name_1" placeholder="Optional delivery method or locality note" />
                  <input type="hidden" name="shipping_cost_1" value="0" />
               </label>

               <label>
                  <span>Short description</span>
                  <textarea name="desc" rows={3} maxLength={500} required placeholder="Short product summary shown in catalog cards" />
               </label>

               <label>
                  <span>Full description</span>
                  <textarea name="full_desc" rows={6} required placeholder="Detailed listing content, terms, requirements, and delivery expectations" />
               </label>

               <label>
                  <span>Tags</span>
                  <input type="text" name="tags" placeholder="comma, separated, searchable, keywords" />
               </label>

               <fieldset className="vendor-image-fields">
                  <legend>Product images (up to 3)</legend>
                  <textarea name="image1" rows={3} placeholder="Image 1 URL or data:image block" />
                  <textarea name="image2" rows={3} placeholder="Image 2 URL or data:image block" />
                  <textarea name="image3" rows={3} placeholder="Image 3 URL or data:image block" />
               </fieldset>

               <button type="submit">Submit Listing for Review</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === "operations" && operations && (
        <VendorOperationsDashboard data={operations} />
      )}

      {activeTab === "reports" && (
        <div>
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
              <div className="box" style={{ textAlign: 'center', borderColor: '#4caf50' }}>
                 <div style={{ fontSize: '10px', color: '#666' }}>BALANCE AVAILABLE / EARNED</div>
                 <div style={{ fontSize: '24px', color: '#4caf50' }}>{vendor?.walletBalanceXMR.toFixed(4)} XMR</div>
                 <div style={{ fontSize: '10px', color: '#888', marginTop: '5px' }}>Lifetime Earnings: {totalRevenue.toFixed(4)} XMR</div>
              </div>
              <div className="box" style={{ textAlign: 'center', borderColor: '#f26822' }}>
                 <div style={{ fontSize: '10px', color: '#666' }}>LOCKED IN ESCROW</div>
                 <div style={{ fontSize: '24px', color: '#f26822' }}>{pendingRevenue.toFixed(4)} XMR</div>
                 <div style={{ fontSize: '10px', color: '#888', marginTop: '5px' }}>{pendingOrders.length} active orders pending release</div>
              </div>
           </div>

           <div className="box" style={{ backgroundColor: '#0c0c10', borderColor: '#333' }}>
              <h3>Withdraw Profits (Sovereign Payout)</h3>
              <p style={{ fontSize: '11px', color: '#888' }}>Funds will be processed to an external wallet via the Monero RPC daemon.</p>
              <form action={requestWithdrawalAction} style={{ marginTop: '15px' }}>
                 <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <div style={{ flex: 2 }}>
                       <label style={{ fontSize: '11px' }}>Destination XMR Address:</label>
                       <input type="text" name="address" required placeholder="48..." style={{ width: '100%', padding: '8px' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                       <label style={{ fontSize: '11px' }}>Amount (XMR):</label>
                       <input type="number" step="0.0001" name="amount" required style={{ width: '100%', padding: '8px' }} />
                    </div>
                 </div>
                 <div style={{ marginBottom: '15px' }}>
                    <label style={{ fontSize: '11px' }}>Security PIN (Numeric):</label>
                    <input type="password" name="pin" maxLength={6} required placeholder="******" style={{ width: '200px', padding: '8px' }} />
                 </div>
                 <button type="submit" className="success" style={{ padding: '10px 30px', fontWeight: 'bold' }}>Initiate Withdrawal</button>
                 <span style={{ fontSize: '9px', color: '#555', marginLeft: '15px' }}>No platform withdrawal fee.</span>
              </form>
           </div>
        </div>
      )}

      {activeTab === "settings" && (
         <div style={{ display: 'flex', gap: '30px' }}>
            <div style={{ flex: 1 }}>
               <h3>Storefront Intelligence & Identity</h3>
               <form action={updateVendorSettingsAction}>
                  <div style={{ marginBottom: '20px' }}>
                     <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '15px', backgroundColor: vendor?.isVacationMode ? '#1a1010' : '#101a10', border: '1px solid #333', cursor: 'pointer' }}>
                        <input type="checkbox" name="vacationMode" value="yes" defaultChecked={vendor?.isVacationMode} disabled={vacationActivationBlocked} />
                        <div>
                           <strong style={{ color: vendor?.isVacationMode ? '#f44336' : '#4caf50' }}>VACATION MODE</strong><br/>
                           <small style={{ fontSize: '10px', color: '#888' }}>When active, all your listings are hidden and checkout is blocked.</small>
                           {vacationActivationBlocked && (
                             <small style={{ display: 'block', marginTop: '5px', fontSize: '10px', color: '#ffb300' }}>
                               Resolve {vacationBlockers.openOrders} open order(s) and {vacationBlockers.openDisputes} dispute(s) before activating vacation mode.
                             </small>
                           )}
                        </div>
                     </label>
                  </div>

                  <div style={{ padding: '12px', marginBottom: '15px', border: '1px solid #244047', backgroundColor: '#071014' }}>
                    <strong style={{ color: '#67d9e8', fontSize: '11px' }}>PGP 2FA: {vendor?.pgpPublicKey ? 'ACTIVE' : 'ENROLLMENT REQUIRED'}</strong>
                    <p style={{ margin: '6px 0 0', color: '#71868c', fontSize: '10px' }}>Change your PGP public key from the Identity profile, where your account PIN is required.</p>
                    <a href="/market/profile" style={{ display: 'inline-block', marginTop: '7px', fontSize: '10px' }}>OPEN IDENTITY PROFILE</a>
                  </div>

                  <label>Vendor Terms of Service (Refund Policy):</label>
                  <textarea name="vendorTerms" rows={6} placeholder="Define your shipping rules, reship policy, and expected delivery times..." defaultValue={vendor?.vendorTerms || ''} style={{ width: '100%', fontSize: '11px', marginBottom: '20px' }} />

                  <button type="submit" style={{ width: '100%', padding: '12px', fontWeight: 'bold' }}>Update Storefront Settings</button>
               </form>
            </div>
            <div style={{ width: '300px' }}>
               <div className="box" style={{ backgroundColor: '#050505' }}>
                  <h4>Commercial Stats</h4>
                  <ul style={{ fontSize: '12px', color: '#888', padding: '0 0 0 15px' }}>
                     <li>Completed Sales: {completedSalesCount}</li>
                     <li>Sales Level: {vendor?.level}</li>
                     <li>XP: {vendor?.xp}</li>
                     <li>Disputes Won: {vendor?.disputesWon} / {vendor?.disputesTotal}</li>
                     <li>Dispatch Velocity: {vendor?.dispatchedOrdersCount ? (vendor.totalDispatchHours / vendor.dispatchedOrdersCount).toFixed(1) : 'N/A'} hrs</li>
                  </ul>
               </div>
            </div>
         </div>
      )}
    </div>
  );
}
