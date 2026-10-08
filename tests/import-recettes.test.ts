// =====================================================================
//  Import des lignes de fiches techniques.
//
//  Ce que ces tests protègent avant tout : l import REMPLACE les lignes
//  d une fiche. Si un jour quelqu un le transforme en ajout, reimporter
//  un fichier corrige doublerait chaque quantite — et le food cost
//  doublerait sans que personne ne comprenne pourquoi.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  analyseRecettes, analyseLigneRecette, detecteColonnes, uniteLigne, familleDe,
  type ContexteRecettes, type ComposantRef,
} from "@/lib/import-recettes";

const ing = (id: string, nom: string, unite: string): ComposantRef => ({ id, nom, unite, type: "ingredient" });
const mep = (id: string, nom: string, unite: string): ComposantRef => ({ id, nom, unite, type: "mep" });

const CTX: ContexteRecettes = {
  ingredients: new Map([
    ["pois chiche sac 25kg", ing("i-pois", "Pois chiche sac 25kg", "kg")],
    ["tahina tiba 18kg", ing("i-tahina", "Tahina Tiba 18kg", "kg")],
    ["ail", ing("i-ail", "Ail", "kg")],
    ["huile de tournesol maurel 25l", ing("i-huile", "Huile de tournesol Maurel 25L", "l")],
    ["pain pita", ing("i-pita", "Pain pita", "unit")],
  ]),
  recettes: new Map([
    ["houmous", { id: "r-houmous", nom: "Houmous", unite: "portion", type: "fiche" as const }],
    ["creme d ail", mep("r-ail", "Crème d'ail", "kg")],
    ["sand chawarma poulet", { id: "r-sand", nom: "Sand Chawarma poulet", unite: "portion", type: "fiche" as const }],
  ]),
  lignesExistantes: new Map([["r-houmous", 4]]),
};

const EN = ["Fiche", "Composant", "Quantité", "Unité"];
const tab = (...lignes: string[][]) => [EN, ...lignes];

describe("Lecture des colonnes et des unités", () => {
  it("reconnait les intitules quels que soient l ordre et la casse", () => {
    const c = detecteColonnes(["QUANTITE", "unité", "Fiche technique", "Ingrédient"]);
    expect(c).toEqual({ quantite: 0, unite: 1, fiche: 2, composant: 3 });
  });

  it("comprend les unites ecrites en toutes lettres", () => {
    expect(uniteLigne("grammes")).toEqual({ unite: "g", famille: "poids" });
    expect(uniteLigne("KG")).toEqual({ unite: "kg", famille: "poids" });
    expect(uniteLigne("cl")).toEqual({ unite: "cl", famille: "volume" });
    expect(uniteLigne("pièce")).toEqual({ unite: "unit", famille: "piece" });
    expect(uniteLigne("cuillère")).toBeNull();
  });

  it("rattache l unite de stock a sa famille", () => {
    expect(familleDe("kg")).toBe("poids");
    expect(familleDe("g")).toBe("poids");
    expect(familleDe("ml")).toBe("volume");
    expect(familleDe("unit")).toBe("piece");
  });
});

describe("Analyse d une ligne", () => {
  const col = { fiche: 0, composant: 1, quantite: 2, unite: 3 };
  const ligne = (c: string[]) => analyseLigneRecette({ ligne: 2, cellules: c }, col, CTX);

  it("accepte un ingredient avec une unite compatible", () => {
    const a = ligne(["Houmous", "Pois chiche sac 25kg", "250", "g"]);
    expect(a.erreurs).toEqual([]);
    expect(a.cible?.id).toBe("i-pois");
    expect(a.quantite).toBe(250);
    expect(a.unite).toBe("g");
  });

  it("accepte une mise en place comme composant", () => {
    const a = ligne(["Sand Chawarma poulet", "Crème d'ail", "30", "g"]);
    expect(a.erreurs).toEqual([]);
    expect(a.cible?.type).toBe("mep");
  });

  it("refuse une unite incompatible avec le composant", () => {
    const a = ligne(["Houmous", "Huile de tournesol Maurel 25L", "50", "g"]);
    expect(a.erreurs[0]).toMatch(/volume/);
  });

  it("refuse un composant inconnu plutot que de le creer", () => {
    const a = ligne(["Houmous", "Tomatte", "100", "g"]);
    expect(a.erreurs[0]).toMatch(/introuvable/);
    expect(a.cible).toBeNull();
  });

  it("refuse qu une fiche se contienne elle-meme", () => {
    const a = ligne(["Houmous", "Houmous", "1", "portion"]);
    expect(a.erreurs[0]).toMatch(/elle-m/);
    expect(a.cible).toBeNull();
  });

  it("refuse une quantite nulle ou negative", () => {
    expect(ligne(["Houmous", "Ail", "0", "g"]).erreurs[0]).toMatch(/impossible/);
    expect(ligne(["Houmous", "Ail", "-5", "g"]).erreurs[0]).toMatch(/impossible/);
    expect(ligne(["Houmous", "Ail", "", "g"]).erreurs[0]).toMatch(/manquante/);
  });

  it("lit les nombres a la francaise", () => {
    expect(ligne(["Houmous", "Ail", "1,5", "kg"]).quantite).toBe(1.5);
  });
});

describe("Analyse d un fichier complet", () => {
  it("regroupe les lignes par fiche et annonce ce qui sera remplace", () => {
    const a = analyseRecettes(tab(
      ["Houmous", "Pois chiche sac 25kg", "250", "g"],
      ["Houmous", "Tahina Tiba 18kg", "60", "g"],
      ["Houmous", "Ail", "5", "g"],
      ["Sand Chawarma poulet", "Pain pita", "1", "pièce"],
      ["Sand Chawarma poulet", "Crème d'ail", "30", "g"],
    ), CTX);

    expect(a.manquantes).toEqual([]);
    expect(a.resume).toMatchObject({ fiches: 2, fiches_creer: 0, lignes: 5, erreur: 0 });
    // Le houmous avait deja 4 lignes : elles seront ECRASEES, pas completees.
    expect(a.resume.remplacees).toBe(4);
    const houmous = a.fiches.find((f) => f.nom === "Houmous")!;
    expect(houmous.lignesRemplacees).toBe(4);
    expect(houmous.lignes).toHaveLength(3);
    expect(houmous.recetteId).toBe("r-houmous");
  });

  it("signale une fiche absente du catalogue sans bloquer", () => {
    const a = analyseRecettes(tab(["Moutabbal", "Ail", "10", "g"]), CTX);
    expect(a.resume.fiches_creer).toBe(1);
    const f = a.fiches[0];
    expect(f.recetteId).toBeNull();
    expect(f.erreurs).toBe(0);
  });

  it("deduit qu une fiche est une mise en place depuis la colonne Type", () => {
    const a = analyseRecettes([
      ["Fiche", "Type", "Composant", "Quantité", "Unité"],
      ["Marinade taouk", "MEP", "Ail", "20", "g"],
    ], CTX);
    expect(a.fiches[0].estMep).toBe(true);
  });

  it("le type en base prime sur la colonne Type", () => {
    const a = analyseRecettes([
      ["Fiche", "Type", "Composant", "Quantité", "Unité"],
      ["Crème d'ail", "fiche", "Ail", "20", "g"],
    ], CTX);
    expect(a.fiches[0].estMep).toBe(true);     // « Crème d'ail » est une MEP en base
  });

  it("compte les erreurs par fiche sans perdre les lignes valides", () => {
    const a = analyseRecettes(tab(
      ["Houmous", "Ail", "5", "g"],
      ["Houmous", "Inconnu", "5", "g"],
    ), CTX);
    const f = a.fiches[0];
    expect(f.lignes).toHaveLength(2);
    expect(f.erreurs).toBe(1);
    expect(a.resume.erreur).toBe(1);
  });

  it("refuse le fichier si une colonne obligatoire manque", () => {
    const a = analyseRecettes([["Fiche", "Composant"], ["Houmous", "Ail"]], CTX);
    expect(a.manquantes).toEqual(["quantite", "unite"]);
    expect(a.fiches).toHaveLength(0);
  });

  it("ignore les lignes entierement vides que produisent les tableurs", () => {
    const a = analyseRecettes(tab(["Houmous", "Ail", "5", "g"], ["", "", "", ""]), CTX);
    expect(a.resume.lignes).toBe(1);
  });

  it("prefere l ingredient quand un nom existe des deux cotes, et le dit", () => {
    const ctx: ContexteRecettes = {
      ingredients: new Map([["halloumi", ing("i-hal", "Halloumi", "kg")]]),
      recettes: new Map([["halloumi", mep("r-hal", "Halloumi", "kg")]]),
    };
    const a = analyseRecettes(tab(["Mezzé", "Halloumi", "80", "g"]), ctx);
    const l = a.fiches[0].lignes[0];
    expect(l.cible?.id).toBe("i-hal");
    expect(l.avertissements[0]).toMatch(/a la fois|à la fois/);
    expect(l.erreurs).toEqual([]);
  });
});
