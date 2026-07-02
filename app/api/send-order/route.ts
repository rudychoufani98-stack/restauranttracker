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
      .select("id, name, address, phone, siret, hide_po_prices")
      .eq("owner_id", user.id)
      .single();

    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const { data: po } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_number, created_at, expected_total, supplier_id,
        suppliers(name, email, contact, category),
        purchase_order_lines(
          quantity, expected_price,
          ingredients(name, unit, vat_rate, pack_quantity, pack_units, unit_size,
            ingredient_suppliers(supplier_id, pack_type, pack_units, unit_size, pack_label, unit))
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

    const lines = (po.purchase_order_lines ?? []).map((l: any) => {
      const ing = l.ingredients;
      const art = (ing?.ingredient_suppliers ?? []).find((a: any) => a.supplier_id === (po as any).supplier_id) ?? null;
      const packType = art?.pack_type || "colis";
      const packUnits = Number(art?.pack_units ?? ing?.pack_units ?? 1) || 1;
      const unitSize = Number(art?.unit_size ?? ing?.unit_size ?? ing?.pack_quantity ?? 0) || 0;
      const baseUnit = art?.unit ?? ing?.unit ?? "";
      const packDetail = art?.pack_label
        ? art.pack_label
        : unitSize > 0 ? (packUnits > 1 ? `${packUnits} × ${unitSize} ${baseUnit}` : `${unitSize} ${baseUnit}`) : "";
      return {
        name: ing?.name ?? "—",
        quantity: Number(l.quantity),
        unit: packType,
        pack_detail: packDetail,
        expected_price: Number(l.expected_price ?? 0),
        vat_rate: Number(ing?.vat_rate ?? 0),
      };
    });

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
      hidePrices: !!(restaurant as any).hide_po_prices,
    });

    const pdfBuffer = await renderToBuffer(pdfElement as any);
    const pdfBase64 = pdfBuffer.toString("base64");

    const hidePrices = !!(restaurant as any).hide_po_prices;

    // Build plain text summary for email body (with or without prices)
    const linesSummary = lines
      .map((l) => hidePrices
        ? `  • ${l.name} — ${l.quantity} ${l.unit}`
        : `  • ${l.name} — ${l.quantity} ${l.unit} @ €${l.expected_price.toFixed(2)} HT`)
      .join("\n");

    const totalHT = lines.reduce((s, l) => s + l.quantity * l.expected_price, 0);
    const totalTTC = lines.reduce((s, l) => s + l.quantity * l.expected_price * (1 + l.vat_rate / 100), 0);
    const totalsBlock = hidePrices ? "" : `\nTotal HT : €${totalHT.toFixed(2)}\nTotal TTC : €${totalTTC.toFixed(2)}\n`;

    const emailBody = `Bonjour,

Veuillez trouver ci-joint notre bon de commande N° ${orderNumber} en date du ${orderDate}.

Récapitulatif des articles commandés :
${linesSummary}
${totalsBlock}
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
        // Set ORDER_FROM_EMAIL to an address on a domain verified in Resend
        // (e.g. "commandes@ton-domaine.fr"). Until a domain is verified, Resend
        // only delivers to your own account email.
        from: process.env.ORDER_FROM_EMAIL || "onboarding@resend.dev",
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
      const err = await res.json().catch(() => ({}));
      console.error("[send-order] Resend error:", err?.message ?? res.status);
      return NextResponse.json(
        { error: err?.message ?? "Échec de l'envoi de l'email" },
        { status: 502 }
      );
    }

    // Mark as Sent + save order number
    await supabase.from("purchase_orders").update({
      status: "Sent",
      sent_at: new Date().toISOString(),
      order_number: orderNumber,
    }).eq("id", poId);

    return NextResponse.json({ ok: true, orderNumber });
  } catch (e: any) {
    console.error("[send-order] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
