import { canManageSupport } from "@/lib/support-access";
import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { replyToTicketAction, closeTicketAction } from "@/app/actions/support";
import { notFound } from "next/navigation";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifyAuth();
  const resParams = await params;
  const isAdmin = await canManageSupport(session);

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: resParams.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      user: { select: { username: true } },
      buyer: { select: { username: true, pgpPublicKey: true } },
      vendor: { select: { username: true, pgpPublicKey: true } },
      order: {
        select: {
          id: true,
          status: true,
          totalXMR: true,
          product: { select: { title: true } },
        },
      },
    }
  });

  if (!ticket) return notFound();
  const isParticipant = ticket.userId === session.userId || ticket.buyerId === session.userId || ticket.vendorId === session.userId;
  if (!isAdmin && !isParticipant) return notFound();

  return (
    <div className="box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <h2 style={{ margin: 0 }}>Transmission Channel: {ticket.subject}</h2>
         <div style={{ display: 'flex', gap: '10px' }}>
            <span style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid #444', color: '#888' }}>CATEGORY: {ticket.category}</span>
            <span style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid #4caf50', color: '#4caf50' }}>STATUS: {ticket.status}</span>
         </div>
      </div>
      <hr/>

      {ticket.order && (
        <div style={{ padding: '12px', backgroundColor: '#080808', border: '1px solid #333', marginBottom: '20px', fontSize: '12px' }}>
          <strong style={{ color: '#ffb300' }}>ORDER-LINKED CASE:</strong>{" "}
          #{ticket.order.id.slice(0, 8)} - {ticket.order.product.title} - {ticket.order.totalXMR.toFixed(4)} XMR - {ticket.order.status}
          <div style={{ marginTop: '6px', color: '#888' }}>
            Participants: Buyer <strong>{ticket.buyer?.username}</strong>, Vendor <strong>{ticket.vendor?.username}</strong>, Staff/Admin
          </div>
        </div>
      )}

      {ticket.order && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          <div style={{ backgroundColor: '#050505', border: '1px solid #222', padding: '10px' }}>
            <div style={{ fontSize: '10px', color: '#4caf50', marginBottom: '6px' }}>BUYER PGP KEY</div>
            <textarea readOnly rows={5} value={ticket.buyer?.pgpPublicKey || "NO BUYER PGP KEY REGISTERED"} style={{ width: '100%', fontSize: '9px', backgroundColor: '#000', color: '#777' }} />
          </div>
          <div style={{ backgroundColor: '#050505', border: '1px solid #222', padding: '10px' }}>
            <div style={{ fontSize: '10px', color: '#f26822', marginBottom: '6px' }}>VENDOR PGP KEY</div>
            <textarea readOnly rows={5} value={ticket.vendor?.pgpPublicKey || "NO VENDOR PGP KEY REGISTERED"} style={{ width: '100%', fontSize: '9px', backgroundColor: '#000', color: '#777' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px' }}>
         {ticket.messages.map(msg => (
            <div key={msg.id} style={{
               alignSelf: msg.senderRole === "STAFF" ? 'flex-start' : 'flex-end',
               width: '85%',
               backgroundColor: msg.senderRole === "STAFF" ? '#0a0d0a' : '#0a0a0a',
               border: msg.senderRole === "STAFF" ? '1px solid #1a331a' : '1px solid #222',
               padding: '15px',
               borderRadius: '4px'
            }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <strong style={{ fontSize: '12px', color: msg.senderRole === "STAFF" ? '#4caf50' : '#f26822' }}>
                     {msg.senderRole === "STAFF" ? "--- STAFF OFFICIAL RESPONSE ---" : `${msg.senderRole}: ${msg.senderId === ticket.vendorId ? ticket.vendor?.username : msg.senderId === ticket.buyerId ? ticket.buyer?.username : ticket.user.username}`}
                  </strong>
                  <span style={{ fontSize: '10px', color: '#444' }}>{msg.createdAt.toLocaleString()}</span>
               </div>
               <textarea readOnly rows={6} value={msg.pgpContent} style={{ width: '100%', fontSize: '11px', backgroundColor: '#000', border: 'none', color: '#999', fontFamily: 'monospace' }} />
            </div>
         ))}
      </div>

      {ticket.status !== "CLOSED" && (
         <div className="box" style={{ backgroundColor: '#050505' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '13px' }}>NEW TRANSMISSION</h3>
            <form action={replyToTicketAction}>
               <input type="hidden" name="ticketId" value={ticket.id} />
               <textarea name="content" rows={6} required placeholder="-----BEGIN PGP MESSAGE-----" style={{ width: '100%', fontSize: '11px', marginBottom: '10px' }} />
               <div style={{ display: 'flex', gap: '15px' }}>
                  <button type="submit" style={{ flex: 2, fontWeight: 'bold' }}>TRANSMIT REPLY</button>
                  <button formAction={closeTicketAction} style={{ flex: 1, backgroundColor: '#333' }}>CLOSE CHANNEL</button>
               </div>
            </form>
         </div>
      )}
    </div>
  );
}
