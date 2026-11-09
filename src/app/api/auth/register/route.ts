import { registerUserFromForm } from "@/lib/auth-flow";
import { authRedirectResponse, rejectUnsafeAuthRequest } from "@/lib/auth-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = await rejectUnsafeAuthRequest(request);
  if (rejected) return rejected;
  return authRedirectResponse(request, await registerUserFromForm(await request.formData()));
}
