import { getStaffChallenge, verifyStaffAction } from "@/app/actions/admin-auth";
import { verifyAuth } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function StaffVerification({
  searchParams,
  moderator = false,
}: {
  searchParams: Promise<{ error?: string }>;
  moderator?: boolean;
}) {
  const session = await verifyAuth();
  if (session.role !== "ADMIN" && session.role !== "STAFF") return redirect("/market");
  const adminPath = "/" + (process.env.ADMIN_URL_SECRET || "staff-dev");
  if (moderator && session.role !== "STAFF") return redirect(adminPath);
  if (!moderator && session.role === "STAFF") return redirect("/moderator/verify");
  const ADMIN_PATH = moderator ? "/moderator" : adminPath;
  if (session.isStaffVerified) return redirect(ADMIN_PATH);

  const { error } = await searchParams;
  const challenge = await getStaffChallenge();

  return (
    <div className="box" style={{ maxWidth: '600px', margin: '50px auto', borderColor: '#8b0000', backgroundColor: '#0c0000' }}>
      <h2 className="danger" style={{ textAlign: 'center' }}>{moderator ? "Moderator verification" : "Administrator verification"}</h2>
      <p style={{ fontSize: '12px', textAlign: 'center', color: '#888' }}>
        Verify your identity to access your workspace.
      </p>

      {error && (
        <div style={{ backgroundColor: '#330000', color: '#ffaaaa', padding: '10px', border: '1px solid #800', marginBottom: '20px', fontSize: '12px' }}>
          VERIFICATION FAILED: {error}
        </div>
      )}

      <div style={{ backgroundColor: '#000', padding: '15px', border: '1px solid #333', marginBottom: '20px' }}>
        <label style={{ color: '#f26822', fontSize: '11px', fontWeight: 'bold' }}>PGP SIGNATURE CHALLENGE:</label>
        <pre style={{ backgroundColor: '#111', padding: '10px', fontSize: '11px', border: '1px solid #222', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
          {challenge}
        </pre>
        <p style={{ fontSize: '10px', color: '#666' }}>
          Sign the exact string above with your GPG/PGP private key and paste the armored signature block below.
        </p>
      </div>

      <form action={verifyStaffAction}>
        <input type="hidden" name="challenge" value={challenge} />

        <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
           {!moderator && <div style={{ flex: 1 }}>
              <label htmlFor="staff-msid" style={{ fontSize: '11px', color: '#aaa' }}>Master Staff ID (MSID):</label>
              <input id="staff-msid" type="text" name="msid" required placeholder="XXXX-XXXX-XXXX" style={{ width: '100%' }} />
           </div>}
           <div style={{ flex: 1 }}>
              <label htmlFor="staff-pin" style={{ fontSize: '11px', color: '#aaa' }}>Account PIN:</label>
              <input id="staff-pin" type="password" name="pin" required placeholder="******" style={{ width: '100%' }} />
           </div>
        </div>

        <label htmlFor="staff-signature" style={{ fontSize: '11px', color: '#aaa' }}>PGP ARMORED SIGNATURE:</label><br/>
        <textarea
          id="staff-signature" name="signature"
          rows={10}
          required
          placeholder="-----BEGIN PGP SIGNATURE-----"
          style={{ width: '100%', marginBottom: '20px' }}
        />

        <button type="submit" style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 'bold', backgroundColor: '#8b0000', color: '#fff' }}>
          Verify and open workspace
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
         [ <a href="/market" style={{ fontSize: '11px', color: '#555' }}>Return to market</a> ]
      </div>
    </div>
  );
}
