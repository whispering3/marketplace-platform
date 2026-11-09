import { localRedirect } from "@/lib/local-redirect";
import { rejectUnsafeMutation } from "@/lib/request-security";
import { revokeCurrentSession } from "@/lib/session";

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request, 4096);
  if (rejected) return rejected;
  await revokeCurrentSession();
  return localRedirect("/auth/login");
}
