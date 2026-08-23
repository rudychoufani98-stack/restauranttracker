// Historique du coût d'achat d'un produit, reconstruit depuis les factures.
//
// Source de vérité : `invoices` / `invoice_lines`. C'est à l'étape facture que
// le prix réellement payé est confirmé — le bon de livraison ne porte que les
// quantités, et `ingredient_price_history` n'enregistre que les changements.

export type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  created_at?: string | null;
  po_id: string | null;
};
export type InvoiceLineRow = {
  invoice_id: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit_price: number | null;
};
export type PoRow = { id: string; order_number?: string | null; suppliers?: { name: string } | null };
export type PoLineRow = { po_id: string; ingredient_id: string | null; expected_price: number | null };

export type Purchase = {
  date: string;            // invoice_date — sert au tri et à l'affichage
  invoiceNumber: string;
  supplier: string;
  qty: number;             // nombre de colis facturés
  unitPrice: number;       // prix d'un colis (HT)
  expected: number | null; // prix/colis annoncé sur le bon de commande
};

export type CostSummary = {
  count: number;
  first: number;
  last: number;
  deltaEur: number;
  deltaPct: number;
  min: number;
  max: number;
  wavg: number;    // prix moyen pondéré par les quantités achetées
  qtyTotal: number;
  spend: number;
};

/** Regroupe les lignes de facture par ingrédient, en ordre chronologique. */
export function buildPurchaseHistory(input: {
  invoices: InvoiceRow[];
  invoiceLines: InvoiceLineRow[];
  purchaseOrders: PoRow[];
  poLines: PoLineRow[];
}): Map<string, Purchase[]> {
  const invById = new Map(input.invoices.map((i) => [i.id, i]));
  const poById = new Map(input.purchaseOrders.map((p) => [p.id, p]));

  // Prix commandé, indexé par bon de commande + ingrédient.
  const expectedByKey = new Map<string, number>();
  for (const l of input.poLines) {
    if (l.ingredient_id && l.expected_price != null) {
      expectedByKey.set(`${l.po_id}|${l.ingredient_id}`, Number(l.expected_price));
    }
  }

  const byIngredient = new Map<string, Purchase[]>();
  for (const line of input.invoiceLines) {
    if (!line.ingredient_id) continue;
    const inv = invById.get(line.invoice_id);
    if (!inv) continue;
    const po = inv.po_id ? poById.get(inv.po_id) : null;
    const list = byIngredient.get(line.ingredient_id) ?? [];
    list.push({
      date: inv.invoice_date ?? inv.created_at ?? "",
      invoiceNumber: inv.invoice_number ?? po?.order_number ?? "—",
      supplier: po?.suppliers?.name ?? "—",
      qty: Number(line.quantity ?? 0),
      unitPrice: Number(line.unit_price ?? 0),
      expected: inv.po_id ? expectedByKey.get(`${inv.po_id}|${line.ingredient_id}`) ?? null : null,
    });
    byIngredient.set(line.ingredient_id, list);
  }

  for (const list of Array.from(byIngredient.values())) {
    list.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }
  return byIngredient;
}

/** Statistiques d'évolution sur une série d'achats déjà triée chronologiquement. */
export function summarizePurchases(purchases: Purchase[]): CostSummary {
  const prices = purchases.map((p) => p.unitPrice);
  const first = prices[0] ?? 0;
  const last = prices[prices.length - 1] ?? 0;
  const deltaEur = last - first;
  const qtyTotal = purchases.reduce((s, p) => s + p.qty, 0);
  const spend = purchases.reduce((s, p) => s + p.qty * p.unitPrice, 0);
  return {
    count: purchases.length,
    first,
    last,
    deltaEur,
    deltaPct: first > 0 ? (deltaEur / first) * 100 : 0,
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    wavg: qtyTotal > 0 ? spend / qtyTotal : last,
    qtyTotal,
    spend,
  };
}

/** Contenance d'un colis, exprimée dans l'unité de l'ingrédient (kg / L / pce). */
export function packSize(ing: { pack_quantity?: number | null; pack_units?: number | null; unit_size?: number | null } | undefined | null): number {
  const q = Number(ing?.pack_quantity ?? 0);
  if (q > 0) return q;
  const derived = Number(ing?.pack_units ?? 1) * Number(ing?.unit_size ?? 0);
  return derived > 0 ? derived : 1;
}
