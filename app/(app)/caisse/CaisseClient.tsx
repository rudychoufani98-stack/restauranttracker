"use client";

import { useState, useMemo } from "react";
import { ChefHat, Package, AlertTriangle, ArrowRight } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

type Recipe  = { id: string; name: string; category: string; total_cost: number; menu_price: number | null; yield_portions: number; allergens: string[] | null };
type Product = { id: string; name: string; category: string; pack_price: number; selling_price: number | null; allergens: string[] | null };

type Touch = {
  id: string;
  name: string;
  category: string;
  price: number | null;
  type: "recipe" | "product";
  cost: number;
  allergens: string[];
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
      allergens: r.allergens ?? [],
      linked: true,
    }));
    const fromP: Touch[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || "Autre",
      price: p.selling_price,
      type: "product",
      cost: Number(p.pack_price ?? 0),
      allergens: p.allergens ?? [],
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
    <div className="h-[calc(100vh-0px)] flex flex-col bg-surface">
      {/* Header */}
      <div className="glass-card rounded-none border-x-0 border-t-0 border-b border-outline-variant/20 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-0.5">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Plan de caisse</h1>
          <p className="text-sm text-on-surface-variant/70 mt-0.5">Visualise les touches liées à tes fiches techniques et produits vendus.</p>
        </div>
        <Link href="/menu" className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-on-primary-container bg-primary-container px-4 py-2 rounded-xl hover:nav-active-glow transition">
          Gérer le menu <ArrowRight size={13} />
        </Link>
      </div>

      {touches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="glass-card rounded-2xl p-12 text-center max-w-sm">
            <div className="text-4xl mb-3">🗂</div>
            <h2 className="text-lg font-semibold text-on-surface mb-1">Aucun article dans le menu</h2>
            <p className="text-sm text-on-surface-variant/70 mb-5">Ajoute des recettes ou des produits vendus depuis la page Menu.</p>
            <Link href="/menu" className="inline-block px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">Aller au menu →</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Category rail */}
          <div className="w-48 shrink-0 border-r border-outline-variant/20 overflow-y-auto p-3 space-y-1">
            {categories.map((cat) => {
              const active = activeCat === cat.name;
              return (
                <button
                  key={cat.name}
                  onClick={() => { setActiveCat(cat.name); setSelected(null); }}
                  className={clsx(
                    "w-full text-left px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition flex items-center justify-between gap-2",
                    active
                      ? "bg-primary-container text-on-primary-container nav-active-glow"
                      : "text-on-surface-variant/60 hover:bg-surface-container-low"
                  )}
                >
                  <span className="truncate">{cat.name}</span>
                  <span className={clsx("text-2xs rounded-full px-1.5 py-0.5 font-bold shrink-0", active ? "bg-on-primary-container/20 text-on-primary-container" : "bg-surface-container-highest text-on-surface-variant/60")}>
                    {cat.items.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Touch grid */}
          <div className="flex-1 overflow-y-auto p-5">
            {unpriced.length > 0 && (
              <div className="mb-4 flex items-start gap-2.5 bg-amber-light border border-amber/30 rounded-xl px-4 py-3 text-sm text-amber-dark">
                <AlertTriangle size={16} className="text-amber mt-0.5 shrink-0" />
                <span>
                  <strong>{unpriced.length} article{unpriced.length > 1 ? "s" : ""} sans prix de vente</strong> — ils apparaissent dans la caisse mais ne seront pas encaissables.{" "}
                  <Link href="/menu" className="underline underline-offset-2 hover:text-amber-dark">Définir les prix →</Link>
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
                      "relative text-left glass-card rounded-2xl p-5 transition-all",
                      isSelected
                        ? "ring-2 ring-primary nav-active-glow"
                        : hasPrice
                          ? "hover:nav-active-glow"
                          : "border-dashed border-amber/40"
                    )}
                  >
                    {/* Link badge */}
                    <span className={clsx(
                      "absolute top-2.5 right-2.5 inline-flex items-center gap-1 text-2xs font-bold px-1.5 py-0.5 rounded-md",
                      item.type === "recipe"
                        ? "bg-purple-500/10 text-purple-600"
                        : "bg-blue-light text-blue-dark"
                    )}>
                      {item.type === "recipe"
                        ? <><ChefHat size={10} /> FT</>
                        : <><Package size={10} /> Produit</>}
                    </span>

                    <p className="text-sm font-semibold text-on-surface leading-snug pr-14 line-clamp-2 mb-2">{item.name}</p>

                    {hasPrice ? (
                      <p className="text-lg font-bold text-primary tabular-nums">€{Number(item.price).toFixed(2)}</p>
                    ) : (
                      <p className="text-2xs font-bold text-amber-dark flex items-center gap-1"><AlertTriangle size={11} /> Prix manquant</p>
                    )}

                    {hasPrice && item.cost > 0 && (
                      <p className="text-2xs text-on-surface-variant/60 mt-0.5">
                        food cost {((item.cost / Number(item.price)) * 100).toFixed(0)}%
                      </p>
                    )}
                    {item.allergens.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {item.allergens.map((a) => (
                          <span key={a} className="px-1.5 py-0.5 text-2xs rounded bg-amber-light text-amber-dark font-medium">{a}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="w-64 shrink-0 border-l border-outline-variant/20 p-5 overflow-y-auto">
              <div className="mb-4">
                <span className={clsx(
                  "inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider px-2 py-1 rounded-md mb-3",
                  selected.type === "recipe" ? "bg-purple-500/10 text-purple-600" : "bg-blue-light text-blue-dark"
                )}>
                  {selected.type === "recipe" ? <><ChefHat size={12} /> Fiche Technique</> : <><Package size={12} /> Produit vendu</>}
                </span>
                <h3 className="text-lg font-semibold text-on-surface mb-1">{selected.name}</h3>
                <p className="text-xs text-on-surface-variant/60 mb-4">Catégorie : {selected.category}</p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-on-surface-variant/60">Prix de vente</span>
                  <span className="font-semibold text-on-surface tabular-nums">{selected.price ? `€${Number(selected.price).toFixed(2)}` : <span className="text-amber-dark">Non défini</span>}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-on-surface-variant/60">Coût matière</span>
                  <span className="font-semibold text-on-surface tabular-nums">€{selected.cost.toFixed(2)}</span>
                </div>
                {selected.price && selected.price > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-on-surface-variant/60">Marge €</span>
                      <span className="font-semibold text-primary tabular-nums">€{(Number(selected.price) - selected.cost).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-on-surface-variant/60">Food cost</span>
                      <span className="font-semibold text-on-surface tabular-nums">{((selected.cost / Number(selected.price)) * 100).toFixed(1)}%</span>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-outline-variant/20">
                <p className="text-2xs font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">Allergènes</p>
                {selected.allergens.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.allergens.map((a) => (
                      <span key={a} className="px-2 py-0.5 text-xs rounded-full bg-amber-light text-amber-dark font-medium">{a}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant/50">Aucun déclaré sur les ingrédients liés.</p>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-outline-variant/20 space-y-2">
                <p className="text-2xs font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">Lié à</p>
                <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                  {selected.type === "recipe"
                    ? <><ChefHat size={14} className="text-purple-500 shrink-0" /> Fiche technique (déstockage auto)</>
                    : <><Package size={14} className="text-blue shrink-0" /> Ingrédient vendu à l'unité</>}
                </div>
                <Link
                  href={selected.type === "recipe" ? "/recipes" : "/ingredients"}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl py-2 hover:bg-surface-container-low transition"
                >
                  Voir dans {selected.type === "recipe" ? "les recettes" : "les ingrédients"} <ArrowRight size={12} />
                </Link>
                <Link
                  href="/menu"
                  className="w-full flex items-center justify-center gap-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl py-2 hover:bg-surface-container-low transition"
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
