// =====================================================================
//  Statistiques de stock dans le temps (onglet Stock → Statistiques).
//  Données piégeuses : réception sans prix connu, ajustement de facture
//  qui n'est pas un achat, mois creux au milieu de l'historique, produit
//  à la pièce, inventaire encore en brouillon.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  isPurchase, isLoss, isConsumption, moveValue, perDisplayUnit,
  withinMonths, purchasePriceSeries, biggestMovers,
  monthRange, monthlySummary, topPurchased, lossesByReason, inventorySeries,
  monthLabel,
  type StatMovement, type StatIngredient,
} from "@/lib/stock-stats";

const mv = (o: Partial<StatMovement>): StatMovement => ({
  ingredient_id: "beurre", movement_type: "in", qty: 1000, unit_cost: 0.004,
  reference_type: "delivery", created_at: "2026-01-10T10:00:00Z", ...o,
});

const BEURRE: StatIngredient = { id: "beurre", name: "Beurre", unit: "kg", cmup: 0.0045 };
const COCA: StatIngredient = { id: "coca", name: "Coca 33cl", unit: "unit", cmup: 0.45 };

describe("classement des mouvements", () => {
  it("compte comme achat une entrée de réception ou de facture", () => {
    expect(isPurchase(mv({ reference_type: "delivery" }))).toBe(true);
    expect(isPurchase(mv({ reference_type: "invoice" }))).toBe(true);
  });

  it("ne compte pas comme achat une entrée d'inventaire ni un ajustement de facture", () => {
    expect(isPurchase(mv({ reference_type: "inventory" }))).toBe(false);
    expect(isPurchase(mv({ movement_type: "adjustment", reference_type: "invoice" }))).toBe(false);
  });

  it("distingue perte et consommation du service", () => {
    expect(isLoss(mv({ movement_type: "loss", reference_type: "loss" }))).toBe(true);
    expect(isConsumption(mv({ movement_type: "out", reference_type: "sale" }))).toBe(true);
    // Une sortie qui n'est pas une vente (correction manuelle) n'est pas de la consommation.
    expect(isConsumption(mv({ movement_type: "out", reference_type: "manual" }))).toBe(false);
  });

  it("valorise un mouvement en euros, quel que soit le signe de la quantité", () => {
    expect(moveValue(mv({ qty: 2000, unit_cost: 0.004 }))).toBeCloseTo(8, 6);
    expect(moveValue(mv({ qty: -2000, unit_cost: 0.004 }))).toBeCloseTo(8, 6);
    expect(moveValue(mv({ unit_cost: null }))).toBe(0);
  });
});

describe("perDisplayUnit", () => {
  it("passe du coût au gramme au coût au kilo", () => {
    expect(perDisplayUnit(0.004, "kg")).toBeCloseTo(4, 6);
    expect(perDisplayUnit(0.004, "g")).toBeCloseTo(4, 6);
    expect(perDisplayUnit(0.002, "l")).toBeCloseTo(2, 6);
  });
  it("laisse un produit à la pièce tel quel", () => {
    expect(perDisplayUnit(0.45, "unit")).toBeCloseTo(0.45, 6);
  });
});

describe("purchasePriceSeries", () => {
  const moves = [
    mv({ created_at: "2026-03-01T10:00:00Z", unit_cost: 0.005 }),
    mv({ created_at: "2026-01-10T10:00:00Z", unit_cost: 0.004 }),
    mv({ created_at: "2026-02-05T10:00:00Z", unit_cost: 0.0045 }),
  ];

  it("rend la série triée dans le temps, convertie au kilo", () => {
    const s = purchasePriceSeries(moves, "beurre", "kg");
    expect(s.map((p) => p.y)).toEqual([4, 4.5, 5]);
  });

  it("écarte les achats sans prix connu plutôt que de faire plonger la courbe à zéro", () => {
    const s = purchasePriceSeries([...moves, mv({ created_at: "2026-04-01T10:00:00Z", unit_cost: 0 })], "beurre", "kg");
    expect(s).toHaveLength(3);
  });

  it("ne mélange pas les produits", () => {
    const s = purchasePriceSeries([...moves, mv({ ingredient_id: "coca", unit_cost: 0.5 })], "coca", "unit");
    expect(s.map((p) => p.y)).toEqual([0.5]);
  });

  it("ignore les sorties et les pertes : ce n'est pas un prix d'achat", () => {
    const s = purchasePriceSeries([mv({ movement_type: "out", reference_type: "sale", unit_cost: 0.009 })], "beurre", "kg");
    expect(s).toEqual([]);
  });
});

describe("biggestMovers", () => {
  const moves = [
    mv({ created_at: "2026-01-10T10:00:00Z", unit_cost: 0.004, qty: 1000 }),
    mv({ created_at: "2026-02-10T10:00:00Z", unit_cost: 0.005, qty: 2000 }),
    mv({ ingredient_id: "coca", created_at: "2026-01-11T10:00:00Z", unit_cost: 0.5, qty: 24 }),
    mv({ ingredient_id: "coca", created_at: "2026-02-11T10:00:00Z", unit_cost: 0.45, qty: 24 }),
  ];
  const movers = biggestMovers(moves, [BEURRE, COCA]);

  it("classe du plus fort renchérissement à la plus forte baisse", () => {
    expect(movers.map((m) => m.id)).toEqual(["beurre", "coca"]);
    expect(movers[0].deltaPct).toBeCloseTo(25, 6);   // 4 → 5 €/kg
    expect(movers[1].deltaPct).toBeCloseTo(-10, 6);  // 0,50 → 0,45 €/pce
  });

  it("cumule le montant dépensé par produit", () => {
    expect(movers[0].spend).toBeCloseTo(1000 * 0.004 + 2000 * 0.005, 6); // 14 €
  });

  it("écarte les produits achetés une seule fois : aucune évolution à montrer", () => {
    expect(biggestMovers([moves[0], moves[2]], [BEURRE, COCA])).toEqual([]);
  });
});

describe("monthRange", () => {
  it("comble les mois vides et franchit le passage à l'année", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("rend un seul mois quand début et fin coïncident", () => {
    expect(monthRange("2026-03", "2026-03")).toEqual(["2026-03"]);
  });
});

describe("monthlySummary", () => {
  const moves = [
    mv({ created_at: "2026-01-10T10:00:00Z", qty: 1000, unit_cost: 0.004 }),                                   // achat 4 €
    mv({ created_at: "2026-01-20T10:00:00Z", movement_type: "loss", reference_type: "loss", qty: 250, unit_cost: 0.004, loss_reason: "DLC dépassée" }), // perte 1 €
    mv({ created_at: "2026-03-05T10:00:00Z", movement_type: "out", reference_type: "sale", qty: 500, unit_cost: 0.004 }),  // conso 2 €
  ];
  const rows = monthlySummary(moves);

  it("garde le mois creux de février pour que le trou se voie sur le graphique", () => {
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(rows[1]).toMatchObject({ achats: 0, conso: 0, pertes: 0, tauxPerte: 0 });
  });

  it("ventile chaque mouvement dans la bonne colonne", () => {
    expect(rows[0].achats).toBeCloseTo(4, 6);
    expect(rows[0].pertes).toBeCloseTo(1, 6);
    expect(rows[2].conso).toBeCloseTo(2, 6);
  });

  it("calcule le taux de perte en part des achats du mois", () => {
    expect(rows[0].tauxPerte).toBeCloseTo(25, 6); // 1 € perdu sur 4 € achetés
  });

  it("ne divise pas par zéro un mois sans achat", () => {
    const only = monthlySummary([mv({ movement_type: "loss", reference_type: "loss", qty: 100, unit_cost: 0.004 })]);
    expect(only[0].tauxPerte).toBe(0);
  });

  it("rend une liste vide plutôt que de planter sans mouvement", () => {
    expect(monthlySummary([])).toEqual([]);
  });
});

describe("withinMonths", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const moves = [
    mv({ created_at: "2026-06-01T10:00:00Z" }),
    mv({ created_at: "2026-01-01T10:00:00Z" }),
    mv({ created_at: "2025-06-01T10:00:00Z" }),
  ];

  it("garde les 6 derniers mois, mois courant inclus", () => {
    expect(withinMonths(moves, 6, now)).toHaveLength(2); // juin 2026 et janvier 2026
  });
  it("rend tout l'historique quand aucune borne n'est demandée", () => {
    expect(withinMonths(moves, null, now)).toHaveLength(3);
  });
});

describe("topPurchased & lossesByReason", () => {
  const moves = [
    mv({ qty: 1000, unit_cost: 0.004 }),                                    // beurre 4 €
    mv({ ingredient_id: "coca", qty: 24, unit_cost: 0.5 }),                 // coca 12 €
    mv({ ingredient_id: "coca", qty: 24, unit_cost: 0.5 }),                 // coca 12 €
    mv({ movement_type: "loss", reference_type: "loss", qty: 500, unit_cost: 0.004, loss_reason: "DLC dépassée" }),
    mv({ movement_type: "loss", reference_type: "loss", qty: 250, unit_cost: 0.004, loss_reason: null }),
  ];

  it("classe les postes d'achat par montant décroissant", () => {
    const top = topPurchased(moves, [BEURRE, COCA]);
    expect(top.map((t) => t.name)).toEqual(["Coca 33cl", "Beurre"]);
    expect(top[0].value).toBeCloseTo(24, 6);
    expect(top[0].count).toBe(2);
  });

  it("nomme les pertes sans cause plutôt que de les perdre", () => {
    const l = lossesByReason(moves);
    expect(l.map((x) => x.name)).toEqual(["DLC dépassée", "Non précisée"]);
    expect(l[0].value).toBeCloseTo(2, 6);
  });

  it("ne classe pas un produit supprimé sous un nom vide", () => {
    expect(topPurchased([mv({ ingredient_id: "disparu" })], [])[0].name).toBe("Produit supprimé");
  });
});

describe("inventorySeries", () => {
  const sessions = [
    {
      created_at: "2026-02-01T10:00:00Z", closing_at: "2026-02-01T23:00:00Z", status: "finalized", kind: "food",
      net_value: -40, inventory_lines: [{ counted_qty: 1000, cmup: 0.004 }, { counted_qty: 500, cmup: 0.01 }],
    },
    {
      created_at: "2026-01-01T10:00:00Z", closing_at: "2026-01-01T23:00:00Z", status: "finalized", kind: "food",
      net_value: -10, inventory_lines: [{ counted_qty: 2000, cmup: 0.004 }],
    },
    { created_at: "2026-03-01T10:00:00Z", status: "draft", kind: "food", net_value: -999, inventory_lines: [{ counted_qty: 9, cmup: 9 }] },
    { created_at: "2026-02-15T10:00:00Z", status: "finalized", kind: "fournitures", net_value: -5, inventory_lines: [] },
  ];

  it("valorise chaque inventaire finalisé et le range dans le temps", () => {
    const pts = inventorySeries(sessions);
    expect(pts).toHaveLength(2);
    expect(pts[0].valeur).toBeCloseTo(8, 6);   // janvier : 2000 × 0,004
    expect(pts[1].valeur).toBeCloseTo(9, 6);   // février : 4 + 5
    expect(pts[1].ecart).toBe(-40);
  });

  it("ignore un inventaire encore en brouillon : ce n'est pas un constat", () => {
    expect(inventorySeries(sessions).some((p) => p.valeur === 81)).toBe(false);
  });

  it("sépare l'alimentaire des fournitures", () => {
    expect(inventorySeries(sessions, "fournitures")).toHaveLength(1);
  });
});

describe("monthLabel", () => {
  it("écrit un mois lisible en français", () => {
    expect(monthLabel("2026-01")).toBe("janv. 26");
    expect(monthLabel("2026-12")).toBe("déc. 26");
  });
});
