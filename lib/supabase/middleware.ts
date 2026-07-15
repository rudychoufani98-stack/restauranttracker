import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Auth check with a hard timeout. This call hits Supabase over the network on
  // every request — without a bound, a slow/waking Supabase hangs the middleware
  // and Vercel returns 504 for the WHOLE site (MIDDLEWARE_INVOCATION_TIMEOUT).
  // On timeout/error we "fail open" for the redirect decision only: pages still
  // validate the user server-side and RLS still gates every row, so no data leak.
  const AUTH_TIMEOUT_MS = 3000;
  let user = null;
  let authUnavailable = false;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-timeout")), AUTH_TIMEOUT_MS)
      ),
    ]);
    user = result.data.user;
  } catch {
    authUnavailable = true;
  }

  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  // Password-reset flow must stay reachable while logged out.
  const isRecovery =
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/update-password") ||
    pathname.startsWith("/auth/callback");
  const isPublic = isAuthPage || isRecovery || pathname === "/";

  // Couldn't reach the auth server: let the request through rather than 504 or
  // wrongly logging the user out. The page's own auth + RLS remain in force.
  if (authUnavailable) return supabaseResponse;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
