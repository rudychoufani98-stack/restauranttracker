// =====================================================================
//  Une facture déposée sans bon de commande.
//
//  Ce qui se joue ici : des kilos qui entrent en stock et un coût moyen
//  qui bouge. Une erreur ne se voit pas le jour même — elle se découvre
//  à l'inventaire, ou dans la marge d'un plat.
// =====================================================================
import { describe, it, expect } from "vitest";
import { planFacture, contenuColis, type ProduitStock, type LigneFacture } from "@/lib/facture-directe";

const produit = (p: Partial<ProduitStock> & { id: string }): ProduitStock => ({
  name: p.id, unit: "kg", stock_qty: 0, cmup: null, pack_quantity: 1,
  cost_per_base_unit: 0, ...p,
});

// Pois chiche : sac de 25 kg chez Jova → 25 000 g par colis.
const POIS = produit({ id: "poi", name: "Pois chiche", basePerPack: 25000, cost_per_base_unit: 0.00092 });
// Tahina : seau de 18 kg.
const TAHINA = produit({ id: "tah", name: "Tahina", basePerPack: 18000, cost_per_base_unit: 0.0039 });

const ligne = (l: Partial<LigneFacture>): LigneFacture => ({
  designation: "x", ingredient_id: null, qty: 1, prix: 0, action: "stock", ...l,
});

describe("Ce qu un colis met en stock", () => {
  it("suit le conditionnement du FOURNISSEUR quand on le connaît", () => {
    // Le même sac fait 25 kg chez l'un et 5 kg chez l'autre : c'est le
    // colis facturé qui décide, pas la fiche produit.
    expect(contenuColis(POIS)).toBe(25000);
  });

  it("retombe sur le colisage de la fiche sinon", () => {
    expect(contenuColis(produit({ id: "x", unit: "kg", pack_quantity: 5 }))).toBe(5000);
    expect(contenuColis(produit({ id: "y", unit: "piece", pack_quantity: 6 }))).toBe(6);
  });
});

describe("Une facture entre en stock", () => {
  it("convertit les colis en kilos et calcule le coût au kilo", () => {
    const plan = planFacture([ligne({ ingredient_id: "poi", qty: 2, prix: 23 })], [POIS]);
    expect(plan.mouvements).toHaveLength(1);
    expect(plan.mouvements[0].qty).toBe(50000);           // 2 sacs × 25 kg
    expect(plan.mouvements[0].unit_cost).toBeCloseTo(46 / 50000, 10); // 0,92 €/kg
    expect(plan.patches[0].stock_qty).toBe(50000);
    expect(plan.total).toBe(46);
  });

  it("fait la moyenne pondérée avec le stock déjà présent", () => {
    // 10 kg à 2 €/kg en stock, on reçoit 10 kg à 3 €/kg → 2,50 €/kg.
    const p = produit({ id: "a", stock_qty: 10000, cmup: 0.002, basePerPack: 10000 });
    const plan = planFacture([ligne({ ingredient_id: "a", qty: 1, prix: 30 })], [p]);
    expect(plan.patches[0].stock_qty).toBe(20000);
    expect(plan.patches[0].cmup).toBeCloseTo(0.0025, 10);
  });

  it("additionne deux lignes du même produit au lieu d écraser la première", () => {
    // Le piège classique : une facture qui liste deux fois la même
    // référence. Écraser perdrait la moitié de la marchandise.
    const plan = planFacture(
      [
        ligne({ designation: "POIS CHICHE JOVA", ingredient_id: "poi", qty: 2, prix: 23 }),
        ligne({ designation: "POIS CHICHE JOVA", ingredient_id: "poi", qty: 1, prix: 23 }),
      ],
      [POIS],
    );
    expect(plan.mouvements).toHaveLength(1);
    expect(plan.mouvements[0].qty).toBe(75000);
    expect(plan.lignes).toHaveLength(2);   // la facture garde ses deux lignes
    expect(plan.total).toBe(69);
  });

  it("ne mélange pas deux produits", () => {
    const plan = planFacture(
      [
        ligne({ ingredient_id: "poi", qty: 1, prix: 23 }),
        ligne({ ingredient_id: "tah", qty: 1, prix: 70.2 }),
      ],
      [POIS, TAHINA],
    );
    expect(plan.patches).toHaveLength(2);
    expect(plan.patches.find((p) => p.id === "tah")!.cmup).toBeCloseTo(70.2 / 18000, 10);
    expect(plan.total).toBe(93.2);
  });
});

describe("Ce qui n est pas de la marchandise", () => {
  it("compte les frais dans le total sans toucher au stock", () => {
    const plan = planFacture(
      [
        ligne({ ingredient_id: "poi", qty: 1, prix: 23 }),
        ligne({ designation: "CONSIGNE PALETTE", qty: 1, prix: 18, action: "frais" }),
      ],
      [POIS],
    );
    expect(plan.mouvements).toHaveLength(1);
    expect(plan.totalMarchandise).toBe(23);
    expect(plan.totalFrais).toBe(18);
    expect(plan.total).toBe(41);
  });

  it("ignore ce qu on lui dit d ignorer", () => {
    const plan = planFacture([ligne({ qty: 1, prix: 99, action: "ignorer" })], []);
    expect(plan.total).toBe(0);
    expect(plan.avertissements).toHaveLength(0);
  });
});

describe("Les avertissements, avant d écrire", () => {
  it("refuse d entrer en stock un produit sans conditionnement connu", () => {
    const sansColis = produit({ id: "z", name: "Mystère", unit: "kg", pack_quantity: 0 });
    const plan = planFacture([ligne({ designation: "MYSTERE 1X", ingredient_id: "z", qty: 1, prix: 10 })], [sansColis]);
    expect(plan.mouvements).toHaveLength(0);
    expect(plan.avertissements[0].texte).toContain("conditionnement");
  });

  it("signale une ligne sans produit choisi", () => {
    const plan = planFacture([ligne({ designation: "ARTICLE INCONNU", qty: 1, prix: 10 })], []);
    expect(plan.mouvements).toHaveLength(0);
    expect(plan.avertissements[0].texte).toContain("Aucun produit choisi");
  });

  it("signale une hausse de prix brutale", () => {
    // 0,92 €/kg habituels, 2,00 €/kg facturés : souvent un colisage lu de
    // travers (un sac pris pour un kilo).
    const plan = planFacture([ligne({ ingredient_id: "poi", qty: 1, prix: 50 })], [POIS]);
    expect(plan.avertissements.some((a) => a.texte.includes("Le prix passe"))).toBe(true);
  });

  it("vérifie que la somme tombe sur le total imprimé", () => {
    const plan = planFacture([ligne({ ingredient_id: "poi", qty: 2, prix: 23 })], [POIS], 64);
    const a = plan.avertissements.find((x) => x.ligne === "Total");
    expect(a).toBeTruthy();
    expect(a!.texte).toContain("46.00");
    expect(a!.texte).toContain("64.00");
  });

  it("se tait quand la somme tombe juste", () => {
    const plan = planFacture([ligne({ ingredient_id: "poi", qty: 2, prix: 23 })], [POIS], 46);
    expect(plan.avertissements.filter((a) => a.ligne === "Total")).toHaveLength(0);
  });

  it("tolère un centime d écart d arrondi", () => {
    const plan = planFacture([ligne({ ingredient_id: "poi", qty: 3, prix: 23.33 })], [POIS], 69.99);
    expect(plan.avertissements.filter((a) => a.ligne === "Total")).toHaveLength(0);
  });
});
