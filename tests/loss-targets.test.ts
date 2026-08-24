// =====================================================================
//  Pertes : produits, mises en place et fiches techniques.
//
//  Ce qui est vérifié ici, c'est surtout que jeter 2 kg de sauce sort du
//  stock EXACTEMENT les mêmes ingrédients que si on avait vendu les plats
//  correspondants — rendement matière compris. Sinon la perte serait une
//  fuite dans l'identité comptable.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  construireCibles, chercheCibles, grouperParType, decomposePerte,
  ingredientsParUnite, coutParUnite, grouperPertes, chercheDansHistorique,
  TYPE_LABEL, TYPE_LABEL_UN, uniteAccordee,
  type Cible, type IngredientCible, type RecetteCible,
} from "@/lib/loss-targets";
import type { IngRow, RecipeRow } from "@/lib/costing";

// Tomate : 10 % de perte au parage, 2,00 €/kg. Huile : 4,80 €/L.
const ING: IngredientCible[] = [
  { id: "tom", name: "Tomate grappe", category: "Légumes", unit: "kg", yield_pct: 90, cmup: 0.002, cost_per_base_unit: 0.002, stock_qty: 20000 },
  { id: "hui", name: "Huile olive", category: "Épicerie", unit: "l", yield_pct: 100, cmup: 0.0048, cost_per_base_unit: 0.0048, stock_qty: 15000 },
  { id: "coca", name: "Coca 33 cl", category: "Boissons", unit: "unit", yield_pct: 100, cmup: 0.45, cost_per_base_unit: 0.45, stock_qty: 48 },
];

// MEP : 2 kg de sauce = 2 kg de tomate (net) + 0,1 L d'huile
// Plat : 1 portion = 400 g de sauce + 0,02 L d'huile
const REC: RecetteCible[] = [
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

const ingMap = new Map<string, IngRow>(ING.map((i) => [i.id, i as IngRow]));
const recipeMap = new Map<string, RecipeRow>(REC.map((r) => [r.id, r as RecipeRow]));
const cibles = construireCibles(ING, REC);
const trouve = (nom: string) => cibles.find((c) => c.nom === nom)!;

describe("Ce qu'on peut déclarer en perte", () => {
  it("propose les produits, les MEP et les fiches techniques", () => {
    expect(cibles).toHaveLength(5);
    expect(trouve("Tomate grappe").type).toBe("produit");
    expect(trouve("Sauce tomate").type).toBe("mep");
    expect(trouve("Pâtes bolognaise").type).toBe("recette");
  });

  it("saisit chaque chose dans son unité naturelle", () => {
    expect(trouve("Tomate grappe").unite).toBe("kg");
    expect(trouve("Coca 33 cl").unite).toBe("pce");
    expect(trouve("Sauce tomate").unite).toBe("kg");        // rendement en kg
    expect(trouve("Pâtes bolognaise").unite).toBe("portion");
  });

  it("affiche le coût dans l'unité de saisie, pas au gramme", () => {
    expect(trouve("Tomate grappe").coutUnitaire).toBeCloseTo(2, 6);   // €/kg
    expect(trouve("Huile olive").coutUnitaire).toBeCloseTo(4.8, 6);   // €/L
    expect(trouve("Coca 33 cl").coutUnitaire).toBeCloseTo(0.45, 6);   // €/pièce
  });

  it("chiffre une MEP au coût de ses ingrédients, rendement compris", () => {
    // 1 kg de sauce = 1 000 g nets de tomate ÷ 0,9 = 1 111,1 g bruts × 0,002
    //                 + 50 ml d'huile × 0,0048 = 2,2222 + 0,24
    expect(trouve("Sauce tomate").coutUnitaire).toBeCloseTo(2.46222, 4);
  });

  it("chiffre un plat en cascade à travers sa MEP", () => {
    // 400 g de sauce = 0,4 kg × 2,46222 = 0,984889 + 20 ml d'huile = 0,096
    expect(trouve("Pâtes bolognaise").coutUnitaire).toBeCloseTo(1.080889, 5);
  });

  it("ne prête un stock qu'aux produits", () => {
    expect(trouve("Tomate grappe").stock).toBeCloseTo(20, 6);   // 20 kg
    expect(trouve("Coca 33 cl").stock).toBe(48);
    expect(trouve("Sauce tomate").stock).toBeNull();
  });
});

describe("Recherche", () => {
  it("remonte d'abord ce qui COMMENCE par la recherche", () => {
    const r = chercheCibles([
      ...cibles,
      { id: "x", type: "produit", nom: "Concassé de tomate", unite: "kg", coutUnitaire: 1, stock: 0, categorie: "Épicerie" },
    ], "tom");
    expect(r[0].nom).toBe("Tomate grappe");
    expect(r.map((c) => c.nom)).toContain("Concassé de tomate");
  });

  it("cherche aussi dans les trois familles à la fois", () => {
    const r = chercheCibles(cibles, "sauce");
    expect(r.map((c) => c.nom)).toEqual(["Sauce tomate"]);
  });

  it("trouve par catégorie", () => {
    expect(chercheCibles(cibles, "boissons").map((c) => c.nom)).toEqual(["Coca 33 cl"]);
  });

  it("sans recherche, rend tout par ordre alphabétique", () => {
    expect(chercheCibles(cibles, "  ")).toHaveLength(5);
    expect(chercheCibles(cibles, "")[0].nom).toBe("Coca 33 cl");
  });

  it("ne renvoie rien plutôt que n'importe quoi", () => {
    expect(chercheCibles(cibles, "zzz")).toEqual([]);
  });
});

describe("Groupes d'affichage", () => {
  it("range dans l'ordre produits → MEP → fiches techniques", () => {
    const g = grouperParType(cibles);
    expect(g.map((x) => x.type)).toEqual(["produit", "mep", "recette"]);
    expect(g.map((x) => TYPE_LABEL[x.type])).toEqual(["Produits", "Mises en place", "Fiches techniques"]);
  });

  it("n'affiche pas un groupe vide", () => {
    const g = grouperParType(chercheCibles(cibles, "sauce"));
    expect(g).toHaveLength(1);
    expect(g[0].type).toBe("mep");
  });
});

describe("Ce qui sort réellement du stock", () => {
  it("un produit sort tel quel, en unité de base", () => {
    const d = decomposePerte(trouve("Tomate grappe"), 3, recipeMap, ingMap);
    expect(d.lignes).toEqual([{ ingredient_id: "tom", baseQty: 3000, unitCost: 0.002 }]);
    expect(d.cout).toBeCloseTo(6, 6);
  });

  it("une pièce ne subit aucune conversion", () => {
    const d = decomposePerte(trouve("Coca 33 cl"), 4, recipeMap, ingMap);
    expect(d.lignes[0].baseQty).toBe(4);
    expect(d.cout).toBeCloseTo(1.8, 6);
  });

  it("2 kg de sauce jetés sortent la tomate BRUTE (rendement appliqué)", () => {
    const d = decomposePerte(trouve("Sauce tomate"), 2, recipeMap, ingMap);
    const parIng = new Map(d.lignes.map((l) => [l.ingredient_id, l.baseQty]));
    // 2 kg de sauce = 2 000 g nets de tomate ÷ 0,9 = 2 222,22 g bruts
    expect(parIng.get("tom")).toBeCloseTo(2222.2222, 3);
    expect(parIng.get("hui")).toBeCloseTo(100, 6);
    expect(d.cout).toBeCloseTo(4.92444, 4);
  });

  it("3 plats jetés déstockent à travers la MEP", () => {
    const d = decomposePerte(trouve("Pâtes bolognaise"), 3, recipeMap, ingMap);
    const parIng = new Map(d.lignes.map((l) => [l.ingredient_id, l.baseQty]));
    // 3 portions × 400 g de sauce = 1,2 kg → 1 200 g nets ÷ 0,9 = 1 333,3 g
    expect(parIng.get("tom")).toBeCloseTo(1333.3333, 3);
    // huile : 3 × (0,4 × 50 ml de la sauce) + 3 × 20 ml = 60 + 60
    expect(parIng.get("hui")).toBeCloseTo(120, 6);
    expect(d.cout).toBeCloseTo(3.242667, 5);
  });

  it("le coût annoncé est EXACTEMENT la somme des mouvements écrits", () => {
    for (const nom of ["Tomate grappe", "Sauce tomate", "Pâtes bolognaise"]) {
      const d = decomposePerte(trouve(nom), 2.5, recipeMap, ingMap);
      const somme = d.lignes.reduce((s, l) => s + l.baseQty * l.unitCost, 0);
      expect(d.cout).toBeCloseTo(somme, 10);
    }
  });

  it("une quantité absurde ne produit aucun mouvement", () => {
    for (const q of [0, -3, NaN]) {
      expect(decomposePerte(trouve("Sauce tomate"), q, recipeMap, ingMap).lignes).toEqual([]);
    }
  });

  it("ignore un ingrédient dont la fiche a disparu plutôt que de fausser le stock", () => {
    const orphelin = new Map<string, RecipeRow>([["x", {
      id: "x", yield_portions: 1, yield_unit: "kg",
      recipe_lines: [{ ingredient_id: "disparu", sub_recipe_id: null, quantity: 1, unit: "kg" }],
    }]]);
    const d = decomposePerte(
      { id: "x", type: "mep", nom: "X", unite: "kg", coutUnitaire: 0, stock: null, categorie: "" },
      1, orphelin, ingMap,
    );
    expect(d.lignes).toEqual([]);
    expect(d.cout).toBe(0);
  });
});

describe("Historique : une perte de MEP reste UNE ligne", () => {
  const nomIng = (id: string) => ING.find((i) => i.id === id)?.name;
  const fmt = (base: number, id: string) => {
    const u = ING.find((i) => i.id === id)?.unit ?? "unit";
    return u === "unit" ? `${base} pce` : `${base / 1000} ${u === "l" ? "L" : "kg"}`;
  };
  const rec = (id: string) => {
    const r = REC.find((x) => x.id === id);
    return r ? { nom: r.name, unite: r.yield_unit, mep: !!r.is_prep } : undefined;
  };

  const MOUVEMENTS = [
    // Perte de MEP : deux mouvements, un identifiant de groupe commun
    { id: "m1", ingredient_id: "tom", qty: 2222.2222, unit_cost: 0.002, loss_reason: "DLC dépassée", notes: "fin de service", created_at: "2026-08-24T20:00:00Z", reference_type: "loss", reference_id: "g1", recipe_id: "sauce", recipe_qty: 2 },
    { id: "m2", ingredient_id: "hui", qty: 100, unit_cost: 0.0048, loss_reason: "DLC dépassée", notes: "fin de service", created_at: "2026-08-24T20:00:00Z", reference_type: "loss", reference_id: "g1", recipe_id: "sauce", recipe_qty: 2 },
    // Perte simple d'un produit
    { id: "m3", ingredient_id: "tom", qty: 1000, unit_cost: 0.002, loss_reason: "Casse", notes: null, created_at: "2026-08-23T11:00:00Z", reference_type: "loss", reference_id: null },
    // Écart d'inventaire : groupé par session, non annulable ici
    { id: "m4", ingredient_id: "coca", qty: 2, unit_cost: 0.45, loss_reason: "Écart inventaire", notes: null, created_at: "2026-08-22T23:00:00Z", reference_type: "inventory", reference_id: "s1" },
  ];

  const groupes = grouperPertes(MOUVEMENTS, nomIng, fmt, rec);

  it("réunit les deux mouvements de la MEP sous son vrai nom", () => {
    const g = groupes.find((x) => x.nom === "Sauce tomate")!;
    expect(g.type).toBe("mep");
    expect(g.mouvements).toHaveLength(2);
    expect(g.quantite).toBe("2 kg");                 // ce qui a été jeté, pas des grammes
    expect(g.cout).toBeCloseTo(4.92444, 4);
  });

  it("laisse une perte simple telle quelle", () => {
    const g = groupes.find((x) => x.cle === "m:m3")!;
    expect(g.type).toBe("produit");
    expect(g.nom).toBe("Tomate grappe");
    expect(g.quantite).toBe("1 kg");
    expect(g.cout).toBeCloseTo(2, 6);
  });

  it("signale l'écart d'inventaire comme non annulable ici", () => {
    expect(groupes.find((x) => x.cause === "Écart inventaire")!.inventaire).toBe(true);
  });

  it("classe du plus récent au plus ancien", () => {
    expect(groupes.map((g) => g.date.slice(0, 10)))
      .toEqual(["2026-08-24", "2026-08-23", "2026-08-22"]);
  });

  it("ne mélange jamais deux pertes distinctes", () => {
    expect(groupes).toHaveLength(3);
  });

  it("cherche dans le nom, la cause et la note", () => {
    expect(chercheDansHistorique(groupes, "sauce")).toHaveLength(1);
    expect(chercheDansHistorique(groupes, "casse")).toHaveLength(1);
    expect(chercheDansHistorique(groupes, "fin de service")).toHaveLength(1);
    expect(chercheDansHistorique(groupes, "")).toHaveLength(3);
    expect(chercheDansHistorique(groupes, "zzz")).toHaveLength(0);
  });
});

describe("Langue : ce que lit le chef", () => {
  it("accorde les unités écrites en toutes lettres", () => {
    expect(uniteAccordee(3, "portion")).toBe("portions");
    expect(uniteAccordee(1, "portion")).toBe("portion");
    expect(uniteAccordee(3, "tranche")).toBe("tranches");
  });

  it("laisse les symboles tranquilles", () => {
    for (const u of ["kg", "L", "pce", "g"]) expect(uniteAccordee(5, u)).toBe(u);
  });

  it("nomme un élément au singulier une fois choisi", () => {
    expect(TYPE_LABEL_UN.produit).toBe("Produit");
    expect(TYPE_LABEL_UN.mep).toBe("Mise en place");
    expect(TYPE_LABEL_UN.recette).toBe("Fiche technique");
  });

  it("l'historique accorde la quantité d'une perte de plats", () => {
    const g = grouperPertes(
      [{ id: "a", ingredient_id: "hui", qty: 120, unit_cost: 0.0048, loss_reason: null, notes: null, created_at: "2026-08-24T20:00:00Z", reference_type: "loss", reference_id: "g", recipe_id: "pates", recipe_qty: 3 }],
      () => "Huile olive",
      () => "0,12 L",
      () => ({ nom: "Pâtes bolognaise", unite: "portion", mep: false }),
    );
    expect(g[0].quantite).toBe("3 portions");
  });
});
