import { createClient } from "@/lib/supabase/server";
import { StatCard, Card, EmptyState, Button } from "@/components/ui";
import Link from "next/link";
import { Percent, AlertTriangle, Warehouse, Trash2, ArrowRight, ArrowUpRight } from "lucide-react";

const CUISINE_FR: Record<string, string> = {
  "French": "Française", "Italian": "Italienne", "Japanese": "Japonaise",
  "Chinese": "Chinoise", "Indian": "Indienne", "Mediterranean": "Méditerranéenne",
  "American": "Américaine", "Mexican": "Mexicaine", "Other": "Autre",
};

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user!.id)
    .single();

  const target = restaurant.target_food_cost_pct;

  // Current month start (ISO)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    { data: recipes },
    { data: ingredients },
    { data: losses },
    { count: ingredientCount },
  ] = await Promise.all([
    supabase.from("recipes").select("id, name, category, total_cost, menu_price, yield_portions").eq("restaurant_id", restaurant.id).eq("is_prep", false),
    supabase.from("ingredients").select("stock_qty, cmup, cost_per_base_unit").eq("restaurant_id", restaurant.id),
    supabase.from("stock_movements").select("qty, unit_cost").eq("restaurant_id", restaurant.id).eq("movement_type", "loss").gte("created_at", monthStart.toISOString()),
    supabase.from("ingredients").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
  ]);

  const allRecipes = recipes ?? [];
  const isEmpty = (ingredientCount ?? 0) === 0 && allRecipes.length === 0;

  // ── Food cost / margin analytics ──
  const foodCostOf = (r: any) => {
    if (!r.menu_price || r.menu_price <= 0) return null;
    const cpp = r.total_cost / (r.yield_portions || 1);
    return (cpp / r.menu_price) * 100;
  };
  const priced = allRecipes.filter((r) => r.menu_price && r.menu_price > 0);
  const avgFoodCost = priced.length > 0
    ? priced.reduce((s, r) => s + (foodCostOf(r) ?? 0), 0) / priced.length
    : null;
  const avgMargin = avgFoodCost === null ? null : 100 - avgFoodCost;
  const offTarget = priced.filter((r) => (foodCostOf(r) ?? 0) > target).length;
  const worst = [...priced]
    .map((r) => ({ ...r, fc: foodCostOf(r)!, cpp: r.total_cost / (r.yield_portions || 1) }))
    .sort((a, b) => b.fc - a.fc)
    .slice(0, 5);

  // ── Stock value ──
  const stockValue = (ingredients ?? []).reduce((s, i: any) => {
    const qty = Number(i.stock_qty ?? 0);
    const cost = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
    return s + qty * cost;
  }, 0);

  // ── Losses this month ──
  const lossesValue = (losses ?? []).reduce((s, m: any) => s + Number(m.qty) * Number(m.unit_cost ?? 0), 0);

  const cuisineFr = CUISINE_FR[restaurant.cuisine_type] ?? restaurant.cuisine_type;
  const fcColorLight = avgFoodCost === null ? "text-gray-300"
    : avgFoodCost <= target ? "text-emerald-600"
    : avgFoodCost <= target * 1.2 ? "text-amber-600" : "text-red-600";
  const statusFc = (fc: number) => fc <= target ? "text-emerald-600" : fc <= target * 1.2 ? "text-amber-600" : "text-red-600";

  // ── Guide "Par où commencer" ──
  const steps = [
    { done: (ingredientCount ?? 0) > 0, label: "Ajoute tes ingrédients", desc: "Tes produits et leurs prix d'achat", href: "/ingredients", cta: "Ajouter" },
    { done: allRecipes.length > 0,      label: "Crée tes recettes",      desc: "Compose tes plats avec les ingrédients", href: "/recipes", cta: "Créer" },
    { done: priced.length > 0,          label: "Mets tes prix de vente", desc: "Sur ta carte, pour voir tes marges", href: "/menu", cta: "Définir" },
  ];
  const setupDone = steps.filter((s) => s.done).length;
  const setupComplete = setupDone === steps.length;
  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* Clean light header */}
      <div className="px-8 pt-8 pb-5 max-w-5xl mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-emerald-600 text-xs font-semibold uppercase tracking-widest mb-1">Accueil</p>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{restaurant.name}</h1>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="inline-flex px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">{cuisineFr}</span>
              <span className="inline-flex px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">Objectif food cost {target}%</span>
            </div>
          </div>
          {!isEmpty && (
            <div className="text-right">
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-1">Food cost moyen</p>
              <p className={`text-4xl font-bold tracking-tight ${fcColorLight}`}>
                {avgFoodCost !== null ? `${avgFoodCost.toFixed(1)}%` : "—"}
              </p>
              {avgFoodCost !== null && (
                <p className="text-gray-400 text-xs mt-1">
                  {avgFoodCost <= target ? "dans l'objectif 👍" : `+${(avgFoodCost - target).toFixed(1)} pts vs objectif`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-8 max-w-5xl mx-auto pb-12">
        {/* Guide "Par où commencer" — tant que la config n'est pas finie */}
        {!setupComplete && (
          <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">Par où commencer ?</h2>
                <p className="text-sm text-gray-500 mt-0.5">3 étapes simples pour connaître tes marges.</p>
              </div>
              <span className="text-sm font-semibold text-emerald-600">{setupDone}/3</span>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={s.href} className={`flex items-center gap-3 p-3 rounded-lg border ${s.done ? "border-emerald-100 bg-emerald-50/40" : "border-gray-100 bg-gray-50/50"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${s.done ? "bg-emerald-500 text-white" : "bg-white border border-gray-200 text-gray-400"}`}>
                    {s.done ? "✓" : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${s.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{s.label}</p>
                    {!s.done && <p className="text-xs text-gray-500">{s.desc}</p>}
                  </div>
                  {!s.done && (
                    <Link href={s.href} className={`px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0 ${nextStep?.href === s.href ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-emerald-600 hover:bg-emerald-50"}`}>
                      {s.cta} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isEmpty ? null : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="Marge brute moyenne"
                value={avgMargin !== null ? `${avgMargin.toFixed(1)}%` : "—"}
                sub={avgFoodCost !== null ? `food cost ${avgFoodCost.toFixed(1)}%` : "définissez vos prix"}
                color="green"
                icon={<Percent size={15} />}
              />
              <StatCard
                label="Plats hors objectif"
                value={offTarget}
                sub={`sur ${priced.length} plat${priced.length !== 1 ? "s" : ""} tarifé${priced.length !== 1 ? "s" : ""}`}
                color={offTarget > 0 ? "red" : "green"}
                icon={<AlertTriangle size={15} />}
              />
              <StatCard
                label="Valeur du stock"
                value={`€${stockValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
                sub="au CMUP"
                color="blue"
                icon={<Warehouse size={15} />}
              />
              <StatCard
                label="Pertes ce mois"
                value={`€${lossesValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
                sub="DLC, casse, écart…"
                color={lossesValue > 0 ? "amber" : "default"}
                icon={<Trash2 size={15} />}
              />
            </div>

            {/* Plats à surveiller */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Plats à surveiller</h2>
              <Link href="/menu" className="text-xs font-medium text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1">
                Voir le menu <ArrowRight size={12} />
              </Link>
            </div>

            {priced.length === 0 ? (
              <Card className="text-center py-10">
                <p className="text-sm text-gray-500 mb-3">Aucun prix de vente défini. Renseignez vos prix pour voir vos marges.</p>
                <Link href="/menu"><Button variant="primary" size="sm">Définir les prix du menu →</Button></Link>
              </Card>
            ) : (
              <div className="bg-white border border-gray-100 rounded-card shadow-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-2xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-3">Plat</th>
                      <th className="text-right px-5 py-3">Coût / portion</th>
                      <th className="text-right px-5 py-3">Prix carte</th>
                      <th className="text-right px-5 py-3">Marge €</th>
                      <th className="text-right px-5 py-3">Food cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {worst.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50 transition">
                        <td className="px-5 py-3 font-medium text-gray-900">{r.name}
                          <span className="block text-2xs text-gray-400 font-normal">{r.category}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-gray-600">€{r.cpp.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right text-gray-600">€{Number(r.menu_price).toFixed(2)}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">€{(Number(r.menu_price) - r.cpp).toFixed(2)}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={`font-semibold ${statusFc(r.fc)}`}>{r.fc.toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Raccourcis analyse */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              {[
                { href: "/rentabilite", label: "Rentabilité", sub: "Saisir les ventes du mois", icon: <ArrowUpRight size={16} /> },
                { href: "/inventaire", label: "Inventaire", sub: "Stock & prise d'inventaire", icon: <Warehouse size={16} /> },
                { href: "/pertes", label: "Pertes", sub: "Gaspillage & casse", icon: <Trash2 size={16} /> },
              ].map((it) => (
                <Link key={it.href} href={it.href} className="group">
                  <div className="bg-white border border-gray-100 rounded-card shadow-card p-4 flex items-center justify-between hover:shadow-card-hover transition-all">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{it.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{it.sub}</p>
                    </div>
                    <span className="text-gray-300 group-hover:text-emerald-600 transition">{it.icon}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
