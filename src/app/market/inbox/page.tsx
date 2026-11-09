import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import {
  deleteAllNotificationsAction,
  deleteNotificationAction,
  markNotificationsReadAction,
  sendMessageAction,
} from "@/app/actions/messages";

export default async function PgpInbox({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const session = await verifyAuth();
  const res = await searchParams;

  // Fetch all conversations where user is a participant
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { participantAId: session.userId as string },
        { participantBId: session.userId as string }
      ]
    },
    include: {
      participantA: { select: { username: true, id: true } },
      participantB: { select: { username: true, id: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 } // Get last message for preview
    },
    orderBy: { updatedAt: 'desc' }
  });
  const notifications = await prisma.notification.findMany({
    where: {
      userId: session.userId as string,
      type: { not: "MESSAGE" },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;
  const successMessage = res.success === "NotificationDeleted"
    ? "Notification deleted."
    : res.success === "NotificationsDeleted"
      ? "All system notifications deleted."
      : res.success === "NotificationsRead"
        ? "Notifications marked as read."
        : "Transmission successful.";

  return (
    <div className="box">
      <h2>Conversational Cipher-Hub (PGP)</h2>
      <hr/>

      {res.error && <div className="danger" style={{ padding: '10px', marginBottom: '10px' }}>ERROR: {res.error}</div>}
      {res.success && <div className="success" style={{ padding: '10px', marginBottom: '10px' }}>{successMessage}</div>}

      <div className="box" style={{ borderColor: unreadNotifications > 0 ? '#f26822' : '#222', backgroundColor: '#070707' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#f26822' }}>SYSTEM NOTIFICATIONS</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' }}>
              {unreadNotifications > 0 && (
                <form action={markNotificationsReadAction} style={{ margin: 0 }}>
                  <button type="submit" style={{ fontSize: '11px' }}>MARK READ</button>
                </form>
              )}
              {notifications.length > 0 && (
                <form action={deleteAllNotificationsAction} style={{ margin: 0 }}>
                  <button type="submit" className="danger" style={{ fontSize: '11px' }}>DELETE ALL</button>
                </form>
              )}
            </div>
         </div>
         {notifications.length === 0 ? (
            <div style={{ padding: '18px', color: '#555', border: '1px dashed #222', textAlign: 'center' }}>No system notifications.</div>
         ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {notifications.slice(0, 8).map((notification) => (
                <article key={notification.id} style={{ padding: '10px', border: `1px solid ${notification.isRead ? '#222' : '#f26822'}`, backgroundColor: notification.isRead ? '#050505' : '#120b07' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <strong style={{ color: '#ddd', flex: 1 }}>{notification.title}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <small style={{ color: '#555' }}>{notification.createdAt.toLocaleString()}</small>
                      <form action={deleteNotificationAction} style={{ margin: 0 }}>
                        <input type="hidden" name="notificationId" value={notification.id} />
                        <button type="submit" className="danger" aria-label={`Delete notification: ${notification.title}`} style={{ padding: '3px 7px', fontSize: '10px' }}>
                          DELETE
                        </button>
                      </form>
                    </div>
                  </div>
                  <p style={{ margin: '6px 0 0', color: '#888', fontSize: '12px' }}>{notification.content}</p>
                </article>
              ))}
            </div>
         )}
      </div>

      <div style={{ display: 'flex', gap: '25px' }}>
         {/* Left - Conversation List */}
         <div style={{ flex: 1.5 }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#f26822' }}>ACTIVE DIALOGUES</h3>

            {conversations.length === 0 && (
              <div style={{ padding: '40px', color: '#555', border: '1px dashed #222', textAlign: 'center' }}>No active encrypted threads found.</div>
            )}

            {conversations.map(conv => {
               const otherUser = conv.participantAId === session.userId ? conv.participantB : conv.participantA;
               const lastMsg = conv.messages[0];

               return (
                  <a href={`/market/inbox/${conv.id}`} key={conv.id} style={{ textDecoration: 'none', display: 'block' }}>
                     <div className="box-hover" style={{
                        padding: '15px',
                        marginBottom: '10px',
                        backgroundColor: '#0a0a0a',
                        borderLeft: '4px solid #f26822',
                        transition: '0.2s'
                     }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <strong style={{ fontSize: '16px', color: '#ccc' }}>✉️ {otherUser.username}</strong>
                           <small style={{ color: '#444' }}>{conv.updatedAt.toLocaleString()}</small>
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: '5px' }}>
                           {lastMsg ? "CIPHERTEXT RECEIVED" : "NEW CONVERSATION"}
                        </div>
                     </div>
                  </a>
               );
            })}
         </div>

         {/* Right - New Message Trigger */}
         <div className="box" style={{ width: '350px', backgroundColor: '#050505', height: 'fit-content', borderColor: '#111' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#f26822', fontSize: '13px' }}>INITIATE NEW CHANNEL</h3>
            <p style={{ fontSize: '11px', color: '#666', marginBottom: '15px' }}>You must share Public Keys externally or via Profile first. All outbound data MUST be PGP Encrypted using the receiver's key.</p>

            <form action={sendMessageAction}>
               <label>Target Identity (Username):</label>
               <input type="text" name="receiver" placeholder="Ex: VendorAlpha" required style={{ width: '100%', marginBottom: '15px', backgroundColor: '#000', border: '1px solid #333' }} />

               <label>PGP SECURED PAYLOAD:</label>
               <textarea
                  name="payload"
                  rows={8}
                  required
                  placeholder={`-----BEGIN PGP MESSAGE-----\n...`}
                  style={{ width: '100%', fontSize: '10px', marginBottom: '15px' }}
               />

               <button type="submit" style={{ width: '100%', fontWeight: 'bold' }}>ESTABLISH CHANNEL</button>
            </form>
         </div>
      </div>
    </div>
  );
}
