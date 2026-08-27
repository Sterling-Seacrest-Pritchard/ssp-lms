import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/roles";

export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  if (req.nextUrl.pathname.startsWith("/admin") && !isAdminRole(req.auth.user?.roles)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|icon.png|logo-horizontal-blue.png|logo-horizontal-white.png|logo-shield-blue.png|logo-shield-white.png).*)",
  ],
};
