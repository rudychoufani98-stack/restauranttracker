import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const linesRaw = formData.get("lines") as string;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Grok API key not configured" }, { status: 500 });

    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.type.startsWith("image/") ? file.type : "image/jpeg";

    const expectedLines = JSON.parse(linesRaw ?? "[]");
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
      return NextResponse.json({ error: err.error?.message ?? "Grok API error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ items: [] });

    const items = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("scan-bl error", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
