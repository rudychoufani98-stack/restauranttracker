// =====================================================================
//  SIMULATION D'UN MOIS COMPLET, comme chez un client réel.
//
//  On joue août 2026 de bout en bout avec le VRAI code de calcul
//  (lib/costing.ts) : réceptions à des prix différents, correction de prix
//  par facture, MEP, recette, ventes, perte, inventaire de clôture.
//
//  Puis on vérifie que TOUS les écrans se recoupent, et surtout l'identité
//  comptable qui prouve que la chaîne est juste :
//
//      achats facturés − variation de stock = coût des ventes + pertes
//
//  Si cette égalité tombe au centime, alors le stock, les coûts, les ventes
//  et les pertes racontent la même histoire.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  basePerPack, applyReception, revalueOnInvoice,
  calcRecipeCost, ingredientsPerYieldBase, yieldFactor,
  type RecipeRow, type IngRow,
} from "@/lib/costing";

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

// ── Le restaurant : 3 produits achetés, 1 MEP, 1 plat, 1 produit revendu ──
const TARGET_FC = 30;

function makeIng(id: string, unit: string, yield_pct: number): IngRow & { stock: number } {
  return { id, unit, yield_pct, cost_per_base_unit: 0, cmup: null, stock: 0 } as any;
}

describe("Mois complet chez un client — août 2026", () => {
  // État de départ : nouveau client, stock à zéro.
  const tom = makeIng("tom", "kg", 90);   // Tomate, 10 % de perte au parage
  const hui = makeIng("hui", "l", 100);   // Huile olive
  const coca = makeIng("coca", "unit", 100); // Coca 33 cl, revendu tel quel

  // Journal des achats (ce que la comptabilité verra)
  let achatsFactures = 0;

  it("1. Réception du 5 août — le CMUP part du prix payé", () => {
    // Tomate : 4 colis de 5 kg à 10 € → 20 kg pour 40 €
    const packTom = basePerPack(1, 5, "kg");        // 5 000 g
    const recuTom = 4 * packTom;                     // 20 000 g
    const coutTom = 40 / recuTom;                    // 0,002 €/g = 2 €/kg
    let r = applyReception(tom.stock, tom.cmup, recuTom, coutTom);
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    near(tom.stock, 20000);
    near(tom.cmup * 1000, 2);                        // 2,00 €/kg

    // Huile : 3 bidons de 5 L à 24 € → 15 L pour 72 €
    const packHui = basePerPack(1, 5, "l");
    r = applyReception(hui.stock, hui.cmup, 3 * packHui, 72 / (3 * packHui));
    hui.stock = r.newStock; hui.cmup = r.newCmup;
    near(hui.stock, 15000);
    near(hui.cmup * 1000, 4.8);                      // 4,80 €/L

    // Coca : 2 caisses de 24 à 10,80 € → 48 pièces pour 21,60 €
    const packCoca = basePerPack(24, 1, "unit");
    r = applyReception(coca.stock, coca.cmup, 2 * packCoca, 10.8 / packCoca); // 10,80 € LA caisse
    coca.stock = r.newStock; coca.cmup = r.newCmup;
    near(coca.stock, 48);
    near(coca.cmup, 0.45);                           // 0,45 €/pièce

    achatsFactures += 40 + 72 + 21.6;                // 133,60 €
    near(achatsFactures, 133.6, 2);
  });

  it("2. Réception du 15 août plus chère — le CMUP fait la moyenne", () => {
    // Tomate : 4 colis à 12 € → 20 kg pour 48 € (2,40 €/kg)
    const packTom = basePerPack(1, 5, "kg");
    const r1 = applyReception(tom.stock, tom.cmup, 4 * packTom, 48 / (4 * packTom));
    tom.stock = r1.newStock; tom.cmup = r1.newCmup;
    near(tom.stock, 40000);
    // (20 kg à 2 € + 20 kg à 2,40 €) / 40 kg = 2,20 €/kg
    near(tom.cmup * 1000, 2.2);

    // Huile : 2 bidons à 26 € → 10 L pour 52 € (5,20 €/L)
    const packHui = basePerPack(1, 5, "l");
    const r2 = applyReception(hui.stock, hui.cmup, 2 * packHui, 52 / (2 * packHui));
    hui.stock = r2.newStock; hui.cmup = r2.newCmup;
    near(hui.stock, 25000);
    // (15 L à 4,80 + 10 L à 5,20) / 25 L = 4,96 €/L
    near(hui.cmup * 1000, 4.96);

    achatsFactures += 48 + 52;                       // 233,60 €
    near(achatsFactures, 233.6, 2);
  });

  it("3. Facture de la 2ᵉ livraison : tomate finalement à 12,50 € le colis", () => {
    // La quantité ne change pas, seul le prix : c'est le cas le plus courant.
    const packTom = basePerPack(1, 5, "kg");
    const recu = 4 * packTom;                        // 20 000 g concernés
    const ancienCout = 48 / recu;                    // prix d'entrée : 0,0024 €/g
    const nouveauCout = 50 / recu;                   // prix facturé : 0,0025 €/g

    const r = revalueOnInvoice({
      currentStock: tom.stock, currentCmup: tom.cmup,
      prevBase: recu, targetBase: recu,
      newCostPerBase: nouveauCout,
      prevCostPerBase: ancienCout,                   // ← prix auquel la marchandise est ENTRÉE
      invoiced: true,
    });
    tom.stock = r.newStock; tom.cmup = r.newCmup;

    near(tom.stock, 40000);
    // Valeur du stock : 88 € + (50 − 48) = 90 € pour 40 kg → 2,25 €/kg.
    // Sans le prix d'entrée, on revaloriserait le lot restant au CMUP mélangé
    // et on obtiendrait 2,35 €/kg, soit 4 € de stock inventés.
    near(tom.cmup * 1000, 2.25);

    achatsFactures += 2;                             // 235,60 € réellement facturés
    near(achatsFactures, 235.6, 2);
  });

  // ── Fiches techniques, valorisées au CMUP du moment ──
  const ingMap = new Map<string, IngRow>([
    ["tom", tom as IngRow], ["hui", hui as IngRow], ["coca", coca as IngRow],
  ]);
  const recipes: RecipeRow[] = [
    { // MEP : 2 kg de sauce = 2 kg de tomate (net) + 0,1 L d'huile
      id: "sauce", yield_portions: 2, yield_unit: "kg",
      recipe_lines: [
        { ingredient_id: "tom", sub_recipe_id: null, quantity: 2, unit: "kg" },
        { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.1, unit: "l" },
      ],
    },
    { // Plat vendu 4 € : 400 g de sauce + 0,02 L d'huile
      id: "pates", yield_portions: 1, yield_unit: "portion",
      recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "sauce", quantity: 400, unit: "g" },
        { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.02, unit: "l" },
      ],
    },
  ];
  const PRIX_PATES = 4;
  const PRIX_COCA = 2.5;

  let coutSauce = 0, coutPates = 0;

  it("4. Coût des fiches techniques : rendement et MEP en cascade", () => {
    coutSauce = calcRecipeCost("sauce", recipes, ingMap);
    // Tomate : 2 000 g nets ÷ 0,9 = 2 222,2 g bruts × 0,00225 = 5,00 €
    // Huile   : 100 ml × 0,00496 = 0,496 €
    near(coutSauce, 5.496, 6);
    near(coutSauce / 2, 2.748, 6);                   // 2,748 €/kg de sauce

    coutPates = calcRecipeCost("pates", recipes, ingMap);
    // Sauce : 400 g sur un lot de 2 000 g → 20 % de 5,496 = 1,0992 €
    // Huile : 20 ml × 0,00496 = 0,0992 €
    near(coutPates, 1.1984, 6);

    const fcPates = (coutPates / PRIX_PATES) * 100;
    near(fcPates, 29.96, 2);                         // sous l'objectif de 30 %
    expect(fcPates).toBeLessThan(TARGET_FC);
  });

  // ── Ventes du mois ──
  const VENTES_PATES = 60;
  const VENTES_COCA = 40;
  let ca = 0, coutMatiere = 0;

  it("5. Ventes & marges : CA, coût matière et food cost", () => {
    ca = VENTES_PATES * PRIX_PATES + VENTES_COCA * PRIX_COCA;
    coutMatiere = VENTES_PATES * coutPates + VENTES_COCA * (coca.cmup ?? 0);
    near(ca, 340, 2);                                // 240 + 100
    near(coutMatiere, 89.904, 4);                    // 71,904 + 18
    near(ca - coutMatiere, 250.096, 4);              // marge brute
    near((coutMatiere / ca) * 100, 26.4424, 3);      // food cost théorique
  });

  it("6. Déstockage des ventes : quantités BRUTES (rendement appliqué)", () => {
    const recipeMap = new Map(recipes.map((r) => [r.id, r]));
    const parPortion = ingredientsPerYieldBase("pates", recipeMap);
    // Par portion : 400 g de sauce → 400 g de tomate (nets) et 20 ml d'huile,
    // + 20 ml d'huile en direct = 40 ml.
    near(parPortion.get("tom") ?? 0, 400, 6);
    near(parPortion.get("hui") ?? 0, 40, 6);

    // Brut = net ÷ rendement, appliqué une seule fois au déstockage.
    const brutTom = VENTES_PATES * (parPortion.get("tom")! / yieldFactor(tom as IngRow));
    const brutHui = VENTES_PATES * (parPortion.get("hui")! / yieldFactor(hui as IngRow));
    near(brutTom, 26666.6667, 3);                    // 26,67 kg
    near(brutHui, 2400, 6);                          // 2,4 L

    tom.stock -= brutTom;
    hui.stock -= brutHui;
    coca.stock -= VENTES_COCA;
    near(tom.stock, 13333.3333, 3);
    near(hui.stock, 22600, 6);
    near(coca.stock, 8, 6);
    expect(coca.stock).toBeGreaterThanOrEqual(0);    // jamais de stock négatif
  });

  // ── Perte saisie + inventaire de clôture ──
  const perteDLC = 2000;                              // 2 kg de tomate jetés
  let valeurPertes = 0, ecartsInventaire = 0;

  it("7. Perte du 20 août, valorisée au CMUP", () => {
    valeurPertes = perteDLC * (tom.cmup ?? 0);
    near(valeurPertes, 4.5, 4);                       // 2 kg × 2,25 €
    tom.stock -= perteDLC;
    near(tom.stock, 11333.3333, 3);
  });

  it("8. Inventaire du 31 août après service : écarts et valorisation", () => {
    const compte = { tom: 11000, hui: 22500, coca: 8 }; // relevé physique
    const ecartTom = compte.tom - tom.stock;            // −333,33 g
    const ecartHui = compte.hui - hui.stock;            // −100 ml
    near(ecartTom, -333.3333, 3);
    near(ecartHui, -100, 6);

    ecartsInventaire = Math.abs(ecartTom) * (tom.cmup ?? 0) + Math.abs(ecartHui) * (hui.cmup ?? 0);
    near(ecartsInventaire, 1.246, 3);                   // 0,75 € + 0,496 €

    // La finalisation aligne le stock théorique sur le réel.
    tom.stock = compte.tom; hui.stock = compte.hui; coca.stock = compte.coca;
  });

  it("9. Valeur du stock de clôture (écran Stock + export Inventaire)", () => {
    const valeur =
      tom.stock * (tom.cmup ?? 0) +
      hui.stock * (hui.cmup ?? 0) +
      coca.stock * (coca.cmup ?? 0);
    // 24,75 € de tomate + 111,60 € d'huile + 3,60 € de coca
    near(valeur, 139.95, 2);
  });

  it("10. IDENTITÉ COMPTABLE : achats − variation de stock = coût des ventes + pertes", () => {
    const stockOuverture = 0;                          // nouveau client
    const stockCloture = 139.95;
    const consommation = achatsFactures - (stockCloture - stockOuverture);
    near(consommation, 95.65, 2);

    const pertesTotales = valeurPertes + ecartsInventaire;
    near(pertesTotales, 5.746, 3);

    // C'est LE test qui valide toute la chaîne : ce qui est sorti du stock
    // correspond exactement au coût des plats vendus plus les pertes.
    near(consommation, coutMatiere + pertesTotales, 2);
  });

  it("11. Food cost RÉEL (consommation) vs THÉORIQUE (fiches techniques)", () => {
    const fcTheorique = (coutMatiere / ca) * 100;       // 26,44 %
    const fcReel = ((coutMatiere + valeurPertes + ecartsInventaire) / ca) * 100;
    near(fcTheorique, 26.4424, 3);
    near(fcReel, 28.1324, 3);
    // L'écart, ce sont exactement les pertes et les écarts d'inventaire :
    near(fcReel - fcTheorique, ((valeurPertes + ecartsInventaire) / ca) * 100, 6);
    // Les deux doivent rester sous l'objectif dans ce scénario.
    expect(fcReel).toBeLessThan(TARGET_FC);
  });

  it("12. Tableau de bord : les KPI affichés", () => {
    const achats = achatsFactures;                      // 235,60 €
    const pertesAffichees = valeurPertes + ecartsInventaire;
    const marge = ca - coutMatiere;
    const margeNette = marge - pertesAffichees;
    near(achats, 235.6, 2);
    near(marge, 250.096, 3);
    near(margeNette, 244.35, 2);
    // Le stock ne peut pas valoir plus que ce qui a été acheté ce mois-ci
    // (rien en stock au départ) : garde-fou de cohérence.
    expect(139.95).toBeLessThanOrEqual(achats);
  });
});
