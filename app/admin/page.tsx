import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAppAdmin, ADMIN_RESTAURANT_COOKIE } from "@/lib/auth";
import { openRestaurant, closeRestaurant } from "./actions";
import { Building2, Package, ShoppingCart, ChefHat, ArrowRight, ArrowLeft, Crown } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await isAppAdmin())) redirect("/dashboard");

  const supabase = createClient();
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, name, owner_id, created_at")
    .order("created_at", { ascending: true });

  const openId = cookies().get(ADMIN_RESTAURANT_COOKIE)?.value ?? null;

  // Stats par client (volumes faibles : quelques requêtes par restaurant)
  const stats = await Promise.all(
    (restaurants ?? []).map(async (r) => {
      const [ing, orders, recipes, lastOrder] = await Promise.all([
        supabase.from("ingredients").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("recipes").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("purchase_orders").select("created_at").eq("restaurant_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        ...r,
        nIngredients: ing.count ?? 0,
        nOrders: orders.count ?? 0,
        nRecipes: recipes.count ?? 0,
        lastActivity: lastOrder.data?.created_at ?? null,
        isMine: r.owner_id === user.id,
      };
    })
  );

  return (
    <div className="min-h-screen bg-surface">
      <div className="p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <Crown size={13} /> Super-admin
            </p>
            <h1 className="text-3xl font-extrabold text-primary tracking-tight">Mes clients</h1>
            <p className="text-sm text-on-surface-variant/70 mt-1">
              {stats.length} restaurant{stats.length !== 1 ? "s" : ""} sur la plateforme. Ouvre un client pour gérer son interface — un bandeau te rappellera chez qui tu es.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {openId && (
              <form action={closeRestaurant}>
                <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                  <ArrowLeft size={15} /> Revenir à mon compte
                </button>
              </form>
            )}
            <Link href="/dashboard"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
              Mon app <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        {/* Clients list */}
        <div className="space-y-4">
          {stats.map((r) => (
            <div key={r.id} className={`glass-card rounded-2xl p-5 flex flex-wrap items-center gap-5 ${openId === r.id ? "ring-2 ring-primary nav-active-glow" : ""}`}>
              <div className="w-12 h-12 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary shrink-0">
                <Building2 size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-on-surface">{r.name}</h2>
                  {r.isMine && <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-50 text-primary text-2xs font-bold uppercase tracking-wide">Ton restaurant</span>}
                  {openId === r.id && <span className="inline-flex px-2 py-0.5 rounded-full bg-primary text-on-primary text-2xs font-bold uppercase tracking-wide">Ouvert actuellement</span>}
                </div>
                <p className="text-2xs text-on-surface-variant/60 mt-0.5">
                  Client depuis le {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  {r.lastActivity && <> · dernière commande le {new Date(r.lastActivity).toLocaleDateString("fr-FR")}</>}
                </p>
              </div>
              <div className="flex items-center gap-5 text-sm text-on-surface-variant/80 shrink-0">
                <span className="flex items-center gap-1.5" title="Ingrédients"><Package size={15} className="text-on-surface-variant/50" /> {r.nIngredients}</span>
                <span className="flex items-center gap-1.5" title="Recettes"><ChefHat size={15} className="text-on-surface-variant/50" /> {r.nRecipes}</span>
                <span className="flex items-center gap-1.5" title="Commandes"><ShoppingCart size={15} className="text-on-surface-variant/50" /> {r.nOrders}</span>
              </div>
              <form action={openRestaurant} className="shrink-0">
                <input type="hidden" name="restaurant_id" value={r.id} />
                <button className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg active:scale-[0.98]">
                  Ouvrir <ArrowRight size={15} />
                </button>
              </form>
            </div>
          ))}
        </div>

        <p className="text-xs text-on-surface-variant/50 mt-6">
          💡 Pour ajouter un client : il crée son compte sur la page d&apos;inscription de l&apos;app, et son restaurant apparaît automatiquement ici.
        </p>
      </div>
    </div>
  );
}
