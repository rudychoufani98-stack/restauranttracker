// =====================================================================
//  POST /api/scan-bl — lire un bon de livraison ou une FACTURE.
//
//  Le nom de la route dit « bl » pour une raison d histoire : elle a
//  commence par les bons de livraison. Elle lit les deux depuis qu une
//  facture se saisit aussi a la photo — le document change, la consigne
//  change, le rapprochement est le meme.
//
//  Un seul lecteur : Gemini. Il y a eu un temps ou x.ai lisait les
//  documents, mais sa cle a expire et il ne prenait que des images la
//  ou la moitie des factures arrivent en PDF. Gemini fait les deux, et
//  c est la cle que l assistant utilise tous les jours — donc la seule
//  dont on sache qu elle vit encore.
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
const TIMEOUT_MS = 45000; // une page dense met du temps ; plus long que le chat
const MODELE = "gemini-3.6-flash";

/** Erreur du lecteur, avec son statut HTTP — un 503 se reessaie, pas un 400. */
class ErreurLecteur extends Error {
  constructor(message: string, readonly statut: number) { super(message); }
}

/** Le service est deborde (ou on va trop vite) : ca vaut le coup d insister. */
const passager = (e: unknown) =>
  e instanceof ErreurLecteur
    ? e.statut === 503 || e.statut === 429 || e.statut >= 500
    : (e as any)?.name === "TimeoutError" || (e as any)?.name === "AbortError";

async function lireAvecGemini(apiKey: string, base64: string, mime: string, texte: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: texte }],
        }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0 },
      }),
    },
  );
  if (!res.ok) throw new ErreurLecteur(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
  const json = await res.json();
  return ((json?.candidates?.[0]?.content?.parts ?? []) as any[]).map((p) => p?.text ?? "").join("\n").trim();
}

/**
 * Reessaie tant que l echec est passager.
 *
 * Releve en production : Gemini a renvoye « This model is currently
 * experiencing high demand » sur la toute premiere facture deposee. Une
 * seule tentative transformait un contretemps de deux secondes en
 * « la lecture a echoue », et le restaurateur retapait sa facture.
 */
async function avecReprises<T>(fn: () => Promise<T>, essais = 3): Promise<T> {
  let derniere: unknown;
  for (let i = 0; i < essais; i++) {
    try { return await fn(); } catch (e) {
      derniere = e;
      if (!passager(e) || i === essais - 1) throw e;
      console.warn(`[scan] tentative ${i + 1} échouée (${(e as Error).message.slice(0, 80)}), on réessaie`);
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw derniere;
}

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

    const gemini = process.env.GEMINI_API_KEY;
    if (!gemini) {
      return NextResponse.json({ error: "La lecture automatique n'est pas configurée sur ce compte." }, { status: 500 });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

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

    let brut = "";
    try {
      brut = await avecReprises(() => lireAvecGemini(gemini, base64, file.type, consigne(type, attendus)));
    } catch (e) {
      console.error("[scan] lecture impossible :", (e as Error).message);
      // Dire ce qui s'est passé : « réessaie » et « saisis à la main » ne
      // sont pas le même conseil, et une photo plus nette n'a jamais
      // réparé un service débordé.
      return NextResponse.json(
        {
          error: passager(e)
            ? "Le lecteur est débordé en ce moment. Attends une minute et relance la lecture — ta facture est toujours là."
            : "La lecture du document a échoué. Réessaie avec une photo nette et cadrée sur le tableau des articles, ou saisis les lignes à la main.",
        },
        { status: 502 },
      );
    }

    if (!brut) {
      console.error("[scan] réponse vide du lecteur");
      return NextResponse.json(
        { error: "Le lecteur n'a rien trouvé sur ce document. Vérifie qu'il s'agit bien d'une facture lisible, ou saisis les lignes à la main." },
        { status: 502 },
      );
    }

    const lecture = lireReponse(brut);
    // `items` reste en sortie : l ecran de reception le lit deja sous ce nom.
    return NextResponse.json({ ...lecture, items: lecture.items });
  } catch (e: any) {
    console.error("[scan] erreur :", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur pendant la lecture." }, { status: 500 });
  }
}
