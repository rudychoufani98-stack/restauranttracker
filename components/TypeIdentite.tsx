"use client";

// =====================================================================
//  Les briques visuelles du code couleur des trois natures d'articles.
//
//  Les DONNÉES (couleurs, libellés) vivent dans lib/type-article.ts, sans
//  directive "use client" : une page serveur ou un export Excel peut ainsi
//  s'en servir. Ce fichier ne contient que les composants React.
//
//  La couleur ne remplace jamais le texte : chaque pastille porte aussi
//  une icône et un libellé accessible, sinon l'écran devient illisible
//  pour qui distingue mal les couleurs.
// =====================================================================
import clsx from "clsx";
import { Package, Soup, ChefHat } from "lucide-react";
import { TYPE_IDENTITE, TYPE_ORDRE, typeCourt, type TypeArticle } from "@/lib/type-article";

export { TYPE_IDENTITE, typeDeRecette, type TypeArticle } from "@/lib/type-article";

const ICONES: Record<TypeArticle, typeof Package> = {
  produit: Package,
  mep: Soup,
  recette: ChefHat,
};

/** Pastille avec l'icône du type. */
export function Pastille({
  type, taille = "md", className,
}: {
  type: TypeArticle;
  taille?: "sm" | "md" | "lg";
  className?: string;
}) {
  const id = TYPE_IDENTITE[type];
  const Icone = ICONES[type];
  const dims = taille === "sm" ? "w-7 h-7" : taille === "lg" ? "w-10 h-10" : "w-9 h-9";
  const px = taille === "sm" ? 14 : taille === "lg" ? 19 : 17;
  return (
    <div
      className={clsx("rounded-xl flex items-center justify-center shrink-0", id.pastille, dims, className)}
      title={id.label}
    >
      <Icone size={px} aria-hidden="true" />
      <span className="sr-only">{id.label}</span>
    </div>
  );
}

/** Étiquette texte, à poser à côté d'un nom dans une liste. */
export function BadgeType({ type, court }: { type: TypeArticle; court?: boolean }) {
  const id = TYPE_IDENTITE[type];
  const Icone = ICONES[type];
  return (
    <span className={clsx(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wide",
      id.badge,
    )}>
      <Icone size={10} aria-hidden="true" />
      {court ? typeCourt(type) : id.label}
    </span>
  );
}

/**
 * Légende du code couleur. À poser une fois en haut d'un écran qui mélange
 * les trois natures — sans elle, la couleur reste une devinette.
 */
export function LegendeTypes({ types = TYPE_ORDRE }: { types?: TypeArticle[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {types.map((t) => {
        const id = TYPE_IDENTITE[t];
        const Icone = ICONES[t];
        return (
          <span key={t} className="inline-flex items-center gap-1.5 text-2xs text-on-surface-variant/70">
            <span className={clsx("w-4 h-4 rounded flex items-center justify-center", id.pastille)}>
              <Icone size={10} aria-hidden="true" />
            </span>
            {id.label}
          </span>
        );
      })}
    </div>
  );
}
