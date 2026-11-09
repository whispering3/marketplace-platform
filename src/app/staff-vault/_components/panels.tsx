import {
  manageMirrorsAction,
  staffAdjudicateDisputeAction,
  staffCreateCategoryAction,
  staffCreateUserAction,
  staffDeleteCategoryAction,
  staffDisableBuiltInCategoryAction,
  staffModerateProductAction,
  staffReconcileWithdrawalAction,
  staffReviewWithdrawalAction,
  staffSetTicketStatusAction,
  staffSetUserRoleAction,
  staffToggleProductPauseAction,
  staffToggleProductPromotionAction,
  staffToggleUserBanAction,
  staffUpdateAnnouncementAction,
  staffUpdateCategoryAction,
  staffUpsertFeatureFlagAction
} from "@/app/actions/admin";
import type { Prisma } from "@prisma/client";
import type { getBuyerDetail, getOrderDetail, getVendorDetail } from "../data";
import { tabPermissions } from "../navigation";
export function Metric({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "green" | "amber" | "red" }) {
  return (
    <div className={`admin-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-panel">
      <header><h2>{title}</h2></header>
      {children}
    </section>
  );
}

export function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="admin-table-scroll">{children}</div>;
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "neutral"; children: React.ReactNode }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>;
}

export function StatusList({ rows }: { rows: { status: string; _count: { _all: number } }[] }) {
  return (
    <div className="admin-status-list">
      {rows.length === 0 && <span className="admin-empty">No records yet.</span>}
      {rows.map((row) => <div key={row.status}><span>{row.status}</span><strong>{row._count._all}</strong></div>)}
    </div>
  );
}

export function isAnnouncementVisible(announcement: { isActive: boolean; expiresAt: Date | null }) {
  return announcement.isActive && (!announcement.expiresAt || announcement.expiresAt > new Date());
}

export function formatDateTimeLocal(date: Date | null) {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function AnnouncementActions({ announcement }: { announcement: Prisma.AnnouncementGetPayload<Record<string, never>> }) {
  return (
    <div className="admin-row-actions">
      <details className="admin-inline-editor">
        <summary>Open editor</summary>
        <form className="admin-form compact" action={staffUpdateAnnouncementAction}>
          <input type="hidden" name="announcementId" value={announcement.id} />
          <input name="title" required defaultValue={announcement.title} placeholder="Title" />
          <textarea name="content" rows={5} required defaultValue={announcement.content} />
          <textarea name="signature" rows={4} required defaultValue={announcement.signature} />
          <input name="expiresAt" type="datetime-local" defaultValue={formatDateTimeLocal(announcement.expiresAt)} />
          <label className="admin-check">
            <input type="checkbox" name="isActive" defaultChecked={announcement.isActive} />
            Active
          </label>
          <button type="submit">Save Announcement</button>
        </form>
      </details>
      <form action="/api/admin/announcements/expire" method="post">
        <input type="hidden" name="announcementId" value={announcement.id} />
        <button type="submit">Expire Now</button>
      </form>
    </div>
  );
}

export function BuiltInCategoryActions({ category }: { category: { label: string; icon: string; subcategories: string[] } }) {
  return (
    <div className="admin-row-actions">
      <details className="admin-inline-editor">
        <summary>Open editor</summary>
        <form className="admin-form compact" action={staffCreateCategoryAction}>
          <input name="label" required defaultValue={category.label} placeholder="Category name" />
          <input name="icon" defaultValue={category.icon} placeholder="[+]" />
          <textarea name="subcategories" rows={4} required defaultValue={category.subcategories.join(", ")} />
          <button type="submit">Save Override</button>
        </form>
      </details>
      <form action={staffDisableBuiltInCategoryAction}>
        <input type="hidden" name="label" value={category.label} />
        <input type="hidden" name="icon" value={category.icon} />
        <input type="hidden" name="subcategories" value={category.subcategories.join(", ")} />
        <button type="submit">Disable</button>
      </form>
    </div>
  );
}

export function OrderDetailPanel({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof getOrderDetail>>> }) {
  const { order, messages, logs } = detail;
  const support = order.supportTicket || order.disputeTicket;

  return (
    <Panel title={`Transaction Control: ${order.id.slice(0, 12)}`}>
      <section className="admin-metrics compact">
        <Metric label="Total" value={`${order.totalXMR.toFixed(5)} XMR`} tone="green" />
        <Metric label="Market Fee" value={`${order.marketFeeXMR.toFixed(5)} XMR`} />
        <Metric label="Shipping" value={`${order.shippingCostXMR.toFixed(5)} XMR`} />
        <Metric label="Status" value={order.status} tone={order.status === "DISPUTE" ? "red" : order.status === "COMPLETED" ? "green" : "amber"} />
        <Metric label="Payment" value={order.paymentConfirmed ? "Confirmed" : "Unconfirmed"} tone={order.paymentConfirmed ? "green" : "red"} />
        <Metric label="Messages" value={messages.length} />
      </section>

      <dl className="admin-definition vendor-definition">
        <dt>Buyer</dt><dd>{order.buyer.username} / {order.buyer.isBanned ? "banned" : "active"}</dd>
        <dt>Vendor</dt><dd>{order.vendor.username} / level {order.vendor.level} / trust {order.vendor.trustScore}</dd>
        <dt>Product</dt><dd>{order.product.title} / {order.product.category} / {order.product.subcategory}</dd>
        <dt>Created</dt><dd>{order.createdAt.toLocaleString()}</dd>
        <dt>Shipped</dt><dd>{order.shippedAt?.toLocaleString() || "Not shipped"}</dd>
        <dt>Tracking</dt><dd>{order.trackingNumber || "Not provided"}</dd>
        <dt>Escrow</dt><dd>Standard / {order.escrowAddress || "Internal wallet escrow"}</dd>
        <dt>Shipping payload</dt><dd>{order.shippingPayload ? "PGP encrypted payload stored" : "No shipping payload"}</dd>
      </dl>

      <section className="admin-grid three vendor-detail-grid">
        <div>
          <h3>Order Chat</h3>
          <div className="admin-feed">
            {messages.length === 0 && <span className="admin-empty">No order messages.</span>}
            {messages.slice(-8).map((message) => (
              <article key={message.id}>
                <strong>{message.sender.username} / {message.sender.role}</strong>
                <small>{message.createdAt.toLocaleString()}</small>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Support</h3>
          <div className="admin-feed">
            {!support && <span className="admin-empty">No support ticket linked.</span>}
            {support && (
              <article>
                <strong>{support.subject}</strong>
                <small>{support.status} / {support.priority} / {support.category}</small>
                <a href={`/market/support/${support.id}`}>Open ticket</a>
              </article>
            )}
            {support?.messages.slice(-5).map((message) => (
              <article key={message.id}>
                <strong>{message.senderRole}</strong>
                <small>{message.createdAt.toLocaleString()}</small>
                <p>{message.pgpContent}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Financial Trail</h3>
          <div className="admin-feed">
            {logs.length === 0 && <span className="admin-empty">No financial logs for this order.</span>}
            {logs.map((log) => (
              <article key={log.id}>
                <strong>{log.type} / {log.amountXMR.toFixed(5)} XMR</strong>
                <small>{log.createdAt.toLocaleString()}</small>
                <p>{log.details || log.txHash || "-"}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </Panel>
  );
}

export function FeatureFlagActions({ flag }: { flag: Prisma.FeatureFlagGetPayload<Record<string, never>> }) {
  return (
    <details className="admin-inline-editor">
      <summary>Edit</summary>
      <form className="admin-form compact" action={staffUpsertFeatureFlagAction}>
        <input name="key" readOnly value={flag.key} />
        <textarea name="description" rows={4} defaultValue={flag.description || ""} />
        <label className="admin-check">
          <input type="checkbox" name="enabled" defaultChecked={flag.enabled} />
          Enabled
        </label>
        <button type="submit">Save</button>
      </form>
    </details>
  );
}

export function CategoryActions({ category }: { category: Prisma.MarketCategoryGetPayload<Record<string, never>> }) {
  return (
    <div className="admin-row-actions">
      <details className="admin-inline-editor">
        <summary>Open editor</summary>
        <form className="admin-form compact" action={staffUpdateCategoryAction}>
          <input type="hidden" name="categoryId" value={category.id} />
          <input name="label" required defaultValue={category.label} placeholder="Category name" />
          <input name="icon" defaultValue={category.icon} placeholder="[+]" />
          <textarea name="subcategories" rows={4} required defaultValue={category.subcategories.join(", ")} />
          <label className="admin-check">
            <input type="checkbox" name="isActive" defaultChecked={category.isActive} />
            Active
          </label>
          <button type="submit">Save</button>
        </form>
      </details>
      <form action={staffDeleteCategoryAction}>
        <input type="hidden" name="categoryId" value={category.id} />
        <button type="submit">{category.isActive ? "Disable/Delete" : "Delete"}</button>
      </form>
    </div>
  );
}

export function CreateUserPanel() {
  return (
    <Panel title="Create Account">
      <form className="admin-form" action={staffCreateUserAction}>
        <input name="username" required placeholder="Username" />
        <input name="password" type="password" required placeholder="Temporary password" />
        <input name="pin" type="password" maxLength={6} required placeholder="6 digit PIN" />
        <select name="role" defaultValue="VENDOR">
          <option value="BUYER">Buyer</option>
          <option value="VENDOR">Vendor</option>
          <option value="STAFF">Moderator</option>
          <option value="ADMIN">Admin</option>
        </select>
        <div className="permission-grid">
          {Object.entries(tabPermissions)
            .filter(([, permission]) => permission && ["products", "orders", "support"].includes(permission))
            .map(([key, permission]) => (
              <label key={key}>
                <input type="checkbox" name="staffPermissions" value={permission || ""} />
                {key}
              </label>
            ))}
        </div>
        <p className="admin-form-note">New accounts always start with 0.00000 XMR. Funding requires confirmed blockchain deposits.</p>
        <button type="submit">Create Account</button>
      </form>
    </Panel>
  );
}

export function VendorDetailPanel({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof getVendorDetail>>> }) {
  const { vendor, products, orders, reviews, withdrawals, tickets, logs, stats } = detail;
  const avgDispatch = vendor.dispatchedOrdersCount > 0
    ? `${(vendor.totalDispatchHours / vendor.dispatchedOrdersCount).toFixed(1)}h`
    : "N/A";
  const disputeRate = vendor.disputesTotal > 0
    ? `${Math.round((vendor.disputesWon / vendor.disputesTotal) * 100)}%`
    : "N/A";

  return (
    <Panel title={`Vendor Intelligence: ${vendor.username}`}>
      <section className="admin-metrics compact">
        <Metric label="Wallet" value={`${vendor.walletBalanceXMR.toFixed(5)} XMR`} tone="green" />
        <Metric label="Net Sales" value={`${stats.netSalesXMR.toFixed(5)} XMR`} />
        <Metric label="Gross Sales" value={`${stats.grossSalesXMR.toFixed(5)} XMR`} />
        <Metric label="In Escrow" value={`${stats.escrowXMR.toFixed(5)} XMR`} tone="amber" />
        <Metric label="Rating" value={stats.avgRating ? `${stats.avgRating.toFixed(2)} / 5` : "No reviews"} />
        <Metric label="Completed Sales" value={stats.completedSales} tone="green" />
        <Metric label="Active Products" value={stats.activeProducts} />
        <Metric label="Promoted" value={stats.promotedProducts} tone={stats.promotedProducts > 0 ? "amber" : "neutral"} />
        <Metric label="Dispatch" value={avgDispatch} />
      </section>

      <dl className="admin-definition vendor-definition">
        <dt>Status</dt>
        <dd>
          <Badge tone={vendor.isBanned ? "red" : vendor.isVacationMode ? "amber" : "green"}>
            {vendor.isBanned ? "Banned" : vendor.isVacationMode ? "Vacation mode" : "Active"}
          </Badge>
        </dd>
        <dt>Vendor bond</dt><dd>{vendor.hasPaidBond ? "Paid" : "Not paid"}</dd>
        <dt>Role / sales level</dt><dd>{vendor.role} / level {vendor.level} / trust {vendor.trustScore}</dd>
        <dt>Joined</dt><dd>{vendor.joinDate.toLocaleString()}</dd>
        <dt>Products / sales / support</dt><dd>{vendor._count.products} products / {vendor._count.vendorOrders} orders / {vendor._count.vendorSupportTickets} tickets</dd>
        <dt>Disputes</dt><dd>{vendor.disputesWon} won of {vendor.disputesTotal} total ({disputeRate})</dd>
        <dt>Terms</dt><dd>{vendor.vendorTerms || "No vendor terms configured."}</dd>
      </dl>

      <section className="admin-grid two vendor-detail-grid">
        <div>
          <h3>Products</h3>
          <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Price</th><th>Inventory</th><th>Status</th></tr></thead>
              <tbody>
                {products.length === 0 && <tr><td colSpan={4}>No products listed.</td></tr>}
                {products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.title}</strong><small>{product.category} / {product.subcategory}</small></td>
                    <td>{product.priceXMR.toFixed(5)} XMR</td>
                    <td>{product.quantity}<small>{product._count.orders} orders / {product._count.reviews} reviews</small></td>
                    <td><Badge tone={product.isPaused ? "red" : product.isPromoted ? "amber" : "green"}>{product.isPaused ? "Paused" : product.isPromoted ? "Promoted" : "Active"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>

        <div>
          <h3>Recent Sales</h3>
          <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Order</th><th>Buyer</th><th>Status</th><th>Value</th></tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={4}>No orders yet.</td></tr>}
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.id.slice(0, 10)}</strong><small>{order.product.title}</small></td>
                    <td>{order.buyer.username}</td>
                    <td><Badge tone={order.status === "COMPLETED" ? "green" : order.status === "DISPUTE" ? "red" : "amber"}>{order.status}</Badge></td>
                    <td>{order.totalXMR.toFixed(5)} XMR<small>fee {order.marketFeeXMR.toFixed(5)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </section>

      <section className="admin-grid three vendor-detail-grid">
        <div>
          <h3>Ratings</h3>
          <div className="admin-feed">
            {reviews.length === 0 && <span className="admin-empty">No customer feedback.</span>}
            {reviews.slice(0, 8).map((review) => (
              <article key={review.id}>
                <strong>{review.rating}/5 - {review.product.title}</strong>
                <small>{review.buyer.username} / {review.createdAt.toLocaleDateString()}</small>
                <p>{review.comment}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Support</h3>
          <div className="admin-feed">
            {tickets.length === 0 && <span className="admin-empty">No support tickets.</span>}
            {tickets.slice(0, 8).map((ticket) => (
              <article key={ticket.id}>
                <strong>{ticket.subject}</strong>
                <small>{ticket.status} / {ticket.buyer?.username || "no buyer"} / {ticket.updatedAt.toLocaleDateString()}</small>
                <a href={`/market/support/${ticket.id}`}>Open ticket</a>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Financial Log</h3>
          <div className="admin-feed">
            {withdrawals.slice(0, 4).map((withdrawal) => (
              <article key={withdrawal.id}>
                <strong>Withdrawal {withdrawal.amountXMR.toFixed(5)} XMR</strong>
                <small>{withdrawal.status} / {withdrawal.createdAt.toLocaleDateString()}</small>
                <p>{withdrawal.address}</p>
              </article>
            ))}
            {logs.slice(0, 6).map((log) => (
              <article key={log.id}>
                <strong>{log.type} {log.amountXMR.toFixed(5)} XMR</strong>
                <small>{log.createdAt.toLocaleDateString()}</small>
                <p>{log.details || log.txHash || "-"}</p>
              </article>
            ))}
            {withdrawals.length === 0 && logs.length === 0 && <span className="admin-empty">No financial events.</span>}
          </div>
        </div>
      </section>
    </Panel>
  );
}

export function BuyerDetailPanel({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof getBuyerDetail>>> }) {
  const { buyer, orders, reviews, tickets, favorites, logs, withdrawals, stats } = detail;

  return (
    <Panel title={`Buyer Intelligence: ${buyer.username}`}>
      <section className="admin-metrics compact">
        <Metric label="Wallet" value={`${buyer.walletBalanceXMR.toFixed(5)} XMR`} tone="green" />
        <Metric label="Spent" value={`${stats.totalSpentXMR.toFixed(5)} XMR`} />
        <Metric label="In Escrow" value={`${stats.escrowXMR.toFixed(5)} XMR`} tone="amber" />
        <Metric label="Orders" value={buyer._count.orders} />
        <Metric label="Completed" value={stats.completed} tone="green" />
        <Metric label="Disputes" value={stats.disputes} tone={stats.disputes > 0 ? "red" : "neutral"} />
        <Metric label="Reviews" value={buyer._count.reviews} />
        <Metric label="Favorites" value={buyer._count.favorites} />
      </section>

      <dl className="admin-definition vendor-definition">
        <dt>Status</dt>
        <dd><Badge tone={buyer.isBanned ? "red" : "green"}>{buyer.isBanned ? "Banned" : "Active"}</Badge></dd>
        <dt>Role / trust</dt><dd>{buyer.role} / trust {buyer.trustScore} / level {buyer.level}</dd>
        <dt>Joined</dt><dd>{buyer.joinDate.toLocaleString()}</dd>
        <dt>PGP</dt><dd>{buyer.pgpPublicKey ? "Configured" : "Missing"}</dd>
        <dt>Support / withdrawals</dt><dd>{buyer._count.buyerSupportTickets} tickets / {buyer._count.withdrawals} withdrawals</dd>
      </dl>

      <section className="admin-grid three vendor-detail-grid">
        <div>
          <h3>Recent Orders</h3>
          <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Order</th><th>Vendor</th><th>Status</th><th>Value</th></tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={4}>No orders yet.</td></tr>}
                {orders.slice(0, 10).map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.id.slice(0, 10)}</strong><small>{order.product.title}</small></td>
                    <td>{order.vendor.username}</td>
                    <td><Badge tone={order.status === "COMPLETED" ? "green" : order.status === "DISPUTE" ? "red" : "amber"}>{order.status}</Badge></td>
                    <td>{order.totalXMR.toFixed(5)} XMR</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
        <div>
          <h3>Feedback</h3>
          <div className="admin-feed">
            {reviews.length === 0 && <span className="admin-empty">No feedback submitted.</span>}
            {reviews.slice(0, 8).map((review) => (
              <article key={review.id}>
                <strong>{review.rating}/5 - {review.product.title}</strong>
                <small>{review.createdAt.toLocaleDateString()}</small>
                <p>{review.comment}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h3>Support and Money</h3>
          <div className="admin-feed">
            {tickets.slice(0, 5).map((ticket) => (
              <article key={ticket.id}>
                <strong>{ticket.subject}</strong>
                <small>{ticket.status} / {ticket.vendor?.username || "no vendor"}</small>
                <a href={`/market/support/${ticket.id}`}>Open ticket</a>
              </article>
            ))}
            {withdrawals.slice(0, 3).map((withdrawal) => (
              <article key={withdrawal.id}>
                <strong>Withdrawal {withdrawal.amountXMR.toFixed(5)} XMR</strong>
                <small>{withdrawal.status}</small>
                <p>{withdrawal.address}</p>
              </article>
            ))}
            {logs.slice(0, 4).map((log) => (
              <article key={log.id}>
                <strong>{log.type} {log.amountXMR.toFixed(5)} XMR</strong>
                <small>{log.createdAt.toLocaleDateString()}</small>
                <p>{log.details || log.txHash || "-"}</p>
              </article>
            ))}
            {tickets.length === 0 && withdrawals.length === 0 && logs.length === 0 && <span className="admin-empty">No support or financial events.</span>}
          </div>
        </div>
      </section>

      <section className="admin-grid two vendor-detail-grid">
        <div>
          <h3>Favorites</h3>
          <div className="admin-feed">
            {favorites.length === 0 && <span className="admin-empty">No favorites saved.</span>}
            {favorites.slice(0, 10).map((favorite) => (
              <article key={favorite.id}>
                <strong>{favorite.product.title}</strong>
                <small>{favorite.product.category} / {favorite.product.vendor.username}</small>
                <p>{favorite.product.priceXMR.toFixed(5)} XMR</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </Panel>
  );
}

export function UsersTable({ users, mode = "users" }: { users: Array<Prisma.UserGetPayload<{ include: { _count: { select: { products: true; orders: true; vendorOrders: true; supportTickets: true } } } }>>; mode?: "users" | "vendors" }) {
  return (
    <TableScroll>
    <table className="admin-table">
      <thead><tr><th>User</th><th>Role</th><th>Wallet</th><th>Trust</th><th>Activity</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.username}</strong><small>{user.id.slice(0, 10)} | joined {user.joinDate.toLocaleDateString()}</small></td>
            <td>{user.role}</td>
            <td>{user.walletBalanceXMR.toFixed(5)} XMR</td>
            <td>{user.trustScore}</td>
            <td><small>{user._count.products} products | {user._count.orders + user._count.vendorOrders} orders | {user._count.supportTickets} tickets{user.staffPermissions.length > 0 ? ` | ${user.staffPermissions.join(", ")}` : ""}</small></td>
            <td><Badge tone={user.isBanned ? "red" : "green"}>{user.isBanned ? "Banned" : "Active"}</Badge></td>
            <td>
              <div className="admin-row-actions">
                {mode === "vendors"
                  ? <a className="admin-link-button" href={`?tab=vendors&vendorId=${user.id}`}>View</a>
                  : <a className="admin-link-button" href={`?tab=users&buyerId=${user.id}`}>View</a>}
                <UserActions user={user} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </TableScroll>
  );
}

export function UserActions({ user }: { user: { id: string; role: string; isBanned: boolean; staffPermissions: string[] } }) {
  return (
    <div className="admin-row-actions">
      <form action={staffToggleUserBanAction}>
        <input type="hidden" name="userId" value={user.id} />
        <button type="submit">{user.isBanned ? "Unban" : "Ban"}</button>
      </form>
      <form action={staffSetUserRoleAction}>
        <input type="hidden" name="userId" value={user.id} />
        <select name="role" defaultValue={user.role}>
          <option value="BUYER">Buyer</option>
          <option value="VENDOR">Vendor</option>
          <option value="STAFF">Moderator</option>
          <option value="ADMIN">Admin</option>
        </select>
        <details className="inline-permissions">
          <summary>Moderator permissions</summary>
          <div className="permission-grid compact">
            {Object.entries(tabPermissions)
              .filter(([, permission]) => permission && ["products", "orders", "support"].includes(permission))
              .map(([key, permission]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    name="staffPermissions"
                    value={permission || ""}
                    defaultChecked={user.staffPermissions.includes(permission || "")}
                  />
                  {key}
                </label>
              ))}
          </div>
        </details>
        <button type="submit">Set</button>
      </form>
    </div>
  );
}

export function ProductActions({ product }: { product: { id: string; isPaused: boolean; isPromoted: boolean; moderationStatus?: string } }) {
  return (
    <div className="admin-row-actions">
      {product.moderationStatus !== "APPROVED" && (
        <form action={staffModerateProductAction}>
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="decision" value="APPROVED" />
          <input type="hidden" name="note" value="Approved by catalog moderation" />
          <button type="submit">Approve</button>
        </form>
      )}
      {product.moderationStatus !== "REJECTED" && (
        <form action={staffModerateProductAction}>
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="decision" value="REJECTED" />
          <input name="note" placeholder="Reason" />
          <button type="submit">Reject</button>
        </form>
      )}
      <form action={staffToggleProductPauseAction}>
        <input type="hidden" name="productId" value={product.id} />
        <button type="submit">{product.isPaused ? "Resume" : "Pause"}</button>
      </form>
      <form action={staffToggleProductPromotionAction}>
        <input type="hidden" name="productId" value={product.id} />
        <button type="submit">{product.isPromoted ? "Unpromote" : "Promote 7d"}</button>
      </form>
    </div>
  );
}

export function WithdrawalActions({ id }: { id: string }) {
  return (
    <div className="admin-row-actions">
      <form action={staffReviewWithdrawalAction}>
        <input type="hidden" name="withdrawalId" value={id} />
        <input type="hidden" name="decision" value="REJECT" />
        <button type="submit">Reject</button>
      </form>
      <form action={staffReviewWithdrawalAction}>
        <input type="hidden" name="withdrawalId" value={id} />
        <input type="hidden" name="decision" value="APPROVE" />
        <button type="submit">Approve</button>
      </form>
    </div>
  );
}

export function TicketActions({ ticket }: { ticket: { id: string; status: string } }) {
  return (
    <div className="admin-row-actions">
      <a className="admin-link-button" href={`/market/support/${ticket.id}`}>Open</a>
      <form action={staffSetTicketStatusAction}>
        <input type="hidden" name="ticketId" value={ticket.id} />
        <select name="status" defaultValue={ticket.status}>
          <option value="OPEN">Open</option>
          <option value="STAFF_REPLY">Staff reply</option>
          <option value="CLOSED">Closed</option>
        </select>
        <button type="submit">Set</button>
      </form>
    </div>
  );
}

export function DeleteMirror({ id }: { id: string }) {
  return (
    <form action={manageMirrorsAction}>
      <input type="hidden" name="action" value="DELETE" />
      <input type="hidden" name="mirrorId" value={id} />
      <button type="submit">Remove</button>
    </form>
  );
}

export function DisputesPanel({ disputes }: { disputes: Array<Prisma.OrderGetPayload<{ include: { buyer: true; vendor: true; product: true } }>> }) {
  return (
    <div className="admin-disputes">
      {disputes.map((dispute) => (
        <article key={dispute.id}>
          <div><strong>Order {dispute.id.slice(0, 10)}</strong><small>{dispute.product.title} | {dispute.totalXMR.toFixed(5)} XMR</small></div>
          <span>{dispute.buyer.username} vs {dispute.vendor.username}</span>
          <div className="admin-row-actions">
            <form action={staffAdjudicateDisputeAction}>
              <input type="hidden" name="orderId" value={dispute.id} />
              <input type="hidden" name="decision" value="REFUND_BUYER" />
              <button type="submit">Refund Buyer</button>
            </form>
            <form action={staffAdjudicateDisputeAction}>
              <input type="hidden" name="orderId" value={dispute.id} />
              <input type="hidden" name="decision" value="RELEASE_VENDOR" />
              <button type="submit">Release Vendor</button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ReconcileWithdrawal({ id, txHash }: { id: string; txHash: string | null }) {
  return <form action={staffReconcileWithdrawalAction}>
    <input type="hidden" name="withdrawalId" value={id} />
    <label>Confirmed transaction hash<input name="txHash" required pattern="[a-fA-F0-9]{64}" defaultValue={txHash || ""} /></label>
    <button type="submit">Verify and reconcile</button>
    <small>Funds remain reserved. Verify the outgoing transfer before reconciling; do not send again.</small>
  </form>;
}
