import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/roles";
import { requiresAdminRole, adminForbiddenResponse } from "@/lib/auth/admin-gate";

export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  if (requiresAdminRole(req.nextUrl.pathname) && !isAdminRole(req.auth.user?.roles)) {
    return adminForbiddenResponse(req.nextUrl.pathname, req.url);
  }
});

export const config = {
  matcher: [
    "/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|icon.png|logo-horizontal-blue.png|logo-horizontal-white.png|logo-shield-blue.png|logo-shield-white.png).*)",
  ],
};
