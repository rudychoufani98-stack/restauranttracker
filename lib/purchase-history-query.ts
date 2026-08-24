// Chargement de l'historique d'achat facturé, partagé par l'écran
// « Évolution des prix » et l'export Excel « Coût produit ».
//
// Source de vérité : les factures VALIDÉES. Un brouillon de facture ne
// compte pas — tant qu'elle n'est pas validée, le prix n'est pas confirmé.
import { buildPurchaseHistory, type Purchase } from "./cost-history";
import { selectIngredients } from "./ingredients-query";

/** Lecture par paquets : PostgREST limite la taille d'un filtre `in`. */
export async function fetchIn(
  supabase: any, table: string, select: string, column: string, ids: string[],
): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from(table).select(select).in(column, ids.slice(i, i + 200));
    if (data) out.push(...data);
  }
  return out;
}

export type PurchaseHistory = {
  byIngredient: Map<string, Purchase[]>;
  ingredients: any[];
  ingById: Map<string, any>;
  invoiceCount: number;
};

const ING_COLS =
  "id, name, category, unit, pack_units, unit_size, pack_quantity, cmup, cost_per_base_unit, stock_qty, suppliers(name)";

export async function loadPurchaseHistory(supabase: any, restaurantId: string): Promise<PurchaseHistory> {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, created_at, po_id")
    .eq("restaurant_id", restaurantId)
    .eq("validated", true)
    .order("invoice_date", { ascending: true });

  const invoiceIds = (invoices ?? []).map((i: any) => i.id);
  const poIds = Array.from(new Set((invoices ?? []).map((i: any) => i.po_id).filter(Boolean))) as string[];

  const [invLines, pos, poLines, ingRes] = await Promise.all([
    invoiceIds.length
      ? fetchIn(supabase, "invoice_lines", "invoice_id, ingredient_id, quantity, unit_price", "invoice_id", invoiceIds)
      : Promise.resolve([] as any[]),
    poIds.length
      ? fetchIn(supabase, "purchase_orders", "id, order_number, suppliers(name)", "id", poIds)
      : Promise.resolve([] as any[]),
    poIds.length
      ? fetchIn(supabase, "purchase_order_lines", "po_id, ingredient_id, expected_price", "po_id", poIds)
      : Promise.resolve([] as any[]),
    selectIngredients(supabase, restaurantId, ING_COLS),
  ]);

  const ingredients = ingRes.data ?? [];
  return {
    byIngredient: buildPurchaseHistory({
      invoices: invoices ?? [],
      invoiceLines: invLines,
      purchaseOrders: pos,
      poLines,
    }),
    ingredients,
    ingById: new Map<string, any>(ingredients.map((i: any) => [i.id, i])),
    invoiceCount: invoiceIds.length,
  };
}
