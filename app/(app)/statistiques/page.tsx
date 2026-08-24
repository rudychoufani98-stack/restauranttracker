import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { loadPurchaseHistory } from "@/lib/purchase-history-query";
import { summarizePurchases, packSize } from "@/lib/cost-history";
import {
  buildPriceAlerts, costUsedByRecipes, pricePerDisplayUnit, priceSeriePoints,
  totalAContester, type AlertIngredient,
} from "@/lib/price-alerts";
import { displayUnitLabel, qtyToDisplay } from "@/lib/ingredient-helpers";
import StatistiquesClient, { type ProduitPrix } from "./StatistiquesClient";

export const dynamic = "force-dynamic";

/** buildPurchaseHistory met « — » quand la commande d'origine est introuvable. */
const dernierFournisseur = (facture: string, parDefaut?: string | null) =>
  facture && facture !== "—" ? facture : parDefaut ?? "—";

// Tout le calcul se fait ici, côté serveur : le navigateur ne reçoit que des
// nombres déjà prêts à afficher. C'est aussi ce qui garantit que l'écran et
// l'export Excel « Coût produit » racontent la même histoire — ils partagent
// le même chargement (lib/purchase-history-query.ts) et les mêmes fonctions
// de calcul (lib/cost-history.ts, lib/price-alerts.ts).
export default async function StatistiquesPage({
  searchParams,
}: {
  searchParams: { vue?: string };
}) {
  const vue = searchParams?.vue === "exports" ? "exports" : "prix";

  // L'onglet Exports n'a besoin d'aucune donnée : inutile de relire tout
  // l'historique de factures pour afficher huit boutons de téléchargement.
  if (vue === "exports") {
    return <StatistiquesClient vue="exports" produits={[]} alertes={[]} aContester={0} nbFactures={0} />;
  }

  const supabase = createClient();
  const restaurant = await getRestaurant();
  const { byIngredient, ingById, invoiceCount } = await loadPurchaseHistory(supabase, restaurant!.id);

  const produits: ProduitPrix[] = [];
  for (const [id, achats] of Array.from(byIngredient.entries())) {
    const ing = ingById.get(id);
    if (!ing || achats.length === 0) continue;

    const s = summarizePurchases(achats);
    const taille = packSize(ing);
    const unite = displayUnitLabel(ing.unit);
    const coutRecettes = costUsedByRecipes(ing as AlertIngredient);
    const prixPaye = pricePerDisplayUnit(s.last, taille);

    produits.push({
      id,
      nom: ing.name ?? "Produit supprimé",
      categorie: ing.category || "Autre",
      // Celui qui a RÉELLEMENT facturé le dernier achat prime sur le
      // fournisseur par défaut de la fiche produit : c'est lui qu'on retrouve
      // sur la facture, et c'est lui qu'on appellera en cas d'écart.
      fournisseur: dernierFournisseur(achats[achats.length - 1].supplier, ing.suppliers?.name),
      unite,
      inactif: ing.is_active === false,
      taille,
      stock: qtyToDisplay(Number(ing.stock_qty ?? 0), ing.unit),
      nbAchats: s.count,
      premier: s.first,
      dernier: s.last,
      variationPct: s.deltaPct,
      mini: s.min,
      maxi: s.max,
      moyenPondere: s.wavg,
      depense: s.spend,
      derniereDate: achats[achats.length - 1].date,
      prixPaye,
      coutRecettes,
      ecartCmupPct: coutRecettes > 0 ? ((prixPaye - coutRecettes) / coutRecettes) * 100 : 0,
      points: priceSeriePoints(achats, taille),
      achats: achats.map((a) => ({
        date: a.date,
        facture: a.invoiceNumber,
        fournisseur: a.supplier,
        qty: a.qty,
        prix: a.unitPrice,
        commande: a.expected,
      })),
    });
  }

  // Les plus grosses dépenses d'abord : c'est là que 1 % compte vraiment.
  produits.sort((a, b) => b.depense - a.depense);

  const ingredientsPourAlertes = new Map<string, AlertIngredient>(
    Array.from(ingById.entries()).map(([id, i]) => [id, i as AlertIngredient]),
  );
  const alertes = buildPriceAlerts(byIngredient, ingredientsPourAlertes);

  return (
    <StatistiquesClient
      vue="prix"
      produits={produits}
      alertes={alertes}
      aContester={totalAContester(alertes)}
      nbFactures={invoiceCount}
    />
  );
}
