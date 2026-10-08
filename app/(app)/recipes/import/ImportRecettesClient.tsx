"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Upload, Download, Loader2, Check, AlertTriangle, X, ArrowLeft,
  FileSpreadsheet, Plus, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";
import type { FicheAnalysee } from "@/lib/import-recettes";

type Analyse = {
  manquantes: string[];
  manquantesLabels: string[];
  fiches: FicheAnalysee[];
  resume: { fiches: number; fiches_creer: number; lignes: number; erreur: number; remplacees: number };
  nomFichier: string;
};

type Bilan = { creees: number; misesAJour: number; lignesEcrites: number; echecs: string[] };

export default function ImportRecettesClient() {
  const router = useRouter();
  const champFichier = useRef<HTMLInputElement>(null);

  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [chargement, setChargement] = useState(false);
  const [ecriture, setEcriture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

  async function envoie(fichier: File) {
    setChargement(true); setErreur(null); setAnalyse(null); setBilan(null);
    try {
      const fd = new FormData();
      fd.append("fichier", fichier);
      const res = await fetch("/api/import/recettes", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setErreur(json?.error ?? "Analyse impossible. Réessaie."); return; }
      setAnalyse(json);
      // Les fiches en erreur s'ouvrent d'office : c'est ce qu'il faut regarder.
      setOuvertes(new Set((json.fiches ?? []).filter((f: FicheAnalysee) => f.erreurs > 0).map((f: FicheAnalysee) => f.nom)));
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
      const res = await fetch("/api/import/recettes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiches: analyse.fiches }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setErreur(json?.error ?? "Import impossible."); return; }
      setBilan(json);
      setAnalyse(null);
      router.refresh();
    } catch {
      setErreur("Import interrompu (connexion). Vérifie tes fiches avant de recommencer.");
    } finally {
      setEcriture(false);
    }
  }

  const bascule = (nom: string) =>
    setOuvertes((p) => {
      const n = new Set(p);
      if (n.has(nom)) n.delete(nom); else n.add(nom);
      return n;
    });

  const exploitables = analyse
    ? analyse.fiches.filter((f) => f.nom !== "(sans fiche)" && f.lignes.some((l) => l.erreurs.length === 0)).length
    : 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/recipes" className="inline-flex items-center gap-2 text-sm text-on-surface-variant/70 hover:text-primary transition mb-4">
        <ArrowLeft size={15} /> Retour aux recettes
      </Link>

      <div className="mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Ma cuisine</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Importer des fiches techniques</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Une ligne par ingrédient. Rien n&apos;est écrit avant que tu valides le récapitulatif.
        </p>
      </div>

      {erreur && (
        <div className="flex items-start gap-3 bg-red-light border border-red/20 rounded-xl px-4 py-3 mb-4">
          <AlertTriangle size={17} className="text-red shrink-0 mt-0.5" />
          <p className="text-sm text-red flex-1">{erreur}</p>
          <button onClick={() => setErreur(null)} aria-label="Fermer" className="text-red/60 hover:text-red"><X size={15} /></button>
        </div>
      )}

      {/* ── Bilan ───────────────────────────────────────────────── */}
      {bilan && (
        <div className="glass-card rounded-2xl p-6 mb-4 border-l-4 border-primary">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Check size={20} /></div>
            <h2 className="text-lg font-semibold text-primary">Import terminé</h2>
          </div>
          <p className="text-sm text-on-surface-variant">
            <strong>{bilan.lignesEcrites}</strong> ligne{bilan.lignesEcrites !== 1 ? "s" : ""} écrite{bilan.lignesEcrites !== 1 ? "s" : ""} ·{" "}
            <strong>{bilan.misesAJour}</strong> fiche{bilan.misesAJour !== 1 ? "s" : ""} mise{bilan.misesAJour !== 1 ? "s" : ""} à jour ·{" "}
            <strong>{bilan.creees}</strong> créée{bilan.creees !== 1 ? "s" : ""}
          </p>
          {bilan.echecs.length > 0 && (
            <ul className="mt-3 space-y-1">
              {bilan.echecs.map((e, i) => <li key={i} className="text-xs text-red">• {e}</li>)}
            </ul>
          )}
          <p className="text-xs text-on-surface-variant/60 mt-3">
            Les coûts se recalculent à l&apos;ouverture de chaque fiche. Pour tout recalculer d&apos;un coup,
            utilise <strong>Tout recalculer</strong> sur la page Recettes.
          </p>
          <div className="flex gap-2 mt-4">
            <Link href="/recipes" className="px-4 py-2 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
              Voir mes fiches
            </Link>
            <button onClick={() => setBilan(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
              Importer un autre fichier
            </button>
          </div>
        </div>
      )}

      {/* ── Dépôt ───────────────────────────────────────────────── */}
      {!analyse && !bilan && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => { e.preventDefault(); setSurvol(false); const f = e.dataTransfer.files?.[0]; if (f) envoie(f); }}
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
            <p className="text-sm text-on-surface-variant/70 mt-1 mb-4">Excel (.xlsx) ou CSV, jusqu&apos;à 5 Mo</p>
            <input
              ref={champFichier} type="file" accept=".xlsx,.csv,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) envoie(f); e.target.value = ""; }}
            />
            <button
              onClick={() => champFichier.current?.click()} disabled={chargement}
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
                  Pars du modèle vierge, ou télécharge <strong>tes fiches actuelles</strong> pour les corriger en masse
                  et tout réimporter.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href="/api/import/recettes"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                    <Download size={15} /> Modèle vierge
                  </a>
                  <a href="/api/import/recettes?fiches=1"
                    title="Tes fiches actuelles, au format d’import"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
                    <Download size={15} /> Mes fiches actuelles
                  </a>
                </div>
              </div>
            </div>
            <div className="text-xs text-on-surface-variant/60 mt-4 space-y-1.5">
              <p>
                Colonnes attendues : <strong>Fiche</strong>, <strong>Composant</strong>, <strong>Quantité</strong>,
                <strong> Unité</strong> — dans n&apos;importe quel ordre, reconnues par leur intitulé.
              </p>
              <p className="text-amber-dark">
                ⚠️ Importer une fiche <strong>remplace</strong> ses ingrédients. Pour en ajouter un à une fiche
                déjà saisie, remets toutes ses lignes dans le fichier.
              </p>
              <p>
                Un composant doit déjà exister dans tes ingrédients ou tes mises en place — l&apos;import n&apos;en
                crée jamais. Pour les produits, passe par <Link href="/ingredients/import" className="underline">Ingrédients → Importer</Link>.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Récapitulatif ───────────────────────────────────────── */}
      {analyse && (
        <>
          {analyse.manquantes.length > 0 ? (
            <div className="glass-card rounded-2xl p-6 border-l-4 border-red">
              <h2 className="text-lg font-semibold text-red mb-2">Colonnes manquantes</h2>
              <p className="text-sm text-on-surface-variant">
                Il manque : <strong>{analyse.manquantesLabels.join(", ")}</strong>. Ajoute-les et réessaie.
              </p>
              <button onClick={() => setAnalyse(null)} className="mt-4 px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                Choisir un autre fichier
              </button>
            </div>
          ) : (
            <>
              <div className="glass-card rounded-2xl p-5 mb-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs text-on-surface-variant/60">{analyse.nomFichier}</p>
                    <h2 className="text-lg font-semibold text-on-surface">
                      {analyse.resume.fiches} fiche{analyse.resume.fiches !== 1 ? "s" : ""} ·{" "}
                      {analyse.resume.lignes} ligne{analyse.resume.lignes !== 1 ? "s" : ""}
                    </h2>
                  </div>
                  <div className="flex gap-4 text-sm tabular-nums">
                    <span className="text-primary"><Plus size={13} className="inline" /> {analyse.resume.fiches_creer} à créer</span>
                    <span className="text-on-surface-variant"><RefreshCw size={13} className="inline" /> {analyse.resume.remplacees} ligne{analyse.resume.remplacees !== 1 ? "s" : ""} remplacée{analyse.resume.remplacees !== 1 ? "s" : ""}</span>
                    {analyse.resume.erreur > 0 && <span className="text-red"><AlertTriangle size={13} className="inline" /> {analyse.resume.erreur} refusée{analyse.resume.erreur !== 1 ? "s" : ""}</span>}
                  </div>
                </div>

                {analyse.resume.remplacees > 0 && (
                  <p className="text-xs text-amber-dark bg-amber-light/60 rounded-lg px-3 py-2 mt-3">
                    {analyse.resume.remplacees} ligne{analyse.resume.remplacees !== 1 ? "s" : ""} déjà saisie{analyse.resume.remplacees !== 1 ? "s" : ""} {analyse.resume.remplacees !== 1 ? "seront effacées" : "sera effacée"} et remplacée{analyse.resume.remplacees !== 1 ? "s" : ""} par le contenu de ce fichier.
                  </p>
                )}
                {analyse.resume.erreur > 0 && (
                  <p className="text-xs text-red mt-2">
                    Les lignes refusées ne seront pas importées ; le reste de leur fiche le sera.
                  </p>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={importe}
                    disabled={ecriture || exploitables === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-50"
                  >
                    {ecriture ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {ecriture ? "Import en cours…" : `Importer ${exploitables} fiche${exploitables !== 1 ? "s" : ""}`}
                  </button>
                  <button onClick={() => setAnalyse(null)} disabled={ecriture}
                    className="px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition disabled:opacity-50">
                    Annuler
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {analyse.fiches.map((f) => {
                  const ouverte = ouvertes.has(f.nom);
                  return (
                    <div key={f.nom} className="glass-card rounded-xl overflow-hidden">
                      <button onClick={() => bascule(f.nom)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-low/50 transition">
                        {ouverte ? <ChevronDown size={15} className="text-on-surface-variant/50 shrink-0" /> : <ChevronRight size={15} className="text-on-surface-variant/50 shrink-0" />}
                        <span className="font-semibold text-on-surface flex-1 truncate">{f.nom}</span>
                        {f.estMep && <span className="px-2 py-0.5 text-2xs font-bold rounded bg-amber-light text-amber-dark uppercase">MEP</span>}
                        {!f.recetteId && f.nom !== "(sans fiche)" && (
                          <span className="px-2 py-0.5 text-2xs font-bold rounded bg-green-light text-green-dark uppercase">À créer</span>
                        )}
                        {f.lignesRemplacees > 0 && (
                          <span className="text-2xs text-on-surface-variant/60 whitespace-nowrap">{f.lignesRemplacees} remplacée{f.lignesRemplacees !== 1 ? "s" : ""}</span>
                        )}
                        {f.erreurs > 0 && (
                          <span className="px-2 py-0.5 text-2xs font-bold rounded bg-red-light text-red whitespace-nowrap">{f.erreurs} refusée{f.erreurs !== 1 ? "s" : ""}</span>
                        )}
                        <span className="text-2xs text-on-surface-variant/60 tabular-nums whitespace-nowrap">{f.lignes.length} ligne{f.lignes.length !== 1 ? "s" : ""}</span>
                      </button>

                      {ouverte && (
                        <div className="border-t border-outline-variant/30 px-4 py-3 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-2xs uppercase tracking-wide text-on-surface-variant/60">
                                <th className="text-left font-medium pb-2">Composant</th>
                                <th className="text-right font-medium pb-2">Quantité</th>
                                <th className="text-left font-medium pb-2 pl-3">Type</th>
                                <th className="text-left font-medium pb-2 pl-3">État</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.lignes.map((l, i) => (
                                <tr key={i} className="border-t border-outline-variant/15">
                                  <td className="py-1.5 text-on-surface">{l.composant || <span className="text-on-surface-variant/40">—</span>}</td>
                                  <td className="py-1.5 text-right tabular-nums text-on-surface-variant whitespace-nowrap">
                                    {l.quantite != null ? `${l.quantite} ${l.unite === "unit" ? "pce" : l.unite ?? ""}` : "—"}
                                  </td>
                                  <td className="py-1.5 pl-3 text-2xs text-on-surface-variant/70">
                                    {l.cible?.type === "ingredient" ? "Ingrédient" : l.cible?.type === "mep" ? "Mise en place" : l.cible ? "Fiche" : "—"}
                                  </td>
                                  <td className="py-1.5 pl-3">
                                    {l.erreurs.length > 0 ? (
                                      <span className="text-2xs text-red">{l.erreurs[0]}</span>
                                    ) : l.avertissements.length > 0 ? (
                                      <span className="text-2xs text-amber-dark">{l.avertissements[0]}</span>
                                    ) : (
                                      <span className="text-2xs text-primary">ligne {l.ligne} ✓</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
