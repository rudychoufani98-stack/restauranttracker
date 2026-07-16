// Builds a `mailto:` link that opens the user's own email client with the
// purchase order pre-filled. No email service (Resend/domain) needed: the
// email is sent from the user's real address, at zero cost.

export type MailtoLine = {
  name: string;
  qty: number;
  packType?: string | null; // "colis", "bidon", "carton", "kg"…
  ref?: string | null;      // supplier reference
};

// Sensible default pack type when none was set on the article:
// big liquid containers read as "bidon", 1 kg packs as loose "kg"
// (meat/fish ordered by weight), everything else stays "colis".
export function defaultPackType(unit?: string | null, unitSize?: number | null): string {
  const u = (unit ?? "").toLowerCase();
  const size = Number(unitSize ?? 0);
  if ((u === "l" && size >= 5) || (u === "ml" && size >= 5000)) return "bidon";
  if ((u === "kg" && size === 1) || (u === "g" && size === 1000)) return "kg";
  return "colis";
}

export function buildOrderMailto(opts: {
  to: string;
  restaurantName: string;
  orderNumber?: string | null;
  customerReference?: string | null;
  lines: MailtoLine[];
  total: number;
  hidePrices?: boolean; // mirrors the "Masquer les prix sur le bon de commande" setting
}): string {
  const { to, restaurantName, orderNumber, customerReference, lines, total, hidePrices } = opts;

  const subject = orderNumber
    ? `Bon de commande ${orderNumber} — ${restaurantName}`
    : `Bon de commande — ${restaurantName}`;

  const lineTexts = lines.map((l) => {
    const pack = l.packType || "colis";
    const ref = l.ref ? ` (réf. ${l.ref})` : "";
    return `- ${l.qty} ${pack} × ${l.name}${ref}`;
  });

  const bodyParts = [
    "Bonjour,",
    "",
    orderNumber ? `Voici notre bon de commande ${orderNumber} :` : "Voici notre bon de commande :",
    "",
    ...lineTexts,
    "",
  ];
  if (!hidePrices) bodyParts.push(`Total estimé HT : €${total.toFixed(2)}`);
  if (customerReference) bodyParts.push(`Notre référence client : ${customerReference}`);
  bodyParts.push("", "Cordialement,", restaurantName);

  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyParts.join("\n"))}`;
}
