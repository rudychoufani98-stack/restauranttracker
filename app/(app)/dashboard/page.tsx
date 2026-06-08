import { createClient } from "@/lib/supabase/server";
import { TrendingUp, Package, ChefHat, ShoppingCart } from "lucide-react";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user!.id)
    .single();

  const [{ count: ingredientCount }, { count: recipeCount }, { count: orderCount }] =
    await Promise.all([
      supabase.from("ingredients").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
      supabase.from("recipes").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
      supabase.from("purchase_orders").select("*", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    ]);

  const stats = [
    { label: "Ingredients", value: ingredientCount ?? 0, icon: Package, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Recipes", value: recipeCount ?? 0, icon: ChefHat, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Purchase orders", value: orderCount ?? 0, icon: ShoppingCart, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Target food cost", value: `${restaurant.target_food_cost_pct}%`, icon: TrendingUp, color: "text-violet-500", bg: "bg-violet-50" },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-medium text-gray-900">
          {restaurant.name}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {restaurant.cuisine_type} · Target food cost {restaurant.target_food_cost_pct}%
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white border border-[#E5E7EB] rounded-card p-4">
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${bg} mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-medium text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Empty state hint */}
      {(ingredientCount === 0) && (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-8 text-center">
          <div className="text-4xl mb-3">👋</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Welcome to your dashboard</h2>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Start by adding your ingredients, then build recipes to see the true cost of every dish.
          </p>
          <div className="flex justify-center gap-3 mt-5">
            <a
              href="/suppliers"
              className="px-4 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition"
            >
              Add a supplier
            </a>
            <a
              href="/ingredients"
              className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition"
            >
              Add ingredients →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
