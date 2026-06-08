import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Load the restaurant for this user
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, target_food_cost_pct")
    .eq("owner_id", user.id)
    .single();

  // If no restaurant yet, send to onboarding
  if (!restaurant) redirect("/onboarding");

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <Sidebar restaurantName={restaurant.name} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
