import { createClient } from "@/lib/supabase/server";
import { StatCard, Card, EmptyState, Button } from "@/components/ui";
import Link from "next/link";
import { Package, ChefHat, TrendingUp, ShoppingCart, ArrowRight, ChevronRight } from "lucide-react";

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

  const [
    { count: ingredientCount },
    { count: recipeCount },
    { count: orderCount },
    { data: recipes },
  ] = await Promise.all([
    supabase.from("ingredients").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    supabase.from("recipes").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    supabase.from("purchase_orders").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    supabase.from("recipes").select("name, total_cost, menu_price, yield_portions").eq("restaurant_id", restaurant.id),
  ]);

  const priced = (recipes ?? []).filter((r) => r.menu_price && r.menu_price > 0);
  const avgFoodCost = priced.length > 0
    ? priced.reduce((sum, r) => {
        const cpp = r.total_cost / (r.yield_portions || 1);
        return sum + (cpp / r.menu_price) * 100;
      }, 0) / priced.length
    : null;

  const isEmpty = (ingredientCount ?? 0) === 0;
  const cuisineFr = CUISINE_FR[restaurant.cuisine_type] ?? restaurant.cuisine_type;

  const fcColor = avgFoodCost === null ? "default"
    : avgFoodCost <= restaurant.target_food_cost_pct ? "green"
    : avgFoodCost <= restaurant.target_food_cost_pct * 1.2 ? "amber" : "red";

  return (
    <div className="min-h-screen">
      {/* Hero banner */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-emerald-900 px-8 pt-8 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-1">Tableau de bord</p>
              <h1 className="text-3xl font-bold text-white tracking-tight">{restaurant.name}</h1>
              <div className="flex items-center gap-3 mt-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-white/70 text-xs font-medium">
                  {cuisineFr}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-white/70 text-xs font-medium">
                  Objectif food cost {restaurant.target_food_cost_pct}%
                </span>
              </div>
            </div>
            {avgFoodCost !== null && (
              <div className="text-right hidden md:block">
                <p className="text-white/50 text-xs font-medium uppercase tracking-wide mb-1">Food cost moyen</p>
                <p className={`text-4xl font-bold ${avgFoodCost <= restaurant.target_food_cost_pct ? "text-emerald-400" : avgFoodCost <= restaurant.target_food_cost_pct * 1.2 ? "text-amber-400" : "text-red-400"}`}>
                  {avgFoodCost.toFixed(1)}%
                </p>
                <p className="text-white/40 text-xs mt-0.5">objectif {restaurant.target_food_cost_pct}%</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 -mt-5 max-w-5xl mx-auto pb-10">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Ingrédients"
            value={ingredientCount ?? 0}
            sub="dans votre bibliothèque"
            color="blue"
            icon={<Package size={15} />}
          />
          <StatCard
            label="Recettes"
            value={recipeCount ?? 0}
            sub="créées"
            color="default"
            icon={<ChefHat size={15} />}
          />
          <StatCard
            label="Food cost moyen"
            value={avgFoodCost !== null ? `${avgFoodCost.toFixed(1)}%` : "—"}
            sub={`objectif ${restaurant.target_food_cost_pct}%`}
            color={fcColor}
            icon={<TrendingUp size={15} />}
          />
          <StatCard
            label="Commandes"
            value={orderCount ?? 0}
            sub="bons de commande"
            color="default"
            icon={<ShoppingCart size={15} />}
          />
        </div>

        {isEmpty ? (
          <Card>
            <EmptyState
              icon="👋"
              title="Bienvenue sur votre tableau de bord"
              description="Commencez par ajouter vos ingrédients, puis créez des recettes pour connaître le vrai coût de chaque plat."
              action={
                <div className="flex gap-3 justify-center">
                  <Link href="/suppliers">
                    <Button variant="secondary">Ajouter un fournisseur</Button>
                  </Link>
                  <Link href="/ingredients">
                    <Button variant="primary">Ajouter des ingrédients →</Button>
                  </Link>
                </div>
              }
            />
          </Card>
        ) : (
          <>
            {/* Quick access grid */}
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Accès rapide</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {[
                {
                  href: "/ingredients",
                  icon: "📦",
                  iconBg: "bg-blue-50",
                  label: "Ingrédients",
                  sub: `${ingredientCount} produit${(ingredientCount ?? 0) !== 1 ? "s" : ""}`,
                  accent: "group-hover:text-blue-600",
                  border: "group-hover:border-blue-200",
                },
                {
                  href: "/recipes",
                  icon: "👨‍🍳",
                  iconBg: "bg-emerald-50",
                  label: "Recettes",
                  sub: `${recipeCount} créée${(recipeCount ?? 0) !== 1 ? "s" : ""}`,
                  accent: "group-hover:text-emerald-600",
                  border: "group-hover:border-emerald-200",
                },
                {
                  href: "/menu",
                  icon: "📋",
                  iconBg: "bg-purple-50",
                  label: "Marges du menu",
                  sub: `${priced.length} plat${priced.length !== 1 ? "s" : ""} tarifé${priced.length !== 1 ? "s" : ""}`,
                  accent: "group-hover:text-purple-600",
                  border: "group-hover:border-purple-200",
                },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="group">
                  <div className={`bg-white border border-gray-200 rounded-card shadow-card p-5 hover:shadow-card-hover transition-all cursor-pointer ${item.border}`}>
                    <div className="flex items-start justify-between">
                      <div className={`w-10 h-10 rounded-xl ${item.iconBg} flex items-center justify-center text-xl mb-3`}>
                        {item.icon}
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition mt-1" />
                    </div>
                    <p className={`text-sm font-semibold text-gray-900 transition ${item.accent}`}>{item.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* Workflow steps */}
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Workflow mensuel</h2>
            <div className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
              {[
                { step: "1", label: "Passer une commande fournisseur", href: "/orders", color: "bg-blue-500" },
                { step: "2", label: "Réceptionner & valider la facture", href: "/orders", color: "bg-purple-500" },
                { step: "3", label: "Vérifier le stock en inventaire", href: "/inventaire", color: "bg-amber-500" },
                { step: "4", label: "Saisir les ventes du mois", href: "/rentabilite", color: "bg-emerald-500" },
              ].map((item, i, arr) => (
                <Link key={item.step} href={item.href} className="group">
                  <div className={`flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition ${i < arr.length - 1 ? "border-b border-gray-100" : ""}`}>
                    <div className={`w-6 h-6 rounded-full ${item.color} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                      {item.step}
                    </div>
                    <p className="text-sm text-gray-700 font-medium flex-1">{item.label}</p>
                    <ArrowRight size={14} className="text-gray-300 group-hover:text-gray-500 transition" />
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
