// =====================================================================
//  Saisir une preparation en PARTS plutot qu en quantites.
//
//  Rudy pense « 40 % de pois chiches », pas « 0,4 kg par kilo ». Les deux
//  ecrivent la meme chose : la part est une vue sur la quantite, qui
//  reste la verite. Si on stockait le pourcentage, une preparation qui
//  gonfle (pois chiches secs qui cuisent) ou qui reduit (sauce qui
//  s evapore) deviendrait fausse — le total ne fait 100 % que lorsque
//  rien ne se perd ni ne s absorbe.
// =====================================================================
import { describe, it, expect } from "vitest";
import { ingredientsPerYieldBase, type RecipeRow } from "@/lib/costing";

const toBase = (q: number, u: string) => (u === "kg" || u === "l" ? q * 1000 : q);

/** La part d une ligne dans le rendement, en % — ce qu affiche l ecran. */
const part = (q: number, u: string, rendement: number, uRendement: string) =>
  Math.round((toBase(q, u) / toBase(rendement, uRendement)) * 1000) / 10;

/** L inverse : une part saisie redevient une quantite dans l unite choisie. */
const quantite = (p: number, u: string, rendement: number, uRendement: string) => {
  const base = (p / 100) * toBase(rendement, uRendement);
  return base / (u === "kg" || u === "l" ? 1000 : 1);
};

describe("Parts et quantités disent la même chose", () => {
  it("convertit une quantité en part", () => {
    // 0,4 kg de pois chiches dans un lot d un kilo = 40 %.
    expect(part(0.4, "kg", 1, "kg")).toBe(40);
    expect(part(400, "g", 1, "kg")).toBe(40);
    expect(part(120, "g", 1, "kg")).toBe(12);
  });

  it("convertit une part en quantité, dans l unité de la ligne", () => {
    expect(quantite(40, "kg", 1, "kg")).toBeCloseTo(0.4, 6);
    expect(quantite(40, "g", 1, "kg")).toBeCloseTo(400, 6);
    expect(quantite(12, "g", 1, "kg")).toBeCloseTo(120, 6);
  });

  it("fait l aller-retour sans deriver", () => {
    for (const [q, u] of [[0.4, "kg"], [250, "g"], [1.5, "kg"], [5, "g"]] as [number, string][]) {
      const p = part(q, u, 1, "kg");
      expect(quantite(p, u, 1, "kg")).toBeCloseTo(q, 3);
    }
  });

  it("suit le rendement : un lot de 5 kg change toutes les parts", () => {
    expect(part(2, "kg", 5, "kg")).toBe(40);
    expect(part(2, "kg", 1, "kg")).toBe(200);
  });
});

describe("Le total des parts raconte la transformation", () => {
  const total = (lignes: [number, string][], rendement: number, uR: string) =>
    Math.round(lignes.reduce((s, [q, u]) => s + part(q, u, rendement, uR), 0) * 10) / 10;

  it("fait 100 % quand rien ne se perd — pâte à manakich", () => {
    // 3 kg farine + 1,5 L lait + 0,35 L huile + 0,25 kg beurre = 5,1 kg de pâte.
    const t = total([[3, "kg"], [1.5, "l"], [0.35, "l"], [0.25, "kg"]], 5.1, "kg");
    expect(t).toBeCloseTo(100, 0);
  });

  it("descend sous 100 % quand la préparation absorbe — houmous", () => {
    // 2 kg de pois chiches SECS donnent 5 kg de houmous : l eau n est pas
    // un ingredient, le total ne peut pas faire 100 %.
    const t = total([[2, "kg"], [0.6, "kg"], [0.05, "kg"]], 5, "kg");
    expect(t).toBeLessThan(100);
    expect(t).toBeCloseTo(53, 0);
  });

  it("depasse 100 % quand la preparation reduit", () => {
    // 3 kg de tomates donnent 1 kg de sauce.
    expect(total([[3, "kg"]], 1, "kg")).toBe(300);
  });
});

describe("Le moteur de cout ne voit que des quantites", () => {
  it("prendre 200 g d une MEP tire la part de chaque ingredient", () => {
    // MEP d un kilo : 40 % pois chiches, 12 % tahina.
    const mep: RecipeRow = {
      id: "mep", yield_portions: 1, yield_unit: "kg",
      recipe_lines: [
        { ingredient_id: "pois", sub_recipe_id: null, quantity: 0.4, unit: "kg" },
        { ingredient_id: "tahina", sub_recipe_id: null, quantity: 0.12, unit: "kg" },
      ],
    };
    const parGramme = ingredientsPerYieldBase("mep", new Map([["mep", mep]]));
    // Par gramme de MEP : 0,4 g de pois chiches, 0,12 g de tahina.
    expect(parGramme.get("pois")).toBeCloseTo(0.4, 6);
    expect(parGramme.get("tahina")).toBeCloseTo(0.12, 6);
    // Donc 200 g de MEP → 80 g et 24 g.
    expect((parGramme.get("pois") ?? 0) * 200).toBeCloseTo(80, 6);
    expect((parGramme.get("tahina") ?? 0) * 200).toBeCloseTo(24, 6);
  });

  it("un rendement de 5 kg donne le meme resultat qu un de 1 kg aux memes parts", () => {
    const lot5: RecipeRow = {
      id: "r", yield_portions: 5, yield_unit: "kg",
      recipe_lines: [{ ingredient_id: "pois", sub_recipe_id: null, quantity: 2, unit: "kg" }],
    };
    const lot1: RecipeRow = {
      id: "r", yield_portions: 1, yield_unit: "kg",
      recipe_lines: [{ ingredient_id: "pois", sub_recipe_id: null, quantity: 0.4, unit: "kg" }],
    };
    const a = ingredientsPerYieldBase("r", new Map([["r", lot5]]));
    const b = ingredientsPerYieldBase("r", new Map([["r", lot1]]));
    expect(a.get("pois")).toBeCloseTo(b.get("pois")!, 9);
  });
});
