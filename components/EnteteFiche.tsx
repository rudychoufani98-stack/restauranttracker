"use client";

// =====================================================================
//  L'en-tête d'une fiche : son NOM, en grand.
//
//  Le nom tenait dans un champ de formulaire de la même taille que la
//  TVA ou le seuil d'alerte, sous une étiquette « Nom de la recette ».
//  Sur un écran qui ne parle que d'un seul produit, le nom n'est pas un
//  champ parmi d'autres : c'est le titre de la page. On l'écrit donc
//  comme un titre — grand, sans cadre — et il reste modifiable d'un
//  clic, sans bouton « crayon » à trouver.
//
//  Partagé par les trois fiches — ingrédient, mise en place, recette —
//  pour qu'elles se ressemblent au lieu de se ressembler presque.
// =====================================================================

import clsx from "clsx";

export default function EnteteFiche({
  badge, nom, onNom, placeholder, accent,
  libelleClassement, classement, onClassement, options, aide, alerte,
  extra,
}: {
  /** La pastille de nature (MEP, fiche technique, produit). */
  badge?: React.ReactNode;
  nom: string;
  onNom: (v: string) => void;
  placeholder?: string;
  /** Bordure colorée de la nature de la fiche. */
  accent?: string;
  libelleClassement: string;
  classement: string;
  onClassement: (v: string) => void;
  options: string[];
  aide?: string;
  /** Message ambre quand le classement ne vient pas de la bonne liste. */
  alerte?: string | null;
  /** Un ou deux champs que la fiche veut voir dès le titre (l'unité…). */
  extra?: React.ReactNode;
}) {
  return (
    <div className={clsx("bg-white border border-gray-100 rounded-card shadow-card px-5 py-4 mb-4", accent)}>
      {badge && <div className="flex items-center gap-2.5 mb-2">{badge}</div>}

      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex-1 min-w-0">
          {/* Pas d'étiquette : un titre n'en a pas besoin. */}
          <input
            value={nom}
            onChange={(e) => onNom(e.target.value)}
            placeholder={placeholder}
            aria-label="Nom"
            className="w-full bg-transparent text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight
                       border-0 border-b-2 border-transparent hover:border-gray-200 focus:border-primary
                       outline-none transition px-0 py-1 placeholder:text-gray-300 placeholder:font-bold"
          />
        </div>

        <div className="w-full lg:w-56 shrink-0">
          <label className="block text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {libelleClassement}
          </label>
          <select
            value={classement}
            onChange={(e) => onClassement(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
          >
            {Array.from(new Set([...options, classement].filter(Boolean))).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        {extra}
      </div>

      {alerte ? (
        <p className="text-2xs text-amber-600 mt-2">{alerte}</p>
      ) : aide ? (
        <p className="text-2xs text-gray-400 mt-2">{aide}</p>
      ) : null}
    </div>
  );
}
