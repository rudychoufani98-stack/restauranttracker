// =====================================================================
//  Import de produits depuis un tableau Excel / CSV.
//
//  C'est ce qui rend un client installable en une heure au lieu de deux
//  jours : le fournisseur envoie sa mercuriale, on la remet en forme, et
//  la plateforme l'avale d'un coup.
//
//  Règles de conduite du fichier :
//   • on ne devine JAMAIS en silence — chaque ligne douteuse est signalée
//   • un produit déjà présent est MIS À JOUR, jamais dupliqué
//   • rien n'est écrit tant que l'utilisateur n'a pas vu le récapitulatif
//
//  Tout est en fonctions pures : la route d'import ne fait que les appeler,
//  et tests/import-produits.test.ts les vérifie sans base de données.
// =====================================================================
import { calcCostPerBase, packTotal, qtyFromDisplay } from "./ingredient-helpers";

export type Statut = "creer" | "mettre_a_jour" | "erreur";

export type Champ =
  | "nom" | "categorie" | "fournisseur" | "reference" | "unite"
  | "colis_nombre" | "colis_taille" | "prix_ht" | "tva"
  | "rendement" | "seuil" | "stock" | "prix_vente";

/** En-têtes acceptés pour chaque champ. La comparaison ignore accents et casse. */
export const ENTETES: Record<Champ, string[]> = {
  nom: ["nom", "produit", "designation", "libelle", "article", "ingredient"],
  categorie: ["categorie", "famille", "rayon"],
  fournisseur: ["fournisseur", "supplier"],
  reference: ["reference", "ref", "code", "code article", "reference fournisseur"],
  unite: ["unite", "unite de mesure", "mesure"],
  colis_nombre: ["nombre par colis", "nb par colis", "unites par colis", "colisage", "quantite par colis"],
  colis_taille: ["taille unitaire", "contenance", "poids unitaire", "format", "taille"],
  prix_ht: ["prix ht", "prix", "prix achat", "prix du colis", "tarif", "prix unitaire ht"],
  tva: ["tva", "taux tva", "tva %"],
  rendement: ["rendement", "rendement %", "taux de rendement"],
  seuil: ["seuil", "seuil de reappro", "stock mini", "stock minimum", "alerte"],
  stock: ["stock", "stock initial", "quantite en stock"],
  prix_vente: ["prix de vente", "prix vente", "pv"],
};

/** Colonnes sans lesquelles on ne peut rien faire. */
export const OBLIGATOIRES: Champ[] = ["nom", "unite", "colis_taille", "prix_ht"];

/** « Épicerie » et « epicerie » sont le même mot. */
export function normalise(texte: string): string {
  return String(texte ?? "")
    // Les ligatures ne se decomposent pas en NFD : « boeuf » et « bœuf »
    // resteraient deux produits differents dans une carte de restaurant.
    .replace(/œ/g, "oe").replace(/Œ/g, "OE")
    .replace(/æ/g, "ae").replace(/Æ/g, "AE")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

/** Associe chaque colonne du fichier à un champ connu. */
export function detecteColonnes(entetes: string[]): Partial<Record<Champ, number>> {
  const trouve: Partial<Record<Champ, number>> = {};
  const normalises = entetes.map(normalise);

  for (const [champ, alias] of Object.entries(ENTETES) as [Champ, string[]][]) {
    // Correspondance exacte d'abord : « prix ht » ne doit pas être capté par
    // l'alias « prix » d'une autre colonne présente plus tôt.
    let idx = normalises.findIndex((e) => alias.some((a) => e === normalise(a)));
    if (idx < 0) idx = normalises.findIndex((e) => e && alias.some((a) => e.includes(normalise(a))));
    if (idx >= 0 && !Object.values(trouve).includes(idx)) trouve[champ] = idx;
  }
  return trouve;
}

/** « 12,50 € » → 12.5 ; « 1 234,56 » → 1234.56 ; vide → null. */
export function nombreFr(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;

  const net = String(valeur)
    .replace(/ /g, " ")
    .replace(/[€%\s]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")   // séparateur de milliers à la française
    .replace(",", ".");
  const n = parseFloat(net);
  return Number.isFinite(n) ? n : null;
}

/** Tout ce qu'un fournisseur peut écrire pour dire « kilo », « litre », « pièce ». */
export function uniteNormalisee(valeur: unknown): "kg" | "l" | "unit" | null {
  const t = normalise(String(valeur ?? ""));
  if (!t) return null;
  if (["kg", "kilo", "kilos", "kilogramme", "kilogrammes", "g", "gr", "gramme", "grammes"].includes(t)) return "kg";
  if (["l", "litre", "litres", "lt", "ml", "cl", "millilitre", "centilitre"].includes(t)) return "l";
  if (["u", "unite", "unites", "piece", "pieces", "pce", "pc", "boite", "boites", "bouteille",
       "bouteilles", "sachet", "sachets", "barquette", "barquettes"].includes(t)) return "unit";
  return null;
}

export type LigneSource = { ligne: number; cellules: unknown[] };

export type ProduitImporte = {
  name: string;
  category: string;
  unit: "kg" | "l" | "unit";
  pack_units: number;
  unit_size: number;
  pack_quantity: number;
  pack_price: number;
  cost_per_base_unit: number;
  vat_rate: number;
  yield_pct: number;
  reorder_threshold: number;
  stock_qty: number | null;
  selling_price: number | null;
  supplier_reference: string | null;
  /** Nom du fournisseur tel qu'écrit dans le fichier (résolu à l'écriture). */
  fournisseur: string | null;
};

export type LigneAnalysee = {
  ligne: number;
  statut: Statut;
  nom: string;
  /** Ce qui empêche d'importer la ligne. */
  erreurs: string[];
  /** Ce qui a été deviné ou corrigé — la ligne passe, mais il faut le dire. */
  avertissements: string[];
  produit: ProduitImporte | null;
  /** Identifiant du produit existant, si mise à jour. */
  existantId: string | null;
};

export type Contexte = {
  /** Produits déjà en base : nom normalisé → id. */
  existants: Map<string, string>;
  /** Fournisseurs déjà en base : nom normalisé → id. */
  fournisseurs: Map<string, string>;
  /** TVA appliquée quand le fichier n'en donne pas. */
  tvaDefaut?: number;
};

const VALEURS_TVA = [0, 2.1, 5.5, 10, 20];

/**
 * Analyse une ligne du fichier. Ne touche à rien : renvoie ce qui SERAIT écrit.
 */
export function analyseLigne(
  source: LigneSource,
  cols: Partial<Record<Champ, number>>,
  ctx: Contexte,
  vusDansLeFichier: Map<string, number>,
): LigneAnalysee {
  const lire = (c: Champ): unknown => (cols[c] === undefined ? "" : source.cellules[cols[c]!]);
  const texte = (c: Champ) => String(lire(c) ?? "").trim();

  const erreurs: string[] = [];
  const avertissements: string[] = [];

  const nom = texte("nom");
  if (!nom) {
    return { ligne: source.ligne, statut: "erreur", nom: "", erreurs: ["Nom du produit manquant."], avertissements, produit: null, existantId: null };
  }

  const cle = normalise(nom);
  const dejaVu = vusDansLeFichier.get(cle);
  if (dejaVu) erreurs.push(`Ce produit apparaît déjà ligne ${dejaVu} du fichier.`);

  const unit = uniteNormalisee(lire("unite"));
  if (!unit) erreurs.push(`Unité « ${texte("unite") || "vide"} » non reconnue — attendu : kg, L ou pièce.`);

  const taille = nombreFr(lire("colis_taille"));
  if (taille === null || taille <= 0) erreurs.push("Taille du conditionnement manquante ou nulle (ex. 5 pour un colis de 5 kg).");

  const prix = nombreFr(lire("prix_ht"));
  if (prix === null || prix < 0) erreurs.push("Prix HT du colis manquant ou invalide.");

  let nombre = nombreFr(lire("colis_nombre"));
  if (nombre === null || nombre <= 0) {
    nombre = 1;
    if (cols.colis_nombre !== undefined && texte("colis_nombre")) {
      avertissements.push("Nombre par colis illisible — traité comme 1.");
    }
  }

  let tva = nombreFr(lire("tva"));
  if (tva === null) tva = ctx.tvaDefaut ?? 5.5;
  else if (!VALEURS_TVA.includes(tva)) avertissements.push(`Taux de TVA inhabituel (${tva} %) — vérifie.`);

  let rendement = nombreFr(lire("rendement"));
  if (rendement === null) rendement = 100;
  else if (rendement > 0 && rendement <= 1) {
    // « 0,9 » veut clairement dire 90 %.
    rendement = rendement * 100;
    avertissements.push("Rendement lu comme un taux (0,9 → 90 %).");
  }
  if (rendement <= 0 || rendement > 100) {
    erreurs.push(`Rendement de ${rendement} % impossible — attendu entre 1 et 100.`);
  }

  const prixVente = nombreFr(lire("prix_vente"));
  const stock = nombreFr(lire("stock"));
  const seuil = nombreFr(lire("seuil"));
  const fournisseur = texte("fournisseur") || null;
  if (fournisseur && !ctx.fournisseurs.has(normalise(fournisseur))) {
    avertissements.push(`Fournisseur « ${fournisseur} » inconnu — il sera créé.`);
  }

  const existantId = ctx.existants.get(cle) ?? null;

  if (erreurs.length > 0) {
    return { ligne: source.ligne, statut: "erreur", nom, erreurs, avertissements, produit: null, existantId };
  }

  const pack_quantity = packTotal(nombre!, taille!);
  const produit: ProduitImporte = {
    name: nom,
    category: texte("categorie") || "Autre",
    unit: unit!,
    pack_units: nombre!,
    unit_size: taille!,
    pack_quantity,
    pack_price: prix!,
    cost_per_base_unit: calcCostPerBase(prix!, nombre!, taille!, unit!),
    vat_rate: tva!,
    yield_pct: rendement,
    reorder_threshold: seuil !== null && seuil > 0 ? qtyFromDisplay(seuil, unit!) : 0,
    stock_qty: stock !== null && stock >= 0 ? qtyFromDisplay(stock, unit!) : null,
    selling_price: prixVente !== null && prixVente > 0 ? prixVente : null,
    supplier_reference: texte("reference") || null,
    fournisseur,
  };

  return {
    ligne: source.ligne,
    statut: existantId ? "mettre_a_jour" : "creer",
    nom,
    erreurs: [],
    avertissements,
    produit,
    existantId,
  };
}

export type Analyse = {
  colonnes: Partial<Record<Champ, number>>;
  manquantes: Champ[];
  lignes: LigneAnalysee[];
  resume: { creer: number; mettre_a_jour: number; erreur: number; avertissements: number };
};

/** Analyse le tableau entier : première ligne = en-têtes. */
export function analyseTableau(tableau: unknown[][], ctx: Contexte): Analyse {
  const entetes = (tableau[0] ?? []).map((c) => String(c ?? ""));
  const colonnes = detecteColonnes(entetes);
  const manquantes = OBLIGATOIRES.filter((c) => colonnes[c] === undefined);

  const lignes: LigneAnalysee[] = [];
  if (manquantes.length === 0) {
    const vus = new Map<string, number>();
    for (let i = 1; i < tableau.length; i++) {
      const cellules = tableau[i] ?? [];
      // Une ligne entièrement vide est ignorée : les tableurs en produisent
      // des dizaines en fin de feuille.
      if (cellules.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

      const analysee = analyseLigne({ ligne: i + 1, cellules }, colonnes, ctx, vus);
      if (analysee.nom) vus.set(normalise(analysee.nom), analysee.ligne);
      lignes.push(analysee);
    }
  }

  return {
    colonnes,
    manquantes,
    lignes,
    resume: {
      creer: lignes.filter((l) => l.statut === "creer").length,
      mettre_a_jour: lignes.filter((l) => l.statut === "mettre_a_jour").length,
      erreur: lignes.filter((l) => l.statut === "erreur").length,
      avertissements: lignes.reduce((s, l) => s + l.avertissements.length, 0),
    },
  };
}

/** Libellé lisible d'un champ, pour dire ce qui manque. */
export const CHAMP_LABEL: Record<Champ, string> = {
  nom: "Nom",
  categorie: "Catégorie",
  fournisseur: "Fournisseur",
  reference: "Référence fournisseur",
  unite: "Unité",
  colis_nombre: "Nombre par colis",
  colis_taille: "Taille unitaire",
  prix_ht: "Prix HT",
  tva: "TVA %",
  rendement: "Rendement %",
  seuil: "Seuil de réappro",
  stock: "Stock initial",
  prix_vente: "Prix de vente",
};

// ── Lecture d'un CSV ─────────────────────────────────────────────────

/**
 * Sépérateur du fichier : Excel en français exporte en point-virgule, les
 * outils anglo-saxons en virgule. On compte les deux sur la première ligne
 * hors guillemets et on prend le plus fréquent.
 */
export function detecteSeparateur(premiereLigne: string): ";" | "," | "\t" {
  let dansGuillemets = false;
  const compte = { ";": 0, ",": 0, "\t": 0 };
  for (const c of premiereLigne) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (!dansGuillemets && (c === ";" || c === "," || c === "\t")) compte[c]++;
  }
  if (compte[";"] >= compte[","] && compte[";"] >= compte["\t"]) return compte[";"] > 0 ? ";" : ",";
  return compte["\t"] > compte[","] ? "\t" : ",";
}

/**
 * Lecteur CSV : guillemets, guillemets doublés, séparateurs et retours à la
 * ligne à l'intérieur d'un champ. Pas de dépendance à installer.
 */
export function parseCsv(texte: string): string[][] {
  const net = texte.replace(/^﻿/, "");            // BOM d'Excel
  const sep = detecteSeparateur(net.split(/\r?\n/)[0] ?? "");

  const lignes: string[][] = [];
  let champ = "";
  let ligne: string[] = [];
  let dansGuillemets = false;

  for (let i = 0; i < net.length; i++) {
    const c = net[i];

    if (dansGuillemets) {
      if (c === '"') {
        if (net[i + 1] === '"') { champ += '"'; i++; }  // guillemet échappé
        else dansGuillemets = false;
      } else champ += c;
      continue;
    }

    if (c === '"') { dansGuillemets = true; continue; }
    if (c === sep) { ligne.push(champ.trim()); champ = ""; continue; }
    if (c === "\n") { ligne.push(champ.trim()); lignes.push(ligne); ligne = []; champ = ""; continue; }
    if (c === "\r") continue;
    champ += c;
  }
  if (champ !== "" || ligne.length > 0) { ligne.push(champ.trim()); lignes.push(ligne); }

  return lignes;
}
