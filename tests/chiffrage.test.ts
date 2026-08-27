// =====================================================================
//  « Pas encore chiffree » n est pas « coute zero ».
//
//  Releve en production chez Amaly : 111 fiches sans ligne d ingredient,
//  un bandeau « FOOD COST MOYEN 0.0 % — sur 111 recettes avec prix », et
//  chaque carte affichant « 0.0 % FC ». Un patron qui ouvre cet ecran en
//  conclut que sa marge est parfaite. C est l inverse : il n a rien saisi.
// =====================================================================
import { describe, it, expect } from "vitest";
import { estChiffree, aUnPrix, manqueA, moyenneSur } from "@/lib/chiffrage";
import { revenuHT, foodCostPct, TVA_DEFAUT } from "@/lib/vat";

describe("Chiffrage : zero n est pas une valeur", () => {
  it("distingue une fiche non chiffree d une fiche gratuite", () => {
    expect(estChiffree({ total_cost: 0 })).toBe(false);
    expect(estChiffree({ total_cost: null })).toBe(false);
    expect(estChiffree({ total_cost: undefined })).toBe(false);
    expect(estChiffree({ total_cost: 0.01 })).toBe(true);
  });

  it("dit ce qui manque a une fiche", () => {
    expect(manqueA({ total_cost: 3, menu_price: 12 })).toBeNull();
    expect(manqueA({ total_cost: 0, menu_price: 12 })).toBe("chiffrage");
    expect(manqueA({ total_cost: 3, menu_price: 0 })).toBe("prix");
    expect(manqueA({ total_cost: 0, menu_price: 0 })).toBe("les deux");
  });

  it("aUnPrix ignore un prix vide ou nul", () => {
    expect(aUnPrix({ menu_price: null })).toBe(false);
    expect(aUnPrix({ menu_price: 0 })).toBe(false);
    expect(aUnPrix({ menu_price: 12 })).toBe(true);
  });
});

describe("Moyennes : ce qu on ecarte doit se voir", () => {
  const fiches = [
    { total_cost: 4, menu_price: 15 },   // chiffree
    { total_cost: 6, menu_price: 20 },   // chiffree
    { total_cost: 0, menu_price: 18 },   // pas chiffree
    { total_cost: 0, menu_price: 0 },    // rien
  ];

  it("ne moyenne que les fiches completes et compte les autres", () => {
    const r = moyenneSur(
      fiches,
      (f) => estChiffree(f) && aUnPrix(f),
      (f) => foodCostPct(f.total_cost, f.menu_price, 10),
    );
    expect(r.retenues).toBe(2);
    expect(r.ecartees).toBe(2);
    // 4 / 13,636 = 29,33 % et 6 / 18,182 = 33,00 % → 31,17 %
    expect(r.moyenne).toBeCloseTo(31.17, 1);
  });

  it("l ancienne facon de compter aurait annonce 15,6 % au lieu de 31,2 %", () => {
    // Ce que faisait l ecran : moyenne sur TOUTES les fiches ayant un prix,
    // les non chiffrees comptant pour 0.
    const avecPrix = fiches.filter(aUnPrix);
    const ancienne = avecPrix.reduce(
      (s, f) => s + (foodCostPct(f.total_cost, f.menu_price, 10) ?? 0), 0,
    ) / avecPrix.length;
    expect(ancienne).toBeCloseTo(20.78, 1);   // deux fiches sur trois a zero
    expect(ancienne).toBeLessThan(31.17);     // le food cost paraissait meilleur
  });

  it("renvoie null quand aucune fiche n est exploitable", () => {
    const r = moyenneSur([{ total_cost: 0, menu_price: 0 }], estChiffree, (f) => f.total_cost);
    expect(r.moyenne).toBeNull();
    expect(r.ecartees).toBe(1);
  });
});

describe("TVA sur le chiffre d affaires des ventes", () => {
  it("retire la TVA du canal de vente", () => {
    // 100 € encaisses sur place a 10 % → 90,91 € de CA reel.
    expect(revenuHT(100, "dine_in", { name: "Houmous" }, TVA_DEFAUT)).toBeCloseTo(90.91, 2);
    // A emporter, 5,5 %.
    expect(revenuHT(100, "takeaway", { name: "Houmous" }, TVA_DEFAUT)).toBeCloseTo(94.79, 2);
  });

  it("l alcool garde son taux meme a emporter", () => {
    const vin = { name: "Chateau Musar rouge", category: "Vins rouges" };
    expect(revenuHT(100, "takeaway", vin, TVA_DEFAUT)).toBeCloseTo(83.33, 2);
  });

  it("diviser le cout par le TTC sous-estime le food cost", () => {
    const coutHT = 4, prixTTC = 15;
    const faux = (coutHT / prixTTC) * 100;
    const juste = foodCostPct(coutHT, prixTTC, 10)!;
    expect(faux).toBeCloseTo(26.67, 2);
    expect(juste).toBeCloseTo(29.33, 2);
    expect(juste - faux).toBeGreaterThan(2.5);   // les 2,6 points annonces
  });
});
