"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Warehouse, TrendingDown, TrendingUp, AlertTriangle, Check, Loader2, History, ClipboardList, Trash2, Download } from "lucide-react";
import clsx from "clsx";

type Ingredient = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock_qty: number | null;
  cmup: number | null;
  cost_per_base_unit: number | null;
  pack_price: number | null;
  reorder_threshold?: number | null;
  suppliers?: { name: string } | null;
};

function baseUnitLabel(unit: string) {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}

function needsReorder(i: { stock_qty: number | null; reorder_threshold?: number | null }) {
  const stock = Number(i.stock_qty ?? 0);
  const threshold = Number(i.reorder_threshold ?? 0);
  return threshold > 0 ? stock <= threshold : stock <= 0;
}

type Movement = {
  ingredient_id: string;
  movement_type: "in" | "out" | "adjustment" | "loss";
  qty: number;
  unit_cost: number | null;
  reference_type: string;
  created_at: string;
};

type InventoryLine = {
  ingredient_id: string | null; ingredient_name: string | null; unit: string | null;
  theoretical_qty: number | null; counted_qty: number | null; ecart: number | null;
  cmup: number | null; ecart_value: number | null;
};
type InventorySession = {
  id: string; created_at: string; items_counted: number;
  manquant_value: number; surplus_value: number; net_value: number; notes: string | null;
  inventory_lines: InventoryLine[];
};

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  recentMovements: Movement[];
  inventorySessions: InventorySession[];
}

const UNIT_LABELS: Record<string, string> = {
  g: "g", kg: "g", ml: "ml", l: "ml", unit: "u", piece: "u",
};

// Pretty number: up to 3 decimals, no trailing zeros.
function fmtNum(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

// Always display stock in the imposed conditionnement (kg / L / pièce), never g/ml.
function formatQty(qty: number | null, unit: string): string {
  if (qty === null || qty === undefined) return "—";
  if (unit === "kg" || unit === "g") return `${fmtNum(qty / 1000)} kg`;
  if (unit === "l" || unit === "ml") return `${fmtNum(qty / 1000)} L`;
  return `${fmtNum(qty)} ${unit === "unit" ? "u" : unit}`;
}

// Friendly display unit label (kg / L / pièce).
function displayUnitLabel(unit: string): string {
  return unit === "g" || unit === "kg" ? "kg" : unit === "ml" || unit === "l" ? "L" : unit === "unit" ? "u" : unit;
}

// Convert a quantity in the ingredient's purchase unit to base units (g/ml/unit)
function toBase(qty: number, unit: string): number {
  if (unit === "kg" || unit === "l") return qty * 1000;
  return qty;
}

// User always types in the display unit (kg / L / pièce) → convert to base (g/ml/pièce).
function displayToBase(qty: number, unit: string): number {
  const isWeightVol = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return isWeightVol ? qty * 1000 : qty;
}

export default function InventaireClient({ restaurantId, ingredients, recentMovements, inventorySessions }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<"stock" | "count" | "sessions" | "history">("stock");
  const [sessions, setSessions] = useState<InventorySession[]>(inventorySessions);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [validatingCount, setValidatingCount] = useState(false);
  const [countDone, setCountDone] = useState<string | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [localIngredients, setLocalIngredients] = useState<Ingredient[]>(ingredients);
  const [filterCat, setFilterCat] = useState("Toutes");
  const [search, setSearch] = useState("");

  const categories = useMemo(() => {
    const cats = Array.from(new Set(ingredients.map((i) => i.category).filter(Boolean)));
    return ["Toutes", ...cats.sort()];
  }, [ingredients]);

  const filtered = useMemo(() => {
    return localIngredients.filter((i) => {
      const matchCat = filterCat === "Toutes" || i.category === filterCat;
      const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [localIngredients, filterCat, search]);

  const totalValue = useMemo(() => {
    return localIngredients.reduce((sum, i) => {
      const qty = Number(i.stock_qty ?? 0);
      const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
      return sum + qty * cmup;
    }, 0);
  }, [localIngredients]);

  const lowStockCount = localIngredients.filter(needsReorder).length;

  async function handleAdjust(ing: Ingredient) {
    const typed = parseFloat(adjustQty);
    if (isNaN(typed) || typed < 0) return;
    const newQty = displayToBase(typed, ing.unit); // user typed in kg/L → store base
    setSaving(true);

    const currentQty = Number(ing.stock_qty ?? 0);
    const diff = newQty - currentQty; // positive = ajout, negative = retrait
    const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);

    await supabase.from("ingredients").update({ stock_qty: newQty }).eq("id", ing.id);

    await supabase.from("stock_movements").insert({
      restaurant_id: restaurantId,
      ingredient_id: ing.id,
      movement_type: "adjustment",
      qty: Math.abs(diff),
      unit_cost: cmup,
      reference_type: "adjustment",
      notes: adjustNotes || `Inventaire: ${currentQty} → ${newQty}`,
    });

    setLocalIngredients((prev) =>
      prev.map((i) => i.id === ing.id ? { ...i, stock_qty: newQty } : i)
    );
    setAdjustId(null);
    setAdjustQty("");
    setAdjustNotes("");
    setSaving(false);
  }

  // ---- Prise d'inventaire (écart théorique vs réel) ----
  function countedBase(ing: Ingredient): number | null {
    const raw = counts[ing.id];
    if (raw === undefined || raw === "") return null;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) return null;
    return displayToBase(v, ing.unit);
  }

  const countSummary = useMemo(() => {
    let manque = 0; // valeur des écarts négatifs (stock réel < théorique)
    let surplus = 0;
    let counted = 0;
    for (const ing of localIngredients) {
      const real = countedBase(ing);
      if (real === null) continue;
      counted++;
      const theo = Number(ing.stock_qty ?? 0);
      const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const diff = real - theo;
      if (diff < 0) manque += Math.abs(diff) * cmup;
      else if (diff > 0) surplus += diff * cmup;
    }
    return { manque, surplus, counted, net: surplus - manque };
  }, [counts, localIngredients]);

  async function validateCount() {
    setValidatingCount(true);
    const movements: any[] = [];
    const updates: { id: string; qty: number }[] = [];
    const sessionLines: InventoryLine[] = [];

    for (const ing of localIngredients) {
      const real = countedBase(ing);
      if (real === null) continue;
      const theo = Number(ing.stock_qty ?? 0);
      const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const diff = real - theo;
      // Archive every counted line (even if no écart) for the inventory record
      sessionLines.push({
        ingredient_id: ing.id, ingredient_name: ing.name, unit: ing.unit,
        theoretical_qty: theo, counted_qty: real, ecart: diff, cmup, ecart_value: diff * cmup,
      });
      if (diff === 0) continue;
      updates.push({ id: ing.id, qty: real });
      if (diff < 0) {
        // Manquant inexpliqué -> perte "Écart inventaire"
        movements.push({
          restaurant_id: restaurantId, ingredient_id: ing.id,
          movement_type: "loss", qty: Math.abs(diff), unit_cost: cmup,
          reference_type: "inventory", loss_reason: "Écart inventaire",
          notes: `Prise d'inventaire : ${theo} → ${real}`,
        });
      } else {
        // Surplus -> ajustement positif
        movements.push({
          restaurant_id: restaurantId, ingredient_id: ing.id,
          movement_type: "adjustment", qty: diff, unit_cost: cmup,
          reference_type: "inventory",
          notes: `Prise d'inventaire : ${theo} → ${real}`,
        });
      }
    }

    for (const u of updates) {
      await supabase.from("ingredients").update({ stock_qty: u.qty }).eq("id", u.id);
    }
    if (movements.length > 0) {
      await supabase.from("stock_movements").insert(movements);
    }

    // Archive this inventory as a session (so it can be reviewed later)
    if (sessionLines.length > 0) {
      const { data: session } = await supabase.from("inventory_sessions").insert({
        restaurant_id: restaurantId, items_counted: sessionLines.length,
        manquant_value: countSummary.manque, surplus_value: countSummary.surplus, net_value: countSummary.net,
      }).select().single();
      if (session) {
        await supabase.from("inventory_lines").insert(sessionLines.map((l) => ({ session_id: session.id, ...l })));
        setSessions((prev) => [{ ...session, inventory_lines: sessionLines } as InventorySession, ...prev]);
      }
    }

    setLocalIngredients((prev) =>
      prev.map((i) => {
        const u = updates.find((x) => x.id === i.id);
        return u ? { ...i, stock_qty: u.qty } : i;
      })
    );
    setCounts({});
    setValidatingCount(false);
    setCountDone(`Inventaire validé : ${updates.length} ajustement(s), écart net €${countSummary.net.toFixed(2)}.`);
  }

  // Group movements by date for display
  const movementsByDay = useMemo(() => {
    const groups: Record<string, (Movement & { ingredientName: string })[]> = {};
    const ingMap = new Map(ingredients.map((i) => [i.id, i.name]));
    for (const m of recentMovements) {
      const day = m.created_at.slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push({ ...m, ingredientName: ingMap.get(m.ingredient_id) ?? "?" });
    }
    return groups;
  }, [recentMovements, ingredients]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900 flex items-center gap-2">
            <Warehouse size={20} className="text-gray-400" /> Inventaire
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Stock théorique mis à jour automatiquement via les réceptions et les ventes</p>
        </div>
        {/* KPI pills */}
        <div className="flex items-center gap-3">
          <a href="/api/export/inventaire"
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition shadow-sm">
            <Download size={15} className="text-gray-400" /> Exporter Excel
          </a>
          <div className="text-right bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
            <p className="text-xs text-emerald-600 font-medium">Valeur du stock</p>
            <p className="text-lg font-bold text-emerald-700">€{totalValue.toFixed(2)}</p>
          </div>
          {lowStockCount > 0 && (
            <div className="text-right bg-red-50 border border-red-200 rounded-lg px-4 py-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              <div>
                <p className="text-xs text-red-600 font-medium">À commander</p>
                <p className="text-lg font-bold text-red-600">{lowStockCount}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {[
          { key: "stock", label: "Stock actuel", icon: ClipboardList },
          { key: "count", label: "Prise d'inventaire", icon: Check },
          { key: "sessions", label: `Mes inventaires${sessions.length ? ` (${sessions.length})` : ""}`, icon: History },
          { key: "history", label: "Historique des mouvements", icon: History },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
              tab === key ? "border-emerald-500 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* STOCK TAB */}
      {tab === "stock" && (
        <>
          {/* Filters */}
          <div className="flex gap-2 mb-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500 w-52"
            />
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
            >
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Ingrédient</th>
                  <th className="text-left px-4 py-3">Catégorie</th>
                  <th className="text-right px-4 py-3">Stock théorique</th>
                  <th className="text-right px-4 py-3">CMUP</th>
                  <th className="text-right px-4 py-3">Valeur</th>
                  <th className="text-right px-4 py-3">Ajuster</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-gray-400 text-sm">
                      Aucun ingrédient trouvé
                    </td>
                  </tr>
                )}
                {filtered.map((ing) => {
                  const qty = Number(ing.stock_qty ?? 0);
                  const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
                  const value = qty * cmup;
                  const isEmpty = qty <= 0;
                  const lowStock = !isEmpty && needsReorder(ing);
                  const isAdjusting = adjustId === ing.id;

                  return (
                    <tr key={ing.id} className={clsx("hover:bg-gray-50 transition", isEmpty && "bg-red-50/30", lowStock && "bg-amber-50/40")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isEmpty && <AlertTriangle size={13} className="text-red-400 shrink-0" />}
                          {lowStock && <AlertTriangle size={13} className="text-amber-400 shrink-0" />}
                          <span className={clsx("font-medium", isEmpty ? "text-red-700" : lowStock ? "text-amber-700" : "text-gray-900")}>{ing.name}</span>
                          {lowStock && <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">à commander</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{ing.category || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={clsx("font-medium", isEmpty ? "text-red-500" : "text-gray-900")}>
                          {formatQty(qty, ing.unit)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {cmup > 0 ? `€${(["g","kg","ml","l"].includes(ing.unit) ? cmup * 1000 : cmup).toFixed(2)}/${displayUnitLabel(ing.unit)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={value > 0 ? "text-emerald-700 font-medium" : "text-gray-400"}>
                          {value > 0 ? `€${value.toFixed(2)}` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdjusting ? (
                          <div className="flex items-center gap-2 justify-end">
                            <div>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={adjustQty}
                                onChange={(e) => setAdjustQty(e.target.value)}
                                placeholder={formatQty(qty, ing.unit)}
                                className="w-24 px-2 py-1 text-sm text-right border border-emerald-400 rounded-lg outline-none focus:ring-1 focus:ring-emerald-300"
                                autoFocus
                              />
                              <input
                                type="text"
                                value={adjustNotes}
                                onChange={(e) => setAdjustNotes(e.target.value)}
                                placeholder="Raison (optionnel)"
                                className="mt-1 w-36 px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                              />
                            </div>
                            <button
                              onClick={() => handleAdjust(ing)}
                              disabled={saving || !adjustQty}
                              className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40 transition"
                            >
                              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            </button>
                            <button
                              onClick={() => { setAdjustId(null); setAdjustQty(""); setAdjustNotes(""); }}
                              className="p-1.5 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAdjustId(ing.id); setAdjustQty(String(qty)); }}
                            className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:border-emerald-400 hover:text-emerald-600 transition"
                          >
                            Corriger
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={4} className="px-4 py-3 text-sm font-medium text-gray-700">Total stock</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">€{totalValue.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            Le stock théorique est calculé automatiquement : +entrées lors des réceptions facturées, -sorties lors de la saisie des ventes mensuelles.
            Utilisez &quot;Corriger&quot; pour ajuster après un inventaire physique.
          </p>
        </>
      )}

      {/* COUNT TAB — prise d'inventaire */}
      {tab === "count" && (
        <>
          {countDone && (
            <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <Check size={15} /> {countDone}
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Manquant (écart inexpliqué)</p>
              <p className="text-2xl font-bold text-red-600">-€{countSummary.manque.toFixed(2)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Surplus trouvé</p>
              <p className="text-2xl font-bold text-emerald-600">+€{countSummary.surplus.toFixed(2)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Écart net · {countSummary.counted} comptés</p>
              <p className={clsx("text-2xl font-bold", countSummary.net < 0 ? "text-red-600" : "text-emerald-600")}>
                {countSummary.net < 0 ? "-" : "+"}€{Math.abs(countSummary.net).toFixed(2)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">Saisis le stock physique compté. L'écart avec le théorique se calcule en direct.</p>
            <button
              onClick={validateCount}
              disabled={validatingCount || countSummary.counted === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition"
            >
              {validatingCount ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Valider l'inventaire
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Ingrédient</th>
                  <th className="text-right px-4 py-3">Théorique</th>
                  <th className="text-right px-4 py-3">Compté ({"réel"})</th>
                  <th className="text-right px-4 py-3">Écart</th>
                  <th className="text-right px-4 py-3">Valeur écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((ing) => {
                  const theo = Number(ing.stock_qty ?? 0);
                  const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
                  const real = countedBase(ing);
                  const diff = real === null ? null : real - theo;
                  const valueGap = diff === null ? null : diff * cmup;
                  return (
                    <tr key={ing.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-medium text-gray-900">{ing.name}<span className="block text-xs text-gray-400 font-normal">{ing.category || "—"}</span></td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatQty(theo, ing.unit)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number" min="0" step="any"
                            value={counts[ing.id] ?? ""}
                            onChange={(e) => setCounts((p) => ({ ...p, [ing.id]: e.target.value }))}
                            placeholder="—"
                            className="w-24 px-2 py-1 text-sm text-right border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                          />
                          <span className="text-xs text-gray-400 w-6">{displayUnitLabel(ing.unit)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {diff === null ? <span className="text-gray-300">—</span> : (
                          <span className={clsx("font-medium", diff < 0 ? "text-red-500" : diff > 0 ? "text-emerald-600" : "text-gray-400")}>
                            {diff > 0 ? "+" : ""}{formatQty(Math.abs(diff), ing.unit).replace(/^/, diff < 0 ? "-" : "")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {valueGap === null ? <span className="text-gray-300">—</span> : (
                          <span className={clsx("font-medium", valueGap < 0 ? "text-red-600" : valueGap > 0 ? "text-emerald-600" : "text-gray-400")}>
                            {valueGap < 0 ? "-" : "+"}€{Math.abs(valueGap).toFixed(2)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            À la validation : le stock théorique est aligné sur le réel. Un manquant devient une perte « Écart inventaire »
            (vol, sur-portionnage, oublis), un surplus devient un ajustement. Les pertes déjà saisies (DLC, casse) ne sont pas recomptées ici.
          </p>
        </>
      )}

      {/* SESSIONS TAB — saved inventories */}
      {tab === "sessions" && (
        <div className="space-y-3">
          {sessions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <ClipboardList size={28} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Aucun inventaire enregistré pour l'instant.</p>
              <button onClick={() => setTab("count")} className="mt-3 px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition">
                Faire un inventaire →
              </button>
            </div>
          ) : (
            sessions.map((s) => {
              const open = expandedSession === s.id;
              return (
                <div key={s.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <button onClick={() => setExpandedSession(open ? null : s.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition text-left">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        Inventaire du {new Date(s.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(s.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {s.items_counted} produit{s.items_counted !== 1 ? "s" : ""} compté{s.items_counted !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <p className="text-2xs text-gray-400 uppercase">Manquant</p>
                        <p className="font-semibold text-red-500">-€{Number(s.manquant_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-gray-400 uppercase">Surplus</p>
                        <p className="font-semibold text-emerald-600">+€{Number(s.surplus_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-gray-400 uppercase">Écart net</p>
                        <p className={clsx("font-bold", Number(s.net_value) < 0 ? "text-red-600" : "text-emerald-700")}>
                          {Number(s.net_value) < 0 ? "-" : "+"}€{Math.abs(Number(s.net_value)).toFixed(2)}
                        </p>
                      </div>
                      {open ? <TrendingUp size={16} className="text-gray-400 rotate-180" /> : <TrendingDown size={16} className="text-gray-400" />}
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-gray-100 px-5 py-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-2xs text-gray-400 uppercase tracking-wider">
                            <th className="text-left pb-2">Produit</th>
                            <th className="text-right pb-2">Théorique</th>
                            <th className="text-right pb-2">Compté</th>
                            <th className="text-right pb-2">Écart</th>
                            <th className="text-right pb-2">Valeur</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {(s.inventory_lines ?? []).slice().sort((a, b) => Number(a.ecart_value ?? 0) - Number(b.ecart_value ?? 0)).map((l, i) => {
                            const u = l.unit ?? "unit";
                            const ec = Number(l.ecart ?? 0);
                            const ev = Number(l.ecart_value ?? 0);
                            return (
                              <tr key={i}>
                                <td className="py-1.5 text-gray-700">{l.ingredient_name ?? "—"}</td>
                                <td className="py-1.5 text-right text-gray-500">{formatQty(Number(l.theoretical_qty ?? 0), u)}</td>
                                <td className="py-1.5 text-right text-gray-700">{formatQty(Number(l.counted_qty ?? 0), u)}</td>
                                <td className={clsx("py-1.5 text-right font-medium", ec < 0 ? "text-red-500" : ec > 0 ? "text-emerald-600" : "text-gray-400")}>
                                  {ec === 0 ? "—" : `${ec > 0 ? "+" : "-"}${formatQty(Math.abs(ec), u)}`}
                                </td>
                                <td className={clsx("py-1.5 text-right", ev < 0 ? "text-red-600" : ev > 0 ? "text-emerald-600" : "text-gray-400")}>
                                  {ev === 0 ? "—" : `${ev < 0 ? "-" : "+"}€${Math.abs(ev).toFixed(2)}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div className="space-y-4">
          {Object.keys(movementsByDay).length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400 text-sm">
              Aucun mouvement de stock pour l&apos;instant.<br />
              Les mouvements apparaîtront après validation de factures et saisie de ventes.
            </div>
          )}
          {Object.entries(movementsByDay).map(([day, moves]) => (
            <div key={day} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {moves.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className={clsx(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                      m.movement_type === "in" ? "bg-emerald-100" :
                      m.movement_type === "out" ? "bg-red-100" :
                      m.movement_type === "loss" ? "bg-orange-100" : "bg-amber-100"
                    )}>
                      {m.movement_type === "in"
                        ? <TrendingUp size={13} className="text-emerald-600" />
                        : m.movement_type === "out"
                        ? <TrendingDown size={13} className="text-red-500" />
                        : m.movement_type === "loss"
                        ? <Trash2 size={13} className="text-orange-500" />
                        : <AlertTriangle size={13} className="text-amber-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{m.ingredientName}</p>
                      <p className="text-xs text-gray-400">
                        {m.movement_type === "in" ? "Réception" : m.movement_type === "out" ? "Vente" : m.movement_type === "loss" ? "Perte" : "Ajustement"} ·{" "}
                        {m.reference_type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={clsx(
                        "text-sm font-semibold",
                        m.movement_type === "in" ? "text-emerald-600" :
                        m.movement_type === "out" ? "text-red-500" :
                        m.movement_type === "loss" ? "text-orange-500" : "text-amber-600"
                      )}>
                        {m.movement_type === "in" ? "+" : "-"}{m.qty.toFixed(1)}
                      </p>
                      {m.unit_cost && m.unit_cost > 0 && (
                        <p className="text-xs text-gray-400">CMUP €{m.unit_cost.toFixed(4)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
