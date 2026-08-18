import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ReceiveClient from "./ReceiveClient";
import { unitShort } from "@/lib/ingredient-helpers";

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

  // Déjà reçu sur cette commande (réceptions validées) : la 2ᵉ réception doit
  // proposer le RESTE, sinon un clic ajouterait toute la commande une 2ᵉ fois.
  const { data: priorDNs } = await supabase
    .from("delivery_notes")
    .select("delivery_note_lines(ingredient_id, quantity_received)")
    .eq("po_id", params.id)
    .eq("validated", true);
  const alreadyReceived: Record<string, number> = {};
  for (const dn of priorDNs ?? []) {
    for (const l of (dn as any).delivery_note_lines ?? []) {
      if (l.ingredient_id) alreadyReceived[l.ingredient_id] = (alreadyReceived[l.ingredient_id] ?? 0) + Number(l.quantity_received ?? 0);
    }
  }

  // Articles of THIS supplier — used both to filter the "produit reçu" picker and
  // to label purchase quantities in the order conditionnement (colis, caisse…).
  const { data: supplierArticles } = await supabase
    .from("ingredient_suppliers")
    .select("ingredient_id, pack_type, pack_units, unit_size, pack_label, unit, pack_price")
    .eq("supplier_id", po.supplier_id);
  const linkedIds = Array.from(new Set((supplierArticles ?? []).map((a) => a.ingredient_id)));

  // ingredient_id -> conditionnement de CE fournisseur : libellé + contenu d'un
  // colis en unités de base (g/ml/pièce) pour convertir « nb de colis » en stock.
  const orderCond: Record<string, { type: string; detail: string; basePerPack: number; packPrice: number | null }> = {};
  for (const a of supplierArticles ?? []) {
    const units = Number(a.pack_units ?? 1) || 1;
    const size = Number(a.unit_size ?? 0) || 0;
    const u = a.unit ?? "";
    const factor = u === "kg" || u === "l" ? 1000 : 1; // anciens articles en g/ml : taille déjà en base
    orderCond[a.ingredient_id] = {
      type: a.pack_type || "colis",
      detail: a.pack_label || (size > 0 ? (units > 1 ? `${units} × ${size} ${unitShort(u)}` : `${size} ${unitShort(u)}`) : ""),
      basePerPack: units * size * factor,
      // Prix du colis chez CE fournisseur — même colisage que basePerPack.
      packPrice: a.pack_price != null ? Number(a.pack_price) : null,
    };
  }

  let supplierIngredientsQuery = supabase
    .from("ingredients")
    .select("id, name, unit, pack_price, pack_quantity")
    .eq("restaurant_id", restaurant!.id);
  supplierIngredientsQuery = linkedIds.length > 0
    ? supplierIngredientsQuery.or(`id.in.(${linkedIds.join(",")}),supplier_id.eq.${po.supplier_id}`)
    : supplierIngredientsQuery.eq("supplier_id", po.supplier_id);
  const { data: allIngredients } = await supplierIngredientsQuery.order("name");

  return <ReceiveClient po={po} restaurantId={restaurant!.id} allIngredients={allIngredients ?? []} orderCond={orderCond} alreadyReceived={alreadyReceived} />;
}
