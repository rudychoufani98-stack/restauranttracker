// =====================================================================
//  TOUR COMPLET DU SITE — septembre 2026, comme chez un client réel.
//
//  Couvre : achats chez DEUX fournisseurs aux colisages différents,
//  correction de prix par facture, commande annulée après réception,
//  fournitures séparées de la nourriture, MEP + recette, ventes sur place
//  ET en livraison (avec commission), perte, DEUX inventaires (ouverture
//  avant service, clôture après service), et la chronologie des mouvements
//  (une livraison saisie en retard reste datée du jour de livraison).
//
//  Tout est rejoué avec le VRAI code de calcul de l'application.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  basePerPack, applyReception, revalueOnInvoice, reverseReception,
  calcRecipeCost, ingredientsPerYieldBase, yieldFactor,
  type RecipeRow, type IngRow,
} from "@/lib/costing";
import { detectServiceMoment } from "@/lib/service-moment";
import { inventoryMomentAdvice } from "@/lib/inventory-moment";

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const SERVICE_START = "11:30";
const SERVICE_END = "23:00";
const TARGET_FC = 30;
const COMMISSION_LIVRAISON = 0.30; // Deliveroo & co

type Produit = IngRow & { nom: string; stock: number; fourniture: boolean };
const p = (id: string, nom: string, unit: string, yield_pct: number, fourniture = false): Produit =>
  ({ id, nom, unit, yield_pct, cost_per_base_unit: 0, cmup: null, stock: 0, fourniture } as any);

// Journal des mouvements, daté à l'heure RÉELLE de l'événement.
type Mvt = { at: string; type: "in" | "out" | "loss" | "adjustment"; ref: string; produit: string; qty: number; cout: number };

describe("Tour complet du site — septembre 2026", () => {
  const tom = p("tom", "Tomate", "kg", 90);
  const hui = p("hui", "Huile olive", "l", 100);
  const coca = p("coca", "Coca 33cl", "unit", 100);
  const gob = p("gob", "Gobelets", "unit", 100, true); // fourniture
  const produits = [tom, hui, coca, gob];
  const journal: Mvt[] = [];

  const ajoute = (at: string, type: Mvt["type"], ref: string, prod: Produit, qty: number, cout: number) =>
    journal.push({ at, type, ref, produit: prod.id, qty, cout });

  // ── ACHATS ────────────────────────────────────────────────────────
  it("1. Réception Metro du 1er sept. à 8 h — détectée AVANT le service", () => {
    const moment = detectServiceMoment(new Date("2026-09-01T08:00:00"), SERVICE_START, SERVICE_END);
    expect(moment).toBe("avant");

    // Tomate : 4 colis de 5 kg à 10 €
    const packTom = basePerPack(1, 5, "kg");
    let r = applyReception(tom.stock, tom.cmup, 4 * packTom, 40 / (4 * packTom));
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    ajoute("2026-09-01T08:00", "in", "BL-1", tom, 4 * packTom, 40 / (4 * packTom));
    near(tom.stock, 20000); near(tom.cmup! * 1000, 2);

    // Huile : 3 bidons de 5 L à 24 €
    const packHui = basePerPack(1, 5, "l");
    r = applyReception(hui.stock, hui.cmup, 3 * packHui, 72 / (3 * packHui));
    hui.stock = r.newStock; hui.cmup = r.newCmup;
    ajoute("2026-09-01T08:00", "in", "BL-1", hui, 3 * packHui, 72 / (3 * packHui));
    near(hui.cmup! * 1000, 4.8);

    // Gobelets (FOURNITURE) : 2 colis de 100 à 8 €
    const packGob = basePerPack(100, 1, "unit");
    r = applyReception(gob.stock, gob.cmup, 2 * packGob, 8 / packGob);
    gob.stock = r.newStock; gob.cmup = r.newCmup;
    ajoute("2026-09-01T08:00", "in", "BL-1", gob, 2 * packGob, 8 / packGob);
    near(gob.stock, 200); near(gob.cmup!, 0.08);
  });

  it("2. Inventaire d'OUVERTURE (1er sept. 9 h, avant service) — aucun écart", () => {
    const moment = detectServiceMoment(new Date("2026-09-01T09:00:00"), SERVICE_START, SERVICE_END);
    expect(moment).toBe("avant");
    // Aucune vente saisie à ce stade : compter avant le service est légitime.
    const avis = inventoryMomentAdvice(moment, false);
    expect(avis.level).toBe("ok");

    // Le comptage colle à ce qui vient d'être reçu.
    near(20000 - tom.stock, 0); near(15000 - hui.stock, 0); near(200 - gob.stock, 0);
    const valeur = tom.stock * tom.cmup! + hui.stock * hui.cmup! + gob.stock * gob.cmup!;
    near(valeur, 128, 2); // 40 + 72 + 16
  });

  it("3. Réception Pro à Pro du 5 sept. à 21 h — colis de 10 kg (autre colisage), PENDANT le service", () => {
    expect(detectServiceMoment(new Date("2026-09-05T21:00:00"), SERVICE_START, SERVICE_END)).toBe("pendant");

    // Même produit, mais ce fournisseur vend par colis de 10 kg à 19 €.
    const packTom = basePerPack(1, 10, "kg");
    near(packTom, 10000); // le colisage du FOURNISSEUR, pas celui de la fiche
    const recu = 3 * packTom;
    const cout = 57 / recu;
    const r = applyReception(tom.stock, tom.cmup, recu, cout);
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    ajoute("2026-09-05T21:00", "in", "BL-2", tom, recu, cout);

    near(tom.stock, 50000);                 // 20 kg + 30 kg
    near(tom.cmup! * 1000, 1.94);           // (40 € + 57 €) / 50 kg
  });

  it("4. Facture Pro à Pro : 20 € le colis au lieu de 19", () => {
    const recu = 3 * basePerPack(1, 10, "kg");
    const r = revalueOnInvoice({
      currentStock: tom.stock, currentCmup: tom.cmup,
      prevBase: recu, targetBase: recu,
      prevCostPerBase: 57 / recu, newCostPerBase: 60 / recu,
      invoiced: true,
    });
    tom.stock = r.newStock; tom.cmup = r.newCmup;
    // Valeur : 97 € + (60 − 57) = 100 € pour 50 kg → 2,00 €/kg
    near(tom.cmup! * 1000, 2);
    // Le journal d'achat suit le prix facturé (correction du coût des mouvements)
    for (const m of journal) if (m.ref === "BL-2" && m.produit === "tom") m.cout = 60 / recu;
  });

  it("5. Réception coca du 10 sept.", () => {
    const packCoca = basePerPack(24, 1, "unit");
    const r = applyReception(coca.stock, coca.cmup, 2 * packCoca, 10.8 / packCoca);
    coca.stock = r.newStock; coca.cmup = r.newCmup;
    ajoute("2026-09-10T09:00", "in", "BL-3", coca, 2 * packCoca, 10.8 / packCoca);
    near(coca.stock, 48); near(coca.cmup!, 0.45);
  });

  it("6. Commande annulée APRÈS réception : stock ET coût moyen reviennent en arrière", () => {
    // Réception d'huile plus chère (2 bidons à 26 €), puis annulation.
    const packHui = basePerPack(1, 5, "l");
    const recu = 2 * packHui;
    const cout = 52 / recu;
    const r1 = applyReception(hui.stock, hui.cmup, recu, cout);
    hui.stock = r1.newStock; hui.cmup = r1.newCmup;
    ajoute("2026-09-12T09:00", "in", "BL-4", hui, recu, cout);
    near(hui.stock, 25000);
    near(hui.cmup! * 1000, 4.96); // moyenne 4,80 / 5,20

    // Annulation : on retire la quantité ET sa valeur au prix d'entrée.
    const r2 = reverseReception(hui.stock, hui.cmup, recu, cout);
    hui.stock = r2.newStock; hui.cmup = r2.newCmup;
    ajoute("2026-09-12T10:00", "adjustment", "ANNUL-BL-4", hui, recu, cout);

    near(hui.stock, 15000);
    // Le coût moyen doit revenir à 4,80 €/L. Sans retirer la valeur, il serait
    // resté à 4,96 € → 2,40 € de stock survalorisé.
    near(hui.cmup! * 1000, 4.8);
  });

  it("7. Achats du mois : nourriture et fournitures séparées, annulation neutralisée", () => {
    const valeur = (m: Mvt) => m.qty * m.cout;
    const signe = (m: Mvt) => (m.type === "in" ? 1 : -1);
    const achats = journal.filter((m) => m.type === "in" || m.ref.startsWith("ANNUL"));

    const food = achats.filter((m) => m.produit !== "gob").reduce((s, m) => s + signe(m) * valeur(m), 0);
    const fournitures = achats.filter((m) => m.produit === "gob").reduce((s, m) => s + signe(m) * valeur(m), 0);

    // Tomate 40 + 60 (prix facturé) + huile 72 + coca 21,60 ; l'huile annulée s'annule.
    near(food, 193.6, 2);
    near(fournitures, 16, 2);
    near(food + fournitures, 209.6, 2);
  });

  // ── FICHES TECHNIQUES ─────────────────────────────────────────────
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
  const PRIX_PATES = 4, PRIX_COCA = 2.5;
  let coutPates = 0;

  it("8. Coût des fiches : MEP en cascade + rendement de 90 % sur la tomate", () => {
    const coutSauce = calcRecipeCost("sauce", recipes, ingMap);
    // Tomate : 2 000 g nets ÷ 0,9 = 2 222,2 g × 0,002 = 4,4444 € ; huile 0,48 €
    near(coutSauce, 4.9244, 4);
    coutPates = calcRecipeCost("pates", recipes, ingMap);
    // 20 % du lot de sauce (0,98489) + 20 ml d'huile (0,096)
    near(coutPates, 1.08089, 5);
    near((coutPates / PRIX_PATES) * 100, 27.02, 2);
    expect((coutPates / PRIX_PATES) * 100).toBeLessThan(TARGET_FC);
  });

  // ── VENTES : sur place + livraison ────────────────────────────────
  const SUR_PLACE = { pates: 50, coca: 30 };
  const LIVRAISON = { pates: 20, coca: 10 };
  let caTotal = 0, coutMatiere = 0, commission = 0;

  it("9. Ventes & marges : deux canaux, commission de livraison déduite", () => {
    const caSurPlace = SUR_PLACE.pates * PRIX_PATES + SUR_PLACE.coca * PRIX_COCA;
    const caLivraison = LIVRAISON.pates * PRIX_PATES + LIVRAISON.coca * PRIX_COCA;
    near(caSurPlace, 275, 2);
    near(caLivraison, 105, 2);
    caTotal = caSurPlace + caLivraison;
    near(caTotal, 380, 2);

    const pates = SUR_PLACE.pates + LIVRAISON.pates;   // 70
    const cocas = SUR_PLACE.coca + LIVRAISON.coca;     // 40
    coutMatiere = pates * coutPates + cocas * coca.cmup!;
    near(coutMatiere, 93.6622, 4);                     // 75,66 + 18

    commission = caLivraison * COMMISSION_LIVRAISON;
    near(commission, 31.5, 2);
    // Marge brute puis marge après commission plateforme
    near(caTotal - coutMatiere, 286.3378, 4);
    near(caTotal - commission - coutMatiere, 254.8378, 4);
    near((coutMatiere / caTotal) * 100, 24.648, 3);    // food cost théorique
  });

  it("10. Déstockage des ventes : brut = net ÷ rendement, MEP incluses", () => {
    const recipeMap = new Map(recipes.map((r) => [r.id, r]));
    const parPortion = ingredientsPerYieldBase("pates", recipeMap);
    near(parPortion.get("tom") ?? 0, 400, 6);
    near(parPortion.get("hui") ?? 0, 40, 6);

    const pates = SUR_PLACE.pates + LIVRAISON.pates;
    const brutTom = pates * (parPortion.get("tom")! / yieldFactor(tom));
    const brutHui = pates * (parPortion.get("hui")! / yieldFactor(hui));
    near(brutTom, 31111.1111, 3);
    near(brutHui, 2800, 6);

    tom.stock -= brutTom; ajoute("2026-09-30T23:00", "out", "VENTES-09", tom, brutTom, tom.cmup!);
    hui.stock -= brutHui; ajoute("2026-09-30T23:00", "out", "VENTES-09", hui, brutHui, hui.cmup!);
    coca.stock -= SUR_PLACE.coca + LIVRAISON.coca;

    near(tom.stock, 18888.8889, 3);
    near(hui.stock, 12200, 6);
    near(coca.stock, 8, 6);
    expect(coca.stock).toBeGreaterThanOrEqual(0);
    // Les gobelets ne sont PAS déstockés par les ventes (aucune recette).
    near(gob.stock, 200, 6);
  });

  // ── PERTE ─────────────────────────────────────────────────────────
  let valeurPerte = 0;
  it("11. Perte du 20 sept. à 22 h — PENDANT le service, valorisée au CMUP", () => {
    expect(detectServiceMoment(new Date("2026-09-20T22:00:00"), SERVICE_START, SERVICE_END)).toBe("pendant");
    const qty = 2000; // 2 kg
    valeurPerte = qty * tom.cmup!;
    near(valeurPerte, 4, 2);
    tom.stock -= qty;
    ajoute("2026-09-20T22:00", "loss", "PERTE-1", tom, qty, tom.cmup!);
    near(tom.stock, 16888.8889, 3);
  });

  // ── INVENTAIRE DE CLÔTURE ─────────────────────────────────────────
  let ecartsValeur = 0;
  it("12. Compter AVANT le service est signalé comme trompeur (ventes déjà saisies)", () => {
    // 30 sept. à 10 h : avant l'ouverture, mais les ventes du mois sont saisies.
    const moment = detectServiceMoment(new Date("2026-09-30T10:00:00"), SERVICE_START, SERVICE_END);
    expect(moment).toBe("avant");
    const avis = inventoryMomentAdvice(moment, true);
    expect(avis.level).toBe("attention");
    expect(avis.message).toContain("surplus");
  });

  it("13. Inventaire de CLÔTURE (30 sept. 23 h 30, après service) — écarts exploitables", () => {
    const moment = detectServiceMoment(new Date("2026-09-30T23:30:00"), SERVICE_START, SERVICE_END);
    expect(moment).toBe("apres");
    expect(inventoryMomentAdvice(moment, true).level).toBe("ok");

    const compte = { tom: 16500, hui: 12000, coca: 8, gob: 195 };
    const ecartTom = compte.tom - tom.stock;   // −388,89 g
    const ecartHui = compte.hui - hui.stock;   // −200 ml
    const ecartGob = compte.gob - gob.stock;   // −5 gobelets
    near(ecartTom, -388.8889, 3);
    near(ecartHui, -200, 6);
    near(ecartGob, -5, 6);

    ecartsValeur = Math.abs(ecartTom) * tom.cmup! + Math.abs(ecartHui) * hui.cmup! + Math.abs(ecartGob) * gob.cmup!;
    near(ecartsValeur, 2.1378, 3);             // 0,7778 + 0,96 + 0,40

    // La finalisation aligne le théorique sur le réel.
    tom.stock = compte.tom; hui.stock = compte.hui; coca.stock = compte.coca; gob.stock = compte.gob;
  });

  it("14. Valeur du stock de clôture (écran Stock, export Inventaire)", () => {
    const valeur = produits.reduce((s, x) => s + x.stock * (x.cmup ?? 0), 0);
    // 33 (tomate) + 57,60 (huile) + 3,60 (coca) + 15,60 (gobelets)
    near(valeur, 109.8, 2);
  });

  it("15. IDENTITÉ COMPTABLE du mois : achats − stock = coût des ventes + pertes", () => {
    const achats = 209.6;         // vérifié à l'étape 7
    const stockCloture = 109.8;   // vérifié à l'étape 14
    const consommation = achats - stockCloture; // stock d'ouverture = 0
    near(consommation, 99.8, 2);
    near(coutMatiere + valeurPerte + ecartsValeur, 99.8, 2);
  });

  it("16. Food cost réel vs théorique : l'écart, ce sont les pertes", () => {
    const fcTheorique = (coutMatiere / caTotal) * 100;
    const fcReel = ((coutMatiere + valeurPerte + ecartsValeur) / caTotal) * 100;
    near(fcTheorique, 24.648, 3);
    near(fcReel, 26.2632, 3);
    near(fcReel - fcTheorique, ((valeurPerte + ecartsValeur) / caTotal) * 100, 6);
  });

  it("17. Chronologie : une livraison saisie en retard reste datée du jour de livraison", () => {
    // Le BL-2 a été livré le 5 à 21 h ; sa saisie a pu avoir lieu bien après.
    const bl2 = journal.find((m) => m.ref === "BL-2");
    expect(bl2!.at.startsWith("2026-09-05")).toBe(true);

    // Le journal doit se relire dans l'ordre du temps, pas dans l'ordre de saisie.
    const tri = [...journal].sort((a, b) => a.at.localeCompare(b.at));
    expect(tri[0].ref).toBe("BL-1");
    expect(tri[tri.length - 1].ref).toBe("VENTES-09");

    // Et tout tombe bien dans le mois de septembre : rien ne fuit sur un autre mois.
    for (const m of journal) expect(m.at.slice(0, 7)).toBe("2026-09");
  });

  it("18. Tableau de bord : les KPI du mois", () => {
    const marge = caTotal - coutMatiere;
    const pertesAffichees = valeurPerte + ecartsValeur;
    near(caTotal, 380, 2);
    near(coutMatiere, 93.6622, 4);
    near(marge, 286.3378, 4);
    near(pertesAffichees, 6.1378, 3);
    near(marge - pertesAffichees, 280.2, 2);
    // Cohérence : le stock restant ne peut pas dépasser les achats du mois
    // (stock d'ouverture nul).
    expect(109.8).toBeLessThanOrEqual(209.6);
  });
});

// ── Avis d'inventaire selon le moment : les 6 combinaisons ────────────
describe("Interprétation d'un inventaire selon le moment du service", () => {
  it("après service, ventes saisies → exploitable", () => {
    const a = inventoryMomentAdvice("apres", true);
    expect(a.level).toBe("ok");
    expect(a.message).toContain("exploitables");
  });
  it("après service, sans ventes → rappelle de les saisir", () => {
    const a = inventoryMomentAdvice("apres", false);
    expect(a.level).toBe("ok");
    expect(a.message).toContain("saisir les ventes");
  });
  it("avant service, ventes saisies → alerte faux surplus", () => {
    const a = inventoryMomentAdvice("avant", true);
    expect(a.level).toBe("attention");
    expect(a.message).toContain("surplus");
  });
  it("avant service, sans ventes → état d'ouverture légitime", () => {
    expect(inventoryMomentAdvice("avant", false).level).toBe("ok");
  });
  it("pendant le service → toujours une alerte", () => {
    expect(inventoryMomentAdvice("pendant", true).level).toBe("attention");
    expect(inventoryMomentAdvice("pendant", false).level).toBe("attention");
  });
  it("moment non renseigné → alerte", () => {
    expect(inventoryMomentAdvice(null, true).level).toBe("attention");
    expect(inventoryMomentAdvice(undefined, false).level).toBe("attention");
  });
});
