// =====================================================================
//  Import de produits : ce qui arrive vraiment dans un fichier fournisseur.
//
//  Les mercuriales sont sales : en-têtes fantaisistes, prix avec le symbole
//  euro, virgules décimales, unités écrites en toutes lettres, lignes vides
//  à la fin, doublons. Le but n'est pas de tout accepter — c'est de ne
//  JAMAIS écrire quelque chose de faux en silence.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  normalise, detecteColonnes, nombreFr, uniteNormalisee,
  analyseLigne, analyseTableau, OBLIGATOIRES, parseCsv, detecteSeparateur,
  type Contexte,
} from "@/lib/import-produits";

const ctx = (over: Partial<Contexte> = {}): Contexte => ({
  existants: new Map(),
  fournisseurs: new Map(),
  ...over,
});

describe("Lecture des en-têtes", () => {
  it("reconnaît les intitulés courants d'une mercuriale", () => {
    const c = detecteColonnes(["Désignation", "Famille", "Fournisseur", "Unité", "Colisage", "Contenance", "Prix HT", "TVA"]);
    expect(c.nom).toBe(0);
    expect(c.categorie).toBe(1);
    expect(c.fournisseur).toBe(2);
    expect(c.unite).toBe(3);
    expect(c.colis_nombre).toBe(4);
    expect(c.colis_taille).toBe(5);
    expect(c.prix_ht).toBe(6);
    expect(c.tva).toBe(7);
  });

  it("se moque des accents, de la casse et des espaces", () => {
    const c = detecteColonnes(["  NOM  ", "unite", "TAILLE", "prix ht"]);
    expect(OBLIGATOIRES.every((champ) => c[champ] !== undefined)).toBe(true);
  });

  it("n'attribue jamais deux fois la même colonne", () => {
    const c = detecteColonnes(["Produit", "Prix HT", "Prix de vente"]);
    expect(c.prix_ht).toBe(1);
    expect(c.prix_vente).toBe(2);
  });

  it("dit ce qui manque au lieu de deviner", () => {
    const a = analyseTableau([["Nom", "Catégorie"]], ctx());
    expect(a.manquantes).toEqual(["unite", "colis_taille", "prix_ht"]);
    expect(a.lignes).toEqual([]);
  });
});

describe("Lecture des nombres", () => {
  it("comprend la virgule, l'euro et les milliers", () => {
    expect(nombreFr("12,50 €")).toBe(12.5);
    expect(nombreFr("1 234,56")).toBeCloseTo(1234.56, 6);
    expect(nombreFr("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(nombreFr("5.5")).toBe(5.5);
    expect(nombreFr(89.9)).toBe(89.9);
  });

  it("rend null sur une case vide ou du texte", () => {
    expect(nombreFr("")).toBeNull();
    expect(nombreFr(null)).toBeNull();
    expect(nombreFr("sur devis")).toBeNull();
  });
});

describe("Lecture des unités", () => {
  it("accepte ce qu'écrivent vraiment les fournisseurs", () => {
    for (const t of ["kg", "Kilo", "KILOS", "gramme"]) expect(uniteNormalisee(t)).toBe("kg");
    for (const t of ["L", "litre", "Litres", "cl"]) expect(uniteNormalisee(t)).toBe("l");
    for (const t of ["pièce", "PCE", "unité", "boîte", "sachet"]) expect(uniteNormalisee(t)).toBe("unit");
  });

  it("refuse ce qu'elle ne comprend pas au lieu d'inventer", () => {
    expect(uniteNormalisee("carton mystère")).toBeNull();
    expect(uniteNormalisee("")).toBeNull();
  });
});

const ENTETES = ["Nom", "Catégorie", "Fournisseur", "Unité", "Colisage", "Contenance", "Prix HT", "TVA", "Rendement", "Seuil", "Stock"];
const L = (...c: unknown[]) => c;

describe("Analyse d'une ligne", () => {
  const cols = detecteColonnes(ENTETES);
  const analyse = (cellules: unknown[], c = ctx()) =>
    analyseLigne({ ligne: 2, cellules }, cols, c, new Map());

  it("calcule le conditionnement et le coût unitaire", () => {
    const r = analyse(L("Tomate grappe", "Légumes", "Metro", "kg", 1, 5, "12,50 €", 5.5, 90, 10, 20));
    expect(r.statut).toBe("creer");
    expect(r.produit!.pack_quantity).toBe(5);          // 1 × 5 kg
    expect(r.produit!.cost_per_base_unit).toBeCloseTo(0.0025, 8);  // 2,50 €/kg
    expect(r.produit!.yield_pct).toBe(90);
    expect(r.produit!.reorder_threshold).toBe(10000);  // 10 kg en grammes
    expect(r.produit!.stock_qty).toBe(20000);
  });

  it("gère un colis de plusieurs unités", () => {
    const r = analyse(L("Coca 33 cl", "Boissons", "Metro", "pièce", 24, 1, "10,80", 20));
    expect(r.produit!.pack_quantity).toBe(24);
    expect(r.produit!.cost_per_base_unit).toBeCloseTo(0.45, 8);
  });

  it("met à jour un produit déjà présent au lieu d'en créer un second", () => {
    const c = ctx({ existants: new Map([["tomate grappe", "id-1"]]) });
    const r = analyse(L("TOMATE GRAPPE", "Légumes", "Metro", "kg", 1, 5, 12.5), c);
    expect(r.statut).toBe("mettre_a_jour");
    expect(r.existantId).toBe("id-1");
  });

  it("refuse une ligne sans nom", () => {
    const r = analyse(L("", "Légumes", "Metro", "kg", 1, 5, 12.5));
    expect(r.statut).toBe("erreur");
    expect(r.erreurs[0]).toContain("Nom");
  });

  it("refuse une unité qu'elle ne comprend pas — elle ne devine pas", () => {
    const r = analyse(L("Truc", "Autre", "", "carton", 1, 5, 12.5));
    expect(r.statut).toBe("erreur");
    expect(r.erreurs.some((e) => e.includes("Unité"))).toBe(true);
  });

  it("refuse un prix ou une contenance manquants", () => {
    expect(analyse(L("Truc", "", "", "kg", 1, 5, "")).statut).toBe("erreur");
    expect(analyse(L("Truc", "", "", "kg", 1, "", 12.5)).statut).toBe("erreur");
    expect(analyse(L("Truc", "", "", "kg", 1, 0, 12.5)).statut).toBe("erreur");
  });

  it("accepte un prix à zéro : un produit offert existe", () => {
    expect(analyse(L("Pain offert", "", "", "kg", 1, 1, 0)).statut).toBe("creer");
  });

  it("complète le nombre par colis manquant, et le dit", () => {
    const r = analyse(L("Huile", "Épicerie", "", "L", "", 5, 24));
    expect(r.statut).toBe("creer");
    expect(r.produit!.pack_units).toBe(1);
    expect(r.avertissements).toEqual([]);   // colonne vide : rien à signaler
  });

  it("signale un nombre par colis illisible plutôt que de l'ignorer", () => {
    const r = analyse(L("Huile", "Épicerie", "", "L", "environ 6", 5, 24));
    expect(r.produit!.pack_units).toBe(1);
    expect(r.avertissements.some((a) => a.includes("Nombre par colis"))).toBe(true);
  });

  it("comprend un rendement écrit en taux", () => {
    const r = analyse(L("Tomate", "Légumes", "", "kg", 1, 5, 12.5, 5.5, "0,9"));
    expect(r.produit!.yield_pct).toBe(90);
    expect(r.avertissements.some((a) => a.includes("Rendement"))).toBe(true);
  });

  it("refuse un rendement impossible", () => {
    expect(analyse(L("X", "", "", "kg", 1, 5, 12.5, 5.5, 150)).statut).toBe("erreur");
  });

  it("applique une TVA par défaut quand la colonne est vide", () => {
    const r = analyse(L("X", "", "", "kg", 1, 5, 12.5, ""), ctx({ tvaDefaut: 10 }));
    expect(r.produit!.vat_rate).toBe(10);
  });

  it("signale un taux de TVA inhabituel sans bloquer", () => {
    const r = analyse(L("X", "", "", "kg", 1, 5, 12.5, 7));
    expect(r.statut).toBe("creer");
    expect(r.avertissements.some((a) => a.includes("TVA"))).toBe(true);
  });

  it("prévient qu'un fournisseur inconnu sera créé", () => {
    const r = analyse(L("X", "", "Nouveau Grossiste", "kg", 1, 5, 12.5));
    expect(r.avertissements.some((a) => a.includes("Nouveau Grossiste"))).toBe(true);
  });

  it("ne prévient pas pour un fournisseur déjà connu", () => {
    const c = ctx({ fournisseurs: new Map([["metro", "f-1"]]) });
    const r = analyse(L("X", "", "Metro", "kg", 1, 5, 12.5), c);
    expect(r.avertissements).toEqual([]);
  });

  it("range dans « Autre » quand la catégorie est vide", () => {
    expect(analyse(L("X", "", "", "kg", 1, 5, 12.5)).produit!.category).toBe("Autre");
  });
});

describe("Analyse d'un fichier entier", () => {
  const fichier = [
    ENTETES,
    L("Tomate grappe", "Légumes", "Metro", "kg", 1, 5, "12,50 €", 5.5, 90, 10, 20),
    L("Huile olive", "Épicerie", "Metro", "L", 1, 5, "24,00 €", 5.5),
    L("", "", "", "", "", "", ""),                                  // ligne vide : ignorée
    L("Tomate grappe", "Légumes", "Metro", "kg", 1, 5, "13,00 €"),  // doublon
    L("Mystère", "Autre", "", "carton", 1, 5, "10,00 €"),           // unité inconnue
    L(null, null, null, null, null, null, null),                    // ligne vide : ignorée
  ];

  it("compte ce qui sera créé, mis à jour et refusé", () => {
    const a = analyseTableau(fichier, ctx({ existants: new Map([["huile olive", "id-h"]]) }));
    expect(a.resume.creer).toBe(1);          // Tomate
    expect(a.resume.mettre_a_jour).toBe(1);  // Huile
    expect(a.resume.erreur).toBe(2);         // doublon + unité inconnue
    expect(a.lignes).toHaveLength(4);        // les lignes vides ne comptent pas
  });

  it("donne le numéro de ligne du fichier pour chaque problème", () => {
    const a = analyseTableau(fichier, ctx());
    const doublon = a.lignes.find((l) => l.erreurs.some((e) => e.includes("apparaît déjà")))!;
    expect(doublon.ligne).toBe(5);
    expect(doublon.erreurs[0]).toContain("ligne 2");
  });

  it("un fichier sans aucune ligne de données ne casse rien", () => {
    const a = analyseTableau([ENTETES], ctx());
    expect(a.lignes).toEqual([]);
    expect(a.resume).toEqual({ creer: 0, mettre_a_jour: 0, erreur: 0, avertissements: 0 });
  });

  it("un fichier vide ne casse rien non plus", () => {
    expect(analyseTableau([], ctx()).manquantes).toEqual(OBLIGATOIRES);
  });
});

describe("Normalisation des noms", () => {
  it("rapproche ce qui doit l'être", () => {
    expect(normalise("  Épicerie  ")).toBe("epicerie");
    expect(normalise("Coca 33 cl")).toBe("coca 33 cl");
    expect(normalise("CÔTE de bœuf")).toBe("cote de boeuf");
    // « bœuf » et « boeuf » doivent tomber sur la même clé, sinon le même
    // produit entrerait deux fois selon la façon dont il est écrit.
    expect(normalise("Côte de boeuf")).toBe(normalise("Côte de bœuf"));
  });
});

describe("Lecture d'un CSV", () => {
  it("reconnaît le point-virgule d'Excel français", () => {
    expect(detecteSeparateur("Nom;Unité;Prix HT")).toBe(";");
    expect(detecteSeparateur("Nom,Unit,Price")).toBe(",");
    expect(detecteSeparateur("Nom\tUnité\tPrix")).toBe("\t");
  });

  it("ne compte pas un séparateur enfermé dans des guillemets", () => {
    expect(detecteSeparateur('"Tomate, grappe";kg;12,50')).toBe(";");
  });

  it("lit un fichier ordinaire", () => {
    const t = parseCsv("Nom;Unité;Prix HT\nTomate;kg;12,50\nHuile;L;24,00");
    expect(t).toHaveLength(3);
    expect(t[1]).toEqual(["Tomate", "kg", "12,50"]);
  });

  it("respecte les virgules et les retours à la ligne dans un champ", () => {
    const t = parseCsv('Nom;Note\n"Tomate, grappe";"ligne 1\nligne 2"');
    expect(t[1][0]).toBe("Tomate, grappe");
    expect(t[1][1]).toBe("ligne 1\nligne 2");
  });

  it("comprend un guillemet échappé", () => {
    expect(parseCsv('Nom\n"Huile ""extra vierge"""')[1][0]).toBe('Huile "extra vierge"');
  });

  it("avale le BOM d'Excel sans le coller au premier en-tête", () => {
    const t = parseCsv("﻿Nom;Unité\nTomate;kg");
    expect(t[0][0]).toBe("Nom");
    expect(detecteColonnes(t[0]).nom).toBe(0);
  });

  it("tolère les fins de ligne Windows", () => {
    expect(parseCsv("Nom;Prix\r\nTomate;12\r\n")).toHaveLength(2);
  });
});

describe("Référence interne dans le fichier", () => {
  const ENT = ["Nom", "Unité", "Contenance", "Prix HT", "Référence interne", "Référence"];
  const cols = detecteColonnes(ENT);

  it("ne confond pas la référence INTERNE et celle du fournisseur", () => {
    expect(cols.reference_interne).toBe(4);
    expect(cols.reference).toBe(5);
  });

  it("reprend le numéro fourni", () => {
    const r = analyseLigne({ ligne: 2, cellules: ["Tomate", "kg", 5, 12.5, 3001, "REF-9"] }, cols, ctx(), new Map());
    expect(r.produit!.internal_ref).toBe(3001);
    expect(r.produit!.supplier_reference).toBe("REF-9");
  });

  it("laisse le numéro à attribuer plus tard quand la colonne est vide", () => {
    const r = analyseLigne({ ligne: 2, cellules: ["Tomate", "kg", 5, 12.5, "", ""] }, cols, ctx(), new Map());
    expect(r.statut).toBe("creer");
    expect(r.produit!.internal_ref).toBeNull();
  });

  it("refuse un numéro déjà utilisé par un autre produit", () => {
    const c = ctx({ refsPrises: new Set([3001]) });
    const r = analyseLigne({ ligne: 2, cellules: ["Tomate", "kg", 5, 12.5, 3001, ""] }, cols, c, new Map());
    expect(r.statut).toBe("erreur");
    expect(r.erreurs[0]).toContain("3001");
  });

  it("accepte de réécrire le numéro d'un produit qu'on met à jour", () => {
    const c = ctx({ refsPrises: new Set([3001]), existants: new Map([["tomate", "id-1"]]) });
    const r = analyseLigne({ ligne: 2, cellules: ["Tomate", "kg", 5, 12.5, 3001, ""] }, cols, c, new Map());
    expect(r.statut).toBe("mettre_a_jour");
  });

  it("refuse un numéro qui n'est pas un entier", () => {
    const r = analyseLigne({ ligne: 2, cellules: ["Tomate", "kg", 5, 12.5, "3,5", ""] }, cols, ctx(), new Map());
    expect(r.statut).toBe("erreur");
  });

  it("refuse deux fois le même numéro dans le fichier", () => {
    const a = analyseTableau([
      ENT,
      ["Tomate", "kg", 5, 12.5, 3001, ""],
      ["Ail", "kg", 1, 8, 3001, ""],
    ], ctx());
    expect(a.resume.creer).toBe(1);
    expect(a.resume.erreur).toBe(1);
    expect(a.lignes[1].erreurs[0]).toContain("ligne 2");
  });
});
