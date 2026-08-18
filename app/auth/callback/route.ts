import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Landing point for Supabase email links (password reset, confirmation).
// Exchanges the one-time code for a session, then forwards to `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[auth/callback] exchange error:", error.message);
  }

  // Supabase peut expliquer le refus (lien expiré, déjà utilisé…) : on
  // transmet la raison pour que la page de connexion l'affiche.
  const reason = searchParams.get("error_description");
  const url = new URL(`${origin}/login`);
  url.searchParams.set("error", "lien_invalide");
  if (reason) url.searchParams.set("error_description", reason);
  return NextResponse.redirect(url.toString());
}
