// =====================================================================
//  État d'un produit en stock.
//
//  Le problème que ça règle : sur une carte de 100 produits, la plupart
//  n'ont jamais été reçus (fiches créées à l'ouverture du compte). Les
//  marquer tous « à commander » noyait les 3 produits réellement en
//  rupture sous 97 alertes — un bandeau rouge partout ne veut plus rien
//  dire, et on finit par ne plus le voir.
//
//  On distingue donc deux situations qui n'ont rien à voir :
//    • un produit que tu utilises et qui est tombé à zéro → À COMMANDER
//    • une fiche créée, jamais reçue                       → JAMAIS REÇU
//
//  La seconde n'est pas une urgence : c'est un état normal tant que tu
//  n'as pas commencé à acheter ce produit.
// =====================================================================

export type EtatStock = "rupture" | "bas" | "ok" | "jamais";

export type StockLike = {
  stock_qty?: number | null;
  reorder_threshold?: number | null;
};

/**
 * `nbMouvements` = nombre d'entrées/sorties enregistrées pour ce produit.
 * C'est lui qui distingue « jamais utilisé » de « épuisé ».
 */
export function etatStock(i: StockLike, nbMouvements: number): EtatStock {
  const stock = Number(i.stock_qty ?? 0);
  const seuil = Number(i.reorder_threshold ?? 0);

  // Jamais aucun mouvement et rien en stock : la fiche existe, le produit
  // n'est jamais entré. Un seuil de réappro explicite vaut décision du
  // restaurateur : dans ce cas on traite le produit comme suivi.
  if (nbMouvements === 0 && stock <= 0 && seuil <= 0) return "jamais";

  if (stock <= 0) return "rupture";
  if (seuil > 0 && stock <= seuil) return "bas";
  return "ok";
}

/** Un produit qu'il faut effectivement remettre en commande. */
export const aCommander = (e: EtatStock) => e === "rupture" || e === "bas";

export const ETAT_LABEL: Record<EtatStock, string> = {
  rupture: "En rupture",
  bas: "À commander",
  ok: "En stock",
  jamais: "Jamais reçu",
};

/** Le mot qui explique l'état, en clair, pour l'infobulle et la ligne. */
export const ETAT_AIDE: Record<EtatStock, string> = {
  rupture: "Tu utilises ce produit et il est tombé à zéro.",
  bas: "Il reste du stock, mais tu es sous ton seuil de réapprovisionnement.",
  ok: "Stock suffisant.",
  jamais: "Cette fiche n'a jamais reçu de marchandise — normal tant que tu n'as pas commandé ce produit.",
};

export type CompteEtats = Record<EtatStock, number> & { total: number; valeur: number };

/** Compte les produits par état, et la valeur totale du stock. */
export function compteEtats(
  rows: { etat: EtatStock; value: number }[],
): CompteEtats {
  const out: CompteEtats = { rupture: 0, bas: 0, ok: 0, jamais: 0, total: rows.length, valeur: 0 };
  for (const r of rows) {
    out[r.etat] += 1;
    out.valeur += r.value;
  }
  return out;
}

/** Date du dernier mouvement, ou null si le produit n'a jamais bougé. */
export function dernierMouvement(moves: { created_at: string }[]): string | null {
  let max: string | null = null;
  for (const m of moves) {
    if (!m?.created_at) continue;
    if (max === null || m.created_at > max) max = m.created_at;
  }
  return max;
}

/** « il y a 3 jours », « aujourd'hui » — repère plus parlant qu'une date. */
export function depuisQuand(iso: string | null, maintenant: number): string {
  if (!iso) return "jamais reçu";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "jamais reçu";

  const jours = Math.floor((maintenant - t) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  if (jours < 31) return `il y a ${jours} jours`;
  const mois = Math.round(jours / 30.44);
  if (mois < 12) return `il y a ${mois} mois`;
  const ans = Math.floor(mois / 12);
  return ans === 1 ? "il y a plus d'un an" : `il y a ${ans} ans`;
}
