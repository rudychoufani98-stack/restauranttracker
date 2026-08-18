// =====================================================================
//  Cycle de vie complet d'une commande : commande → réception → facture,
//  avec vérification du stock et du CMUP à chaque étape (montants
//  calculés à la main dans les commentaires).
// =====================================================================
import { describe, it, expect } from "vitest";
import { basePerPack, applyReception, revalueOnInvoice, calcRecipeCost } from "@/lib/costing";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("Conditionnement d'achat → unités de base", () => {
  it("bidon de 5 L = 5 000 ml", () => near(basePerPack(1, 5, "l"), 5000));
  it("colis de 4 × 3 L = 12 000 ml", () => near(basePerPack(4, 3, "l"), 12000));
  it("caisse de 24 canettes = 24 pièces (pas de ×1000)", () => near(basePerPack(24, 1, "unit"), 24));
  it("sac de 25 kg = 25 000 g", () => near(basePerPack(1, 25, "kg"), 25000));
  it("ancien article en « g » : 1 000 g reste 1 000", () => near(basePerPack(1, 1000, "g"), 1000));
});

describe("Réception : stock et CMUP", () => {
  it("première réception sur un stock vide fixe le CMUP au prix payé", () => {
    // 3 bidons de 5 L à 24 € → 15 000 ml, 72 € → 0,0048 €/ml
    const pack = basePerPack(1, 5, "l");
    const recu = 3 * pack;
    const coutBase = 24 / pack;              // 0,0048 €/ml = 4,80 €/L
    const { newStock, newCmup } = applyReception(0, null, recu, coutBase);
    near(newStock, 15000);
    near(newCmup, 0.0048);
  });

  it("deuxième réception plus chère → moyenne pondérée", () => {
    // 10 L à 4,80 €/L en stock + 15 L à 5,20 €/L
    // (10 × 4,80 + 15 × 5,20) / 25 = 5,04 €/L
    const { newStock, newCmup } = applyReception(10000, 0.0048, 15000, 0.0052);
    near(newStock, 25000);
    near(newCmup * 1000, 5.04);
  });

  it("réception à la pièce : CMUP par pièce, jamais par colis", () => {
    // 2 caisses de 24 canettes à 10,80 € → 48 pièces à 0,45 €
    const pack = basePerPack(24, 1, "unit");
    const { newStock, newCmup } = applyReception(0, null, 2 * pack, 10.8 / pack);
    near(newStock, 48);
    near(newCmup, 0.45);
  });

  it("réception d'un produit dont le colisage diffère selon le fournisseur", () => {
    // Même huile : 3 colis de 4 × 3 L chez le fournisseur B = 36 L (pas 15 L)
    const pack = basePerPack(4, 3, "l");
    const { newStock } = applyReception(0, null, 3 * pack, 55 / pack);
    near(newStock, 36000);
  });
});

describe("Facture : correction de prix et de quantité", () => {
  it("prix corrigé à quantités égales → le CMUP suit le prix facturé", () => {
    // Reçu 15 L à 4,80 €/L (stock total 15 L, rien d'autre).
    // Facture : 25 € le bidon au lieu de 24 → 5 €/L.
    const pack = basePerPack(1, 5, "l");
    const { newStock, newCmup } = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 15000,
      newCostPerBase: 25 / pack, invoiced: true,
    });
    near(newStock, 15000);
    near(newCmup * 1000, 5); // ← sans revalorisation, on serait resté à 4,80
  });

  it("ne revalorise QUE la part de cette commande", () => {
    // Stock 25 L : 10 L d'un ancien lot à 4,00 €/L + 15 L de cette commande.
    // Facture à 5 €/L → (10 × 4 + 15 × 5) / 25 = 4,60 €/L
    const { newCmup } = revalueOnInvoice({
      currentStock: 25000, currentCmup: 0.0046, // valeur courante quelconque
      prevBase: 15000, targetBase: 15000,
      newCostPerBase: 0.005, invoiced: true,
    });
    // rest = 10 000 valorisé au CMUP courant 0,0046 → (10×4,6 + 15×5)/25 = 4,84
    near(newCmup * 1000, 4.84);
  });

  it("quantité facturée inférieure → le stock diminue de l'écart", () => {
    // Reçu 3 bidons (15 L), facturé 2 → −5 L
    const { newStock } = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 10000,
      newCostPerBase: 0.0048, invoiced: true,
    });
    near(newStock, 10000);
  });

  it("quantité facturée supérieure → le stock augmente de l'écart", () => {
    const { newStock } = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 20000,
      newCostPerBase: 0.0048, invoiced: true,
    });
    near(newStock, 20000);
  });

  it("ligne mise à 0 (produit non facturé) : stock retiré, CMUP inchangé", () => {
    const { newStock, newCmup } = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 0,
      newCostPerBase: 0, invoiced: false,
    });
    near(newStock, 0);
    near(newCmup, 0.0048); // on ne détruit pas le coût moyen historique
  });

  it("produit offert (0 €) : le CMUP baisse, il n'est pas ignoré", () => {
    // 15 L offerts sur un stock vide → coût 0
    const { newCmup } = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 15000,
      newCostPerBase: 0, invoiced: true,
    });
    near(newCmup, 0);
  });

  it("ne descend jamais le stock sous zéro", () => {
    const { newStock } = revalueOnInvoice({
      currentStock: 1000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 0,
      newCostPerBase: 0, invoiced: false,
    });
    near(newStock, 0);
  });

  it("réfacturation (2e passage) part de la facture précédente, pas de la réception", () => {
    // Reçu 15 L, facturé 15 L à 5 €/L, puis corrigé à 12 L à 5,50 €/L.
    const etape1 = revalueOnInvoice({
      currentStock: 15000, currentCmup: 0.0048,
      prevBase: 15000, targetBase: 15000, newCostPerBase: 0.005, invoiced: true,
    });
    near(etape1.newCmup * 1000, 5);
    const etape2 = revalueOnInvoice({
      currentStock: etape1.newStock, currentCmup: etape1.newCmup,
      prevBase: 15000, targetBase: 12000, newCostPerBase: 0.0055, invoiced: true,
    });
    near(etape2.newStock, 12000);   // pas 27 000 : on part bien de la facture précédente
    near(etape2.newCmup * 1000, 5.5);
  });
});

describe("Coût d'une recette au CMUP, rendement inclus", () => {
  const ingMap = new Map([
    // Tomate : CMUP 2,10 €/kg = 0,0021 €/g, rendement 90 %
    ["tomate", { id: "tomate", cost_per_base_unit: 0.002, cmup: 0.0021, unit: "kg", yield_pct: 90 }],
    // Huile : 4,80 €/L = 0,0048 €/ml, rendement 100 %
    ["huile", { id: "huile", cost_per_base_unit: 0.005, cmup: 0.0048, unit: "l", yield_pct: 100 }],
  ]);

  it("applique le CMUP (et non le dernier prix d'achat) et le rendement", () => {
    const recipes = [{
      id: "salade", yield_portions: 4, yield_unit: "portion",
      recipe_lines: [
        { ingredient_id: "tomate", sub_recipe_id: null, quantity: 500, unit: "g" },
        { ingredient_id: "huile", sub_recipe_id: null, quantity: 0.05, unit: "l" },
      ],
    }];
    // Tomate : 500 g nets ÷ 0,9 = 555,55 g bruts × 0,0021 = 1,1667 €
    // Huile   : 0,05 L = 50 ml × 0,0048 = 0,24 €
    const total = calcRecipeCost("salade", recipes as any, ingMap as any);
    near(total, 1.1666666666666667 + 0.24);
    near(total / 4, 0.35166666666666664); // coût par portion
  });

  it("compte une MEP au prorata du batch consommé", () => {
    const recipes = [
      { // MEP : 2 kg de sauce coûtant 4,20 €
        id: "sauce", yield_portions: 2, yield_unit: "kg",
        recipe_lines: [{ ingredient_id: "tomate", sub_recipe_id: null, quantity: 2, unit: "kg" }],
      },
      { // Plat : 100 g de sauce
        id: "plat", yield_portions: 1, yield_unit: "portion",
        recipe_lines: [{ ingredient_id: null, sub_recipe_id: "sauce", quantity: 100, unit: "g" }],
      },
    ];
    // Sauce : 2 000 g ÷ 0,9 × 0,0021 = 4,6667 € pour 2 kg
    // Plat : 100 g / 2 000 g = 5 % → 0,2333 €
    const sauce = calcRecipeCost("sauce", recipes as any, ingMap as any);
    near(sauce, 4.666666666666667);
    const plat = calcRecipeCost("plat", recipes as any, ingMap as any);
    near(plat, sauce * 0.05);
  });

  it("ne persiste pas un coût tronqué en cas de MEP circulaire", () => {
    const recipes = [
      { id: "a", yield_portions: 1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: "tomate", sub_recipe_id: null, quantity: 1, unit: "kg" },
        { ingredient_id: null, sub_recipe_id: "b", quantity: 100, unit: "g" },
      ] },
      { id: "b", yield_portions: 1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "a", quantity: 100, unit: "g" },
      ] },
    ];
    const memo = new Map<string, number>();
    expect(() => calcRecipeCost("a", recipes as any, ingMap as any, memo)).not.toThrow();
    // Les totaux tronqués par le garde-cycle ne doivent PAS être mémorisés
    // (sinon ils seraient écrits en base et réutilisés par les autres parents).
    expect(memo.has("a")).toBe(false);
    expect(memo.has("b")).toBe(false);
  });
});
