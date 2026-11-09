import "server-only";
import { prisma } from "./db";
import { MARKET_CATEGORIES } from "./constants";

export async function getRecommendedProducts(userId: string | undefined | null, take = 4) {
  if (!userId) {
    return prisma.product.findMany({
      where: { quantity: { gt: 0 }, isPaused: false, moderationStatus: "APPROVED", vendor: { isBanned: false, isVacationMode: false } },
      select: { id: true, title: true, priceXMR: true, category: true, vendor: { select: { username: true } } },
      orderBy: [{ isPromoted: "desc" }, { createdAt: "desc" }],
      take,
    });
  }

  const signals = await prisma.userBehaviorEvent.groupBy({
    by: ["category"],
    where: { userId, category: { not: null } },
    _sum: { weight: true },
    orderBy: { _sum: { weight: "desc" } },
    take: 3,
  });

  const categories = signals
    .map((signal) => signal.category)
    .filter((category): category is string => !!category);

  const categorySet = new Set<string>();
  for (const category of categories) {
    categorySet.add(category);
    const parent = MARKET_CATEGORIES.find((item) => item.label === category || item.subcategories.includes(category));
    if (parent) {
      categorySet.add(parent.label);
      parent.subcategories.forEach((subcategory) => categorySet.add(subcategory));
    }
  }

  const baseWhere = {
    quantity: { gt: 0 },
    isPaused: false,
    moderationStatus: "APPROVED",
    vendor: { isBanned: false, isVacationMode: false },
  };

  const recommended = categorySet.size
    ? await prisma.product.findMany({
        where: { ...baseWhere, category: { in: Array.from(categorySet) } },
        select: { id: true, title: true, priceXMR: true, category: true, vendor: { select: { username: true } } },
        orderBy: [{ isPromoted: "desc" }, { createdAt: "desc" }],
        take,
      })
    : [];

  if (recommended.length >= take) return recommended;

  const fallback = await prisma.product.findMany({
    where: {
      ...baseWhere,
      id: { notIn: recommended.map((product) => product.id) },
    },
    select: { id: true, title: true, priceXMR: true, category: true, vendor: { select: { username: true } } },
    orderBy: [{ isPromoted: "desc" }, { createdAt: "desc" }],
    take: take - recommended.length,
  });

  return [...recommended, ...fallback];
}
