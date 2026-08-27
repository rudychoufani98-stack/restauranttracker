import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, getRestaurant, isAppAdmin, ADMIN_RESTAURANT_COOKIE } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import AssistantWidget from "@/components/AssistantWidget";
import { closeRestaurant } from "@/app/admin/actions";
import { Crown, ArrowLeft } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  // Un super-admin vit dans son panel : il n'entre dans l'interface d'un
  // restaurant (Amaly compris) qu'après avoir explicitement « ouvert » un
  // client depuis /admin.
  const admin = await isAppAdmin();
  const openedClient = cookies().get(ADMIN_RESTAURANT_COOKIE)?.value ?? null;
  if (admin && !openedClient) redirect("/admin");

  // Load the restaurant for this user (cached — shared with the page below).
  // For a super-admin who "opened" a client, this is the CLIENT's restaurant.
  const restaurant = await getRestaurant();

  // If no restaurant yet, send to onboarding
  if (!restaurant) redirect("/onboarding");

  const impersonating = admin && !!openedClient;

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <Sidebar restaurantName={restaurant.name} isAdmin={admin} />
      {/* pt-16 sous lg : laisse la place au bouton de menu, qui est fixe en
          haut a gauche et recouvrirait sinon le titre de la page. */}
      <main className="flex-1 overflow-auto pt-16 lg:pt-0">
        {impersonating && (
          <div className="sticky top-0 z-50 bg-primary text-on-primary px-6 py-2.5 flex items-center justify-between gap-3 shadow-lg">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Crown size={15} /> Mode admin — tu gères le client : <b>{restaurant.name}</b>
            </p>
            <form action={closeRestaurant}>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-white/15 hover:bg-white/25 rounded-lg transition">
                <ArrowLeft size={13} /> Revenir à mon compte
              </button>
            </form>
          </div>
        )}
        {children}
      </main>
      <AssistantWidget />
    </div>
  );
}
