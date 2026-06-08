import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user!.id)
    .single();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-medium text-gray-900 mb-6">Settings</h1>

      <div className="bg-white border border-[#E5E7EB] rounded-card p-6 space-y-4">
        <h2 className="text-sm font-medium text-gray-700">Restaurant details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Name</p>
            <p className="text-gray-900">{restaurant?.name}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Cuisine type</p>
            <p className="text-gray-900">{restaurant?.cuisine_type}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Target food-cost %</p>
            <p className="text-gray-900">{restaurant?.target_food_cost_pct}%</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Account email</p>
            <p className="text-gray-900">{user?.email}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400">More settings options will appear in later phases.</p>
      </div>
    </div>
  );
}
