import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  newWorkbook, addTitle, styleHeader, styleSubtotal, autoWidth,
  workbookToResponse, FMT, todayStamp,
} from "@/lib/excel";

const displayUnit = (u: string) => (u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "L" : u === "unit" ? "u" : u);
const qtyDisplay = (base: number, u: string) => (["g", "kg", "ml", "l"].includes(u) ? base / 1000 : base);
const perDisplayCmup = (cmupBase: number, u: string) => (["g", "kg", "ml", "l"].includes(u) ? cmupBase * 1000 : cmupBase);

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { type: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Non autorisé", { status: 401 });

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();
    if (!restaurant) return new Response("Accès refusé", { status: 403 });

    const stamp = todayStamp();
    const dateLabel = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

    if (params.type === "inventaire") {
      return await exportInventaire(supabase, restaurant, stamp, dateLabel);
    }
    if (params.type === "achats") {
      return await exportAchats(supabase, restaurant, stamp, dateLabel);
    }
    return new Response("Type d'export inconnu", { status: 404 });
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
    .select("name, category, unit, pack_price, vat_rate, pack_units, unit_size, pack_quantity, cost_per_base_unit, yield_pct, suppliers(name)")
    .eq("restaurant_id", restaurant.id)
    .order("name");

  const wb = newWorkbook();
  const ws = wb.addWorksheet("Achats");
  const headers = ["Fournisseur", "Catégorie", "Ingrédient", "Conditionnement", "Prix HT", "TVA", "Prix TTC", "Coût / kg·L·pce", "Rendement"];
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
      const cond = units > 1 ? `${units} × ${size} ${ing.unit}` : `${size} ${ing.unit}`;
      const gross = Number(ing.cost_per_base_unit ?? 0);
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
      row.getCell(6).numFmt = FMT.pct;
      row.getCell(7).numFmt = FMT.eur;
      row.getCell(8).numFmt = FMT.eur;
      row.getCell(9).numFmt = FMT.pct;
      r++;
    }
  }

  return workbookToResponse(wb, `Achats_${stamp}.xlsx`);
}
