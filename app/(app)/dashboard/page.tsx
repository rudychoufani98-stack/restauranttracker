import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatCard, Card, EmptyState, Button } from "@/components/ui";
import Link from "next/link";

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

  return (
    <div className="p-7 max-w-5xl mx-auto">
      <PageHeader
        title={restaurant.name}
        subtitle={`${restaurant.cuisine_type} · Objectif food cost ${restaurant.target_food_cost_pct}%`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Ingrédients" value={ingredientCount ?? 0} sub="dans votre bibliothèque" />
        <StatCard label="Recettes" value={recipeCount ?? 0} sub="créées" />
        <StatCard
          label="Food cost moyen"
          value={avgFoodCost !== null ? `${avgFoodCost.toFixed(1)}%` : "—"}
          sub={`objectif ${restaurant.target_food_cost_pct}%`}
          color={avgFoodCost === null ? "default" : avgFoodCost <= restaurant.target_food_cost_pct ? "green" : avgFoodCost <= restaurant.target_food_cost_pct * 1.2 ? "amber" : "red"}
        />
        <StatCard label="Commandes" value={orderCount ?? 0} sub="total" />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { href: "/ingredients", icon: "📦", label: "Ingrédients", sub: `${ingredientCount} produit${(ingredientCount ?? 0) !== 1 ? "s" : ""}` },
            { href: "/recipes", icon: "👨‍🍳", label: "Recettes", sub: `${recipeCount} créée${(recipeCount ?? 0) !== 1 ? "s" : ""}` },
            { href: "/menu", icon: "📋", label: "Marges du menu", sub: `${priced.length} plat${priced.length !== 1 ? "s" : ""} tarifé${priced.length !== 1 ? "s" : ""}` },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:border-green/40 hover:shadow-md transition-all cursor-pointer group">
                <div className="text-2xl mb-3">{item.icon}</div>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-green transition">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
