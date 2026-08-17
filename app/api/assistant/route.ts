import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant-knowledge";

// Quantité de base (g/ml/pièce) → affichage lisible (kg/L/pièce)
function fmtStock(qty: number, unit: string): string {
  if (unit === "kg" || unit === "g") return (qty / 1000).toFixed(1) + " kg";
  if (unit === "l" || unit === "ml") return (qty / 1000).toFixed(1) + " L";
  return qty.toFixed(0) + " pce";
}

// Instantané compact des données du restaurant connecté, injecté dans le
// contexte du modèle pour des réponses personnalisées ("ton plat le plus
// rentable est…"). Sécurité : la RLS limite chaque requête au restaurant
// de l'utilisateur — jamais les données d'un autre client.
async function buildSnapshot(supabase: ReturnType<typeof createClient>, restaurantId: string, restaurantName: string): Promise<string> {
  const [ings, recipes, orders, suppliers] = await Promise.all([
    supabase.from("ingredients").select("name, unit, stock_qty, cmup, cost_per_base_unit, selling_price, reorder_threshold").eq("restaurant_id", restaurantId).order("name"),
    supabase.from("recipes").select("name, category, total_cost, menu_price, yield_portions").eq("restaurant_id", restaurantId).order("name"),
    supabase.from("purchase_orders").select("order_number, status, expected_total, created_at, suppliers(name)").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(8),
    supabase.from("suppliers").select("name, email, min_order_amount").eq("restaurant_id", restaurantId),
  ]);

  const lines: string[] = [`# DONNÉES ACTUELLES DU RESTAURANT « ${restaurantName} » (valorisées au coût actuel)`];

  lines.push("## PLATS DE LA CARTE (nom | coût/portion | prix vente | food cost %)");
  for (const r of recipes.data ?? []) {
    const cpp = Number(r.total_cost ?? 0) / (Number(r.yield_portions) || 1);
    const price = Number(r.menu_price ?? 0);
    const fc = price > 0 ? ((cpp / price) * 100).toFixed(1) + "%" : "prix non défini";
    lines.push(`${r.name} | ${cpp.toFixed(2)}€ | ${price > 0 ? price.toFixed(2) + "€" : "—"} | ${fc}`);
  }

  lines.push("## INGRÉDIENTS (nom | stock | coût moyen | seuil alerte)");
  for (const i of ings.data ?? []) {
    const stock = Number(i.stock_qty ?? 0);
    const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
    const per = i.unit === "kg" || i.unit === "g" ? "€/kg" : i.unit === "l" || i.unit === "ml" ? "€/L" : "€/pce";
    const thr = Number(i.reorder_threshold ?? 0);
    lines.push(`${i.name} | ${fmtStock(stock, i.unit)} | ${(cmup * (per === "€/pce" ? 1 : 1000)).toFixed(2)}${per}${thr > 0 && stock <= thr ? " | ⚠ SOUS LE SEUIL — à commander" : ""}`);
  }

  lines.push("## DERNIÈRES COMMANDES (n° | fournisseur | statut | total)");
  for (const o of orders.data ?? []) {
    lines.push(`${o.order_number ?? "—"} | ${(o as any).suppliers?.name ?? "—"} | ${o.status} | ${Number(o.expected_total ?? 0).toFixed(2)}€`);
  }

  lines.push("## FOURNISSEURS (nom | email | franco)");
  for (const s of suppliers.data ?? []) {
    lines.push(`${s.name} | ${s.email ?? "pas d'email"} | ${Number(s.min_order_amount ?? 0) > 0 ? Number(s.min_order_amount).toFixed(0) + "€" : "—"}`);
  }

  // Garde le contexte compact (quota du palier gratuit)
  return lines.join("\n").slice(0, 15000);
}

// Assistant d'aide intégré : répond aux questions des restaurateurs sur le
// fonctionnement de la plateforme.
// Moteur : Google Gemini (palier GRATUIT — clé sur aistudio.google.com) via
// GEMINI_API_KEY ; à défaut, Anthropic via ANTHROPIC_API_KEY.

const MAX_HISTORY = 12;      // messages conservés (contexte court = quota préservé)
const MAX_MESSAGE_LEN = 2000;

async function askGemini(apiKey: string, system: string, history: { role: string; content: string }[]) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
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
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
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
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system,
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

    // Instantané des données du restaurant connecté (RLS : uniquement les siennes)
    let snapshot = "";
    try {
      const restaurant = await getRestaurant();
      if (restaurant) snapshot = await buildSnapshot(supabase, restaurant.id, restaurant.name);
    } catch (e) {
      console.error("[assistant] snapshot:", (e as Error).message); // best-effort : l'aide générale reste disponible
    }
    const system = ASSISTANT_SYSTEM_PROMPT +
      "\n\nRÈGLE DE FORME : réponds en TEXTE BRUT, sans markdown (pas de **, pas de #).\n\n" +
      (snapshot ? snapshot + "\n\nUtilise ces données pour répondre aux questions sur CE restaurant (chiffres, plats les plus rentables, stocks, alertes). Elles sont à jour à l'instant de la question." : "");

    let reply = "";
    try {
      reply = gemini ? await askGemini(gemini, system, history) : await askAnthropic(anthropic!, system, history);
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
