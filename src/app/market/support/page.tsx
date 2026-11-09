import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { createSupportTicketAction } from "@/app/actions/support";

export default async function SupportHubPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const session = await verifyAuth();
  const res = await searchParams;

  const myTickets = await prisma.supportTicket.findMany({
    where: session.role === "ADMIN"
      ? {}
      : {
          OR: [
            { userId: session.userId as string },
            { buyerId: session.userId as string },
            { vendorId: session.userId as string },
          ],
        },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          product: { select: { title: true } },
          buyer: { select: { username: true } },
          vendor: { select: { username: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="box">
      <h2>Sovereign Support Hub</h2>
      <hr/>

      {res.error && <div className="danger" style={{ padding: '10px', marginBottom: '10px' }}>ERROR: {res.error}</div>}
      {res.success && <div className="success" style={{ padding: '10px', marginBottom: '10px' }}>TRANSMISSION RECEIVED. WE ARE ANALYZING.</div>}

      <div style={{ display: 'flex', gap: '30px' }}>
         {/* Left: Open New Ticket */}
         <div className="box" style={{ flex: 1, backgroundColor: '#050505' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#f26822' }}>OPEN NEW CHANNEL</h3>
            <form action={createSupportTicketAction}>
               <label>Subject / Reference:</label><br/>
               <input type="text" name="subject" required style={{ width: '100%', marginBottom: '15px' }} />

               <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                  <div style={{ flex: 1 }}>
                     <label>Category:</label>
                     <select name="category" style={{ width: '100%', padding: '5px', backgroundColor: '#000', color: '#fff' }}>
                        <option value="TECHNICAL">Technical Issue</option>
                        <option value="FINANCIAL">Financial / Deposit</option>
                        <option value="DISPUTE">Order Dispute</option>
                        <option value="OTHER">General Query</option>
                     </select>
                  </div>
                  <div style={{ flex: 1 }}>
                     <label>Priority:</label>
                     <select name="priority" style={{ width: '100%', padding: '5px', backgroundColor: '#000', color: '#fff' }}>
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High</option>
                        <option value="URGENT">Urgent / Emergency</option>
                     </select>
                  </div>
               </div>

               <label>PGP Encrypted Payload (Required):</label>
               <textarea name="content" rows={8} required placeholder="-----BEGIN PGP MESSAGE-----" style={{ width: '100%', fontSize: '11px', marginBottom: '15px' }} />

               <button type="submit" style={{ width: '100%', fontWeight: 'bold' }}>TRANSMIT TO STAFF</button>
            </form>
         </div>

         {/* Right: Active Ticket History */}
         <div style={{ flex: 1.5 }}>
            <h3 style={{ margin: '0 0 15px 0' }}>ACTIVE TRANSMISSIONS</h3>
            <table className="dark-table" style={{ width: '100%' }}>
               <thead>
                  <tr>
                     <th>ID</th>
                     <th>Subject</th>
                     <th>Participants</th>
                     <th>Status</th>
                     <th>Updated</th>
                  </tr>
               </thead>
               <tbody>
                  {myTickets.length === 0 && (
                     <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#444' }}>No active support channels.</td></tr>
                  )}
                  {myTickets.map(t => (
                     <tr key={t.id}>
                        <td><small>{t.id.slice(-6)}</small></td>
                        <td>
                           <a href={`/market/support/${t.id}`} style={{ color: '#f26822' }}>{t.subject}</a>
                           {t.order && (
                              <div style={{ fontSize: '10px', color: '#777', marginTop: '3px' }}>
                                 Order #{t.order.id.slice(0, 8)} - {t.order.product.title}
                              </div>
                           )}
                        </td>
                        <td style={{ fontSize: '10px', color: '#888' }}>
                           {t.order ? `${t.order.buyer.username} / ${t.order.vendor.username} / STAFF` : 'USER / STAFF'}
                        </td>
                        <td style={{ color: t.status === 'STAFF_REPLY' ? '#4caf50' : '#888' }}>{t.status}</td>
                        <td style={{ fontSize: '10px' }}>{t.updatedAt.toLocaleDateString()}</td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
}
