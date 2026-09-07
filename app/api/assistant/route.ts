import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant-knowledge";
import { buildSnapshot } from "@/lib/assistant-contexte";

// Deux appels de modèle au pire (Gemini puis bascule Anthropic) : la durée
// par défaut de Vercel ne suffirait pas et la fonction serait tuee au milieu.
export const maxDuration = 30;

// Assistant d'aide intégré : répond aux questions des restaurateurs sur le
// fonctionnement de la plateforme.
// Moteur : Google Gemini (palier GRATUIT — clé sur aistudio.google.com) via
// GEMINI_API_KEY ; à défaut, Anthropic via ANTHROPIC_API_KEY.

const MAX_HISTORY = 12;      // messages conservés (contexte court = quota préservé)
const MAX_MESSAGE_LEN = 2000;
const TIMEOUT_MS = 12000;    // au-delà, on bascule plutôt que de faire attendre

/** Erreur d'un moteur, avec le statut HTTP pour distinguer un quota du reste. */
class ErreurModele extends Error {
  constructor(message: string, readonly statut: number) { super(message); }
}

async function askGemini(apiKey: string, system: string, history: { role: string; content: string }[]) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: history.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 900, temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) throw new ErreurModele(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
  const json = await res.json();
  return ((json?.candidates?.[0]?.content?.parts ?? []) as any[])
    .map((p) => p?.text ?? "")
    .join("\n")
    .trim();
}

async function askAnthropic(apiKey: string, system: string, history: { role: string; content: string }[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system,
      messages: history,
    }),
  });
  if (!res.ok) throw new ErreurModele(`Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
  const json = await res.json();
  return ((json?.content ?? []) as any[])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Session expirée — reconnecte-toi pour continuer." }, { status: 401 });

    const gemini = process.env.GEMINI_API_KEY;
    const anthropic = process.env.ANTHROPIC_API_KEY;
    if (!gemini && !anthropic) {
      return NextResponse.json(
        { error: "L'assistant n'est pas encore activé (clé API manquante)." },
        { status: 503 }
      );
    }

    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    // Nettoie et borne l'historique côté serveur.
    const history = messages
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .slice(-MAX_HISTORY)
      .map((m: any) => ({ role: m.role as string, content: String(m.content).slice(0, MAX_MESSAGE_LEN) }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }
    const question = history[history.length - 1].content;

    // Instantané des données du restaurant connecté (RLS : uniquement les siennes)
    let snapshot = "";
    try {
      const restaurant = await getRestaurant();
      if (restaurant) snapshot = await buildSnapshot(supabase, restaurant, question);
    } catch (e) {
      console.error("[assistant] snapshot:", (e as Error).message); // best-effort : l'aide générale reste disponible
    }
    const system = ASSISTANT_SYSTEM_PROMPT +
      "\n\nRÈGLE DE FORME : réponds en TEXTE BRUT, sans markdown (pas de **, pas de #).\n\n" +
      (snapshot ? snapshot + "\n\nUtilise ces données pour répondre aux questions sur CE restaurant (chiffres, plats les plus rentables, stocks, alertes). Elles sont à jour à l'instant de la question. Quand un bloc COMPOSITION est présent, réponds AVEC son contenu plutôt que de renvoyer vers une page. Ne donne jamais un coût ni un food cost pour une fiche marquée NON CHIFFRÉE : dis qu'elle n'a pas encore d'ingrédients ou de prix." : "");

    // Un seul moteur qui tousse ne doit pas suffire à couper l'assistant :
    // on bascule sur l'autre quand les deux clés existent.
    const moteurs: { nom: string; run: () => Promise<string> }[] = [];
    if (gemini) moteurs.push({ nom: "gemini", run: () => askGemini(gemini, system, history) });
    if (anthropic) moteurs.push({ nom: "anthropic", run: () => askAnthropic(anthropic, system, history) });

    let reply = "";
    let derniere: ErreurModele | Error | null = null;
    for (const m of moteurs) {
      try {
        reply = await m.run();
        if (reply) break;
        console.error(`[assistant] ${m.nom} : réponse vide`);
      } catch (e) {
        derniere = e as Error;
        console.error(`[assistant] ${m.nom} :`, (e as Error).message);
      }
    }

    if (!reply) {
      // Un quota atteint n'est pas une panne : le dire, avec la conduite à tenir.
      const statut = derniere instanceof ErreurModele ? derniere.statut : 0;
      const quota = statut === 429;
      const lent = (derniere as any)?.name === "TimeoutError" || (derniere as any)?.name === "AbortError";
      return NextResponse.json(
        {
          error: quota
            ? "Trop de questions d'affilée : le quota de l'assistant est atteint. Réessaie dans une minute."
            : lent
              ? "L'assistant a mis trop de temps à répondre. Réessaie — ta question est conservée."
              : "L'assistant est momentanément indisponible. Réessaie dans un instant.",
        },
        { status: quota ? 429 : 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch (e) {
    console.error("[assistant] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
