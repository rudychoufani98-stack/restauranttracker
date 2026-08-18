// =====================================================================
//  Génère les 7 fichiers Excel sur disque pour inspection humaine.
//  Ne tourne QUE sur demande :  GEN_SAMPLES=1 npx vitest run tests/samples
// =====================================================================
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

const OUT = process.env.SAMPLES_DIR || path.join(process.cwd(), "tmp-exports");

// Mêmes jeux de données que tests/exports.test.ts (dupliqués volontairement :
// ce fichier est un utilitaire, pas une source de vérité).
const RESTAURANT = { id: "resto-1", name: "Restaurant Démo" };
const INGREDIENTS = [
  { id: "coca", name: "Coca 33cl", category: "Boisson", unit: "unit", stock_qty: 48, cmup: 0.45, cost_per_base_unit: 0.5, pack_price: 10.8, vat_rate: 20, pack_units: 24, unit_size: 1, pack_quantity: 24, yield_pct: 100, selling_price: 2.5, suppliers: { name: "Metro" } },
  { id: "huile", name: "Huile olive", category: "Épicerie", unit: "l", stock_qty: 15000, cmup: 0.0048, cost_per_base_unit: 0.005, pack_price: 24, vat_rate: 5.5, pack_units: 1, unit_size: 5, pack_quantity: 5, yield_pct: 100, selling_price: null, suppliers: { name: "Metro" } },
  { id: "farine", name: "Farine T55", category: "Épicerie", unit: "g", stock_qty: 25000, cmup: 0.0012, cost_per_base_unit: 0.0012, pack_price: 15, vat_rate: 5.5, pack_units: 1, unit_size: 1000, pack_quantity: 1000, yield_pct: 100, selling_price: null, suppliers: null },
  { id: "tomate", name: "Tomate", category: "Légumes/Fruits", unit: "kg", stock_qty: 8000, cmup: 0.0021, cost_per_base_unit: 0.002, pack_price: 10, vat_rate: 5.5, pack_units: 1, unit_size: 5, pack_quantity: 5, yield_pct: 90, selling_price: null, suppliers: { name: "Pro à Pro" } },
];
const RECIPES = [
  { id: "salade", name: "Salade tomate", category: "Entrée", total_cost: 6, menu_price: 8, yield_portions: 3, is_prep: false },
  { id: "mep", name: "Sauce tomate (MEP)", category: "Sauces", total_cost: 4, menu_price: null, yield_portions: 2, is_prep: true },
];
const ORDERS = [
  { order_number: "BDC-2026-0001", status: "Sent", created_at: "2026-07-10T10:00:00Z", expected_total: 100, suppliers: { name: "Metro" }, purchase_order_lines: [{ quantity: 3, expected_price: 24, ingredients: { name: "Huile olive" } }] },
  { order_number: "BDC-2026-0002", status: "Cancelled", created_at: "2026-07-12T10:00:00Z", expected_total: 50, suppliers: { name: "Pro à Pro" }, purchase_order_lines: [{ quantity: 2, expected_price: 10, ingredients: { name: "Tomate" } }] },
];
const LOSS = { created_at: "2026-07-15T10:00:00Z", movement_type: "loss", reference_type: "loss", qty: 2000, unit_cost: 0.0021, loss_reason: "DLC dépassée", notes: null, ingredients: { name: "Tomate", unit: "kg" } };
const MOVEMENTS = [
  { created_at: "2026-07-05T10:00:00Z", movement_type: "in", reference_type: "delivery", qty: 5000, unit_cost: 0.0048, loss_reason: null, notes: null, ingredients: { name: "Huile olive", unit: "l" } },
  LOSS,
  { created_at: "2026-07-20T10:00:00Z", movement_type: "out", reference_type: "sale", qty: 300, unit_cost: 0.002, loss_reason: null, notes: null, ingredients: { name: "Tomate", unit: "kg" } },
];
const PERIODS = [{ month: "2026-07", channel: "dine_in", sales_lines: [{ qty_sold: 10, recipe_id: "salade", ingredient_id: null }, { qty_sold: 20, recipe_id: null, ingredient_id: "coca" }] }];

type Filters = { eq: [string, any][]; not: [string, any, any][] };
function resolveData(table: string, f: Filters): any {
  const hasEq = (c: string, v: any) => f.eq.some(([col, val]) => col === c && val === v);
  switch (table) {
    case "ingredients": return f.not.some(([c]) => c === "selling_price") ? INGREDIENTS.filter((i) => i.selling_price != null) : INGREDIENTS;
    case "recipes": return hasEq("is_prep", false) ? RECIPES.filter((r) => !r.is_prep) : RECIPES;
    case "stock_movements": return hasEq("movement_type", "loss") ? [LOSS] : MOVEMENTS;
    case "purchase_orders": return ORDERS;
    case "sales_periods": return PERIODS;
    default: return [];
  }
}
function makeQuery(table: string) {
  const f: Filters = { eq: [], not: [] };
  const q: any = {
    select: () => q, order: () => q, limit: () => q, neq: () => q, in: () => q, gte: () => q, lte: () => q,
    eq: (c: string, v: any) => { f.eq.push([c, v]); return q; },
    not: (c: string, op: any, v: any) => { f.not.push([c, op, v]); return q; },
    single: () => Promise.resolve({ data: resolveData(table, f), error: null }),
    maybeSingle: () => Promise.resolve({ data: resolveData(table, f), error: null }),
    then: (ok: any, ko?: any) => Promise.resolve({ data: resolveData(table, f), error: null }).then(ok, ko),
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u" } } }) }, from: (t: string) => makeQuery(t) }),
}));
vi.mock("@/lib/auth", () => ({ getRestaurant: async () => RESTAURANT }));

const TYPES = ["inventaire", "achats", "recettes", "commandes", "pertes", "ventes", "mouvements"];

describe.skipIf(!process.env.GEN_SAMPLES)("Génération des fichiers d'exemple", () => {
  it("écrit les 7 exports sur disque", async () => {
    const { GET } = await import("@/app/api/export/[type]/route");
    fs.mkdirSync(OUT, { recursive: true });
    for (const type of TYPES) {
      const res = await GET({} as any, { params: { type } });
      expect(res.status, type).toBe(200);
      const disp = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? `${type}.xlsx`;
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(OUT, name), buf);
      expect(buf.byteLength).toBeGreaterThan(3000); // un vrai classeur, pas un fichier vide
      console.log(`  ✓ ${name} — ${(buf.byteLength / 1024).toFixed(1)} Ko`);
    }
  });
});
