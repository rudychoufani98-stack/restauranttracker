import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PurchaseOrderPDF } from "@/lib/pdf/PurchaseOrderPDF";
import React from "react";

export async function POST(req: NextRequest) {
  try {
    const { poId } = await req.json();
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, name, address, phone, siret")
      .eq("owner_id", user.id)
      .single();

    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const { data: po } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_number, created_at, expected_total,
        suppliers(name, email, contact, category),
        purchase_order_lines(
          quantity, expected_price,
          ingredients(name, unit, vat_rate)
        )
      `)
      .eq("id", poId)
      .eq("restaurant_id", restaurant.id)
      .single();

    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const supplier = po.suppliers as any;
    if (!supplier?.email) {
      return NextResponse.json({ error: "Supplier has no email address" }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return NextResponse.json({ error: "Resend not configured" }, { status: 500 });

    // Auto-assign order number if missing
    let orderNumber = po.order_number;
    if (!orderNumber) {
      const year = new Date().getFullYear();
      const { count } = await supabase
        .from("purchase_orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id);
      orderNumber = `BDC-${year}-${String((count ?? 0)).padStart(4, "0")}`;
      await supabase.from("purchase_orders").update({ order_number: orderNumber }).eq("id", poId);
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

    // Generate PDF
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
        name: supplier.name,
        email: supplier.email,
        contact: supplier.contact ?? undefined,
        category: supplier.category ?? undefined,
      },
      lines,
    });

    const pdfBuffer = await renderToBuffer(pdfElement as any);
    const pdfBase64 = pdfBuffer.toString("base64");

    // Build plain text summary for email body
    const linesSummary = lines
      .map((l) => `  • ${l.name} — ${l.quantity} ${l.unit} @ €${l.expected_price.toFixed(2)} HT`)
      .join("\n");

    const totalHT = lines.reduce((s, l) => s + l.quantity * l.expected_price, 0);
    const totalTTC = lines.reduce((s, l) => s + l.quantity * l.expected_price * (1 + l.vat_rate / 100), 0);

    const emailBody = `Bonjour,

Veuillez trouver ci-joint notre bon de commande N° ${orderNumber} en date du ${orderDate}.

Récapitulatif des articles commandés :
${linesSummary}

Total HT : €${totalHT.toFixed(2)}
Total TTC : €${totalTTC.toFixed(2)}

Merci de confirmer la réception de cette commande par retour d'email.
La facture devra mentionner le numéro de commande : ${orderNumber}

Cordialement,
${restaurant.name}`;

    // Send via Resend with PDF attachment
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "commandes@resend.dev",
        to: supplier.email,
        subject: `Bon de commande N° ${orderNumber} — ${restaurant.name}`,
        text: emailBody,
        attachments: [
          {
            filename: `${orderNumber}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.message ?? "Email failed" }, { status: 500 });
    }

    // Mark as Sent + save order number
    await supabase.from("purchase_orders").update({
      status: "Sent",
      sent_at: new Date().toISOString(),
      order_number: orderNumber,
    }).eq("id", poId);

    return NextResponse.json({ ok: true, orderNumber });
  } catch (e: any) {
    console.error("send-order error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
