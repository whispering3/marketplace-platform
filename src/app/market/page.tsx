import { getSession } from "@/lib/session";
import { recordBehavior } from "@/lib/events";
import { getRecommendedProducts } from "@/lib/recommendations";
import { searchProducts } from "@/lib/search";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getMarketCategories } from "@/lib/market-categories";

export default async function MarketListing({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; subcategory?: string; type?: string; min?: string; max?: string; sort?: string; page?: string }>
}) {
  const params = await searchParams;
  const { q, category, subcategory, type, min, max, sort } = params;
  const now = new Date();
  const session = await getSession();
  const categories = await getMarketCategories();
  const recommendationsEnabled = await isFeatureEnabled("recommendations", true);

  if (session?.userId && (q || category || subcategory)) {
     await recordBehavior({
       userId: session.userId as string,
       category: subcategory || category,
       action: "SEARCH",
       weight: q ? 1.5 : 1,
     });
  }

  const { products: currentItems, totalPages, safePage } = await searchProducts({
    ...params,
    viewerId: session?.userId as string | undefined,
  });
  const recommendations = recommendationsEnabled
    ? await getRecommendedProducts(session?.userId as string | undefined, 4)
    : [];

  // FILTER PROMOTED LOGIC (Lazy Check)
  // We sort by isPromoted DESC, but we only show the "Promoted" tag and border if it hasn't expired.
  const processedItems = currentItems.map(item => {
     const isValidPromotion = !!(item.isPromoted && item.promotedUntil && item.promotedUntil > now);
     const sponsored = "sponsored" in item && item.sponsored === true;
     return { ...item, displayPromoted: isValidPromotion, sponsored };
  });

  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < totalPages ? safePage + 1 : null;

  return (
    <div className="box" style={{ border: 'none', padding: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>
         <h2 style={{ margin: 0, color: '#ddd', fontSize: '18px' }}>
            {category ? `Exploring Category: ${category}` : 'Global Listings Dashboard'}
         </h2>
         <div style={{ fontSize: '12px', color: '#666' }}>Showing results by Relevance/TrustScore.</div>
      </div>

      <form action="/market" method="GET" className="market-filter-form">
         <div>
            <label style={{ fontSize: '10px', color: '#666' }}>Search</label>
            <input type="text" name="q" defaultValue={q || ""} placeholder="Title, vendor, tags..." />
         </div>
         <div>
            <label style={{ fontSize: '10px', color: '#666' }}>Category</label>
            <select name="category" defaultValue={category || ""} style={{ width: '100%', padding: '7px', backgroundColor: '#0c0c0e', color: '#fff', border: '1px solid #555' }}>
               <option value="">All</option>
               {categories.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
            </select>
         </div>
         <div>
            <label style={{ fontSize: '10px', color: '#666' }}>Type</label>
            <select name="type" defaultValue={type || ""} style={{ width: '100%', padding: '7px', backgroundColor: '#0c0c0e', color: '#fff', border: '1px solid #555' }}>
               <option value="">All</option>
               <option value="PHYSICAL">Physical</option>
               <option value="DIGITAL">Digital</option>
            </select>
         </div>
         <div>
            <label style={{ fontSize: '10px', color: '#666' }}>Min</label>
            <input type="number" name="min" step="0.0001" defaultValue={min || ""} />
         </div>
         <div>
            <label style={{ fontSize: '10px', color: '#666' }}>Sort</label>
            <select name="sort" defaultValue={sort || ""} style={{ width: '100%', padding: '7px', backgroundColor: '#0c0c0e', color: '#fff', border: '1px solid #555' }}>
               <option value="">Recommended</option>
               <option value="new">Newest</option>
               <option value="trust">Seller trust</option>
               <option value="price_asc">Price low</option>
               <option value="price_desc">Price high</option>
            </select>
         </div>
         <button type="submit" style={{ padding: '8px 14px' }}>Filter</button>
      </form>

      {recommendations.length > 0 && (
        <div style={{ marginBottom: '20px', border: '1px solid #222', padding: '12px', backgroundColor: '#080808' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#ccc' }}>Recommended For You</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
            {recommendations.map(item => (
              <a key={item.id} href={`/market/product/${item.id}`} style={{ border: '1px solid #222', padding: '10px', backgroundColor: '#050505', textDecoration: 'none' }}>
                <strong style={{ display: 'block', color: '#f26822', fontSize: '12px' }}>{item.title}</strong>
                <span style={{ color: '#888', fontSize: '10px' }}>{item.category} by {item.vendor.username}</span><br />
                <span style={{ color: '#fff', fontSize: '11px' }}>{item.priceXMR.toFixed(4)} XMR</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {processedItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px' }}>No material found matching this cryptographic query.</div>
      ) : (
        <div className="grid-catalog" style={{ marginTop: '20px' }}>
          {processedItems.map((prod) => (
            <div className="card" key={prod.id} style={prod.displayPromoted ? { border: '1px solid #f26822', boxShadow: '0 0 10px rgba(242,104,34,0.2)' } : {}}>
               <a href={`/market/product/${prod.id}`} className="card-image" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span>[ IMAGE:<br/>{prod.imageUrl} ]</span>
               </a>

               <div className="card-content">
                  <strong style={{ fontSize: '15px' }}>
                     <a href={`/market/product/${prod.id}`} style={{ color: '#f26822', textDecoration: 'none' }}>{prod.title}</a>
                  </strong>
                  <br/>
                  <div style={{ marginTop: '5px', marginBottom: '8px' }}>
                    {prod.isAutoshop && <span className="success" style={{ fontSize: '9px', padding: '2px 5px', border: '1px solid #4caf50', marginRight: '5px' }}>[ DIGITAL AUTOSHOP ]</span>}
                    {prod.requiresFE && <span className="danger" style={{ fontSize: '9px', padding: '2px 5px', border: '1px solid #f44336' }}>[ REQUIRES F.E. ]</span>}
                  </div>

                  <p style={{ margin: '5px 0', fontSize: '12px' }}>{prod.description}</p>

                  <div style={{ fontSize: '12px', marginTop: '10px', color: '#888' }}>
                     Vendor: <a href={`/market/vendor/${prod.vendor.username}`}>{prod.vendor.username}</a><br/>
                     <span className={(prod.vendor?.trustScore || 0) > 90 ? "success" : "warning"} style={{ fontSize: '10px' }}>
                        (SOVEREIGN RANK: LEVEL {(prod.vendor as any)?.level || 1})
                     </span>
                     <br/>
                     🛩️ Ships From/To: <strong style={{ color: '#ccc' }}>{prod.originShipsFrom}</strong>
                  </div>
               </div>

               <div className="card-action">
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                     {(prod.priceXMR || 0).toFixed(4)} XMR
                  </div>
                  <form action={`/market/product/${prod.id}`} method="GET" style={{ margin: 0 }}>
                     <button type="submit">View</button>
                  </form>
               </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ textAlign: 'center', marginTop: '30px', padding: '15px', backgroundColor: '#0a0a09', borderTop: '1px solid #222' }}>
           <strong style={{ marginRight: '15px', fontSize: '12px', color: '#888' }}>Navigation (Page {safePage} of {totalPages}):</strong>

           {prevPage && (
              <a href={`/market?page=${prevPage}${q ? `&q=${q}` : ''}${category ? `&category=${category}` : ''}${subcategory ? `&subcategory=${subcategory}` : ''}${type ? `&type=${type}` : ''}${min ? `&min=${min}` : ''}${max ? `&max=${max}` : ''}${sort ? `&sort=${sort}` : ''}`} style={{ marginRight: '10px', padding: '5px 10px', backgroundColor: '#333', color: '#fff', textDecoration: 'none' }}>
                 [ ⬅ Prev ]
              </a>
           )}

           {Array.from({length: totalPages}, (_, i) => i + 1).map(pageNum => (
              <a key={pageNum} href={`/market?page=${pageNum}${q ? `&q=${q}` : ''}${category ? `&category=${category}` : ''}${subcategory ? `&subcategory=${subcategory}` : ''}${type ? `&type=${type}` : ''}${min ? `&min=${min}` : ''}${max ? `&max=${max}` : ''}${sort ? `&sort=${sort}` : ''}`}
                 style={{ margin: '0 5px', padding: '3px 8px', textDecoration: 'none', backgroundColor: pageNum === safePage ? '#f26822' : 'transparent', color: pageNum === safePage ? '#000' : '#888' }}>
                 {pageNum}
              </a>
           ))}

           {nextPage && (
              <a href={`/market?page=${nextPage}${q ? `&q=${q}` : ''}${category ? `&category=${category}` : ''}${subcategory ? `&subcategory=${subcategory}` : ''}${type ? `&type=${type}` : ''}${min ? `&min=${min}` : ''}${max ? `&max=${max}` : ''}${sort ? `&sort=${sort}` : ''}`} style={{ marginLeft: '10px', padding: '5px 10px', backgroundColor: '#333', color: '#fff', textDecoration: 'none' }}>
                 [ Next ➡ ]
              </a>
           )}
        </div>
      )}

    </div>
  );
}
