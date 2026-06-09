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
        subtitle={`${restaurant.cuisine_type} · Target food cost ${restaurant.target_food_cost_pct}%`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Ingredients" value={ingredientCount ?? 0} sub="in your library" />
        <StatCard label="Recipes" value={recipeCount ?? 0} sub="built" />
        <StatCard
          label="Avg food cost"
          value={avgFoodCost !== null ? `${avgFoodCost.toFixed(1)}%` : "—"}
          sub={`target ${restaurant.target_food_cost_pct}%`}
          color={avgFoodCost === null ? "default" : avgFoodCost <= restaurant.target_food_cost_pct ? "green" : avgFoodCost <= restaurant.target_food_cost_pct * 1.2 ? "amber" : "red"}
        />
        <StatCard label="Purchase orders" value={orderCount ?? 0} sub="total" />
      </div>

      {isEmpty ? (
        <Card>
          <EmptyState
            icon="👋"
            title="Welcome to your restaurant dashboard"
            description="Start by adding your ingredients, then build recipes to see the true cost of every dish on your menu."
            action={
              <div className="flex gap-3 justify-center">
                <Link href="/suppliers">
                  <Button variant="secondary">Add a supplier</Button>
                </Link>
                <Link href="/ingredients">
                  <Button variant="primary">Add ingredients →</Button>
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { href: "/ingredients", icon: "📦", label: "Ingredients", sub: `${ingredientCount} items` },
            { href: "/recipes", icon: "👨‍🍳", label: "Recipes", sub: `${recipeCount} built` },
            { href: "/menu", icon: "📋", label: "Menu margins", sub: `${priced.length} priced dishes` },
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
