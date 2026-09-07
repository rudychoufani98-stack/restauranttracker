// =====================================================================
//  Le contexte envoye au modele de l assistant.
//
//  Sorti du fichier de route pour deux raisons : une route Next ne doit
//  exporter que ses gestionnaires HTTP, et ce calcul merite des tests.
// =====================================================================
import type { createClient } from "@/lib/supabase/server";
import { foodCostPct, estAlcool, tauxDeVente, reglagesTva } from "@/lib/vat";

// Quantité de base (g/ml/pièce) → affichage lisible (kg/L/pièce)
export function fmtStock(qty: number, unit: string): string {
  if (unit === "kg" || unit === "g") return (qty / 1000).toFixed(1) + " kg";
  if (unit === "l" || unit === "ml") return (qty / 1000).toFixed(1) + " L";
  return qty.toFixed(0) + " pce";
}

// Les marques combinantes (U+0300 a U+036F), celles que NFD vient de
// detacher des lettres accentuees. Construite par code de caractere plutot
// qu'ecrite en clair : une plage de diacritiques litteraux ne survit pas au
// premier outil qui renormalise le fichier, et \p{...} demanderait le
// drapeau `u` que la cible TypeScript du projet refuse.
const DIACRITIQUES = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

/** Minuscules, sans accents : pour reconnaître un nom de plat dans une question. */
export function sansAccents(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIQUES, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Les fiches dont le nom apparaît dans la question.
 *
 * Sans cela, l'assistant recevait le coût de chaque plat mais jamais sa
 * COMPOSITION : à « il y a quoi dans mes arayes ? » il ne pouvait que
 * renvoyer le patron vers la page Recettes. Envoyer les lignes des 111
 * fiches à chaque question ferait exploser le contexte — on ne joint donc
 * que celles dont il est question.
 */
export function fichesVisees(question: string, recettes: { id: string; name: string }[]): string[] {
  const q = sansAccents(question);
  const vues = recettes
    .filter((r) => {
      const n = sansAccents(r.name);
      return n.length >= 4 && q.includes(n);
    })
    // Le nom le plus long d'abord : « chawarma poulet » plutôt que « poulet ».
    .sort((a, b) => b.name.length - a.name.length)
    .map((r) => r.id);
  return vues.slice(0, 4);
}

// Instantané compact des données du restaurant connecté, injecté dans le
// contexte du modèle pour des réponses personnalisées ("ton plat le plus
// rentable est…"). Sécurité : la RLS limite chaque requête au restaurant
// de l'utilisateur — jamais les données d'un autre client.
export async function buildSnapshot(
  supabase: ReturnType<typeof createClient>,
  restaurant: any,
  question: string,
): Promise<string> {
  const restaurantId = restaurant.id;
  const tva = reglagesTva(restaurant);

  const [ings, recipes, orders, suppliers] = await Promise.all([
    supabase.from("ingredients").select("name, unit, stock_qty, cmup, cost_per_base_unit, selling_price, reorder_threshold").eq("restaurant_id", restaurantId).order("name"),
    // is_prep n'est plus filtré : sans les mises en place, l'assistant ne
    // pouvait répondre à aucune question sur les préparations.
    supabase.from("recipes").select("id, name, category, total_cost, menu_price, yield_portions, yield_unit, is_prep").eq("restaurant_id", restaurantId).order("name"),
    supabase.from("purchase_orders").select("order_number, status, expected_total, created_at, suppliers(name)").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(8),
    supabase.from("suppliers").select("name, email, min_order_amount").eq("restaurant_id", restaurantId),
  ]);

  const toutes = recipes.data ?? [];
  const parId = new Map<string, any>(toutes.map((r: any) => [r.id, r]));
  const plats = toutes.filter((r: any) => !r.is_prep);
  const meps = toutes.filter((r: any) => r.is_prep);

  // ── Composition des fiches dont parle la question ─────────────────
  // Placée en TÊTE : le contexte est tronqué par la fin, et c'est la
  // réponse la plus directe à la question posée.
  const blocs: string[] = [];
  const cibles = fichesVisees(question, toutes as any);
  if (cibles.length > 0) {
    const { data: lignes } = await supabase
      .from("recipe_lines")
      .select("recipe_id, quantity, unit, sub_recipe_id, ingredients(name)")
      .in("recipe_id", cibles);

    for (const id of cibles) {
      const r = parId.get(id);
      if (!r) continue;
      const mes = (lignes ?? []).filter((l: any) => l.recipe_id === id);
      blocs.push(`## COMPOSITION DE « ${r.name} » (${r.is_prep ? "mise en place" : "plat"}, rendement ${r.yield_portions} ${r.yield_unit || "portion"})`);
      if (mes.length === 0) {
        blocs.push(`Cette fiche n'a AUCUNE ligne d'ingrédient : elle n'est pas encore chiffrée. Son coût est donc inconnu, pas nul. Dis-le clairement et explique comment ajouter les ingrédients.`);
      } else {
        for (const l of mes as any[]) {
          const nom = l.sub_recipe_id ? `${parId.get(l.sub_recipe_id)?.name ?? "?"} (mise en place)` : l.ingredients?.name ?? "?";
          blocs.push(`- ${nom} : ${Number(l.quantity ?? 0)} ${l.unit ?? ""}`.trimEnd());
        }
      }
    }
  }

  const lines: string[] = [
    `# DONNÉES ACTUELLES DU RESTAURANT « ${restaurant.name} » (valorisées au coût actuel)`,
    ...blocs,
  ];

  // Le food cost se calcule sur du HT des deux côtés : le prix de carte est
  // TTC, le coût matière vient des factures et il est HT. Les diviser tels
  // quels sous-estime le food cost d'environ 2,6 points à 10 % de TVA.
  // Un coût de 0 signifie « pas encore chiffré », jamais « gratuit ».
  lines.push("## PLATS DE LA CARTE (nom | coût/portion | prix vente TTC | food cost % sur HT)");
  for (const r of plats as any[]) {
    const cpp = Number(r.total_cost ?? 0) / (Number(r.yield_portions) || 1);
    const price = Number(r.menu_price ?? 0);
    const fc = cpp > 0 ? foodCostPct(cpp, price, tauxDeVente("dine_in", estAlcool(r), tva)) : null;
    lines.push(`${r.name} | ${cpp > 0 ? cpp.toFixed(2) + "€" : "NON CHIFFRÉ"} | ${price > 0 ? price.toFixed(2) + "€" : "prix non défini"} | ${fc !== null ? fc.toFixed(1) + "%" : "inconnu"}`);
  }

  if (meps.length > 0) {
    lines.push("## MISES EN PLACE (nom | rendement | coût total)");
    for (const m of meps as any[]) {
      const c = Number(m.total_cost ?? 0);
      lines.push(`${m.name} | ${m.yield_portions} ${m.yield_unit || "portion"} | ${c > 0 ? c.toFixed(2) + "€" : "NON CHIFFRÉE"}`);
    }
  }

  lines.push("## INGRÉDIENTS (nom | stock | coût moyen ; « ⚠ SOUS LE SEUIL » = à recommander)");
  let valeurStock = 0;
  for (const i of ings.data ?? []) {
    const stock = Number(i.stock_qty ?? 0);
    const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
    valeurStock += stock * cmup;
    const per = i.unit === "kg" || i.unit === "g" ? "€/kg" : i.unit === "l" || i.unit === "ml" ? "€/L" : "€/pce";
    const thr = Number(i.reorder_threshold ?? 0);
    lines.push(`${i.name} | ${fmtStock(stock, i.unit)} | ${(cmup * (per === "€/pce" ? 1 : 1000)).toFixed(2)}${per}${thr > 0 && stock <= thr ? " | ⚠ SOUS LE SEUIL — à commander" : ""}`);
  }
  lines.push(`VALEUR TOTALE DU STOCK : ${valeurStock.toFixed(2)}€`);

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
