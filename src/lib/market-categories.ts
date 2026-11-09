import "server-only";

import { prisma } from "@/lib/db";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/constants";

export async function getMarketCategories(): Promise<MarketCategory[]> {
  const customCategories = await prisma.marketCategory.findMany({
    orderBy: { label: "asc" },
  });

  const categories = new Map<string, MarketCategory>();
  for (const category of MARKET_CATEGORIES) {
    categories.set(category.label, category);
  }

  for (const category of customCategories) {
    if (!category.isActive) {
      categories.delete(category.label);
      continue;
    }

    categories.set(category.label, {
      id: category.id,
      label: category.label,
      icon: category.icon,
      subcategories: category.subcategories.length > 0 ? category.subcategories : ["Other"],
    });
  }

  return [...categories.values()];
}
