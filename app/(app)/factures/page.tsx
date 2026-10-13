import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { notFound } from "next/navigation";
import { selectIngredients } from "@/lib/ingredients-query";
import FactureClient from "./FactureClient";

// =====================================================================
//  Déposer une facture, sans bon de commande.
//
//  La moitié des achats d'un restaurant n'a jamais vu de bon de
//  commande : on passe chez le grossiste, le boucher livre, le ticket
//  arrive avec la marchandise. Ces factures-là se saisissaient à la
//  main, ligne par ligne — ou pas du tout.
// =====================================================================
export default async function FacturesPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();
  if (!restaurant) return notFound();

  const { data: suppliers } = await supabase
    .from("suppliers").select("id, name").eq("restaurant_id", restaurant.id).order("name");
  const supplierIds = (suppliers ?? []).map((s) => s.id);

  const [{ data: ingredients }, { data: articles }, { data: cats }] = await Promise.all([
    selectIngredients(
      supabase, restaurant.id,
      "id, name, category, unit, stock_qty, cmup, pack_quantity, pack_price, cost_per_base_unit, vat_rate",
    ),
    // Les articles d'achat portent la DÉSIGNATION du fournisseur : c'est
    // par elle qu'on reconnaît un produit sur une facture, puisqu'une
    // facture imprime les noms du fournisseur, jamais les tiens.
    // Filtré par FOURNISSEUR : la table n'a pas de restaurant_id, et les
    // fournisseurs, eux, appartiennent déjà au restaurant.
    supplierIds.length > 0
      ? supabase
          .from("ingredient_suppliers")
          .select("ingredient_id, supplier_id, supplier_label, pack_type, pack_units, unit_size, unit, pack_price")
          .in("supplier_id", supplierIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("categories").select("name, position")
      .eq("restaurant_id", restaurant.id).eq("type", "ingredient").order("position"),
  ]);

  return (
    <FactureClient
      restaurantId={restaurant.id}
      suppliers={suppliers ?? []}
      ingredients={(ingredients ?? []) as any}
      articles={(articles ?? []) as any}
      categories={(cats ?? []).map((c) => c.name)}
    />
  );
}
