// =====================================================================
//  Export « Coût produit » — évolution du prix d'achat au fil des
//  commandes. Deux niveaux :
//    1. la logique pure (lib/cost-history.ts), pièce par pièce ;
//    2. le classeur .xlsx réellement produit par la route, relu cellule
//       par cellule avec des données piégeuses (facture brouillon à
//       ignorer, achat hors commande, produit à la pièce).
// =====================================================================
import { describe, it, expect, vi, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { buildPurchaseHistory, summarizePurchases, packSize } from "@/lib/cost-history";

// ── 1. Logique pure ──────────────────────────────────────────────────
const INVOICES = [
  { id: "inv3", invoice_number: "F-003", invoice_date: "2026-03-10", po_id: "po3" },
  { id: "inv1", invoice_number: "F-001", invoice_date: "2026-01-05", po_id: "po1" },
  { id: "inv2", invoice_number: "F-002", invoice_date: "2026-02-08", po_id: "po2" },
];
const POS = [
  { id: "po1", order_number: "BDC-1", suppliers: { name: "Metro" } },
  { id: "po2", order_number: "BDC-2", suppliers: { name: "Metro" } },
  { id: "po3", order_number: "BDC-3", suppliers: { name: "Rungis" } },
];
const PO_LINES = [
  { po_id: "po1", ingredient_id: "beurre", expected_price: 40 },
  { po_id: "po2", ingredient_id: "beurre", expected_price: 42 },
  { po_id: "po3", ingredient_id: "beurre", expected_price: 44 },
];
const INV_LINES = [
  { invoice_id: "inv2", ingredient_id: "beurre", quantity: 3, unit_price: 45 },
  { invoice_id: "inv1", ingredient_id: "beurre", quantity: 2, unit_price: 40 },
  { invoice_id: "inv3", ingredient_id: "beurre", quantity: 1, unit_price: 50 },
];
const hist = () => buildPurchaseHistory({ invoices: INVOICES, invoiceLines: INV_LINES, purchaseOrders: POS, poLines: PO_LINES });

describe("buildPurchaseHistory", () => {
  it("remet les achats dans l'ordre chronologique, quel que soit l'ordre des lignes", () => {
    const beurre = hist().get("beurre")!;
    expect(beurre.map((p) => p.date)).toEqual(["2026-01-05", "2026-02-08", "2026-03-10"]);
    expect(beurre.map((p) => p.unitPrice)).toEqual([40, 45, 50]);
  });

  it("rattache le fournisseur et le numéro de facture de la bonne commande", () => {
    const beurre = hist().get("beurre")!;
    expect(beurre[0].supplier).toBe("Metro");
    expect(beurre[2].supplier).toBe("Rungis");
    expect(beurre[1].invoiceNumber).toBe("F-002");
  });

  it("conserve le prix commandé pour pouvoir le comparer au prix facturé", () => {
    expect(hist().get("beurre")!.map((p) => p.expected)).toEqual([40, 42, 44]);
  });

  it("retombe sur le numéro de commande quand la facture n'en a pas", () => {
    const h = buildPurchaseHistory({
      invoices: [{ id: "inv1", invoice_number: null, invoice_date: "2026-01-05", po_id: "po1" }],
      invoiceLines: [{ invoice_id: "inv1", ingredient_id: "beurre", quantity: 1, unit_price: 40 }],
      purchaseOrders: POS, poLines: PO_LINES,
    });
    expect(h.get("beurre")![0].invoiceNumber).toBe("BDC-1");
  });

  it("ignore les lignes sans produit ou rattachées à une facture absente", () => {
    const h = buildPurchaseHistory({
      invoices: INVOICES,
      invoiceLines: [
        { invoice_id: "inv1", ingredient_id: null, quantity: 1, unit_price: 9 },
        { invoice_id: "facture-fantome", ingredient_id: "beurre", quantity: 1, unit_price: 9 },
      ],
      purchaseOrders: POS, poLines: PO_LINES,
    });
    expect(h.size).toBe(0);
  });

  it("laisse le prix commandé vide pour une facture sans bon de commande", () => {
    const h = buildPurchaseHistory({
      invoices: [{ id: "inv1", invoice_number: "F-001", invoice_date: "2026-01-05", po_id: null }],
      invoiceLines: [{ invoice_id: "inv1", ingredient_id: "beurre", quantity: 1, unit_price: 40 }],
      purchaseOrders: POS, poLines: PO_LINES,
    });
    expect(h.get("beurre")![0].expected).toBeNull();
    expect(h.get("beurre")![0].supplier).toBe("—");
  });
});

describe("summarizePurchases", () => {
  const s = summarizePurchases(hist().get("beurre")!);

  it("mesure la dérive entre le premier et le dernier achat", () => {
    expect([s.first, s.last, s.deltaEur]).toEqual([40, 50, 10]);
    expect(s.deltaPct).toBeCloseTo(25, 6);
  });

  it("donne l'amplitude et la moyenne pondérée par les quantités", () => {
    expect([s.min, s.max, s.qtyTotal]).toEqual([40, 50, 6]);
    expect(s.spend).toBe(2 * 40 + 3 * 45 + 1 * 50); // 265 €
    expect(s.wavg).toBeCloseTo(265 / 6, 6); // ≠ moyenne simple (45)
  });

  it("n'annonce aucune variation sur un produit acheté une seule fois", () => {
    const one = summarizePurchases([{ date: "2026-01-05", invoiceNumber: "F-1", supplier: "Metro", qty: 2, unitPrice: 12, expected: 12 }]);
    expect([one.deltaEur, one.deltaPct, one.wavg]).toEqual([0, 0, 12]);
  });

  it("ne divise pas par zéro quand le premier prix est nul (offert, geste commercial)", () => {
    const free = summarizePurchases([
      { date: "2026-01-05", invoiceNumber: "F-1", supplier: "Metro", qty: 1, unitPrice: 0, expected: null },
      { date: "2026-02-05", invoiceNumber: "F-2", supplier: "Metro", qty: 1, unitPrice: 8, expected: null },
    ]);
    expect(free.deltaEur).toBe(8);
    expect(free.deltaPct).toBe(0);
  });

  it("retombe sur le dernier prix quand rien n'a été quantifié", () => {
    expect(summarizePurchases([{ date: "2026-01-05", invoiceNumber: "F-1", supplier: "Metro", qty: 0, unitPrice: 7, expected: null }]).wavg).toBe(7);
  });
});

describe("packSize", () => {
  it("utilise pack_quantity quand il est renseigné", () => {
    expect(packSize({ pack_quantity: 5, pack_units: 6, unit_size: 0.75 })).toBe(5);
  });
  it("retombe sur pack_units × unit_size sinon (6 × 0,75 L = 4,5 L)", () => {
    expect(packSize({ pack_quantity: 0, pack_units: 6, unit_size: 0.75 })).toBeCloseTo(4.5, 6);
  });
  it("ne renvoie jamais 0 : le coût au kg doit toujours être calculable", () => {
    expect(packSize({ pack_quantity: 0, pack_units: 0, unit_size: 0 })).toBe(1);
    expect(packSize(null)).toBe(1);
  });
});

// ── 2. Le classeur réellement produit par la route ───────────────────
const RESTAURANT = { id: "resto-1", name: "Restaurant Démo" };

const DB_INGREDIENTS = [
  // Colis de 10 kg : le coût au kg est le prix du colis ÷ 10.
  { id: "beurre", name: "Beurre AOP", category: "Crèmerie", unit: "kg", pack_units: 1, unit_size: 10,
    pack_quantity: 10, cmup: 0.0045, cost_per_base_unit: 0.005, suppliers: { name: "Metro" } },
  // Produit à la pièce : pas de division par 1000 sur le coût unitaire.
  { id: "coca", name: "Coca 33cl", category: "Boisson", unit: "unit", pack_units: 24, unit_size: 1,
    pack_quantity: 24, cmup: 0.45, cost_per_base_unit: 0.5, suppliers: { name: "Metro" } },
];
// inv-brouillon n'est PAS validée : elle ne doit peser sur aucun calcul.
const DB_INVOICES_ALL = [
  { id: "inv1", invoice_number: "F-001", invoice_date: "2026-01-05", created_at: "2026-01-05", po_id: "po1", validated: true },
  { id: "inv2", invoice_number: "F-002", invoice_date: "2026-02-08", created_at: "2026-02-08", po_id: "po2", validated: true },
  { id: "inv-brouillon", invoice_number: "F-XXX", invoice_date: "2026-02-20", created_at: "2026-02-20", po_id: "po2", validated: false },
  { id: "inv3", invoice_number: "F-003", invoice_date: "2026-03-01", created_at: "2026-03-01", po_id: null, validated: true },
];
const DB_INV_LINES = [
  { invoice_id: "inv1", ingredient_id: "beurre", quantity: 2, unit_price: 40 },
  { invoice_id: "inv2", ingredient_id: "beurre", quantity: 3, unit_price: 50 },
  { invoice_id: "inv-brouillon", ingredient_id: "beurre", quantity: 99, unit_price: 999 },
  { invoice_id: "inv3", ingredient_id: "coca", quantity: 4, unit_price: 12 },
];
const DB_POS = [
  { id: "po1", order_number: "BDC-1", suppliers: { name: "Metro" } },
  { id: "po2", order_number: "BDC-2", suppliers: { name: "Metro" } },
];
const DB_PO_LINES = [
  { po_id: "po1", ingredient_id: "beurre", expected_price: 40 },
  { po_id: "po2", ingredient_id: "beurre", expected_price: 45 }, // facturé 50 → +5 € d'écart
];

type Filters = { eq: [string, any][] };
function resolveData(table: string, f: Filters): any {
  const hasEq = (c: string, v: any) => f.eq.some(([col, val]) => col === c && val === v);
  switch (table) {
    case "invoices":
      // La route ne demande que les factures validées.
      return hasEq("validated", true) ? DB_INVOICES_ALL.filter((i) => i.validated) : DB_INVOICES_ALL;
    case "invoice_lines": return DB_INV_LINES;
    case "purchase_orders": return DB_POS;
    case "purchase_order_lines": return DB_PO_LINES;
    case "ingredients": return DB_INGREDIENTS;
    default: return [];
  }
}
function makeQuery(table: string) {
  const f: Filters = { eq: [] };
  const q: any = {
    select: () => q, order: () => q, limit: () => q, neq: () => q, not: () => q, gte: () => q, lte: () => q,
    eq: (c: string, v: any) => { f.eq.push([c, v]); return q; },
    in: () => Promise.resolve({ data: resolveData(table, f), error: null }),
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

function findRow(ws: ExcelJS.Worksheet, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= 15; c++) {
      const v = ws.getRow(r).getCell(c).value;
      if (typeof v === "string" && v.includes(text)) return r;
    }
  }
  throw new Error(`Ligne introuvable contenant « ${text} »`);
}

describe("Export Coût produit (classeur complet)", () => {
  let synth: ExcelJS.Worksheet;
  let detail: ExcelJS.Worksheet;

  beforeAll(async () => {
    const { GET } = await import("@/app/api/export/[type]/route");
    const res = await GET({} as any, { params: { type: "cout-produit" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("Cout_produit_");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    synth = wb.getWorksheet("Synthèse")!;
    detail = wb.getWorksheet("Détail achats")!;
  });

  it("produit deux feuilles nommées et titrées", () => {
    expect(synth).toBeDefined();
    expect(detail).toBeDefined();
    expect(String(synth.getCell(1, 1).value)).toContain("Restaurant Démo");
  });

  it("chiffre la dérive du beurre : 40 € → 50 €, soit +10 € (+25 %)", () => {
    const r = synth.getRow(findRow(synth, "Beurre AOP"));
    expect(r.getCell(5).value).toBe(2);   // 2 achats — la facture brouillon est exclue
    expect(r.getCell(6).value).toBe(40);  // 1er prix
    expect(r.getCell(7).value).toBe(50);  // dernier prix
    expect(r.getCell(8).value).toBe(10);  // variation €
    expect(r.getCell(9).value).toBe(25);  // variation %
  });

  it("ignore complètement la facture non validée (999 € n'apparaît nulle part)", () => {
    const r = synth.getRow(findRow(synth, "Beurre AOP"));
    expect(r.getCell(11).value).toBe(50);        // prix maxi, pas 999
    expect(r.getCell(15).value).toBe(2 * 40 + 3 * 50); // 230 €, pas 99 × 999
  });

  it("pondère la moyenne par les quantités (230 € / 5 colis = 46 €, pas 45 €)", () => {
    const r = synth.getRow(findRow(synth, "Beurre AOP"));
    expect(Number(r.getCell(12).value)).toBeCloseTo(46, 6);
  });

  it("ramène le prix du colis au kg (50 € le colis de 10 kg = 5 €/kg)", () => {
    const r = synth.getRow(findRow(synth, "Beurre AOP"));
    expect(r.getCell(4).value).toBe("10 kg");
    expect(r.getCell(13).value).toBe(5);
  });

  it("traite un produit à la pièce sans le diviser par 1000", () => {
    const r = synth.getRow(findRow(synth, "Coca 33cl"));
    expect(r.getCell(4).value).toBe("24 pce");
    expect(Number(r.getCell(13).value)).toBeCloseTo(12 / 24, 6); // 0,50 € la pièce
  });

  it("colore la hausse en rouge", () => {
    const r = synth.getRow(findRow(synth, "Beurre AOP"));
    expect((r.getCell(8).font as any)?.color?.argb).toBe("FFDC2626");
  });

  it("totalise les achats facturés", () => {
    const r = synth.getRow(findRow(synth, "TOTAL ACHATS FACTURÉS"));
    expect(r.getCell(15).value).toBe(230 + 4 * 12); // beurre + coca
  });

  it("détaille chaque achat et l'écart avec le précédent", () => {
    const head = findRow(detail, "Beurre AOP");
    const first = detail.getRow(head + 1);
    const second = detail.getRow(head + 2);
    expect(first.getCell(3).value).toBe("F-001");
    expect(first.getCell(8).value).toBe("—"); // premier achat : aucun précédent
    expect(second.getCell(3).value).toBe("F-002");
    expect(second.getCell(8).value).toBe(10); // +10 € vs achat précédent
    expect(second.getCell(9).value).toBe(25); // +25 %
  });

  it("montre quand le fournisseur facture plus cher qu'il n'avait annoncé", () => {
    const second = detail.getRow(findRow(detail, "Beurre AOP") + 2);
    expect(second.getCell(10).value).toBe(45); // prix commandé
    expect(second.getCell(11).value).toBe(5);  // facturé 50 → +5 €
  });

  it("laisse les colonnes de commande vides pour un achat hors bon de commande", () => {
    const coca = detail.getRow(findRow(detail, "Coca 33cl") + 1);
    expect(coca.getCell(4).value).toBe("—");  // pas de fournisseur rattaché
    expect(coca.getCell(10).value).toBe("—"); // pas de prix commandé
    expect(coca.getCell(11).value).toBe("—");
  });
});
