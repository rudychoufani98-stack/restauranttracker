"use client";

// =====================================================================
//  « Ranger mon catalogue »
//
//  Un catalogue de restaurant arrive toujours en vrac : les produits
//  entrent par l import d une mercuriale, par les factures et par les
//  notes de cuisine, et chaque porte a son vocabulaire. Chez le premier
//  client : la moitie des produits dans « Autre », toutes les mises en
//  place dans « Base », et quatre rayons proposes dans le formulaire que
//  pas un produit n utilisait.
//
//  Cet ecran montre le detail de ce qui serait fait AVANT de le faire :
//  un classement qu on ne peut pas relire est un classement qu on ne
//  croit pas.
// =====================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Loader2, ChevronDown, ChevronRight, Check } from "lucide-react";
import clsx from "clsx";

type Deplacement = { id: string; nom: string; avant: string; apres: string };
type PlanCat = {
  aCreer: { name: string; position: number }[];
  aRetirer: { id: string; name: string; raison: string }[];
  aReordonner: { id: string; name: string; position: number }[];
};
type Plan = {
  produits: { deplacements: Deplacement[]; nonReconnus: { id: string; nom: string }[] };
  meps: { deplacements: Deplacement[]; nonReconnus: { id: string; nom: string }[] };
  categories: { ingredient: PlanCat; prep: PlanCat; menu: PlanCat };
};

const TITRES: Record<string, string> = { ingredient: "Ingrédients", prep: "Mises en place", menu: "Carte" };

/** Regroupe des déplacements par rayon d'arrivée, le plus gros en tête. */
function parArrivee(d: Deplacement[]) {
  const m = new Map<string, string[]>();
  for (const x of d) m.set(x.apres, [...(m.get(x.apres) ?? []), x.nom]);
  return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
}

export default function RangementPanel() {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [chargement, setChargement] = useState(false);
  const [application, setApplication] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [fait, setFait] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function verifier() {
    setChargement(true); setErreur(null); setFait(null);
    try {
      const r = await fetch("/api/catalogue/ranger");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Vérification impossible");
      setPlan(j); setOuvert(true);
    } catch (e: any) {
      setErreur(e?.message ?? "Vérification impossible");
    } finally {
      setChargement(false);
    }
  }

  async function appliquer() {
    setApplication(true); setErreur(null);
    try {
      const r = await fetch("/api/catalogue/ranger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portee: ["produits", "meps", "categories"] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Rangement impossible");
      setFait(
        `${j.produits} produit${j.produits > 1 ? "s" : ""} et ${j.meps} préparation${j.meps > 1 ? "s" : ""} rangés · ` +
        `${j.creees} rayon${j.creees > 1 ? "s" : ""} créé${j.creees > 1 ? "s" : ""}, ${j.retirees} retiré${j.retirees > 1 ? "s" : ""}.`
      );
      setPlan(null); setOuvert(false);
      router.refresh();
    } catch (e: any) {
      setErreur(e?.message ?? "Rangement impossible");
    } finally {
      setApplication(false);
    }
  }

  const total = plan
    ? plan.produits.deplacements.length + plan.meps.deplacements.length +
      (["ingredient", "prep", "menu"] as const).reduce(
        (s, t) => s + plan.categories[t].aCreer.length + plan.categories[t].aRetirer.length, 0)
    : 0;

  return (
    <div className="glass-card rounded-2xl p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-tertiary-fixed flex items-center justify-center text-primary shrink-0">
          <Wand2 size={17} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-sm font-bold text-on-surface">Ranger mon catalogue</h2>
          <p className="text-xs text-on-surface-variant/70">
            Met chaque produit et chaque préparation dans le bon rayon, et retire les rayons d&apos;exemple
            que personne n&apos;utilise. Rien n&apos;est écrit avant que tu aies lu le détail.
          </p>
        </div>
        <button onClick={verifier} disabled={chargement || application}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition disabled:opacity-50">
          {chargement ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {plan ? "Revérifier" : "Vérifier mon classement"}
        </button>
      </div>

      {erreur && <p className="mt-3 text-sm text-red bg-red-light border border-red/20 rounded-xl px-3 py-2">{erreur}</p>}
      {fait && (
        <p className="mt-3 text-sm text-primary bg-emerald-50 border border-primary/15 rounded-xl px-3 py-2 flex items-center gap-2">
          <Check size={15} /> {fait}
        </p>
      )}

      {plan && (
        <div className="mt-4 border-t border-outline-variant/20 pt-3">
          {total === 0 ? (
            <p className="text-sm text-on-surface-variant/70">
              Rien à ranger : chaque produit et chaque préparation est déjà dans un rayon qui existe.
            </p>
          ) : (
            <>
              <button onClick={() => setOuvert(!ouvert)} className="flex items-center gap-1.5 text-sm font-semibold text-on-surface mb-2">
                {ouvert ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {total} changement{total > 1 ? "s" : ""} proposé{total > 1 ? "s" : ""}
              </button>

              {ouvert && (
                <div className="space-y-4 text-sm">
                  {[
                    { titre: "Produits à ranger", d: plan.produits.deplacements, nr: plan.produits.nonReconnus },
                    { titre: "Préparations à ranger", d: plan.meps.deplacements, nr: plan.meps.nonReconnus },
                  ].map(({ titre, d, nr }) => (d.length > 0 || nr.length > 0) && (
                    <div key={titre}>
                      <p className="text-2xs font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1.5">
                        {titre} ({d.length})
                      </p>
                      <div className="space-y-1">
                        {parArrivee(d).map(([rayon, noms]) => (
                          <div key={rayon} className="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-2xs font-bold uppercase tracking-wide shrink-0">
                              {rayon}
                            </span>
                            <span className="text-xs text-on-surface-variant/70">{noms.join(" · ")}</span>
                          </div>
                        ))}
                      </div>
                      {nr.length > 0 && (
                        <p className="text-xs text-on-surface-variant/50 mt-1.5">
                          Non reconnus, à ranger à la main : {nr.map((n) => n.nom).join(", ")}.
                        </p>
                      )}
                    </div>
                  ))}

                  {(["ingredient", "prep", "menu"] as const).map((t) => {
                    const p = plan.categories[t];
                    if (p.aCreer.length === 0 && p.aRetirer.length === 0) return null;
                    return (
                      <div key={t}>
                        <p className="text-2xs font-bold uppercase tracking-wider text-on-surface-variant/50 mb-1.5">
                          Rayons — {TITRES[t]}
                        </p>
                        {p.aCreer.length > 0 && (
                          <p className="text-xs text-on-surface-variant/70">
                            <b className="text-primary">À créer :</b> {p.aCreer.map((c) => c.name).join(" · ")}
                          </p>
                        )}
                        {p.aRetirer.map((c) => (
                          <p key={c.id} className="text-xs text-on-surface-variant/70">
                            <b className="text-amber-dark">À retirer :</b> {c.name}{" "}
                            <span className="text-on-surface-variant/45">— {c.raison}</span>
                          </p>
                        ))}
                      </div>
                    );
                  })}

                  <div className="flex items-center gap-3 pt-1">
                    <button onClick={appliquer} disabled={application}
                      className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-50">
                      {application ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      Appliquer
                    </button>
                    <span className="text-xs text-on-surface-variant/50">
                      Aucun produit n&apos;est supprimé ni renommé — seul son rayon change.
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
