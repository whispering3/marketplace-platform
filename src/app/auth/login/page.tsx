import { checkAuthChallenge } from "@/lib/auth-challenges";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { verifyCurrentDomain } from "@/lib/mirrors";
import * as openpgp from "openpgp";
import { getPendingAuthState } from "@/lib/auth-flow-cookie";

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    step?: string;
    next?: string;
    error?: string;
    registered?: string;
    phrase?: string;
    enrolled?: string;
  }>;
}) {
  const p = await searchParams;
  const pending = await getPendingAuthState();
  const isRegistering = p.mode === "register";
  const isUrlVerify = p.step === "verify_url";
  const isPgpVerification = p.step === "2fa";
  const isPgpSetup = p.step === "pgp_setup";
  const isPhraseReveal = p.step === "phrase_reveal";
  const justRegistered = p.registered === "1";

  if (p.step && pending?.step !== p.step) {
    return redirect("/auth/login?error=invalid_or_expired_token");
  }

  // ── SCREEN 1: Post-Registration Confirmation ────────────────────────
  if (justRegistered) {
    return (
      <div className="box" style={{ maxWidth: "500px", margin: "60px auto", borderColor: "#4caf50" }}>
        <h2 style={{ textAlign: "center", color: "#4caf50" }}>✓ REGISTRATION PROTOCOL INITIATED</h2>
        <p style={{ color: "#888", fontSize: "13px", textAlign: "center" }}>
          Your digital imprint has been created. For your security, your **Anti-Phishing Phrase** will be revealed exactly once upon your first login.
        </p>
        <hr />
        <div style={{ padding: "15px", backgroundColor: "#0a1a00", border: "1px solid #1a331a", fontSize: "12px", color: "#4caf50", marginBottom: "20px" }}>
          <strong>IDENTITY SECURED:</strong> Your credentials are now active on the Olympus network.
        </div>
        <a href="/auth/login" style={{ display: "block", width: "100%", padding: "12px", backgroundColor: "#333", color: "#fff", textAlign: "center", fontWeight: "bold", textDecoration: "none" }}>
          PROCEED TO AUTHENTICATION GATE
        </a>
      </div>
    );
  }

  // ── SCREEN 1.5: One-Time Phrase Reveal (Secure Context) ───────────────
  if (isPhraseReveal && pending?.step === "phrase_reveal" && pending.token) {
    if (!await checkAuthChallenge(prisma, pending.userId, pending.token, "PHRASE")) return redirect("/auth/login?error=invalid_or_expired_token");
    const user = await prisma.user.findUnique({
      where: { id: pending.userId },
      select: { antiPhishingPhrase: true, id: true }
    });

    if (!user) return redirect("/auth/login");

    return (
      <div className="box" style={{ maxWidth: "500px", margin: "60px auto", borderColor: "#f26822" }}>
        <h2 style={{ textAlign: "center", color: "#f26822" }}>🛡️ YOUR SOVEREIGN SECURITY PHRASE</h2>
        <p style={{ color: "#ccc", fontSize: "13px", textAlign: "center" }}>
          This is your only guard against phishing. Ensure it appears correctly on every login.
        </p>
        <hr />
        <div style={{
          background: "#0a0a00",
          border: "2px solid #f26822",
          padding: "25px",
          textAlign: "center",
          margin: "20px 0",
        }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "8px", letterSpacing: "2px" }}>ONE-TIME DISCLOSURE</div>
          <strong style={{ fontSize: "24px", color: "#f26822", letterSpacing: "4px", fontFamily: "monospace" }}>
            {user.antiPhishingPhrase}
          </strong>
        </div>
        <div style={{ padding: "12px", backgroundColor: "#1a0000", border: "1px solid #f44336", fontSize: "12px", color: "#ffce54", marginBottom: "20px" }}>
           <strong>⚠ WARNING:</strong> This is the LAST time this phrase will be shown. Write it down immediately.
        </div>
        <form action="/api/auth/phrase-viewed" method="post">
          <button type="submit" style={{ width: "100%", padding: "12px", backgroundColor: "#f26822", color: "#000", fontWeight: "bold" }}>
             I HAVE SECURED MY PHRASE — ENTER OLYMPUS
          </button>
        </form>
      </div>
    );
  }

  // ── SCREEN 1.75: Mandatory first-login PGP enrollment ───────────────
  if (isPgpSetup && pending?.step === "pgp_setup" && pending.token) {
    if (!await checkAuthChallenge(prisma, pending.userId, pending.token, "PGP_ENROLLMENT")) {
      return redirect("/auth/login?error=invalid_or_expired_token");
    }
    const user = await prisma.user.findUnique({ where: { id: pending.userId }, select: { username: true } });
    if (!user) return redirect("/auth/login?error=unauthorized");

    return (
      <div className="box" style={{ maxWidth: "620px", margin: "40px auto", borderColor: "#00bcd4" }}>
        <h2 style={{ textAlign: "center", color: "#00bcd4" }}>MANDATORY PGP 2FA ENROLLMENT</h2>
        <p style={{ color: "#aaa", fontSize: "13px", textAlign: "center" }}>
          {user.username}, register your public encryption key to protect this account. PGP verification is required on this login and every future login.
        </p>
        <div style={{ padding: "12px", margin: "18px 0", border: "1px solid #4a3412", backgroundColor: "#130d03", color: "#ffcc80", fontSize: "12px" }}>
          Keep your private key offline and backed up. Paste only the public key below. Losing the private key will prevent future access.
        </div>
        {p.error && (
          <div className="danger" style={{ padding: "10px", marginBottom: "12px" }}>
            {p.error === "InvalidEncryptionKey" ? "The key must be a valid PGP public key capable of encryption." : "A PGP public key is required."}
          </div>
        )}
        <form action="/api/auth/pgp-setup" method="post">
          <label htmlFor="pgp-enrollment-key" style={{ color: "#d8e8eb", fontWeight: "bold" }}>PGP PUBLIC KEY:</label>
          <textarea
            id="pgp-enrollment-key"
            name="pgp_public_key"
            rows={14}
            maxLength={32768}
            required
            autoComplete="off"
            placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            style={{ width: "100%", margin: "8px 0 16px", fontSize: "10px", color: "#7bdde9" }}
          />
          <button type="submit" style={{ width: "100%", padding: "13px", backgroundColor: "#063d44", borderColor: "#00bcd4", fontWeight: "bold" }}>
            SAVE KEY AND VERIFY 2FA
          </button>
        </form>
      </div>
    );
  }

  // ── SCREEN 2: URL Verification ─────────────────────────────────────────
  if (isUrlVerify && pending?.step === "verify_url" && pending.token) {
    if (!await checkAuthChallenge(prisma, pending.userId, pending.token, "PASSWORD")) return redirect("/auth/login?error=invalid_or_expired_token");
    const user = await prisma.user.findUnique({
      where: { id: pending.userId },
      select: { antiPhishingPhrase: true, username: true },
    });

    const { host, status, primaryUrl } = await verifyCurrentDomain();

    return (
      <div className="box" style={{ maxWidth: "560px", margin: "40px auto", borderColor: status === 'UNAUTHORIZED' ? '#ff0000' : '#f44336' }}>
        <h2 className={status === 'UNAUTHORIZED' ? 'danger' : ''} style={{ textAlign: "center", margin: "0 0 5px 0" }}>
          {status === 'UNAUTHORIZED' ? '🚨 PHISHING ALERT: DOMAIN UNAUTHORIZED' : '🛡 ANTI-PHISHING URL VERIFICATION'}
        </h2>
        <p style={{ textAlign: "center", fontSize: "12px", color: status === 'UNAUTHORIZED' ? '#ff0000' : '#888', marginBottom: "20px" }}>
          {status === 'UNAUTHORIZED'
            ? 'WARNING: You are on an unauthorized domain. Your security phrase is being suppressed to prevent theft. Close this window immediately.'
            : 'Before proceeding, verify the address bar matches exactly. Phishing sites cannot replicate your personal security phrase.'}
        </p>
        <hr />

        {/* Personal Phrase */}
        {user?.antiPhishingPhrase && status !== 'UNAUTHORIZED' && (
          <div style={{ margin: "20px 0" }}>
            <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px", letterSpacing: "2px" }}>YOUR PERSONAL SECURITY PHRASE:</div>
            <div style={{
              background: "#0a0a00",
              border: "2px solid #f26822",
              padding: "18px",
              textAlign: "center",
            }}>
              <strong style={{ fontSize: "20px", color: "#f26822", letterSpacing: "3px", fontFamily: "monospace" }}>
                {user.antiPhishingPhrase}
              </strong>
            </div>
            <small style={{ color: "#555", fontSize: "10px" }}>
              If this phrase does not match what you saved, close this window immediately.
            </small>
          </div>
        )}

        {/* URL to confirm */}
        <div style={{ margin: "20px 0" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px", letterSpacing: "2px" }}>DOMAIN VERIFICATION STATUS:</div>
          <div style={{
            background: "#050505",
            border: `1px solid ${status === 'PRIMARY' ? '#4caf50' : status === 'OFFICIAL_MIRROR' ? '#f26822' : '#ff0000'}`,
            padding: "12px",
            fontFamily: "monospace",
            fontSize: "13px",
            color: status === 'PRIMARY' ? '#4caf50' : status === 'OFFICIAL_MIRROR' ? '#f26822' : '#ff0000',
            wordBreak: "break-all",
          }}>
            {status === 'PRIMARY' && '[🛡️ PRIMARY] '}
            {status === 'OFFICIAL_MIRROR' && '[🛡️ OFFICIAL MIRROR] '}
            {host}
          </div>
          <small style={{ color: "#555", fontSize: "10px" }}>
            {status === 'PRIMARY' && 'You are connected directly to the Sovereign Core.'}
            {status === 'OFFICIAL_MIRROR' && `Confirmed mirror of the official domain: ${primaryUrl}`}
            {status === 'UNAUTHORIZED' && 'DANGER: This onion address is not in our official Sanctum Grid.'}
          </small>
        </div>

        {p.error && (
          <div style={{ color: "#fff", backgroundColor: "#d9534f", padding: "10px", marginBottom: "10px", fontSize: "13px" }}>
            ERROR: {p.error}
          </div>
        )}

        {/* Confirm form */}
        <form action="/api/auth/complete" method="post">
          <input type="hidden" name="url_confirmed" value="yes" />
          <input type="hidden" name="next" value={p.next || "complete"} />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "14px",
              fontWeight: "bold",
              backgroundColor: "#1a4a1a",
              color: "#4caf50",
              border: "1px solid #4caf50",
              fontSize: "13px",
              cursor: "pointer",
              marginBottom: "10px",
            }}
          >
            ✓ URL AND PHRASE VERIFIED — ENTER OLYMPUS
          </button>
        </form>
        <a
          href="/auth/login"
          style={{ display: "block", textAlign: "center", fontSize: "11px", color: "#555", textDecoration: "none", padding: "8px" }}
        >
          ✗ Something looks wrong — abort login
        </a>
      </div>
    );
  }

  // ── SCREEN 3: PGP 2FA Verification ────────────────────────────────────
  if (isPgpVerification) {
    let pgpMessage = "Challenge unavailable. Restart login.";
    if (pending?.step === "2fa" && pending.challengeId) {
      const dbChallenge = await prisma.pgpChallenge.findUnique({ where: { id: pending.challengeId } });
      const challengeUser = dbChallenge
        ? await prisma.user.findUnique({
            where: { id: dbChallenge.userId },
            select: { pgpPublicKey: true },
          })
        : null;
      if (dbChallenge && dbChallenge.userId === pending.userId && !dbChallenge.used && dbChallenge.expiresAt > new Date() && challengeUser?.pgpPublicKey) {
        try {
          if (dbChallenge.encryptedMessage) {
            pgpMessage = dbChallenge.encryptedMessage;
          } else if (dbChallenge.token) {
            const publicKey = await openpgp.readKey({ armoredKey: challengeUser.pgpPublicKey });
            pgpMessage = await openpgp.encrypt({
              message: await openpgp.createMessage({ text: `Login verification token: ${dbChallenge.token}` }),
              encryptionKeys: publicKey,
            });
          }
        } catch {
          pgpMessage = "Unable to prepare encrypted challenge. Restart login or update your PGP key.";
        }
      }
    }

    return (
      <div className="box" style={{ maxWidth: "600px", margin: "40px auto", borderColor: "#f44336" }}>
        <h2 className="danger" style={{ textAlign: "center", margin: "0 0 10px 0" }}>MANDATORY PGP IDENTITY VERIFICATION</h2>
        {p.enrolled === "1" && <div className="success" style={{ padding: "10px", marginBottom: "12px", textAlign: "center" }}>Public key saved. Decrypt this challenge to finish enrollment.</div>}
        <p style={{ textAlign: "center", fontSize: "13px", color: "#ccc" }}>
          Anti-Hijack protection is active. Decrypt the challenge below using your PGP Private Key and enter the revealed token.
        </p>
        <hr />

        {p.error && (
          <div style={{ color: "#fff", backgroundColor: "#d9534f", padding: "10px", marginBottom: "10px", fontSize: "13px" }}>
            ERROR: {p.error}
          </div>
        )}

        <label style={{ fontSize: "12px", color: "#888" }}>Encrypted Challenge (Generated by Server):</label>
        <textarea
          readOnly
          rows={10}
          style={{ width: "100%", fontSize: "10px", color: "#5f9ea0", backgroundColor: "#050505", border: "1px solid #333", padding: "10px" }}
          value={pgpMessage}
        />

        <form action="/api/auth/pgp" method="post" style={{ marginTop: "20px" }}>
          <label style={{ color: "#f26822", fontWeight: "bold" }}>Enter the token revealed after decryption:</label>
          <br />
          <input
            type="text"
            name="pgp_token"
            required
            placeholder="Decrypted token..."
            style={{ width: "100%", padding: "10px", fontSize: "14px", marginBottom: "15px" }}
          />
          <button type="submit" className="danger" style={{ width: "100%", padding: "12px", fontWeight: "bold" }}>
            AUTHENTICATE IDENTITY AND ENTER OLYMPUS
          </button>
        </form>
      </div>
    );
  }

  // ── SCREEN 4: Main Login / Registration Form ───────────────────────────
  return (
    <div className="box" style={{ maxWidth: "400px", margin: "60px auto" }}>
      <h2 style={{ textAlign: "center" }}>
        {isRegistering ? "Identity Registration" : "Restricted Access: OLYMPUS"}
      </h2>
      <hr />

      {p.error && (
        <div style={{ color: "#fff", backgroundColor: "#d9534f", padding: "10px", marginBottom: "10px", fontSize: "13px" }}>
          ERROR: {p.error}
        </div>
      )}

      <form action={isRegistering ? "/api/auth/register" : "/api/auth/login"} method="post" style={{ marginTop: "15px" }}>
        <label>Username (Alias):</label>
        <br />
        <input type="text" name="username" required autoComplete="off" style={{ width: "100%", marginBottom: "15px" }} />

        <label>Password:</label>
        <br />
        <input type="password" name="password" required autoComplete="off" style={{ width: "100%", marginBottom: "20px" }} />

        {isRegistering && (
          <>
            <div style={{ padding: "15px", backgroundColor: "#111", border: "1px solid #333", marginBottom: "15px" }}>
              <label style={{ color: "#f26822" }}>MANDATORY PIN CODE (6 Digits)*</label>
              <br />
              <input
                type="text"
                name="pin"
                maxLength={6}
                minLength={6}
                required
                placeholder="Ex: 884422"
                style={{ width: "100%", marginBottom: "5px" }}
              />
              <small style={{ color: "#888", display: "block" }}>
                This PIN is your only defense to withdraw funds or dispute orders. Do not lose it.
              </small>
            </div>

            <div style={{ padding: "15px", backgroundColor: "#0a0a0a", border: "1px solid #222", marginBottom: "15px" }}>
              <label style={{ color: "#ccc" }}>PGP Public Key (Required now or at first login)</label>
              <br />
              <textarea
                name="pgp_public_key"
                rows={5}
                placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----..."
                style={{ width: "100%", fontSize: "10px" }}
              />
              <small style={{ color: "#666", display: "block", marginTop: "5px" }}>
                Every account must complete a PGP challenge on every login. If omitted here, key enrollment is mandatory on first login.
              </small>
            </div>

            <div style={{ padding: "12px", backgroundColor: "#021200", border: "1px solid #004d00", marginBottom: "15px" }}>
              <label style={{ color: "#00e676", fontSize: '11px' }}>Affiliate / Referral Code (Optional):</label>
              <input
                type="text"
                name="referral_code"
                placeholder="Ex: cl7v..."
                style={{ width: "100%", fontSize: '12px', marginTop: '5px', backgroundColor: '#000', border: '1px solid #004d00' }}
              />
            </div>

            <div style={{ padding: "12px", backgroundColor: "#0a0500", border: "1px dashed #f26822", marginBottom: "15px", fontSize: "11px", color: "#888" }}>
              <strong style={{ color: "#f26822" }}>🔐 ANTI-PHISHING NOTICE:</strong> After registration, you will receive a unique security phrase. This phrase will appear on your login screen every time. If it is missing or different, you are being phished.
            </div>
          </>
        )}

        <button type="submit" style={{ width: "100%", padding: "10px", fontWeight: "bold" }}>
          {isRegistering ? "Initiate Registration Protocol" : "Request Access Challenge"}
        </button>
      </form>

      <br />
      <div style={{ textAlign: "center", fontSize: "12px" }}>
        {isRegistering ? (
          <a href="/auth/login">Return to Secure Login Interface</a>
        ) : (
          <a href="/auth/login?mode=register">Generate New Imprint / Register</a>
        )}
      </div>
    </div>
  );
}
