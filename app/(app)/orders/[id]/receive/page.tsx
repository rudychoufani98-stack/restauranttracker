import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ReceiveClient from "./ReceiveClient";

export default async function ReceivePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(name, email), purchase_order_lines(*, ingredients(id, name, unit, pack_price, cost_per_base_unit, pack_quantity))")
    .eq("id", params.id)
    .eq("restaurant_id", restaurant!.id)
    .single();

  if (!po) return notFound();

  // Products of THIS supplier only (for the "produit reçu" picker): those with an
  // article for the supplier, plus those whose legacy supplier_id matches.
  const { data: links } = await supabase
    .from("ingredient_suppliers")
    .select("ingredient_id")
    .eq("supplier_id", po.supplier_id);
  const linkedIds = Array.from(new Set((links ?? []).map((l) => l.ingredient_id)));

  let supplierIngredientsQuery = supabase
    .from("ingredients")
    .select("id, name, unit, pack_price, pack_quantity")
    .eq("restaurant_id", restaurant!.id);
  supplierIngredientsQuery = linkedIds.length > 0
    ? supplierIngredientsQuery.or(`id.in.(${linkedIds.join(",")}),supplier_id.eq.${po.supplier_id}`)
    : supplierIngredientsQuery.eq("supplier_id", po.supplier_id);
  const { data: allIngredients } = await supplierIngredientsQuery.order("name");

  return <ReceiveClient po={po} restaurantId={restaurant!.id} allIngredients={allIngredients ?? []} />;
}
