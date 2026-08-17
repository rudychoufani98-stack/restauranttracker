import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant-knowledge";

// Assistant d'aide intégré : répond aux questions des restaurateurs sur le
// fonctionnement de la plateforme.
// Moteur : Google Gemini (palier GRATUIT — clé sur aistudio.google.com) via
// GEMINI_API_KEY ; à défaut, Anthropic via ANTHROPIC_API_KEY.

const MAX_HISTORY = 12;      // messages conservés (contexte court = quota préservé)
const MAX_MESSAGE_LEN = 2000;

async function askGemini(apiKey: string, history: { role: string; content: string }[]) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
        contents: history.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 900, temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const json = await res.json();
  return ((json?.candidates?.[0]?.content?.parts ?? []) as any[])
    .map((p) => p?.text ?? "")
    .join("\n")
    .trim();
}

async function askAnthropic(apiKey: string, history: { role: string; content: string }[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: ASSISTANT_SYSTEM_PROMPT,
      messages: history,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
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
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

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

    let reply = "";
    try {
      reply = gemini ? await askGemini(gemini, history) : await askAnthropic(anthropic!, history);
    } catch (e) {
      console.error("[assistant]", (e as Error).message);
      return NextResponse.json({ error: "L'assistant est momentanément indisponible." }, { status: 502 });
    }

    return NextResponse.json({ reply: reply || "Désolé, je n'ai pas de réponse — reformule ta question ?" });
  } catch (e) {
    console.error("[assistant] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
