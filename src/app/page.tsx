import { getShieldSession, isShieldVerified } from "@/lib/captcha-sentinel";
import { redirect } from "next/navigation";
import CaptchaDisplay from "@/components/CaptchaDisplay";

export const dynamic = "force-dynamic";

export default async function Gateway({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isShieldVerified()) {
    redirect("/auth/login");
  }

  const session = await getShieldSession();
  const { error } = await searchParams;

  if (!session) {
    return (
      <div className="box" style={{ maxWidth: '450px', margin: '60px auto', textAlign: 'center' }}>
        <h2 style={{ color: '#f26822' }}>SECURE ACCESS GATE</h2>
        <p style={{ fontSize: '12px', color: '#666' }}>Start a private verification session before entering the marketplace.</p>
        <form action="/api/sentinel/start" method="post">
          <button type="submit" style={{ marginTop: '20px', padding: '12px 20px', fontWeight: 'bold' }}>
            START VERIFICATION
          </button>
        </form>
      </div>
    );
  }

  const sessionTimestamp = session.iat ? session.iat * 1000 : 0;
  const isBlocked = !!session.blockedUntil;

  return (
    <div style={{ backgroundColor: '#050505', minHeight: '100vh', padding: '40px 20px', color: '#ccc', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', border: '1px solid #222', backgroundColor: '#0f0f0f', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>

        {/* Header - Silk Road inspired branding */}
        <div style={{ padding: '20px', borderBottom: '1px solid #222', textAlign: 'center', backgroundColor: '#151515' }}>
          <h2 style={{ color: isBlocked ? '#f44336' : '#f26822', margin: 0, letterSpacing: '4px', fontSize: '24px', fontWeight: 'bold' }}>
            OLYMPUS MARKET
          </h2>
          <div style={{ fontSize: '9px', color: '#555', marginTop: '5px', fontWeight: 'bold' }}>
            WHAT USE IS AN UNLOADED WEAPON?
          </div>
        </div>

        <div style={{ padding: '30px' }}>
          {isBlocked ? (
            <div style={{ border: '1px solid #f4433622', padding: '20px', textAlign: 'center', backgroundColor: '#1a0000' }}>
               <h3 style={{ color: '#f44336', margin: '0 0 10px 0' }}>ACCESS RESTRICTED</h3>
               <p style={{ fontSize: '11px', color: '#888', lineHeight: '1.5' }}>
                 Your connection has been flagged for abnormal behavior (Multiple failed proof-of-work attempts).
               </p>
               <div style={{ color: '#f26822', fontWeight: 'bold', margin: '20px 0', fontSize: '13px' }}>
                 COOLDOWN IN PROGRESS
               </div>
               <form action="/">
                  <button type="submit" style={{ backgroundColor: '#222', color: '#888', border: '1px solid #333', padding: '8px 16px', cursor: 'pointer', fontSize: '11px' }}>
                    REFRESH GATEWAY STATUS
                  </button>
               </form>
            </div>
          ) : (
            <>
              {/* OpSec Banner */}
              <div style={{ marginBottom: '25px', padding: '10px', borderLeft: '2px solid #f26822', backgroundColor: '#181818', fontSize: '11px' }}>
                <span style={{ color: '#f26822' }}>[SENTINEL]</span> Solve the cryptographic puzzle below to establish a secure handshake with the marketplace.
              </div>

              <div style={{ marginBottom: '25px' }}>
                <CaptchaDisplay text={session.captcha} />
              </div>

              <form action="/api/sentinel/verify" method="post">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                   <div>
                      <label htmlFor="captcha" style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                        Verification Code:
                      </label>
                      <input
                        type="text"
                        id="captcha"
                        name="captcha"
                        required
                        autoFocus
                        autoComplete="off"
                        placeholder="[ ENTER CODE ]"
                        style={{
                          width: '100%',
                          padding: '15px',
                          backgroundColor: '#050505',
                          border: '1px solid #333',
                          color: '#f26822',
                          textAlign: 'center',
                          fontSize: '20px',
                          letterSpacing: '6px',
                          outline: 'none',
                          boxShadow: 'inset 0 0 10px #000'
                        }}
                      />
                   </div>

                   {error && (
                     <div style={{ fontSize: '11px', padding: '12px', border: '1px solid #f4433644', backgroundColor: '#1a0000', color: '#f44336', textAlign: 'center' }}>
                       {error}
                     </div>
                   )}

                     <button type="submit" style={{
                       width: '100%',
                       padding: '15px',
                       fontWeight: 'bold',
                       backgroundColor: '#f26822',
                       color: '#000',
                       border: 'none',
                       cursor: 'pointer',
                       letterSpacing: '2px',
                       textTransform: 'uppercase',
                       fontSize: '13px'
                     }}>
                       START ENCRYPTED SESSION
                     </button>

                  </div>
                </form>
                <form action="/api/sentinel/start" method="post" style={{ marginTop: '20px', textAlign: 'center' }}>
                  <button
                    type="submit"
                    style={{
                      padding: 0,
                      background: 'transparent',
                      border: 0,
                      color: '#666',
                      fontSize: '10px',
                      textDecoration: 'underline',
                      textTransform: 'uppercase',
                      cursor: 'pointer'
                    }}
                  >
                    [ CANNOT READ? GENERATE NEW CODE ]
                  </button>
                </form>
              </>
            )}

          {/* Infrastructure Footer */}
          <div style={{ marginTop: '30px', borderTop: '1px solid #222', paddingTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px', color: '#444' }}>
             <div>NODE_SIG: {session.captcha.slice(0, 3)}..{String(sessionTimestamp).slice(-4)}</div>
             <div>UPTIME: 99.98%</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '30px', fontSize: '10px', color: '#333' }}>
         &copy; OLYMPUS | {new Date().getFullYear()}
      </div>
    </div>
  );
}
