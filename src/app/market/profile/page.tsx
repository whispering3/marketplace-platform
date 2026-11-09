import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { revokeOtherSessionsAction, updateProfileAction } from "@/app/actions/profile";
import { getVendorVacationBlockers } from "@/lib/vendor-vacation";

export default async function Profile({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; openOrders?: string; openDisputes?: string }>;
}) {
  const session = await verifyAuth();
  const res = await searchParams;
  const user = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: {
      username: true,
      role: true,
      trustScore: true,
      joinDate: true,
      pgpPublicKey: true,
      antiPhishingPhrase: true,
      hasPaidBond: true,
      walletBalanceXMR: true,
      isVacationMode: true,
      affiliateCode: true,
      orders: { select: { id: true }, where: { buyerId: session.userId as string } },
    },
  });

  if (!user) return <div>Error loading profile.</div>;
  const vacationBlockers = user.role === "VENDOR" || user.role === "ADMIN"
    ? await getVendorVacationBlockers(session.userId as string)
    : { openOrders: 0, openDisputes: 0, total: 0 };
  const vacationActivationBlocked = !user.isVacationMode && vacationBlockers.total > 0;
  const activeSessions = await prisma.authSession.findMany({
    where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
  const errorMessage = res.error === "VacationBlocked"
    ? `Vacation mode cannot be activated while you have ${res.openOrders || vacationBlockers.openOrders} open order(s) and ${res.openDisputes || vacationBlockers.openDisputes} unresolved dispute(s).`
    : res.error === "InvalidPGPEncryptionKey" ? "A valid PGP public key capable of encryption is required. The key cannot be removed while 2FA is mandatory."
      : res.error === "InvalidSessionPIN" ? "The PIN used to revoke other sessions is invalid."
      : res.error;

  return (
    <div className="box">
      <h2>Identity Control Panel</h2>
      <hr />

      {res.error && <div className="danger" style={{ padding: '10px', marginBottom: '15px' }}>ERROR: {errorMessage}</div>}
      {res.success && <div className="success" style={{ padding: '10px', marginBottom: '15px' }}>{res.success === "OtherSessionsRevoked" ? "Other active sessions were revoked." : "Identity updated."}</div>}

      {/* Anti-Phishing Phrase — Always visible at top */}
      <div style={{
        padding: "20px",
        backgroundColor: "#0a0500",
        border: "2px solid #f26822",
        marginBottom: "25px",
      }}>
        <div style={{ fontSize: "11px", color: "#666", marginBottom: "8px", letterSpacing: "2px" }}>
          🔐 YOUR ANTI-PHISHING SECURITY PHRASE
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "20px", color: "#f26822", letterSpacing: "3px", marginBottom: "8px" }}>
          {user.antiPhishingPhrase || "NOT SET — contact support"}
        </div>
        <small style={{ color: "#555", fontSize: "10px" }}>
          This phrase will appear on your login screen every time. If it is missing or different, you are on a phishing site. Close immediately.
        </small>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        {/* Left: Settings */}
        <div className="box" style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
          <h3>Security & Infrastructure</h3>

          <form action={updateProfileAction}>
            <label>PGP Public Key:</label>
            <textarea
              name="user_pgp"
              rows={6}
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----..."
              defaultValue={user.pgpPublicKey || ""}
              style={{ width: "100%", fontSize: "10px" }}
            />

            {(user.role === "VENDOR" || user.role === "ADMIN") && (
              <div style={{ marginTop: '15px' }}>
                <label>Storefront Terms (ToS):</label>
                <textarea
                  name="vendor_terms"
                  rows={4}
                  placeholder="Terms for your customers..."
                  defaultValue={(user as any).vendorTerms || ""}
                  style={{ width: "100%", fontSize: "12px", border: '1px solid #444', backgroundColor: '#000', color: '#ccc' }}
                />

                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                   <input type="checkbox" name="vacation_mode" defaultChecked={user.isVacationMode} disabled={vacationActivationBlocked} id="vacation_chk" />
                   <label htmlFor="vacation_chk">🌴 Active Vacation Mode (Hide all listings)</label>
                </div>
                {vacationActivationBlocked && (
                  <small style={{ display: 'block', marginTop: '6px', color: '#ffb300' }}>
                    Resolve {vacationBlockers.openOrders} open order(s) and {vacationBlockers.openDisputes} dispute(s) before activating vacation mode.
                  </small>
                )}
              </div>
            )}

            <br />
            <div style={{ marginTop: '10px', borderTop: '1px solid #333', paddingTop: '10px' }}>
              <label>Confirm with your main 6-digit PIN:</label>
              <br />
              <input type="password" name="pin" maxLength={6} required style={{ marginBottom: "10px", width: '100px' }} />
            </div>

            <button type="submit" style={{ width: '100%', fontWeight: 'bold' }}>COMMIT SECURITY BLOCK</button>
          </form>
        </div>

        {/* Right: Stats & Affiliate */}
        <div style={{ width: "320px", display: 'flex', flexDirection: 'column', gap: '20px' }}>
           <div className="box" style={{ backgroundColor: "#050505" }}>
              <h3 style={{ marginTop: 0 }}>Account Statistics</h3>
              <table border={1} style={{ width: "100%", fontSize: "12px" }}>
                <tbody>
                  <tr><td>Username:</td><td style={{ color: "#f26822" }}>{user.username}</td></tr>
                  <tr><td>Role:</td><td><span className={user.role === "VENDOR" ? "success" : ""}>{user.role}</span></td></tr>
                  <tr><td>Trust Score:</td><td><span className="success">{user.trustScore}</span></td></tr>
                  <tr><td>Member Since:</td><td>{user.joinDate.toLocaleDateString()}</td></tr>
                  <tr><td>Balance:</td><td>{user.walletBalanceXMR.toFixed(5)} XMR</td></tr>
                </tbody>
              </table>
           </div>

           <div className="box" style={{ backgroundColor: "#001a0d", border: '1px solid #004d26' }}>
              <h3 style={{ marginTop: 0, color: '#00e676' }}>💸 Referral Program</h3>
              <p style={{ fontSize: '11px', color: '#888' }}>Earn 10% of all market fees generated by users you refer. Payments are added to your balance instantly upon order completion.</p>
              <div style={{ padding: '8px', backgroundColor: '#000', border: '1px dashed #00e676', textAlign: 'center' }}>
                 <code style={{ fontSize: '12px', color: '#00e676' }}>{user.affiliateCode}</code>
              </div>
              <p style={{ fontSize: '10px', color: '#666', marginTop: '5px' }}>Share this code with new recruits during registration.</p>
           </div>

           <div className="box" style={{ backgroundColor: "#080808", border: "1px solid #333" }}>
             <h3 style={{ marginTop: 0 }}>Active Sessions</h3>
             <p style={{ fontSize: "11px", color: "#888" }}>
               {activeSessions.length} active session(s). The current session is marked below; no IP address or device fingerprint is stored.
             </p>
             <div style={{ display: "grid", gap: "6px", fontSize: "10px", color: "#aaa" }}>
               {activeSessions.map((active) => (
                 <div key={active.id} style={{ border: "1px solid #222", padding: "7px" }}>
                   <strong style={{ color: active.id === session.sessionId ? "#4caf50" : "#ddd" }}>
                     {active.id === session.sessionId ? "CURRENT SESSION" : "OTHER SESSION"}
                   </strong>
                   <div>Created: {active.createdAt.toLocaleString()}</div>
                   <div>Last activity: {active.lastSeenAt.toLocaleString()}</div>
                   <div>Expires: {active.expiresAt.toLocaleString()}</div>
                 </div>
               ))}
             </div>
             {activeSessions.some((active) => active.id !== session.sessionId) && (
               <form action={revokeOtherSessionsAction} style={{ marginTop: "10px" }}>
                 <label htmlFor="session-revoke-pin">PIN confirmation:</label>
                 <input id="session-revoke-pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required style={{ width: "100%", margin: "5px 0 8px" }} />
                 <button type="submit" className="danger" style={{ width: "100%" }}>REVOKE OTHER SESSIONS</button>
               </form>
             )}
           </div>

           <form action={logoutAction}>
             <button type="submit" className="danger" style={{ width: "100%" }}>
               Logout & Clear Session
             </button>
           </form>
        </div>
      </div>
    </div>
  );
}
