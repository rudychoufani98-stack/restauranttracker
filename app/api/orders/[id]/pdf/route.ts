import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PurchaseOrderPDF } from "@/lib/pdf/PurchaseOrderPDF";
import React from "react";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, name, address, phone, siret, owner_id")
      .eq("owner_id", user.id)
      .single();

    if (!restaurant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: po } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_number, created_at, expected_total,
        suppliers(name, email, contact, category, customer_reference),
        purchase_order_lines(
          quantity, expected_price,
          ingredients(name, unit, vat_rate)
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

    const lines = (po.purchase_order_lines ?? []).map((l: any) => ({
      name: l.ingredients?.name ?? "—",
      quantity: Number(l.quantity),
      unit: l.ingredients?.unit ?? "",
      expected_price: Number(l.expected_price ?? 0),
      vat_rate: Number(l.ingredients?.vat_rate ?? 0),
    }));

    const supplier = po.suppliers as any ?? {};

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
