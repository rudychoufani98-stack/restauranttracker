// Test d'envoi d'email Resend.
//
// Usage (PowerShell) :
//   $env:RESEND_API_KEY="re_xxx"; node scripts/test-email.mjs rudychoufani98@gmail.com
//
// Usage (bash) :
//   RESEND_API_KEY=re_xxx node scripts/test-email.mjs rudychoufani98@gmail.com
//
// Le 2e argument est l'adresse destinataire. Mets ton propre email :
// tant qu'aucun domaine n'est vérifié dans Resend, SEULE ton adresse de
// compte Resend recevra le message.

const key = process.env.RESEND_API_KEY;
const to = process.argv[2];
const from = process.env.ORDER_FROM_EMAIL || "onboarding@resend.dev";

if (!key) {
  console.error("❌ RESEND_API_KEY manquante. Exporte-la avant de lancer le script.");
  process.exit(1);
}
if (!to) {
  console.error("❌ Donne l'adresse destinataire : node scripts/test-email.mjs ton@email.com");
  process.exit(1);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    from,
    to,
    subject: "Test — Bon de commande (Restaurant Intelligence)",
    text: "Ceci est un email de test. Si tu le reçois, l'envoi des bons de commande fonctionne.",
  }),
});

const body = await res.json().catch(() => ({}));
if (res.ok) {
  console.log(`✅ Email accepté par Resend (id: ${body.id}). Vérifie la boîte de ${to}.`);
} else {
  console.error(`❌ Échec (${res.status}) :`, body.message ?? body);
  console.error("\n👉 Cause la plus fréquente : domaine non vérifié. Soit tu envoies à ton propre");
  console.error("   email de compte Resend, soit tu vérifies un domaine dans Resend → Domains.");
}
