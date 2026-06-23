"use client";

import { useState, useMemo } from "react";
import { ChefHat, Package, AlertTriangle, ArrowRight } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

type Recipe  = { id: string; name: string; category: string; total_cost: number; menu_price: number | null; yield_portions: number };
type Product = { id: string; name: string; category: string; pack_price: number; selling_price: number | null };

type Touch = {
  id: string;
  name: string;
  category: string;
  price: number | null;
  type: "recipe" | "product";
  cost: number;
  linked: true; // all items from DB are linked by definition
};

const FALLBACK_CATS = ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"];

interface Props {
  recipes: Recipe[];
  products: Product[];
  categoryOrder: string[];
}

export default function CaisseClient({ recipes, products, categoryOrder }: Props) {
  const order = categoryOrder.length ? categoryOrder : FALLBACK_CATS;

  const touches: Touch[] = useMemo(() => {
    const fromR: Touch[] = recipes.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category || "Autre",
      price: r.menu_price,
      type: "recipe",
      cost: r.total_cost / (r.yield_portions || 1),
      linked: true,
    }));
    const fromP: Touch[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || "Autre",
      price: p.selling_price,
      type: "product",
      cost: Number(p.pack_price ?? 0),
      linked: true,
    }));
    return [...fromR, ...fromP];
  }, [recipes, products]);

  const categories = useMemo(() => {
    const map = new Map<string, Touch[]>();
    for (const t of touches) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    const cats = Array.from(map.keys()).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return cats.map((c) => ({ name: c, items: map.get(c)!.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [touches, order]);

  const [activeCat, setActiveCat] = useState<string>(categories[0]?.name ?? "");
  const [selected, setSelected] = useState<Touch | null>(null);

  const activeItems = categories.find((c) => c.name === activeCat)?.items ?? [];
  const unpriced = touches.filter((t) => !t.price || t.price <= 0);

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col bg-[#F7F8FA]">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">Opérations</p>
          <h1 className="text-xl font-bold text-gray-900">Plan de caisse</h1>
          <p className="text-xs text-gray-400 mt-0.5">Visualise les touches liées à tes fiches techniques et produits vendus.</p>
        </div>
        <Link href="/menu" className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg transition">
          Gérer le menu <ArrowRight size={13} />
        </Link>
      </div>

      {touches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-xs">
            <div className="text-4xl mb-3">🗂</div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Aucun article dans le menu</h2>
            <p className="text-sm text-gray-500 mb-4">Ajoute des recettes ou des produits vendus depuis la page Menu.</p>
            <Link href="/menu" className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition inline-block">Aller au menu →</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Category rail */}
          <div className="w-44 shrink-0 bg-white border-r border-gray-100 overflow-y-auto py-2">
            {categories.map((cat) => {
              const hasUnpriced = cat.items.some((i) => !i.price || i.price <= 0);
              return (
                <button
                  key={cat.name}
                  onClick={() => { setActiveCat(cat.name); setSelected(null); }}
                  className={clsx(
                    "w-full text-left px-4 py-3 text-sm transition-all flex items-center justify-between gap-2",
                    activeCat === cat.name
                      ? "bg-emerald-50 text-emerald-700 font-semibold border-r-2 border-emerald-500"
                      : "text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <span className="truncate">{cat.name}</span>
                  <span className={clsx("text-xs rounded-full px-1.5 py-0.5 font-medium shrink-0", activeCat === cat.name ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-500")}>
                    {cat.items.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Touch grid */}
          <div className="flex-1 overflow-y-auto p-5">
            {unpriced.length > 0 && (
              <div className="mb-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                <span>
                  <strong>{unpriced.length} article{unpriced.length > 1 ? "s" : ""} sans prix de vente</strong> — ils apparaissent dans la caisse mais ne seront pas encaissables.{" "}
                  <Link href="/menu" className="underline underline-offset-2 hover:text-amber-900">Définir les prix →</Link>
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {activeItems.map((item) => {
                const hasPrice = item.price && item.price > 0;
                const isSelected = selected?.id === item.id && selected?.type === item.type;
                return (
                  <button
                    key={`${item.type}:${item.id}`}
                    onClick={() => setSelected(isSelected ? null : item)}
                    className={clsx(
                      "relative text-left rounded-xl border p-4 transition-all",
                      isSelected
                        ? "border-emerald-400 bg-emerald-50 shadow-md"
                        : hasPrice
                          ? "border-gray-200 bg-white hover:border-emerald-200 hover:shadow-md"
                          : "border-dashed border-amber-300 bg-amber-50/50 hover:border-amber-400"
                    )}
                  >
                    {/* Link badge */}
                    <span className={clsx(
                      "absolute top-2.5 right-2.5 inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-md",
                      item.type === "recipe"
                        ? "bg-violet-100 text-violet-700"
                        : "bg-blue-100 text-blue-700"
                    )}>
                      {item.type === "recipe"
                        ? <><ChefHat size={10} /> FT</>
                        : <><Package size={10} /> Produit</>}
                    </span>

                    <p className="text-sm font-semibold text-gray-900 leading-snug pr-14 line-clamp-2 mb-2">{item.name}</p>

                    {hasPrice ? (
                      <p className="text-base font-bold text-emerald-600">€{Number(item.price).toFixed(2)}</p>
                    ) : (
                      <p className="text-xs font-medium text-amber-600 flex items-center gap-1"><AlertTriangle size={11} /> Prix manquant</p>
                    )}

                    {hasPrice && item.cost > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        food cost {((item.cost / Number(item.price)) * 100).toFixed(0)}%
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="w-64 shrink-0 bg-white border-l border-gray-100 p-5 overflow-y-auto">
              <div className="mb-4">
                <span className={clsx(
                  "inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md mb-3",
                  selected.type === "recipe" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"
                )}>
                  {selected.type === "recipe" ? <><ChefHat size={12} /> Fiche Technique</> : <><Package size={12} /> Produit vendu</>}
                </span>
                <h3 className="text-base font-bold text-gray-900 mb-1">{selected.name}</h3>
                <p className="text-xs text-gray-500 mb-4">Catégorie : {selected.category}</p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Prix de vente</span>
                  <span className="font-semibold text-gray-900">{selected.price ? `€${Number(selected.price).toFixed(2)}` : <span className="text-amber-600">Non défini</span>}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Coût matière</span>
                  <span className="font-semibold text-gray-900">€{selected.cost.toFixed(2)}</span>
                </div>
                {selected.price && selected.price > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Marge €</span>
                      <span className="font-semibold text-emerald-600">€{(Number(selected.price) - selected.cost).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Food cost</span>
                      <span className="font-semibold text-gray-900">{((selected.cost / Number(selected.price)) * 100).toFixed(1)}%</span>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Lié à</p>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  {selected.type === "recipe"
                    ? <><ChefHat size={14} className="text-violet-500 shrink-0" /> Fiche technique (déstockage auto)</>
                    : <><Package size={14} className="text-blue-500 shrink-0" /> Ingrédient vendu à l'unité</>}
                </div>
                <Link
                  href={selected.type === "recipe" ? "/recipes" : "/ingredients"}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition"
                >
                  Voir dans {selected.type === "recipe" ? "les recettes" : "les ingrédients"} <ArrowRight size={12} />
                </Link>
                <Link
                  href="/menu"
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition"
                >
                  Modifier le prix <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
