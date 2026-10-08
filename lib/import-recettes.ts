// =====================================================================
//  Import des LIGNES de fiches techniques.
//
//  Une ligne du fichier = un composant d'une fiche. On ne touche ni au
//  prix de vente, ni au rendement, ni aux allergènes : seulement
//  « cette fiche contient telle quantité de tel ingrédient ».
//
//  Deux règles qui gouvernent tout le reste :
//
//   1. L'import REMPLACE les lignes d'une fiche, il ne les ajoute pas.
//      Sans cela, réimporter un fichier corrigé doublerait chaque
//      quantité — et personne ne s'en apercevrait avant de voir un food
//      cost doubler.
//
//   2. Un composant doit DÉJÀ exister. On ne crée jamais un ingrédient
//      au passage : c'est le rôle de l'import de produits, et inventer
//      « Tomatte » parce que le fichier l'écrit ainsi créerait le
//      doublon qu'on passe notre temps à éviter.
// =====================================================================
import { normalise, nombreFr, parseCsv, detecteSeparateur } from "./import-produits";

export { normalise, nombreFr, parseCsv, detecteSeparateur };

export type Champ = "fiche" | "type" | "composant" | "quantite" | "unite";

export const ENTETES: Record<Champ, string[]> = {
  fiche:     ["fiche", "fiche technique", "recette", "plat", "nom de la fiche", "nom"],
  type:      ["type", "nature"],
  composant: ["composant", "ingredient", "ingredients", "produit", "mise en place", "mep", "element"],
  quantite:  ["quantite", "qte", "qty", "quantite nette"],
  unite:     ["unite", "u", "unite de mesure"],
};

export const OBLIGATOIRES: Champ[] = ["fiche", "composant", "quantite", "unite"];

export const CHAMP_LABEL: Record<Champ, string> = {
  fiche: "Fiche", type: "Type", composant: "Composant", quantite: "Quantité", unite: "Unité",
};

/** Associe chaque colonne du fichier à un champ connu. */
export function detecteColonnes(entetes: string[]): Partial<Record<Champ, number>> {
  const trouve: Partial<Record<Champ, number>> = {};
  const normalises = entetes.map((e) => normalise(e));
  for (const [champ, alias] of Object.entries(ENTETES) as [Champ, string[]][]) {
    const i = normalises.findIndex((e) => e && alias.includes(e));
    if (i >= 0) trouve[champ] = i;
  }
  return trouve;
}

/** Unité canonique d'une ligne de recette, et sa famille de mesure. */
export function uniteLigne(valeur: unknown): { unite: string; famille: "poids" | "volume" | "piece" } | null {
  const t = normalise(String(valeur ?? ""));
  if (!t) return null;
  if (["g", "gr", "gramme", "grammes"].includes(t)) return { unite: "g", famille: "poids" };
  if (["kg", "kilo", "kilos", "kilogramme", "kilogrammes"].includes(t)) return { unite: "kg", famille: "poids" };
  if (["ml", "millilitre", "millilitres"].includes(t)) return { unite: "ml", famille: "volume" };
  if (["cl", "centilitre", "centilitres"].includes(t)) return { unite: "cl", famille: "volume" };
  if (["l", "litre", "litres", "lt"].includes(t)) return { unite: "l", famille: "volume" };
  if (["u", "unite", "unites", "piece", "pieces", "pce", "pc", "portion", "portions"].includes(t)) {
    return { unite: "unit", famille: "piece" };
  }
  return null;
}

/** Famille de mesure d'un composant, d'après son unité de stock. */
export function familleDe(unite: string | null | undefined): "poids" | "volume" | "piece" {
  const u = String(unite ?? "").toLowerCase();
  if (u === "kg" || u === "g") return "poids";
  if (u === "l" || u === "ml") return "volume";
  return "piece";
}

const NOM_FAMILLE: Record<"poids" | "volume" | "piece", string> = {
  poids: "un poids (g, kg)", volume: "un volume (ml, cl, L)", piece: "des pièces",
};

export type ComposantRef = { id: string; nom: string; unite: string; type: "ingredient" | "mep" | "fiche" };

export type ContexteRecettes = {
  /** Ingrédients en base : nom normalisé → référence. */
  ingredients: Map<string, ComposantRef>;
  /** Recettes et MEP en base : nom normalisé → référence. */
  recettes: Map<string, ComposantRef>;
  /** Nombre de lignes déjà enregistrées, par recette — pour annoncer ce qui sera remplacé. */
  lignesExistantes?: Map<string, number>;
};

export type LigneRecetteAnalysee = {
  ligne: number;
  fiche: string;
  composant: string;
  quantite: number | null;
  unite: string | null;
  cible: ComposantRef | null;
  erreurs: string[];
  avertissements: string[];
};

export type FicheAnalysee = {
  nom: string;
  recetteId: string | null;      // null = la fiche n'existe pas encore
  estMep: boolean;
  lignes: LigneRecetteAnalysee[];
  lignesRemplacees: number;
  erreurs: number;
};

export type AnalyseRecettes = {
  colonnes: Partial<Record<Champ, number>>;
  manquantes: Champ[];
  fiches: FicheAnalysee[];
  resume: { fiches: number; fiches_creer: number; lignes: number; erreur: number; remplacees: number };
};

/** Analyse une ligne isolée du fichier. */
export function analyseLigneRecette(
  source: { ligne: number; cellules: unknown[] },
  colonnes: Partial<Record<Champ, number>>,
  ctx: ContexteRecettes,
): LigneRecetteAnalysee {
  const lire = (c: Champ) => (colonnes[c] === undefined ? "" : source.cellules[colonnes[c]!]);
  const texte = (c: Champ) => String(lire(c) ?? "").trim();

  const erreurs: string[] = [];
  const avertissements: string[] = [];

  const fiche = texte("fiche");
  const composant = texte("composant");
  if (!fiche) erreurs.push("Nom de la fiche manquant.");
  if (!composant) erreurs.push("Composant manquant.");

  const quantite = nombreFr(lire("quantite"));
  if (quantite === null) erreurs.push("Quantité manquante ou illisible.");
  else if (quantite <= 0) erreurs.push(`Quantité de ${quantite} impossible — attendu un nombre positif.`);

  const u = uniteLigne(lire("unite"));
  if (!u) erreurs.push(`Unité « ${texte("unite")} » non reconnue — attendu g, kg, ml, cl, L ou pièce.`);

  // Le composant : un ingrédient d'abord, une MEP ou une fiche ensuite.
  let cible: ComposantRef | null = null;
  if (composant) {
    const cle = normalise(composant);
    const ing = ctx.ingredients.get(cle) ?? null;
    const rec = ctx.recettes.get(cle) ?? null;
    if (ing && rec) {
      cible = ing;
      avertissements.push(
        `« ${composant} » existe à la fois comme ingrédient et comme ${rec.type === "mep" ? "mise en place" : "fiche"} — l'ingrédient a été retenu.`,
      );
    } else cible = ing ?? rec;

    if (!cible) {
      erreurs.push(`« ${composant} » est introuvable — crée-le d'abord dans tes ingrédients ou tes mises en place.`);
    } else if (normalise(fiche) === cle) {
      erreurs.push("Une fiche ne peut pas se contenir elle-même.");
      cible = null;
    } else if (u) {
      const attendue = familleDe(cible.unite);
      if (attendue !== u.famille) {
        erreurs.push(
          `« ${cible.nom} » se mesure en ${NOM_FAMILLE[attendue]} : l'unité « ${texte("unite")} » ne convient pas.`,
        );
      }
    }
  }

  return {
    ligne: source.ligne, fiche, composant,
    quantite, unite: u?.unite ?? null, cible, erreurs, avertissements,
  };
}

/** Analyse le tableau entier : première ligne = en-têtes. */
export function analyseRecettes(tableau: unknown[][], ctx: ContexteRecettes): AnalyseRecettes {
  const entetes = (tableau[0] ?? []).map((c) => String(c ?? ""));
  const colonnes = detecteColonnes(entetes);
  const manquantes = OBLIGATOIRES.filter((c) => colonnes[c] === undefined);

  const parFiche = new Map<string, FicheAnalysee>();
  if (manquantes.length === 0) {
    for (let i = 1; i < tableau.length; i++) {
      const cellules = tableau[i] ?? [];
      if (cellules.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

      const a = analyseLigneRecette({ ligne: i + 1, cellules }, colonnes, ctx);
      const cle = normalise(a.fiche);
      if (!cle) {
        // Sans nom de fiche on ne peut rattacher la ligne à rien : on la
        // garde quand même visible, sous une entrée dédiée.
        const orphelines = parFiche.get("") ?? { nom: "(sans fiche)", recetteId: null, estMep: false, lignes: [], lignesRemplacees: 0, erreurs: 0 };
        orphelines.lignes.push(a); orphelines.erreurs += a.erreurs.length ? 1 : 0;
        parFiche.set("", orphelines);
        continue;
      }

      let f = parFiche.get(cle);
      if (!f) {
        const existante = ctx.recettes.get(cle) ?? null;
        const typeDit = normalise(String(colonnes.type !== undefined ? cellules[colonnes.type!] ?? "" : ""));
        const estMep = existante ? existante.type === "mep" : ["mep", "mise en place", "prep", "preparation"].includes(typeDit);
        f = {
          nom: existante?.nom ?? a.fiche,
          recetteId: existante?.id ?? null,
          estMep,
          lignes: [],
          lignesRemplacees: existante ? ctx.lignesExistantes?.get(existante.id) ?? 0 : 0,
          erreurs: 0,
        };
        parFiche.set(cle, f);
      }
      f.lignes.push(a);
      if (a.erreurs.length) f.erreurs++;
    }
  }

  const fiches = Array.from(parFiche.values()).sort((a, b) => a.nom.localeCompare(b.nom));
  const lignes = fiches.reduce((s, f) => s + f.lignes.length, 0);
  const erreur = fiches.reduce((s, f) => s + f.erreurs, 0);

  return {
    colonnes, manquantes, fiches,
    resume: {
      fiches: fiches.length,
      fiches_creer: fiches.filter((f) => !f.recetteId && f.nom !== "(sans fiche)").length,
      lignes,
      erreur,
      remplacees: fiches.reduce((s, f) => s + f.lignesRemplacees, 0),
    },
  };
}
