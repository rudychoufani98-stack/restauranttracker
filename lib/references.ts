// =====================================================================
//  Numérotation interne des produits.
//
//  Le principe : le PREMIER CHIFFRE dit la famille. En voyant 5042 sur un
//  bon de commande ou une étiquette de bac, on sait qu'on est en épicerie
//  sans rien consulter.
//
//    1xxx  Viandes            5xxx  Épicerie
//    2xxx  Poissons           6xxx  Boulangerie & pâtisserie
//    3xxx  Fruits & légumes   7xxx  Boissons
//    4xxx  Crèmerie           8xxx  Surgelés
//                             9xxx  Fournitures & emballages
//
//  Des blocs de MÊME taille, sans chevauchement : « viandes 0-100 puis
//  épicerie 100-1000 » se marcherait dessus dès le centième produit, et
//  un numéro à 2 chiffres à côté d'un numéro à 4 ne se trie pas à l'œil.
//
//  Les blocs restent modifiables par catégorie (categories.ref_start) :
//  ceci n'est qu'un point de départ raisonnable.
// =====================================================================
import { normalise } from "./import-produits";

export const TAILLE_BLOC = 1000;

export type Famille = { debut: number; nom: string; motsCles: string[] };

/** Familles reconnues, dans l'ordre des blocs. */
export const FAMILLES: Famille[] = [
  { debut: 1000, nom: "Viandes", motsCles: ["viande", "viandes", "boucherie", "volaille", "volailles", "charcuterie", "gibier", "agneau", "boeuf", "porc", "poulet"] },
  { debut: 2000, nom: "Poissons & fruits de mer", motsCles: ["poisson", "poissons", "maree", "fruits de mer", "crustace", "crustaces", "coquillage", "saumon", "thon"] },
  { debut: 3000, nom: "Fruits & légumes", motsCles: ["legume", "legumes", "fruit", "fruits", "primeur", "primeurs", "salade", "herbes fraiches"] },
  { debut: 4000, nom: "Crèmerie & fromages", motsCles: ["cremerie", "fromage", "fromages", "laitier", "laitiers", "lait", "beurre", "creme", "oeuf", "oeufs", "yaourt"] },
  { debut: 5000, nom: "Épicerie", motsCles: ["epicerie", "huile", "huiles", "sauce", "sauces", "condiment", "condiments", "herbe", "herbes", "epice", "epices", "grain", "grains", "riz", "pate", "pates", "conserve", "conserves", "farine", "sucre", "sec", "secs", "legumineuse"] },
  { debut: 6000, nom: "Boulangerie & pâtisserie", motsCles: ["pain", "pains", "boulangerie", "patisserie", "viennoiserie", "viennoiseries", "dessert", "desserts"] },
  { debut: 7000, nom: "Boissons", motsCles: ["boisson", "boissons", "soft", "softs", "biere", "bieres", "vin", "vins", "alcool", "alcools", "spiritueux", "eau", "eaux", "jus", "cafe", "the", "cave"] },
  { debut: 8000, nom: "Surgelés", motsCles: ["surgele", "surgeles", "congele", "congeles", "glace", "glaces", "sorbet"] },
  { debut: 9000, nom: "Fournitures & emballages", motsCles: ["fourniture", "fournitures", "emballage", "emballages", "entretien", "hygiene", "consommable", "consommables", "gobelet", "gobelets", "barquette", "serviette", "produit menager"] },
];

/** Premier bloc laissé aux catégories que l'on ne reconnaît pas. */
export const PREMIER_BLOC_LIBRE = 10000;

/** « 5042 » — toujours au moins 4 chiffres, pour que le tri texte marche. */
export function formatRef(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return String(Math.trunc(Number(n))).padStart(4, "0");
}

/** La famille dont un nom de catégorie relève, ou null si on ne sait pas. */
export function familleDe(nomCategorie: string): Famille | null {
  const t = normalise(nomCategorie);
  if (!t) return null;

  // Un mot-clé qui EST le nom de la catégorie l'emporte sur un simple
  // fragment : « Pâtes » ne doit pas basculer en boulangerie via « patisserie ».
  for (const f of FAMILLES) if (f.motsCles.some((m) => normalise(m) === t)) return f;

  const mots = t.split(" ").filter(Boolean);
  for (const f of FAMILLES) {
    if (f.motsCles.some((m) => mots.includes(normalise(m)))) return f;
  }
  return null;
}

export type CategorieRef = { name: string; ref_start?: number | null };

/**
 * Attribue un bloc à chaque catégorie. Ce qui est déjà réglé n'est jamais
 * déplacé — un numéro imprimé sur une étiquette ne doit pas changer de sens.
 */
export function suggerePlages(categories: CategorieRef[]): Map<string, number> {
  const plages = new Map<string, number>();
  const pris = new Set<number>();

  for (const c of categories) {
    if (c.ref_start != null && Number.isFinite(Number(c.ref_start))) {
      plages.set(c.name, Number(c.ref_start));
      pris.add(Number(c.ref_start));
    }
  }

  const inconnues: string[] = [];
  for (const c of categories) {
    if (plages.has(c.name)) continue;
    const f = familleDe(c.name);
    if (f && !pris.has(f.debut)) {
      plages.set(c.name, f.debut);
      pris.add(f.debut);
    } else {
      inconnues.push(c.name);
    }
  }

  // Les catégories non reconnues (ou dont le bloc est déjà pris par une
  // autre catégorie) prennent les blocs libres suivants, par ordre alphabétique.
  let libre = PREMIER_BLOC_LIBRE;
  for (const nom of inconnues.sort((a, b) => a.localeCompare(b, "fr"))) {
    while (pris.has(libre)) libre += TAILLE_BLOC;
    plages.set(nom, libre);
    pris.add(libre);
    libre += TAILLE_BLOC;
  }

  return plages;
}

/** Prochain numéro libre dans un bloc, ou null si le bloc est plein. */
export function prochaineRef(debut: number, prises: Set<number>): number | null {
  for (let n = debut; n < debut + TAILLE_BLOC; n++) {
    if (!prises.has(n)) return n;
  }
  return null;
}

export type ProduitRef = {
  id: string;
  name: string;
  category?: string | null;
  internal_ref?: number | null;
};

export type Attribution = { id: string; nom: string; categorie: string; ref: number };

export type ResultatAttribution = {
  attributions: Attribution[];
  /** Produits qu'on n'a pas pu numéroter, avec la raison. */
  refuses: { nom: string; raison: string }[];
  /** Blocs utilisés, pour expliquer ce qui va se passer. */
  plages: Map<string, number>;
};

/**
 * Numérote les produits qui n'ont pas encore de référence.
 *
 * Un produit DÉJÀ numéroté n'est jamais renuméroté, même si sa catégorie a
 * changé : la référence est imprimée sur des bacs et recopiée sur des bons
 * de commande, elle doit rester stable.
 */
export function attribueReferences(
  produits: ProduitRef[],
  categories: CategorieRef[],
): ResultatAttribution {
  const plages = suggerePlages(categories);
  const prises = new Set<number>();
  for (const p of produits) {
    if (p.internal_ref != null && Number.isFinite(Number(p.internal_ref))) prises.add(Number(p.internal_ref));
  }

  const attributions: Attribution[] = [];
  const refuses: { nom: string; raison: string }[] = [];

  // Par catégorie puis par nom : les numéros suivent l'ordre du catalogue,
  // ce qui rend la liste imprimée lisible.
  const aNumeroter = produits
    .filter((p) => p.internal_ref == null || !Number.isFinite(Number(p.internal_ref)))
    .sort((a, b) => {
      const ca = a.category || "Autre", cb = b.category || "Autre";
      return ca.localeCompare(cb, "fr") || a.name.localeCompare(b.name, "fr");
    });

  for (const p of aNumeroter) {
    const categorie = p.category || "Autre";
    const debut = plages.get(categorie);
    if (debut === undefined) {
      refuses.push({ nom: p.name, raison: `Catégorie « ${categorie} » sans bloc de numérotation.` });
      continue;
    }
    const ref = prochaineRef(debut, prises);
    if (ref === null) {
      refuses.push({ nom: p.name, raison: `Bloc ${debut}–${debut + TAILLE_BLOC - 1} plein (${TAILLE_BLOC} produits).` });
      continue;
    }
    prises.add(ref);
    attributions.push({ id: p.id, nom: p.name, categorie, ref });
  }

  return { attributions, refuses, plages };
}

// ── Référence de caisse des recettes ─────────────────────────────────

/**
 * La touche de caisse est saisie à la main : on nettoie juste les espaces
 * et on met en majuscules, pour que « plt12 » et « PLT 12 » ne finissent
 * pas sur deux fiches différentes.
 */
export function normaliseRefCaisse(valeur: string): string {
  return String(valeur ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

/** Deux recettes ne peuvent pas partager la même touche de caisse. */
export function refCaisseEnDouble(
  refs: { id: string; name: string; pos_ref?: string | null }[],
): { ref: string; recettes: string[] }[] {
  const parRef = new Map<string, string[]>();
  for (const r of refs) {
    const cle = normaliseRefCaisse(r.pos_ref ?? "");
    if (!cle) continue;
    parRef.set(cle, [...(parRef.get(cle) ?? []), r.name]);
  }
  return Array.from(parRef.entries())
    .filter(([, noms]) => noms.length > 1)
    .map(([ref, recettes]) => ({ ref, recettes }));
}
