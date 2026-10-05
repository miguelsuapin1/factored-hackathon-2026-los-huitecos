// Every page and API requires a signed-in session, except the two sign-in pages and their login endpoints.
// Customer pages/APIs need a customer session (gt_session); the agent console (/agent, /api/agent/*) needs an agent
// session (gt_agent, step 20, D-007). The two cookies can't stand in for each other (src/lib/auth/session.ts).
import { NextResponse, type NextRequest } from "next/server";
import { AGENT_COOKIE, SESSION_COOKIE, verifyAgentSession, verifySession } from "@/lib/auth/session";

const AGENT_PUBLIC = new Set(["/agent/login", "/api/agent/login"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const agentArea = pathname === "/agent" || pathname.startsWith("/agent/") || pathname.startsWith("/api/agent/");

  if (agentArea) {
    if (AGENT_PUBLIC.has(pathname)) return NextResponse.next();
    const agent = await verifyAgentSession(request.cookies.get(AGENT_COOKIE)?.value).catch(() => null);
    if (agent) return NextResponse.next();
    if (isApi) return Response.json({ error: "Agent session expired or not signed in." }, { status: 401 });
    const signIn = new URL("/agent/login", request.url);
    signIn.searchParams.set("next", pathname + search);
    return NextResponse.redirect(signIn);
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (session) return NextResponse.next();
  if (isApi) {
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
