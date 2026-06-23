"use client";

import { useState, useMemo } from "react";
import { Plus, Minus, Trash2, Receipt, Loader2, Check, ShoppingBag } from "lucide-react";
import clsx from "clsx";

type Recipe = { id: string; name: string; category: string; total_cost: number; menu_price: number | null; yield_portions: number };
type Product = { id: string; name: string; category: string; pack_price: number; selling_price: number | null };

type Item = { key: string; id: string; type: "recipe" | "product"; name: string; category: string; price: number; cost: number };
type TicketLine = { item: Item; qty: number };
type ClosedTicket = { total: number; cost: number; lines: number; at: string };

const CATEGORY_FALLBACK = ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"];

interface Props {
  restaurantId: string;
  targetFoodCostPct: number;
  recipes: Recipe[];
  products: Product[];
  categoryOrder: string[];
}

export default function CaisseClient({ restaurantId, targetFoodCostPct, recipes, products, categoryOrder }: Props) {
  const items: Item[] = useMemo(() => {
    const fromR: Item[] = recipes
      .filter((r) => r.menu_price && r.menu_price > 0)
      .map((r) => ({ key: `r:${r.id}`, id: r.id, type: "recipe", name: r.name, category: r.category || "Autre", price: Number(r.menu_price), cost: r.total_cost / (r.yield_portions || 1) }));
    const fromP: Item[] = products
      .filter((p) => p.selling_price && p.selling_price > 0)
      .map((p) => ({ key: `p:${p.id}`, id: p.id, type: "product", name: p.name, category: p.category || "Autre", price: Number(p.selling_price), cost: Number(p.pack_price ?? 0) }));
    return [...fromR, ...fromP];
  }, [recipes, products]);

  const order = categoryOrder.length ? categoryOrder : CATEGORY_FALLBACK;
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    const cats = Array.from(map.keys()).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return cats.map((c) => ({ category: c, items: map.get(c)!.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [items, order]);

  const [ticket, setTicket] = useState<Map<string, TicketLine>>(new Map());
  const [closed, setClosed] = useState<ClosedTicket[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function add(it: Item) {
    setTicket((prev) => {
      const next = new Map(prev);
      const line = next.get(it.key);
      next.set(it.key, { item: it, qty: (line?.qty ?? 0) + 1 });
      return next;
    });
  }
  function dec(key: string) {
    setTicket((prev) => {
      const next = new Map(prev);
      const line = next.get(key);
      if (!line) return next;
      if (line.qty <= 1) next.delete(key);
      else next.set(key, { ...line, qty: line.qty - 1 });
      return next;
    });
  }
  function clearTicket() { setTicket(new Map()); }

  const lines = Array.from(ticket.values());
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const cost = lines.reduce((s, l) => s + l.item.cost * l.qty, 0);
  const margin = total - cost;
  const foodCost = total > 0 ? (cost / total) * 100 : 0;
  const fcColor = foodCost <= targetFoodCostPct ? "text-emerald-600" : foodCost <= targetFoodCostPct * 1.2 ? "text-amber-600" : "text-red-600";

  async function encaisser() {
    if (lines.length === 0) return;
    setSaving(true);
    const salesLines = lines.map((l) => l.item.type === "recipe"
      ? { recipe_id: l.item.id, qty_sold: l.qty }
      : { ingredient_id: l.item.id, qty_sold: l.qty });

    const res = await fetch("/api/record-sale-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, periodId: null, salesLines }),
    });
    setSaving(false);
    if (!res.ok) { setToast("Erreur lors de l'encaissement."); return; }
    setClosed((p) => [{ total, cost, lines: lines.length, at: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) }, ...p]);
    clearTicket();
    setToast(`Ticket encaissé · €${total.toFixed(2)} · stock déduit ✓`);
    setTimeout(() => setToast(null), 3500);
  }

  const serviceTotal = closed.reduce((s, t) => s + t.total, 0);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-5 pb-4 border-b border-gray-200">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Opérations</p>
        <h1 className="text-2xl font-bold text-gray-900">Caisse (simulation)</h1>
        <p className="text-sm text-gray-500 mt-1">Compose un ticket à partir de ton menu. À l'encaissement, le stock est déduit automatiquement.</p>
      </div>

      {toast && (
        <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <Check size={15} /> {toast}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-12 text-center">
          <ShoppingBag size={28} className="text-gray-300 mx-auto mb-3" />
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucun article tarifé</h2>
          <p className="text-sm text-gray-500 mb-4">Définis d'abord les prix de tes plats dans le Menu pour les retrouver ici.</p>
          <a href="/menu" className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition inline-block">Aller au menu →</a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tiles */}
          <div className="lg:col-span-2 space-y-6">
            {grouped.map(({ category, items: catItems }) => (
              <div key={category}>
                <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2.5 flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full bg-emerald-500 inline-block" /> {category}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {catItems.map((it) => (
                    <button
                      key={it.key}
                      onClick={() => add(it)}
                      className="text-left bg-white border border-gray-100 rounded-card shadow-card p-3.5 hover:shadow-card-hover hover:border-emerald-200 active:scale-[0.98] transition-all"
                    >
                      <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{it.name}</p>
                      <p className="text-sm font-bold text-emerald-600 mt-1.5">€{it.price.toFixed(2)}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Ticket */}
          <div className="lg:sticky lg:top-6 h-fit">
            <div className="bg-white border border-gray-100 rounded-card shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Receipt size={15} className="text-gray-400" /> Ticket</h2>
                {lines.length > 0 && (
                  <button onClick={clearTicket} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"><Trash2 size={12} /> Vider</button>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-400">Clique sur un article pour l'ajouter.</div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[40vh] overflow-y-auto">
                  {lines.map((l) => (
                    <div key={l.item.key} className="flex items-center gap-2 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{l.item.name}</p>
                        <p className="text-xs text-gray-400">€{l.item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => dec(l.item.key)} className="w-6 h-6 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center"><Minus size={12} /></button>
                        <span className="w-5 text-center text-sm font-medium">{l.qty}</span>
                        <button onClick={() => add(l.item)} className="w-6 h-6 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center"><Plus size={12} /></button>
                      </div>
                      <span className="w-14 text-right text-sm font-semibold text-gray-900">€{(l.item.price * l.qty).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals */}
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Total</span><span className="font-bold text-gray-900">€{total.toFixed(2)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-400">Coût matière</span><span className="text-gray-500">€{cost.toFixed(2)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-400">Marge</span><span className="text-emerald-600 font-medium">€{margin.toFixed(2)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-400">Food cost</span><span className={clsx("font-medium", fcColor)}>{total > 0 ? `${foodCost.toFixed(1)}%` : "—"}</span></div>
              </div>

              <div className="p-3">
                <button
                  onClick={encaisser}
                  disabled={saving || lines.length === 0}
                  className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Encaisser & déduire le stock
                </button>
              </div>
            </div>

            {/* Session */}
            {closed.length > 0 && (
              <div className="mt-4 bg-white border border-gray-100 rounded-card shadow-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Service en cours</p>
                  <p className="text-sm font-bold text-gray-900">€{serviceTotal.toFixed(2)}</p>
                </div>
                <p className="text-xs text-gray-400 mb-2">{closed.length} ticket{closed.length !== 1 ? "s" : ""} encaissé{closed.length !== 1 ? "s" : ""}</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {closed.map((t, i) => (
                    <div key={i} className="flex justify-between text-xs text-gray-500">
                      <span>{t.at} · {t.lines} article{t.lines !== 1 ? "s" : ""}</span>
                      <span className="font-medium text-gray-700">€{t.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
