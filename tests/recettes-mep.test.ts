// =====================================================================
//  RECETTES & MISES EN PLACE — tous les cas de figure.
//
//  Une cuisine réelle empile les préparations : un fond entre dans une
//  sauce, la sauce entre dans deux plats différents, et une pâte à crêpes
//  se compte en pièces. Chaque niveau doit reporter son coût correctement,
//  et le déstockage doit descendre jusqu'aux ingrédients de base.
//
//  Le contrôle décisif (test 8) : la somme des coûts de recettes vendues
//  doit être ÉGALE à la valeur des ingrédients réellement sortis du stock.
//  Si les deux tombent, alors toute la pyramide MEP est cohérente.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  calcRecipeCost, calcRecipeAllergens, ingredientsPerYieldBase, yieldFactor,
  type RecipeRow, type IngRow,
} from "@/lib/costing";

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

// ── Ingrédients de base ───────────────────────────────────────────────
const ing = (id: string, unit: string, cmup: number, yield_pct = 100, allergens: string[] = []): IngRow =>
  ({ id, unit, cmup, cost_per_base_unit: cmup, yield_pct, allergens } as any);

const tom = ing("tom", "kg", 0.002, 90);            // 2 €/kg, 10 % de parage
const hui = ing("hui", "l", 0.005);                 // 5 €/L
const far = ing("far", "kg", 0.001, 100, ["Gluten"]);   // 1 €/kg
const oeuf = ing("oeuf", "unit", 0.3, 100, ["Œufs"]);   // 0,30 €/pièce
const lait = ing("lait", "l", 0.0012, 100, ["Lait"]);   // 1,20 €/L
const ingMap = new Map<string, IngRow>([
  ["tom", tom], ["hui", hui], ["far", far], ["oeuf", oeuf], ["lait", lait],
]);

// ── La pyramide : ingrédient → fond → sauce → plats ───────────────────
const recipes: RecipeRow[] = [
  // MEP niveau 1 : réduction — 1,2 kg de tomate donnent 1 kg de fond
  { id: "fond", yield_portions: 1, yield_unit: "kg", recipe_lines: [
    { ingredient_id: "tom", sub_recipe_id: null, quantity: 1.2, unit: "kg" },
  ] },
  // MEP niveau 2 : utilise la MEP niveau 1
  { id: "sauce", yield_portions: 2, yield_unit: "kg", recipe_lines: [
    { ingredient_id: null, sub_recipe_id: "fond", quantity: 500, unit: "g" },
    { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.1, unit: "l" },
  ] },
  // MEP en PIÈCES : 20 crêpes par lot
  { id: "crepes", yield_portions: 20, yield_unit: "piece", recipe_lines: [
    { ingredient_id: "far", sub_recipe_id: null, quantity: 0.5, unit: "kg" },
    { ingredient_id: "oeuf", sub_recipe_id: null, quantity: 4, unit: "unit" },
    { ingredient_id: "lait", sub_recipe_id: null, quantity: 1, unit: "l" },
  ] },
  // Plat A : 1 portion, utilise la sauce (donc le fond, donc la tomate)
  { id: "pates", yield_portions: 1, yield_unit: "portion", recipe_lines: [
    { ingredient_id: null, sub_recipe_id: "sauce", quantity: 400, unit: "g" },
    { ingredient_id: "hui", sub_recipe_id: null, quantity: 0.02, unit: "l" },
  ] },
  // Plat B : 4 portions d'un coup, MÊME sauce partagée
  { id: "lasagnes", yield_portions: 4, yield_unit: "portion", recipe_lines: [
    { ingredient_id: null, sub_recipe_id: "sauce", quantity: 1, unit: "kg" },
    { ingredient_id: "far", sub_recipe_id: null, quantity: 300, unit: "g" },
  ] },
  // Plat C : 1 portion = 1 crêpe prise sur le lot de 20
  { id: "crepe_sucree", yield_portions: 1, yield_unit: "portion", recipe_lines: [
    { ingredient_id: null, sub_recipe_id: "crepes", quantity: 1, unit: "piece" },
  ] },
];
const recipeMap = new Map(recipes.map((r) => [r.id, r]));

describe("Coût des MEP et des recettes, niveau par niveau", () => {
  it("1. MEP de réduction : 1,2 kg de tomate → 1 kg de fond", () => {
    // 1 200 g nets ÷ 0,9 = 1 333,3 g bruts × 0,002 = 2,6667 €
    const c = calcRecipeCost("fond", recipes, ingMap);
    near(c, 2.666667, 5);
    near(c / 1, 2.666667, 5);   // 2,67 € le kg de fond
  });

  it("2. MEP à DEUX niveaux : la sauce reprend le coût du fond", () => {
    const c = calcRecipeCost("sauce", recipes, ingMap);
    // 500 g de fond = la moitié du lot → 1,3333 € ; huile 100 ml → 0,50 €
    near(c, 1.833333, 5);
    near(c / 2, 0.916667, 5);   // 0,92 € le kg de sauce
  });

  it("3. MEP en PIÈCES : 20 crêpes par lot", () => {
    const c = calcRecipeCost("crepes", recipes, ingMap);
    // farine 0,50 € + œufs 1,20 € + lait 1,20 €
    near(c, 2.9, 6);
    near(c / 20, 0.145, 6);     // 0,145 € la crêpe
  });

  it("4. Plat à 1 portion utilisant une MEP de niveau 2", () => {
    const c = calcRecipeCost("pates", recipes, ingMap);
    // 400 g de sauce = 20 % du lot (0,3667 €) + 20 ml d'huile (0,10 €)
    near(c, 0.466667, 5);
  });

  it("5. Plat à 4 portions : le coût par portion divise le lot", () => {
    const total = calcRecipeCost("lasagnes", recipes, ingMap);
    // 1 kg de sauce = la moitié du lot (0,9167 €) + 300 g de farine (0,30 €)
    near(total, 1.216667, 5);
    near(total / 4, 0.304167, 5);   // coût par portion
  });

  it("6. Plat prenant 1 pièce sur un lot de 20", () => {
    near(calcRecipeCost("crepe_sucree", recipes, ingMap), 0.145, 6);
  });

  it("7. Déstockage : les équivalents descendent jusqu'aux ingrédients de base", () => {
    // Pâtes : 400 g de sauce → 0,25 g de fond par g de sauce → 1,2 g de tomate
    // par g de fond, soit 0,3 g de tomate par g de sauce → 120 g NETS.
    const pates = ingredientsPerYieldBase("pates", recipeMap);
    near(pates.get("tom") ?? 0, 120, 6);
    near(pates.get("hui") ?? 0, 40, 6);   // 20 via la sauce + 20 en direct

    // Lasagnes : par PORTION (le lot fait 4 portions)
    const lasagnes = ingredientsPerYieldBase("lasagnes", recipeMap);
    near(lasagnes.get("tom") ?? 0, 75, 6);
    near(lasagnes.get("hui") ?? 0, 12.5, 6);
    near(lasagnes.get("far") ?? 0, 75, 6);

    // Crêpe : 1 pièce sur 20 → un vingtième des ingrédients du lot
    const crepe = ingredientsPerYieldBase("crepe_sucree", recipeMap);
    near(crepe.get("far") ?? 0, 25, 6);
    near(crepe.get("oeuf") ?? 0, 0.2, 6);
    near(crepe.get("lait") ?? 0, 50, 6);
  });

  it("8. CONTRÔLE DÉCISIF : coût des plats vendus = valeur des ingrédients sortis", () => {
    const ventes = { pates: 50, lasagnes: 20, crepe_sucree: 30 };

    // (a) Somme des coûts de recettes, comme sur l'écran Ventes & marges
    const coutParPortion = (id: string) => {
      const r = recipeMap.get(id)!;
      return calcRecipeCost(id, recipes, ingMap) / (r.yield_portions || 1);
    };
    const coutVentes =
      ventes.pates * coutParPortion("pates") +
      ventes.lasagnes * coutParPortion("lasagnes") +
      ventes.crepe_sucree * coutParPortion("crepe_sucree");
    near(coutVentes, 33.766667, 5);

    // (b) Quantités BRUTES réellement sorties du stock, puis valorisées au CMUP
    const consommation = new Map<string, number>();
    for (const [id, qte] of Object.entries(ventes)) {
      const par = ingredientsPerYieldBase(id, recipeMap);
      for (const [ingId, net] of Array.from(par.entries())) {
        const brut = (net * qte) / yieldFactor(ingMap.get(ingId)!);
        consommation.set(ingId, (consommation.get(ingId) ?? 0) + brut);
      }
    }
    near(consommation.get("tom")!, 8333.333333, 4);   // 8,33 kg bruts
    near(consommation.get("hui")!, 2250, 6);
    near(consommation.get("far")!, 2250, 6);
    near(consommation.get("oeuf")!, 6, 6);
    near(consommation.get("lait")!, 1500, 6);

    const valeurSortie = Array.from(consommation.entries())
      .reduce((s, [ingId, q]) => s + q * (ingMap.get(ingId)!.cmup ?? 0), 0);

    // Les deux chemins doivent donner le MÊME montant : c'est la preuve que
    // la pyramide MEP ne perd ni ne double aucun gramme.
    near(valeurSortie, 33.766667, 5);
    near(coutVentes, valeurSortie, 6);
  });

  it("9. Le rendement n'est appliqué QU'UNE fois, même à travers deux MEP", () => {
    // Tomate par portion de pâtes : 120 g nets → 133,33 g bruts (÷ 0,9).
    // Si le rendement était appliqué à chaque niveau, on aurait 148,1 g.
    const par = ingredientsPerYieldBase("pates", recipeMap);
    const brut = par.get("tom")! / yieldFactor(tom);
    near(brut, 133.333333, 5);
    expect(brut).toBeLessThan(140);
  });

  it("10. Allergènes hérités à travers les MEP", () => {
    // Crêpe sucrée : rien en direct, tout vient du lot de crêpes.
    const a = Array.from(calcRecipeAllergens("crepe_sucree", recipes, ingMap)).sort();
    expect(a).toEqual(["Lait", "Œufs", "Gluten"].sort());

    // Lasagnes : la farine en direct ; la sauce n'apporte rien.
    expect(Array.from(calcRecipeAllergens("lasagnes", recipes, ingMap))).toEqual(["Gluten"]);
    // Pâtes : ni tomate ni huile ne sont allergènes.
    expect(Array.from(calcRecipeAllergens("pates", recipes, ingMap))).toEqual([]);
  });

  it("11. Une hausse de prix remonte toute la pyramide", () => {
    const cher = new Map(ingMap);
    cher.set("tom", ing("tom", "kg", 0.0025, 90));   // 2 € → 2,50 €/kg

    near(calcRecipeCost("fond", recipes, cher), 3.333333, 5);
    near(calcRecipeCost("sauce", recipes, cher), 2.166667, 5);
    const pates = calcRecipeCost("pates", recipes, cher);
    near(pates, 0.533333, 5);
    // La hausse est exactement celle de la tomate consommée par portion :
    // 133,33 g bruts × 0,0005 €/g = 0,0667 €
    near(pates - 0.466667, 0.066667, 5);
    // La crêpe ne contient pas de tomate : son coût ne bouge pas.
    near(calcRecipeCost("crepe_sucree", recipes, cher), 0.145, 6);
  });

  it("12. MEP supprimée : le plat ne garde pas le coût disparu", () => {
    // On retire « sauce » du catalogue (comme une suppression en base).
    const sansSauce = recipes.filter((r) => r.id !== "sauce");
    const c = calcRecipeCost("pates", sansSauce, ingMap);
    // Il ne reste que l'huile ajoutée en direct : 20 ml × 0,005 = 0,10 €
    near(c, 0.1, 6);
  });

  it("13. MEP circulaire sur TROIS niveaux (A → B → C → A) : rien n'explose", () => {
    const boucle: RecipeRow[] = [
      { id: "a", yield_portions: 1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: "tom", sub_recipe_id: null, quantity: 1, unit: "kg" },
        { ingredient_id: null, sub_recipe_id: "b", quantity: 100, unit: "g" },
      ] },
      { id: "b", yield_portions: 1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "c", quantity: 100, unit: "g" },
      ] },
      { id: "c", yield_portions: 1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "a", quantity: 100, unit: "g" },
      ] },
    ];
    const memo = new Map<string, number>();
    const tainted = new Set<string>();
    expect(() => calcRecipeCost("a", boucle, ingMap, memo, new Set(), tainted)).not.toThrow();
    // Aucun coût tronqué ne doit être mémorisé (donc jamais écrit en base).
    expect(memo.size).toBe(0);
    expect(tainted.size).toBeGreaterThan(0);
    // Le déstockage ne doit pas boucler indéfiniment non plus.
    const bm = new Map(boucle.map((r) => [r.id, r]));
    expect(() => ingredientsPerYieldBase("a", bm)).not.toThrow();
  });

  it("14. Une MEP jamais utilisée reste chiffrée (pour l'inventaire)", () => {
    // Le fond n'est utilisé que par la sauce ; s'il en reste en frigo, il faut
    // pouvoir le compter et le valoriser.
    const parGramme = ingredientsPerYieldBase("fond", recipeMap);
    near(parGramme.get("tom") ?? 0, 1.2, 6);          // 1,2 g de tomate par g de fond
    // 800 g de fond en frigo → 800 × 1,2 ÷ 0,9 = 1 066,7 g de tomate brute
    near((parGramme.get("tom")! * 800) / yieldFactor(tom), 1066.666667, 5);
  });
});
