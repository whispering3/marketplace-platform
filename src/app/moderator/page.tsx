import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logoutAction } from "@/app/actions/auth";
import { verifyAuth } from "@/lib/session";
import { hasStaffPermission, MODERATOR_PERMISSIONS } from "@/lib/staff-permissions";
import { staffModerateProductAction, staffSetTicketStatusAction, staffAdjudicateDisputeAction } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

export default async function ModeratorWorkspace({ searchParams }: {
  searchParams: Promise<{ tab?: string; page?: string; success?: string; error?: string }>;
}) {
  const session = await verifyAuth();
  if (session.role !== "STAFF") redirect(session.role === "ADMIN" ? `/${process.env.ADMIN_URL_SECRET || "staff-dev"}` : "/market");
  if (!session.isStaffVerified) redirect("/moderator/verify");
  const account = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { role: true, isBanned: true, staffPermissions: true } });
  const allowed = MODERATOR_PERMISSIONS.filter((permission) => hasStaffPermission(account, permission));
  const params = await searchParams;
  const tab = allowed.find((permission) => permission === params.tab) || allowed[0];
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page || "1", 10) || 1));
  const pagination = { take: 21, skip: (page - 1) * 20 };
  const [products, tickets, orders] = await Promise.all([
    tab === "products" ? prisma.product.findMany({ where: { moderationStatus: "PENDING_REVIEW" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...pagination,
      select: { id: true, title: true, description: true, category: true, vendor: { select: { username: true } } } }) : [],
    tab === "support" ? prisma.supportTicket.findMany({ where: { status: { not: "CLOSED" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...pagination,
      select: { id: true, subject: true, status: true, priority: true, user: { select: { username: true } }, messages: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, senderRole: true, pgpContent: true } } } }) : [],
    tab === "orders" ? prisma.order.findMany({ where: { status: "DISPUTE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...pagination,
      select: { id: true, status: true, totalXMR: true, product: { select: { title: true } }, buyer: { select: { username: true } }, vendor: { select: { username: true } } } }) : [],
  ]);
  const rows = tab === "products" ? products : tab === "support" ? tickets : orders;
  return <div className="moderator-shell">
    <a href="#moderator-content" className="skip-link">Skip to content</a>
    <aside className="moderator-sidebar">
      <a className="moderator-brand" href="/moderator">OLYMPUS <span>Moderation</span></a>
      <p>Review listings, help members and resolve disputes.</p>
      <nav aria-label="Moderator navigation">{allowed.map((permission) => <a key={permission} href={`/moderator?tab=${permission}`} aria-current={tab === permission ? "page" : undefined}>{permission === "products" ? "Listing review" : permission === "support" ? "Support queue" : "Disputed orders"}</a>)}</nav>
      <a href="/market">Return to market</a><form action={logoutAction}><button type="submit">Sign out</button></form>
    </aside>
    <main id="moderator-content" className="wallet-page moderator-content">
      <header><p className="moderator-eyebrow">Moderator workspace</p><h1>{tab === "products" ? "Listing review" : tab === "support" ? "Support queue" : tab === "orders" ? "Disputed orders" : "Your workspace"}</h1><p>Signed in as {session.username}. Queues show the oldest items first.</p></header>
      {params.success && <p className="wallet-notice" role="status">Your update has been saved.</p>}
      {params.error && <p className="wallet-notice wallet-error" role="alert">The update could not be saved. Check your selection and try again.</p>}
      {!tab && <section className="wallet-card"><h2>No permissions assigned</h2><p>Ask an administrator to enable your moderation responsibilities.</p></section>}
      {tab && !rows.length && <section className="wallet-card"><h2>No items on this page</h2><p>There are no pending items to display here.</p></section>}
      {products.slice(0, 20).map((product) => <section className="wallet-card" key={product.id}><h2>{product.title}</h2><p>{product.category} · {product.vendor.username}</p><p>{product.description}</p>
        <form action={staffModerateProductAction}><input type="hidden" name="productId" value={product.id} />
          <label htmlFor={`decision-${product.id}`}>Review decision</label><select id={`decision-${product.id}`} name="decision" defaultValue="PENDING_REVIEW"><option value="PENDING_REVIEW">Keep in review</option><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select>
          <label htmlFor={`note-${product.id}`}>Review note</label><textarea id={`note-${product.id}`} name="note" maxLength={2000} rows={3} /><button type="submit">Save review</button>
        </form></section>)}
      {tickets.slice(0, 20).map((ticket) => <section className="wallet-card" key={ticket.id}><h2>{ticket.subject}</h2><p>{ticket.user.username} · {ticket.priority} · {ticket.status}</p>
        <a href={`/market/support/${ticket.id}`}>Open conversation and reply</a>
        <details><summary>Latest 20 messages (newest first)</summary>{ticket.messages.map((message) => <div key={message.id}><strong>{message.senderRole}</strong><pre className="moderator-message">{message.pgpContent}</pre></div>)}</details>
        <form action={staffSetTicketStatusAction}><input type="hidden" name="ticketId" value={ticket.id} /><label htmlFor={`status-${ticket.id}`}>Ticket status</label><select id={`status-${ticket.id}`} name="status" defaultValue={ticket.status}><option value="OPEN">Open</option><option value="STAFF_REPLY">Staff reply</option><option value="CLOSED">Closed</option></select><button type="submit">Update ticket</button></form>
      </section>)}
      {orders.slice(0, 20).map((order) => <section className="wallet-card" key={order.id}><h2>{order.product.title}</h2><p className="wallet-monospace">Order {order.id}</p><p>{order.buyer.username} → {order.vendor.username} · {order.totalXMR.toFixed(12)} XMR</p>
        {hasStaffPermission(account, "support") && <form action={staffAdjudicateDisputeAction}><input type="hidden" name="orderId" value={order.id} /><label htmlFor={`resolution-${order.id}`}>Resolution</label><select id={`resolution-${order.id}`} name="decision" required defaultValue=""><option value="" disabled>Select a resolution</option><option value="REFUND_BUYER">Refund buyer</option><option value="RELEASE_VENDOR">Release to vendor</option></select><label><input type="checkbox" required /> I have reviewed the case and confirmed this resolution.</label><button type="submit">Resolve dispute</button></form>}
      </section>)}
      {tab && <nav className="wallet-pagination" aria-label="Queue pages">{page > 1 && <a href={`?tab=${tab}&page=${page - 1}`}>Previous</a>}<span>Page {page}</span>{rows.length > 20 && <a href={`?tab=${tab}&page=${page + 1}`}>Next</a>}</nav>}
    </main>
  </div>;
}
