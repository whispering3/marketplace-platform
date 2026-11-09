import "dotenv/config";
import crypto from "crypto";
import { prisma } from "../src/lib/db";
import { hashPin } from "../src/lib/pin";
import { assertDemoSeedAllowed } from "./lib/demo-seed-guard";

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 600000, 64, "sha512").toString("hex");
}

async function upsertUser(input: {
  username: string;
  password: string;
  pin: string;
  role: "BUYER" | "VENDOR" | "ADMIN";
  walletBalanceXMR: number;
  staffId?: string;
}) {
  const salt = crypto.randomBytes(32).toString("hex");
  return prisma.user.upsert({
    where: { username: input.username },
    update: {
      passwordHash: hashPassword(input.password, salt),
      passwordSalt: salt,
      pin: hashPin(input.pin),
      role: input.role,
      hasPaidBond: input.role === "VENDOR" || input.role === "ADMIN",
      staffId: input.staffId,
      isBanned: false,
      isPhraseViewed: true,
      walletBalanceXMR: input.walletBalanceXMR,
    },
    create: {
      username: input.username,
      passwordHash: hashPassword(input.password, salt),
      passwordSalt: salt,
      pin: hashPin(input.pin),
      role: input.role,
      hasPaidBond: input.role === "VENDOR" || input.role === "ADMIN",
      staffId: input.staffId,
      isBanned: false,
      isPhraseViewed: true,
      walletBalanceXMR: input.walletBalanceXMR,
      antiPhishingPhrase: input.role === "ADMIN" ? "Admin Red Meridian" : input.role === "VENDOR" ? "Vendor Amber Signal" : "Buyer Blue Harbor",
      trustScore: input.role === "ADMIN" ? 100 : input.role === "VENDOR" ? 95 : 10,
      level: input.role === "ADMIN" ? 10 : input.role === "VENDOR" ? 5 : 1,
    },
  });
}

async function main() {
  assertDemoSeedAllowed(process.env);
  const buyer = await upsertUser({
    username: "demo_buyer",
    password: "DemoBuyer#2026!",
    pin: "123456",
    role: "BUYER",
    walletBalanceXMR: 10,
  });

  const vendor = await upsertUser({
    username: "demo_vendor",
    password: "DemoVendor#2026!",
    pin: "654321",
    role: "VENDOR",
    walletBalanceXMR: 25,
  });

  const admin = await upsertUser({
    username: "demo_admin",
    password: "DemoAdmin#2026!",
    pin: "112233",
    role: "ADMIN",
    walletBalanceXMR: 0,
    staffId: "STAFF-DEV-01",
  });

  const products = [
    {
      title: "Encrypted Storage Starter Kit",
      description: "A practical bundle for private backups and secure file organization.",
      fullDescription: "Includes setup notes, recommended folder structure, and recovery checklist for lawful personal or business records.",
      priceXMR: 0.15,
      quantity: 12,
      category: "Privacy & Security",
      subcategory: "Encrypted Storage",
      productType: "DIGITAL",
      isAutoshop: true,
      digitalPayload: "Download instructions will appear in your order dashboard.",
      isPromoted: true,
      promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      title: "PGP Workflow Checklist",
      description: "A compact operational checklist for safer encrypted communications.",
      fullDescription: "Includes buyer/vendor message templates, verification steps, and incident response notes for lawful private commerce.",
      priceXMR: 0.05,
      quantity: 20,
      category: "Privacy & Security",
      subcategory: "Training",
      productType: "DIGITAL",
      isAutoshop: true,
      digitalPayload: "Checklist download instructions will appear in your order dashboard.",
      isPromoted: true,
      promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      title: "Secure Backup Recovery Guide",
      description: "Step-by-step backup recovery playbook for small teams.",
      fullDescription: "A concise digital guide covering encrypted backups, key custody, recovery drills, and operational documentation.",
      priceXMR: 0.07,
      quantity: 18,
      category: "Privacy & Security",
      subcategory: "Encrypted Storage",
      productType: "DIGITAL",
      isAutoshop: true,
      digitalPayload: "Guide download instructions will appear in your order dashboard.",
      isPromoted: true,
      promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      title: "Compliance Desk Template Pack",
      description: "Templates for internal policies, intake forms, and review checklists.",
      fullDescription: "Editable templates for lawful marketplace operations, vendor onboarding, and product review workflows.",
      priceXMR: 0.09,
      quantity: 15,
      category: "Business Supplies",
      subcategory: "Compliance",
      productType: "DIGITAL",
      isAutoshop: true,
      digitalPayload: "Template download instructions will appear in your order dashboard.",
      isPromoted: true,
      promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      title: "Operations Incident Notebook",
      description: "Structured notebook for tracking operational incidents and resolutions.",
      fullDescription: "Physical notebook with incident pages, review prompts, and space for follow-up actions.",
      priceXMR: 0.11,
      quantity: 24,
      category: "Business Supplies",
      subcategory: "Operations",
      productType: "PHYSICAL",
      isPromoted: true,
      promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      title: "Independent Brand Field Notebook",
      description: "Durable pocket notebook for inventory, field work, and daily operations.",
      fullDescription: "A compact physical notebook with numbered pages and water-resistant cover.",
      priceXMR: 0.08,
      quantity: 30,
      category: "Business Supplies",
      subcategory: "Stationery",
      productType: "PHYSICAL",
      isPromoted: false,
      promotedUntil: null,
    },
  ];

  for (const product of products) {
    const saved = await prisma.product.upsert({
      where: { id: `demo-${product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` },
      update: {
        ...product,
        vendorId: vendor.id,
        isPaused: false,
      },
      create: {
        id: `demo-${product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        ...product,
        vendorId: vendor.id,
        originShipsFrom: "Brazil",
        shipsTo: "Worldwide",
        tags: "privacy,business,legal",
      },
    });
    await prisma.searchDocument.upsert({
      where: { productId: saved.id },
      update: {
        title: saved.title,
        body: [saved.description, saved.fullDescription].filter(Boolean).join("\n"),
        category: saved.category,
        subcategory: saved.subcategory,
        tags: saved.tags,
        vendorName: vendor.username,
        isActive: !saved.isPaused && saved.quantity > 0,
        score: vendor.trustScore + (saved.isPromoted ? 10 : 0),
      },
      create: {
        productId: saved.id,
        title: saved.title,
        body: [saved.description, saved.fullDescription].filter(Boolean).join("\n"),
        category: saved.category,
        subcategory: saved.subcategory,
        tags: saved.tags,
        vendorName: vendor.username,
        isActive: !saved.isPaused && saved.quantity > 0,
        score: vendor.trustScore + (saved.isPromoted ? 10 : 0),
      },
    });
  }

  await prisma.order.upsert({
    where: { id: "demo-order-shared-support" },
    update: {
      buyerId: buyer.id,
      vendorId: vendor.id,
      productId: "demo-encrypted-storage-starter-kit",
      status: "PENDING",
      totalXMR: 0.15,
      marketFeeXMR: 0.015,
      paymentConfirmed: true,
    },
    create: {
      id: "demo-order-shared-support",
      buyerId: buyer.id,
      vendorId: vendor.id,
      productId: "demo-encrypted-storage-starter-kit",
      status: "PENDING",
      totalXMR: 0.15,
      marketFeeXMR: 0.015,
      paymentConfirmed: true,
    },
  });

  await prisma.order.upsert({
    where: { id: "demo-order-digital-delivery" },
    update: {
      buyerId: buyer.id,
      vendorId: vendor.id,
      productId: "demo-pgp-workflow-checklist",
      status: "COMPLETED",
      totalXMR: 0.05,
      marketFeeXMR: 0.005,
      paymentConfirmed: true,
      digitalPayloadReceived: "Digital delivery:\n- Access: /vault/demo-pgp-workflow-checklist\n- Receipt code: DEMO-PGP-CHECKLIST-2026\n- Verify the checksum before using the file.",
      reviewDone: false,
    },
    create: {
      id: "demo-order-digital-delivery",
      buyerId: buyer.id,
      vendorId: vendor.id,
      productId: "demo-pgp-workflow-checklist",
      status: "COMPLETED",
      totalXMR: 0.05,
      marketFeeXMR: 0.005,
      paymentConfirmed: true,
      digitalPayloadReceived: "Digital delivery:\n- Access: /vault/demo-pgp-workflow-checklist\n- Receipt code: DEMO-PGP-CHECKLIST-2026\n- Verify the checksum before using the file.",
      reviewDone: false,
    },
  });

  console.log("Demo users ready:");
  console.log("buyer demo_buyer / DemoBuyer#2026! / PIN 123456");
  console.log("vendor demo_vendor / DemoVendor#2026! / PIN 654321");
  console.log("admin demo_admin / DemoAdmin#2026! / PIN 112233 / MSID STAFF-DEV-01");
  console.log("demo order ready: demo-order-shared-support");
  console.log("demo digital order ready: demo-order-digital-delivery");
  console.log(`buyerId=${buyer.id}`);
  console.log(`vendorId=${vendor.id}`);
  console.log(`adminId=${admin.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
