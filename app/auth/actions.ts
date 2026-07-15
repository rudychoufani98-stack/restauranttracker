"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
