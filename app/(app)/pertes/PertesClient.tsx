"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Trash2, Plus, Loader2, Check, X, Clock, TrendingDown } from "lucide-react";
import clsx from "clsx";

type Ingredient = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock_qty: number | null;
  cmup: number | null;
  cost_per_base_unit: number | null;
};

type Loss = {
  ingredient_id: string;
  qty: number;
  unit_cost: number | null;
  loss_reason: string | null;
  notes: string | null;
  created_at: string;
};

const REASONS = [
  "DLC dépassée",
  "DLC OK mais tourne",
  "Casse",
  "Erreur cuisine",
  "Offert / geste commercial",
  "Vol / inconnu",
];

// Glass cause-pill styling per reason, using only tokens that exist in this app.
const REASON_COLORS: Record<string, string> = {
  "DLC dépassée": "bg-error-container text-red",
  "DLC OK mais tourne": "bg-amber-light text-amber-dark",
  "Casse": "bg-red-light text-red",
  "Erreur cuisine": "bg-secondary-container text-secondary",
  "Offert / geste commercial": "bg-blue-light text-blue",
  "Vol / inconnu": "bg-surface-container text-on-surface-variant",
};
// Accent bar color for the "Répartition par cause" glass bars.
const REASON_BAR: Record<string, string> = {
  "DLC dépassée": "bg-red",
  "DLC OK mais tourne": "bg-amber",
  "Casse": "bg-red/70",
  "Erreur cuisine": "bg-secondary",
  "Offert / geste commercial": "bg-blue",
  "Vol / inconnu": "bg-on-surface-variant/40",
};

// Convert a quantity in the ingredient's purchase unit to base units (g/ml/unit)
function toBase(qty: number, unit: string): number {
  if (unit === "kg" || unit === "l") return qty * 1000;
  return qty;
}

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  recentLosses: Loss[];
}

export default function PertesClient({ restaurantId, ingredients, recentLosses }: Props) {
  const supabase = createClient();
  const [losses, setLosses] = useState<Loss[]>(recentLosses);
  const [showForm, setShowForm] = useState(false);
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const selected = ingredientId ? ingMap.get(ingredientId) : null;

  // This-month summary
  const monthKey = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => {
    const thisMonth = losses.filter((l) => l.created_at.slice(0, 7) === monthKey);
    const total = thisMonth.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost ?? 0), 0);
    const byReason = new Map<string, number>();
    for (const l of thisMonth) {
      const r = l.loss_reason ?? "Autre";
      byReason.set(r, (byReason.get(r) ?? 0) + Number(l.qty) * Number(l.unit_cost ?? 0));
    }
    return { total, byReason, count: thisMonth.length };
  }, [losses, monthKey]);

  function resetForm() {
    setIngredientId(""); setQty(""); setReason(REASONS[0]); setNote(""); setError(null);
  }

  async function handleSave() {
    setError(null);
    if (!ingredientId) return setError("Choisis un ingrédient.");
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return setError("Quantité invalide.");
    const ing = ingMap.get(ingredientId)!;

    setSaving(true);
    const baseQty = toBase(q, ing.unit);
    const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
    const currentStock = Number(ing.stock_qty ?? 0);
    const newStock = Math.max(0, currentStock - baseQty);

    const { error: upErr } = await supabase
      .from("ingredients")
      .update({ stock_qty: newStock })
      .eq("id", ingredientId);
    if (upErr) { setError("Erreur lors de la mise à jour du stock."); setSaving(false); return; }

    const { error: movErr } = await supabase.from("stock_movements").insert({
      restaurant_id: restaurantId,
      ingredient_id: ingredientId,
      movement_type: "loss",
      qty: baseQty,
      unit_cost: cmup,
      reference_type: "loss",
      loss_reason: reason,
      notes: note || null,
    });
    if (movErr) { setError("Erreur lors de l'enregistrement de la perte."); setSaving(false); return; }

    // Update local state
    ing.stock_qty = newStock;
    setLosses((prev) => [
      { ingredient_id: ingredientId, qty: baseQty, unit_cost: cmup, loss_reason: reason, notes: note || null, created_at: new Date().toISOString() },
      ...prev,
    ]);
    setSaving(false);
    setShowForm(false);
    resetForm();
  }

  function fmtQty(baseQty: number, unit: string) {
    const n = (x: number) => Number(x.toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
    if (unit === "kg" || unit === "g") return `${n(baseQty / 1000)} kg`;
    if (unit === "l" || unit === "ml") return `${n(baseQty / 1000)} L`;
    return `${n(baseQty)} ${unit === "unit" ? "u" : unit}`;
  }
  const displayUnitLabel = (u: string) => (u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "L" : u === "unit" ? "u" : u);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Pertes & gaspillage</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">Chaque perte sort du stock et est valorisée au CMUP.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg hover:nav-active-glow active:scale-[0.98]"
        >
          <Plus size={15} /> Enregistrer une perte
        </button>
      </div>

      {/* Summary — all derived from live losses (real numbers only) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-red">
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Pertes ce mois</span>
            <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center text-red"><TrendingDown size={18} /></div>
          </div>
          <div>
            <h3 className="text-2xl font-extrabold text-red tabular-nums">€{summary.total.toFixed(2)}</h3>
            <p className="text-2xs text-on-surface-variant/60 mt-1">{summary.count} enregistrement{summary.count !== 1 ? "s" : ""}</p>
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
                      <span className="font-bold text-on-surface tabular-nums">€{val.toFixed(2)}</span>
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

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">Nouvelle perte</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ingrédient</label>
                <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  <option value="">Choisir…</option>
                  {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                {selected && (
                  <p className="text-xs text-gray-400 mt-1">
                    Stock actuel : {fmtQty(Number(selected.stock_qty ?? 0), selected.unit)} · CMUP €{Number(selected.cmup ?? selected.cost_per_base_unit ?? 0).toFixed(4)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Quantité perdue {selected ? `(en ${displayUnitLabel(selected.unit)})` : ""}
                </label>
                <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
                  placeholder="ex. 2"
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                {selected && qty && !isNaN(parseFloat(qty)) && (
                  <p className="text-xs text-red-500 mt-1">
                    Coût de la perte : €{(toBase(parseFloat(qty), selected.unit) * Number(selected.cmup ?? selected.cost_per_base_unit ?? 0)).toFixed(2)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cause</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Note (optionnel)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. fin de service"
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition flex items-center justify-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent losses */}
      <h2 className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60 mb-3 flex items-center gap-2">
        <Clock size={14} className="text-on-surface-variant/40" /> Historique des pertes
      </h2>
      {losses.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Trash2 size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant/70">Aucune perte enregistrée. Utilise « Enregistrer une perte » pour commencer.</p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <tr>
                  <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Date</th>
                  <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Ingrédient</th>
                  <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Cause</th>
                  <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Quantité</th>
                  <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Coût</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {losses.map((l, i) => {
                  const ing = ingMap.get(l.ingredient_id);
                  const cost = Number(l.qty) * Number(l.unit_cost ?? 0);
                  return (
                    <tr key={i} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="px-5 py-4 text-sm text-on-surface-variant/80 whitespace-nowrap">{new Date(l.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</td>
                      <td className="px-5 py-4 font-semibold text-on-surface">{ing?.name ?? "—"}{l.notes && <span className="block text-2xs text-on-surface-variant/50 font-normal">{l.notes}</span>}</td>
                      <td className="px-5 py-4">
                        <span className={clsx("inline-flex px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", REASON_COLORS[l.loss_reason ?? ""] ?? "bg-surface-container text-on-surface-variant")}>{l.loss_reason ?? "—"}</span>
                      </td>
                      <td className="px-5 py-4 text-right text-sm text-on-surface-variant/80 tabular-nums whitespace-nowrap">{ing ? fmtQty(Number(l.qty), ing.unit) : Number(l.qty).toFixed(0)}</td>
                      <td className="px-5 py-4 text-right text-sm font-bold text-red tabular-nums whitespace-nowrap">€{cost.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 bg-surface-container-low/30 border-t border-outline-variant/20 text-sm text-on-surface-variant/60">
            {losses.length} perte{losses.length !== 1 ? "s" : ""} enregistrée{losses.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
