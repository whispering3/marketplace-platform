"use server";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { publishEvent, recordBehavior } from "@/lib/events";

/**
 * TOGGLE FAVORITE ACTION
 * Standard HTML Form compatible.
 */
export async function toggleFavoriteAction(formData: FormData) {
  const session = await verifyAuth();
  const productId = formData.get("productId")?.toString();

  if (!productId) return;

  const existing = await prisma.favorite.findUnique({
    where: {
      userId_productId: {
        userId: session.userId as string,
        productId: productId
      }
    }
  });

  if (existing) {
    await prisma.favorite.delete({
      where: { id: existing.id }
    });
  } else {
    await prisma.favorite.create({
      data: {
        userId: session.userId as string,
        productId: productId
      }
    });
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { category: true },
    });
    await recordBehavior({
      userId: session.userId as string,
      productId,
      category: product?.category,
      action: "FAVORITE",
      weight: 3,
    });
  }

  await publishEvent({
    type: existing ? "favorite.removed" : "favorite.created",
    aggregate: "product",
    aggregateId: productId,
    actorId: session.userId as string,
  });

  revalidatePath(`/market/product/${productId}`);
  revalidatePath(`/market/dashboard/buyer`);
}
