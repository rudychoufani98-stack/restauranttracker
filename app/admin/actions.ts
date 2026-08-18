"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { isAppAdmin, ADMIN_RESTAURANT_COOKIE } from "@/lib/auth";

// Crée un nouveau client : son compte (email + mot de passe provisoire) et
// son restaurant vierge. Réservé au super-admin ; utilise la clé serveur
// (SUPABASE_SERVICE_ROLE_KEY), jamais exposée au navigateur.
export async function createCustomer(formData: FormData) {
  if (!(await isAppAdmin())) redirect("/dashboard");

  const name = String(formData.get("restaurant_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || password.length < 8) {
    redirect("/admin?err=" + encodeURIComponent("Nom, email et mot de passe (8 caractères min.) sont requis."));
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    redirect("/admin?err=" + encodeURIComponent("Clé serveur manquante : ajoute SUPABASE_SERVICE_ROLE_KEY dans les variables d'environnement Vercel."));
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Compte du client (email confirmé d'office : pas d'email de validation à attendre)
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (userErr || !created?.user) {
    redirect("/admin?err=" + encodeURIComponent("Création du compte impossible : " + (userErr?.message ?? "erreur inconnue")));
  }

  // 2. Son restaurant vierge
  const { error: restErr } = await admin.from("restaurants").insert({ name, owner_id: created!.user.id });
  if (restErr) {
    await admin.auth.admin.deleteUser(created!.user.id); // compensation : pas de compte orphelin
    redirect("/admin?err=" + encodeURIComponent("Création du restaurant impossible : " + restErr.message));
  }

  redirect("/admin?ok=" + encodeURIComponent(`Client « ${name} » créé. Transmets-lui ses identifiants : ${email} / le mot de passe choisi.`));
}

// Ouvre l'interface d'un client : toute l'app bascule sur son restaurant.
export async function openRestaurant(formData: FormData) {
  if (!(await isAppAdmin())) redirect("/dashboard");
  const id = String(formData.get("restaurant_id") ?? "");
  if (!id) redirect("/admin");
  cookies().set(ADMIN_RESTAURANT_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}

// Revient sur ton propre compte.
export async function closeRestaurant() {
  cookies().delete(ADMIN_RESTAURANT_COOKIE);
  redirect("/admin");
}
