import { initializeMarketStaffAction } from "@/app/actions/setup";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminBootPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const adminExists = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  if (adminExists) {
    // If an admin already exists, this route becomes a dead end to prevent attacks.
    return redirect("/auth/login?error=SystemAlreadyInitialized");
  }

  const { error } = await searchParams;

  return (
    <div className="box" style={{ maxWidth: '400px', margin: '50px auto', borderColor: '#8b0000', backgroundColor: '#0c0000' }}>
      <h2 className="danger" style={{ textAlign: 'center', margin: '0 0 10px 0' }}>SYSTEM BOOT</h2>
      <p style={{ fontSize: '11px', textAlign: 'center', color: '#888' }}>
        No administrative entity found. Please provide the SETUP_KEY and register the First Node.
      </p>

      {error && (
        <div style={{ backgroundColor: '#330000', color: '#ffaaaa', padding: '10px', border: '1px solid #800', marginBottom: '15px', fontSize: '11px' }}>
          ERROR: {error}
        </div>
      )}

      <form action={initializeMarketStaffAction}>
        <label style={{ fontSize: '11px', color: '#ccc' }}>.ENV SETUP_KEY (Root Auth):</label>
        <input type="password" name="setup_key" required placeholder="Paste from .env" style={{ width: '100%', marginBottom: '15px' }} />

        <label style={{ fontSize: '11px', color: '#ccc' }}>Admin Public Username:</label>
        <input type="text" name="username" required placeholder="Admin" style={{ width: '100%', marginBottom: '15px' }} />

        <label style={{ fontSize: '11px', color: '#ccc' }}>Admin Complex Password:</label>
        <input type="password" name="password" required style={{ width: '100%', marginBottom: '15px' }} />

        <label style={{ fontSize: '11px', color: '#ccc' }}>Staff Private PIN (6 digits):</label>
        <input type="password" name="pin" maxLength={6} required placeholder="123456" style={{ width: '100%', marginBottom: '15px' }} />

        <label style={{ fontSize: '11px', color: '#ccc' }}>MSID (Master Staff ID / Secret Badge):</label>
        <input type="text" name="msid" required placeholder="OLYMPUS-ALPHA-1" style={{ width: '100%', marginBottom: '20px' }} />

        <button type="submit" className="danger" style={{ width: '100%', padding: '10px', fontWeight: 'bold' }}>
          INITIALIZE OLYMPUS
        </button>
      </form>
    </div>
  );
}
