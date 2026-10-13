// =====================================================================
//  POST /api/scan-bl — lire un bon de livraison ou une FACTURE.
//
//  Le nom de la route dit « bl » pour une raison d histoire : elle a
//  commence par les bons de livraison. Elle lit les deux depuis qu une
//  facture se saisit aussi a la photo — le document change, la consigne
//  change, le rapprochement est le meme.
//
//  Ce qui sort d ici n est jamais ecrit tel quel : l ecran l affiche,
//  le restaurateur corrige, et c est lui qui valide. Un chiffre lu sur
//  une photo n a pas la meme autorite qu un chiffre saisi.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consigne, lireReponse, type Attendu } from "@/lib/scan-document";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = (formData.get("document") as string) === "facture" ? "facture" : "bl";

    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Fichier trop lourd (5 Mo maximum). Reprends la photo en qualité normale." }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: "Format non reconnu. Envoie une photo (JPG, PNG) ou un PDF." }, { status: 400 });
    }

    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "La lecture automatique n'est pas configurée sur ce compte." }, { status: 500 });

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.type.startsWith("image/") ? file.type : "image/jpeg";

    // Les produits attendus, avec les noms que CE fournisseur imprime.
    let attendus: Attendu[] = [];
    try {
      const brut = JSON.parse((formData.get("lines") as string) ?? "[]");
      attendus = (Array.isArray(brut) ? brut : [])
        .filter((l: any) => l && (l.nom || l.name))
        .map((l: any, i: number) => ({
          ingredient_id: String(l.ingredient_id ?? i),
          nom: String(l.nom ?? l.name),
          designations: Array.isArray(l.designations) ? l.designations.map(String) : [],
        }));
    } catch { attendus = []; }

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-2-vision-latest",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
            { type: "text", text: consigne(type, attendus) },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("[scan] erreur du lecteur :", err?.error?.message ?? response.status);
      return NextResponse.json({ error: "La lecture du document a échoué. Réessaie, ou saisis les lignes à la main." }, { status: 502 });
    }

    const data = await response.json();
    const lecture = lireReponse(data.choices?.[0]?.message?.content ?? "");

    // `items` reste en sortie : l ecran de reception le lit deja sous ce nom.
    return NextResponse.json({ ...lecture, items: lecture.items });
  } catch (e: any) {
    console.error("[scan] erreur :", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur pendant la lecture." }, { status: 500 });
  }
}
