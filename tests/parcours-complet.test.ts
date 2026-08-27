// =====================================================================
//  PARCOURS COMPLET — décembre 2026 chez Amaly, du catalogue vide au
//  bilan de fin de mois.
//
//  Les autres simulations (août, septembre, octobre) datent d'avant la
//  TVA, les références internes, les pertes de MEP et l'import. Celle-ci
//  enchaîne TOUT, dans l'ordre où un vrai client le vivrait :
//
//    1. Import de la mercuriale du fournisseur
//    2. Numérotation automatique par famille
//    3. Commande, réception, facture qui corrige un prix
//    4. Fiches techniques (MEP + plat) au CMUP du moment
//    5. Perte d'une MEP — qui déstocke ses ingrédients
//    6. Ventes sur place ET à emporter, chacune à sa TVA
//    7. Alertes de prix aux seuils du restaurant
//    8. Inventaire de clôture
//
//  Le juge de paix reste le même :
//      achats facturés − variation de stock = coût des ventes + pertes
//
//  Si cette égalité tombe au centime après TOUT ça, la chaîne tient.
// =====================================================================
import { describe, it, expect } from "vitest";
import { analyseTableau } from "@/lib/import-produits";
import { attribueReferences, normaliseRefCaisse, refCaisseEnDouble } from "@/lib/references";
import { basePerPack, applyReception, revalueOnInvoice, type IngRow, type RecipeRow } from "@/lib/costing";
import { decomposePerte, construireCibles, ingredientsParUnite } from "@/lib/loss-targets";
import { foodCostPct, htDepuisTTC, tauxDeVente, estAlcool, TVA_DEFAUT } from "@/lib/vat";
import { buildPriceAlerts, seuilsDe, totalAContester, type AlertIngredient } from "@/lib/price-alerts";
import type { Purchase } from "@/lib/cost-history";

const near = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

// Les réglages du restaurant, tels qu'ils sortiraient de la base.
const RESTAURANT = {
  vat_dine_in: 10, vat_takeaway: 5.5, vat_delivery: 10, vat_alcohol: 20,
  alert_facture_pct: 2, alert_hausse_pct: 10, alert_cmup_pct: 10,
};

describe("Parcours complet — décembre 2026", () => {
  // ── 1. Le fournisseur envoie sa mercuriale ────────────────────────
  const MERCURIALE = [
    ["Désignation", "Famille", "Fournisseur", "Unité", "Colisage", "Contenance", "Prix HT", "TVA", "Rendement"],
    ["Tomate grappe", "Légumes", "Metro", "kg", 1, 5, "10,00 €", 5.5, 90],
    ["Huile olive", "Épicerie", "Metro", "Litre", 1, 5, "24,00 €", 5.5, 100],
    ["Almaza 33 cl", "Bières", "Sodimo", "pièce", 24, 1, "24,00 €", 20, 100],
  ];

  let produits: (IngRow & { name: string; category: string; stock: number; internal_ref?: number | null })[] = [];

  it("1. L'import lit le fichier du fournisseur sans rien inventer", () => {
    const a = analyseTableau(MERCURIALE, { existants: new Map(), fournisseurs: new Map() });
    expect(a.manquantes).toEqual([]);
    // Un avertissement par LIGNE : chaque ligne est analysée seule, donc Metro
    // est signalé sur ses deux produits. C'est voulu — le récapitulatif doit
    // pouvoir se lire ligne par ligne, sans dépendre de ce qui précède.
    expect(a.resume).toEqual({ creer: 3, mettre_a_jour: 0, erreur: 0, avertissements: 3 });
    expect(a.lignes.every((l) => l.avertissements.every((x) => x.includes("inconnu")))).toBe(true);

    produits = a.lignes.map((l, i) => ({
      id: ["tom", "hui", "alm"][i],
      name: l.produit!.name,
      category: l.produit!.category,
      unit: l.produit!.unit,
      yield_pct: l.produit!.yield_pct,
      cost_per_base_unit: l.produit!.cost_per_base_unit,
      cmup: null,
      stock: 0,
      internal_ref: null,
    })) as any;

    // Le coût unitaire est déduit du conditionnement, pas recopié.
    near(produits[0].cost_per_base_unit * 1000, 2);      // 10 € / 5 kg
    near(produits[1].cost_per_base_unit * 1000, 4.8);    // 24 € / 5 L
    near(produits[2].cost_per_base_unit, 1);             // 24 € / 24 pièces
  });

  it("2. Chaque produit reçoit un numéro dans la famille de son nom", () => {
    const r = attribueReferences(
      produits.map((p) => ({ id: p.id, name: p.name, category: p.category, internal_ref: null })),
      [{ name: "Légumes" }, { name: "Épicerie" }, { name: "Bières" }],
    );
    for (const a of r.attributions) {
      const p = produits.find((x) => x.id === a.id)!;
      p.internal_ref = a.ref;
    }

    const bloc = (id: string) => Math.floor(produits.find((p) => p.id === id)!.internal_ref! / 1000);
    expect(bloc("tom")).toBe(3);    // légumes
    expect(bloc("hui")).toBe(5);    // épicerie
    expect(bloc("alm")).toBe(9);    // bières — un bloc à part, pas « boissons »
    expect(r.refuses).toEqual([]);
  });

  // ── 3. Achats ─────────────────────────────────────────────────────
  let achats = 0;
  const tom = () => produits[0];
  const hui = () => produits[1];
  const alm = () => produits[2];

  it("3. Réception du 1er décembre", () => {
    const packTom = basePerPack(1, 5, "kg");
    let r = applyReception(tom().stock, tom().cmup, 8 * packTom, 80 / (8 * packTom));
    tom().stock = r.newStock; tom().cmup = r.newCmup;

    const packHui = basePerPack(1, 5, "l");
    r = applyReception(hui().stock, hui().cmup, 3 * packHui, 72 / (3 * packHui));
    hui().stock = r.newStock; hui().cmup = r.newCmup;

    const packAlm = basePerPack(24, 1, "unit");
    r = applyReception(alm().stock, alm().cmup, 2 * packAlm, 24 / packAlm);
    alm().stock = r.newStock; alm().cmup = r.newCmup;

    achats = 80 + 72 + 48;
    near(achats, 200, 2);
    near(tom().stock, 40000); near(tom().cmup! * 1000, 2);
    near(hui().stock, 15000); near(hui().cmup! * 1000, 4.8);
    near(alm().stock, 48);    near(alm().cmup!, 1);
  });

  it("4. La facture corrige la tomate à 10,50 € le colis", () => {
    const recu = 8 * basePerPack(1, 5, "kg");
    const r = revalueOnInvoice({
      currentStock: tom().stock, currentCmup: tom().cmup,
      prevBase: recu, targetBase: recu,
      prevCostPerBase: 80 / recu, newCostPerBase: 84 / recu,
      invoiced: true,
    });
    tom().stock = r.newStock; tom().cmup = r.newCmup;
    achats += 4;

    near(achats, 204, 2);
    near(tom().cmup! * 1000, 2.1);   // 84 € / 40 kg
  });

  // ── 4. Fiches techniques ──────────────────────────────────────────
  const ingMap = () => new Map<string, IngRow>(produits.map((p) => [p.id, p as IngRow]));
  const RECETTES: (RecipeRow & { name: string; is_prep: boolean })[] = [
    {
      id: "sauce", name: "Sauce tomate", is_prep: true, yield_portions: 2, yield_unit: "kg",
      recipe_lines: [
        { ingredient_id: "tom", sub_recipe_id: null, quantity: 2, unit: "kg" },
        { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.1, unit: "l" },
      ],
    },
    {
      id: "pates", name: "Pâtes bolognaise", is_prep: false, yield_portions: 1, yield_unit: "portion",
      recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "sauce", quantity: 400, unit: "g" },
        { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.02, unit: "l" },
      ],
    },
  ];
  const recipeMap = new Map<string, RecipeRow>(RECETTES.map((r) => [r.id, r as RecipeRow]));

  let coutPates = 0;

  it("5. Le coût des fiches suit le prix facturé, rendement compris", () => {
    const cibles = construireCibles(produits as any, RECETTES as any);
    const sauce = cibles.find((c) => c.nom === "Sauce tomate")!;
    const pates = cibles.find((c) => c.nom === "Pâtes bolognaise")!;

    // 1 kg de sauce : 1 000 g nets ÷ 0,9 × 0,0021 + 50 ml × 0,0048
    near(sauce.coutUnitaire, 2.573333, 5);
    expect(sauce.type).toBe("mep");
    expect(pates.type).toBe("recette");

    coutPates = pates.coutUnitaire;
    near(coutPates, 1.125333, 5);
  });

  // ── 5. Perte d'une MEP ────────────────────────────────────────────
  let pertes = 0;

  it("6. 1 kg de sauce jeté sort la tomate BRUTE et l'huile", () => {
    const cibles = construireCibles(produits as any, RECETTES as any);
    const sauce = cibles.find((c) => c.nom === "Sauce tomate")!;
    const d = decomposePerte(sauce, 1, recipeMap, ingMap());

    const parIng = new Map(d.lignes.map((l) => [l.ingredient_id, l.baseQty]));
    near(parIng.get("tom")!, 1111.1111, 3);   // 1 000 g nets ÷ 0,9
    near(parIng.get("hui")!, 50, 6);

    for (const l of d.lignes) {
      const p = produits.find((x) => x.id === l.ingredient_id)!;
      p.stock -= l.baseQty;
    }
    pertes = d.cout;
    near(pertes, 2.573333, 5);
  });

  // ── 6. Ventes, chacune à sa TVA ───────────────────────────────────
  const VENTES = {
    surPlace: { pates: 50, almaza: 20 },
    aEmporter: { pates: 20 },
  };
  const PRIX_PATES = 4.5;   // TTC, prix de carte
  const PRIX_ALMAZA = 5;

  let ca = 0, caHT = 0, coutVentes = 0;

  it("7. Déstockage des ventes : quantités brutes, tous canaux confondus", () => {
    const total = VENTES.surPlace.pates + VENTES.aEmporter.pates;
    const parPortion = ingredientsParUnite("pates", recipeMap, ingMap());

    // 400 g de sauce + 20 ml d'huile par portion, rendement appliqué.
    near(parPortion.get("tom")!, 444.4444, 3);
    near(parPortion.get("hui")!, 40, 6);

    tom().stock -= total * parPortion.get("tom")!;
    hui().stock -= total * parPortion.get("hui")!;
    alm().stock -= VENTES.surPlace.almaza;

    near(tom().stock, 7777.7778, 3);
    near(hui().stock, 12150, 6);
    near(alm().stock, 28, 6);
  });

  it("8. La TVA n'est PAS la même selon le canal, ni pour la bière", () => {
    const tvaPatesSurPlace = tauxDeVente("dine_in", false, TVA_DEFAUT);
    const tvaPatesEmporter = tauxDeVente("takeaway", false, TVA_DEFAUT);
    const tvaAlmaza = tauxDeVente("dine_in", estAlcool(alm() as any), TVA_DEFAUT);

    expect(tvaPatesSurPlace).toBe(10);
    expect(tvaPatesEmporter).toBe(5.5);
    // L'alcool est reconnu par son numéro interne (bloc 9xxx), pas par son nom.
    expect(estAlcool({ internal_ref: alm().internal_ref })).toBe(true);
    expect(tvaAlmaza).toBe(20);

    ca = VENTES.surPlace.pates * PRIX_PATES
       + VENTES.aEmporter.pates * PRIX_PATES
       + VENTES.surPlace.almaza * PRIX_ALMAZA;
    near(ca, 415, 2);

    caHT = htDepuisTTC(VENTES.surPlace.pates * PRIX_PATES, tvaPatesSurPlace)
         + htDepuisTTC(VENTES.aEmporter.pates * PRIX_PATES, tvaPatesEmporter)
         + htDepuisTTC(VENTES.surPlace.almaza * PRIX_ALMAZA, tvaAlmaza);
    near(caHT, 373.1869, 3);
  });

  it("9. Le food cost corrigé de la TVA est plus HAUT que l'ancien — de 2,7 points", () => {
    coutVentes = (VENTES.surPlace.pates + VENTES.aEmporter.pates) * coutPates
               + VENTES.surPlace.almaza * alm().cmup!;
    near(coutVentes, 98.7733, 3);

    const juste = (coutVentes / caHT) * 100;
    const ancien = (coutVentes / ca) * 100;   // ce que l'app affichait avant
    near(juste, 26.4677, 3);
    near(ancien, 23.8008, 3);
    expect(juste - ancien).toBeGreaterThan(2.6);

    // Et par plat, avec le bon taux pour chaque canal.
    near(foodCostPct(coutPates, PRIX_PATES, 10)!, 27.5081, 3);
    near(foodCostPct(coutPates, PRIX_PATES, 5.5)!, 26.3826, 3);
    // La bière : le taux à 20 % change beaucoup le résultat.
    near(foodCostPct(alm().cmup!, PRIX_ALMAZA, 20)!, 24, 3);
  });

  // ── 7. Alertes de prix ────────────────────────────────────────────
  it("10. La facture plus chère que la commande déclenche une alerte", () => {
    const achatsTomate: Purchase[] = [{
      date: "2026-12-01", invoiceNumber: "F-1201", supplier: "Metro",
      qty: 8, unitPrice: 10.5, expected: 10,
    }];
    const alertes = buildPriceAlerts(
      new Map([["tom", achatsTomate]]),
      new Map<string, AlertIngredient>([["tom", {
        id: "tom", name: tom().name, unit: "kg",
        cmup: tom().cmup, stock_qty: tom().stock, pack_quantity: 5,
      }]]),
      seuilsDe(RESTAURANT),
    );

    const facture = alertes.find((a) => a.kind === "facture")!;
    expect(facture).toBeDefined();
    near(facture.ecartPct, 5, 6);
    near(facture.impactEur, 4, 6);        // 0,50 € × 8 colis — le surcoût réel
    near(totalAContester(alertes), 4, 6);
  });

  it("11. Un seuil relevé à 10 % fait taire cette même alerte", () => {
    const achatsTomate: Purchase[] = [{
      date: "2026-12-01", invoiceNumber: "F-1201", supplier: "Metro",
      qty: 8, unitPrice: 10.5, expected: 10,
    }];
    const alertes = buildPriceAlerts(
      new Map([["tom", achatsTomate]]),
      new Map<string, AlertIngredient>([["tom", { id: "tom", name: "Tomate", unit: "kg", cmup: 0.0021, pack_quantity: 5 }]]),
      seuilsDe({ ...RESTAURANT, alert_facture_pct: 10 }),
    );
    expect(alertes.find((a) => a.kind === "facture")).toBeUndefined();
  });

  // ── 8. Touches de caisse ──────────────────────────────────────────
  it("12. Chaque article vendu porte sa touche, sans doublon", () => {
    const articles = [
      { id: "pates", name: "Pâtes bolognaise", pos_ref: "PLT12" },
      { id: "alm", name: "Almaza 33 cl", pos_ref: "boi 01" },
    ];
    expect(normaliseRefCaisse(articles[1].pos_ref)).toBe("BOI01");
    expect(refCaisseEnDouble(articles)).toEqual([]);

    // Deux articles sur la même touche : la vente irait au mauvais produit.
    const conflit = refCaisseEnDouble([...articles, { id: "x", name: "Salade", pos_ref: "plt12" }]);
    expect(conflit).toHaveLength(1);
    expect(conflit[0].recettes).toContain("Pâtes bolognaise");
  });

  // ── 9. Le juge de paix ────────────────────────────────────────────
  it("13. Inventaire de clôture : le stock compté vaut ce que dit la théorie", () => {
    const valeur = produits.reduce((s, p) => s + p.stock * (p.cmup ?? 0), 0);
    near(produits[0].stock * produits[0].cmup!, 16.3333, 3);   // tomate
    near(produits[1].stock * produits[1].cmup!, 58.32, 3);     // huile
    near(produits[2].stock * produits[2].cmup!, 28, 3);        // bières
    near(valeur, 102.6533, 3);
  });

  it("14. ACHATS − VARIATION DE STOCK = COÛT DES VENTES + PERTES", () => {
    const stockInitial = 0;
    const stockFinal = produits.reduce((s, p) => s + p.stock * (p.cmup ?? 0), 0);

    const gauche = achats - (stockFinal - stockInitial);
    const droite = coutVentes + pertes;

    near(gauche, 101.3467, 2);
    near(droite, 101.3467, 2);
    // Au centime : c'est ce qui prouve que rien ne s'est perdu en route.
    expect(Math.abs(gauche - droite)).toBeLessThan(0.005);
  });

  it("15. Marge brute du mois, en euros HT — le chiffre qui compte", () => {
    const marge = caHT - coutVentes;
    near(marge, 274.4136, 3);
    // La marge calculée sur le TTC aurait été surestimée de 42 €.
    near(ca - coutVentes - marge, 41.8131, 3);
  });
});
