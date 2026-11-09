import { NextResponse } from "next/server";

/** Keep form redirects on the originating mirror, independent of the internal proxy host. */
export function localRedirect(path: string, status: 303 | 307 = 303) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) throw new Error("InvalidLocalRedirect");
  return new NextResponse(null, { status, headers: { Location: path, "Cache-Control": "no-store" } });
}
