// =====================================================================
//  Interprétation d'un inventaire selon le moment du service.
//
//  Le stock théorique de l'app déduit les ventes du MOIS en une fois.
//  Conséquence concrète : le moment où tu comptes change la lecture des
//  écarts, et il faut le dire avant de finaliser.
//
//    • Compté APRÈS le service  → le service du jour est consommé, et le
//      stock théorique le reflète : les écarts sont exploitables.
//    • Compté AVANT le service  → si les ventes du mois sont déjà saisies,
//      le stock théorique a déjà retiré le service à venir : tu verras un
//      faux SURPLUS (tu as physiquement plus que le théorique).
//    • Compté PENDANT le service → le stock bouge en même temps que tu
//      comptes : les écarts mélangent inventaire et consommation en cours.
// =====================================================================

import type { ServiceMoment } from "./service-moment";

export type MomentAdvice = {
  level: "ok" | "attention";
  /** Message court, affichable tel quel à l'utilisateur. */
  message: string;
};

/**
 * @param moment            avant / pendant / apres (null = non renseigné)
 * @param ventesDejaSaisies true si des ventes sont enregistrées pour la
 *                          période couvrant la date du comptage
 */
export function inventoryMomentAdvice(
  moment: ServiceMoment | null | undefined,
  ventesDejaSaisies: boolean,
): MomentAdvice {
  if (moment === "apres") {
    return {
      level: "ok",
      message: ventesDejaSaisies
        ? "Comptage après le service : le stock théorique tient compte des ventes du mois. Les écarts sont exploitables."
        : "Comptage après le service. Pense à saisir les ventes du mois : sans elles, les écarts ne tiennent compte que des réceptions et des pertes.",
    };
  }

  if (moment === "avant") {
    return ventesDejaSaisies
      ? {
          level: "attention",
          message:
            "Comptage AVANT le service, alors que les ventes du mois sont déjà saisies : le stock théorique a déjà déduit le service à venir. Tu risques de voir un surplus qui n'existe pas. Compte plutôt après le service, ou finalise en connaissance de cause.",
        }
      : {
          level: "ok",
          message:
            "Comptage avant le service : c'est un état d'ouverture. Les écarts refléteront les réceptions et les pertes, pas encore les ventes.",
        };
  }

  if (moment === "pendant") {
    return {
      level: "attention",
      message:
        "Comptage PENDANT le service : le stock bouge en même temps que tu comptes. Les écarts mélangeront l'inventaire et la consommation en cours — préfère un comptage avant l'ouverture ou après la fermeture.",
    };
  }

  return {
    level: "attention",
    message: "Moment du service non renseigné : précise si le comptage a lieu avant, pendant ou après le service pour que les écarts soient interprétables.",
  };
}
