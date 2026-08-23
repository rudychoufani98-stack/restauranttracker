// =====================================================================
//  Test de bout en bout des exports Excel (hors « Coût produit », couvert
//  par tests/cout-produit.test.ts qui a besoin de son propre jeu de factures).
//  On génère de VRAIS fichiers .xlsx (exceljs) à partir de données
//  piégeuses (produit legacy en g, produit à la pièce revendu, rendement
//  < 100 %, commande annulée, MEP à exclure, TVA 5,5 %) puis on relit
//  chaque cellule pour vérifier les montants un par un.
// =====================================================================
import { describe, it, expect, vi, beforeAll } from "vitest";
import ExcelJS from "exceljs";

// ── Données de test ──────────────────────────────────────────────────
const RESTAURANT = { id: "resto-1", name: "Restaurant Démo" };

const HUILE = {
  id: "huile", name: "Huile olive", category: "Épicerie", unit: "l",
  stock_qty: 15000, cmup: 0.0048, cost_per_base_unit: 0.005,
  pack_price: 24, vat_rate: 5.5, pack_units: 1, unit_size: 5, pack_quantity: 5,
  yield_pct: 100, selling_price: null, suppliers: { name: "Metro" },
};
const TOMATE = {
  id: "tomate", name: "Tomate", category: "Légumes/Fruits", unit: "kg",
  stock_qty: 8000, cmup: 0.0021, cost_per_base_unit: 0.002,
  pack_price: 10, vat_rate: 5.5, pack_units: 1, unit_size: 5, pack_quantity: 5,
  yield_pct: 90, selling_price: null, suppliers: { name: "Pro à Pro" },
};
const COCA = {
  id: "coca", name: "Coca 33cl", category: "Boisson", unit: "unit",
  stock_qty: 48, cmup: 0.45, cost_per_base_unit: 0.5,
  pack_price: 10.8, vat_rate: 20, pack_units: 24, unit_size: 1, pack_quantity: 24,
  yield_pct: 100, selling_price: 2.5, suppliers: { name: "Metro" },
};
// Ancien produit jamais migré : unité "g", tailles déjà en grammes.
const FARINE = {
  id: "farine", name: "Farine T55", category: "Épicerie", unit: "g",
  stock_qty: 25000, cmup: 0.0012, cost_per_base_unit: 0.0012,
  pack_price: 15, vat_rate: 5.5, pack_units: 1, unit_size: 1000, pack_quantity: 1000,
  yield_pct: 100, selling_price: null, suppliers: null,
};
const INGREDIENTS = [COCA, HUILE, FARINE, TOMATE];

const SALADE = { id: "salade", name: "Salade tomate", category: "Entrée", total_cost: 6, menu_price: 8, yield_portions: 3, is_prep: false };
const MEP = { id: "mep", name: "Sauce tomate (MEP)", category: "Sauces", total_cost: 4, menu_price: null, yield_portions: 2, is_prep: true };
const RECIPES = [SALADE, MEP];

const ORDERS = [
  {
    order_number: "BDC-2026-0001", status: "Sent", created_at: "2026-07-10T10:00:00Z", expected_total: 100,
    suppliers: { name: "Metro" },
    purchase_order_lines: [{ quantity: 3, expected_price: 24, ingredients: { name: "Huile olive" } }],
  },
  {
    order_number: "BDC-2026-0002", status: "Cancelled", created_at: "2026-07-12T10:00:00Z", expected_total: 50,
    suppliers: { name: "Pro à Pro" },
    purchase_order_lines: [{ quantity: 2, expected_price: 10, ingredients: { name: "Tomate" } }],
  },
];

const LOSS = {
  created_at: "2026-07-15T10:00:00Z", movement_type: "loss", reference_type: "loss",
  qty: 2000, unit_cost: 0.0021, loss_reason: "DLC dépassée", notes: null,
  ingredients: { name: "Tomate", unit: "kg" },
};
const MOVEMENTS = [
  { created_at: "2026-07-05T10:00:00Z", movement_type: "in", reference_type: "delivery", qty: 5000, unit_cost: 0.0048, loss_reason: null, notes: null, ingredients: { name: "Huile olive", unit: "l" } },
  LOSS,
  { created_at: "2026-07-20T10:00:00Z", movement_type: "out", reference_type: "sale", qty: 300, unit_cost: 0.002, loss_reason: null, notes: null, ingredients: { name: "Tomate", unit: "kg" } },
];

const PERIODS = [{
  month: "2026-07", channel: "dine_in",
  sales_lines: [
    { qty_sold: 10, recipe_id: "salade", ingredient_id: null },
    { qty_sold: 20, recipe_id: null, ingredient_id: "coca" },
  ],
}];

// ── Faux client Supabase (chaînable, résout selon table + filtres) ────
type Filters = { eq: [string, any][]; not: [string, any, any][] };

function resolveData(table: string, f: Filters): any {
  const hasEq = (c: string, v: any) => f.eq.some(([col, val]) => col === c && val === v);
  switch (table) {
    case "ingredients":
      // .not("selling_price","is",null) → uniquement les produits revendus
      return f.not.some(([c]) => c === "selling_price")
        ? INGREDIENTS.filter((i) => i.selling_price != null)
        : INGREDIENTS;
    case "recipes":
      return hasEq("is_prep", false) ? RECIPES.filter((r) => !r.is_prep) : RECIPES;
    case "stock_movements":
      return hasEq("movement_type", "loss") ? [LOSS] : MOVEMENTS;
    case "purchase_orders": return ORDERS;
    case "sales_periods": return PERIODS;
    default: return [];
  }
}

function makeQuery(table: string) {
  const f: Filters = { eq: [], not: [] };
  const q: any = {
    select: () => q, order: () => q, limit: () => q, neq: () => q,
    in: () => q, gte: () => q, lte: () => q,
    eq: (c: string, v: any) => { f.eq.push([c, v]); return q; },
    not: (c: string, op: any, v: any) => { f.not.push([c, op, v]); return q; },
    single: () => Promise.resolve({ data: resolveData(table, f), error: null }),
    maybeSingle: () => Promise.resolve({ data: resolveData(table, f), error: null }),
    then: (ok: any, ko?: any) => Promise.resolve({ data: resolveData(table, f), error: null }).then(ok, ko),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => makeQuery(table),
  }),
}));
vi.mock("@/lib/auth", () => ({ getRestaurant: async () => RESTAURANT }));

// ── Helpers de lecture du classeur ───────────────────────────────────
type Sheet = ExcelJS.Worksheet;

async function runExport(type: string): Promise<Sheet> {
  const { GET } = await import("@/app/api/export/[type]/route");
  const res = await GET({} as any, { params: { type } });
  expect(res.status, `export ${type} doit répondre 200`).toBe(200);
  expect(res.headers.get("Content-Disposition")).toContain(".xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb.worksheets[0];
}

/** Valeurs d'une ligne (1-indexée), colonnes 1..n */
const rowVals = (ws: Sheet, r: number, n = 10) =>
  Array.from({ length: n }, (_, i) => ws.getRow(r).getCell(i + 1).value);

/** Première ligne dont une cellule contient ce texte */
function findRow(ws: Sheet, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= 10; c++) {
      const v = ws.getRow(r).getCell(c).value;
      if (typeof v === "string" && v.includes(text)) return r;
    }
  }
  throw new Error(`Ligne introuvable contenant « ${text} »`);
}
const cellAt = (ws: Sheet, text: string, col: number) => ws.getRow(findRow(ws, text)).getCell(col).value;
const near = (n: any, expected: number) => expect(Number(n)).toBeCloseTo(expected, 4);

// ── Tests ────────────────────────────────────────────────────────────
describe("Export Inventaire valorisé", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("inventaire"); });

  it("affiche le titre du restaurant et les en-têtes", () => {
    expect(String(ws.getCell(1, 1).value)).toContain("Restaurant Démo");
    expect(rowVals(ws, 4, 7)).toEqual(["Catégorie", "Ingrédient", "Fournisseur", "Stock", "Unité", "CMUP / unité", "Valeur"]);
  });

  it("convertit les quantités en kg/L/pce et valorise au CMUP", () => {
    // Huile : 15 000 ml → 15 L ; CMUP 0,0048 €/ml → 4,80 €/L ; valeur 72 €
    near(cellAt(ws, "Huile olive", 4), 15);
    expect(cellAt(ws, "Huile olive", 5)).toBe("L");
    near(cellAt(ws, "Huile olive", 6), 4.8);
    near(cellAt(ws, "Huile olive", 7), 72);
    // Produit à la pièce : pas de division par 1000
    near(cellAt(ws, "Coca 33cl", 4), 48);
    expect(cellAt(ws, "Coca 33cl", 5)).toBe("pce");
    near(cellAt(ws, "Coca 33cl", 6), 0.45);
    near(cellAt(ws, "Coca 33cl", 7), 21.6);
  });

  it("gère un ancien produit en « g » comme des grammes (25 000 g = 25 kg)", () => {
    near(cellAt(ws, "Farine T55", 4), 25);
    expect(cellAt(ws, "Farine T55", 5)).toBe("kg");
    near(cellAt(ws, "Farine T55", 6), 1.2);
    near(cellAt(ws, "Farine T55", 7), 30);
  });

  it("sous-totalise par catégorie et affiche le total du stock", () => {
    near(cellAt(ws, "Sous-total Épicerie", 7), 102);   // 72 + 30
    near(cellAt(ws, "Sous-total Boisson", 7), 21.6);
    near(cellAt(ws, "TOTAL STOCK", 7), 140.4);         // 72 + 16,8 + 21,6 + 30
  });

  it("affiche « — » quand il n'y a pas de fournisseur", () => {
    expect(cellAt(ws, "Farine T55", 3)).toBe("—");
    expect(cellAt(ws, "Huile olive", 3)).toBe("Metro");
  });
});

describe("Export Achats (mercuriale)", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("achats"); });

  it("libelle le conditionnement dans la bonne unité", () => {
    expect(cellAt(ws, "Huile olive", 4)).toBe("5 L");
    expect(cellAt(ws, "Coca 33cl", 4)).toBe("24 × 1 pièce");
    expect(cellAt(ws, "Farine T55", 4)).toBe("1000 g"); // legacy : fidèle, pas « 1000 kg »
  });

  it("calcule le prix TTC et le coût net (rendement déduit)", () => {
    near(cellAt(ws, "Huile olive", 5), 24);        // HT
    near(cellAt(ws, "Huile olive", 7), 25.32);     // TTC = 24 × 1,055
    near(cellAt(ws, "Huile olive", 8), 4.8);       // net = CMUP/L, rendement 100 %
    // Tomate : CMUP 2,10 €/kg, rendement 90 % → 2,3333 €/kg utilisable
    near(cellAt(ws, "Tomate", 8), 2.3333);
    near(cellAt(ws, "Tomate", 9), 90);
  });

  it("n'arrondit pas la TVA 5,5 % en 6 %", () => {
    const r = findRow(ws, "Huile olive");
    near(ws.getRow(r).getCell(6).value, 5.5);
    expect(ws.getRow(r).getCell(6).numFmt).toContain("0.0"); // une décimale conservée
  });

  it("groupe par fournisseur", () => {
    expect(cellAt(ws, "Huile olive", 1)).toBe("Metro");
    expect(cellAt(ws, "Farine T55", 1)).toBe("Sans fournisseur");
  });
});

describe("Export Recettes (fiches techniques)", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("recettes"); });

  it("exclut les mises en place (ce ne sont pas des plats vendus)", () => {
    const all = JSON.stringify(rowValsAll(ws));
    expect(all).toContain("Salade tomate");
    expect(all).not.toContain("Sauce tomate (MEP)");
  });

  it("calcule le coût par portion, le food cost et la marge", () => {
    const r = findRow(ws, "Salade tomate");
    near(ws.getRow(r).getCell(3).value, 3);       // 3 portions
    near(ws.getRow(r).getCell(4).value, 6);       // coût total du batch
    near(ws.getRow(r).getCell(5).value, 2);       // 6 / 3 portions
    near(ws.getRow(r).getCell(6).value, 8);       // prix de vente
    near(ws.getRow(r).getCell(7).value, 0.25);    // FC = 2 / 8 → 25 %
    near(ws.getRow(r).getCell(8).value, 6);       // marge = 8 − 2
    expect(ws.getRow(r).getCell(7).numFmt).toBe("0.0%");
  });
});

describe("Export Commandes", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("commandes"); });

  it("traduit les statuts et détaille chaque ligne", () => {
    expect(cellAt(ws, "BDC-2026-0001", 3)).toBe("Envoyée");
    expect(cellAt(ws, "BDC-2026-0002", 3)).toBe("Annulée");
    const r = findRow(ws, "BDC-2026-0001");
    near(ws.getRow(r).getCell(6).value, 3);     // 3 conditionnements
    near(ws.getRow(r).getCell(7).value, 24);    // prix / colis
    near(ws.getRow(r).getCell(8).value, 72);    // sous-total
  });

  it("exclut les commandes annulées du total", () => {
    near(cellAt(ws, "TOTAL COMMANDES", 8), 100); // 100 seulement, pas 150
  });
});

describe("Export Pertes", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("pertes"); });

  it("valorise la perte au CMUP et affiche la quantité en kg", () => {
    const r = findRow(ws, "Tomate");
    expect(ws.getRow(r).getCell(3).value).toBe("DLC dépassée");
    near(ws.getRow(r).getCell(4).value, 2);      // 2 000 g → 2 kg
    expect(ws.getRow(r).getCell(5).value).toBe("kg");
    near(ws.getRow(r).getCell(6).value, 4.2);    // 2 000 × 0,0021
    near(cellAt(ws, "TOTAL PERTES", 6), 4.2);
  });
});

describe("Export Ventes & marges", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("ventes"); });

  it("compte les plats ET les produits revendus tels quels", () => {
    const rp = findRow(ws, "Salade tomate");
    near(ws.getRow(rp).getCell(4).value, 10);
    near(ws.getRow(rp).getCell(6).value, 80);    // CA = 10 × 8
    near(ws.getRow(rp).getCell(7).value, 20);    // coût = 10 × 2
    near(ws.getRow(rp).getCell(8).value, 60);    // marge

    const rc = findRow(ws, "Coca 33cl");
    near(ws.getRow(rc).getCell(5).value, 2.5);   // prix de vente unitaire
    near(ws.getRow(rc).getCell(7).value, 9);     // coût = 20 × CMUP 0,45 (pas le prix du colis)
    near(ws.getRow(rc).getCell(8).value, 41);
  });

  it("totalise CA, coût matière, marge et food cost", () => {
    const r = findRow(ws, "TOTAL");
    near(ws.getRow(r).getCell(6).value, 130);
    near(ws.getRow(r).getCell(7).value, 29);
    near(ws.getRow(r).getCell(8).value, 101);
    near(ws.getRow(r).getCell(9).value, 29 / 130); // 22,3 %
  });

  it("traduit le canal de vente", () => {
    expect(cellAt(ws, "Salade tomate", 2)).toBe("Sur place");
  });
});

describe("Export Mouvements de stock", () => {
  let ws: Sheet;
  beforeAll(async () => { ws = await runExport("mouvements"); });

  it("nomme l'opération, le sens, et convertit quantité + coût unitaire", () => {
    const r = findRow(ws, "Réception");
    expect(ws.getRow(r).getCell(2).value).toBe("Huile olive");
    expect(ws.getRow(r).getCell(4).value).toBe("+");
    near(ws.getRow(r).getCell(5).value, 5);      // 5 000 ml → 5 L
    expect(ws.getRow(r).getCell(6).value).toBe("L");
    near(ws.getRow(r).getCell(7).value, 4.8);    // €/L
    near(ws.getRow(r).getCell(8).value, 24);     // valeur

    const rv = findRow(ws, "Vente (déstockage)");
    expect(ws.getRow(rv).getCell(4).value).toBe("−");
    near(ws.getRow(rv).getCell(5).value, 0.3);
    near(ws.getRow(rv).getCell(8).value, 0.6);
  });

  it("affiche la cause d'une perte", () => {
    expect(cellAt(ws, "Perte", 9)).toBe("DLC dépassée");
  });
});

describe("Robustesse", () => {
  it("refuse un type d'export inconnu (404)", async () => {
    const { GET } = await import("@/app/api/export/[type]/route");
    const res = await GET({} as any, { params: { type: "nimportequoi" } });
    expect(res.status).toBe(404);
  });
});

// Toutes les valeurs de la feuille, pour les recherches globales
function rowValsAll(ws: Sheet): any[][] {
  const out: any[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) out.push(rowVals(ws, r, 9));
  return out;
}
