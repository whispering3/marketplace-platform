import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { getMarketCategories } from "@/lib/market-categories";
import { XmrUsdTicker } from "@/components/XmrUsdTicker";
import { logoutAction } from "@/app/actions/auth";

export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifyAuth();
  const categories = await getMarketCategories();
  let currentUser: { username: string; role: string; walletBalanceXMR: Prisma.Decimal; id: string; antiPhishingPhrase?: string | null } | null = null;
  let unreadCount = 0;
  const [productCounts, topVendors] = await Promise.all([
    prisma.product.groupBy({
      by: ["category", "subcategory"],
      where: {
        isPaused: false,
        quantity: { gt: 0 },
      },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ["VENDOR", "ADMIN"] },
        hasPaidBond: true,
        isBanned: false,
      },
      orderBy: [
        { dispatchedOrdersCount: "desc" },
        { trustScore: "desc" },
        { level: "desc" },
        { joinDate: "asc" },
      ],
      take: 5,
      select: {
        username: true,
        trustScore: true,
        level: true,
        dispatchedOrdersCount: true,
        _count: {
          select: {
            products: true,
          },
        },
      },
    }),
  ]);
  const countByCategory = new Map<string, number>();
  const countBySubcategory = new Map<string, number>();

  for (const row of productCounts) {
    const category = row.category || "Other Listings";
    const subcategory = row.subcategory || "Other";
    const count = row._count._all;

    countByCategory.set(category, (countByCategory.get(category) || 0) + count);
    countBySubcategory.set(`${category}::${subcategory}`, count);
  }

  if (session?.userId) {
    const userData = await prisma.user.findUnique({
      where: { id: session.userId as string },
      select: { id: true, username: true, role: true, walletBalanceXMR: true, antiPhishingPhrase: true }
    });
    if (userData) {
      currentUser = userData;
      const [unreadMessages, unreadNotifications] = await Promise.all([
        prisma.inboxMessage.count({
          where: { receiverId: userData.id, isRead: false },
        }),
        prisma.notification.count({
          where: {
            userId: userData.id,
            isRead: false,
            type: { not: "MESSAGE" },
          },
        }),
      ]);
      unreadCount = unreadMessages + unreadNotifications;
    }
  }

  const isVendor = currentUser?.role === 'VENDOR';
  const isAdmin = currentUser?.role === 'ADMIN';
  const adminPath = `/${process.env.ADMIN_URL_SECRET || "staff-dev"}`;

  return (
    <div className="market-shell">
      <a href="#market-content" className="skip-link">Skip to content</a>
      <XmrUsdTicker />

      {/* 1. Anti-Phishing Banner */}
      <div className="market-security-banner">
         <div>
            <strong>YOUR SECURITY PHRASE:</strong> <span style={{ fontStyle: 'italic', color: '#ffce54' }}>"{currentUser?.antiPhishingPhrase || 'No phrase registered'}"</span>
         </div>
         <div style={{ display: 'flex', gap: '15px' }}>
            <a href="/market/news" style={{ color: '#4caf50', textDecoration: 'none', border: '1px solid #4caf50', padding: '0 5px', fontSize: '10px' }}>[ ANNOUNCEMENTS ]</a>
            <a href="/market/mirrors" style={{ color: '#f26822', textDecoration: 'none', border: '1px solid #f26822', padding: '0 5px', fontSize: '10px' }}>[ OFFICIAL ADDRESSES ]</a>
            <span>Verify your phrase before entering your PIN.</span>
         </div>
      </div>

      {/* 2. Main Header */}
      <header className="market-header">
         <div className="market-brand">
            <h1 style={{ margin: 0, textShadow: '2px 2px 0 #000', whiteSpace: 'nowrap' }}><a href="/market" style={{ color: 'white', textDecoration: 'none', fontSize: '28px', letterSpacing: '2px' }}>OLYM<span style={{ color: '#f26822' }}>PUS</span></a></h1>
            <small style={{ color: '#666', whiteSpace: 'nowrap' }}>Buy and sell with escrow</small>
         </div>

         <div className="market-search">
            <form action="/market" method="GET" style={{ margin: 0, display: 'flex', width: '100%', gap: '5px' }}>
               <input type="text" name="q" placeholder="Search listings or vendors..." style={{ width: '100%', padding: '6px 10px', backgroundColor: '#000', border: '1px solid #444', color: '#fff', boxSizing: 'border-box' }} />
               <button type="submit" style={{ padding: '6px 15px', color: '#000', fontWeight: 'bold' }}>SEARCH</button>
            </form>
         </div>

         <div className="market-account">
            <div className="market-account-links">
               <a href="/market/inbox" style={{ textDecoration: 'none', position: 'relative' }}>
                  ✉️ <strong>Messages</strong>
                  {unreadCount > 0 && (
                    <span style={{ position: 'absolute', top: '-8px', right: '-12px', backgroundColor: '#f44336', color: 'white', borderRadius: '50%', padding: '2px 5px', fontSize: '9px', fontWeight: 'bold', boxShadow: '0 0 5px #f44336' }}>{unreadCount}</span>
                  )}
               </a>
               {isVendor ? (
                 <a href="/market/dashboard/vendor" style={{ textDecoration: 'none', color: '#f26822', fontWeight: 'bold' }}>📊 Vendor dashboard</a>
               ) : (
                 <a href="/market/dashboard/buyer" style={{ textDecoration: 'none' }}>🛒 Orders</a>
               )}
               <a href="/market/profile" style={{ textDecoration: 'none' }}>⚙️ Profile</a>
            </div>
            <div className="market-wallet-row">
                <a href="/market/wallet" style={{ color: '#4caf50', fontWeight: 'bold', marginRight: '15px', padding: '2px 8px', backgroundColor: '#0d1a0d', border: '1px solid #1a331a', textDecoration: 'none' }}>
                   ℳ {currentUser ? (currentUser.walletBalanceXMR || 0).toFixed(5) : '0.00000'} XMR
                </a>
               <form action={logoutAction} style={{ margin: 0 }}><button type="submit" className="danger" style={{ padding: '0 5px' }}>SIGN OUT</button></form>
            </div>
         </div>
      </header>

      <div className="market-layout-grid">
            <aside className="market-sidebar">
               <div style={{ padding: '15px', borderBottom: '1px solid #222', backgroundColor: '#080808' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ccc', marginBottom: '5px' }}>👤 {currentUser?.username || 'GUEST'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right', minWidth: '120px' }}>
                    <div style={{ fontSize: '18px', color: '#fff', fontWeight: 'bold' }}>{(currentUser?.walletBalanceXMR ?? 0).toFixed(4)} XMR</div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>Role: <span className="warning">{currentUser?.role || 'N/A'}</span></div>
               </div>

                {isVendor && (
                  <ul style={{ listStyleType: 'none', padding: 0, margin: '15px 0', fontSize: '13px' }}>
                      <li><a href="/market/dashboard/vendor?tab=overview" style={{ display: 'block', padding: '10px 15px', textDecoration: 'none', color: '#bbb' }}>📦 My orders</a></li>
                      <li><a href="/market/dashboard/vendor?tab=products" style={{ display: 'block', padding: '10px 15px', textDecoration: 'none', color: '#bbb' }}>🔧 My listings</a></li>
                  </ul>
                )}
                <nav aria-label="Market categories" style={{ margin: '15px 0', fontSize: '13px' }}>
                  <div style={{ padding: '0 15px 8px', color: '#666', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #1a1a1a' }}>
                    Categories
                  </div>
                  <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                    {categories.map(cat => {
                      const categoryCount = countByCategory.get(cat.label) || 0;

                      return (
                        <li key={cat.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                          <details>
                            <summary style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '8px',
                              padding: '9px 15px',
                              cursor: 'pointer',
                              color: '#bbb',
                              listStyle: 'none',
                            }}>
                              <span style={{ minWidth: 0 }}>
                                <span aria-hidden="true">{cat.icon}</span>{" "}
                                <span>{cat.label}</span>
                              </span>
                              <span style={{
                                minWidth: '26px',
                                padding: '1px 6px',
                                border: '1px solid #333',
                                backgroundColor: categoryCount > 0 ? '#111a11' : '#090909',
                                color: categoryCount > 0 ? '#4caf50' : '#555',
                                textAlign: 'center',
                                fontSize: '10px',
                                fontWeight: 'bold',
                              }}>
                              {categoryCount}
                              </span>
                            </summary>
                            <ul style={{ listStyleType: 'none', padding: '0 0 8px', margin: 0, backgroundColor: '#080808' }}>
                              <li>
                                <a
                                  href={`/market?category=${encodeURIComponent(cat.label)}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    padding: '7px 15px 7px 34px',
                                    color: '#f26822',
                                    textDecoration: 'none',
                                    fontSize: '12px',
                                    borderBottom: '1px solid #111',
                                  }}
                                >
                                  <span>All in {cat.label}</span>
                                  <span style={{ minWidth: '22px', textAlign: 'right', fontSize: '10px', fontWeight: 'bold' }}>{categoryCount}</span>
                                </a>
                              </li>
                              {cat.subcategories.map(subcategory => {
                                const count = countBySubcategory.get(`${cat.label}::${subcategory}`) || 0;

                                return (
                                  <li key={subcategory}>
                                    <a
                                      href={`/market?category=${encodeURIComponent(cat.label)}&subcategory=${encodeURIComponent(subcategory)}`}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '8px',
                                        padding: '6px 15px 6px 34px',
                                        color: count > 0 ? '#aaa' : '#555',
                                        textDecoration: 'none',
                                        fontSize: '12px',
                                      }}
                                    >
                                      <span>{subcategory}</span>
                                      <span style={{
                                        minWidth: '22px',
                                        color: count > 0 ? '#f26822' : '#444',
                                        textAlign: 'right',
                                        fontSize: '10px',
                                        fontWeight: 'bold',
                                      }}>
                                        {count}
                                      </span>
                                    </a>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <section className="vendor-ranking" aria-label="Top vendors">
                  <div className="vendor-ranking-title">Top Vendors</div>
                  {topVendors.length === 0 ? (
                    <p>No ranked vendors yet.</p>
                  ) : (
                    <ol>
                      {topVendors.map((vendor, index) => (
                        <li key={vendor.username}>
                          <a href={`/market/vendor/${encodeURIComponent(vendor.username)}`}>
                            <span>{index + 1}</span>
                            <strong>{vendor.username}</strong>
                            <small>
                              L{vendor.level} / {vendor.dispatchedOrdersCount} sales / trust {vendor.trustScore}
                            </small>
                            <em>{vendor._count.products} listings</em>
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
            </aside>

            <main className="market-content">
               <div id="market-content" tabIndex={-1}>{children}</div>
            </main>
      </div>

      <footer style={{ textAlign: "center", color: "#444", fontSize: "11px", padding: '30px 20px', borderTop: '1px solid #111', backgroundColor: '#050505', marginTop: '30px' }}>
         <div className="market-footer-links" style={{ marginBottom: '15px' }}>
            <a href="/market" style={{ color: '#888', textDecoration: 'none' }}>Home</a>
            <a href="/market/rules" style={{ color: '#888', textDecoration: 'none' }}>General Rules</a>
            <a href="/market/mirrors#security" style={{ color: '#888', textDecoration: 'none' }}>Security Protocol</a>
            <a href="/market/support" style={{ color: '#888', textDecoration: 'none' }}>Support</a>
            {isVendor || isAdmin ? (
              <a href="/market/dashboard/vendor" style={{ color: '#cbb360', textDecoration: 'none', fontWeight: 'bold' }}>Vendor Dashboard</a>
            ) : (
              <a href="/market/vendor/bond" style={{ color: '#cbb360', textDecoration: 'none', fontWeight: 'bold' }}>Become a Vendor</a>
            )}
            {session.role === "STAFF" && <a href="/moderator">Moderator workspace</a>}
            {isAdmin && <a href={adminPath} style={{ color: '#f44336', textDecoration: 'none', fontWeight: 'bold' }}>Staff Vault</a>}
         </div>
         <strong>Olympus Wallet Escrow :: PGP Strict Version</strong><br/><br/>
         <div className="market-footer-meta" style={{ color: '#555' }}>
            <span>Primary Tor address: <code style={{ color: '#888' }}>{process.env.ONION_URL || 'olympus...onion'}</code></span>
         </div>
         <p style={{ marginTop: '20px', color: '#222', fontSize: '10px' }}>&copy; 2026 Olympus // No Logs // No Mercy</p>
      </footer>
    </div>
  );
}
