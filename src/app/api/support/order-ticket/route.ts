
import { localRedirect } from "@/lib/local-redirect";
import { verifyAuth } from "@/lib/session";
import { openOrderSupportTicketForSession } from "@/lib/order-support";
import { rejectUnsafeMutation } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  const session = await verifyAuth();
  const result = await openOrderSupportTicketForSession(session, await request.formData());
  return localRedirect(result.redirectTo);
}
