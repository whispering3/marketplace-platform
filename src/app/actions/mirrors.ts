"use server";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import crypto from "crypto";

export async function generatePrivateMirrorAction() {
  const session = await verifyAuth();

  const user = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: { level: true, id: true }
  });

  if (!user || user.level < 5) return { error: "Insufficient Level (Required: 5)" };

  const tokenBytes = crypto.randomBytes(12).toString("hex");
  const personalToken = `sovereign-${tokenBytes}-${user.id.slice(-4)}`;
  const domainBytes = crypto.randomBytes(4).toString("hex");
  const domain = `olympus-${domainBytes}.onion`;

  await prisma.privateMirror.create({
    data: {
      userId: user.id,
      token: personalToken,
      domain: domain
    }
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { personalMirrorToken: personalToken }
  });

  revalidatePath("/market/dashboard/buyer");
  revalidatePath("/market/dashboard/vendor");
  return { success: true };
}
