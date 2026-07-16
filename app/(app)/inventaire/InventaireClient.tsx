"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Warehouse, TrendingDown, TrendingUp, AlertTriangle, Check, Loader2, History, ClipboardList, Trash2, Download, Search, Package } from "lucide-react";
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
type Kind = "food" | "fournitures";
type InventorySession = {
  id: string; created_at: string; closing_at: string | null; status: string; finalized_at: string | null;
  items_counted: number;
  manquant_value: number; surplus_value: number; net_value: number; notes: string | null;
  kind?: string | null;
  inventory_lines: InventoryLine[];
};

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  recentMovements: Movement[];
  inventorySessions: InventorySession[];
  fournitureIds: string[];
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

export default function InventaireClient({ restaurantId, ingredients, recentMovements, inventorySessions, fournitureIds }: Props) {
  const supabase = createClient();
  const fournitureSet = useMemo(() => new Set(fournitureIds), [fournitureIds]);
  const isFourniture = (id: string) => fournitureSet.has(id);
  const [tab, setTab] = useState<"count" | "sessions" | "history" | "count-f" | "sessions-f">("history");
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

  // Which kind of stock the count/sessions tabs are working on right now.
  const countKind: Kind = tab === "count-f" || tab === "sessions-f" ? "fournitures" : "food";
  const matchKind = (id: string, kind: Kind) => (kind === "fournitures" ? isFourniture(id) : !isFourniture(id));

  // Ingredients belonging to the active kind (fournitures vs alimentaire).
  const kindIngredients = useMemo(
    () => localIngredients.filter((i) => matchKind(i.id, countKind)),
    [localIngredients, countKind, fournitureSet]
  );

  const categories = useMemo(() => {
    const cats = Array.from(new Set(kindIngredients.map((i) => i.category).filter(Boolean)));
    return ["Toutes", ...cats.sort()];
  }, [kindIngredients]);

  const filtered = useMemo(() => {
    return kindIngredients.filter((i) => {
      const matchCat = filterCat === "Toutes" || i.category === filterCat;
      const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [kindIngredients, filterCat, search]);

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
    for (const ing of kindIngredients) {
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
  }, [counts, kindIngredients]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const foodSessions = useMemo(() => sessions.filter((s) => (s.kind ?? "food") !== "fournitures"), [sessions]);
  const fournitureSessions = useMemo(() => sessions.filter((s) => s.kind === "fournitures"), [sessions]);

  // Base (g/ml/pièce) → the display value the user typed (kg/L/pièce)
  function baseToDisplay(qty: number, unit: string): number {
    const wv = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
    return wv ? qty / 1000 : qty;
  }

  async function createDraft() {
    const kind = countKind;
    setCreatingDraft(true);
    const { data: session } = await supabase.from("inventory_sessions").insert({
      restaurant_id: restaurantId, status: "draft", kind,
      closing_at: newClosingAt ? new Date(newClosingAt).toISOString() : new Date().toISOString(),
      items_counted: 0,
    }).select().single();
    setCreatingDraft(false);
    if (session) {
      setSessions((prev) => [{ ...session, inventory_lines: [] } as InventorySession, ...prev]);
      setActiveSessionId(session.id);
      setCounts({});
      setCountDone(null);
      setTab(kind === "fournitures" ? "count-f" : "count");
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
    setTab(s.kind === "fournitures" ? "count-f" : "count");
  }

  async function saveSession(finalize: boolean) {
    if (!activeSessionId) return;
    const sessionKind: Kind = (sessions.find((s) => s.id === activeSessionId)?.kind as Kind) ?? countKind;
    setValidatingCount(true);
    const movements: any[] = [];
    const updates: { id: string; qty: number }[] = [];
    const sessionLines: InventoryLine[] = [];

    for (const ing of localIngredients.filter((i) => matchKind(i.id, sessionKind))) {
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
      setTab(sessionKind === "fournitures" ? "sessions-f" : "sessions");
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Inventaire</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">Stock théorique mis à jour automatiquement via les réceptions et les ventes.</p>
        </div>
        <a href="/api/export/inventaire"
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition w-fit">
          <Download size={15} /> Exporter Excel
        </a>
      </div>

      {/* KPI glass cards — derived from live data */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-primary">
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Valeur du stock</span>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Warehouse size={18} /></div>
          </div>
          <h3 className="text-2xl font-extrabold text-primary tabular-nums">€{totalValue.toFixed(2)}</h3>
        </div>
        <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4", lowStockCount > 0 ? "border-red" : "border-outline-variant/30")}>
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">À commander</span>
            <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", lowStockCount > 0 ? "bg-red-light text-red" : "bg-surface-container text-on-surface-variant/50")}><AlertTriangle size={18} /></div>
          </div>
          <h3 className={clsx("text-2xl font-extrabold tabular-nums", lowStockCount > 0 ? "text-red" : "text-on-surface")}>{lowStockCount}</h3>
        </div>
      </section>

      {/* Primary tabs — État des stocks vs Inventaire */}
      <div className={clsx("glass-card rounded-2xl p-2 flex flex-wrap gap-1", tab === "history" ? "mb-6" : "mb-3")}>
        {[
          { key: "stock", label: "État des stocks", icon: Warehouse },
          { key: "inventory", label: "Inventaire", icon: ClipboardList },
        ].map(({ key, label, icon: Icon }) => {
          const active = key === "stock" ? tab === "history" : tab !== "history";
          return (
            <button
              key={key}
              onClick={() => { if (key === "stock") setTab("history"); else if (tab === "history") setTab("count"); }}
              className={clsx(
                "flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                active ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </div>

      {/* Secondary tabs — the different inventories (only under « Inventaire ») */}
      {tab !== "history" && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {[
            { key: "count", label: "Prise d'inventaire", icon: Check },
            { key: "sessions", label: `Mes inventaires${foodSessions.length ? ` (${foodSessions.length})` : ""}`, icon: History },
            { key: "count-f", label: "Prise d'inventaire fournitures", icon: ClipboardList },
            { key: "sessions-f", label: `Mes inventaires fournitures${fournitureSessions.length ? ` (${fournitureSessions.length})` : ""}`, icon: History },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={clsx(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-2xs font-bold uppercase tracking-wide transition-all",
                tab === key ? "bg-primary text-on-primary" : "text-on-surface-variant/60 border border-outline-variant/30 hover:bg-surface-container-low"
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}


      {/* COUNT TAB — prise d'inventaire (alimentaire + fournitures) */}
      {(tab === "count" || tab === "count-f") && (
        <>
          {countDone && (
            <div className="mb-4 text-sm text-primary bg-emerald-50 border border-primary/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Check size={15} /> {countDone}
            </div>
          )}

          {!activeSession ? (
            <div className="glass-card rounded-2xl p-8 max-w-md mx-auto text-center">
              <ClipboardList size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-on-surface mb-1">Nouvelle fiche d&apos;inventaire{countKind === "fournitures" ? " fournitures" : ""}</h2>
              {countKind === "fournitures" && kindIngredients.length === 0 && (
                <p className="text-sm text-amber-dark mb-3">Aucun ingrédient n&apos;a le tag « Fournitures ». Assigne ce tag à tes fournitures (couverts, emballages…) depuis la page Ingrédients.</p>
              )}
              <p className="text-sm text-on-surface-variant/70 mb-4">Choisis la date et l&apos;heure de l&apos;inventaire (pour savoir si c&apos;est avant ou après service). Tu peux la laisser en brouillon et la finir plus tard.</p>
              <div className="flex flex-wrap items-end gap-2 justify-center">
                <div className="text-left">
                  <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1">Date &amp; heure de l&apos;inventaire</label>
                  <input type="datetime-local" value={newClosingAt} onChange={(e) => setNewClosingAt(e.target.value)}
                    className="px-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface" />
                </div>
                <button onClick={createDraft} disabled={creatingDraft}
                  className="px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container disabled:opacity-50 transition">
                  {creatingDraft ? "Création…" : "Créer la fiche"}
                </button>
              </div>
            </div>
          ) : (
          <>
          {/* Fiche header + actions */}
          <div className="glass-card rounded-2xl flex flex-wrap items-center justify-between gap-3 mb-4 px-5 py-4">
            <div>
              <p className="text-base font-semibold text-on-surface">
                Inventaire du {activeSession.closing_at ? new Date(activeSession.closing_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
              <p className="text-2xs text-amber-dark uppercase tracking-wide font-bold">Brouillon · {countSummary.counted} produit(s) compté(s)</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setActiveSessionId(null); setCounts({}); }} className="px-3 py-1.5 text-xs text-on-surface-variant/60 hover:text-on-surface">Quitter</button>
              <button onClick={() => saveSession(false)} disabled={validatingCount}
                className="px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low disabled:opacity-50 transition">
                Enregistrer brouillon
              </button>
              <button onClick={() => saveSession(true)} disabled={validatingCount || countSummary.counted === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container disabled:opacity-40 transition">
                {validatingCount ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Finaliser
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4 border-red">
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Manquant (écart inexpliqué)</p>
              <p className="text-2xl font-extrabold text-red tabular-nums">-€{countSummary.manque.toFixed(2)}</p>
            </div>
            <div className="glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4 border-primary">
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Surplus trouvé</p>
              <p className="text-2xl font-extrabold text-primary tabular-nums">+€{countSummary.surplus.toFixed(2)}</p>
            </div>
            <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4", countSummary.net < 0 ? "border-red" : "border-primary")}>
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Écart net · {countSummary.counted} comptés</p>
              <p className={clsx("text-2xl font-extrabold tabular-nums", countSummary.net < 0 ? "text-red" : "text-primary")}>
                {countSummary.net < 0 ? "-" : "+"}€{Math.abs(countSummary.net).toFixed(2)}
              </p>
            </div>
          </div>

          <p className="text-sm text-on-surface-variant/70 mb-3">Saisis le stock physique compté. <b>Enregistrer brouillon</b> ne touche pas au stock ; <b>Finaliser</b> applique les écarts et archive la fiche.</p>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <tr>
                  <th className="text-left px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Ingrédient</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Théorique</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Compté ({"réel"})</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Écart</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Valeur écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {filtered.map((ing) => {
                  const theo = Number(ing.stock_qty ?? 0);
                  const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
                  const real = countedBase(ing);
                  const diff = real === null ? null : real - theo;
                  const valueGap = diff === null ? null : diff * cmup;
                  return (
                    <tr key={ing.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="px-5 py-4 font-semibold text-on-surface">{ing.name}<span className="block text-2xs text-on-surface-variant/50 font-normal">{ing.category || "—"}</span></td>
                      <td className="px-5 py-4 text-right text-on-surface-variant/80 tabular-nums">{formatQty(theo, ing.unit)}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number" min="0" step="any"
                            value={counts[ing.id] ?? ""}
                            onChange={(e) => setCounts((p) => ({ ...p, [ing.id]: e.target.value }))}
                            placeholder="—"
                            className="w-24 px-2 py-1.5 text-sm text-right bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <span className="text-xs text-on-surface-variant/50 w-6">{displayUnitLabel(ing.unit)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {diff === null ? <span className="text-on-surface-variant/30">—</span> : (
                          <span className={clsx("font-semibold tabular-nums", diff < 0 ? "text-red" : diff > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                            {diff > 0 ? "+" : ""}{formatQty(Math.abs(diff), ing.unit).replace(/^/, diff < 0 ? "-" : "")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {valueGap === null ? <span className="text-on-surface-variant/30">—</span> : (
                          <span className={clsx("font-semibold tabular-nums", valueGap < 0 ? "text-red" : valueGap > 0 ? "text-primary" : "text-on-surface-variant/40")}>
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
          </div>
          <p className="text-xs text-on-surface-variant/50 mt-3">
            À la finalisation : le stock théorique est aligné sur le réel. Un manquant devient une perte « Écart inventaire »
            (vol, sur-portionnage, oublis), un surplus devient un ajustement. Les pertes déjà saisies (DLC, casse) ne sont pas recomptées ici.
          </p>
          </>
          )}
        </>
      )}

      {/* SESSIONS TAB — saved inventories (alimentaire + fournitures) */}
      {(tab === "sessions" || tab === "sessions-f") && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => { setActiveSessionId(null); setCountDone(null); setTab(tab === "sessions-f" ? "count-f" : "count"); }}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
              <ClipboardList size={14} /> Nouvel inventaire{tab === "sessions-f" ? " fournitures" : ""}
            </button>
          </div>
          {(tab === "sessions-f" ? fournitureSessions : foodSessions).length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center">
              <ClipboardList size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
              <p className="text-sm text-on-surface-variant/70">Aucun inventaire pour l'instant. Crée ta première fiche.</p>
            </div>
          ) : (
            (tab === "sessions-f" ? fournitureSessions : foodSessions).map((s) => {
              const open = expandedSession === s.id;
              const draft = s.status === "draft";
              return (
                <div key={s.id} className={clsx("glass-card rounded-2xl overflow-hidden", draft && "border-l-4 border-amber")}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <button onClick={() => draft ? loadDraft(s) : setExpandedSession(open ? null : s.id)} className="flex-1 text-left">
                      <p className="font-semibold text-on-surface flex items-center gap-2 flex-wrap">
                        Inventaire du {new Date(s.closing_at ?? s.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        <span className={clsx("px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", draft ? "bg-amber-light text-amber-dark" : "bg-emerald-50 text-primary")}>
                          {draft ? "Brouillon" : "Finalisé"}
                        </span>
                      </p>
                      <p className="text-2xs text-on-surface-variant/50 mt-0.5">{s.items_counted} produit{s.items_counted !== 1 ? "s" : ""} compté{s.items_counted !== 1 ? "s" : ""}</p>
                    </button>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Manquant</p>
                        <p className="font-semibold text-red tabular-nums">-€{Number(s.manquant_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Surplus</p>
                        <p className="font-semibold text-primary tabular-nums">+€{Number(s.surplus_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Écart net</p>
                        <p className={clsx("font-bold tabular-nums", Number(s.net_value) < 0 ? "text-red" : "text-primary")}>
                          {Number(s.net_value) < 0 ? "-" : "+"}€{Math.abs(Number(s.net_value)).toFixed(2)}
                        </p>
                      </div>
                      {draft ? (
                        <button onClick={() => loadDraft(s)} className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wide text-primary bg-emerald-50 border border-primary/20 rounded-xl hover:bg-emerald-100 transition">
                          Continuer →
                        </button>
                      ) : (
                        <button onClick={() => setExpandedSession(open ? null : s.id)} className="text-on-surface-variant/40">
                          {open ? <TrendingUp size={16} className="rotate-180" /> : <TrendingDown size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {open && !draft && (
                    <div className="border-t border-outline-variant/10 bg-surface-container-low/30 px-5 py-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-2xs text-on-surface-variant/50 uppercase tracking-wider">
                            <th className="text-left pb-2">Produit</th>
                            <th className="text-right pb-2">Théorique</th>
                            <th className="text-right pb-2">Compté</th>
                            <th className="text-right pb-2">Écart</th>
                            <th className="text-right pb-2">Valeur</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {(s.inventory_lines ?? []).slice().sort((a, b) => Number(a.ecart_value ?? 0) - Number(b.ecart_value ?? 0)).map((l, i) => {
                            const u = l.unit ?? "unit";
                            const ec = Number(l.ecart ?? 0);
                            const ev = Number(l.ecart_value ?? 0);
                            return (
                              <tr key={i}>
                                <td className="py-1.5 text-on-surface-variant">{l.ingredient_name ?? "—"}</td>
                                <td className="py-1.5 text-right text-on-surface-variant/60 tabular-nums">{formatQty(Number(l.theoretical_qty ?? 0), u)}</td>
                                <td className="py-1.5 text-right text-on-surface-variant tabular-nums">{formatQty(Number(l.counted_qty ?? 0), u)}</td>
                                <td className={clsx("py-1.5 text-right font-medium tabular-nums", ec < 0 ? "text-red" : ec > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                                  {ec === 0 ? "—" : `${ec > 0 ? "+" : "-"}${formatQty(Math.abs(ec), u)}`}
                                </td>
                                <td className={clsx("py-1.5 text-right tabular-nums", ev < 0 ? "text-red" : ev > 0 ? "text-primary" : "text-on-surface-variant/40")}>
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
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
            <input value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)} placeholder="Rechercher un ingrédient…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40" />
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {stockRows.length === 0 ? (
              <div className="p-10 text-center text-on-surface-variant/50 text-sm">Aucun ingrédient.</div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {stockRows.map(({ ing, qty, value, moves }) => {
                  const open = false; // rows now link to a dedicated history page instead of expanding
                  const low = needsReorder(ing);
                  return (
                    <div key={ing.id}>
                      <Link href={`/ingredients/${ing.id}/history`}
                        className={clsx(
                          "w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-container-low/40 transition-colors text-left",
                          low && "border-l-4 border-red/40"
                        )}>
                        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", low ? "bg-red-light text-red" : "bg-tertiary-fixed text-primary")}>
                          <Package size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={clsx("text-sm font-semibold truncate", low ? "text-red" : "text-on-surface")}>{ing.name}</p>
                            {ing.category && (
                              <span className="inline-flex px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-2xs font-bold uppercase tracking-wide">{ing.category}</span>
                            )}
                            {low && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-light text-red text-2xs font-bold uppercase tracking-wide">
                                <AlertTriangle size={11} /> À commander
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-on-surface-variant/50 mt-0.5">{moves.length} mouvement{moves.length !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={clsx("text-sm font-semibold tabular-nums", low ? "text-red" : "text-on-surface")}>{formatQty(qty, ing.unit)}</p>
                          <p className="text-2xs text-on-surface-variant/50 tabular-nums">{value > 0 ? `€${value.toFixed(2)}` : "—"}</p>
                        </div>
                        <ChevronRight size={16} className="text-on-surface-variant/30 shrink-0" />
                      </Link>

                      {open && (
                        <div className="bg-surface-container-low/30 border-t border-outline-variant/10 px-5 py-4">
                          {moves.length === 0 ? (
                            <p className="text-xs text-on-surface-variant/50 py-2">Aucun mouvement pour ce produit.</p>
                          ) : (
                            movesByMonth(moves).map(([mk, ms]) => {
                              const inQty = ms.filter((m) => m.movement_type === "in").reduce((s, m) => s + m.qty, 0);
                              const outQty = ms.filter((m) => m.movement_type === "out" || m.movement_type === "loss").reduce((s, m) => s + m.qty, 0);
                              return (
                                <div key={mk} className="mb-3 last:mb-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-wide">{monthLabel(mk)}</p>
                                    <p className="text-2xs text-on-surface-variant/50">
                                      {inQty > 0 && <span className="text-primary">+{formatQty(inQty, ing.unit)} reçu</span>}
                                      {inQty > 0 && outQty > 0 && " · "}
                                      {outQty > 0 && <span className="text-red">-{formatQty(outQty, ing.unit)} sorti</span>}
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    {ms.map((m, i) => {
                                      const meta = MOVE_META[m.movement_type] ?? MOVE_META.adjustment;
                                      return (
                                        <div key={i} className="flex items-center justify-between text-xs bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-1.5">
                                          <span className="text-on-surface-variant/70">
                                            {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · {meta.label}
                                            {m.loss_reason ? ` (${m.loss_reason})` : ""}
                                          </span>
                                          <span className={clsx("font-semibold tabular-nums", meta.color)}>{meta.sign}{formatQty(m.qty, ing.unit)}</span>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
