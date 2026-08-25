// =====================================================================
//  Numérotation interne des produits et référence de caisse des recettes.
//
//  La règle qui gouverne tout : une référence attribuée ne bouge PLUS.
//  Elle est imprimée sur des étiquettes de bac et recopiée sur des bons de
//  commande — la renuméroter reviendrait à mentir sur toutes les étiquettes
//  déjà collées.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  formatRef, familleDe, suggerePlages, prochaineRef, attribueReferences,
  normaliseRefCaisse, refCaisseEnDouble,
  TAILLE_BLOC, PREMIER_BLOC_LIBRE,
} from "@/lib/references";

const cat = (...noms: string[]) => noms.map((name) => ({ name }));

describe("Familles reconnues", () => {
  it("range les catégories courantes d'un restaurant", () => {
    expect(familleDe("Viande")!.debut).toBe(1000);
    expect(familleDe("Boucherie")!.debut).toBe(1000);
    expect(familleDe("Poissons")!.debut).toBe(2000);
    expect(familleDe("Légumes")!.debut).toBe(3000);
    expect(familleDe("Fromages")!.debut).toBe(4000);
    expect(familleDe("Épicerie")!.debut).toBe(5000);
    expect(familleDe("Bières")!.debut).toBe(7000);
    expect(familleDe("Fournitures")!.debut).toBe(9000);
  });

  it("se moque des accents et de la casse", () => {
    expect(familleDe("ÉPICERIE")!.debut).toBe(familleDe("epicerie")!.debut);
  });

  it("ne range pas au hasard ce qu'elle ne connaît pas", () => {
    expect(familleDe("Divers")).toBeNull();
    expect(familleDe("Autre")).toBeNull();
    expect(familleDe("")).toBeNull();
  });

  it("un nom exact l'emporte sur un fragment trompeur", () => {
    // « Pâtes » est de l'épicerie, pas de la pâtisserie.
    expect(familleDe("Pâtes")!.debut).toBe(5000);
  });
});

describe("Attribution des blocs aux catégories", () => {
  it("donne à chaque famille son bloc", () => {
    const p = suggerePlages(cat("Viande", "Épicerie", "Bières"));
    expect(p.get("Viande")).toBe(1000);
    expect(p.get("Épicerie")).toBe(5000);
    expect(p.get("Bières")).toBe(7000);
  });

  it("case les catégories inconnues après les familles connues", () => {
    const p = suggerePlages(cat("Viande", "Divers"));
    expect(p.get("Divers")).toBe(PREMIER_BLOC_LIBRE);
  });

  it("ne met jamais deux catégories dans le même bloc", () => {
    // « Viande » et « Volaille » relèvent toutes deux de la famille 1000.
    const p = suggerePlages(cat("Viande", "Volaille"));
    const blocs = Array.from(p.values());
    expect(new Set(blocs).size).toBe(blocs.length);
    expect(p.get("Viande")).toBe(1000);
    expect(p.get("Volaille")).toBe(PREMIER_BLOC_LIBRE);
  });

  it("respecte un bloc déjà choisi à la main", () => {
    const p = suggerePlages([{ name: "Viande", ref_start: 4200 }, { name: "Épicerie" }]);
    expect(p.get("Viande")).toBe(4200);
    expect(p.get("Épicerie")).toBe(5000);
  });

  it("range les inconnues par ordre alphabétique, pour être reproductible", () => {
    const p = suggerePlages(cat("Zèbre", "Abricotier"));
    expect(p.get("Abricotier")).toBe(PREMIER_BLOC_LIBRE);
    expect(p.get("Zèbre")).toBe(PREMIER_BLOC_LIBRE + TAILLE_BLOC);
  });
});

describe("Prochain numéro libre", () => {
  it("prend le premier disponible", () => {
    expect(prochaineRef(1000, new Set())).toBe(1000);
    expect(prochaineRef(1000, new Set([1000, 1001]))).toBe(1002);
  });

  it("saute les trous laissés par des suppressions", () => {
    expect(prochaineRef(1000, new Set([1000, 1002]))).toBe(1001);
  });

  it("dit non quand le bloc est plein plutôt que de déborder", () => {
    const plein = new Set(Array.from({ length: TAILLE_BLOC }, (_, i) => 1000 + i));
    expect(prochaineRef(1000, plein)).toBeNull();
  });
});

describe("Numérotation d'un catalogue", () => {
  const produits = [
    { id: "a", name: "Tomate grappe", category: "Légumes" },
    { id: "b", name: "Ail", category: "Légumes" },
    { id: "c", name: "Huile olive", category: "Épicerie" },
    { id: "d", name: "Côte de bœuf", category: "Viande" },
  ];

  it("numérote par famille, puis par ordre alphabétique", () => {
    const r = attribueReferences(produits, cat("Légumes", "Épicerie", "Viande"));
    const par = new Map(r.attributions.map((a) => [a.nom, a.ref]));
    expect(par.get("Huile olive")).toBe(5000);
    expect(par.get("Ail")).toBe(3000);
    expect(par.get("Tomate grappe")).toBe(3001);   // après Ail
    expect(par.get("Côte de bœuf")).toBe(1000);
    expect(r.refuses).toEqual([]);
  });

  it("ne touche JAMAIS à une référence déjà attribuée", () => {
    const avec = [{ ...produits[0], internal_ref: 3500 }, produits[1]];
    const r = attribueReferences(avec, cat("Légumes"));
    expect(r.attributions.map((a) => a.nom)).toEqual(["Ail"]);
    expect(r.attributions[0].ref).toBe(3000);
  });

  it("ne réattribue pas un numéro déjà pris, même hors de son bloc", () => {
    const avec = [{ ...produits[1], internal_ref: 3000 }, produits[0]];
    const r = attribueReferences(avec, cat("Légumes"));
    expect(r.attributions[0].ref).toBe(3001);
  });

  it("garde un produit numéroté même si sa catégorie a changé de bloc", () => {
    // Le produit était en épicerie (5xxx), il est passé en viande.
    const avec = [{ id: "x", name: "Lardons", category: "Viande", internal_ref: 5012 }];
    const r = attribueReferences(avec, cat("Viande", "Épicerie"));
    expect(r.attributions).toEqual([]);   // rien à faire, et surtout rien à casser
  });

  it("range dans « Autre » un produit sans catégorie, sans planter", () => {
    const r = attribueReferences([{ id: "z", name: "Truc", category: null }], cat("Autre"));
    expect(r.attributions).toHaveLength(1);
    expect(r.attributions[0].categorie).toBe("Autre");
  });

  it("refuse proprement quand la catégorie n'a aucun bloc", () => {
    const r = attribueReferences([{ id: "z", name: "Truc", category: "Inconnue" }], cat("Viande"));
    expect(r.attributions).toEqual([]);
    expect(r.refuses[0].raison).toContain("Inconnue");
  });

  it("refuse proprement quand le bloc est plein", () => {
    const pleins = Array.from({ length: TAILLE_BLOC }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, category: "Viande", internal_ref: 1000 + i,
    }));
    const r = attribueReferences([...pleins, { id: "trop", name: "Un de trop", category: "Viande" }], cat("Viande"));
    expect(r.attributions).toEqual([]);
    expect(r.refuses[0].raison).toContain("plein");
  });

  it("un catalogue vide ne casse rien", () => {
    expect(attribueReferences([], cat("Viande")).attributions).toEqual([]);
  });
});

describe("Affichage du numéro", () => {
  it("complète à quatre chiffres pour que le tri texte soit juste", () => {
    expect(formatRef(1000)).toBe("1000");
    expect(formatRef(42)).toBe("0042");
    expect(formatRef(10000)).toBe("10000");
  });

  it("ne fabrique pas un numéro quand il n'y en a pas", () => {
    expect(formatRef(null)).toBe("—");
    expect(formatRef(undefined)).toBe("—");
  });
});

describe("Référence de caisse des recettes", () => {
  it("met tout au même format pour éviter les doublons invisibles", () => {
    expect(normaliseRefCaisse("plt 12")).toBe("PLT12");
    expect(normaliseRefCaisse("  B-04 ")).toBe("B-04");
    expect(normaliseRefCaisse("")).toBe("");
  });

  it("repère deux plats sur la même touche — c'est une erreur de plan de caisse", () => {
    const d = refCaisseEnDouble([
      { id: "1", name: "Pâtes bolognaise", pos_ref: "PLT12" },
      { id: "2", name: "Pâtes carbonara", pos_ref: "plt 12" },
      { id: "3", name: "Salade", pos_ref: "ENT01" },
      { id: "4", name: "Dessert du jour", pos_ref: null },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].ref).toBe("PLT12");
    expect(d[0].recettes).toEqual(["Pâtes bolognaise", "Pâtes carbonara"]);
  });

  it("ne considère pas deux recettes sans référence comme un doublon", () => {
    expect(refCaisseEnDouble([
      { id: "1", name: "A", pos_ref: "" },
      { id: "2", name: "B", pos_ref: null },
    ])).toEqual([]);
  });
});
