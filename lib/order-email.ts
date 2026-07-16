// Builds a `mailto:` link that opens the user's own email client with the
// purchase order pre-filled. No email service (Resend/domain) needed: the
// email is sent from the user's real address, at zero cost.

export type MailtoLine = {
  name: string;
  qty: number;
  packType?: string | null; // "colis", "carton"…
  ref?: string | null;      // supplier reference
};

export function buildOrderMailto(opts: {
  to: string;
  restaurantName: string;
  orderNumber?: string | null;
  customerReference?: string | null;
  lines: MailtoLine[];
  total: number;
}): string {
  const { to, restaurantName, orderNumber, customerReference, lines, total } = opts;

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
    `Total estimé HT : €${total.toFixed(2)}`,
  ];
  if (customerReference) bodyParts.push(`Notre référence client : ${customerReference}`);
  bodyParts.push("", "Cordialement,", restaurantName);

  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyParts.join("\n"))}`;
}
