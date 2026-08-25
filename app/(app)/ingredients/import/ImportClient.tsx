"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Upload, Download, Loader2, Check, AlertTriangle, X, ArrowLeft,
  FileSpreadsheet, Plus, RefreshCw,
} from "lucide-react";
import { eur } from "@/lib/format";
import type { LigneAnalysee, Statut } from "@/lib/import-produits";

type Analyse = {
  manquantes: string[];
  manquantesLabels: string[];
  lignes: LigneAnalysee[];
  resume: { creer: number; mettre_a_jour: number; erreur: number; avertissements: number };
  nomFichier: string;
};

type Bilan = { crees: number; misAJour: number; echecs: { nom: string; raison: string }[] };

const STATUT: Record<Statut, { label: string; classe: string }> = {
  creer: { label: "Nouveau", classe: "bg-green-light text-green-dark" },
  mettre_a_jour: { label: "Mise à jour", classe: "bg-blue-light text-blue-dark" },
  erreur: { label: "Refusé", classe: "bg-red-light text-red" },
};

export default function ImportClient() {
  const router = useRouter();
  const champFichier = useRef<HTMLInputElement>(null);

  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [chargement, setChargement] = useState(false);
  const [ecriture, setEcriture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Statut | "tous">("tous");
  const [survol, setSurvol] = useState(false);

  async function envoie(fichier: File) {
    setChargement(true); setErreur(null); setAnalyse(null); setBilan(null);
    try {
      const fd = new FormData();
      fd.append("fichier", fichier);
      const res = await fetch("/api/import/produits", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setErreur(json?.error ?? "Analyse impossible. Réessaie."); return; }
      setAnalyse(json);
      setFiltre("tous");
    } catch {
      setErreur("Envoi interrompu (connexion). Réessaie.");
    } finally {
      setChargement(false);
    }
  }

  async function importe() {
    if (!analyse) return;
    setEcriture(true); setErreur(null);
    try {
      const res = await fetch("/api/import/produits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes: analyse.lignes }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setErreur(json?.error ?? "Import impossible."); return; }
      setBilan(json);
      setAnalyse(null);
      router.refresh();
    } catch {
      setErreur("Import interrompu (connexion). Vérifie tes produits avant de recommencer.");
    } finally {
      setEcriture(false);
    }
  }

  const aImporter = analyse ? analyse.resume.creer + analyse.resume.mettre_a_jour : 0;
  const lignesVues = analyse
    ? (filtre === "tous" ? analyse.lignes : analyse.lignes.filter((l) => l.statut === filtre))
    : [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/ingredients" className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant/70 hover:text-primary transition mb-4">
        <ArrowLeft size={15} /> Retour aux ingrédients
      </Link>

      <div className="mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Ma cuisine</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Importer des produits</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Dépose la mercuriale de ton fournisseur ou ton propre tableau. Rien n&apos;est enregistré avant que tu aies vu le récapitulatif.
        </p>
      </div>

      {erreur && (
        <div className="mb-4 text-sm text-red bg-error-container border border-red/20 rounded-xl px-4 py-3">{erreur}</div>
      )}

      {/* ── Bilan après import ─────────────────────────────────────── */}
      {bilan && (
        <div className="glass-card rounded-2xl p-6 mb-6 border-l-4 border-green">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-light text-green flex items-center justify-center shrink-0">
              <Check size={20} />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-on-surface">Import terminé</h2>
              <p className="text-sm text-on-surface-variant mt-1">
                {bilan.crees} produit{bilan.crees !== 1 ? "s" : ""} créé{bilan.crees !== 1 ? "s" : ""}
                {bilan.misAJour > 0 && `, ${bilan.misAJour} mis à jour`}.
              </p>
              {bilan.echecs.length > 0 && (
                <div className="mt-3 rounded-xl bg-error-container border border-red/20 px-4 py-3">
                  <p className="text-sm font-semibold text-red mb-1">
                    {bilan.echecs.length} produit{bilan.echecs.length !== 1 ? "s" : ""} n&apos;{bilan.echecs.length !== 1 ? "ont" : "a"} pas pu être enregistré{bilan.echecs.length !== 1 ? "s" : ""} :
                  </p>
                  <ul className="text-xs text-red-dark space-y-0.5">
                    {bilan.echecs.map((e, i) => <li key={i}>• {e.nom} — {e.raison}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <Link href="/ingredients" className="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition">
                  Voir mes produits
                </Link>
                <button onClick={() => { setBilan(null); champFichier.current?.click(); }}
                  className="px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                  Importer un autre fichier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Dépôt du fichier ───────────────────────────────────────── */}
      {!analyse && !bilan && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault(); setSurvol(false);
              const f = e.dataTransfer.files?.[0];
              if (f) envoie(f);
            }}
            className={clsx(
              "glass-card rounded-2xl border-2 border-dashed p-10 text-center transition",
              survol ? "border-primary bg-primary-container/30" : "border-outline-variant/40",
            )}
          >
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
              {chargement ? <Loader2 size={26} className="animate-spin" /> : <Upload size={26} />}
            </div>
            <p className="text-base font-semibold text-on-surface">
              {chargement ? "Lecture du fichier…" : "Dépose ton fichier ici"}
            </p>
            <p className="text-sm text-on-surface-variant/70 mt-1 mb-4">
              Excel (.xlsx) ou CSV, jusqu&apos;à 5 Mo
            </p>
            <input
              ref={champFichier}
              type="file"
              accept=".xlsx,.csv,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) envoie(f); e.target.value = ""; }}
            />
            <button
              onClick={() => champFichier.current?.click()}
              disabled={chargement}
              className="px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-50"
            >
              Choisir un fichier
            </button>
          </div>

          <div className="glass-card rounded-2xl p-5 mt-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <FileSpreadsheet size={19} />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-on-surface">Tu n&apos;as pas de fichier prêt ?</h2>
                <p className="text-sm text-on-surface-variant/70 mt-1 mb-3">
                  Télécharge le modèle : il contient deux exemples remplis et une feuille qui explique chaque colonne.
                </p>
                <a
                  href="/api/import/produits"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition"
                >
                  <Download size={15} /> Télécharger le modèle Excel
                </a>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant/50 mt-4">
              💡 Tu peux aussi envoyer le tableau du fournisseur tel quel : les colonnes sont reconnues par leur intitulé,
              dans n&apos;importe quel ordre. Il faut au minimum <strong>Nom</strong>, <strong>Unité</strong>,
              <strong> Taille unitaire</strong> et <strong>Prix HT</strong>.
            </p>
          </div>
        </>
      )}

      {/* ── Récapitulatif avant écriture ───────────────────────────── */}
      {analyse && (
        <>
          {analyse.manquantes.length > 0 ? (
            <div className="glass-card rounded-2xl p-6 border-l-4 border-red">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-base font-bold text-on-surface">Il manque des colonnes</h2>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Je n&apos;ai pas trouvé : <strong>{analyse.manquantesLabels.join(", ")}</strong>.
                  </p>
                  <p className="text-sm text-on-surface-variant/70 mt-2">
                    Renomme les colonnes de ton fichier, ou pars du modèle. Aucune donnée n&apos;a été touchée.
                  </p>
                  <button onClick={() => setAnalyse(null)}
                    className="mt-4 px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                    Choisir un autre fichier
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Chiffre valeur={analyse.resume.creer} libelle="à créer" icone={<Plus size={16} />} couleur="text-green" />
                <Chiffre valeur={analyse.resume.mettre_a_jour} libelle="à mettre à jour" icone={<RefreshCw size={16} />} couleur="text-blue-dark" />
                <Chiffre valeur={analyse.resume.erreur} libelle="refusées" icone={<X size={16} />} couleur={analyse.resume.erreur > 0 ? "text-red" : "text-on-surface-variant"} />
                <Chiffre valeur={analyse.resume.avertissements} libelle="à vérifier" icone={<AlertTriangle size={16} />} couleur={analyse.resume.avertissements > 0 ? "text-amber-dark" : "text-on-surface-variant"} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "tous" as const, label: "Toutes", n: analyse.lignes.length },
                    { key: "creer" as const, label: "Nouveaux", n: analyse.resume.creer },
                    { key: "mettre_a_jour" as const, label: "Mises à jour", n: analyse.resume.mettre_a_jour },
                    { key: "erreur" as const, label: "Refusées", n: analyse.resume.erreur },
                  ]).map(({ key, label, n }) => (
                    (n > 0 || key === "tous") && (
                      <button key={key} onClick={() => setFiltre(key)}
                        className={clsx(
                          "px-3 py-1.5 rounded-full text-xs font-semibold transition",
                          filtre === key ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-variant/50",
                        )}>
                        {label} · {n}
                      </button>
                    )
                  ))}
                </div>
                <p className="text-xs text-on-surface-variant/60">{analyse.nomFichier}</p>
              </div>

              <div className="glass-card rounded-2xl overflow-hidden mb-4">
                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-container-low/95 border-b border-outline-variant/20">
                      <tr>
                        <th className="px-4 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Ligne</th>
                        <th className="px-4 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Produit</th>
                        <th className="px-4 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Conditionnement</th>
                        <th className="px-4 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix HT</th>
                        <th className="px-4 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Coût unité</th>
                        <th className="px-4 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">État</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {lignesVues.map((l) => {
                        const p = l.produit;
                        const unite = p ? (p.unit === "kg" ? "kg" : p.unit === "l" ? "L" : "pce") : "";
                        const coutUnite = p ? p.cost_per_base_unit * (p.unit === "unit" ? 1 : 1000) : 0;
                        return (
                          <tr key={l.ligne} className={clsx(l.statut === "erreur" && "bg-error-container/30")}>
                            <td className="px-4 py-3 text-on-surface-variant/50 tabular-nums">{l.ligne}</td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-on-surface">{l.nom || <em className="text-on-surface-variant/50">sans nom</em>}</p>
                              {p && <p className="text-2xs text-on-surface-variant/60">{p.category}{p.fournisseur ? ` · ${p.fournisseur}` : ""}</p>}
                              {l.erreurs.map((e, i) => (
                                <p key={i} className="text-2xs text-red mt-0.5">✕ {e}</p>
                              ))}
                              {l.avertissements.map((a, i) => (
                                <p key={i} className="text-2xs text-amber-dark mt-0.5">⚠ {a}</p>
                              ))}
                            </td>
                            <td className="px-4 py-3 text-on-surface-variant/80 whitespace-nowrap">
                              {p ? `${p.pack_units} × ${p.unit_size} ${unite}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-on-surface-variant/80 tabular-nums whitespace-nowrap">
                              {p ? eur(p.pack_price) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-on-surface tabular-nums whitespace-nowrap">
                              {p ? <>{eur(coutUnite)}<span className="text-2xs text-on-surface-variant/50">/{unite}</span></> : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={clsx("inline-flex px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", STATUT[l.statut].classe)}>
                                {STATUT[l.statut].label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={importe}
                  disabled={ecriture || aImporter === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-50"
                >
                  {ecriture ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Importer {aImporter} produit{aImporter !== 1 ? "s" : ""}
                </button>
                <button
                  onClick={() => setAnalyse(null)}
                  disabled={ecriture}
                  className="px-5 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition disabled:opacity-50"
                >
                  Annuler
                </button>
                {analyse.resume.erreur > 0 && (
                  <p className="text-xs text-on-surface-variant/70">
                    Les {analyse.resume.erreur} ligne{analyse.resume.erreur !== 1 ? "s" : ""} refusée{analyse.resume.erreur !== 1 ? "s" : ""} {analyse.resume.erreur !== 1 ? "seront ignorées" : "sera ignorée"} — corrige-les dans ton fichier et relance un import.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Chiffre({ valeur, libelle, icone, couleur }: { valeur: number; libelle: string; icone: React.ReactNode; couleur: string }) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3.5">
      <div className={clsx("flex items-center gap-1.5", couleur)}>
        {icone}
        <span className="text-2xl font-extrabold tracking-tight tabular-nums">{valeur}</span>
      </div>
      <p className="text-xs text-on-surface-variant/70 mt-0.5">{libelle}</p>
    </div>
  );
}
