import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { unitShort } from "@/lib/ingredient-helpers";
import {
  newWorkbook, addTitle, styleHeader, styleSubtotal, styleDelta, autoWidth,
  workbookToResponse, FMT, todayStamp,
} from "@/lib/excel";
import { buildPurchaseHistory, summarizePurchases, packSize } from "@/lib/cost-history";

const displayUnit = (u: string) => (u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "L" : u === "unit" || u === "piece" ? "pce" : u);
const qtyDisplay = (base: number, u: string) => (["g", "kg", "ml", "l"].includes(u) ? base / 1000 : base);
const perDisplayCmup = (cmupBase: number, u: string) => (["g", "kg", "ml", "l"].includes(u) ? cmupBase * 1000 : cmupBase);

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { type: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Non autorisé", { status: 401 });

    // Suit le restaurant réellement ouvert (client ouvert par l'admin inclus)
    const restaurant = await getRestaurant();
    if (!restaurant) return new Response("Accès refusé", { status: 403 });

    const stamp = todayStamp();
    const dateLabel = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

    switch (params.type) {
      case "inventaire": return await exportInventaire(supabase, restaurant, stamp, dateLabel);
      case "achats":     return await exportAchats(supabase, restaurant, stamp, dateLabel);
      case "recettes":   return await exportRecettes(supabase, restaurant, stamp, dateLabel);
      case "commandes":  return await exportCommandes(supabase, restaurant, stamp, dateLabel);
      case "pertes":     return await exportPertes(supabase, restaurant, stamp, dateLabel);
      case "ventes":     return await exportVentes(supabase, restaurant, stamp, dateLabel);
      case "mouvements": return await exportMouvements(supabase, restaurant, stamp, dateLabel);
      case "cout-produit": return await exportCoutProduit(supabase, restaurant, stamp, dateLabel);
      default: return new Response("Type d'export inconnu", { status: 404 });
    }
  } catch (e) {
    console.error("[export] error:", (e as Error).message);
    return new Response("Erreur serveur", { status: 500 });
  }
}

// ── Inventaire valorisé ────────────────────────────────────────────────
async function exportInventaire(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("name, category, unit, stock_qty, cmup, cost_per_base_unit, suppliers(name)")
    .eq("restaurant_id", restaurant.id)
    .order("category")
    .order("name");

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Inventaire");
  const headers = ["Catégorie", "Ingrédient", "Fournisseur", "Stock", "Unité", "CMUP / unité", "Valeur"];
  autoWidth(ws, [20, 30, 22, 12, 8, 14, 16]);

  let r = addTitle(ws, `Inventaire valorisé — ${restaurant.name}`, `Au ${dateLabel} · valorisé au CMUP`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);
  r++;

  // Group by category with subtotals.
  const groups = new Map<string, any[]>();
  for (const ing of ingredients ?? []) {
    const c = ing.category || "Autre";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(ing);
  }

  let grandTotal = 0;
  for (const [category, items] of Array.from(groups.entries())) {
    let catTotal = 0;
    for (const ing of items as any[]) {
      const stock = Number(ing.stock_qty ?? 0);
      const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const value = stock * cmup;
      catTotal += value;
      const row = ws.addRow([
        category, ing.name, ing.suppliers?.name ?? "—",
        qtyDisplay(stock, ing.unit), displayUnit(ing.unit), perDisplayCmup(cmup, ing.unit), value,
      ]);
      row.getCell(4).numFmt = FMT.qty;
      row.getCell(6).numFmt = FMT.eur;
      row.getCell(7).numFmt = FMT.eur;
      r++;
    }
    const sub = ws.addRow(["", `Sous-total ${category}`, "", "", "", "", catTotal]);
    sub.getCell(7).numFmt = FMT.eur;
    styleSubtotal(sub);
    r++;
    grandTotal += catTotal;
  }

  const total = ws.addRow(["", "TOTAL STOCK", "", "", "", "", grandTotal]);
  total.eachCell((c) => { c.font = { bold: true, size: 11 }; });
  total.getCell(7).numFmt = FMT.eur;

  return workbookToResponse(wb, `Inventaire_${stamp}.xlsx`);
}

// ── Liste d'achats (mercuriale) ────────────────────────────────────────
async function exportAchats(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("name, category, unit, pack_price, vat_rate, pack_units, unit_size, pack_quantity, cmup, cost_per_base_unit, yield_pct, suppliers(name)")
    .eq("restaurant_id", restaurant.id)
    .order("name");

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Achats");
  const headers = ["Fournisseur", "Catégorie", "Ingrédient", "Conditionnement", "Prix HT", "TVA", "Prix TTC", "Coût net / kg·L·pce (rendement déduit)", "Rendement"];
  autoWidth(ws, [22, 18, 28, 20, 12, 8, 12, 16, 11]);

  let r = addTitle(ws, `Liste d'achats — ${restaurant.name}`, `Mercuriale au ${dateLabel} · prix HT / TTC par conditionnement`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);
  r++;

  // Group by supplier (purchasing-oriented).
  const groups = new Map<string, any[]>();
  for (const ing of ingredients ?? []) {
    const s = ing.suppliers?.name || "Sans fournisseur";
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(ing);
  }
  const sortedSuppliers = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

  for (const supplier of sortedSuppliers) {
    const items = groups.get(supplier)!.sort((a: any, b: any) => a.name.localeCompare(b.name));
    for (const ing of items as any[]) {
      const ht = Number(ing.pack_price ?? 0);
      const vat = Number(ing.vat_rate ?? 0);
      const ttc = ht * (1 + vat / 100);
      const units = Number(ing.pack_units ?? 1);
      const size = Number(ing.unit_size ?? ing.pack_quantity ?? 0);
      const cond = units > 1 ? `${units} × ${size} ${unitShort(ing.unit)}` : `${size} ${unitShort(ing.unit)}`;
      const gross = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const yld = Number(ing.yield_pct ?? 100);
      const netBase = yld > 0 ? gross / (yld / 100) : gross;
      // Display per kg / L / piece rather than per g / ml.
      const isWeightVol = ["g", "kg", "ml", "l"].includes(ing.unit);
      const net = isWeightVol ? netBase * 1000 : netBase;

      const row = ws.addRow([
        supplier, ing.category || "Autre", ing.name, cond,
        ht, vat, ttc, net, yld,
      ]);
      row.getCell(5).numFmt = FMT.eur;
      row.getCell(6).numFmt = FMT.pct1; // 5,5 % ne doit pas s'arrondir en 6 %
      row.getCell(7).numFmt = FMT.eur;
      row.getCell(8).numFmt = FMT.eur;
      row.getCell(9).numFmt = FMT.pct;
      r++;
    }
  }

  return workbookToResponse(wb, `Achats_${stamp}.xlsx`);
}

// ── Fiches techniques & food cost ──────────────────────────────────────
async function exportRecettes(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: recipes } = await supabase
    .from("recipes")
    .select("name, category, total_cost, menu_price, yield_portions")
    .eq("restaurant_id", restaurant.id)
    .eq("is_prep", false) // les MEP ne sont pas des plats vendus
    .order("category").order("name");

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Recettes");
  const headers = ["Catégorie", "Recette", "Rendement (portions)", "Coût total", "Coût / portion", "Prix vente", "Food cost %", "Marge / portion"];
  autoWidth(ws, [20, 32, 18, 13, 14, 12, 12, 15]);

  const r = addTitle(ws, `Fiches techniques & food cost — ${restaurant.name}`, `Au ${dateLabel} · coûts valorisés au CMUP actuel`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);

  for (const rec of recipes ?? []) {
    const portions = Number(rec.yield_portions) || 1;
    const cpp = Number(rec.total_cost ?? 0) / portions;
    const price = Number(rec.menu_price ?? 0);
    const row = ws.addRow([
      rec.category || "Autre", rec.name, portions,
      Number(rec.total_cost ?? 0), cpp,
      price > 0 ? price : "—",
      price > 0 ? cpp / price : "—",
      price > 0 ? price - cpp : "—",
    ]);
    row.getCell(4).numFmt = FMT.eur;
    row.getCell(5).numFmt = FMT.eur;
    if (price > 0) { row.getCell(6).numFmt = FMT.eur; row.getCell(7).numFmt = "0.0%"; row.getCell(8).numFmt = FMT.eur; }
  }
  return workbookToResponse(wb, `Recettes_${stamp}.xlsx`);
}

// ── Commandes fournisseurs (une ligne par produit commandé) ────────────
async function exportCommandes(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const STATUS_FR: Record<string, string> = {
    Draft: "Brouillon", Sent: "Envoyée", "Partially received": "Partiellement reçue",
    Received: "Reçue", Invoiced: "Facturée", Cancelled: "Annulée",
  };
  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("order_number, status, created_at, expected_total, suppliers(name), purchase_order_lines(quantity, expected_price, ingredients(name))")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false });

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Commandes");
  const headers = ["N° commande", "Fournisseur", "Statut", "Date", "Produit", "Quantité", "Prix / colis", "Sous-total"];
  autoWidth(ws, [16, 22, 16, 12, 30, 10, 12, 13]);

  const r = addTitle(ws, `Commandes fournisseurs — ${restaurant.name}`, `Au ${dateLabel} · une ligne par produit commandé`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);

  let grandTotal = 0;
  for (const o of orders ?? []) {
    const date = new Date(o.created_at).toLocaleDateString("fr-FR");
    for (const l of o.purchase_order_lines ?? []) {
      const sub = Number(l.quantity ?? 0) * Number(l.expected_price ?? 0);
      const row = ws.addRow([
        o.order_number ?? "—", o.suppliers?.name ?? "—", STATUS_FR[o.status] ?? o.status, date,
        l.ingredients?.name ?? "—", Number(l.quantity ?? 0), Number(l.expected_price ?? 0), sub,
      ]);
      row.getCell(7).numFmt = FMT.eur;
      row.getCell(8).numFmt = FMT.eur;
    }
    // Une commande annulée reste listée mais ne compte pas dans le total
    if (o.status !== "Cancelled") grandTotal += Number(o.expected_total ?? 0);
  }
  const total = ws.addRow(["", "TOTAL COMMANDES", "", "", "", "", "", grandTotal]);
  total.eachCell((c: any) => { c.font = { bold: true, size: 11 }; });
  total.getCell(8).numFmt = FMT.eur;
  return workbookToResponse(wb, `Commandes_${stamp}.xlsx`);
}

// ── Pertes & gaspillage ────────────────────────────────────────────────
async function exportPertes(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: losses } = await supabase
    .from("stock_movements")
    .select("created_at, qty, unit_cost, loss_reason, notes, ingredients(name, unit)")
    .eq("restaurant_id", restaurant.id)
    .eq("movement_type", "loss")
    .order("created_at", { ascending: false });

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Pertes");
  const headers = ["Date", "Ingrédient", "Cause", "Quantité", "Unité", "Valeur", "Note"];
  autoWidth(ws, [12, 30, 20, 12, 8, 13, 30]);

  const r = addTitle(ws, `Pertes & gaspillage — ${restaurant.name}`, `Au ${dateLabel} · valorisées au CMUP du moment`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);

  let total = 0;
  for (const m of losses ?? []) {
    const u = m.ingredients?.unit ?? "unit";
    const value = Number(m.qty ?? 0) * Number(m.unit_cost ?? 0);
    total += value;
    const row = ws.addRow([
      new Date(m.created_at).toLocaleDateString("fr-FR"),
      m.ingredients?.name ?? "—", m.loss_reason ?? "—",
      qtyDisplay(Number(m.qty ?? 0), u), displayUnit(u), value, m.notes ?? "",
    ]);
    row.getCell(4).numFmt = FMT.qty;
    row.getCell(6).numFmt = FMT.eur;
  }
  const tr = ws.addRow(["", "TOTAL PERTES", "", "", "", total, ""]);
  tr.eachCell((c: any) => { c.font = { bold: true, size: 11 }; });
  tr.getCell(6).numFmt = FMT.eur;
  return workbookToResponse(wb, `Pertes_${stamp}.xlsx`);
}

// ── Ventes & marges (une ligne par plat vendu, par mois et canal) ──────
async function exportVentes(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const [{ data: periods }, { data: recipes }, { data: products }] = await Promise.all([
    supabase.from("sales_periods")
      .select("month, channel, sales_lines(qty_sold, recipe_id, ingredient_id)")
      .eq("restaurant_id", restaurant.id)
      .order("month", { ascending: false }),
    supabase.from("recipes").select("id, name, total_cost, menu_price, yield_portions").eq("restaurant_id", restaurant.id),
    supabase.from("ingredients").select("id, name, selling_price, pack_price, cmup, cost_per_base_unit, unit").eq("restaurant_id", restaurant.id).not("selling_price", "is", null),
  ]);
  const recMap = new Map((recipes ?? []).map((x: any) => [x.id, x]));
  const prodMap = new Map((products ?? []).map((x: any) => [x.id, x]));

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Ventes");
  const headers = ["Mois", "Canal", "Article", "Qté vendue", "Prix vente", "CA", "Coût matière", "Marge", "Food cost %"];
  autoWidth(ws, [12, 12, 32, 11, 11, 13, 13, 13, 12]);

  const r = addTitle(ws, `Ventes & marges — ${restaurant.name}`, `Au ${dateLabel} · coûts valorisés au CMUP actuel · hors commissions de livraison`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);

  const CHANNEL_FR: Record<string, string> = { dine_in: "Sur place", delivery: "Livraison" };
  let totCA = 0, totCost = 0;
  for (const p of periods ?? []) {
    for (const l of p.sales_lines ?? []) {
      let name = "—", price = 0, cost = 0;
      if (l.recipe_id && recMap.has(l.recipe_id)) {
        const rec: any = recMap.get(l.recipe_id);
        name = rec.name; price = Number(rec.menu_price ?? 0);
        cost = Number(rec.total_cost ?? 0) / (Number(rec.yield_portions) || 1);
      } else if (l.ingredient_id && prodMap.has(l.ingredient_id)) {
        const prod: any = prodMap.get(l.ingredient_id);
        // CMUP ramené à l'unité de vente (pièce, ou kg/L pour un produit au poids)
        name = prod.name; price = Number(prod.selling_price ?? 0); cost = perDisplayCmup(Number(prod.cmup ?? prod.cost_per_base_unit ?? 0), prod.unit ?? "unit");
      } else continue;
      const qty = Number(l.qty_sold ?? 0);
      const ca = qty * price, cm = qty * cost;
      totCA += ca; totCost += cm;
      const row = ws.addRow([
        p.month, CHANNEL_FR[p.channel] ?? p.channel, name, qty, price, ca, cm, ca - cm,
        price > 0 ? cost / price : "—",
      ]);
      row.getCell(5).numFmt = FMT.eur; row.getCell(6).numFmt = FMT.eur;
      row.getCell(7).numFmt = FMT.eur; row.getCell(8).numFmt = FMT.eur;
      if (price > 0) row.getCell(9).numFmt = "0.0%";
    }
  }
  const tr = ws.addRow(["", "TOTAL", "", "", "", totCA, totCost, totCA - totCost, totCA > 0 ? totCost / totCA : "—"]);
  tr.eachCell((c: any) => { c.font = { bold: true, size: 11 }; });
  tr.getCell(6).numFmt = FMT.eur; tr.getCell(7).numFmt = FMT.eur; tr.getCell(8).numFmt = FMT.eur;
  if (totCA > 0) tr.getCell(9).numFmt = "0.0%";
  return workbookToResponse(wb, `Ventes_${stamp}.xlsx`);
}

// ── Mouvements de stock (journal complet) ──────────────────────────────
async function exportMouvements(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: moves } = await supabase
    .from("stock_movements")
    .select("created_at, movement_type, reference_type, qty, unit_cost, loss_reason, notes, ingredients(name, unit)")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false });

  const TYPE_FR: Record<string, string> = {
    "delivery": "Réception", "invoice": "Ajust. facture", "sale": "Vente (déstockage)",
    "loss": "Perte", "inventory": "Écart inventaire", "adjustment": "Ajustement", "purchase": "Achat", "manual": "Manuel",
  };
  const SIGN: Record<string, number> = { in: 1, out: -1, loss: -1, adjustment: 1 };

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Mouvements");
  const headers = ["Date", "Ingrédient", "Opération", "Sens", "Quantité", "Unité", "Coût unitaire", "Valeur", "Note"];
  autoWidth(ws, [12, 30, 18, 8, 12, 8, 13, 13, 28]);

  const r = addTitle(ws, `Journal des mouvements de stock — ${restaurant.name}`, `Au ${dateLabel} · toutes les entrées/sorties tracées`, headers.length);
  ws.getRow(r).values = headers;
  styleHeader(ws, r);

  for (const m of moves ?? []) {
    const u = m.ingredients?.unit ?? "unit";
    const sign = SIGN[m.movement_type] ?? 1;
    const perDisp = ["g", "kg", "ml", "l"].includes(u) ? Number(m.unit_cost ?? 0) * 1000 : Number(m.unit_cost ?? 0);
    const row = ws.addRow([
      new Date(m.created_at).toLocaleDateString("fr-FR"),
      m.ingredients?.name ?? "—",
      TYPE_FR[m.reference_type] ?? m.reference_type,
      sign > 0 ? "+" : "−",
      qtyDisplay(Number(m.qty ?? 0), u), displayUnit(u),
      perDisp,
      Number(m.qty ?? 0) * Number(m.unit_cost ?? 0),
      m.loss_reason ?? m.notes ?? "",
    ]);
    row.getCell(5).numFmt = FMT.qty;
    row.getCell(7).numFmt = FMT.eur;
    row.getCell(8).numFmt = FMT.eur;
  }
  return workbookToResponse(wb, `Mouvements_${stamp}.xlsx`);
}

// ── Coût produit — évolution du prix d'achat au fil des commandes ──────
// Source de vérité : les factures VALIDÉES (`invoices` / `invoice_lines`).
// C'est à l'étape facture que le prix réellement payé est confirmé ; une
// facture non validée est un brouillon abandonné en cours de route.
// L'agrégation vit dans lib/cost-history.ts (testée à part) ; ici on ne fait
// que charger les données et les mettre en forme.

/** `.in()` par lots : évite une URL trop longue quand l'historique est gros. */
async function fetchIn(supabase: any, table: string, select: string, column: string, ids: string[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from(table).select(select).in(column, ids.slice(i, i + 200));
    if (data) out.push(...data);
  }
  return out;
}

async function exportCoutProduit(supabase: any, restaurant: any, stamp: string, dateLabel: string) {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, created_at, po_id")
    .eq("restaurant_id", restaurant.id)
    .eq("validated", true)
    .order("invoice_date", { ascending: true });

  const invoiceIds = (invoices ?? []).map((i: any) => i.id);
  const poIds = Array.from(new Set((invoices ?? []).map((i: any) => i.po_id).filter(Boolean))) as string[];

  const [invLines, pos, poLines, ingRes] = await Promise.all([
    invoiceIds.length
      ? fetchIn(supabase, "invoice_lines", "invoice_id, ingredient_id, quantity, unit_price", "invoice_id", invoiceIds)
      : Promise.resolve([] as any[]),
    poIds.length
      ? fetchIn(supabase, "purchase_orders", "id, order_number, suppliers(name)", "id", poIds)
      : Promise.resolve([] as any[]),
    poIds.length
      ? fetchIn(supabase, "purchase_order_lines", "po_id, ingredient_id, expected_price", "po_id", poIds)
      : Promise.resolve([] as any[]),
    supabase
      .from("ingredients")
      .select("id, name, category, unit, pack_units, unit_size, pack_quantity, cmup, cost_per_base_unit, suppliers(name)")
      .eq("restaurant_id", restaurant.id),
  ]);

  const ingById = new Map<string, any>((ingRes.data ?? []).map((i: any) => [i.id, i]));
  const byIngredient = buildPurchaseHistory({
    invoices: invoices ?? [],
    invoiceLines: invLines,
    purchaseOrders: pos,
    poLines,
  });
  const frDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

  const wb = newWorkbook();

  // ── Feuille 1 : synthèse par produit ────────────────────────────────
  const ws = wb.addWorksheet("Synthèse");
  const headers = [
    "Catégorie", "Ingrédient", "Fournisseur", "Colis", "Nb achats",
    "1er prix", "Dernier prix", "Variation", "Variation %",
    "Prix mini", "Prix maxi", "Prix moyen pondéré",
    "Coût actuel / kg·L·pce", "Dernier achat", "Total acheté",
  ];
  autoWidth(ws, [18, 28, 20, 14, 10, 12, 13, 12, 12, 12, 12, 17, 19, 13, 14]);

  let r = addTitle(
    ws,
    `Coût produit — ${restaurant.name}`,
    `Au ${dateLabel} · évolution du prix d'achat facturé, colis par colis · ${invoiceIds.length} facture${invoiceIds.length !== 1 ? "s" : ""}`,
    headers.length,
  );
  ws.getRow(r).values = headers;
  styleHeader(ws, r);
  r++;

  if (byIngredient.size === 0) {
    ws.addRow(["", "Aucun achat facturé pour l'instant — valide une facture depuis une commande reçue."]);
    // Le classeur garde ses deux feuilles : le fichier a toujours la même forme.
    const empty = wb.addWorksheet("Détail achats");
    addTitle(empty, "Coût produit — détail des achats", "Rien à afficher tant qu'aucune facture n'est validée.", 4);
    return workbookToResponse(wb, `Cout_produit_${stamp}.xlsx`);
  }

  // Groupé par catégorie (comme les autres exports).
  const groups = new Map<string, string[]>();
  for (const id of Array.from(byIngredient.keys())) {
    const c = ingById.get(id)?.category || "Autre";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(id);
  }

  const statsById = new Map(
    Array.from(byIngredient.entries()).map(([id, p]) => [id, summarizePurchases(p)]),
  );

  let grandSpend = 0;
  for (const category of Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))) {
    // Plus fortes hausses en tête : c'est ce qu'on veut voir en premier.
    const ids = groups.get(category)!.sort((a, b) => statsById.get(b)!.deltaPct - statsById.get(a)!.deltaPct);
    let catSpend = 0;

    for (const id of ids) {
      const ing = ingById.get(id);
      const p = byIngredient.get(id)!;
      const s = statsById.get(id)!;
      const size = packSize(ing);
      catSpend += s.spend;

      const row = ws.addRow([
        category,
        ing?.name ?? "Produit supprimé",
        ing?.suppliers?.name ?? p[p.length - 1].supplier,
        `${size} ${displayUnit(ing?.unit ?? "unit")}`,
        s.count,
        s.first, s.last, s.deltaEur, s.deltaPct,
        s.min, s.max, s.wavg,
        s.last / size,
        frDate(p[p.length - 1].date),
        s.spend,
      ]);
      [6, 7, 10, 11, 12, 13, 15].forEach((c) => { row.getCell(c).numFmt = FMT.eur; });
      row.getCell(8).numFmt = FMT.eurSigned;
      row.getCell(9).numFmt = FMT.pctSigned;
      styleDelta(row.getCell(8), s.deltaEur);
      styleDelta(row.getCell(9), s.deltaEur);
      r++;
    }

    const sub = ws.addRow(["", `Sous-total ${category}`, "", "", "", "", "", "", "", "", "", "", "", "", catSpend]);
    sub.getCell(15).numFmt = FMT.eur;
    styleSubtotal(sub);
    r++;
    grandSpend += catSpend;
  }

  const total = ws.addRow(["", "TOTAL ACHATS FACTURÉS", "", "", "", "", "", "", "", "", "", "", "", "", grandSpend]);
  total.eachCell((c: any) => { c.font = { bold: true, size: 11 }; });
  total.getCell(15).numFmt = FMT.eur;

  // ── Feuille 2 : détail achat par achat ──────────────────────────────
  const wd = wb.addWorksheet("Détail achats");
  const dHeaders = [
    "Ingrédient", "Date", "N° facture", "Fournisseur", "Qté (colis)",
    "Prix colis", "Coût / kg·L·pce", "Écart vs achat précédent", "Écart %",
    "Prix commandé", "Écart vs commande",
  ];
  autoWidth(wd, [28, 12, 16, 20, 12, 12, 17, 22, 11, 14, 18]);

  const dr = addTitle(
    wd,
    "Coût produit — détail des achats",
    "Chaque ligne de facture, du plus ancien au plus récent, par produit",
    dHeaders.length,
  );
  wd.getRow(dr).values = dHeaders;
  styleHeader(wd, dr);

  const sortedIds = Array.from(byIngredient.keys()).sort((a, b) =>
    (ingById.get(a)?.name ?? "").localeCompare(ingById.get(b)?.name ?? ""),
  );

  for (const id of sortedIds) {
    const ing = ingById.get(id);
    const p = byIngredient.get(id)!;
    const size = packSize(ing);

    const head = wd.addRow([ing?.name ?? "Produit supprimé", `${p.length} achat${p.length !== 1 ? "s" : ""}`]);
    styleSubtotal(head);

    let prev: number | null = null;
    for (const buy of p) {
      const deltaEur = prev === null ? 0 : buy.unitPrice - prev;
      const deltaPct = prev && prev > 0 ? (deltaEur / prev) * 100 : 0;
      const vsOrder = buy.expected === null ? null : buy.unitPrice - buy.expected;

      const row = wd.addRow([
        "", frDate(buy.date), buy.invoiceNumber, buy.supplier, buy.qty,
        buy.unitPrice, buy.unitPrice / size,
        prev === null ? "—" : deltaEur,
        prev === null ? "—" : deltaPct,
        buy.expected === null ? "—" : buy.expected,
        vsOrder === null ? "—" : vsOrder,
      ]);
      row.getCell(5).numFmt = FMT.qty;
      row.getCell(6).numFmt = FMT.eur;
      row.getCell(7).numFmt = FMT.eur;
      if (prev !== null) {
        row.getCell(8).numFmt = FMT.eurSigned;
        row.getCell(9).numFmt = FMT.pctSigned;
        styleDelta(row.getCell(8), deltaEur);
        styleDelta(row.getCell(9), deltaEur);
      }
      if (buy.expected !== null) {
        row.getCell(10).numFmt = FMT.eur;
        row.getCell(11).numFmt = FMT.eurSigned;
        styleDelta(row.getCell(11), vsOrder ?? 0);
      }
      prev = buy.unitPrice;
    }
  }

  return workbookToResponse(wb, `Cout_produit_${stamp}.xlsx`);
}
