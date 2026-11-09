import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { MARKET_CATEGORIES } from "./constants";

export interface ProductSearchParams {
  q?: string;
  category?: string;
  subcategory?: string;
  type?: string;
  min?: string;
  max?: string;
  sort?: string;
  page?: string;
  pageSize?: number;
  viewerId?: string | null;
}

type ListingProduct = {
  id: string;
  title: string;
  description: string;
  priceXMR: Prisma.Decimal;
  imageUrl: string | null;
  category: string;
  subcategory: string;
  productType: string;
  isAutoshop: boolean;
  requiresFE: boolean;
  isPromoted: boolean;
  promotedUntil: Date | null;
  originShipsFrom: string;
  vendor: { id: string; username: string; trustScore: number; level: number };
  sponsored?: boolean;
};

export function buildProductWhere(params: ProductSearchParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    quantity: { gt: 0 },
    isPaused: false,
    moderationStatus: "APPROVED",
    vendor: {
      isBanned: false,
      isVacationMode: false,
    },
  };

  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { fullDescription: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
      { vendor: { username: { contains: q, mode: "insensitive" } } },
    ];
  }

  if (params.category) {
    const parentCat = MARKET_CATEGORIES.find((category) => category.label === params.category);
    where.category = parentCat
      ? { in: [parentCat.label, ...parentCat.subcategories] }
      : params.category;
  }

  if (params.subcategory) {
    where.subcategory = params.subcategory;
  }

  if (params.type === "PHYSICAL" || params.type === "DIGITAL") {
    where.productType = params.type;
  }

  const min = Number(params.min);
  const max = Number(params.max);
  if (!Number.isNaN(min) || !Number.isNaN(max)) {
    where.priceXMR = {
      ...(Number.isNaN(min) ? {} : { gte: min }),
      ...(Number.isNaN(max) ? {} : { lte: max }),
    };
  }

  return where;
}

export function productOrderBy(sort?: string): Prisma.ProductOrderByWithRelationInput[] {
  if (sort === "price_asc") return [{ priceXMR: "asc" }, { createdAt: "desc" }];
  if (sort === "price_desc") return [{ priceXMR: "desc" }, { createdAt: "desc" }];
  if (sort === "trust") return [{ vendor: { trustScore: "desc" } }, { createdAt: "desc" }];
  if (sort === "new") return [{ createdAt: "desc" }];
  return [{ isPromoted: "desc" }, { createdAt: "desc" }];
}

export async function searchProducts(params: ProductSearchParams) {
  const currentPage = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const pageSize = 12;
  const where = buildProductWhere(params);
  const now = new Date();

  const organicWhere: Prisma.ProductWhereInput = {
    ...where,
    OR: [
      { isPromoted: false },
      { promotedUntil: null },
      { promotedUntil: { lte: now } },
    ],
  };

  const promotedCandidates = await prisma.product.findMany({
    where: {
      ...where,
      isPromoted: true,
      promotedUntil: { gt: now },
    },
    select: productListingSelect,
    orderBy: [{ promotedUntil: "asc" }, { createdAt: "desc" }],
    take: 72,
  });

  const pickSponsored = (page: number) => rotatePromotedProducts(
      promotedCandidates,
      params.viewerId,
      `${params.category || "all"}:${params.subcategory || "all"}:${page}`,
      Math.min(6, pageSize)
    );

  let sponsoredProducts = pickSponsored(currentPage);
  let organicPageSize = Math.max(1, pageSize - sponsoredProducts.length);
  const totalProductsCount = await prisma.product.count({ where: organicWhere });
  const totalPages = Math.max(1, Math.ceil(totalProductsCount / organicPageSize));
  const safePage = Math.min(currentPage, totalPages);

  if (safePage !== currentPage) {
    sponsoredProducts = pickSponsored(safePage);
    organicPageSize = Math.max(1, pageSize - sponsoredProducts.length);
  }

  const products = await prisma.product.findMany({
    where: organicWhere,
    select: productListingSelect,
    orderBy: productOrderBy(params.sort),
    skip: (safePage - 1) * organicPageSize,
    take: organicPageSize,
  });

  const sponsoredIds = new Set(sponsoredProducts.map((product) => product.id));
  const mergedProducts = [
    ...sponsoredProducts.map((product) => ({ ...product, sponsored: true })),
    ...products.filter((product) => !sponsoredIds.has(product.id)),
  ];

  return { products: mergedProducts, totalProductsCount, totalPages, safePage };
}

export async function getPromotedProductRecommendations(input: {
  currentProductId: string;
  category: string;
  subcategory: string;
  tags?: string | null;
  viewerId?: string | null;
  take?: number;
}) {
  const take = input.take || 6;
  const now = new Date();
  const tags = input.tags
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean) ?? [];

  const tagMatches = tags.map((tag) => ({ tags: { contains: tag, mode: "insensitive" as const } }));

  const candidates = await prisma.product.findMany({
    where: {
      id: { not: input.currentProductId },
      quantity: { gt: 0 },
      isPaused: false,
      moderationStatus: "APPROVED",
      isPromoted: true,
      promotedUntil: { gt: now },
      vendor: { isBanned: false, isVacationMode: false },
      OR: [
        { subcategory: input.subcategory },
        { category: input.category },
        ...tagMatches,
      ],
    },
    select: productListingSelect,
    orderBy: [{ promotedUntil: "asc" }, { createdAt: "desc" }],
    take: 72,
  });

  const related = rotatePromotedProducts(
    candidates,
    input.viewerId,
    `${input.currentProductId}:${input.category}:${input.subcategory}`,
    take
  );

  if (related.length >= take) {
    return related.map((product) => ({ ...product, sponsored: true }));
  }

  const promotedFallback = await prisma.product.findMany({
    where: {
      id: {
        notIn: [input.currentProductId, ...related.map((product) => product.id)],
      },
      quantity: { gt: 0 },
      isPaused: false,
      moderationStatus: "APPROVED",
      isPromoted: true,
      promotedUntil: { gt: now },
      vendor: { isBanned: false, isVacationMode: false },
    },
    select: productListingSelect,
    orderBy: [{ promotedUntil: "asc" }, { createdAt: "desc" }],
    take: 72,
  });

  const rotatedPromotedFallback = rotateProductsByVendor(
    promotedFallback,
    input.viewerId,
    `${input.currentProductId}:promoted-fallback`,
    take - related.length
  );

  const promotedResults = [...related, ...rotatedPromotedFallback];
  if (promotedResults.length >= take) {
    return promotedResults.map((product) => ({ ...product, sponsored: true }));
  }

  const standardRelated = await prisma.product.findMany({
    where: {
      id: {
        notIn: [input.currentProductId, ...promotedResults.map((product) => product.id)],
      },
      quantity: { gt: 0 },
      isPaused: false,
      moderationStatus: "APPROVED",
      vendor: { isBanned: false, isVacationMode: false },
      OR: [
        { subcategory: input.subcategory },
        { category: input.category },
        ...tagMatches,
      ],
    },
    select: productListingSelect,
    orderBy: [{ createdAt: "desc" }],
    take: 72,
  });

  const rotatedStandardRelated = rotateProductsByVendor(
    standardRelated,
    input.viewerId,
    `${input.currentProductId}:standard-related`,
    take - promotedResults.length
  );
  const withStandardRelated = [...promotedResults, ...rotatedStandardRelated];
  if (withStandardRelated.length >= take) {
    return withStandardRelated.map((product) => ({
      ...product,
      sponsored: promotedResults.some((promoted) => promoted.id === product.id),
    }));
  }

  const standardFallback = await prisma.product.findMany({
    where: {
      id: {
        notIn: [input.currentProductId, ...withStandardRelated.map((product) => product.id)],
      },
      quantity: { gt: 0 },
      isPaused: false,
      moderationStatus: "APPROVED",
      vendor: { isBanned: false, isVacationMode: false },
    },
    select: productListingSelect,
    orderBy: [{ createdAt: "desc" }],
    take: 72,
  });

  const rotatedStandardFallback = rotateProductsByVendor(
    standardFallback,
    input.viewerId,
    `${input.currentProductId}:standard-fallback`,
    take - withStandardRelated.length
  );

  const result = [...withStandardRelated, ...rotatedStandardFallback];
  return result.map((product) => ({
    ...product,
    sponsored: promotedResults.some((promoted) => promoted.id === product.id),
  }));
}

const productListingSelect = {
  id: true,
  title: true,
  description: true,
  priceXMR: true,
  imageUrl: true,
  category: true,
  subcategory: true,
  productType: true,
  isAutoshop: true,
  requiresFE: true,
  isPromoted: true,
  promotedUntil: true,
  originShipsFrom: true,
  vendor: { select: { id: true, username: true, trustScore: true, level: true } },
} satisfies Prisma.ProductSelect;

function rotatePromotedProducts(
  products: ListingProduct[],
  viewerId: string | null | undefined,
  context: string,
  take: number
) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = stableHash(`${viewerId || "guest"}:${context}:${today}`);
  const byVendor = new Map<string, ListingProduct[]>();

  for (const product of products) {
    const vendorId = product.vendor.id;
    byVendor.set(vendorId, [...(byVendor.get(vendorId) || []), product]);
  }

  const vendors = Array.from(byVendor.keys()).sort((a, b) => {
    return stableHash(`${seed}:${a}`) - stableHash(`${seed}:${b}`);
  });
  const selected: ListingProduct[] = [];
  let round = 0;

  while (selected.length < take && vendors.length > 0) {
    let addedThisRound = false;
    for (const vendorId of vendors) {
      const product = byVendor.get(vendorId)?.[round];
      if (product && !selected.some((item) => item.id === product.id)) {
        selected.push(product);
        addedThisRound = true;
        if (selected.length >= take) break;
      }
    }
    if (!addedThisRound) break;
    round++;
  }

  return selected;
}

function rotateProductsByVendor(
  products: ListingProduct[],
  viewerId: string | null | undefined,
  context: string,
  take: number
) {
  return rotatePromotedProducts(products, viewerId, context, take);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function upsertProductSearchDocument(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { vendor: { select: { username: true, trustScore: true } } },
  });
  if (!product) return;

  await prisma.searchDocument.upsert({
    where: { productId },
    update: {
      title: product.title,
      body: [product.description, product.fullDescription].filter(Boolean).join("\n"),
      category: product.category,
      subcategory: product.subcategory,
      tags: product.tags || null,
      vendorName: product.vendor.username,
      isActive: !product.isPaused && product.quantity > 0,
      score: product.vendor.trustScore + (product.isPromoted ? 10 : 0),
    },
    create: {
      productId,
      title: product.title,
      body: [product.description, product.fullDescription].filter(Boolean).join("\n"),
      category: product.category,
      subcategory: product.subcategory,
      tags: product.tags || null,
      vendorName: product.vendor.username,
      isActive: !product.isPaused && product.quantity > 0,
      score: product.vendor.trustScore + (product.isPromoted ? 10 : 0),
    },
  });
}
