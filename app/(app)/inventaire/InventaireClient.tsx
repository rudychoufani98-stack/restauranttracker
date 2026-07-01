"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Warehouse, TrendingDown, TrendingUp, AlertTriangle, Check, Loader2, History, ClipboardList, Trash2, Download, Search } from "lucide-react";
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
  loss_reason?: string | null;
  created_at: string;
};

type InventoryLine = {
  ingredient_id: string | null; ingredient_name: string | null; unit: string | null;
  theoretical_qty: number | null; counted_qty: number | null; ecart: number | null;
  cmup: number | null; ecart_value: number | null;
};
type InventorySession = {
  id: string; created_at: string; closing_at: string | null; status: string; finalized_at: string | null;
  items_counted: number;
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
  const [tab, setTab] = useState<"count" | "sessions" | "history">("history");
  const [expandedIng, setExpandedIng] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [sessions, setSessions] = useState<InventorySession[]>(inventorySessions);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newClosingAt, setNewClosingAt] = useState<string>(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm" (local) for datetime-local input
  });
  const [creatingDraft, setCreatingDraft] = useState(false);
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

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Base (g/ml/pièce) → the display value the user typed (kg/L/pièce)
  function baseToDisplay(qty: number, unit: string): number {
    const wv = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
    return wv ? qty / 1000 : qty;
  }

  async function createDraft() {
    setCreatingDraft(true);
    const { data: session } = await supabase.from("inventory_sessions").insert({
      restaurant_id: restaurantId, status: "draft",
      closing_at: newClosingAt ? new Date(newClosingAt).toISOString() : new Date().toISOString(),
      items_counted: 0,
    }).select().single();
    setCreatingDraft(false);
    if (session) {
      setSessions((prev) => [{ ...session, inventory_lines: [] } as InventorySession, ...prev]);
      setActiveSessionId(session.id);
      setCounts({});
      setCountDone(null);
      setTab("count");
    }
  }

  function loadDraft(s: InventorySession) {
    const next: Record<string, string> = {};
    for (const l of s.inventory_lines ?? []) {
      if (l.ingredient_id && l.counted_qty != null) {
        const ing = localIngredients.find((i) => i.id === l.ingredient_id);
        next[l.ingredient_id] = String(baseToDisplay(Number(l.counted_qty), ing?.unit ?? l.unit ?? "unit"));
      }
    }
    setCounts(next);
    setActiveSessionId(s.id);
    setCountDone(null);
    setTab("count");
  }

  async function saveSession(finalize: boolean) {
    if (!activeSessionId) return;
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
      sessionLines.push({
        ingredient_id: ing.id, ingredient_name: ing.name, unit: ing.unit,
        theoretical_qty: theo, counted_qty: real, ecart: diff, cmup, ecart_value: diff * cmup,
      });
      if (finalize && diff !== 0) {
        updates.push({ id: ing.id, qty: real });
        movements.push(diff < 0
          ? { restaurant_id: restaurantId, ingredient_id: ing.id, movement_type: "loss", qty: Math.abs(diff), unit_cost: cmup, reference_type: "inventory", loss_reason: "Écart inventaire", notes: `Inventaire : ${theo} → ${real}` }
          : { restaurant_id: restaurantId, ingredient_id: ing.id, movement_type: "adjustment", qty: diff, unit_cost: cmup, reference_type: "inventory", notes: `Inventaire : ${theo} → ${real}` });
      }
    }

    // Replace the session's saved lines with the current count
    await supabase.from("inventory_lines").delete().eq("session_id", activeSessionId);
    if (sessionLines.length > 0) {
      await supabase.from("inventory_lines").insert(sessionLines.map((l) => ({ session_id: activeSessionId, ...l })));
    }

    const patch: any = {
      items_counted: sessionLines.length,
      manquant_value: countSummary.manque, surplus_value: countSummary.surplus, net_value: countSummary.net,
    };
    if (finalize) { patch.status = "finalized"; patch.finalized_at = new Date().toISOString(); }
    await supabase.from("inventory_sessions").update(patch).eq("id", activeSessionId);

    // Apply stock only when finalizing
    if (finalize) {
      for (const u of updates) await supabase.from("ingredients").update({ stock_qty: u.qty }).eq("id", u.id);
      if (movements.length > 0) await supabase.from("stock_movements").insert(movements);
      setLocalIngredients((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? { ...i, stock_qty: u.qty } : i; }));
    }

    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, ...patch, inventory_lines: sessionLines } : s));
    setValidatingCount(false);

    if (finalize) {
      setCounts({});
      setActiveSessionId(null);
      setCountDone(`Inventaire finalisé : ${updates.length} ajustement(s) appliqué(s), écart net €${countSummary.net.toFixed(2)}.`);
      setTab("sessions");
    } else {
      setCountDone("Brouillon enregistré ✓");
    }
  }

  // All movements grouped per ingredient (for the stock & mouvements view)
  const movesByIngredient = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const m of recentMovements) {
      if (!m.ingredient_id) continue;
      if (!map.has(m.ingredient_id)) map.set(m.ingredient_id, []);
      map.get(m.ingredient_id)!.push(m);
    }
    return map;
  }, [recentMovements]);

  // Ingredient rows for the stock & mouvements list (with current stock + value)
  const stockRows = useMemo(() => {
    const q = moveSearch.trim().toLowerCase();
    return localIngredients
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q))
      .map((i) => {
        const qty = Number(i.stock_qty ?? 0);
        const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
        return { ing: i, qty, value: qty * cmup, moves: movesByIngredient.get(i.id) ?? [] };
      })
      .sort((a, b) => a.ing.name.localeCompare(b.ing.name));
  }, [localIngredients, moveSearch, movesByIngredient]);

  const MOVE_META: Record<string, { label: string; sign: string; color: string }> = {
    in: { label: "Réception", sign: "+", color: "text-emerald-600" },
    out: { label: "Vente (déstockage)", sign: "-", color: "text-gray-600" },
    loss: { label: "Perte", sign: "-", color: "text-red-500" },
    adjustment: { label: "Ajustement", sign: "±", color: "text-blue-600" },
  };
  // Group one ingredient's movements by month (label + list)
  function movesByMonth(moves: Movement[]) {
    const groups = new Map<string, Movement[]>();
    for (const m of moves) {
      const key = m.created_at.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }
  function monthLabel(key: string) {
    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const [y, m] = key.split("-");
    return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y}`;
  }

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
          { key: "history", label: "Stock & mouvements", icon: Warehouse },
          { key: "count", label: "Prise d'inventaire", icon: Check },
          { key: "sessions", label: `Mes inventaires${sessions.length ? ` (${sessions.length})` : ""}`, icon: History },
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


      {/* COUNT TAB — prise d'inventaire */}
      {tab === "count" && (
        <>
          {countDone && (
            <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <Check size={15} /> {countDone}
            </div>
          )}

          {!activeSession ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md mx-auto text-center">
              <ClipboardList size={28} className="text-gray-300 mx-auto mb-3" />
              <h2 className="text-base font-semibold text-gray-900 mb-1">Nouvelle fiche d&apos;inventaire</h2>
              <p className="text-sm text-gray-500 mb-4">Choisis la date et l&apos;heure de l&apos;inventaire (pour savoir si c&apos;est avant ou après service). Tu peux la laisser en brouillon et la finir plus tard.</p>
              <div className="flex flex-wrap items-end gap-2 justify-center">
                <div className="text-left">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date &amp; heure de l&apos;inventaire</label>
                  <input type="datetime-local" value={newClosingAt} onChange={(e) => setNewClosingAt(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                </div>
                <button onClick={createDraft} disabled={creatingDraft}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
                  {creatingDraft ? "Création…" : "Créer la fiche"}
                </button>
              </div>
            </div>
          ) : (
          <>
          {/* Fiche header + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Inventaire du {activeSession.closing_at ? new Date(activeSession.closing_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
              <p className="text-2xs text-amber-600 uppercase tracking-wide font-semibold">Brouillon · {countSummary.counted} produit(s) compté(s)</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setActiveSessionId(null); setCounts({}); }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Quitter</button>
              <button onClick={() => saveSession(false)} disabled={validatingCount}
                className="px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition">
                Enregistrer brouillon
              </button>
              <button onClick={() => saveSession(true)} disabled={validatingCount || countSummary.counted === 0}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition">
                {validatingCount ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Finaliser
              </button>
            </div>
          </div>

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

          <p className="text-sm text-gray-500 mb-3">Saisis le stock physique compté. <b>Enregistrer brouillon</b> ne touche pas au stock ; <b>Finaliser</b> applique les écarts et archive la fiche.</p>

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
            À la finalisation : le stock théorique est aligné sur le réel. Un manquant devient une perte « Écart inventaire »
            (vol, sur-portionnage, oublis), un surplus devient un ajustement. Les pertes déjà saisies (DLC, casse) ne sont pas recomptées ici.
          </p>
          </>
          )}
        </>
      )}

      {/* SESSIONS TAB — saved inventories */}
      {tab === "sessions" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setActiveSessionId(null); setCountDone(null); setTab("count"); }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition">
              <ClipboardList size={14} /> Nouvel inventaire
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <ClipboardList size={28} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Aucun inventaire pour l'instant. Crée ta première fiche.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const open = expandedSession === s.id;
              const draft = s.status === "draft";
              return (
                <div key={s.id} className={clsx("bg-white border rounded-xl overflow-hidden", draft ? "border-amber-200" : "border-gray-200")}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <button onClick={() => draft ? loadDraft(s) : setExpandedSession(open ? null : s.id)} className="flex-1 text-left">
                      <p className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                        Inventaire du {new Date(s.closing_at ?? s.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        <span className={clsx("px-1.5 py-0.5 rounded text-2xs font-semibold uppercase", draft ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                          {draft ? "Brouillon" : "Finalisé"}
                        </span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.items_counted} produit{s.items_counted !== 1 ? "s" : ""} compté{s.items_counted !== 1 ? "s" : ""}</p>
                    </button>
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
                      {draft ? (
                        <button onClick={() => loadDraft(s)} className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition">
                          Continuer →
                        </button>
                      ) : (
                        <button onClick={() => setExpandedSession(open ? null : s.id)} className="text-gray-400">
                          {open ? <TrendingUp size={16} className="rotate-180" /> : <TrendingDown size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {open && !draft && (
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
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)} placeholder="Rechercher un ingrédient…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
            {stockRows.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">Aucun ingrédient.</div>
            ) : stockRows.map(({ ing, qty, value, moves }) => {
              const open = expandedIng === ing.id;
              return (
                <div key={ing.id}>
                  <button onClick={() => setExpandedIng(open ? null : ing.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{ing.name}</p>
                      <p className="text-2xs text-gray-400">{ing.category || "—"} · {moves.length} mouvement{moves.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatQty(qty, ing.unit)}</p>
                      <p className="text-2xs text-gray-400">{value > 0 ? `€${value.toFixed(2)}` : "—"}</p>
                    </div>
                    {open ? <TrendingUp size={15} className="text-gray-400 rotate-180" /> : <TrendingDown size={15} className="text-gray-400" />}
                  </button>

                  {open && (
                    <div className="bg-gray-50/50 border-t border-gray-100 px-4 py-3">
                      {moves.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Aucun mouvement pour ce produit.</p>
                      ) : (
                        movesByMonth(moves).map(([mk, ms]) => {
                          const inQty = ms.filter((m) => m.movement_type === "in").reduce((s, m) => s + m.qty, 0);
                          const outQty = ms.filter((m) => m.movement_type === "out" || m.movement_type === "loss").reduce((s, m) => s + m.qty, 0);
                          return (
                            <div key={mk} className="mb-3 last:mb-0">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wide">{monthLabel(mk)}</p>
                                <p className="text-2xs text-gray-400">
                                  {inQty > 0 && <span className="text-emerald-600">+{formatQty(inQty, ing.unit)} reçu</span>}
                                  {inQty > 0 && outQty > 0 && " · "}
                                  {outQty > 0 && <span className="text-red-500">-{formatQty(outQty, ing.unit)} sorti</span>}
                                </p>
                              </div>
                              <div className="space-y-1">
                                {ms.map((m, i) => {
                                  const meta = MOVE_META[m.movement_type] ?? MOVE_META.adjustment;
                                  return (
                                    <div key={i} className="flex items-center justify-between text-xs bg-white border border-gray-100 rounded-lg px-3 py-1.5">
                                      <span className="text-gray-500">
                                        {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · {meta.label}
                                        {m.loss_reason ? ` (${m.loss_reason})` : ""}
                                      </span>
                                      <span className={clsx("font-semibold", meta.color)}>{meta.sign}{formatQty(m.qty, ing.unit)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
