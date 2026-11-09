import {
  manageMirrorsAction,
  staffAdjustWalletAction,
  staffBroadcastNotificationAction,
  staffCreateAnnouncementAction,
  staffCreateCategoryAction,
  staffToggleMaintenanceAction,
  staffUpsertFeatureFlagAction
} from "@/app/actions/admin";
import { MARKET_CATEGORIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { logoutAction } from "@/app/actions/auth";
import { verifyAuth } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import {
  AnnouncementActions,
  Badge,
  BuiltInCategoryActions,
  BuyerDetailPanel,
  CategoryActions,
  CreateUserPanel,
  DeleteMirror,
  DisputesPanel,
  FeatureFlagActions,
  Metric,
  OrderDetailPanel,
  Panel,
  ProductActions,
  ReconcileWithdrawal,
  StatusList,
  TableScroll,
  TicketActions,
  UsersTable,
  VendorDetailPanel,
  WithdrawalActions,
  isAnnouncementVisible,
} from "./_components/panels";
import { buildOverviewIntelligence, buildPeriodSnapshot, buildWalletReconciliation, getPeriodStart } from "./analytics";
import { getBuyerDetail, getOrderDetail, getVendorDetail } from "./data";
import { tabPermissions, tabs } from "./navigation";

export const dynamic = "force-dynamic";

type Search = {
  tab?: string;
  page?: string;
  q?: string;
  role?: string;
  status?: string;
  vendorId?: string;
  buyerId?: string;
  orderId?: string;
  period?: string;
  success?: string;
  error?: string;
};

export default async function StaffVault({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const session = await verifyAuth();
  if (session.role === "STAFF") return redirect("/moderator");
  if (session.role !== "ADMIN") return redirect("/market");

  if (!session.isStaffVerified) return redirect(`/${process.env.ADMIN_URL_SECRET || "staff-dev"}/verify`);

  const staffAccount = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: { staffPermissions: true, role: true, isBanned: true },
  });
  if (!staffAccount || staffAccount.isBanned) return redirect("/market");

  const allowedTabs = tabs.filter(([key]) => {
    const permission = tabPermissions[key];
    return session.role === "ADMIN" || !permission || staffAccount.staffPermissions.includes(permission);
  });

  const params = await searchParams;
  const requestedTab = params.tab || "overview";
  const currentTab = allowedTabs.some(([key]) => key === requestedTab) ? requestedTab : "overview";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page || "1", 10) || 1));
  const pageSize = 50;
  const offset = currentTab === "overview" ? 0 : (page - 1) * pageSize;
  const rowsFor = <T,>(tabs: string[], query: () => Promise<T[]>): Promise<T[]> => tabs.includes(currentTab) ? query() : Promise.resolve([]);
  const pageLink = (number: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "page" && key !== "success" && key !== "error") query.set(key, value);
    query.set("page", String(number));
    return `?${query}`;
  };
  const q = params.q?.trim() || "";
  const role = params.role || "ALL";
  const status = params.status || "ALL";
  const selectedVendorId = params.vendorId || "";
  const selectedBuyerId = params.buyerId || "";
  const selectedOrderId = params.orderId || "";
  const period = ["24h", "7d", "30d", "all"].includes(params.period || "") ? params.period || "7d" : "7d";
  const periodStart = getPeriodStart(period);

  const userWhere: Prisma.UserWhereInput = {};
  if (q) {
    userWhere.OR = [
      { username: { contains: q, mode: "insensitive" } },
      { id: { contains: q } },
      { staffId: { contains: q, mode: "insensitive" } },
    ];
  }
  if (["BUYER", "VENDOR", "STAFF", "ADMIN"].includes(role)) userWhere.role = role;

  const productWhere: Prisma.ProductWhereInput = {};
  if (q) {
    productWhere.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { subcategory: { contains: q, mode: "insensitive" } },
      { vendor: { username: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (status === "ACTIVE") productWhere.isPaused = false;
  if (status === "PAUSED") productWhere.isPaused = true;
  if (status === "PROMOTED") productWhere.isPromoted = true;
  if (["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(status)) productWhere.moderationStatus = status;

  const orderWhere: Prisma.OrderWhereInput = {};
  if (q) {
    orderWhere.OR = [
      { id: { contains: q } },
      { buyer: { username: { contains: q, mode: "insensitive" } } },
      { vendor: { username: { contains: q, mode: "insensitive" } } },
      { product: { title: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (status !== "ALL" && ["PENDING", "SHIPPED", "DISPUTE", "COMPLETED"].includes(status)) orderWhere.status = status;

  const ticketWhere: Prisma.SupportTicketWhereInput = {};
  if (q) {
    ticketWhere.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { user: { username: { contains: q, mode: "insensitive" } } },
      { buyer: { username: { contains: q, mode: "insensitive" } } },
      { vendor: { username: { contains: q, mode: "insensitive" } } },
      { orderId: { contains: q } },
    ];
  }
  if (status !== "ALL" && ["OPEN", "STAFF_REPLY", "CLOSED"].includes(status)) ticketWhere.status = status;

  const withdrawalWhere: Prisma.WithdrawalRequestWhereInput = {};
  if (status !== "ALL" && ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW", "COMPLETED", "REJECTED"].includes(status)) withdrawalWhere.status = status;

  const [
    users,
    products,
    orders,
    tickets,
    withdrawals,
    processedPayments,
    disputes,
    logs,
    mirrors,
    announcements,
    customCategories,
    featureFlags,
    platformWallet,
    config,
    activeDepositWallets,
    userWalletBalances,
    pendingWithdrawalValue,
    affiliateCommissionValue,
    affiliateCommissions,
    totalUsers,
    totalVendors,
    totalProducts,
    bannedUsers,
    promotedProducts,
    orderValue,
    orderStatus,
    ticketStatus,
    adminLogs,
    securityEvents,
  ] = await Promise.all([
    rowsFor(["overview", "users", "vendors", "wallets"], () => prisma.user.findMany({
      where: currentTab === "vendors" ? { ...userWhere, role: { in: ["VENDOR", "ADMIN"] } } : userWhere,
      orderBy: { joinDate: "desc" },
      take: pageSize, skip: offset,
      include: { _count: { select: { products: true, orders: true, vendorOrders: true, supportTickets: true } } },
    })),
    rowsFor(["overview", "products"], () => prisma.product.findMany({ where: productWhere, orderBy: { createdAt: "desc" }, take: pageSize, skip: offset, include: { vendor: { select: { username: true, isBanned: true } }, _count: { select: { orders: true, reviews: true } } } })),
    rowsFor(["overview", "orders", "support"], () => prisma.order.findMany({
      where: orderWhere,
      orderBy: { createdAt: "desc" },
      take: pageSize, skip: offset,
      include: {
        buyer: { select: { username: true } },
        vendor: { select: { username: true } },
        product: { select: { title: true, productType: true } },
      },
    })),
    rowsFor(["overview", "support"], () => prisma.supportTicket.findMany({
      where: ticketWhere,
      orderBy: { updatedAt: "desc" },
      take: pageSize, skip: offset,
      include: {
        user: { select: { username: true } },
        buyer: { select: { username: true } },
        vendor: { select: { username: true } },
        order: { select: { id: true, status: true } },
      },
    })),
    rowsFor(["overview", "wallets"], () => prisma.withdrawalRequest.findMany({ where: withdrawalWhere, orderBy: { createdAt: "desc" }, take: pageSize, skip: offset, include: { user: { select: { username: true } } } })),
    rowsFor(["wallets"], () => prisma.processedWalletPayment.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset, include: { user: { select: { username: true } } } })),
    rowsFor(["overview", "orders", "support"], () => prisma.order.findMany({ where: { status: "DISPUTE" }, include: { buyer: true, vendor: true, product: true }, take: pageSize, skip: offset })),
    rowsFor(["overview", "logs"], () => prisma.financialLog.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset })),
    rowsFor(["overview", "mirrors"], () => prisma.publicMirror.findMany({ orderBy: { createdAt: "desc" } })),
    rowsFor(["broadcast"], () => prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset })),
    rowsFor(["categories", "products"], () => prisma.marketCategory.findMany({ orderBy: { label: "asc" } })),
    rowsFor(["flags", "system"], () => prisma.featureFlag.findMany({ orderBy: { key: "asc" } })),
    prisma.platformWallet.findUnique({ where: { id: "market_wallet" } }),
    prisma.marketConfig.findUnique({ where: { id: "global_config" } }),
    prisma.transactionWallet.count({ where: { purpose: "DEPOSIT", status: "ACTIVE" } }),
    prisma.user.aggregate({ _sum: { walletBalanceXMR: true } }),
    prisma.withdrawalRequest.aggregate({ where: { status: { in: ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW"] } }, _sum: { amountXMR: true } }),
    prisma.affiliateCommission.aggregate({ _sum: { commissionXMR: true, marketFeeXMR: true }, _count: { _all: true } }),
    rowsFor(["wallets"], () => prisma.affiliateCommission.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset })),
    prisma.user.count(),
    prisma.user.count({ where: { role: "VENDOR" } }),
    prisma.product.count(),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.product.count({ where: { isPromoted: true } }),
    prisma.order.aggregate({ _sum: { totalXMR: true, marketFeeXMR: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    rowsFor(["overview", "logs"], () => prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset })),
    rowsFor(["logs"], () => prisma.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: pageSize, skip: offset })),
  ]);

  const totalVolume = orderValue._sum.totalXMR || 0;
  const totalFees = orderValue._sum.marketFeeXMR || 0;
  const pendingWithdrawals = withdrawals.filter((item) => ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW"].includes(item.status));
  const openTickets = ticketStatus.find((row) => row.status === "OPEN")?._count._all || 0;
  const tabLabel = tabs.find(([key]) => key === currentTab)?.[1] || "Overview";
  const customCategoryLabels = new Set(customCategories.map((category) => category.label));
  const builtInCategoriesForAdmin = MARKET_CATEGORIES.filter((category) => !customCategoryLabels.has(category.label));
  const affiliateUserNames = new Map(users.map((user) => [user.id, user.username]));
  const visibleRecords =
    currentTab === "users" ? users.length :
    currentTab === "vendors" ? users.filter((user) => user.role === "VENDOR" || user.role === "ADMIN").length :
    currentTab === "products" ? products.length :
    currentTab === "orders" ? orders.length :
    currentTab === "wallets" ? withdrawals.length + processedPayments.length :
    currentTab === "support" ? tickets.length :
    currentTab === "categories" ? builtInCategoriesForAdmin.length + customCategories.length :
    currentTab === "logs" ? adminLogs.length + logs.length + securityEvents.length :
    currentTab === "flags" ? featureFlags.length :
    currentTab === "mirrors" ? mirrors.length :
    null;
  const selectedOrder = selectedOrderId && currentTab === "orders"
    ? await getOrderDetail(selectedOrderId)
    : null;
  const reconciliation = buildWalletReconciliation({
    platformWallet,
    userWalletTotalXMR: Number(userWalletBalances._sum.walletBalanceXMR || 0),
    pendingWithdrawalXMR: Number(pendingWithdrawalValue._sum.amountXMR || 0),
    activeDepositWallets,
    processedDepositXMR: processedPayments.reduce((sum, payment) => (sum + Number(payment.amountXMR)), 0),
  });
  const periodSnapshot = buildPeriodSnapshot(orders, logs, adminLogs, periodStart);
  if (currentTab === "overview" || currentTab === "logs") {
    const createdAt = periodStart ? { gte: periodStart } : undefined;
    const [totals, escrow, financialEvents, operatorActions] = await Promise.all([
      prisma.order.aggregate({ where: { createdAt }, _sum: { totalXMR: true, marketFeeXMR: true }, _count: { _all: true } }),
      prisma.order.aggregate({ where: { createdAt, status: { in: ["PENDING", "SHIPPED", "DISPUTE"] } }, _sum: { totalXMR: true } }),
      prisma.financialLog.count({ where: { createdAt } }), prisma.adminAuditLog.count({ where: { createdAt } }),
    ]);
    Object.assign(periodSnapshot, { orders: totals._count._all, gmvXMR: Number(totals._sum.totalXMR || 0), feesXMR: Number(totals._sum.marketFeeXMR || 0), escrowXMR: Number(escrow._sum.totalXMR || 0), financialEvents, operatorActions });
  }
  const overview = buildOverviewIntelligence({
    users,
    products,
    orders,
    tickets,
    withdrawals,
    logs,
    mirrors,
    orderStatus,
    ticketStatus,
    platformWallet,
    config,
    totalUsers,
    totalVendors,
    totalProducts,
    bannedUsers,
    promotedProducts,
    totalVolume: Number(totalVolume),
    totalFees: Number(totalFees),
  });
  const selectedVendor = selectedVendorId && currentTab === "vendors"
    ? await prisma.user.findFirst({
        where: {
          id: selectedVendorId,
          role: { in: ["VENDOR", "ADMIN"] },
        },
        include: {
          _count: {
            select: {
              products: true,
              vendorOrders: true,
              vendorSupportTickets: true,
              withdrawals: true,
            },
          },
        },
      })
    : null;
  const vendorDetail = selectedVendor
    ? await getVendorDetail(selectedVendor.id)
    : null;
  const buyerDetail = selectedBuyerId && currentTab === "users"
    ? await getBuyerDetail(selectedBuyerId)
    : null;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">OM</span>
          <div>
            <strong>Market Ops</strong>
            <small>Admin Console</small>
          </div>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          {allowedTabs.map(([key, label]) => (
            <a key={key} href={`?tab=${key}`} className={currentTab === key ? "active" : ""}>
              <span>{label}</span>
              {key === "support" && openTickets > 0 && <b>{openTickets}</b>}
              {key === "orders" && disputes.length > 0 && <b>{disputes.length}</b>}
            </a>
          ))}
        </nav>

        <section className="admin-side-kpis" aria-label="Operational summary">
          <div>
            <span>Open Tickets</span>
            <strong>{openTickets}</strong>
          </div>
          <div>
            <span>Disputes</span>
            <strong>{disputes.length}</strong>
          </div>
          <div>
            <span>Escrow</span>
            <strong>{(platformWallet?.escrowTotal || 0).toFixed(3)} XMR</strong>
          </div>
        </section>

        <div className="admin-identity">
          <span>Signed in</span>
          <strong>{session.username}</strong>
          <small>MSID {session.msid || "N/A"}</small>
          <form action={logoutAction}><button type="submit">Logout</button></form>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="admin-kicker">Commercial Operations</span>
            <h1>{tabLabel}</h1>
            <p className="admin-page-context">
              {visibleRecords === null ? `${period === "all" ? "All time" : period} operating snapshot` : `${visibleRecords} visible records`}
              {q && ` matching "${q}"`}
            </p>
          </div>
          <form className={`admin-command ${currentTab === "overview" || currentTab === "logs" || currentTab === "mirrors" || currentTab === "broadcast" || currentTab === "system" ? "simple" : ""}`} method="get">
            <input type="hidden" name="tab" value={currentTab} />
            <input name="q" defaultValue={q} placeholder="Search user, product, order, ticket..." />
            {(currentTab === "users" || currentTab === "vendors") && (
              <select name="role" defaultValue={role}>
                <option value="ALL">All roles</option>
                <option value="BUYER">Buyer</option>
                <option value="VENDOR">Vendor</option>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
            )}
            {(currentTab === "overview" || currentTab === "logs") && (
              <select name="period" defaultValue={period}>
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7d</option>
                <option value="30d">Last 30d</option>
                <option value="all">All time</option>
              </select>
            )}
            {(currentTab === "products" || currentTab === "orders" || currentTab === "support" || currentTab === "wallets") && (
              <select name="status" defaultValue={status}>
                <option value="ALL">All statuses</option>
                {currentTab === "products" && <><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="PROMOTED">Promoted</option></>}
                {currentTab === "orders" && <><option value="PENDING">Pending</option><option value="SHIPPED">Shipped</option><option value="DISPUTE">Dispute</option><option value="COMPLETED">Completed</option></>}
                {currentTab === "support" && <><option value="OPEN">Open</option><option value="STAFF_REPLY">Staff reply</option><option value="CLOSED">Closed</option></>}
                {currentTab === "wallets" && <><option value="AWAITING_APPROVAL">Awaiting approval</option><option value="PROCESSING">Processing</option><option value="NEEDS_REVIEW">Needs review</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option></>}
              </select>
            )}
            <button type="submit">Filter</button>
          </form>
        </header>

        {params.success && <div className="admin-alert success">SUCCESS: {params.success}</div>}
        {params.error && <div className="admin-alert danger">ERROR: {params.error}</div>}

        <p className="admin-scope-note">Period metrics use the full database. Lists, activity charts and highlights show up to {pageSize} recent records per dataset.</p>
        {currentTab !== "overview" && <nav className="wallet-pagination" aria-label="Admin pagination">
          {page > 1 && <a href={pageLink(page - 1)}>Previous</a>}<span>Page {page}</span>
          {[users, products, orders, tickets, withdrawals, processedPayments, logs, adminLogs, securityEvents, announcements].some((rows) => rows.length === pageSize) && <a href={pageLink(page + 1)}>Next</a>}
        </nav>}
        {currentTab === "overview" && (
          <section className="admin-overview">
            <section className="admin-metrics">
              <Metric label="GMV" value={`${totalVolume.toFixed(5)} XMR`} tone="green" />
              <Metric label="Revenue" value={`${totalFees.toFixed(5)} XMR`} />
              <Metric label="Escrow" value={`${(platformWallet?.escrowTotal || 0).toFixed(5)} XMR`} tone="amber" />
              <Metric label="Users" value={totalUsers} />
              <Metric label="Vendors" value={totalVendors} />
              <Metric label="Products" value={totalProducts} />
              <Metric label="Promoted" value={promotedProducts} />
              <Metric label="Affiliate Paid" value={`${(affiliateCommissionValue._sum.commissionXMR || 0).toFixed(5)} XMR`} />
              <Metric label="Risk Queue" value={disputes.length + openTickets + bannedUsers} tone="red" />
            </section>

            <section className="admin-command-center">
              <div>
                <span>Operational State</span>
                <strong className={overview.commandState.tone === "red" ? "admin-danger-text" : overview.commandState.tone === "amber" ? "warning" : "success"}>
                  {overview.commandState.label}
                </strong>
                <small>{overview.commandState.summary}</small>
              </div>
              <div>
                <span>Funds Exposure</span>
                <strong>{overview.financialExposureXMR.toFixed(5)} XMR</strong>
                <small>Escrow plus pending withdrawals</small>
              </div>
              <div>
                <span>Moderation Load</span>
                <strong>{overview.riskItems.length}</strong>
                <small>Tickets, disputes, stuck orders, low stock</small>
              </div>
              <div>
                <span>Conversion Surface</span>
                <strong>{overview.promotedCoverage}%</strong>
                <small>Promoted products over active catalog</small>
              </div>
            </section>

            <Panel title={`Period Snapshot (${period === "all" ? "All time" : period})`}>
              <section className="admin-metrics compact">
                <Metric label="Orders" value={periodSnapshot.orders} />
                <Metric label="GMV" value={`${periodSnapshot.gmvXMR.toFixed(5)} XMR`} tone="green" />
                <Metric label="Fees" value={`${periodSnapshot.feesXMR.toFixed(5)} XMR`} />
                <Metric label="Escrow Flow" value={`${periodSnapshot.escrowXMR.toFixed(5)} XMR`} tone="amber" />
                <Metric label="Financial Logs" value={periodSnapshot.financialEvents} />
                <Metric label="Operator Actions" value={periodSnapshot.operatorActions} />
              </section>
              <div className="admin-bars">
                {periodSnapshot.buckets.map((bucket) => (
                  <div key={bucket.label}>
                    <span>{bucket.label}</span>
                    <i style={{ height: `${Math.max(8, bucket.height)}%` }} />
                    <strong>{bucket.orders}</strong>
                  </div>
                ))}
              </div>
            </Panel>

            <section className="admin-grid two">
              <Panel title="Command Queue">
                <div className="admin-queue">
                  {overview.riskItems.length === 0 && <span className="admin-empty">No critical operational items.</span>}
                  {overview.riskItems.map((item) => (
                    <a key={`${item.href}-${item.label}`} href={item.href} className={`admin-queue-item ${item.tone}`}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.description}</small>
                    </a>
                  ))}
                </div>
              </Panel>
              <Panel title="Platform Health">
                <div className="admin-health-grid">
                  {overview.health.map((item) => (
                    <div key={item.label}>
                      <Badge tone={item.tone}>{item.status}</Badge>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="admin-grid three">
              <Panel title="Order Pipeline"><StatusList rows={orderStatus} /></Panel>
              <Panel title="Support Pipeline"><StatusList rows={ticketStatus} /></Panel>
              <Panel title="Seller Leaderboard">
                <div className="admin-feed">
                  {overview.topVendors.length === 0 && <span className="admin-empty">No vendor activity yet.</span>}
                  {overview.topVendors.map((vendor) => (
                    <article key={vendor.id}>
                      <strong>{vendor.username}</strong>
                      <small>{vendor.orders} orders / {vendor.products} products / trust {vendor.trustScore}</small>
                      <p>{vendor.revenueXMR.toFixed(5)} XMR completed net revenue</p>
                      <a href={`?tab=vendors&vendorId=${vendor.id}`}>Open vendor control</a>
                    </article>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="admin-grid two">
              <Panel title="Recent Transactions">
                <TableScroll>
                  <table className="admin-table compact-table">
                    <thead><tr><th>Order</th><th>Parties</th><th>Status</th><th>Value</th></tr></thead>
                    <tbody>
                      {orders.slice(0, 8).map((order) => (
                        <tr key={order.id}>
                          <td><strong>{order.id.slice(0, 10)}</strong><small>{order.product.title}</small></td>
                          <td>{order.buyer.username}<small>Vendor {order.vendor.username}</small></td>
                          <td><Badge tone={order.status === "COMPLETED" ? "green" : order.status === "DISPUTE" ? "red" : "amber"}>{order.status}</Badge></td>
                          <td>{order.totalXMR.toFixed(5)} XMR</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
              <Panel title="Audit Stream">
                <div className="admin-feed">
                  {logs.slice(0, 8).map((log) => (
                    <article key={log.id}>
                      <strong>{log.type} / {log.amountXMR.toFixed(5)} XMR</strong>
                      <small>{log.createdAt.toLocaleString()}</small>
                      <p>{log.details || log.txHash || log.userId || "-"}</p>
                    </article>
                  ))}
                  {logs.length === 0 && <span className="admin-empty">No financial logs yet.</span>}
                </div>
              </Panel>
            </section>
          </section>
        )}

        {currentTab === "users" && (
          <section className="admin-grid">
            {buyerDetail && <BuyerDetailPanel detail={buyerDetail} />}
            <section className="admin-grid side">
            <CreateUserPanel />
            <section className="admin-grid">
              <Panel title="Affiliate Program">
                <section className="admin-metrics compact">
                  <Metric label="Commissions" value={affiliateCommissionValue._count._all} />
                  <Metric label="Paid" value={`${(affiliateCommissionValue._sum.commissionXMR || 0).toFixed(5)} XMR`} tone="green" />
                  <Metric label="Referral Fees" value={`${(affiliateCommissionValue._sum.marketFeeXMR || 0).toFixed(5)} XMR`} />
                </section>
                <TableScroll>
                  <table className="admin-table compact-table">
                    <thead><tr><th>Date</th><th>Order</th><th>Referrer</th><th>Buyer</th><th>Commission</th></tr></thead>
                    <tbody>
                      {affiliateCommissions.length === 0 && <tr><td colSpan={5} className="admin-empty">No affiliate commissions credited.</td></tr>}
                      {affiliateCommissions.slice(0, 12).map((commission) => (
                        <tr key={commission.id}>
                          <td>{commission.createdAt.toLocaleString()}</td>
                          <td>{commission.orderId.slice(0, 10)}</td>
                          <td>{affiliateUserNames.get(commission.referrerId) || commission.referrerId.slice(0, 10)}</td>
                          <td>{affiliateUserNames.get(commission.referredUserId) || commission.referredUserId.slice(0, 10)}</td>
                          <td>{commission.commissionXMR.toFixed(5)} XMR<small>{(commission.rate * 100).toFixed(0)}% of fee</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
              <Panel title={`Users (${users.length})`}><UsersTable users={users} /></Panel>
            </section>
            </section>
          </section>
        )}

        {currentTab === "vendors" && (
          <section className="admin-grid">
            {vendorDetail && <VendorDetailPanel detail={vendorDetail} />}
            <Panel title={`Vendors (${users.filter((user) => user.role === "VENDOR" || user.role === "ADMIN").length})`}>
              <UsersTable users={users.filter((user) => user.role === "VENDOR" || user.role === "ADMIN")} mode="vendors" />
            </Panel>
          </section>
        )}

        {currentTab === "products" && (
          <Panel title={`Catalog Control (${products.length})`}>
            <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Vendor</th><th>Category</th><th>Commercial</th><th>Moderation</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.title}</strong><small>{product.id.slice(0, 10)} | {product.productType}</small></td>
                    <td>{product.vendor.username}{product.vendor.isBanned && <small className="admin-danger-text">vendor banned</small>}</td>
                    <td>{product.category}<small>{product.subcategory}</small></td>
                    <td>{product.priceXMR.toFixed(5)} XMR<small>{product.quantity} stock | {product._count.orders} orders | {product._count.reviews} reviews</small></td>
                    <td>
                      <Badge tone={product.moderationStatus === "APPROVED" ? "green" : product.moderationStatus === "REJECTED" ? "red" : "amber"}>
                        {product.moderationStatus}
                      </Badge>
                      <small>{product.moderationNote || "No moderation note"}</small>
                    </td>
                    <td><Badge tone={product.isPaused ? "red" : product.isPromoted ? "amber" : "green"}>{product.isPaused ? "Paused" : product.isPromoted ? "Promoted" : "Active"}</Badge></td>
                    <td><ProductActions product={product} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Panel>
        )}

        {currentTab === "orders" && (
          <section className="admin-grid">
            {selectedOrder && <OrderDetailPanel detail={selectedOrder} />}
            <Panel title={`Transactions (${orders.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>Date</th><th>Order</th><th>Product</th><th>Buyer</th><th>Vendor</th><th>Status</th><th>Value</th><th>Actions</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.createdAt.toLocaleString()}</td>
                      <td><strong>{order.id.slice(0, 10)}</strong><small>{order.paymentType} | {order.paymentConfirmed ? "paid" : "unconfirmed"}</small></td>
                      <td>{order.product.title}<small>{order.product.productType}</small></td>
                      <td>{order.buyer.username}</td>
                      <td>{order.vendor.username}</td>
                      <td><Badge tone={order.status === "DISPUTE" ? "red" : order.status === "COMPLETED" ? "green" : "amber"}>{order.status}</Badge></td>
                      <td>{order.totalXMR.toFixed(5)} XMR<small>fee {order.marketFeeXMR.toFixed(5)}</small></td>
                      <td><a className="admin-link-button" href={`?tab=orders&orderId=${order.id}`}>View</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "wallets" && (
          <section className="admin-grid">
            <Panel title="Reconciliation Center">
              <section className="admin-metrics compact">
                <Metric label="Internal User Balances" value={`${reconciliation.userWalletTotalXMR.toFixed(5)} XMR`} />
                <Metric label="Platform Balance" value={`${reconciliation.platformBalanceXMR.toFixed(5)} XMR`} />
                <Metric label="Escrow Liability" value={`${reconciliation.escrowLiabilityXMR.toFixed(5)} XMR`} tone="amber" />
                <Metric label="Pending Withdrawals" value={`${reconciliation.pendingWithdrawalXMR.toFixed(5)} XMR`} tone="amber" />
                <Metric label="Available Treasury" value={`${reconciliation.availableTreasuryXMR.toFixed(5)} XMR`} tone={reconciliation.availableTreasuryXMR < 0 ? "red" : "green"} />
                <Metric label="Active Deposit Addresses" value={reconciliation.activeDepositWallets} />
              </section>
              <div className="admin-health-grid">
                <div>
                  <Badge tone={reconciliation.platformSolvent ? "green" : "red"}>{reconciliation.platformSolvent ? "Solvent" : "Mismatch"}</Badge>
                  <strong>Custody Check</strong>
                  <small>Internal platform balance must cover escrow and pending withdrawals.</small>
                </div>
                <div>
                  <Badge tone={reconciliation.activeDepositWallets > 0 ? "amber" : "green"}>{reconciliation.activeDepositWallets > 0 ? "Watching" : "Clear"}</Badge>
                  <strong>Deposit Scanner</strong>
                  <small>{reconciliation.activeDepositWallets} active deposit addresses waiting for confirmed transfers.</small>
                </div>
              </div>
            </Panel>
            <section className="admin-grid side">
              <Panel title="Wallet Debit Correction">
                <form className="admin-form" action={staffAdjustWalletAction}>
                  <p className="admin-form-note">
                    Positive credits are disabled in production. User balances are credited only from confirmed on-chain deposits.
                  </p>
                  <select name="userId" required>
                    <option value="">Select user</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.username} ({user.walletBalanceXMR.toFixed(5)} XMR)</option>)}
                  </select>
                  <input name="amountXMR" type="number" step="0.00001" max="-0.00001" required placeholder="Negative amount only, e.g. -0.10000" />
                  <textarea name="reason" rows={4} minLength={12} required placeholder="Audit reason and incident/reference ID" />
                  <button type="submit">Apply Debit Correction</button>
                </form>
              </Panel>
              <Panel title="Treasury">
                <section className="admin-metrics compact">
                  <Metric label="Balance" value={`${(platformWallet?.balanceXMR || 0).toFixed(5)} XMR`} />
                  <Metric label="Escrow" value={`${(platformWallet?.escrowTotal || 0).toFixed(5)} XMR`} />
                  <Metric label="Pending Withdrawals" value={pendingWithdrawals.length} tone="amber" />
                  <Metric label="Deposits Credited" value={processedPayments.length} tone="green" />
                </section>
              </Panel>
            </section>
            <Panel title={`Processed Deposits (${processedPayments.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>Date</th><th>User</th><th>Address</th><th>Amount</th><th>Confirmations</th><th>Tx</th><th>Status</th></tr></thead>
                <tbody>
                  {processedPayments.length === 0 && (
                    <tr><td colSpan={7} className="admin-empty">No processed wallet deposits yet.</td></tr>
                  )}
                  {processedPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{payment.createdAt.toLocaleString()}</td>
                      <td>{payment.user.username}<small>{payment.userId.slice(0, 10)}</small></td>
                      <td className="admin-truncate">{payment.address}</td>
                      <td>{payment.amountXMR.toFixed(5)} XMR</td>
                      <td>{payment.confirmations}</td>
                      <td className="admin-truncate">{payment.txHash}</td>
                      <td><Badge tone={payment.status === "CREDITED" ? "green" : "amber"}>{payment.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
            <Panel title={`Withdrawals (${withdrawals.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>User</th><th>Address</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {withdrawals.map((withdrawal) => (
                    <tr key={withdrawal.id}>
                      <td>{withdrawal.user.username}<small>{withdrawal.createdAt.toLocaleString()}</small></td>
                      <td className="admin-truncate">{withdrawal.address}</td>
                      <td>{withdrawal.amountXMR.toFixed(5)} XMR<small>No withdrawal fee</small></td>
                      <td><Badge tone={withdrawal.status === "COMPLETED" ? "green" : withdrawal.status === "REJECTED" ? "red" : "amber"}>{withdrawal.status}</Badge></td>
                      <td>{withdrawal.status === "AWAITING_APPROVAL" ? <WithdrawalActions id={withdrawal.id} /> : ["PROCESSING", "NEEDS_REVIEW"].includes(withdrawal.status) ? <ReconcileWithdrawal id={withdrawal.id} txHash={withdrawal.txHash} /> : withdrawal.txHash || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "flags" && (
          <section className="admin-grid side">
            <Panel title="Create Feature Flag">
              <form className="admin-form" action={staffUpsertFeatureFlagAction}>
                <input name="key" required placeholder="checkout.enabled" />
                <textarea name="description" rows={4} placeholder="Operational purpose and blast radius" />
                <label className="admin-check"><input type="checkbox" name="enabled" /> Enabled</label>
                <button type="submit">Save Flag</button>
              </form>
            </Panel>
            <Panel title={`Feature Flags (${featureFlags.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>Key</th><th>Description</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
                <tbody>
                  {featureFlags.length === 0 && <tr><td colSpan={5} className="admin-empty">No feature flags configured.</td></tr>}
                  {featureFlags.map((flag) => (
                    <tr key={flag.key}>
                      <td><strong>{flag.key}</strong></td>
                      <td>{flag.description || "-"}</td>
                      <td><Badge tone={flag.enabled ? "green" : "red"}>{flag.enabled ? "Enabled" : "Disabled"}</Badge></td>
                      <td>{flag.updatedAt.toLocaleString()}</td>
                      <td><FeatureFlagActions flag={flag} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "support" && (
          <Panel title={`Support Desk (${tickets.length})`}>
            {disputes.length > 0 && <DisputesPanel disputes={disputes} />}
            <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Ticket</th><th>Participants</th><th>Order</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td><strong>{ticket.subject}</strong><small>{ticket.updatedAt.toLocaleString()} | {ticket.category}</small></td>
                    <td>{ticket.user.username}<small>B {ticket.buyer?.username || "-"} | V {ticket.vendor?.username || "-"}</small></td>
                    <td>{ticket.order ? `${ticket.order.id.slice(0, 10)} (${ticket.order.status})` : "-"}</td>
                    <td>{ticket.priority}</td>
                    <td><Badge tone={ticket.status === "CLOSED" ? "green" : ticket.status === "OPEN" ? "red" : "amber"}>{ticket.status}</Badge></td>
                    <td><TicketActions ticket={ticket} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Panel>
        )}

        {currentTab === "categories" && (
          <section className="admin-grid side">
            <Panel title="Create Category">
              <form className="admin-form" action={staffCreateCategoryAction}>
                <input name="label" required placeholder="Category name" />
                <input name="icon" placeholder="[+]" defaultValue="[+]" />
                <textarea name="subcategories" rows={5} required placeholder="Subcategory A, Subcategory B, Other" />
                <button type="submit">Save Category</button>
              </form>
            </Panel>
            <Panel title="Category Registry">
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>Source</th><th>Category</th><th>Subcategories</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {builtInCategoriesForAdmin.map((category) => (
                    <tr key={category.id}>
                      <td>CODE</td>
                      <td>{category.label}</td>
                      <td>{category.subcategories.join(", ")}</td>
                      <td><Badge tone="green">Active</Badge></td>
                      <td><BuiltInCategoryActions category={category} /></td>
                    </tr>
                  ))}
                  {customCategories.map((category) => (
                    <tr key={category.id}>
                      <td>ADMIN</td>
                      <td>{category.label}</td>
                      <td>{category.subcategories.join(", ")}</td>
                      <td><Badge tone={category.isActive ? "green" : "red"}>{category.isActive ? "Active" : "Disabled"}</Badge></td>
                      <td><CategoryActions category={category} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "logs" && (
          <section className="admin-grid">
          <Panel title={`Security Events (${securityEvents.length})`}>
            <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Date</th><th>Category</th><th>Outcome</th><th>User</th><th>Opaque subject</th><th>Details</th></tr></thead>
              <tbody>
                {securityEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.createdAt.toLocaleString()}</td>
                    <td>{event.category}</td>
                    <td><span className={event.outcome === "SUCCESS" ? "success" : "danger"}>{event.outcome}</span></td>
                    <td>{event.userId || "anonymous"}</td>
                    <td>{event.subjectHash ? `${event.subjectHash.slice(0, 12)}…` : "-"}</td>
                    <td>{event.details || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Panel>
          <Panel title={`Operator Actions (${adminLogs.length})`}>
            <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Date</th><th>Operator</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {adminLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt.toLocaleString()}</td>
                    <td>{log.actorName || log.actorId || "system"}</td>
                    <td>{log.action}</td>
                    <td>{log.target}<small>{log.targetId || "-"}</small></td>
                    <td>{log.details || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Panel>
          <Panel title={`Financial Audit Trail (${logs.length})`}>
            <TableScroll>
            <table className="admin-table">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>User</th><th>Order</th><th>Tx</th><th>Details</th></tr></thead>
              <tbody>
                {logs.map((log) => <tr key={log.id}><td>{log.createdAt.toLocaleString()}</td><td>{log.type}</td><td>{log.amountXMR.toFixed(5)}</td><td>{log.userId || "-"}</td><td>{log.orderId || "-"}</td><td>{log.txHash || "-"}</td><td>{log.details || "-"}</td></tr>)}
              </tbody>
            </table>
            </TableScroll>
          </Panel>
          </section>
        )}

        {currentTab === "mirrors" && (
          <section className="admin-grid side">
            <Panel title="Add Gateway">
              <form className="admin-form" action={manageMirrorsAction}>
                <input type="hidden" name="action" value="ADD" />
                <input type="text" name="url" placeholder="https://example.internal" required />
                <label className="admin-check"><input type="checkbox" name="isPrimary" /> Primary gateway</label>
                <button type="submit">Add Gateway</button>
              </form>
            </Panel>
            <Panel title={`Infrastructure (${mirrors.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>URL</th><th>Status</th><th>Primary</th><th>Action</th></tr></thead>
                <tbody>
                  {mirrors.map((mirror) => (
                    <tr key={mirror.id}><td>{mirror.url}</td><td>{mirror.status}</td><td>{mirror.isPrimary ? "YES" : "NO"}</td><td><DeleteMirror id={mirror.id} /></td></tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "broadcast" && (
          <section className="admin-grid">
            <section className="admin-grid two">
            <Panel title="Public Announcement">
              <form className="admin-form" action={staffCreateAnnouncementAction}>
                <input type="text" name="title" placeholder="Protocol update" required />
                <textarea name="content" placeholder="Public announcement content" rows={6} required />
                <textarea name="signature" placeholder="Signature or approval reference" rows={4} required />
                <select name="expiresInDays" defaultValue="0">
                  <option value="0">Never expires</option>
                  <option value="1">Expire in 1 day</option>
                  <option value="3">Expire in 3 days</option>
                  <option value="7">Expire in 7 days</option>
                  <option value="15">Expire in 15 days</option>
                  <option value="30">Expire in 30 days</option>
                </select>
                <button type="submit">Publish</button>
              </form>
            </Panel>
            <Panel title="User Broadcast">
              <form className="admin-form" action={staffBroadcastNotificationAction}>
                <input type="text" name="title" placeholder="Alert title" required />
                <textarea name="content" placeholder="Message to every user" rows={6} required />
                <button type="submit">Send Broadcast</button>
              </form>
            </Panel>
            </section>
            <Panel title={`Announcement Control (${announcements.length})`}>
              <TableScroll>
              <table className="admin-table">
                <thead><tr><th>Title</th><th>Status</th><th>Expires</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                  {announcements.length === 0 && <tr><td colSpan={5} className="admin-empty">No announcements yet.</td></tr>}
                  {announcements.map((announcement) => (
                    <tr key={announcement.id}>
                      <td><strong>{announcement.title}</strong><small>{announcement.content.slice(0, 140)}</small></td>
                      <td><Badge tone={isAnnouncementVisible(announcement) ? "green" : "red"}>{isAnnouncementVisible(announcement) ? "Visible" : "Hidden"}</Badge></td>
                      <td>{announcement.expiresAt ? announcement.expiresAt.toLocaleString() : "Never"}</td>
                      <td>{announcement.createdAt.toLocaleString()}</td>
                      <td><AnnouncementActions announcement={announcement} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            </Panel>
          </section>
        )}

        {currentTab === "system" && (
          <section className="admin-grid two">
            <Panel title="System Mode">
              <div className="admin-system-card">
                <Badge tone={config?.isMaintenanceMode ? "red" : "green"}>{config?.isMaintenanceMode ? "Maintenance Active" : "Operational"}</Badge>
                <p>Maintenance blocks new high-risk operations while keeping the console reachable.</p>
                <form action={staffToggleMaintenanceAction}>
                  <button type="submit">{config?.isMaintenanceMode ? "Deactivate Maintenance" : "Activate Maintenance"}</button>
                </form>
              </div>
            </Panel>
            <Panel title="Configuration">
              <dl className="admin-definition">
                <dt>Commission</dt><dd>{((config?.globalCommission || 0) * 100).toFixed(2)}%</dd>
                <dt>Minimum withdrawal</dt><dd>{(config?.minWithdrawalXMR || 0).toFixed(5)} XMR</dd>
                <dt>Platform wallet</dt><dd>{platformWallet?.id || "not initialized"}</dd>
              </dl>
            </Panel>
          </section>
        )}
      </main>
    </div>
  );
}
