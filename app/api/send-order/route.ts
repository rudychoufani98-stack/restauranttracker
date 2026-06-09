import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { poId, restaurantName } = await req.json();
    const supabase = createClient();

    const { data: po } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name, email), purchase_order_lines(*, ingredients(name, unit))")
      .eq("id", poId)
      .single();

    if (!po || !po.suppliers?.email) {
      return NextResponse.json({ error: "No supplier email found" }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return NextResponse.json({ error: "Resend not configured" }, { status: 500 });

    const lines = po.purchase_order_lines
      .map((l: any) => `  - ${l.ingredients?.name ?? "Unknown"}: ${l.quantity} ${l.ingredients?.unit ?? ""} @ €${Number(l.expected_price ?? 0).toFixed(2)}`)
      .join("\n");

    const body = `Dear ${po.suppliers.name},\n\nPlease find below our purchase order from ${restaurantName}.\n\nOrder lines:\n${lines}\n\nExpected total: €${Number(po.expected_total ?? 0).toFixed(2)}\n\nPlease confirm receipt of this order.\n\nThank you,\n${restaurantName}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "orders@resend.dev",
        to: po.suppliers.email,
        subject: `Purchase Order from ${restaurantName}`,
        text: body,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.message ?? "Email failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
