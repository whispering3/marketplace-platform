import "server-only";

import { prisma } from "./db";
import { blindRateLimitSubject } from "./rate-limit";

type SecurityEventInput = {
  category: string;
  outcome: "SUCCESS" | "FAILURE" | "BLOCKED";
  userId?: string | null;
  subject?: string | null;
  details?: string | null;
};

export async function recordSecurityEvent(input: SecurityEventInput) {
  try {
    await prisma.securityEvent.create({
      data: {
        category: input.category.slice(0, 64),
        outcome: input.outcome,
        userId: input.userId || null,
        subjectHash: input.subject ? blindRateLimitSubject(input.subject) : null,
        details: input.details?.slice(0, 256) || null,
      },
    });
  } catch (error) {
    console.error("SecurityEventWriteFailed", error instanceof Error ? error.name : "UnknownError");
  }
}
