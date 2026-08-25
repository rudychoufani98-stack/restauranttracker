// =====================================================================
//  Les trois natures d'articles et leur code couleur.
//
//  Un produit, une mise en place et une fiche technique ne se pilotent pas
//  de la même façon : l'un s'achète, l'autre se fabrique, le dernier se
//  vend. Quand tout est gris, il faut lire chaque libellé pour savoir de
//  quoi on parle.
//
//    PRODUIT  marine  — ce qui entre par la porte de derrière
//    MEP      ambre   — ce qui se fabrique en cuisine, état intermédiaire
//    RECETTE  bleu    — ce qui sort en salle et se vend
//
//  Ce fichier ne contient QUE des données : il est lisible aussi bien
//  depuis un écran que depuis une page serveur ou un export Excel. Les
//  composants React qui s'en servent vivent dans components/TypeIdentite.
// =====================================================================

export type TypeArticle = "produit" | "mep" | "recette";

export type IdentiteType = {
  label: string;
  labelPluriel: string;
  /** Pastille : fond + texte. */
  pastille: string;
  /** Étiquette de type, à côté d'un nom. */
  badge: string;
  /** Filet de gauche sur une ligne de liste ou une carte. */
  bordure: string;
  /** Teinte de fond très légère, pour un bloc entier. */
  fond: string;
  /** Couleur de texte pour un titre. */
  texte: string;
};

export const TYPE_IDENTITE: Record<TypeArticle, IdentiteType> = {
  produit: {
    label: "Produit",
    labelPluriel: "Produits",
    pastille: "bg-tertiary-fixed text-primary",
    badge: "bg-tertiary-fixed text-primary",
    bordure: "border-primary/40",
    fond: "bg-tertiary-fixed/40",
    texte: "text-primary",
  },
  mep: {
    label: "Mise en place",
    labelPluriel: "Mises en place",
    pastille: "bg-amber-light text-amber-dark",
    badge: "bg-amber-light text-amber-dark",
    bordure: "border-amber/50",
    fond: "bg-amber-light/50",
    texte: "text-amber-dark",
  },
  recette: {
    label: "Fiche technique",
    labelPluriel: "Fiches techniques",
    // Marine PLEIN, pas un bleu pâle de plus : mesuré à l'écran, le bleu
    // clair et le marine clair du produit se ressemblaient trop pour être
    // distingués d'un coup d'œil. La différence se joue ici sur la densité
    // autant que sur la teinte — et c'est aussi ce qui se vend, donc ce qui
    // mérite de ressortir.
    pastille: "bg-primary text-on-primary",
    badge: "bg-primary text-on-primary",
    bordure: "border-primary",
    fond: "bg-primary/5",
    texte: "text-primary",
  },
};

export const TYPE_ORDRE: TypeArticle[] = ["produit", "mep", "recette"];

/** La nature d'une fiche : une MEP est une recette qui ne se vend pas. */
export const typeDeRecette = (r: { is_prep?: boolean | null } | null | undefined): TypeArticle =>
  r?.is_prep ? "mep" : "recette";

/** Libellé court, pour une colonne étroite ou un export. */
export const typeCourt = (t: TypeArticle): string =>
  t === "produit" ? "Produit" : t === "mep" ? "MEP" : "Fiche";
