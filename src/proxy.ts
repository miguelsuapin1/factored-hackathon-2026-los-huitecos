// Every page and API except the sign-in page and the login endpoint requires a valid demo session.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Your session expired or you're not signed in." }, { status: 401 });
  }
  const signIn = new URL("/", request.url);
  signIn.searchParams.set("next", pathname + search);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except: the sign-in page itself, the login endpoint, Next.js assets and icons.
  matcher: ["/((?!$|api/login|_next/static|_next/image|favicon.ico|icon|apple-icon).+)"],
};
