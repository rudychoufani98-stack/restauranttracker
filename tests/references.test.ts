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
  normaliseRefCaisse, refCaisseEnDouble, familleDuNom, categorieGenerique, nomDeBloc,
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
    expect(familleDe("Surgelés")!.debut).toBe(7000);
    expect(familleDe("Fournitures")!.debut).toBe(12000);
  });

  it("donne à chaque famille d'alcool son PROPRE bloc", () => {
    // Avec un seul bloc « Boissons », la première catégorie servie l'aurait
    // pris et les autres seraient parties dans les blocs libres — donc
    // rangées au hasard. Or la cave se gère et s'inventorie à part.
    expect(familleDe("Softs")!.debut).toBe(8000);
    expect(familleDe("Bières")!.debut).toBe(9000);
    expect(familleDe("Vins")!.debut).toBe(10000);
    expect(familleDe("Spiritueux")!.debut).toBe(11000);
    expect(familleDe("Alcools")!.debut).toBe(11000);
    expect(familleDe("Champagne")!.debut).toBe(10000);
    expect(familleDe("Apéritifs")!.debut).toBe(11000);
  });

  it("ne confond pas une eau et un alcool", () => {
    expect(familleDe("Eaux")!.debut).toBe(8000);
    expect(familleDe("Softs")!.debut).toBe(8000);
  });

  it("tranche les noms ambigus par le mot qui porte le sens", () => {
    // « Jus de fruits » contient « fruits », « Fruits de mer » aussi — et
    // pourtant l'un est une boisson et l'autre de la marée.
    expect(familleDe("Jus de fruits")!.debut).toBe(8000);
    expect(familleDe("Fruits de mer")!.debut).toBe(2000);
    expect(familleDe("Fruits")!.debut).toBe(3000);
    expect(familleDe("Vins rouges")!.debut).toBe(10000);
    expect(familleDe("Herbes fraîches")!.debut).toBe(3000);
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
    expect(p.get("Bières")).toBe(9000);
  });

  it("fait cohabiter les quatre familles de boissons d'une vraie carte", () => {
    const p = suggerePlages(cat("Softs", "Bières", "Vins", "Spiritueux"));
    expect(Array.from(p.values()).sort((a, b) => a - b)).toEqual([8000, 9000, 10000, 11000]);
  });

  it("case les catégories inconnues après les familles connues", () => {
    const p = suggerePlages(cat("Viande", "Divers"));
    expect(p.get("Divers")).toBe(PREMIER_BLOC_LIBRE);
  });

  it("laisse les sous-familles PARTAGER le bloc de leur famille", () => {
    // Cas réel relevé sur la carte d'Amaly : « Vins rouges », « Vins blancs »
    // et « Vins rosés » sont trois catégories distinctes. Les envoyer dans
    // trois blocs éloignés (10000, 16000, 17000) faisait perdre au premier
    // chiffre tout son sens. Les numéros restent uniques de toute façon,
    // puisque l'attribution vérifie les numéros pris, pas les blocs.
    const p = suggerePlages(cat("Vins rouges", "Vins blancs", "Vins rosés"));
    expect(p.get("Vins rouges")).toBe(10000);
    expect(p.get("Vins blancs")).toBe(10000);
    expect(p.get("Vins rosés")).toBe(10000);
  });

  it("même chose pour deux façons de nommer les boissons", () => {
    const p = suggerePlages(cat("Boissons", "Boissons fraîches"));
    expect(p.get("Boissons")).toBe(8000);
    expect(p.get("Boissons fraîches")).toBe(8000);
  });

  it("des catégories qui partagent un bloc ne partagent PAS un numéro", () => {
    const r = attribueReferences(
      [
        { id: "a", name: "Bordeaux", category: "Vins rouges" },
        { id: "b", name: "Chablis", category: "Vins blancs" },
        { id: "c", name: "Tavel", category: "Vins rosés" },
      ],
      cat("Vins rouges", "Vins blancs", "Vins rosés"),
    );
    const refs = r.attributions.map((a) => a.ref);
    expect(new Set(refs).size).toBe(3);                    // tous différents
    expect(refs.every((n) => n >= 10000 && n < 11000)).toBe(true);  // tous dans la cave
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

describe("Le NOM du produit sauve un catalogue mal rangé", () => {
  // Les vrais produits vus sur l'écran d'Amaly, tous rangés dans « Autre ».
  const catalogue = [
    { id: "a", name: "Acide citrique", category: "Autre" },
    { id: "b", name: "Agneau de lait", category: "Autre" },
    { id: "c", name: "Ail", category: "Autre" },
    { id: "d", name: "Ailes de poulet halal", category: "Viande" },
    { id: "e", name: "Almaza 33 cl", category: "Bières" },
    { id: "f", name: "Tahina Tiba 18kg", category: "Épicerie" },
    { id: "g", name: "Coca Cola 33 cl", category: "Autre" },
  ];

  it("range chaque produit dans sa vraie famille malgré « Autre »", () => {
    const r = attribueReferences(catalogue, cat("Autre", "Viande", "Bières", "Épicerie"));
    const par = new Map(r.attributions.map((a) => [a.nom, a.ref]));

    expect(Math.floor(par.get("Agneau de lait")! / 1000)).toBe(1);    // viandes
    expect(Math.floor(par.get("Ailes de poulet halal")! / 1000)).toBe(1);
    expect(Math.floor(par.get("Ail")! / 1000)).toBe(3);               // légumes
    expect(Math.floor(par.get("Acide citrique")! / 1000)).toBe(5);    // épicerie
    expect(Math.floor(par.get("Tahina Tiba 18kg")! / 1000)).toBe(5);
    expect(Math.floor(par.get("Coca Cola 33 cl")! / 1000)).toBe(8);   // softs
    expect(Math.floor(par.get("Almaza 33 cl")! / 1000)).toBe(9);      // bières
    expect(r.refuses).toEqual([]);
  });

  it("aucun produit ne reste dans le bloc fourre-tout", () => {
    const r = attribueReferences(catalogue, cat("Autre", "Viande", "Bières", "Épicerie"));
    expect(r.attributions.every((a) => a.ref < PREMIER_BLOC_LIBRE)).toBe(true);
  });
});

describe("Reconnaissance par le nom", () => {
  it("le premier mot porte le sens", () => {
    // « Agneau de lait » est un agneau, pas du lait.
    expect(familleDuNom("Agneau de lait")).toBe(1000);
    expect(familleDuNom("Lait entier")).toBe(4000);
    // « Pommes de terre » : la pomme de terre reste au rayon légumes.
    expect(familleDuNom("Pommes de terre")).toBe(3000);
  });

  it("trouve le mot utile même en fin de nom", () => {
    expect(familleDuNom("Ailes de poulet halal")).toBe(1000);
  });

  it("une découpe ne décide qu'à défaut d'autre chose", () => {
    // « filet » vaut pour une viande comme pour un poisson : c'est le mot
    // qui l'accompagne qui tranche.
    expect(familleDuNom("Filet de saumon fumé")).toBe(2000);
    expect(familleDuNom("Filet de bœuf")).toBe(1000);
    expect(familleDuNom("Filet mignon")).toBe(1000);
    expect(familleDuNom("Côte de bœuf")).toBe(1000);
    expect(familleDuNom("Escalope de dinde")).toBe(1000);
  });

  it("comprend les produits d'une carte libanaise", () => {
    expect(familleDuNom("Tahina Tiba 18kg")).toBe(5000);
    expect(familleDuNom("Labneh")).toBe(4000);
    expect(familleDuNom("Pain pita")).toBe(6000);
    // L'arak titre 50° : c'est un distillat, il va avec les spiritueux.
    expect(familleDuNom("Arak")).toBe(11000);
  });

  it("reconnaît les boissons par leur marque", () => {
    expect(familleDuNom("Coca Cola 33 cl")).toBe(8000);
    expect(familleDuNom("Almaza 33 cl")).toBe(9000);
    expect(familleDuNom("Perrier 50 cl")).toBe(8000);
  });

  it("ne devine rien quand le nom ne dit rien", () => {
    expect(familleDuNom("Article 4521")).toBeNull();
    expect(familleDuNom("")).toBeNull();
  });

  it("la catégorie garde la main quand elle classe vraiment", () => {
    // Le restaurateur a rangé son « Filet de saumon » en Poissons : on le suit.
    const r = attribueReferences(
      [{ id: "x", name: "Filet de saumon fumé", category: "Poissons" }],
      cat("Poissons"),
    );
    expect(Math.floor(r.attributions[0].ref / 1000)).toBe(2);
  });
});

describe("Ce que le récapitulatif doit annoncer", () => {
  it("dit le bloc REELLEMENT retenu, pas celui de la catégorie", () => {
    // Le cas qui a menti en production : 75 produits rangés dans « Autre »,
    // annoncés dans un seul bloc fourre-tout alors qu'ils partaient chacun
    // dans la famille de leur nom.
    const r = attribueReferences(
      [
        { id: "a", name: "Agneau de lait", category: "Autre" },
        { id: "b", name: "Ail", category: "Autre" },
        { id: "c", name: "Acide citrique", category: "Autre" },
      ],
      cat("Autre"),
    );
    const blocs = r.attributions.map((a) => a.bloc).sort((x, y) => x - y);
    expect(blocs).toEqual([1000, 3000, 5000]);
    // Et le bloc annoncé colle au numéro attribué, sinon l'aperçu ment.
    for (const a of r.attributions) {
      expect(Math.floor(a.ref / 1000) * 1000).toBe(a.bloc);
    }
  });

  it("nomme les blocs connus, et rend null pour un bloc libre", () => {
    expect(nomDeBloc(1000)).toBe("Viandes");
    expect(nomDeBloc(10000)).toBe("Vins & champagnes");
    expect(nomDeBloc(PREMIER_BLOC_LIBRE)).toBeNull();
  });
});

describe("Cas réels relevés sur la carte d'Amaly", () => {
  // Ces noms ont tous été mal classés en production avant correction.
  // Ils sont ici pour qu'aucune évolution du vocabulaire ne les reperde.
  const attendu: [string, number][] = [
    // L'arak titre 50° : un distillat, pas un vin.
    ["Arak Brun 70 cl", 11000],
    ["Arak Nakad", 11000],
    // Des arômes, pas des boissons — le mot « eau » ne doit pas décider seul.
    ["Eau de rose", 5000],
    ["Eau de rose ou fleur d'oranger", 5000],
    ["Fleur d'oranger", 5000],
    // Mais une vraie eau reste une boisson.
    ["Eau minérale (50 cl)", 8000],
    ["Eau pétillante (50 cl)", 8000],
    // Du vinaigre, pas du vin.
    ["Vin de vinaigre", 5000],
    ["Vin rouge ou blanc", 10000],
    // Épices et aromates d'une carte libanaise.
    ["Cardamon", 5000],
    ["Cloux girofle", 5000],
    ["piment de Jamaïque", 5000],
    ["Piment fort", 5000],
    ["Colorant rouge", 5000],
    ["Cheveux d'ange", 5000],
    ["Feuille de vigne en pot", 5000],
    ["pignons", 5000],
    // Une plante moulue est une épice, fraîche c'est une herbe.
    ["Coriandre moulue", 5000],
    ["Menthe", 3000],
    // Orthographes et produits libanais.
    ["Fetta", 4000],
    ["Samneh", 4000],
    ["Dates", 3000],
    ["Fèves", 3000],
    // Et les évidences, qui doivent le rester.
    ["Agneau de lait", 1000],
    ["Almaza 33 cl", 9000],
    ["Château Kefraya 2021", 10000],
  ];

  it.each(attendu)("« %s » va dans le bloc %i", (nom, bloc) => {
    expect(familleDuNom(nom)).toBe(bloc);
  });

  it("aucun produit de la carte ne finit dans le bloc fourre-tout", () => {
    const noms = attendu.map(([n]) => n);
    const r = attribueReferences(
      noms.map((name, i) => ({ id: String(i), name, category: "Autre" })),
      cat("Autre"),
    );
    expect(r.attributions).toHaveLength(noms.length);
    expect(r.attributions.every((a) => a.bloc < PREMIER_BLOC_LIBRE)).toBe(true);
  });
});
