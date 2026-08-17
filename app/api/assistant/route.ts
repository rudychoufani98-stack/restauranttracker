import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant-knowledge";

// Assistant d'aide intégré : répond aux questions des restaurateurs sur le
// fonctionnement de la plateforme. Modèle économique (Haiku) — coût par
// question négligeable. Nécessite ANTHROPIC_API_KEY dans les variables
// d'environnement Vercel.

const MAX_HISTORY = 12;      // messages conservés (contexte court = coût maîtrisé)
const MAX_MESSAGE_LEN = 2000;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
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
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_LEN) }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: ASSISTANT_SYSTEM_PROMPT,
        messages: history,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[assistant] API error:", res.status, detail.slice(0, 300));
      return NextResponse.json({ error: "L'assistant est momentanément indisponible." }, { status: 502 });
    }

    const json = await res.json();
    const reply = (json?.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ reply: reply || "Désolé, je n'ai pas de réponse — reformule ta question ?" });
  } catch (e) {
    console.error("[assistant] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
