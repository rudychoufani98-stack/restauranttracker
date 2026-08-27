// =====================================================================
//  Destockage des ventes : la route de bout en bout.
//
//  Ce qui est verifie ici n est pas « le calcul est bon » mais « on peut
//  revenir en arriere ». Un restaurateur saisit son mois, se trompe,
//  re-saisit, supprime. A la fin, le stock doit etre EXACTEMENT celui du
//  depart — y compris quand il a vendu plus qu il n avait recu.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Le stock des produits, mute par la route comme le ferait la base. */
let stock: Record<string, number>;
/** Les mouvements de vente, indexes par periode. */
let mouvements: any[];

const RECETTES = [
  {
    id: "rec-houmous",
    yield_portions: 1,
    yield_unit: "portion",
    recipe_lines: [{ ingredient_id: "ing-pois", sub_recipe_id: null, quantity: 100, unit: "g" }],
  },
];

function table(t: string): any {
  if (t === "recipes") {
    return { select: () => ({ eq: async () => ({ data: RECETTES, error: null }) }) };
  }
  if (t === "ingredients") {
    return {
      select: () => ({
        in: async (_c: string, ids: string[]) => ({
          data: ids.map((id) => ({
            id, name: id, stock_qty: stock[id] ?? 0,
            cmup: 2, cost_per_base_unit: 2, yield_pct: 100,
          })),
          error: null,
        }),
      }),
      update: (v: any) => ({ eq: async (_c: string, id: string) => { stock[id] = v.stock_qty; return { error: null }; } }),
    };
  }
  if (t === "stock_movements") {
    const o: any = {
      select: () => o,
      eq: () => o,
      then: (ok: any) => Promise.resolve({ data: [...mouvements], error: null }).then(ok),
      delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => { mouvements = []; return { error: null }; } }) }) }),
      insert: async (rows: any[]) => { mouvements.push(...rows); return { error: null }; },
    };
    return o;
  }
  return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ from: table, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
vi.mock("@/lib/auth", () => ({ getRestaurant: async () => ({ id: "r1", name: "Amaly" }) }));

async function poste(salesLines: any[]) {
  const { POST } = await import("@/app/api/record-sale-movements/route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId: "r1", periodId: "p1", salesLines }),
  }) as any);
  return { status: res.status, corps: await res.json() };
}

/** Somme des sorties enregistrees pour un produit. */
const sorti = (id: string) => mouvements.filter((m) => m.ingredient_id === id).reduce((s, m) => s + m.qty, 0);

beforeEach(() => { mouvements = []; });

describe("Destockage des ventes", () => {
  it("deduit, re-saisit puis supprime : le stock revient au depart", async () => {
    stock = { "ing-pois": 5000 };                    // 5 kg de pois chiches

    await poste([{ recipe_id: "rec-houmous", qty_sold: 10 }]);   // 10 x 100 g
    expect(stock["ing-pois"]).toBe(4000);
    expect(sorti("ing-pois")).toBe(1000);

    await poste([{ recipe_id: "rec-houmous", qty_sold: 15 }]);   // correction a la hausse
    expect(stock["ing-pois"]).toBe(3500);
    expect(sorti("ing-pois")).toBe(1500);            // le cumul, pas 1000 + 1500

    await poste([{ recipe_id: "rec-houmous", qty_sold: 8 }]);    // correction a la baisse
    expect(stock["ing-pois"]).toBe(4200);
    expect(sorti("ing-pois")).toBe(800);

    await poste([]);                                  // suppression du mois
    expect(stock["ing-pois"]).toBe(5000);            // au gramme pres
    expect(sorti("ing-pois")).toBe(0);
  });

  it("vendre plus que le stock ne cree pas de stock a la suppression", async () => {
    stock = { "ing-pois": 500 };                     // 500 g seulement

    const { corps } = await poste([{ recipe_id: "rec-houmous", qty_sold: 10 }]); // il en faudrait 1000
    expect(stock["ing-pois"]).toBe(0);               // borne a zero
    expect(corps.stockInsuffisant).toContain("ing-pois");  // et SIGNALE
    expect(sorti("ing-pois")).toBe(500);             // le grand livre dit la verite : 500 sortis

    await poste([]);                                  // le patron supprime le mois
    expect(stock["ing-pois"]).toBe(500);             // 500, pas 1000
  });

  it("un produit vendu tel quel se deduit a l unite", async () => {
    stock = { "ing-coca": 24 };
    await poste([{ ingredient_id: "ing-coca", qty_sold: 9 }]);
    expect(stock["ing-coca"]).toBe(15);
    await poste([]);
    expect(stock["ing-coca"]).toBe(24);
  });
});
