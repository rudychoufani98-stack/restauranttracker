// =====================================================================
//  Alertes d'écart de prix — les trois signaux de l'onglet Statistiques.
//
//  On rejoue des situations qui arrivent vraiment en cuisine :
//  un fournisseur qui facture plus cher que le bon de commande, un produit
//  qui grimpe au fil de l'année, et des fiches techniques qui décrochent du
//  prix réel parce que le CMUP est en retard.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  alerteFacture, alerteHausse, alerteCmup, buildPriceAlerts, totalAContester,
  pricePerDisplayUnit, costUsedByRecipes, priceSeriePoints,
  SEUIL_HAUSSE_PCT, SEUIL_CMUP_PCT, SEUIL_FACTURE_PCT,
  type AlertIngredient,
} from "@/lib/price-alerts";
import { summarizePurchases, type Purchase } from "@/lib/cost-history";

const achat = (date: string, unitPrice: number, qty = 1, expected: number | null = null): Purchase => ({
  date, unitPrice, qty, expected, invoiceNumber: `F-${date}`, supplier: "Metro",
});

// Tomate : colis de 5 kg, stock 20 kg valorisé à 2,00 €/kg.
const tomate: AlertIngredient = {
  id: "tom", name: "Tomate", unit: "kg",
  cmup: 0.002, cost_per_base_unit: 0.002, stock_qty: 20000,
  pack_quantity: 5, pack_units: 1, unit_size: 5,
};

describe("Conversions de base", () => {
  it("prix du colis → prix au kg", () => {
    expect(pricePerDisplayUnit(12.5, 5)).toBeCloseTo(2.5, 6);
    // Une taille de colis inconnue ne doit pas produire l'infini.
    expect(pricePerDisplayUnit(12.5, 0)).toBe(0);
  });

  it("le coût utilisé par les recettes est le CMUP ramené au kg", () => {
    expect(costUsedByRecipes(tomate)).toBeCloseTo(2, 6);
    // Sans CMUP, on retombe sur le coût d'achat de la fiche produit.
    expect(costUsedByRecipes({ ...tomate, cmup: null })).toBeCloseTo(2, 6);
    // Produit à la pièce : pas de ×1000.
    expect(costUsedByRecipes({ id: "c", name: "Coca", unit: "unit", cmup: 0.45 })).toBeCloseTo(0.45, 6);
  });

  it("la courbe est triée dans le temps et ignore les dates illisibles", () => {
    const pts = priceSeriePoints(
      [achat("2026-03-01", 10), achat("", 99), achat("2026-01-15", 9)],
      5,
    );
    expect(pts).toHaveLength(2);
    expect(pts[0].y).toBeCloseTo(1.8, 6);   // 9 € / 5 kg, le plus ancien d'abord
    expect(pts[1].y).toBeCloseTo(2, 6);
  });
});

describe("Alerte 1 — facturé plus cher que commandé", () => {
  it("signale un colis facturé 12,50 € pour 12,00 € commandés", () => {
    const a = alerteFacture(tomate, [achat("2026-08-01", 12.5, 4, 12)]);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("facture");
    expect(a!.ecartPct).toBeCloseTo(4.1667, 3);
    expect(a!.impactEur).toBeCloseTo(2, 6);          // 0,50 € × 4 colis
    expect(a!.detail).toContain("12,50 €");
    expect(a!.detail).toContain("12,00 €");
    expect(a!.action).toContain("Metro");
  });

  it("se tait quand la facture est conforme, ou moins chère", () => {
    expect(alerteFacture(tomate, [achat("2026-08-01", 12, 4, 12)])).toBeNull();
    expect(alerteFacture(tomate, [achat("2026-08-01", 11, 4, 12)])).toBeNull();
  });

  it("tolère un arrondi sous le seuil", () => {
    // +1 % : sous SEUIL_FACTURE_PCT, on ne dérange pas le restaurateur.
    expect(SEUIL_FACTURE_PCT).toBe(2);
    expect(alerteFacture(tomate, [achat("2026-08-01", 12.12, 1, 12)])).toBeNull();
  });

  it("ne dit rien si la commande n'annonçait aucun prix", () => {
    expect(alerteFacture(tomate, [achat("2026-08-01", 12.5, 4, null)])).toBeNull();
  });

  it("ne regarde QUE le dernier achat (un litige ancien est déjà traité)", () => {
    const a = alerteFacture(tomate, [achat("2026-01-01", 20, 1, 12), achat("2026-08-01", 12, 1, 12)]);
    expect(a).toBeNull();
  });
});

describe("Alerte 2 — le prix monte", () => {
  const serie = [achat("2026-01-10", 10, 10), achat("2026-04-10", 11, 10), achat("2026-08-10", 12.5, 10)];

  it("chiffre la hausse depuis le premier achat et son coût sur le volume", () => {
    const a = alerteHausse(tomate, serie, summarizePurchases(serie));
    expect(a).not.toBeNull();
    expect(a!.ecartPct).toBeCloseTo(25, 6);          // 10 € → 12,50 €
    // Moyenne pondérée = 11,1667 € ; (12,50 − 11,1667) × 30 colis = 40 €
    expect(a!.impactEur).toBeCloseTo(40, 4);
    expect(a!.detail).toContain("3 achats");
  });

  it("se tait sous le seuil de 10 %", () => {
    expect(SEUIL_HAUSSE_PCT).toBe(10);
    const petite = [achat("2026-01-10", 10), achat("2026-08-10", 10.5)];
    expect(alerteHausse(tomate, petite, summarizePurchases(petite))).toBeNull();
  });

  it("se tait quand le prix BAISSE (c'est une bonne nouvelle, pas une alerte)", () => {
    const baisse = [achat("2026-01-10", 12), achat("2026-08-10", 9)];
    expect(alerteHausse(tomate, baisse, summarizePurchases(baisse))).toBeNull();
  });

  it("ne se prononce pas sur un seul achat", () => {
    const un = [achat("2026-08-10", 12.5)];
    expect(alerteHausse(tomate, un, summarizePurchases(un))).toBeNull();
  });
});

describe("Alerte 3 — les fiches techniques décrochent du prix réel", () => {
  it("prévient que les plats sont calculés trop bas quand le prix a grimpé", () => {
    // Payé 2,50 €/kg (12,50 € le colis de 5 kg), fiches calculées à 2,00 €/kg.
    const serie = [achat("2026-08-10", 12.5, 4)];
    const a = alerteCmup(tomate, summarizePurchases(serie));
    expect(a).not.toBeNull();
    expect(a!.ecartPct).toBeCloseTo(25, 6);
    expect(a!.impactEur).toBeCloseTo(10, 6);         // 0,50 €/kg × 20 kg en stock
    expect(a!.titre).toContain("trop bas");
    expect(a!.detail).toContain("2,00 €/kg");
    expect(a!.detail).toContain("2,50 €/kg");
    expect(a!.action).toContain("sous-estimé");
  });

  it("prévient aussi dans l'autre sens : marge meilleure qu'affichée", () => {
    const serie = [achat("2026-08-10", 7.5, 4)];      // 1,50 €/kg
    const a = alerteCmup(tomate, summarizePurchases(serie));
    expect(a).not.toBeNull();
    expect(a!.ecartPct).toBeCloseTo(-25, 6);
    expect(a!.titre).toContain("trop haut");
    expect(a!.action).toContain("surestimé");
  });

  it("accepte l'écart normal d'un CMUP qui suit avec un temps de retard", () => {
    expect(SEUIL_CMUP_PCT).toBe(10);
    const serie = [achat("2026-08-10", 10.4, 4)];     // 2,08 €/kg vs 2,00 → +4 %
    expect(alerteCmup(tomate, summarizePurchases(serie))).toBeNull();
  });

  it("alerte même sans stock : les recettes utilisent le CMUP quoi qu'il arrive", () => {
    const serie = [achat("2026-08-10", 12.5, 4)];
    const a = alerteCmup({ ...tomate, stock_qty: 0 }, summarizePurchases(serie));
    expect(a).not.toBeNull();
    expect(a!.impactEur).toBe(0);                     // rien à revaloriser, mais l'écart reste vrai
  });

  it("ne divise pas par zéro sur un produit sans coût connu", () => {
    const serie = [achat("2026-08-10", 12.5)];
    expect(alerteCmup({ ...tomate, cmup: 0, cost_per_base_unit: 0 }, summarizePurchases(serie))).toBeNull();
  });

  it("gère un produit à la pièce sans conversion ×1000", () => {
    const coca: AlertIngredient = {
      id: "coca", name: "Coca 33cl", unit: "unit",
      cmup: 0.45, stock_qty: 100, pack_quantity: 24,
    };
    const serie = [achat("2026-08-10", 13.2, 2)];     // 0,55 €/pièce
    const a = alerteCmup(coca, summarizePurchases(serie));
    expect(a!.ecartPct).toBeCloseTo(22.222, 3);
    expect(a!.detail).toContain("/pce");
  });
});

describe("Assemblage : les alertes les plus coûteuses d'abord", () => {
  const ings = new Map<string, AlertIngredient>([
    ["tom", tomate],
    ["hui", { id: "hui", name: "Huile olive", unit: "l", cmup: 0.0048, stock_qty: 15000, pack_quantity: 5 }],
    ["gob", { id: "gob", name: "Gobelets", unit: "unit", cmup: 0.08, stock_qty: 200, pack_quantity: 100 }],
  ]);

  const purchases = new Map<string, Purchase[]>([
    // Tomate : facturée plus cher QUE commandé + prix qui monte + CMUP décroché
    ["tom", [achat("2026-01-10", 10, 10), achat("2026-08-10", 12.5, 10, 12)]],
    // Huile : stable et conforme — aucune alerte
    ["hui", [achat("2026-01-10", 24, 3, 24), achat("2026-08-10", 24, 3, 24)]],
    // Gobelets : petite hausse sous le seuil
    ["gob", [achat("2026-01-10", 8, 2), achat("2026-08-10", 8.4, 2)]],
  ]);

  it("ne remonte que ce qui mérite l'attention", () => {
    const alerts = buildPriceAlerts(purchases, ings);
    const noms = Array.from(new Set(alerts.map((a) => a.name)));
    expect(noms).toEqual(["Tomate"]);                 // ni l'huile ni les gobelets
    expect(alerts.map((a) => a.kind).sort()).toEqual(["cmup", "facture", "hausse"]);
  });

  it("classe par montant en jeu, du plus lourd au plus léger", () => {
    const alerts = buildPriceAlerts(purchases, ings);
    for (let i = 1; i < alerts.length; i++) {
      expect(Math.abs(alerts[i - 1].impactEur)).toBeGreaterThanOrEqual(Math.abs(alerts[i].impactEur) - 1e-9);
    }
  });

  it("totalise ce qu'il y a à contester auprès des fournisseurs", () => {
    const alerts = buildPriceAlerts(purchases, ings);
    // Tomate : (12,50 − 12,00) × 10 colis = 5 €. L'huile est conforme.
    expect(totalAContester(alerts)).toBeCloseTo(5, 6);
  });

  it("ignore un produit supprimé de la fiche mais présent dans l'historique", () => {
    const orphelin = new Map<string, Purchase[]>([["inconnu", [achat("2026-08-10", 50, 1, 10)]]]);
    expect(buildPriceAlerts(orphelin, ings)).toEqual([]);
  });

  it("ne renvoie rien quand aucun achat n'est facturé", () => {
    expect(buildPriceAlerts(new Map(), ings)).toEqual([]);
  });
});
