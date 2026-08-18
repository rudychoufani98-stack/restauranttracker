import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAppAdmin, ADMIN_RESTAURANT_COOKIE } from "@/lib/auth";
import { openRestaurant, closeRestaurant, createCustomer } from "./actions";
import { Building2, Package, ShoppingCart, ChefHat, ArrowRight, ArrowLeft, Crown, UserPlus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams?: { ok?: string; err?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await isAppAdmin())) redirect("/dashboard");

  const supabase = createClient();
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, name, owner_id, created_at")
    .order("created_at", { ascending: true });

  const openId = cookies().get(ADMIN_RESTAURANT_COOKIE)?.value ?? null;

  // Vision globale par projet (volumes faibles : quelques requêtes par client)
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const stats = await Promise.all(
    (restaurants ?? []).map(async (r) => {
      const [ing, orders, recipes, lastOrder, stockRows, monthOrders] = await Promise.all([
        supabase.from("ingredients").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("recipes").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id),
        supabase.from("purchase_orders").select("created_at").eq("restaurant_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("ingredients").select("stock_qty, cmup, cost_per_base_unit").eq("restaurant_id", r.id),
        supabase.from("purchase_orders").select("expected_total").eq("restaurant_id", r.id).neq("status", "Cancelled").gte("created_at", monthStart.toISOString()),
      ]);
      const stockValue = (stockRows.data ?? []).reduce((s, i: any) => s + Number(i.stock_qty ?? 0) * Number(i.cmup ?? i.cost_per_base_unit ?? 0), 0);
      const monthSpend = (monthOrders.data ?? []).reduce((s, o: any) => s + Number(o.expected_total ?? 0), 0);
      return {
        ...r,
        nIngredients: ing.count ?? 0,
        nOrders: orders.count ?? 0,
        nRecipes: recipes.count ?? 0,
        lastActivity: lastOrder.data?.created_at ?? null,
        stockValue,
        monthSpend,
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
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-amaly.svg" alt="" className="w-9 h-9" />
              <h1 className="text-3xl font-extrabold text-primary tracking-tight">Mes clients</h1>
            </div>
            <p className="text-sm text-on-surface-variant/70 mt-1">
              {stats.length} projet{stats.length !== 1 ? "s" : ""} sur la plateforme — vue d&apos;ensemble. Clique « Ouvrir » pour entrer dans l&apos;interface d&apos;un client (un bandeau te rappellera chez qui tu es).
            </p>
          </div>
          {openId && (
            <form action={closeRestaurant}>
              <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
                <ArrowLeft size={15} /> Fermer le client ouvert
              </button>
            </form>
          )}
        </div>

        {/* Messages de la création de client */}
        {searchParams?.ok && (
          <div className="mb-4 text-sm text-primary bg-emerald-50 border border-primary/20 rounded-xl px-4 py-3">✅ {searchParams.ok}</div>
        )}
        {searchParams?.err && (
          <div className="mb-4 text-sm text-red bg-red-light border border-red/20 rounded-xl px-4 py-3">⚠️ {searchParams.err}</div>
        )}

        {/* Créer un client — réservé à toi */}
        <details className="glass-card rounded-2xl mb-6 overflow-hidden group">
          <summary className="flex items-center gap-2.5 px-5 py-4 cursor-pointer text-sm font-semibold text-primary hover:bg-surface-container-low/40 transition list-none">
            <UserPlus size={17} /> Créer un nouveau client
            <span className="ml-auto text-2xs text-on-surface-variant/50 font-normal group-open:hidden">cliquer pour ouvrir</span>
          </summary>
          <form action={createCustomer} className="px-5 pb-5 pt-1 flex flex-wrap items-end gap-3 border-t border-outline-variant/20">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1 mt-3">Nom du restaurant</label>
              <input name="restaurant_name" required placeholder="ex. Chez Marco"
                className="w-full px-3 py-2.5 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1 mt-3">Email du client</label>
              <input name="email" type="email" required placeholder="patron@chezmarco.fr"
                className="w-full px-3 py-2.5 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1 mt-3">Mot de passe provisoire</label>
              <input name="password" type="text" required minLength={8} placeholder="8 caractères min."
                className="w-full px-3 py-2.5 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg active:scale-[0.98]">
              <UserPlus size={15} /> Créer le client
            </button>
            <p className="w-full text-2xs text-on-surface-variant/50 mt-1">
              Son espace est créé vierge. Transmets-lui son email + mot de passe provisoire — il pourra le changer via « Mot de passe oublié ? ».
            </p>
          </form>
        </details>

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
                  {r.isMine && <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-50 text-primary text-2xs font-bold uppercase tracking-wide">Client n°1</span>}
                  {openId === r.id && <span className="inline-flex px-2 py-0.5 rounded-full bg-primary text-on-primary text-2xs font-bold uppercase tracking-wide">Ouvert actuellement</span>}
                </div>
                <p className="text-2xs text-on-surface-variant/60 mt-0.5">
                  Client depuis le {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  {r.lastActivity && <> · dernière commande le {new Date(r.lastActivity).toLocaleDateString("fr-FR")}</>}
                </p>
                <div className="flex items-center gap-4 mt-2 text-sm text-on-surface-variant/80 flex-wrap">
                  <span className="font-semibold text-primary tabular-nums" title="Valeur du stock">Stock : €{r.stockValue.toFixed(0)}</span>
                  <span className="tabular-nums" title="Dépenses du mois (commandes)">Achats ce mois : €{r.monthSpend.toFixed(0)}</span>
                  <span className="flex items-center gap-1.5" title="Ingrédients"><Package size={14} className="text-on-surface-variant/50" /> {r.nIngredients}</span>
                  <span className="flex items-center gap-1.5" title="Recettes"><ChefHat size={14} className="text-on-surface-variant/50" /> {r.nRecipes}</span>
                  <span className="flex items-center gap-1.5" title="Commandes"><ShoppingCart size={14} className="text-on-surface-variant/50" /> {r.nOrders}</span>
                </div>
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
          💡 L&apos;inscription publique est fermée : seuls les clients que tu crées ici (bouton « Créer un nouveau client ») peuvent accéder à la plateforme.
        </p>
      </div>
    </div>
  );
}
