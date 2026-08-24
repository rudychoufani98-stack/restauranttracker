"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Trash2, Plus, Loader2, Check, X, Clock, TrendingDown, Search, Package, Soup, ChefHat } from "lucide-react";
import clsx from "clsx";
import { eur } from "@/lib/format";
import type { IngRow, RecipeRow } from "@/lib/costing";
import {
  construireCibles, chercheCibles, grouperParType, decomposePerte,
  grouperPertes, chercheDansHistorique,
  TYPE_LABEL, TYPE_LABEL_UN, type Cible, type CibleType, type IngredientCible, type RecetteCible,
  type MouvementPerte,
} from "@/lib/loss-targets";
import { useConfirm, useAlert } from "@/components/ConfirmDialog";

type Ingredient = IngredientCible & { stock_qty: number | null };
type Recette = RecetteCible;

const REASONS = [
  "DLC dépassée",
  "DLC OK mais tourne",
  "Casse",
  "Erreur cuisine",
  "Offert / geste commercial",
  "Vol / inconnu",
];

const REASON_COLORS: Record<string, string> = {
  "DLC dépassée": "bg-error-container text-red",
  "DLC OK mais tourne": "bg-amber-light text-amber-dark",
  "Casse": "bg-red-light text-red",
  "Erreur cuisine": "bg-secondary-container text-secondary",
  "Offert / geste commercial": "bg-blue-light text-blue",
  "Vol / inconnu": "bg-surface-container text-on-surface-variant",
};
const REASON_BAR: Record<string, string> = {
  "DLC dépassée": "bg-red",
  "DLC OK mais tourne": "bg-amber",
  "Casse": "bg-red/70",
  "Erreur cuisine": "bg-secondary",
  "Offert / geste commercial": "bg-blue",
  "Vol / inconnu": "bg-on-surface-variant/40",
};

const TYPE_ICONE: Record<CibleType, typeof Package> = {
  produit: Package,
  mep: Soup,
  recette: ChefHat,
};
const TYPE_PASTILLE: Record<CibleType, string> = {
  produit: "bg-tertiary-fixed text-primary",
  mep: "bg-amber-light text-amber-dark",
  recette: "bg-blue-light text-blue-dark",
};

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  recipes: Recette[];
  recentLosses: MouvementPerte[];
  monthLosses?: MouvementPerte[];
  /** false tant que supabase/perte_recette.sql n'a pas été exécuté. */
  migrationFaite?: boolean;
}

export default function PertesClient({
  restaurantId, ingredients, recipes, recentLosses, monthLosses, migrationFaite = true,
}: Props) {
  const confirm = useConfirm();
  const notify = useAlert();
  const supabase = createClient();
  const router = useRouter();

  const [losses, setLosses] = useState<MouvementPerte[]>(recentLosses);
  const [monthRows, setMonthRows] = useState<MouvementPerte[]>(monthLosses ?? recentLosses);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sélection de ce qui est perdu : recherche + choix
  const [recherche, setRecherche] = useState("");
  const [cibleId, setCibleId] = useState("");
  const champRecherche = useRef<HTMLInputElement>(null);

  // Recherche dans l'historique
  const [histoRecherche, setHistoRecherche] = useState("");
  const [histoType, setHistoType] = useState<CibleType | "tous">("tous");

  const ingMap = useMemo(() => new Map<string, IngRow>(ingredients.map((i) => [i.id, i as IngRow])), [ingredients]);
  const recipeMap = useMemo(() => new Map<string, RecipeRow>(recipes.map((r) => [r.id, r as RecipeRow])), [recipes]);
  const cibles = useMemo(() => construireCibles(ingredients, recipes), [ingredients, recipes]);
  const cibleMap = useMemo(() => new Map(cibles.map((c) => [c.id, c])), [cibles]);
  const cible = cibleId ? cibleMap.get(cibleId) ?? null : null;

  const resultats = useMemo(() => grouperParType(chercheCibles(cibles, recherche)), [cibles, recherche]);
  const nbResultats = resultats.reduce((s, g) => s + g.items.length, 0);

  // Le champ de recherche prend le focus à l'ouverture : on tape directement.
  useEffect(() => { if (showForm) champRecherche.current?.focus(); }, [showForm]);

  function fmtQty(baseQty: number, ingredientId: string) {
    const unit = ingMap.get(ingredientId)?.unit ?? "unit";
    const n = (x: number) => Number(x.toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
    if (unit === "kg" || unit === "g") return `${n(baseQty / 1000)} kg`;
    if (unit === "l" || unit === "ml") return `${n(baseQty / 1000)} L`;
    return `${n(baseQty)} pce`;
  }

  const infoRecette = (id: string) => {
    const r = recipes.find((x) => x.id === id);
    return r
      ? { nom: r.name, unite: r.yield_unit === "kg" ? "kg" : r.yield_unit === "l" ? "L" : r.yield_unit, mep: !!r.is_prep }
      : undefined;
  };

  // ── Historique regroupé (une perte de MEP = UNE ligne) ─────────────
  const historique = useMemo(
    () => grouperPertes(losses, (id) => ingredients.find((i) => i.id === id)?.name, fmtQty, infoRecette),
    [losses, ingredients, recipes],
  );
  const historiqueVu = useMemo(() => {
    const parType = histoType === "tous" ? historique : historique.filter((p) => p.type === histoType);
    return chercheDansHistorique(parType, histoRecherche);
  }, [historique, histoType, histoRecherche]);

  const compteType = (t: CibleType) => historique.filter((p) => p.type === t).length;

  // ── Totaux du mois ────────────────────────────────────────────────
  const monthKey = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => {
    const thisMonth = monthRows.filter((l) => l.created_at.slice(0, 7) === monthKey);
    const total = thisMonth.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost ?? 0), 0);
    const byReason = new Map<string, number>();
    for (const l of thisMonth) {
      const r = l.loss_reason ?? "Autre";
      byReason.set(r, (byReason.get(r) ?? 0) + Number(l.qty) * Number(l.unit_cost ?? 0));
    }
    // Le nombre d'ENREGISTREMENTS compte les pertes vécues, pas les
    // mouvements : jeter une sauce faite de six ingrédients, c'est une perte.
    const cles = new Set(thisMonth.map((l) => (l.reference_id ? `g:${l.reference_id}` : `m:${l.id}`)));
    return { total, byReason, count: cles.size };
  }, [monthRows, monthKey]);

  function resetForm() {
    setCibleId(""); setRecherche(""); setQty(""); setReason(REASONS[0]); setNote(""); setError(null);
  }

  // ── Enregistrement ────────────────────────────────────────────────
  async function handleSave() {
    setError(null);
    if (!cible) return setError("Choisis ce qui a été perdu.");
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return setError("Quantité invalide.");

    const { lignes, cout } = decomposePerte(cible, q, recipeMap, ingMap);
    if (lignes.length === 0) {
      return setError(
        cible.type === "produit"
          ? "Ce produit n'a pas de fiche exploitable."
          : "Cette fiche technique n'a aucun ingrédient : rien ne peut sortir du stock.",
      );
    }
    if (cible.type !== "produit" && !migrationFaite) {
      return setError(
        "Les pertes de mise en place et de fiche technique demandent une mise à jour de la base : " +
        "exécute supabase/perte_recette.sql dans Supabase, puis recharge la page.",
      );
    }

    // Quantité supérieure au stock : le stock serait bloqué à 0 alors que le
    // mouvement enregistrerait toute la valeur → écart inexplicable ensuite.
    const depassements = lignes
      .map((l) => ({ l, ing: ingredients.find((i) => i.id === l.ingredient_id)! }))
      .filter(({ l, ing }) => l.baseQty > Number(ing?.stock_qty ?? 0));
    if (depassements.length > 0) {
      const liste = depassements.map(({ l, ing }) =>
        `• ${ing.name} : ${fmtQty(l.baseQty, ing.id)} demandés, ${fmtQty(Number(ing.stock_qty ?? 0), ing.id)} en stock`).join("\n");
      const ok = (await confirm(
        `La perte dépasse le stock enregistré :\n\n${liste}\n\n` +
        "Le stock sera mis à 0 pour ces produits. Continuer quand même ? (Vérifie plutôt la quantité, ou fais un inventaire.)",
      ));
      if (!ok) return;
    }

    const detail = cible.type === "produit"
      ? `${cible.nom} — ${q} ${cible.unite}`
      : `${cible.nom} (${cible.type === "mep" ? "mise en place" : "fiche technique"}) — ${q} ${cible.unite}\n` +
        `Sortiront du stock : ${lignes.map((l) => `${ingredients.find((i) => i.id === l.ingredient_id)?.name} ${fmtQty(l.baseQty, l.ingredient_id)}`).join(", ")}`;
    if (!(await confirm(`Enregistrer cette perte ?\n\n${detail}\n${eur(cout)}\n\nLe stock sera diminué immédiatement.`))) return;

    setSaving(true);

    // Un identifiant de groupe relie les mouvements d'une même perte : c'est
    // lui qui permet de réafficher « Sauce tomate — 2 kg » et de tout annuler
    // d'un coup.
    const groupe = cible.type === "produit" ? null : crypto.randomUUID();
    const base = {
      restaurant_id: restaurantId,
      movement_type: "loss" as const,
      reference_type: "loss" as const,
      loss_reason: reason,
      notes: note || null,
    };
    const payload = lignes.map((l) => ({
      ...base,
      ingredient_id: l.ingredient_id,
      qty: l.baseQty,
      unit_cost: l.unitCost,
      reference_id: groupe,
      ...(cible.type === "produit" ? {} : { recipe_id: cible.id, recipe_qty: q }),
    }));

    const { data: movs, error: movErr } = await supabase.from("stock_movements").insert(payload).select();
    if (movErr || !movs) {
      setError(`Erreur lors de l'enregistrement de la perte : ${movErr?.message ?? "inconnue"}`);
      setSaving(false);
      return;
    }

    // Mise à jour des stocks, une par ingrédient. Si l'une échoue, on remet
    // les précédentes et on retire les mouvements : jamais de demi-perte.
    const faits: { id: string; avant: number }[] = [];
    for (const l of lignes) {
      const ing = ingredients.find((i) => i.id === l.ingredient_id)!;
      const avant = Number(ing.stock_qty ?? 0);
      const apres = Math.max(0, avant - l.baseQty);
      const { error: upErr } = await supabase.from("ingredients").update({ stock_qty: apres }).eq("id", l.ingredient_id);
      if (upErr) {
        for (const f of faits) await supabase.from("ingredients").update({ stock_qty: f.avant }).eq("id", f.id);
        await supabase.from("stock_movements").delete().in("id", movs.map((m: any) => m.id));
        setError(`Erreur lors de la mise à jour du stock : ${upErr.message}. Rien n'a été enregistré.`);
        setSaving(false);
        return;
      }
      faits.push({ id: l.ingredient_id, avant });
      ing.stock_qty = apres;
    }

    setLosses((prev) => [...(movs as MouvementPerte[]), ...prev]);
    setMonthRows((prev) => [...(movs as MouvementPerte[]), ...prev]);
    router.refresh();
    setSaving(false);
    setShowForm(false);
    resetForm();
  }

  // ── Annulation ────────────────────────────────────────────────────
  async function handleDelete(p: ReturnType<typeof grouperPertes>[number]) {
    if (p.mouvements.some((m) => !m.id)) {
      notify("Cette perte vient d'être enregistrée : recharge la page pour pouvoir l'annuler.");
      return;
    }
    if (p.inventaire) {
      notify(
        "Cet écart provient d'une fiche d'inventaire finalisée : il ne peut pas être annulé ici.\n\n" +
        "Pour corriger, refais une prise d'inventaire avec les bonnes quantités.",
      );
      return;
    }
    const ok = (await confirm(
      `Annuler cette perte ?\n\n${p.nom} — ${p.quantite} · ${eur(p.cout)}\n\n` +
      "Les quantités seront REMISES en stock et la perte disparaîtra de l'historique.",
    ));
    if (!ok) return;

    setDeletingKey(p.cle);
    setError(null);

    // Stock relu juste avant : il a pu bouger depuis l'affichage.
    const remis: { id: string; avant: number }[] = [];
    for (const m of p.mouvements) {
      const { data: cur, error: readErr } = await supabase
        .from("ingredients").select("stock_qty").eq("id", m.ingredient_id).maybeSingle();
      if (readErr || !cur) {
        for (const r of remis) await supabase.from("ingredients").update({ stock_qty: r.avant }).eq("id", r.id);
        setDeletingKey(null);
        setError(`Annulation impossible : ${readErr?.message ?? "produit introuvable"}. Rien n'a été modifié.`);
        return;
      }
      const avant = Number(cur.stock_qty ?? 0);
      const { error: upErr } = await supabase
        .from("ingredients").update({ stock_qty: avant + Number(m.qty) }).eq("id", m.ingredient_id);
      if (upErr) {
        for (const r of remis) await supabase.from("ingredients").update({ stock_qty: r.avant }).eq("id", r.id);
        setDeletingKey(null);
        setError(`Remise en stock impossible : ${upErr.message}. La perte n'a pas été annulée.`);
        return;
      }
      remis.push({ id: m.ingredient_id, avant });
    }

    const ids = p.mouvements.map((m) => m.id!).filter(Boolean);
    const { error: delErr } = await supabase.from("stock_movements").delete().in("id", ids);
    if (delErr) {
      for (const r of remis) await supabase.from("ingredients").update({ stock_qty: r.avant }).eq("id", r.id);
      setDeletingKey(null);
      setError(`Annulation impossible : ${delErr.message}. Rien n'a été modifié.`);
      return;
    }

    for (const r of remis) {
      const ing = ingredients.find((i) => i.id === r.id);
      const m = p.mouvements.find((x) => x.ingredient_id === r.id);
      if (ing && m) ing.stock_qty = r.avant + Number(m.qty);
    }
    const set = new Set(ids);
    setLosses((prev) => prev.filter((x) => !x.id || !set.has(x.id)));
    setMonthRows((prev) => prev.filter((x) => !x.id || !set.has(x.id)));
    setDeletingKey(null);
    router.refresh();
  }

  // ── Rendu ─────────────────────────────────────────────────────────
  const apercu = cible && qty && !isNaN(parseFloat(qty))
    ? decomposePerte(cible, parseFloat(qty), recipeMap, ingMap)
    : null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Pertes &amp; gaspillage</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">
            Un produit, une mise en place ou un plat — chaque perte sort du stock et est valorisée au CMUP.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg hover:nav-active-glow active:scale-[0.98]"
        >
          <Plus size={15} /> Enregistrer une perte
        </button>
      </div>

      {!migrationFaite && (
        <div className="mb-6 rounded-2xl border border-amber/30 bg-amber-light px-5 py-4 text-sm text-amber-dark">
          Pour déclarer la perte d&apos;une mise en place ou d&apos;une fiche technique, exécute
          <strong> supabase/perte_recette.sql</strong> dans Supabase (SQL Editor), puis recharge la page.
          Les pertes de produits fonctionnent normalement en attendant.
        </div>
      )}

      {/* Totaux du mois */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-red">
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Pertes ce mois</span>
            <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center text-red"><TrendingDown size={18} /></div>
          </div>
          <div>
            <h3 className="text-2xl font-extrabold text-red tabular-nums">{eur(summary.total)}</h3>
            <p className="text-2xs text-on-surface-variant/60 mt-1">{summary.count} perte{summary.count !== 1 ? "s" : ""} enregistrée{summary.count !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="md:col-span-2 glass-card rounded-2xl p-5">
          <p className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60 mb-4">Répartition par cause (ce mois)</p>
          {summary.byReason.size === 0 ? (
            <p className="text-sm text-on-surface-variant/50">Aucune perte enregistrée ce mois.</p>
          ) : (() => {
            const rows = Array.from(summary.byReason.entries()).sort((a, b) => b[1] - a[1]);
            const max = Math.max(...rows.map(([, v]) => v), 0);
            return (
              <div className="space-y-3">
                {rows.map(([r, val]) => (
                  <div key={r} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className={clsx("inline-flex px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", REASON_COLORS[r] ?? "bg-surface-container text-on-surface-variant")}>{r}</span>
                      <span className="font-bold text-on-surface tabular-nums">{eur(val)}</span>
                    </div>
                    <div className="w-full bg-surface-container-highest rounded-full h-2">
                      <div className={clsx("h-full rounded-full transition-all", REASON_BAR[r] ?? "bg-on-surface-variant/40")}
                        style={{ width: `${max > 0 ? (val / max) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Formulaire */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/30">
              <h2 className="text-base font-semibold text-on-surface">Nouvelle perte</h2>
              <button onClick={() => setShowForm(false)} title="Fermer" aria-label="Fermer" className="text-on-surface-variant/40 hover:text-on-surface transition"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {error && <div className="text-sm text-red bg-error-container border border-red/20 rounded-xl px-3 py-2 whitespace-pre-line">{error}</div>}

              {/* Ce qui a été perdu */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Qu&apos;est-ce qui a été perdu ?</label>

                {cible ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary-container/60 border border-primary/20">
                    <Pastille type={cible.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{cible.nom}</p>
                      <p className="text-2xs text-on-surface-variant/70">
                        {TYPE_LABEL_UN[cible.type]} · {eur(cible.coutUnitaire)}/{cible.unite}
                        {cible.stock !== null && ` · stock ${cible.stock.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ${cible.unite}`}
                      </p>
                    </div>
                    <button
                      onClick={() => { setCibleId(""); setRecherche(""); setTimeout(() => champRecherche.current?.focus(), 0); }}
                      className="text-2xs font-semibold text-primary hover:underline shrink-0"
                    >
                      Changer
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
                      <input
                        ref={champRecherche}
                        value={recherche}
                        onChange={(e) => setRecherche(e.target.value)}
                        placeholder="Chercher un produit, une mise en place, un plat…"
                        className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 outline-none focus:border-primary transition"
                      />
                    </div>

                    <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-outline-variant/30 divide-y divide-outline-variant/10">
                      {nbResultats === 0 ? (
                        <p className="text-sm text-on-surface-variant/60 px-3 py-6 text-center">
                          Rien ne correspond à « {recherche} ».
                        </p>
                      ) : (
                        resultats.map(({ type, items }) => (
                          <div key={type}>
                            <p className="sticky top-0 px-3 py-1.5 bg-surface-container-low/95 text-2xs font-bold uppercase tracking-wider text-outline">
                              {TYPE_LABEL[type]} · {items.length}
                            </p>
                            {items.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => setCibleId(c.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container-low transition text-left"
                              >
                                <Pastille type={c.type} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-on-surface truncate">{c.nom}</p>
                                  <p className="text-2xs text-on-surface-variant/60">
                                    {eur(c.coutUnitaire)}/{c.unite}
                                    {c.stock !== null && ` · stock ${c.stock.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ${c.unite}`}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Quantité */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Quantité perdue {cible ? `(en ${cible.unite})` : ""}
                </label>
                <input
                  type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
                  placeholder="ex. 2" disabled={!cible}
                  className="w-full px-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 outline-none focus:border-primary transition disabled:opacity-50"
                />
                {apercu && apercu.lignes.length > 0 && (
                  <div className="mt-2 rounded-xl bg-surface-container-low/60 px-3 py-2.5">
                    <p className="text-sm font-bold text-red">Coût de la perte : {eur(apercu.cout)}</p>
                    {cible && cible.type !== "produit" && (
                      <p className="text-2xs text-on-surface-variant/70 mt-1">
                        Sortira du stock :{" "}
                        {apercu.lignes.map((l) => `${ingredients.find((i) => i.id === l.ingredient_id)?.name} ${fmtQty(l.baseQty, l.ingredient_id)}`).join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Cause</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 outline-none focus:border-primary transition">
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Note (optionnel)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. fin de service"
                  className="w-full px-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 outline-none focus:border-primary transition" />
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-outline-variant/30">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">Annuler</button>
              <button onClick={handleSave} disabled={saving || !cible} className="flex-1 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container disabled:opacity-50 transition flex items-center justify-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historique */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60 flex items-center gap-2">
          <Clock size={14} className="text-on-surface-variant/40" /> Historique des pertes
        </h2>
        <div className="relative max-w-xs w-full">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
          <input
            value={histoRecherche}
            onChange={(e) => setHistoRecherche(e.target.value)}
            placeholder="Chercher dans l'historique…"
            aria-label="Chercher dans l'historique des pertes"
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 outline-none focus:border-primary transition"
          />
        </div>
      </div>

      {historique.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            { key: "tous" as const, label: "Tout", n: historique.length },
            { key: "produit" as const, label: TYPE_LABEL.produit, n: compteType("produit") },
            { key: "mep" as const, label: TYPE_LABEL.mep, n: compteType("mep") },
            { key: "recette" as const, label: TYPE_LABEL.recette, n: compteType("recette") },
          ]).map(({ key, label, n }) => (
            (n > 0 || key === "tous") && (
              <button
                key={key}
                onClick={() => setHistoType(key)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-xs font-semibold transition",
                  histoType === key ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-variant/50",
                )}
              >
                {label} · {n}
              </button>
            )
          ))}
        </div>
      )}

      {historiqueVu.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Trash2 size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant/70">
            {historique.length === 0
              ? "Aucune perte enregistrée. Utilise « Enregistrer une perte » pour commencer."
              : `Aucune perte ne correspond à ta recherche.`}
          </p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <tr>
                  {["Date", "Perdu", "Cause"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">{h}</th>
                  ))}
                  {["Quantité", "Coût", "Annuler"].map((h) => (
                    <th key={h} className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {historiqueVu.map((p) => (
                  <tr key={p.cle} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="px-5 py-4 text-sm text-on-surface-variant/80 whitespace-nowrap">
                      {new Date(p.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <Pastille type={p.type} petite />
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface truncate">{p.nom}</p>
                          {p.type !== "produit" && (
                            <span className="text-2xs text-on-surface-variant/50">
                              {p.type === "mep" ? "mise en place" : "fiche technique"} · {p.mouvements.length} ingrédient{p.mouvements.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {p.note && <span className="block text-2xs text-on-surface-variant/50">{p.note}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={clsx("inline-flex px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", REASON_COLORS[p.cause ?? ""] ?? "bg-surface-container text-on-surface-variant")}>{p.cause ?? "—"}</span>
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-on-surface-variant/80 tabular-nums whitespace-nowrap">{p.quantite}</td>
                    <td className="px-5 py-4 text-right text-sm font-bold text-red tabular-nums whitespace-nowrap">{eur(p.cout)}</td>
                    <td className="px-5 py-4 text-right">
                      {p.inventaire ? (
                        <span className="text-2xs text-on-surface-variant/40" title="Écart d'une fiche d'inventaire : corrige-le par un nouvel inventaire">inventaire</span>
                      ) : (
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={deletingKey === p.cle}
                          title="Annuler cette perte et remettre les quantités en stock"
                          aria-label="Annuler cette perte"
                          className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-red hover:bg-red-light transition disabled:opacity-40">
                          {deletingKey === p.cle ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 bg-surface-container-low/30 border-t border-outline-variant/20 text-sm text-on-surface-variant/60">
            {historiqueVu.length} perte{historiqueVu.length !== 1 ? "s" : ""}
            {historiqueVu.length !== historique.length && ` sur ${historique.length}`}
          </div>
        </div>
      )}
    </div>
  );
}

function Pastille({ type, petite }: { type: CibleType; petite?: boolean }) {
  const Icone = TYPE_ICONE[type];
  return (
    <div className={clsx(
      "rounded-lg flex items-center justify-center shrink-0",
      TYPE_PASTILLE[type],
      petite ? "w-7 h-7" : "w-9 h-9",
    )}>
      <Icone size={petite ? 14 : 17} />
    </div>
  );
}
