// =====================================================================
//  TVA sur les ventes — et pourquoi ça change tous les food costs.
//
//  Le coût d'un plat vient des factures fournisseurs : il est en HT.
//  Le prix de carte est celui que lit le client : il est en TTC.
//  Les diviser l'un par l'autre sous-estime TOUJOURS le food cost.
//
//    Plat à 15 € TTC, 4 € de matière, TVA 10 %
//      faux  : 4 / 15     = 26,7 %
//      juste : 4 / 13,64  = 29,3 %
//
//  2,6 points d'écart. Un chef qui vise 30 % se croit large alors qu'il
//  est au bord — c'est exactement le chiffre sur lequel il décide de
//  changer un fournisseur ou de remonter un prix.
//
//  Les taux ne sont pas codés en dur : la règle dépend du mode de
//  consommation, elle change, et elle diffère d'un pays à l'autre.
// =====================================================================

export type Canal = "dine_in" | "takeaway" | "delivery";

export type ReglagesTva = {
  dine_in: number;
  takeaway: number;
  delivery: number;
  /** L'alcool ne suit pas le mode de consommation : son taux prime. */
  alcohol: number;
};

/** Point de départ français, à confirmer avec un comptable. */
export const TVA_DEFAUT: ReglagesTva = {
  dine_in: 10,
  takeaway: 5.5,
  delivery: 10,
  alcohol: 20,
};

export const CANAUX: { key: Canal; label: string; aide: string }[] = [
  { key: "dine_in", label: "Sur place", aide: "Consommation immédiate en salle ou en terrasse." },
  { key: "takeaway", label: "À emporter", aide: "Le client repart avec sa commande." },
  { key: "delivery", label: "Livraison", aide: "Plateformes (Deliveroo, Uber Eats) ou livraison en propre." },
];

export const canalLabel = (c?: string | null): string =>
  CANAUX.find((x) => x.key === (c ?? "dine_in"))?.label ?? "Sur place";

/** Lit les réglages d'un restaurant, en comblant ce qui manque. */
export function reglagesTva(restaurant: any): ReglagesTva {
  const n = (v: unknown, defaut: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 && x <= 100 ? x : defaut;
  };
  return {
    dine_in: n(restaurant?.vat_dine_in, TVA_DEFAUT.dine_in),
    takeaway: n(restaurant?.vat_takeaway, TVA_DEFAUT.takeaway),
    delivery: n(restaurant?.vat_delivery, TVA_DEFAUT.delivery),
    alcohol: n(restaurant?.vat_alcohol, TVA_DEFAUT.alcohol),
  };
}

/**
 * Un article relève-t-il de l'alcool ?
 *
 * On se sert d'abord de la numérotation interne, qui range déjà les bières,
 * les vins et les spiritueux dans leurs propres blocs (9xxx à 11xxx). C'est
 * la source la plus fiable puisqu'elle a été validée à l'attribution.
 */
export const BLOCS_ALCOOL = [9000, 10000, 11000];

const MOTS_ALCOOL = [
  "biere", "bieres", "cidre", "vin", "vins", "champagne", "spiritueux", "alcool",
  "alcools", "aperitif", "aperitifs", "digestif", "cocktail", "cocktails", "cave",
  "whisky", "vodka", "rhum", "gin", "arak", "liqueur",
];

const sansAccents = (t: string) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function estAlcool(article: {
  internal_ref?: number | null;
  category?: string | null;
  name?: string | null;
}): boolean {
  const ref = Number(article?.internal_ref);
  if (Number.isFinite(ref)) {
    const bloc = Math.floor(ref / 1000) * 1000;
    // Le numéro fait foi : il a été attribué en connaissance de cause.
    return BLOCS_ALCOOL.includes(bloc);
  }

  // Pas encore numéroté : on retombe sur la catégorie, puis sur le nom.
  const mots = `${sansAccents(article?.category ?? "")} ${sansAccents(article?.name ?? "")}`
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return MOTS_ALCOOL.some((m) => mots.includes(m));
}

/** Le taux qui s'applique à une vente. L'alcool prime sur le canal. */
export function tauxDeVente(canal: string | null | undefined, alcool: boolean, r: ReglagesTva): number {
  if (alcool) return r.alcohol;
  const c = (canal ?? "dine_in") as Canal;
  return c === "takeaway" ? r.takeaway : c === "delivery" ? r.delivery : r.dine_in;
}

/** 15 € TTC à 10 % → 13,636 € HT. */
export function htDepuisTTC(ttc: number, taux: number): number {
  const t = Number(taux);
  const p = Number(ttc);
  if (!Number.isFinite(p)) return 0;
  if (!Number.isFinite(t) || t <= 0) return p;
  return p / (1 + t / 100);
}

/** 13,636 € HT à 10 % → 15 € TTC. */
export function ttcDepuisHT(ht: number, taux: number): number {
  const t = Number(taux);
  const p = Number(ht);
  if (!Number.isFinite(p)) return 0;
  if (!Number.isFinite(t) || t <= 0) return p;
  return p * (1 + t / 100);
}

/**
 * Food cost en %, calculé sur des bases comparables : coût HT sur CA HT.
 * Renvoie null quand il n'y a pas de prix de vente — un food cost sans
 * prix n'est pas 0 %, il n'existe pas.
 */
export function foodCostPct(coutHT: number, prixTTC: number, taux: number): number | null {
  const ht = htDepuisTTC(prixTTC, taux);
  if (!(ht > 0)) return null;
  return (Number(coutHT) / ht) * 100;
}

/** Marge brute d'un article, en euros HT. */
export function margeHT(prixTTC: number, coutHT: number, taux: number): number {
  return htDepuisTTC(prixTTC, taux) - Number(coutHT || 0);
}

/**
 * Prix de carte à afficher pour tenir un objectif de food cost.
 * On raisonne en HT, puis on rhabille en TTC — c'est le prix que le client
 * verra, mais l'objectif porte bien sur la marge réelle.
 */
export function prixSuggereTTC(coutHT: number, objectifPct: number, taux: number): number | null {
  const obj = Number(objectifPct);
  const cout = Number(coutHT);
  if (!(obj > 0) || !(cout > 0)) return null;
  return ttcDepuisHT(cout / (obj / 100), taux);
}

/** Arrondi « prix de carte » : 13,47 € → 13,50 € par pas de 0,50. */
export function arrondiCommercial(prix: number, pas = 0.5): number {
  const p = Number(prix);
  const s = Number(pas);
  if (!Number.isFinite(p) || !(s > 0)) return p;
  return Math.ceil(p / s) * s;
}
