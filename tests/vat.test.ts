// =====================================================================
//  TVA sur les ventes.
//
//  Ce fichier protège une correction, pas une fonctionnalité : jusqu'ici
//  l'app divisait un coût HT par un prix TTC, ce qui sous-estimait TOUS
//  les food costs. Le test central est celui qui chiffre l'écart.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  htDepuisTTC, ttcDepuisHT, foodCostPct, margeHT, prixSuggereTTC,
  arrondiCommercial, estAlcool, tauxDeVente, reglagesTva, canalLabel,
  TVA_DEFAUT, CANAUX, type ReglagesTva,
} from "@/lib/vat";

const R: ReglagesTva = TVA_DEFAUT;

describe("L'erreur que ça corrige", () => {
  it("un plat à 15 € avec 4 € de matière n'est pas à 26,7 % mais à 29,3 %", () => {
    const faux = (4 / 15) * 100;
    const juste = foodCostPct(4, 15, 10)!;
    expect(faux).toBeCloseTo(26.67, 2);
    expect(juste).toBeCloseTo(29.33, 2);
    expect(juste - faux).toBeGreaterThan(2.5);   // 2,6 points d'écart
  });

  it("l'écart grandit avec le taux — l'alcool est le plus trompeur", () => {
    const faux = (2 / 8) * 100;                    // un cocktail à 8 €
    const juste = foodCostPct(2, 8, 20)!;
    expect(faux).toBeCloseTo(25, 2);
    expect(juste).toBeCloseTo(30, 2);              // 5 points d'écart
  });
});

describe("Conversions", () => {
  it("TTC → HT et retour", () => {
    expect(htDepuisTTC(15, 10)).toBeCloseTo(13.6364, 4);
    expect(ttcDepuisHT(13.6364, 10)).toBeCloseTo(15, 3);
    expect(htDepuisTTC(ttcDepuisHT(42, 5.5), 5.5)).toBeCloseTo(42, 6);
  });

  it("un taux nul ou absent laisse le montant tel quel", () => {
    expect(htDepuisTTC(15, 0)).toBe(15);
    expect(htDepuisTTC(15, NaN)).toBe(15);
  });

  it("ne fabrique pas de montant à partir de rien", () => {
    expect(htDepuisTTC(NaN, 10)).toBe(0);
  });
});

describe("Food cost et marge", () => {
  it("compare des bases comparables : coût HT sur CA HT", () => {
    expect(foodCostPct(4, 15, 10)).toBeCloseTo(29.33, 2);
    expect(margeHT(15, 4, 10)).toBeCloseTo(9.6364, 4);
  });

  it("sans prix de vente, le food cost n'existe pas — il ne vaut pas 0", () => {
    expect(foodCostPct(4, 0, 10)).toBeNull();
    expect(foodCostPct(4, NaN, 10)).toBeNull();
  });

  it("un plat offert a un coût mais aucune marge", () => {
    expect(margeHT(0, 4, 10)).toBeCloseTo(-4, 6);
  });
});

describe("Prix suggéré pour tenir un objectif", () => {
  it("vise l'objectif sur la marge RÉELLE, pas sur le prix affiché", () => {
    // 4 € de matière, objectif 30 % → 13,33 € HT → 14,67 € TTC
    const p = prixSuggereTTC(4, 30, 10)!;
    expect(p).toBeCloseTo(14.667, 3);
    // Et le food cost du prix suggéré retombe bien sur l'objectif.
    expect(foodCostPct(4, p, 10)).toBeCloseTo(30, 6);
  });

  it("ne suggère rien sans coût ou sans objectif", () => {
    expect(prixSuggereTTC(0, 30, 10)).toBeNull();
    expect(prixSuggereTTC(4, 0, 10)).toBeNull();
  });

  it("arrondit au prix de carte supérieur", () => {
    expect(arrondiCommercial(14.667)).toBe(15);
    expect(arrondiCommercial(13.2)).toBe(13.5);
    expect(arrondiCommercial(13.5)).toBe(13.5);
    expect(arrondiCommercial(12.1, 1)).toBe(13);
  });
});

describe("Quel taux s'applique", () => {
  it("suit le mode de consommation", () => {
    expect(tauxDeVente("dine_in", false, R)).toBe(10);
    expect(tauxDeVente("takeaway", false, R)).toBe(5.5);
    expect(tauxDeVente("delivery", false, R)).toBe(10);
    expect(tauxDeVente(null, false, R)).toBe(10);      // sur place par défaut
  });

  it("l'alcool prime sur le canal — une bière à emporter reste à 20 %", () => {
    for (const c of ["dine_in", "takeaway", "delivery"]) {
      expect(tauxDeVente(c, true, R)).toBe(20);
    }
  });

  it("les trois canaux sont proposés, avec « à emporter »", () => {
    expect(CANAUX.map((c) => c.key)).toEqual(["dine_in", "takeaway", "delivery"]);
    expect(canalLabel("takeaway")).toBe("À emporter");
    expect(canalLabel(undefined)).toBe("Sur place");
  });
});

describe("Reconnaître un alcool", () => {
  it("se fie d'abord au numéro interne, qui a été validé", () => {
    expect(estAlcool({ internal_ref: 9004 })).toBe(true);    // bières
    expect(estAlcool({ internal_ref: 10012 })).toBe(true);   // vins
    expect(estAlcool({ internal_ref: 11000 })).toBe(true);   // spiritueux
    expect(estAlcool({ internal_ref: 8002 })).toBe(false);   // softs
    expect(estAlcool({ internal_ref: 3001 })).toBe(false);   // légumes
  });

  it("le numéro l'emporte, même si le nom prête à confusion", () => {
    // Un « sirop de menthe » rangé en softs reste un soft.
    expect(estAlcool({ internal_ref: 8010, name: "Cocktail sans alcool" })).toBe(false);
  });

  it("retombe sur la catégorie puis le nom quand rien n'est numéroté", () => {
    expect(estAlcool({ category: "Bières" })).toBe(true);
    expect(estAlcool({ category: "Autre", name: "Almaza 33 cl" })).toBe(false); // marque seule : non
    expect(estAlcool({ category: "Autre", name: "Vin rouge maison" })).toBe(true);
    expect(estAlcool({ category: "Cocktails" })).toBe(true);
    expect(estAlcool({ category: "Légumes", name: "Tomate" })).toBe(false);
    expect(estAlcool({})).toBe(false);
  });
});

describe("Lecture des réglages", () => {
  it("prend les taux du restaurant", () => {
    const r = reglagesTva({ vat_dine_in: 20, vat_takeaway: 7, vat_delivery: 15, vat_alcohol: 25 });
    expect(r).toEqual({ dine_in: 20, takeaway: 7, delivery: 15, alcohol: 25 });
  });

  it("comble ce qui manque plutôt que de renvoyer NaN", () => {
    expect(reglagesTva({})).toEqual(TVA_DEFAUT);
    expect(reglagesTva(null)).toEqual(TVA_DEFAUT);
    expect(reglagesTva({ vat_dine_in: "abc" }).dine_in).toBe(10);
    expect(reglagesTva({ vat_dine_in: 150 }).dine_in).toBe(10);   // hors bornes
  });

  it("accepte un taux à zéro : tous les pays ne taxent pas la nourriture", () => {
    expect(reglagesTva({ vat_dine_in: 0 }).dine_in).toBe(0);
  });
});
