import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { notFound } from "next/navigation";
import { sendMessageAction } from "@/app/actions/messages";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifyAuth();
  const resolvedParams = await params;

  const conversation = await prisma.conversation.findUnique({
    where: { id: resolvedParams.id },
    include: {
      participantA: { select: { username: true, id: true } },
      participantB: { select: { username: true, id: true } },
      messages: {
        include: { sender: { select: { username: true } } },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!conversation) return notFound();

  // Security: Check if user is part of the conversation
  if (conversation.participantAId !== session.userId && conversation.participantBId !== session.userId) {
    return notFound();
  }

  await prisma.inboxMessage.updateMany({
    where: {
      conversationId: conversation.id,
      receiverId: session.userId as string,
      isRead: false,
    },
    data: { isRead: true },
  });

  const otherUser = conversation.participantAId === session.userId ? conversation.participantB : conversation.participantA;

  return (
    <div className="box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
         <h2 style={{ margin: 0 }}>Protocol Channel: {otherUser.username}</h2>
         <a href="/market/inbox" style={{ fontSize: '12px' }}>BACK TO HUB</a>
      </div>
      <hr/>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px', maxHeight: '500px', overflowY: 'auto', paddingRight: '10px' }}>
         {conversation.messages.length === 0 && <p style={{ color: '#444', textAlign: 'center' }}>Channel established. Awaiting first ciphertext block.</p>}

         {conversation.messages.map(msg => (
            <div key={msg.id} style={{
               alignSelf: msg.senderId === session.userId ? 'flex-end' : 'flex-start',
               maxWidth: '80%',
               backgroundColor: msg.senderId === session.userId ? '#0d1a0d' : '#0a0a0a',
               border: msg.senderId === session.userId ? '1px solid #1a331a' : '1px solid #1a1a1a',
               padding: '12px',
               borderRadius: '4px'
            }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '11px', color: msg.senderId === session.userId ? '#4caf50' : '#f26822' }}>
                     {msg.sender.username} {msg.senderId === session.userId ? "(YOU)" : ""}
                  </strong>
                  <small style={{ color: '#444', fontSize: '9px' }}>{msg.createdAt.toLocaleString()}</small>
               </div>

               <textarea
                  readOnly
                  rows={6}
                  defaultValue={msg.pgpMessage}
                  style={{
                    width: '100%',
                    fontSize: '10px',
                    backgroundColor: '#000',
                    border: 'none',
                    color: '#888',
                    fontFamily: 'monospace'
                  }}
               />
               <div style={{ textAlign: 'right', marginTop: '5px' }}>
                  <small style={{ fontSize: '9px', color: '#333' }}>[ PGP_BLOCK_ENCRYPTED ]</small>
               </div>
            </div>
         ))}
      </div>

      {/* Reply Area */}
      <div className="box" style={{ backgroundColor: '#050505' }}>
         <h3 style={{ margin: '0 0 10px 0', fontSize: '13px' }}>TRANSMIT REPLY</h3>
         <form action={sendMessageAction}>
            <input type="hidden" name="receiver" value={otherUser.username} />
            <textarea
               name="payload"
               rows={6}
               required
               placeholder="Paste your PGP encrypted response here..."
               style={{ width: '100%', fontSize: '10px', marginBottom: '10px' }}
            />
            <button type="submit" style={{ width: '100%', fontWeight: 'bold' }}>ENCRYPT & SEND TO {otherUser.username}</button>
         </form>
         <p style={{ fontSize: '10px', color: '#555', marginTop: '10px', textAlign: 'center' }}>
            Remember: Only {otherUser.username} can decrypt this message with their Private Key.
         </p>
      </div>

    </div>
  );
}
