/* eslint-disable @next/next/no-img-element -- Vendor images are rendered as plain HTML for the no-JS/onion-compatible storefront. */
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notFound } from "next/navigation";
import { placeOrderAction } from "@/app/actions/orders";
import { toggleFavoriteAction } from "@/app/actions/favorites";
import { sendMessageAction } from "@/app/actions/messages";
import { recordBehavior } from "@/lib/events";
import { getPromotedProductRecommendations } from "@/lib/search";

export default async function ProductCheckout({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const session = await getSession();

  const productInfo = await prisma.product.findUnique({
     where: { id: resolvedParams.id },
     include: {
        shippingOptions: true,
        vendor: { select: { id: true, username: true, level: true, badges: true, pgpPublicKey: true, isVacationMode: true, isBanned: true, trustScore: true, vendorTerms: true } },
        reviews: {
           select: {
              id: true, rating: true, comment: true, createdAt: true,
              buyer: { select: { username: true } }
           },
           orderBy: { createdAt: 'desc' }
        },
        favoritedBy: {
          where: { userId: session?.userId || "" }
        }
     }
  });

  if (!productInfo) {
     return notFound();
  }

  const canInspectUnavailableListing = session?.role === "ADMIN" || session?.userId === productInfo.vendor.id;
  const listingIsPublic = productInfo.moderationStatus === "APPROVED"
    && !productInfo.isPaused
    && productInfo.quantity > 0
    && !productInfo.vendor.isVacationMode
    && !productInfo.vendor.isBanned;
  if (!listingIsPublic && !canInspectUnavailableListing) return notFound();

  await recordBehavior({
    userId: session?.userId as string | undefined,
    productId: productInfo.id,
    category: productInfo.category,
    action: "VIEW",
    weight: 1,
  });

  const isFavorited = productInfo.favoritedBy.length > 0;
  const canContactVendor = !!session?.userId && session.userId !== productInfo.vendor.id;

  // Fetch real buyer balance
  let buyerBalance = 0;
  if (session?.userId) {
    const user = await prisma.user.findUnique({ where: { id: session.userId as string }, select: { walletBalanceXMR: true } });
    buyerBalance = Number(user?.walletBalanceXMR || 0);
  }

  const galleryImages = [
    productInfo.imageUrl,
    productInfo.image1,
    productInfo.image2,
    productInfo.image3,
    productInfo.image4,
    productInfo.image5,
    productInfo.image6,
  ].filter(img => img && img.trim() !== "");
  const promotedRecommendations = await getPromotedProductRecommendations({
    currentProductId: productInfo.id,
    category: productInfo.category,
    subcategory: productInfo.subcategory,
    tags: productInfo.tags,
    viewerId: session?.userId as string | undefined,
    take: 4,
  });

  return (
    <>
    <div style={{ display: 'flex', gap: '20px' }}>

      {/* Left Column: Product and Reviews */}
      <div style={{ flex: 1 }}>
         <div className="box" style={{ padding: 0, overflow: 'hidden', borderColor: productInfo.isAutoshop ? '#4caf50' : '#333' }}>
            <div style={{ backgroundColor: '#0a0a0d', padding: '15px', borderBottom: '1px solid #222' }}>
               {/* Gallery View */}
               {galleryImages.length > 0 ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                    <div style={{ width: '100%', maxHeight: '450px', overflow: 'hidden', display: 'flex', justifyContent: 'center', backgroundColor: '#000' }}>
                       <img src={galleryImages[0] as string} alt={productInfo.title} style={{ maxWidth: '100%', maxHeight: '450px', objectFit: 'contain' }} />
                    </div>
                    {galleryImages.length > 1 && (
                       <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', padding: '10px 0' }}>
                          {galleryImages.map((img, idx) => (
                            <div key={idx} style={{ width: '60px', height: '60px', border: '1px solid #333', overflow: 'hidden', cursor: 'pointer', opacity: 0.7 }}>
                               <img src={img as string} alt={`${productInfo.title} thumbnail ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ))}
                       </div>
                    )}
                 </div>
               ) : (
                 <div style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '80px', height: '80px', border: '2px solid #333', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '30px', marginBottom: '15px' }}>🛡️</div>
                    <div style={{ color: '#555', fontSize: '12px', letterSpacing: '2px' }}>ENCRYPTED IMAGE METADATA</div>
                    <div style={{ color: '#333', fontSize: '10px', marginTop: '5px' }}>No visual data published by vendor</div>
                 </div>
               )}
            </div>
            <div style={{ padding: '20px' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                 <div>
                    <h2 style={{ margin: '0 0 5px 0', color: '#f26822' }}>{productInfo.title}</h2>
                    {productInfo.tags && (
                      <div style={{ marginBottom: '15px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {productInfo.tags.split(',').map(tag => (
                            <a href={`/market?q=${tag.trim()}`} key={tag} style={{ fontSize: '10px', backgroundColor: '#ecf0f10d', padding: '2px 8px', color: '#00bcd4', textDecoration: 'none', border: '1px solid #004444' }}>
                              #{tag.trim()}
                            </a>
                        ))}
                      </div>
                    )}
                 </div>
                 {/* Watchlist Toggle Form */}
                 <form action={toggleFavoriteAction}>
                    <input type="hidden" name="productId" value={productInfo.id} />
                    <button type="submit" style={{
                      backgroundColor: isFavorited ? '#f26822' : 'transparent',
                      color: isFavorited ? '#000' : '#f26822',
                      border: '1px solid #f26822',
                      padding: '5px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}>
                      {isFavorited ? "⭐ ON WATCHLIST" : "☆ ADD TO WATCHLIST"}
                    </button>
                 </form>
               </div>

               {productInfo.isAutoshop && <div className="success" style={{ display: 'inline-block', marginBottom: '10px', fontSize: '11px', border: '1px solid #4caf50', padding: '2px 5px' }}>[ INSTANT DIGITAL DISPATCHING - NO ESCROW ]</div>}

               <div style={{ fontSize: '13px', color: '#ccc', marginBottom: '20px', lineHeight: '1.8', borderTop: '1px solid #1a1a1a', paddingTop: '15px' }}>
                  <strong>Vendor:</strong> <a href={`/market/vendor/${productInfo.vendor.username}`} style={{ color: '#f26822', textDecoration: 'none' }}>{productInfo.vendor.username}</a>
                  <span className={productInfo.vendor.trustScore > 90 ? "success" : "warning"} style={{ fontSize: '11px', marginLeft: '10px', border: '1px solid', padding: '0 5px' }}>
                     [ SELLER LEVEL {productInfo.vendor.level} ]
                  </span>
                  <br/>
                  <strong>🚢 ORIGIN:</strong> <span style={{ color: '#fff' }}>{productInfo.originShipsFrom}</span> ➜ <strong>DESTINATION:</strong> <span style={{ color: '#fff' }}>{productInfo.shipsTo}</span><br/>
                  <strong>📊 STOCK AVAILABILITY:</strong> <span style={{ color: productInfo.quantity > 5 ? '#4caf50' : '#f26822' }}>{productInfo.quantity} units</span> in inventory.
               </div>

               <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '5px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px' }}>Product Specifications</h3>
               <p style={{ whiteSpace: 'pre-wrap', color: '#aaa', lineHeight: '1.6', fontSize: '13px' }}>
                  {productInfo.fullDescription || productInfo.description}
               </p>

               {/* VENDOR TERMS / REFUND POLICY */}
               {productInfo.vendor.vendorTerms && (
                  <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#0c0c0e', border: '1px solid #333' }}>
                     <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#f26822' }}>📜 VENDOR REFUND POLICY & TERMS:</h3>
                     <p style={{ fontSize: '12px', color: '#888', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                        {productInfo.vendor.vendorTerms}
                     </p>
                  </div>
               )}
            </div>
         </div>

          {/* Reviews Section */}
          <div className="box">
             <h3>Customer Feedback (Reviews)</h3>
             <hr/>
             {productInfo.reviews.length === 0 && <p style={{ color: '#666', textAlign: 'center' }}>No real cryptographic feedback found for this material.</p>}
             {productInfo.reviews.map((r: any) => (
                <div className="review-box" key={r.id}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <strong>Buyer: <i>{r.buyer.username}</i></strong>
                      <span className="star-rating">
                         {"★".repeat(r.rating) + "☆".repeat(5-r.rating)}
                      </span>
                   </div>
                   <p style={{ margin: '5px 0', color: '#ccc' }}>"{r.comment}"</p>
                   <small style={{ color: '#777' }}>Order Confirmed: {r.createdAt.toLocaleDateString()}</small>
                </div>
             ))}
          </div>
      </div>

      {/* Right Column: Checkout Box and Escrow */}
      <div className="box" style={{ width: '380px', height: 'fit-content' }}>
        <h2 style={{ color: '#4caf50', textAlign: 'center' }}>{productInfo.priceXMR.toFixed(4)} XMR</h2>
        <hr/>

        <h3 className={productInfo.requiresFE ? "danger" : "warning"}>
           Payment Panel {productInfo.requiresFE && "(F.E. Required)"}
        </h3>

        <p style={{ fontSize: '12px' }}>
          {productInfo.isAutoshop
             ? "This is a Digital Dispatching item. The listed value will be immediately extracted from your Wallet and the data will drop decrypted into your PGP Message Central."
             : "Shipping instructions MUST be encrypted locally using the Vendor Key below."}
        </p>

        {!productInfo.isAutoshop && (
          <textarea
             readOnly
             rows={6}
             defaultValue={productInfo.vendor.pgpPublicKey || '-----BEGIN PGP PUBLIC KEY BLOCK-----\n[Vendor has not set a PGP key]\n-----END PGP PUBLIC KEY BLOCK-----'}
             style={{ fontSize: '10px', width: '100%' }}
          />
        )}

        <div style={{ marginTop: '15px', padding: '12px', backgroundColor: '#061010', border: '1px solid #004d4d', fontSize: '11px' }}>
          <strong style={{ color: '#00bcd4' }}>Contact Seller Securely</strong>
          <p style={{ color: '#777', lineHeight: '1.5', margin: '8px 0' }}>
            Encrypt your question with the vendor PGP key before sending. Plain text is rejected by the server.
          </p>
          {canContactVendor ? (
            <form action={sendMessageAction}>
              <input type="hidden" name="receiver" value={productInfo.vendor.username} />
              <textarea
                name="payload"
                rows={6}
                required
                placeholder={`-----BEGIN PGP MESSAGE-----\n...`}
                style={{ width: '100%', fontSize: '10px', marginBottom: '10px', backgroundColor: '#000', color: '#ddd', border: '1px solid #244' }}
              />
              <button type="submit" style={{ width: '100%', padding: '9px', fontWeight: 'bold', backgroundColor: '#003b3b', border: '1px solid #00bcd4', color: '#00e5ff' }}>
                SEND PGP MESSAGE TO {productInfo.vendor.username}
              </button>
            </form>
          ) : (
            <a href="/auth/login" style={{ display: 'block', color: '#00bcd4', textDecoration: 'none', marginTop: '8px' }}>
              Sign in to contact this vendor
            </a>
          )}
        </div>

        {productInfo.vendor.isVacationMode && (
          <div className="danger" style={{ padding: '15px', textAlign: 'center', marginBottom: '15px', border: '1px solid #f44336' }}>
            🌴 VENDOR IS ON VACATION<br/>
            <small style={{ fontSize: '10px' }}>Purchases are temporarily suspended for this storefront.</small>
          </div>
        )}

        <form action={placeOrderAction} style={{ marginTop: '15px' }}>
           <input type="hidden" name="productId" value={productInfo.id} />

           {/* SHIPPING OPTION SELECTION */}
           {productInfo.productType === "PHYSICAL" && (
              <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#0d0d0d', border: '1px solid #333' }}>
                 <label style={{ fontSize: '11px', color: '#f26822', display: 'block', marginBottom: '5px' }}>CHOOSE SHIPPING LOGISTICS:</label>
                 <select name="shipping_option" required style={{ width: '100%', padding: '8px', backgroundColor: '#000', color: '#fff', border: '1px solid #444', fontSize: '12px' }}>
                    <option value="">-- SELECT SHIPPING --</option>
                    {productInfo.shippingOptions.map(opt => (
                       <option key={opt.id} value={opt.id}>{opt.name} (+{opt.costXMR.toFixed(4)} XMR)</option>
                    ))}
                    {productInfo.shippingOptions.length === 0 && <option value="default">Standard Delivery (Included)</option>}
                 </select>
              </div>
           )}

           {productInfo.productType === "DIGITAL" && (
              <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#0d1a0d', border: '1px solid #4caf50', fontSize: '11px', color: '#4caf50' }}>
                 ⚡ DIGITAL DELIVERY: This item will be dispatched immediately to your dashboard upon settlement.
              </div>
           )}

           {productInfo.productType === "PHYSICAL" && !productInfo.isAutoshop && (
             <>
               <label>Your Instructions (PO.BOX/Address):</label><br/>
               <textarea
                  name="pgpmessage"
                  rows={6}
                  required
                  placeholder="PASTE PGP ENCRYPTED BLOCK HERE..."
                  style={{ width: '100%', marginBottom: '10px' }}
                />
               <div style={{ padding: '8px', border: '1px dashed #333', fontSize: '10px', color: '#666', textAlign: 'center' }}>
                  🛡️ LOCAL ENCRYPTION TERMINATED FOR OPSEC.<br/>Use external PGP software.
               </div>
               <br/>
             </>
           )}

           <div className={(productInfo.requiresFE || productInfo.productType === "DIGITAL") ? "notice danger-border" : "notice"} style={{ fontSize: '11px', textAlign: 'center', borderColor: (productInfo.requiresFE || productInfo.productType === "DIGITAL") ? '#f44336' : '' }}>
             {(productInfo.requiresFE || productInfo.productType === "DIGITAL")
               ? "Capital Risk: Funds go straight to the vendor (Auto-FE)."
               : "Your Escrow will be retained under The Bank contract."}
             <br/>
             <strong>Wallet Balance: {buyerBalance.toFixed(4)} XMR</strong>
           </div>

           <button
              type="submit"
              disabled={productInfo.vendor.isVacationMode}
              className={(productInfo.isAutoshop || productInfo.productType === "DIGITAL") ? "success" : ""}
              style={{ width: '100%', padding: '12px', marginTop: '10px', fontSize: '14px', fontWeight: 'bold', opacity: productInfo.vendor.isVacationMode ? 0.5 : 1, cursor: productInfo.vendor.isVacationMode ? 'not-allowed' : 'pointer' }}
            >
              {productInfo.vendor.isVacationMode ? "TEMPORARILY UNAVAILABLE" : ((productInfo.isAutoshop || productInfo.productType === "DIGITAL") ? "BUY & DISPATCH INSTANTLY" : "PURCHASE & LOCK ESCROW")}
           </button>
        </form>
      </div>

    </div>
    {promotedRecommendations.length > 0 && (
      <div className="box" style={{ marginTop: '24px', borderColor: '#3a2b00', backgroundColor: '#080704', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2b2208', paddingBottom: '10px', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, color: '#ffce54', fontSize: '13px' }}>Related Sponsored Picks</h3>
          <span style={{ color: '#7a6a2a', fontSize: '10px', textTransform: 'uppercase' }}>rotated fairly by seller</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
          {promotedRecommendations.map(item => (
            <a
              key={item.id}
              href={`/market/product/${item.id}`}
              style={{
                display: 'block',
                textDecoration: 'none',
                border: item.sponsored ? '1px solid #f26822' : '1px solid #222',
                boxShadow: item.sponsored ? '0 0 8px rgba(242,104,34,0.14)' : 'none',
                backgroundColor: '#050505',
                padding: '8px',
                minHeight: '112px',
              }}
            >
              <div style={{ width: '100%', aspectRatio: '4 / 3', backgroundColor: '#111', border: '1px solid #222', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ color: '#444', fontSize: '10px', textAlign: 'center' }}>[ NO IMAGE ]</span>
                )}
              </div>
              <strong style={{ display: 'block', color: '#f26822', fontSize: '12px', lineHeight: 1.3 }}>{item.title}</strong>
              <span style={{ display: 'block', color: '#888', fontSize: '10px', marginTop: '6px' }}>
                {item.subcategory} by {item.vendor.username}
              </span>
              <span style={{ display: 'block', color: '#fff', fontSize: '11px', fontWeight: 'bold', marginTop: '6px' }}>
                {item.priceXMR.toFixed(4)} XMR
              </span>
            </a>
          ))}
        </div>
      </div>
    )}
    </>
  );
}
