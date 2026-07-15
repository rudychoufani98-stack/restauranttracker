"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    console.error("[login] auth error:", error.message);
    // Surface the real reason — mapping everything to "wrong password" sends
    // people hunting for a password problem that isn't there.
    const m = (error.message || "").toLowerCase();
    // The database/auth server is unreachable (e.g. Supabase project paused).
    // Never blame the password for this — it sends people hunting for nothing.
    if (m.includes("fetch") || m.includes("network") || m.includes("timeout") || m.includes("unavailable") || (error as any).status === 0 || (error as any).status >= 500) {
      return { error: "Service temporairement indisponible (base de données injoignable). Réessaie dans quelques minutes." };
    }
    if (m.includes("not confirmed") || m.includes("confirm")) {
      return { error: "Ton email n'est pas encore confirmé. Ouvre le lien de confirmation reçu par email (vérifie les spams)." };
    }
    if (m.includes("too many") || m.includes("rate limit")) {
      return { error: "Trop de tentatives de connexion. Attends quelques minutes puis réessaie." };
    }
    return { error: "Email ou mot de passe incorrect." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = createClient();

  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password || password.length < 8) {
    return { error: "Email invalide ou mot de passe trop court (8 caractères minimum)." };
  }

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("[signup] auth error:", error.message);
    return { error: "Impossible de créer le compte. Réessayez." };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function logout() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Sends a password-reset link by email. The link lands on /auth/callback which
// exchanges the code for a session, then forwards to /update-password.
export async function requestPasswordReset(formData: FormData) {
  const supabase = createClient();
  const email = (formData.get("email") as string)?.trim();
  if (!email) return { error: "Entre ton adresse email." };

  const origin = headers().get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/update-password`,
  });

  if (error) {
    console.error("[reset] auth error:", error.message);
    const m = (error.message || "").toLowerCase();
    if (m.includes("too many") || m.includes("rate limit")) {
      return { error: "Trop de demandes. Attends quelques minutes puis réessaie." };
    }
    return { error: "Impossible d'envoyer l'email. Réessaie dans un instant." };
  }
  // Always report success — never reveal whether an account exists.
  return { ok: true };
}

// Sets a new password for the user currently in a (recovery) session.
export async function updatePassword(formData: FormData) {
  const supabase = createClient();
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!password || password.length < 8) {
    return { error: "Mot de passe trop court (8 caractères minimum)." };
  }
  if (password !== confirm) {
    return { error: "Les deux mots de passe ne correspondent pas." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Lien expiré ou invalide. Redemande un email de réinitialisation." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[update-password] error:", error.message);
    return { error: "Impossible de changer le mot de passe. Réessaie." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
