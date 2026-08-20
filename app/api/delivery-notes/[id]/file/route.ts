import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pièce jointe d'un bon de livraison (photo ou PDF).
 *
 *   GET    → ouvre le fichier (lien signé valable 60 s)
 *   DELETE → supprime le fichier et libère l'espace de stockage
 *
 * Le bucket « invoices » est PRIVÉ : on ne renvoie jamais d'URL publique,
 * seulement un lien signé à durée de vie courte, et uniquement après avoir
 * vérifié que la réception appartient bien au restaurant de l'utilisateur.
 */
async function chargerBL(id: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erreur: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };

  const restaurant = await getRestaurant();
  if (!restaurant) return { erreur: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };

  const { data: dn } = await supabase
    .from("delivery_notes")
    .select("id, bl_pdf_url, restaurant_id")
    .eq("id", id)
    .eq("restaurant_id", restaurant.id)   // cloisonnement par restaurant
    .maybeSingle();

  if (!dn) return { erreur: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
  if (!dn.bl_pdf_url) return { erreur: NextResponse.json({ error: "Aucune pièce jointe" }, { status: 404 }) };
  return { supabase, dn };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { erreur, supabase, dn } = await chargerBL(params.id);
    if (erreur) return erreur;

    const { data, error } = await supabase!.storage
      .from("invoices")
      .createSignedUrl(dn!.bl_pdf_url as string, 60);
    if (error || !data?.signedUrl) {
      console.error("[bl/file] lien signé:", error?.message);
      return NextResponse.json({ error: "Fichier indisponible" }, { status: 502 });
    }
    return NextResponse.redirect(data.signedUrl);
  } catch (e) {
    console.error("[bl/file] GET:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { erreur, supabase, dn } = await chargerBL(params.id);
    if (erreur) return erreur;

    // 1) Le fichier lui-même (c'est lui qui occupe l'espace).
    const { error: rmErr } = await supabase!.storage
      .from("invoices")
      .remove([dn!.bl_pdf_url as string]);
    if (rmErr) {
      console.error("[bl/file] suppression:", rmErr.message);
      return NextResponse.json({ error: `Suppression impossible : ${rmErr.message}` }, { status: 502 });
    }

    // 2) La référence, pour que l'écran n'affiche plus un lien mort.
    const { error: upErr } = await supabase!
      .from("delivery_notes").update({ bl_pdf_url: null }).eq("id", dn!.id);
    if (upErr) {
      return NextResponse.json({
        error: "Fichier supprimé, mais la référence n'a pas pu être effacée. Recharge la page.",
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[bl/file] DELETE:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
