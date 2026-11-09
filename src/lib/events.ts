import "server-only";
import { prisma } from "./db";

type EventPayload = Record<string, string | number | boolean | null | undefined>;

export async function publishEvent(input: {
  type: string;
  aggregate: string;
  aggregateId: string;
  actorId?: string | null;
  payload?: EventPayload;
}) {
  try {
    await prisma.appEvent.create({
      data: {
        type: input.type,
        aggregate: input.aggregate,
        aggregateId: input.aggregateId,
        actorId: input.actorId || null,
        payload: input.payload || undefined,
      },
    });
  } catch (error) {
    console.error("[EVENT_OUTBOX_WRITE_FAILED]", input.type, error);
  }
}

export async function recordBehavior(input: {
  userId?: string | null;
  productId?: string | null;
  category?: string | null;
  action: "VIEW" | "SEARCH" | "FAVORITE" | "ORDER" | "REVIEW";
  weight?: number;
}) {
  if (!input.userId) return;

  try {
    await prisma.userBehaviorEvent.create({
      data: {
        userId: input.userId,
        productId: input.productId || null,
        category: input.category || null,
        action: input.action,
        weight: input.weight ?? 1,
      },
    });
  } catch (error) {
    console.error("[BEHAVIOR_EVENT_WRITE_FAILED]", input.action, error);
  }
}
