"use client";

// =====================================================================
//  Une section de fiche — et, quand il le faut, une section qu'on replie.
//
//  Les trois fiches (produit, mise en place, recette) empilaient chacune
//  entre cinq et sept cartes toutes ouvertes. On y trouve son chemin
//  quand on connaît déjà l'écran ; on s'y noie quand on le découvre.
//  Les blocs qui ne servent qu'une fois — la part utilisable, les
//  allergènes, « utilisé dans », l'outil de ratio — se replient donc, et
//  s'ouvrent d'eux-mêmes dès qu'ils contiennent quelque chose : rien ne
//  disparaît, c'est juste rangé.
//
//  Les teintes ne décorent pas : chacune dit ce que le bloc décide.
// =====================================================================

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";

export const TEINTES = {
  usage:     { bord: "border-l-4 border-l-primary",        pastille: "bg-tertiary-fixed text-primary",            titre: "text-primary" },
  matiere:   { bord: "border-l-4 border-l-primary/60",     pastille: "bg-tertiary-fixed text-primary",            titre: "text-primary" },
  achat:     { bord: "border-l-4 border-l-brand-orange",   pastille: "bg-brand-orange/10 text-brand-orange-deep", titre: "text-brand-orange-deep" },
  vente:     { bord: "border-l-4 border-l-green",          pastille: "bg-green-light text-green-dark",            titre: "text-green-dark" },
  lien:      { bord: "border-l-4 border-l-blue",           pastille: "bg-blue-light text-blue-dark",              titre: "text-blue-dark" },
  allergene: { bord: "border-l-4 border-l-red",            pastille: "bg-red-light text-red",                     titre: "text-red" },
  danger:    { bord: "border-l-4 border-l-red",            pastille: "bg-red-light text-red",                     titre: "text-red" },
  outil:     { bord: "",                                   pastille: "bg-gray-100 text-gray-500",                 titre: "text-gray-900" },
  neutre:    { bord: "",                                   pastille: "bg-gray-100 text-gray-500",                 titre: "text-gray-900" },
} as const;

export type Accent = { bord: string; pastille: string; titre: string };

export default function SectionFiche({
  icon, title, subtitle, action, teinte = "neutre", accent,
  repliable, ouvertParDefaut = false, resume, children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  teinte?: keyof typeof TEINTES;
  /** Surcharge : la couleur de la nature de la fiche (MEP ou recette). */
  accent?: Accent;
  /** Le bloc se replie, et son titre devient un bouton. */
  repliable?: boolean;
  ouvertParDefaut?: boolean;
  /** Ce qu'on lit quand le bloc est fermé — « 3 allergènes », « 2 recettes ». */
  resume?: string;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const t = accent ?? TEINTES[teinte];
  const plie = repliable && !ouvert;

  const entete = (
    <div className={clsx("flex items-start justify-between", !plie && "mb-3")}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", t.pastille)}>{icon}</div>}
        <div className="min-w-0">
          <h2 className={clsx("text-sm font-semibold flex items-center gap-1.5", t.titre)}>
            {title}
            {repliable && <ChevronDown size={14} className={clsx("transition shrink-0", ouvert && "rotate-180")} />}
          </h2>
          {/* Fermé, le bloc dit ce qu'il contient ; ouvert, il explique. */}
          {plie && resume ? (
            <p className="text-xs text-gray-500 mt-0.5">{resume}</p>
          ) : subtitle && !plie ? (
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {!plie && action}
    </div>
  );

  return (
    <div className={clsx("bg-white border border-gray-100 rounded-card shadow-card px-5 mb-4", plie ? "py-3.5" : "py-5", t.bord)}>
      {repliable ? (
        <button type="button" onClick={() => setOuvert((v) => !v)} className="w-full text-left">
          {entete}
        </button>
      ) : entete}
      {!plie && children}
    </div>
  );
}
