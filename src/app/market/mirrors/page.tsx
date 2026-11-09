import { getOfficialMirrors, mirrorHref, verifyCurrentDomain } from "@/lib/mirrors";

export const dynamic = 'force-dynamic';

export default async function MirrorVerification() {
  const onionUrl = process.env.ONION_URL || "olympusv2.onion";
  const masterKey = process.env.MASTER_PGP_KEY || "--- NO MASTER KEY CONFIGURED ---";

  const { host, status: currentHostStatus } = await verifyCurrentDomain();

  const publicMirrors = await getOfficialMirrors();

  // Simulation of a PGP Signed Message from the Market Admin
  const mirrorListText = publicMirrors.length > 0
    ? publicMirrors.map((m: any) => `${m.isPrimary ? '[PRIMARY] ' : ''}${m.url}`).join('\n')
    : `MAIN ONION: ${onionUrl}`;

  const signedMessage = `-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

[ OLYMPUS MIRROR AUTHENTICITY BLOCK ]
Date: ${new Date().toLocaleDateString()}
Status: OPERATIONAL

The following domains are currently the ONLY official gateways to the Olympus Economy.
If you are visiting a URL NOT on this list, your credentials and XMR are at risk.

${mirrorListText}

Signed,
OLYMPUS_CORE_ADMIN
-----BEGIN PGP SIGNATURE-----
[ BINARY_SIGNATURE_DATA_REDACTED ]
-----END PGP SIGNATURE-----`;

  return (
    <div className="box" style={{ maxWidth: '800px', margin: '40px auto' }}>
      <h2 style={{ textAlign: 'center', color: '#f26822' }}>🛡️ Mirror Verification & Master Protocol</h2>
      <hr/>

      <p style={{ fontSize: '14px', color: '#ccc', textAlign: 'center' }}>
        Operational Security (OpSec) requires that you verify your location on every visit.
        Phishing is the primary cause of lost accounts.
      </p>

      <div style={{ marginTop: '20px', padding: '12px', border: '1px solid #333', backgroundColor: '#080808', fontSize: '12px' }}>
        <strong style={{ color: currentHostStatus === 'UNAUTHORIZED' ? '#ff6b6b' : '#4caf50' }}>CURRENT HOST STATUS:</strong>{" "}
        <code>{currentHostStatus}</code>
      </div>

      <div id="security" style={{ marginTop: '30px', scrollMarginTop: '24px' }}>
         <h3 style={{ color: '#4caf50', fontSize: '14px' }}>✓ CURRENT OFFICIAL MIRROR LIST</h3>
         <div style={{
            backgroundColor: '#0a0a0a',
            padding: '15px',
            border: '1px solid #1a331a',
            fontFamily: 'monospace',
            color: '#4caf50',
            wordBreak: 'break-all'
         }}>
            {publicMirrors.length === 0 ? (
               <>
                  <a href={mirrorHref(onionUrl)} style={{ color: '#4caf50', textDecoration: 'underline' }}>{onionUrl}</a><br/>
               </>
            ) : (
               publicMirrors.map((m: any) => (
                  <div key={m.id} style={{ marginBottom: '5px' }}>
                      {m.isPrimary && <span style={{ color: '#fff', fontSize: '10px', backgroundColor: '#333', padding: '2px 5px', marginRight: '5px', borderRadius: '2px' }}>PRIMARY</span>}
                      {m.url === host && <span style={{ color: '#000', fontSize: '10px', backgroundColor: '#4caf50', padding: '2px 5px', marginRight: '5px', borderRadius: '2px', fontWeight: 'bold' }}>YOU ARE HERE</span>}
                      <a
                        href={mirrorHref(m.url)}
                        style={{
                          color: m.url === host ? '#fff' : '#4caf50',
                          textDecoration: 'underline',
                          textUnderlineOffset: '3px',
                        }}
                      >
                        {m.url}
                      </a>
                  </div>
               ))
            )}
         </div>
      </div>

      <div style={{ marginTop: '30px' }}>
         <h3 style={{ fontSize: '14px' }}>🔒 PGP SIGNED PROOF</h3>
         <p style={{ fontSize: '11px', color: '#666' }}>Paste the block below into your GPG/Kleopatra to verify it was signed by the Olympus Master Key.</p>
         <textarea
            readOnly
            rows={20}
            style={{
               width: '100%',
               backgroundColor: '#000',
               color: '#aaa',
               fontSize: '10px',
               fontFamily: 'monospace',
               border: '1px solid #333'
            }}
            defaultValue={signedMessage}
         />
      </div>

      <div style={{ marginTop: '30px' }}>
         <h3 style={{ fontSize: '14px' }}>🔑 MASTER PUBLIC KEY</h3>
         <p style={{ fontSize: '11px', color: '#666' }}>Always use this key to verify market announcements.</p>
         <textarea
            readOnly
            rows={10}
            style={{
               width: '100%',
               backgroundColor: '#000',
               color: '#555',
               fontSize: '9px',
               fontFamily: 'monospace',
               border: '1px solid #222'
            }}
            defaultValue={masterKey}
         />
      </div>
    </div>
  );
}
