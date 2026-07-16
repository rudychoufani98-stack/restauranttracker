import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PurchaseOrderPDF } from "@/lib/pdf/PurchaseOrderPDF";
import { defaultPackType } from "@/lib/order-email";
import React from "react";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // select("*") so a not-yet-migrated column (e.g. hide_po_prices) never breaks the PDF.
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("*")
      .eq("owner_id", user.id)
      .single();

    if (!restaurant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: po } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_number, created_at, expected_total,
        suppliers(*),
        purchase_order_lines(
          quantity, expected_price,
          ingredients(name, unit, vat_rate, pack_quantity, pack_units, unit_size, secondary_unit_label, secondary_unit_size,
            ingredient_suppliers(supplier_id, pack_type, pack_units, unit_size, pack_label, unit))
        )
      `)
      .eq("id", params.id)
      .eq("restaurant_id", restaurant.id)
      .single();

    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // Auto-assign order number if missing
    let orderNumber = po.order_number;
    if (!orderNumber) {
      const year = new Date().getFullYear();
      // Count existing orders for sequential numbering
      const { count } = await supabase
        .from("purchase_orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id);
      orderNumber = `BDC-${year}-${String((count ?? 0)).padStart(4, "0")}`;
      await supabase.from("purchase_orders").update({ order_number: orderNumber }).eq("id", params.id);
    }

    const orderDate = new Date(po.created_at).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric",
    });

    const supplier = po.suppliers as any ?? {};

    // Build the order-conditionnement label for each line (e.g. "colis" + "2 kg"),
    // read from the supplier's article. Orders are placed in this conditionnement
    // (qté = nombre de colis, P.U. = prix par colis), not in the base usage unit.
    const lines = (po.purchase_order_lines ?? []).map((l: any) => {
      const ing = l.ingredients;
      const art = (ing?.ingredient_suppliers ?? []).find((a: any) => a.supplier_id === supplier.id) ?? null;
      const packUnits = Number(art?.pack_units ?? ing?.pack_units ?? 1) || 1;
      const unitSize = Number(art?.unit_size ?? ing?.unit_size ?? ing?.pack_quantity ?? 0) || 0;
      const baseUnit = art?.unit ?? ing?.unit ?? "";
      // Sans article : le conditionnement secondaire sert de libellé quand sa
      // taille correspond au colisage (ex. « bouteille » pour 0,75 L).
      const secLabel = (ing?.secondary_unit_label ?? "").trim();
      const secMatches = secLabel && Number(ing?.secondary_unit_size ?? 0) > 0 && unitSize === Number(ing?.secondary_unit_size);
      const packType = art?.pack_type || (secMatches ? secLabel : defaultPackType(baseUnit, unitSize));
      const packDetail = art?.pack_label
        ? art.pack_label
        : unitSize > 0
          ? (packUnits > 1 ? `${packUnits} × ${unitSize} ${baseUnit}` : `${unitSize} ${baseUnit}`)
          : "";
      return {
        name: ing?.name ?? "—",
        quantity: Number(l.quantity),
        unit: packType,          // conditionnement de commande (colis, caisse…)
        pack_detail: packDetail, // taille du conditionnement (ex. "2 kg")
        expected_price: Number(l.expected_price ?? 0),
        vat_rate: Number(ing?.vat_rate ?? 0),
      };
    });

    const pdfElement = React.createElement(PurchaseOrderPDF, {
      orderNumber,
      orderDate,
      restaurant: {
        name: restaurant.name,
        address: restaurant.address ?? undefined,
        phone: restaurant.phone ?? undefined,
        siret: restaurant.siret ?? undefined,
        email: user.email,
      },
      supplier: {
        name: supplier.name ?? "—",
        email: supplier.email ?? undefined,
        contact: supplier.contact ?? undefined,
        category: supplier.category ?? undefined,
        customer_reference: supplier.customer_reference ?? undefined,
      },
      lines,
      hidePrices: !!(restaurant as any).hide_po_prices,
    });

    const buffer = await renderToBuffer(pdfElement as any);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${orderNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("PDF generation error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
