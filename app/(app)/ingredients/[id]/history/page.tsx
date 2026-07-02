import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, RotateCcw, AlertTriangle, ShoppingCart, FileText, Utensils } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtNum(n: number) {
  return Number(n.toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}
// Display a base quantity (g/ml/unit) in kg / L / pièce.
function formatQty(qty: number, unit: string) {
  if (unit === "kg" || unit === "g") return `${fmtNum(qty / 1000)} kg`;
  if (unit === "l" || unit === "ml") return `${fmtNum(qty / 1000)} L`;
  return `${fmtNum(qty)} ${unit === "unit" ? "u" : unit}`;
}
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y}`;
}

// Human label + style for each movement, based on reference_type first then movement_type.
function moveMeta(m: { movement_type: string; reference_type: string | null; loss_reason?: string | null }) {
  const ref = m.reference_type ?? "";
  if (ref === "delivery") return { label: "Réception (commande)", icon: ShoppingCart, color: "text-emerald-600", sign: "+" };
  if (ref === "invoice") return { label: "Facture", icon: FileText, color: "text-emerald-600", sign: "+" };
  if (ref === "sale") return { label: "Vente — déstockage", icon: Utensils, color: "text-gray-600", sign: "-" };
  if (ref === "loss") return { label: `Perte${m.loss_reason ? ` · ${m.loss_reason}` : ""}`, icon: AlertTriangle, color: "text-red-500", sign: "-" };
  if (ref === "inventory") return { label: "Inventaire — ajustement", icon: RotateCcw, color: "text-blue-600", sign: "±" };
  // Fallback on movement_type
  if (m.movement_type === "in") return { label: "Entrée", icon: TrendingUp, color: "text-emerald-600", sign: "+" };
  if (m.movement_type === "loss") return { label: `Perte${m.loss_reason ? ` · ${m.loss_reason}` : ""}`, icon: AlertTriangle, color: "text-red-500", sign: "-" };
  if (m.movement_type === "adjustment") return { label: "Ajustement", icon: RotateCcw, color: "text-blue-600", sign: "±" };
  return { label: "Sortie", icon: TrendingDown, color: "text-gray-600", sign: "-" };
}

export default async function IngredientHistoryPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: ingredient }, { data: movements }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit")
      .eq("id", params.id)
      .eq("restaurant_id", restaurant!.id)
      .single(),
    supabase
      .from("stock_movements")
      .select("movement_type, qty, unit_cost, reference_type, loss_reason, notes, created_at")
      .eq("restaurant_id", restaurant!.id)
      .eq("ingredient_id", params.id)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  if (!ingredient) return notFound();

  const unit = ingredient.unit;
  const stock = Number(ingredient.stock_qty ?? 0);
  const cmup = Number(ingredient.cmup ?? ingredient.cost_per_base_unit ?? 0);
  const moves = movements ?? [];

  // Totals
  const totalIn = moves.filter((m) => m.movement_type === "in").reduce((s, m) => s + Number(m.qty), 0);
  const totalOut = moves.filter((m) => m.movement_type === "out").reduce((s, m) => s + Number(m.qty), 0);
  const totalLoss = moves.filter((m) => m.movement_type === "loss").reduce((s, m) => s + Number(m.qty), 0);

  // Group by month
  const byMonth = new Map<string, typeof moves>();
  for (const m of moves) {
    const key = m.created_at.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(m);
  }
  const months = Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-5">
        <Link href="/inventaire" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Stock &amp; inventaire
        </Link>
        <Link href={`/ingredients/${ingredient.id}`} className="text-sm text-emerald-600 hover:text-emerald-700">Fiche produit →</Link>
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Historique du produit</p>
        <h1 className="text-2xl font-bold text-gray-900">{ingredient.name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{ingredient.category || "—"}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-2xs text-gray-500 uppercase tracking-wide">Stock actuel</p>
          <p className="text-lg font-bold text-gray-900">{formatQty(stock, unit)}</p>
          <p className="text-2xs text-gray-400">valeur €{(stock * cmup).toFixed(2)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-2xs text-gray-500 uppercase tracking-wide">Total entré</p>
          <p className="text-lg font-bold text-emerald-600">{formatQty(totalIn, unit)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-2xs text-gray-500 uppercase tracking-wide">Total vendu</p>
          <p className="text-lg font-bold text-gray-700">{formatQty(totalOut, unit)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-2xs text-gray-500 uppercase tracking-wide">Total perdu</p>
          <p className="text-lg font-bold text-red-500">{formatQty(totalLoss, unit)}</p>
        </div>
      </div>

      {/* Timeline */}
      {moves.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-500">Aucun mouvement enregistré pour ce produit.</p>
          <p className="text-xs text-gray-400 mt-1">Les réceptions, ventes, pertes et inventaires apparaîtront ici.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {months.map(([mk, list]) => (
            <div key={mk}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{monthLabel(mk)}</p>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
                {list.map((m, i) => {
                  const meta = moveMeta(m);
                  const Icon = meta.icon;
                  const qty = Number(m.qty);
                  const val = qty * Number(m.unit_cost ?? 0);
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                        <Icon size={15} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{meta.label}</p>
                        <p className="text-2xs text-gray-400">
                          {new Date(m.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {m.notes ? ` · ${m.notes}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${meta.color}`}>{meta.sign}{formatQty(Math.abs(qty), unit)}</p>
                        {val > 0 && <p className="text-2xs text-gray-400">€{val.toFixed(2)}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
