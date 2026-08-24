// =====================================================================
//  Ce qu'on peut déclarer en perte.
//
//  Un chef ne jette pas que des produits bruts : il jette aussi une MEP
//  (2 kg de sauce tournée) et des plats finis (3 assiettes ratées). Dans
//  les trois cas, ce qui sort réellement du stock, ce sont des INGRÉDIENTS.
//
//  Une perte de MEP ou de fiche technique est donc décomposée en ses
//  ingrédients, exactement comme le déstockage d'une vente : rendement
//  matière appliqué, sous-recettes en cascade. Les mouvements écrits
//  portent un identifiant de groupe commun pour que l'historique puisse
//  réafficher « Sauce tomate — 2 kg » plutôt que six lignes d'ingrédients.
// =====================================================================
import { ingredientsPerYieldBase, yieldFactor, toBase, type RecipeRow, type IngRow } from "./costing";

export type CibleType = "produit" | "mep" | "recette";

export type Cible = {
  id: string;
  type: CibleType;
  nom: string;
  /** Unité dans laquelle on saisit la perte : kg, L, pce, portion… */
  unite: string;
  /** Coût d'UNE unité saisie (1 kg, 1 portion…) — sert à chiffrer la perte. */
  coutUnitaire: number;
  /** Stock connu, en unité de saisie. Seuls les produits en ont un. */
  stock: number | null;
  categorie: string;
};

export const TYPE_LABEL: Record<CibleType, string> = {
  produit: "Produits",
  mep: "Mises en place",
  recette: "Fiches techniques",
};

/** Libelle au singulier — pour nommer UN element choisi. */
export const TYPE_LABEL_UN: Record<CibleType, string> = {
  produit: "Produit",
  mep: "Mise en place",
  recette: "Fiche technique",
};

/**
 * « 3 portions », mais « 3 kg » et « 3 pce » : seules les unites ecrites en
 * toutes lettres prennent la marque du pluriel.
 */
export function uniteAccordee(quantite: number, unite: string): string {
  return Math.abs(quantite) >= 2 && /^[a-zà-ÿ]{4,}$/i.test(unite) ? `${unite}s` : unite;
}

/** Ordre d'affichage des groupes : du plus courant au plus rare. */
export const TYPE_ORDRE: CibleType[] = ["produit", "mep", "recette"];

const uniteAffichage = (u: string) =>
  u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "L" : u === "unit" || u === "piece" ? "pce" : u;

/** Coût d'un ingrédient par unité de base (g/ml/pce), CMUP en priorité. */
const coutBase = (i: IngRow) => Number(i.cmup ?? i.cost_per_base_unit ?? 0);

export type IngredientCible = IngRow & {
  name: string;
  category?: string | null;
  stock_qty?: number | null;
};

export type RecetteCible = RecipeRow & {
  name: string;
  is_prep?: boolean | null;
};

/**
 * Quantités d'ingrédients BRUTES consommées par une unité de rendement
 * (1 kg de sauce, 1 portion de plat), rendement matière déduit.
 */
export function ingredientsParUnite(
  recipeId: string,
  recipeMap: Map<string, RecipeRow>,
  ingMap: Map<string, IngRow>,
): Map<string, number> {
  const net = ingredientsPerYieldBase(recipeId, recipeMap);

  // ingredientsPerYieldBase raisonne par unité de BASE du rendement : pour une
  // sauce dont le rendement est « 2 kg », il rend les quantités par GRAMME de
  // sauce. Or on saisit une perte en kg. D'où ce facteur d'échelle.
  const recette = recipeMap.get(recipeId);
  const parUniteSaisie = toBase(1, recette?.yield_unit || "portion");

  const brut = new Map<string, number>();
  for (const [ingId, q] of Array.from(net.entries())) {
    const ing = ingMap.get(ingId);
    // Un ingrédient inconnu (fiche supprimée) est ignoré plutôt que compté
    // à un rendement de 1 : mieux vaut manquer une ligne que fausser le stock.
    if (!ing) continue;
    brut.set(ingId, (brut.get(ingId) ?? 0) + (q * parUniteSaisie) / yieldFactor(ing));
  }
  return brut;
}

/** Coût d'une unité de rendement, calculé depuis les ingrédients consommés. */
export function coutParUnite(
  recipeId: string,
  recipeMap: Map<string, RecipeRow>,
  ingMap: Map<string, IngRow>,
): number {
  let total = 0;
  for (const [ingId, q] of Array.from(ingredientsParUnite(recipeId, recipeMap, ingMap).entries())) {
    total += q * coutBase(ingMap.get(ingId)!);
  }
  return total;
}

/** La liste complète de ce qui peut être déclaré en perte. */
export function construireCibles(
  ingredients: IngredientCible[],
  recettes: RecetteCible[],
): Cible[] {
  const ingMap = new Map<string, IngRow>(ingredients.map((i) => [i.id, i as IngRow]));
  const recipeMap = new Map<string, RecipeRow>(recettes.map((r) => [r.id, r as RecipeRow]));

  const cibles: Cible[] = ingredients.map((i) => ({
    id: i.id,
    type: "produit",
    nom: i.name,
    unite: uniteAffichage(i.unit),
    // Le stock et le coût sont en unité de base : ×1000 pour lire au kg/L.
    coutUnitaire: coutBase(i) * (i.unit === "kg" || i.unit === "g" || i.unit === "l" || i.unit === "ml" ? 1000 : 1),
    stock: Number(i.stock_qty ?? 0) / (i.unit === "kg" || i.unit === "g" || i.unit === "l" || i.unit === "ml" ? 1000 : 1),
    categorie: i.category || "Autre",
  }));

  for (const r of recettes) {
    cibles.push({
      id: r.id,
      type: r.is_prep ? "mep" : "recette",
      nom: r.name,
      unite: uniteAffichage(r.yield_unit || "portion"),
      coutUnitaire: coutParUnite(r.id, recipeMap, ingMap),
      stock: null,           // une MEP n'a pas de stock permanent suivi
      categorie: r.is_prep ? "Mise en place" : "Fiche technique",
    });
  }

  return cibles;
}

/**
 * Recherche : on remonte d'abord ce qui COMMENCE par la recherche, puis ce
 * qui la contient. Taper « to » doit proposer « Tomate » avant « Concassé
 * de tomate ».
 */
export function chercheCibles(cibles: Cible[], q: string): Cible[] {
  const t = q.trim().toLowerCase();
  if (!t) return cibles.slice().sort(parNom);

  const commence: Cible[] = [];
  const contient: Cible[] = [];
  for (const c of cibles) {
    const n = c.nom.toLowerCase();
    if (n.startsWith(t)) commence.push(c);
    else if (n.includes(t) || c.categorie.toLowerCase().includes(t)) contient.push(c);
  }
  return [...commence.sort(parNom), ...contient.sort(parNom)];
}

const parNom = (a: Cible, b: Cible) => a.nom.localeCompare(b.nom, "fr");

/** Regroupe les résultats par type, dans l'ordre d'affichage, sans groupe vide. */
export function grouperParType(cibles: Cible[]): { type: CibleType; items: Cible[] }[] {
  return TYPE_ORDRE
    .map((type) => ({ type, items: cibles.filter((c) => c.type === type) }))
    .filter((g) => g.items.length > 0);
}

export type LignePerte = {
  ingredient_id: string;
  /** Quantité en unité de BASE (g / ml / pièce) — ce qui sort du stock. */
  baseQty: number;
  /** Coût d'une unité de base. */
  unitCost: number;
};

export type Decomposition = {
  lignes: LignePerte[];
  cout: number;
};

/**
 * Ce qui doit réellement sortir du stock pour une perte donnée.
 *
 * Le coût est calculé À PARTIR des lignes, jamais à côté : le total affiché
 * est ainsi exactement la somme des mouvements écrits, sans dérive d'arrondi.
 */
export function decomposePerte(
  cible: Cible,
  quantite: number,
  recipeMap: Map<string, RecipeRow>,
  ingMap: Map<string, IngRow>,
): Decomposition {
  const q = Number(quantite);
  if (!Number.isFinite(q) || q <= 0) return { lignes: [], cout: 0 };

  if (cible.type === "produit") {
    const ing = ingMap.get(cible.id);
    if (!ing) return { lignes: [], cout: 0 };
    const baseQty = toBase(q, ing.unit);
    const unitCost = coutBase(ing);
    return { lignes: [{ ingredient_id: cible.id, baseQty, unitCost }], cout: baseQty * unitCost };
  }

  const lignes: LignePerte[] = [];
  let cout = 0;
  for (const [ingId, parUnite] of Array.from(ingredientsParUnite(cible.id, recipeMap, ingMap).entries())) {
    const ing = ingMap.get(ingId)!;
    const baseQty = parUnite * q;
    const unitCost = coutBase(ing);
    if (baseQty <= 0) continue;
    lignes.push({ ingredient_id: ingId, baseQty, unitCost });
    cout += baseQty * unitCost;
  }
  return { lignes, cout };
}

// ── Historique : regrouper les mouvements d'une même perte ───────────

export type MouvementPerte = {
  id?: string;
  ingredient_id: string;
  qty: number;
  unit_cost: number | null;
  loss_reason: string | null;
  notes: string | null;
  created_at: string;
  reference_type?: string | null;
  reference_id?: string | null;
  recipe_id?: string | null;
  recipe_qty?: number | null;
};

export type PerteGroupee = {
  /** Identifiant de groupe, ou l'id du mouvement pour une perte simple. */
  cle: string;
  type: CibleType;
  nom: string;
  quantite: string;        // déjà formatée pour l'affichage
  cout: number;
  cause: string | null;
  note: string | null;
  date: string;
  /** Les mouvements qui composent la perte — utile pour l'annuler. */
  mouvements: MouvementPerte[];
  /** Un écart d'inventaire ne s'annule pas depuis cet écran. */
  inventaire: boolean;
};

/**
 * Une perte de MEP écrit un mouvement par ingrédient. L'historique doit
 * réafficher UNE ligne « Sauce tomate — 2 kg », pas six lignes d'ingrédients
 * dont aucune ne dit ce qui a réellement été jeté.
 */
export function grouperPertes(
  mouvements: MouvementPerte[],
  nomIngredient: (id: string) => string | undefined,
  formatQty: (baseQty: number, ingredientId: string) => string,
  recette: (id: string) => { nom: string; unite: string; mep: boolean } | undefined,
): PerteGroupee[] {
  const groupes = new Map<string, MouvementPerte[]>();
  for (const m of mouvements) {
    const groupable = (m.reference_type ?? "loss") === "loss" && m.reference_id;
    const cle = groupable ? `g:${m.reference_id}` : `m:${m.id ?? m.created_at + m.ingredient_id}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), m]);
  }

  const out: PerteGroupee[] = [];
  for (const [cle, ms] of Array.from(groupes.entries())) {
    const premier = ms[0];
    const cout = ms.reduce((s, m) => s + Number(m.qty) * Number(m.unit_cost ?? 0), 0);
    const inventaire = (premier.reference_type ?? "loss") === "inventory";
    const rec = premier.recipe_id ? recette(premier.recipe_id) : undefined;

    out.push({
      cle,
      type: rec ? (rec.mep ? "mep" : "recette") : "produit",
      nom: rec ? rec.nom : nomIngredient(premier.ingredient_id) ?? "Produit supprimé",
      quantite: rec
        ? `${Number(premier.recipe_qty ?? 0)} ${uniteAccordee(Number(premier.recipe_qty ?? 0), rec.unite)}`
        : formatQty(Number(premier.qty), premier.ingredient_id),
      cout,
      cause: premier.loss_reason,
      note: premier.notes,
      date: premier.created_at,
      mouvements: ms,
      inventaire,
    });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Filtre l'historique sur le nom, la cause ou la note. */
export function chercheDansHistorique(pertes: PerteGroupee[], q: string): PerteGroupee[] {
  const t = q.trim().toLowerCase();
  if (!t) return pertes;
  return pertes.filter(
    (p) =>
      p.nom.toLowerCase().includes(t) ||
      (p.cause ?? "").toLowerCase().includes(t) ||
      (p.note ?? "").toLowerCase().includes(t),
  );
}
