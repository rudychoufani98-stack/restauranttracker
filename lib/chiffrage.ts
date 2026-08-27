// =====================================================================
//  « Pas encore chiffrée » n'est pas « coûte zéro ».
//
//  Une fiche sans ligne d'ingrédient, ou dont les ingrédients n'ont pas
//  encore de prix, a un coût matière de 0. Affiché tel quel, cela donne
//  « 0,00 € » et « 0.0 % de food cost » — le meilleur résultat possible,
//  alors que la vérité est qu'on ne sait pas.
//
//  Relevé chez Amaly : 111 fiches sans ligne, un bandeau annonçant
//  « FOOD COST MOYEN 0.0 % — sur 111 recettes avec prix », et chaque
//  carte affichant fièrement « 0.0 % FC ». Un patron qui ouvre cet écran
//  en conclut que sa marge est parfaite.
//
//  Règle : tant que le coût matière vaut zéro, on n'affiche pas de
//  chiffre — on dit qu'il manque le chiffrage, et on exclut la fiche des
//  moyennes. Un écran muet vaut mieux qu'un écran qui rassure à tort.
// =====================================================================

export type Chiffrable = { total_cost?: number | null; menu_price?: number | null };

/** Le coût matière est-il connu ? (zéro = pas encore saisi, pas gratuit) */
export function estChiffree(r: Chiffrable): boolean {
  const c = Number(r?.total_cost ?? 0);
  return Number.isFinite(c) && c > 0;
}

/** La fiche a-t-elle un prix de vente ? */
export function aUnPrix(r: Chiffrable): boolean {
  const p = Number(r?.menu_price ?? 0);
  return Number.isFinite(p) && p > 0;
}

/**
 * Ce qu'il manque à une fiche pour que son food cost veuille dire
 * quelque chose — null quand elle est complète.
 */
export function manqueA(r: Chiffrable): "chiffrage" | "prix" | "les deux" | null {
  const c = estChiffree(r), p = aUnPrix(r);
  if (c && p) return null;
  if (!c && !p) return "les deux";
  return c ? "prix" : "chiffrage";
}

export const LIBELLE_MANQUE: Record<"chiffrage" | "prix" | "les deux", string> = {
  chiffrage: "Coût matière non chiffré",
  prix: "Pas de prix de vente",
  "les deux": "Ni coût ni prix",
};

/**
 * Moyenne d'un indicateur sur les seules fiches où il a un sens, avec le
 * décompte de celles qu'on a écartées — pour pouvoir le dire à l'écran
 * plutôt que de laisser croire que la moyenne porte sur tout.
 */
export function moyenneSur<T>(
  tout: T[],
  retenue: (x: T) => boolean,
  valeur: (x: T) => number | null,
): { moyenne: number | null; retenues: number; ecartees: number } {
  const gardees = tout.filter(retenue);
  const valeurs = gardees.map(valeur).filter((v): v is number => v != null && Number.isFinite(v));
  return {
    moyenne: valeurs.length ? valeurs.reduce((s, v) => s + v, 0) / valeurs.length : null,
    retenues: valeurs.length,
    ecartees: tout.length - valeurs.length,
  };
}
