import { redirect } from "next/navigation";
import { getCurrentUser, getRestaurant } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  // Load the restaurant for this user (cached — shared with the page below)
  const restaurant = await getRestaurant();

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
