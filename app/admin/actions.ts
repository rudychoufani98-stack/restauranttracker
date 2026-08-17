"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAppAdmin, ADMIN_RESTAURANT_COOKIE } from "@/lib/auth";

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
