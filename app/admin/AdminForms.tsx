"use client";

import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * Ouvrir un client : l'admin bascule dans les données réelles du restaurant,
 * avec droit d'écriture. On confirme avant, sinon une modification faite par
 * mégarde atterrit chez le client.
 */
export function OpenClientForm({ action, restaurantId, name }: {
  action: (fd: FormData) => void | Promise<void>;
  restaurantId: string;
  name: string;
}) {
  return (
    <form
      action={action}
      className="shrink-0"
      onSubmit={(e) => {
        const ok = window.confirm(
          `Ouvrir l'espace de « ${name} » ?\n\nToute la plateforme basculera sur ses données réelles : ce que tu modifies (stock, commandes, recettes) sera modifié CHEZ CE CLIENT.`
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <OpenSubmit />
    </form>
  );
}

function OpenSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? <><Loader2 size={15} className="animate-spin" /> Ouverture…</> : <>Ouvrir <ArrowRight size={15} /></>}
    </button>
  );
}

/** Bouton de création client : bloqué pendant l'envoi (un double-clic créait
 *  deux comptes, dont le second échouait en affichant une erreur trompeuse). */
export function CreateCustomerSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-60 flex items-center gap-2"
    >
      {pending ? <><Loader2 size={15} className="animate-spin" /> Création…</> : "Créer le client"}
    </button>
  );
}
