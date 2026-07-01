import { describe, it, expect } from "vitest";
import {
  toBase, calcRecipeCost, calcRecipeAllergens, ingredientsPerYieldBase,
  RecipeRow, IngRow,
} from "./costing";

// Helpers to build fixtures
const ing = (id: string, costPerBase: number, unit: string, extra: Partial<IngRow> = {}): IngRow =>
  ({ id, cost_per_base_unit: costPerBase, cmup: null, unit, yield_pct: 100, allergens: [], ...extra });

describe("toBase", () => {
  it("converts kg/l to base, leaves portion/piece", () => {
    expect(toBase(2, "kg")).toBe(2000);
    expect(toBase(1.5, "l")).toBe(1500);
    expect(toBase(3, "piece")).toBe(3);
    expect(toBase(4, "portion")).toBe(4);
  });
});

describe("calcRecipeCost", () => {
  it("costs a simple ingredient recipe at CMUP when present", () => {
    const ingMap = new Map<string, IngRow>([["flour", ing("flour", 0.001, "kg", { cmup: 0.002 })]]); // €/g, cmup wins
    const recipes: RecipeRow[] = [
      { id: "r1", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: "flour", sub_recipe_id: null, quantity: 200, unit: "g" }] },
    ];
    // 200 g × €0.002/g (CMUP) = €0.40
    expect(calcRecipeCost("r1", recipes, ingMap)).toBeCloseTo(0.4, 5);
  });

  it("applies material yield (net → gross)", () => {
    const ingMap = new Map<string, IngRow>([["carrot", ing("carrot", 0.002, "kg", { yield_pct: 80 })]]); // €0.002/g, 80% usable
    const recipes: RecipeRow[] = [
      { id: "r1", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: "carrot", sub_recipe_id: null, quantity: 100, unit: "g" }] },
    ];
    // 100 g net → 125 g gross × €0.002 = €0.25
    expect(calcRecipeCost("r1", recipes, ingMap)).toBeCloseTo(0.25, 5);
  });

  it("costs a sub-recipe by the fraction of its batch consumed (conditionnement)", () => {
    // MEP sauce: yields 2 kg, costs €10 total (1000 g tomato @ €0.01/g)
    const ingMap = new Map<string, IngRow>([["tomato", ing("tomato", 0.01, "kg")]]);
    const recipes: RecipeRow[] = [
      { id: "sauce", yield_portions: 2, yield_unit: "kg", recipe_lines: [{ ingredient_id: "tomato", sub_recipe_id: null, quantity: 1000, unit: "g" }] },
      // Dish uses 100 g of the 2 kg sauce batch → 100/2000 = 5% of €10 = €0.50
      { id: "dish", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: null, sub_recipe_id: "sauce", quantity: 100, unit: "g" }] },
    ];
    expect(calcRecipeCost("sauce", recipes, ingMap)).toBeCloseTo(10, 5);
    expect(calcRecipeCost("dish", recipes, ingMap)).toBeCloseTo(0.5, 5);
  });

  it("is cycle-safe", () => {
    const ingMap = new Map<string, IngRow>();
    const recipes: RecipeRow[] = [
      { id: "a", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: null, sub_recipe_id: "b", quantity: 1, unit: "portion" }] },
      { id: "b", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: null, sub_recipe_id: "a", quantity: 1, unit: "portion" }] },
    ];
    expect(() => calcRecipeCost("a", recipes, ingMap)).not.toThrow();
  });
});

describe("calcRecipeAllergens", () => {
  it("unions ingredient + sub-recipe allergens", () => {
    const ingMap = new Map<string, IngRow>([
      ["tahini", ing("tahini", 0.005, "kg", { allergens: ["Sésame"] })],
      ["flour", ing("flour", 0.001, "kg", { allergens: ["Gluten"] })],
    ]);
    const recipes: RecipeRow[] = [
      { id: "sauce", yield_portions: 1, yield_unit: "kg", recipe_lines: [{ ingredient_id: "tahini", sub_recipe_id: null, quantity: 100, unit: "g" }] },
      { id: "dish", yield_portions: 1, yield_unit: "portion", recipe_lines: [
        { ingredient_id: "flour", sub_recipe_id: null, quantity: 50, unit: "g" },
        { ingredient_id: null, sub_recipe_id: "sauce", quantity: 20, unit: "g" },
      ] },
    ];
    const all = Array.from(calcRecipeAllergens("dish", recipes, ingMap)).sort();
    expect(all).toEqual(["Gluten", "Sésame"]);
  });
});

describe("ingredientsPerYieldBase (stock deduction)", () => {
  it("deducts per portion, flattening sub-recipes", () => {
    // Sauce yields 2 kg from 1000 g tomato → per gram of sauce uses 0.5 g tomato
    // Dish (1 portion) uses 100 g sauce → 100 × 0.5 = 50 g tomato per portion
    const map = new Map<string, RecipeRow>([
      ["sauce", { id: "sauce", yield_portions: 2, yield_unit: "kg", recipe_lines: [{ ingredient_id: "tomato", sub_recipe_id: null, quantity: 1000, unit: "g" }] }],
      ["dish", { id: "dish", yield_portions: 1, yield_unit: "portion", recipe_lines: [{ ingredient_id: null, sub_recipe_id: "sauce", quantity: 100, unit: "g" }] }],
    ]);
    const per = ingredientsPerYieldBase("dish", map);
    expect(per.get("tomato")).toBeCloseTo(50, 5);
  });

  it("divides direct ingredients by the recipe yield", () => {
    // Recipe makes 4 portions from 800 g rice → 200 g per portion
    const map = new Map<string, RecipeRow>([
      ["r", { id: "r", yield_portions: 4, yield_unit: "portion", recipe_lines: [{ ingredient_id: "rice", sub_recipe_id: null, quantity: 800, unit: "g" }] }],
    ]);
    expect(ingredientsPerYieldBase("r", map).get("rice")).toBeCloseTo(200, 5);
  });

  it("Baklawa scenario: dish using 150 g of a 70.1 kg MEP deducts each raw ingredient at 0.214%", () => {
    // MEP "baklawa" yields 70.1 kg from: pâte 18 kg, pistache 12 kg, sucre 25 kg, samneh 15 kg, eau de rose 100 ml
    const map = new Map<string, RecipeRow>([
      ["baklawa_mep", { id: "baklawa_mep", yield_portions: 70.1, yield_unit: "kg", recipe_lines: [
        { ingredient_id: "pate", sub_recipe_id: null, quantity: 18, unit: "kg" },
        { ingredient_id: "pistache", sub_recipe_id: null, quantity: 12, unit: "kg" },
        { ingredient_id: "sucre", sub_recipe_id: null, quantity: 25, unit: "kg" },
        { ingredient_id: "samneh", sub_recipe_id: null, quantity: 15, unit: "kg" },
        { ingredient_id: "eaurose", sub_recipe_id: null, quantity: 100, unit: "ml" },
      ] }],
      // Menu dish uses 150 g of the MEP per portion
      ["dish", { id: "dish", yield_portions: 1, yield_unit: "portion", recipe_lines: [
        { ingredient_id: null, sub_recipe_id: "baklawa_mep", quantity: 150, unit: "g" },
      ] }],
    ]);
    const per = ingredientsPerYieldBase("dish", map);
    const ratio = 150 / 70100; // 0.214%
    expect(per.get("pate")).toBeCloseTo(18000 * ratio, 4);      // ≈ 38.52 g
    expect(per.get("pistache")).toBeCloseTo(12000 * ratio, 4);  // ≈ 25.68 g
    expect(per.get("sucre")).toBeCloseTo(25000 * ratio, 4);     // ≈ 53.50 g
    expect(per.get("eaurose")).toBeCloseTo(100 * ratio, 4);     // ≈ 0.21 ml
  });
});
