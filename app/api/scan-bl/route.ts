import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const linesRaw = formData.get("lines") as string;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Claude API key not configured" }, { status: 500 });

    const client = new Anthropic({ apiKey });

    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.type.startsWith("image/") ? file.type as "image/jpeg" | "image/png" | "image/webp" : "image/jpeg";

    const expectedLines = JSON.parse(linesRaw ?? "[]");
    const expectedNames = expectedLines.map((l: any) => l.name).join(", ");

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
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
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ items: [] });

    const items = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("scan-bl error", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
