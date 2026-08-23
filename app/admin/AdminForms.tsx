"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";

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
  const confirm = useConfirm();
  // La confirmation est asynchrone : on ne peut plus annuler l'envoi une fois
  // la main rendue. On bloque donc systématiquement, puis on resoumet le
  // formulaire si l'admin accepte — ce drapeau évite alors de reposer la
  // question en boucle. Passer par requestSubmit() préserve useFormStatus,
  // donc le bouton garde son état « en cours ».
  const accepte = useRef(false);

  return (
    <form
      action={action}
      className="shrink-0"
      onSubmit={async (e) => {
        if (accepte.current) { accepte.current = false; return; }
        e.preventDefault();
        const form = e.currentTarget;
        const ok = await confirm({
          title: `Ouvrir l'espace de « ${name} » ?`,
          message: "Toute la plateforme bascule sur les données réelles de ce client.",
          consequences: [
            "Le stock, les commandes et les recettes que tu modifies seront modifiés CHEZ CE CLIENT.",
            "Un bandeau te rappellera en permanence chez qui tu es.",
            "Le bouton « Fermer le client ouvert » te ramène à ton compte.",
          ],
          confirmLabel: "Ouvrir l'espace",
          tone: "default",
        });
        if (!ok) return;
        accepte.current = true;
        form.requestSubmit();
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
