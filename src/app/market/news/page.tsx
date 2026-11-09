import { prisma } from "@/lib/db";

export default async function SovereignNewsPage() {
  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="box" style={{ borderColor: '#f26822' }}>
      <div style={{ borderBottom: '2px solid #f26822', paddingBottom: '10px', marginBottom: '30px' }}>
         <h1 style={{ margin: 0, color: '#f26822', fontSize: '28px', letterSpacing: '2px' }}>SOVEREIGN TRANSMISSIONS</h1>
         <p style={{ color: '#666', fontSize: '13px', marginTop: '5px' }}>Official verified announcements from the Olympus High Command.</p>
      </div>

      {announcements.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#444' }}>
           [ NO ACTIVE TRANSMISSIONS ]
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
           {announcements.map(news => (
              <div key={news.id} style={{ backgroundColor: '#050505', border: '1px solid #222', padding: '20px', borderRadius: '4px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #111', paddingBottom: '10px', marginBottom: '15px' }}>
                    <h2 style={{ margin: 0, color: '#eee', fontSize: '20px' }}>{news.title}</h2>
                    <span style={{ color: '#666', fontSize: '12px' }}>{news.createdAt.toLocaleString('en-GB')}</span>
                 </div>
                 {news.expiresAt && (
                    <div style={{ color: '#888', fontSize: '11px', marginBottom: '12px' }}>
                       Expires: {news.expiresAt.toLocaleString('en-GB')}
                    </div>
                 )}

                 <div style={{ whiteSpace: 'pre-wrap', color: '#ccc', lineHeight: '1.6', marginBottom: '20px' }}>
                    {news.content}
                 </div>

                 <div style={{ marginTop: '20px' }}>
                    <div style={{ fontSize: '10px', color: '#f26822', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '5px' }}>
                       Verified Cryptographic Signature:
                    </div>
                    <textarea
                       readOnly
                       rows={6}
                       defaultValue={news.signature || "-----BEGIN PGP SIGNATURE-----\n[ NO SIGNATURE PROVIDED ]\n-----END PGP SIGNATURE-----"}
                       style={{ width: '100%', backgroundColor: '#000', border: '1px solid #444', color: '#4caf50', fontSize: '10px', fontFamily: 'monospace' }}
                    />
                 </div>
              </div>
           ))}
        </div>
      )}

      <div style={{ marginTop: '50px', padding: '20px', backgroundColor: '#0a0d0a', border: '1px solid #1a331a', fontSize: '11px', color: '#4caf50' }}>
         <strong>SECURITY PROTOCOL:</strong> Every announcement above is accompanied by a PGP signature. You are strongly advised to verify these signatures against the Market Master Public Key (available in /mirrors) to ensure authenticity.
      </div>
    </div>
  );
}
