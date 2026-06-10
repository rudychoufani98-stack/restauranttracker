import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const linesRaw = formData.get("lines") as string;

    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    // File size check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 5 Mo)" }, { status: 400 });
    }

    // MIME type check
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
    }

    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API non configurée" }, { status: 500 });

    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.type.startsWith("image/") ? file.type : "image/jpeg";

    // Safe JSON parse
    let expectedLines: any[] = [];
    try {
      expectedLines = JSON.parse(linesRaw ?? "[]");
    } catch {
      expectedLines = [];
    }
    const expectedNames = expectedLines.map((l: any) => l.name).join(", ");

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-2-vision-latest",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mediaType};base64,${base64}` },
              },
              {
                type: "text",
                text: `This is a supplier delivery note (bon de livraison). Extract all line items.
We are looking for these products in particular: ${expectedNames}.
Return ONLY a JSON array with this exact format, no other text:
[{"name": "product name", "quantity": number_or_null, "price": unit_price_as_number_or_null}]
Use the product names as they appear on the invoice. Prices should be the pack/unit price in euros.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("[scan-bl] Grok API error:", err.error?.message);
      return NextResponse.json({ error: "Erreur lors de l'analyse du document" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ items: [] });

    let items: any[] = [];
    try {
      items = JSON.parse(jsonMatch[0]);
    } catch {
      items = [];
    }

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[scan-bl] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
