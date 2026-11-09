import { enrollPgpFromForm } from "@/lib/auth-flow";
import { authRedirectResponse, pendingAuthFromRequest, rejectUnsafeAuthRequest } from "@/lib/auth-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = await rejectUnsafeAuthRequest(request);
  if (rejected) return rejected;
  return authRedirectResponse(request, await enrollPgpFromForm(await request.formData(), await pendingAuthFromRequest(request)));
}
