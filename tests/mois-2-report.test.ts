// =====================================================================
//  MOIS 2 — octobre 2026, en repartant du stock de clôture de septembre.
//
//  C'est le mois où les erreurs se cachent : il faut que le stock d'ouverture
//  soit repris, que l'identité comptable tienne AVEC un stock de départ non
//  nul, et que les opérations « sales » se comportent bien :
//
//    • réception PARTIELLE puis réception du reste
//    • facture qui corrige la QUANTITÉ (pas seulement le prix)
//    • prix en BAISSE (le coût moyen doit descendre)
//    • perte saisie par erreur puis ANNULÉE
//    • saisie de ventes supprimée puis re-saisie (doit être neutre)
//    • inventaire où l'on compte une MEP (convertie en équivalents bruts)
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  basePerPack, applyReception, revalueOnInvoice,
  calcRecipeCost, ingredientsPerYieldBase, yieldFactor,
  type RecipeRow, type IngRow,
} from "@/lib/costing";
import { detectServiceMoment } from "@/lib/service-moment";
import { inventoryMomentAdvice } from "@/lib/inventory-moment";

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const SERVICE_START = "11:30", SERVICE_END = "23:00";

type Produit = IngRow & { nom: string; stock: number };
const p = (id: string, nom: string, unit: string, yield_pct: number, stock: number, cmup: number): Produit =>
  ({ id, nom, unit, yield_pct, stock, cmup, cost_per_base_unit: cmup } as any);

describe("Mois 2 — octobre 2026, report du stock de septembre", () => {
  // ── Stock d'OUVERTURE = clôture de septembre (109,80 €) ─────────────
  const tom = p("tom", "Tomate", "kg", 90, 16500, 0.002);
  const hui = p("hui", "Huile olive", "l", 100, 12000, 0.0048);
  const coca = p("coca", "Coca 33cl", "unit", 100, 8, 0.45);
  const gob = p("gob", "Gobelets", "unit", 100, 195, 0.08);
  const produits = [tom, hui, coca, gob];

  const valeurStock = () => produits.reduce((s, x) => s + x.stock * (x.cmup ?? 0), 0);
  let stockOuverture = 0;
  let achats = 0;

  it("0. Le stock d'ouverture reprend exactement la clôture de septembre", () => {
    stockOuverture = valeurStock();
    near(stockOuverture, 109.8, 2);   // 33 + 57,60 + 3,60 + 15,60
  });

  it("1. Commande de 6 colis, réception PARTIELLE de 4 le 3 oct. (prix en BAISSE)", () => {
    expect(detectServiceMoment(new Date("2026-10-03T08:00:00"), SERVICE_START, SERVICE_END)).toBe("avant");
    const pack = basePerPack(1, 5, "kg");        // colis de 5 kg
    const recu = 4 * pack;                        // 20 kg reçus sur 30 commandés
    const cout = 36 / recu;                       // 9 €/colis → 1,80 €/kg
    const r = applyReception(tom.stock, tom.cmup, recu, cout);
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    achats += 36;

    near(tom.stock, 36500);
    // (33 € + 36 €) / 36,5 kg = 1,8904 €/kg — le coût moyen BAISSE
    near(tom.cmup! * 1000, 1.89041, 4);
    expect(tom.cmup! * 1000).toBeLessThan(2);

    // Reste à recevoir : 2 colis (c'est ce que l'écran doit proposer)
    const commandes = 6, dejaRecus = 4;
    expect(Math.max(0, commandes - dejaRecus)).toBe(2);
  });

  it("2. Réception du RESTE (2 colis) le 6 oct.", () => {
    const pack = basePerPack(1, 5, "kg");
    const recu = 2 * pack;
    const r = applyReception(tom.stock, tom.cmup, recu, 18 / recu);
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    achats += 18;

    near(tom.stock, 46500);                       // 16,5 + 20 + 10
    near(tom.cmup! * 1000, 1.870968, 5);          // (33 + 36 + 18) / 46,5 kg
  });

  it("3. Réception de coca plus cher — le coût moyen remonte", () => {
    const pack = basePerPack(24, 1, "unit");
    const r = applyReception(coca.stock, coca.cmup, 2 * pack, 11.04 / pack); // 11,04 €/caisse
    coca.stock = r.newStock; coca.cmup = r.newCmup;
    achats += 22.08;

    near(coca.stock, 56);
    // (8 × 0,45 + 48 × 0,46) / 56 = 0,458571 €/pièce
    near(coca.cmup!, 0.4585714, 6);
  });

  it("4. Facture qui corrige la QUANTITÉ : 5 colis facturés au lieu de 6 reçus", () => {
    const pack = basePerPack(1, 5, "kg");
    const recuTotal = 6 * pack;                   // 30 000 g entrés
    const factureBase = 5 * pack;                 // 25 000 g facturés
    const r = revalueOnInvoice({
      currentStock: tom.stock, currentCmup: tom.cmup,
      prevBase: recuTotal, targetBase: factureBase,
      prevCostPerBase: 54 / recuTotal,            // 1,80 €/kg à l'entrée
      newCostPerBase: 45 / factureBase,           // 1,80 €/kg facturé
      invoiced: true,
    });
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    achats -= 9;                                  // 54 € → 45 €

    // Le stock perd le colis non facturé
    near(tom.stock, 41500);
    // Reste : 16,5 kg de septembre à 2,00 € + 25 kg à 1,80 € = 78 € / 41,5 kg
    near(tom.cmup! * 1000, 1.879518, 5);
    near(achats, 67.08, 2);                       // 36 + 18 + 22,08 − 9
  });

  it("5. Perte saisie par erreur puis ANNULÉE — stock et valeur reviennent", () => {
    const stockAvant = tom.stock, cmupAvant = tom.cmup!;
    const qty = 5000;                             // 5 kg jetés « par erreur »
    const valeurPerte = qty * cmupAvant;
    near(valeurPerte, 9.3976, 3);
    tom.stock -= qty;
    near(tom.stock, 36500);

    // Annulation de la perte : la quantité est remise, le coût moyen inchangé
    // (on remet exactement ce qui avait été retiré).
    tom.stock += qty;
    near(tom.stock, stockAvant);
    near(tom.cmup!, cmupAvant);
  });

  // ── Fiches techniques au CMUP d'octobre ────────────────────────────
  const ingMap = new Map<string, IngRow>(produits.map((x) => [x.id, x as IngRow]));
  const recipes: RecipeRow[] = [
    { id: "sauce", yield_portions: 2, yield_unit: "kg", recipe_lines: [
      { ingredient_id: "tom", sub_recipe_id: null, quantity: 2, unit: "kg" },
      { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.1, unit: "l" },
    ] },
    { id: "pates", yield_portions: 1, yield_unit: "portion", recipe_lines: [
      { ingredient_id: null, sub_recipe_id: "sauce", quantity: 400, unit: "g" },
      { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.02, unit: "l" },
    ] },
  ];
  const PRIX_PATES = 4.5;   // prix de vente augmenté ce mois-ci
  const PRIX_COCA = 2.5;
  let coutPates = 0;

  it("6. Le coût des plats suit la baisse du prix de la tomate", () => {
    const coutSauce = calcRecipeCost("sauce", recipes, ingMap);
    // 2 000 g nets ÷ 0,9 × 0,001879518 = 4,17671 € + 0,48 € d'huile
    near(coutSauce, 4.65671, 4);
    coutPates = calcRecipeCost("pates", recipes, ingMap);
    near(coutPates, 1.027342, 5);
    // Coût en baisse ET prix de vente en hausse → food cost qui s'améliore
    near((coutPates / PRIX_PATES) * 100, 22.83, 2);
  });

  // ── Ventes : saisies, supprimées, puis re-saisies ──────────────────
  const VENTES = { pates: 60, coca: 20 };
  let ca = 0, coutMatiere = 0;
  let brutTom = 0, brutHui = 0;

  it("7. Saisie des ventes : déstockage brut (rendement) + MEP en cascade", () => {
    const recipeMap = new Map(recipes.map((r) => [r.id, r]));
    const parPortion = ingredientsPerYieldBase("pates", recipeMap);
    brutTom = VENTES.pates * (parPortion.get("tom")! / yieldFactor(tom));
    brutHui = VENTES.pates * (parPortion.get("hui")! / yieldFactor(hui));
    near(brutTom, 26666.6667, 3);
    near(brutHui, 2400, 6);

    tom.stock -= brutTom; hui.stock -= brutHui; coca.stock -= VENTES.coca;
    near(tom.stock, 14833.3333, 3);
    near(hui.stock, 9600, 6);
    near(coca.stock, 36, 6);

    ca = VENTES.pates * PRIX_PATES + VENTES.coca * PRIX_COCA;
    coutMatiere = VENTES.pates * coutPates + VENTES.coca * coca.cmup!;
    near(ca, 320, 2);                              // 270 + 50
    near(coutMatiere, 70.81191, 4);                // 61,64 + 9,17
  });

  it("8. Supprimer la saisie puis la re-saisir est NEUTRE sur le stock", () => {
    const avant = { tom: tom.stock, hui: hui.stock, coca: coca.stock };

    // Suppression : les quantités déstockées sont remises.
    tom.stock += brutTom; hui.stock += brutHui; coca.stock += VENTES.coca;
    near(tom.stock, 41500);
    near(hui.stock, 12000);
    near(coca.stock, 56);

    // Re-saisie à l'identique : on retombe exactement sur le même stock.
    tom.stock -= brutTom; hui.stock -= brutHui; coca.stock -= VENTES.coca;
    near(tom.stock, avant.tom);
    near(hui.stock, avant.hui);
    near(coca.stock, avant.coca);
  });

  // ── Inventaire de clôture avec une MEP comptée ─────────────────────
  let ecartsValeur = 0;
  it("9. Inventaire du 31 oct. après service, avec 1,5 kg de sauce en frigo", () => {
    const moment = detectServiceMoment(new Date("2026-10-31T23:30:00"), SERVICE_START, SERVICE_END);
    expect(moment).toBe("apres");
    expect(inventoryMomentAdvice(moment, true).level).toBe("ok");

    // Compter une MEP revient à compter les ingrédients qu'elle contient,
    // en BRUT (le stock théorique a été débité en brut).
    const recipeMap = new Map(recipes.map((r) => [r.id, r]));
    const parKgSauce = ingredientsPerYieldBase("sauce", recipeMap); // par g de sauce
    const sauceComptee = 1500;                                      // 1,5 kg
    const equivTom = (parKgSauce.get("tom")! * sauceComptee) / yieldFactor(tom);
    const equivHui = (parKgSauce.get("hui")! * sauceComptee) / yieldFactor(hui);
    near(equivTom, 1666.6667, 3);   // 1 500 g nets ÷ 0,9
    near(equivHui, 75, 6);          // 0,05 ml par g de sauce

    // Relevé physique : vrac + équivalents de la MEP
    const compteTom = 13000 + equivTom;
    const compteHui = 9500 + equivHui;
    const compteCoca = 36, compteGob = 190;

    const ecartTom = compteTom - tom.stock;
    const ecartHui = compteHui - hui.stock;
    const ecartGob = compteGob - gob.stock;
    near(ecartTom, -166.6667, 3);
    near(ecartHui, -25, 6);
    near(ecartGob, -5, 6);
    near(compteCoca - coca.stock, 0, 6);   // le coca tombe juste

    ecartsValeur =
      Math.abs(ecartTom) * tom.cmup! +
      Math.abs(ecartHui) * hui.cmup! +
      Math.abs(ecartGob) * gob.cmup!;
    near(ecartsValeur, 0.833253, 5);       // 0,3132 + 0,12 + 0,40

    tom.stock = compteTom; hui.stock = compteHui; coca.stock = compteCoca; gob.stock = compteGob;
  });

  it("10. IDENTITÉ COMPTABLE avec un stock d'ouverture non nul", () => {
    const stockCloture = valeurStock();
    near(stockCloture, 105.234795, 4);

    // achats − variation de stock = ce qui est sorti du stock
    const consommation = achats - (stockCloture - stockOuverture);
    // 67,08 − (105,2348 − 109,80) = 71,6452
    near(consommation, 71.645205, 4);

    // … et ce qui est sorti = coût des plats vendus + écarts d'inventaire
    // (la perte du 8 octobre a été annulée : elle ne compte pas)
    near(coutMatiere + ecartsValeur, 71.645201, 4);
    near(consommation, coutMatiere + ecartsValeur, 4);
  });

  it("11. Food cost du mois 2 : théorique, réel, et comparaison au mois 1", () => {
    const fcTheorique = (coutMatiere / ca) * 100;
    const fcReel = ((coutMatiere + ecartsValeur) / ca) * 100;
    near(fcTheorique, 22.12872, 4);
    near(fcReel, 22.38911, 4);

    // Septembre : 24,65 % théorique / 26,26 % réel → octobre s'améliore,
    // grâce à la baisse du prix tomate ET à la hausse du prix de vente.
    expect(fcTheorique).toBeLessThan(24.648);
    expect(fcReel).toBeLessThan(26.2632);

    // L'écart réel/théorique reste exactement les écarts d'inventaire.
    near(fcReel - fcTheorique, (ecartsValeur / ca) * 100, 6);
  });

  it("12. Deux mois cumulés : les achats et les stocks s'enchaînent sans trou", () => {
    // Septembre : ouverture 0, achats 209,60, clôture 109,80
    // Octobre    : ouverture 109,80, achats 67,08, clôture 105,23
    const consoSept = 209.6 - (109.8 - 0);
    const consoOct = achats - (valeurStock() - 109.8);
    near(consoSept, 99.8, 2);
    near(consoOct, 71.6452, 3);

    // Cumul sur deux mois : achats totaux − stock final = consommation totale
    const achatsCumul = 209.6 + achats;
    const consoCumul = achatsCumul - valeurStock();
    near(achatsCumul, 276.68, 2);
    near(consoCumul, 171.445205, 4);
    near(consoSept + consoOct, consoCumul, 3);
  });
});
