import { redirect } from "next/navigation";

// Les exports ont rejoint « Statistiques ». On garde l'ancienne adresse
// vivante : un favori ou un lien envoyé au comptable continue de marcher.
export default function ExportsPage() {
  redirect("/statistiques?vue=exports");
}
