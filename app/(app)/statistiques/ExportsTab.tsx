"use client";

import { useState } from "react";
import {
  Download, Loader2, Warehouse, ShoppingBasket, ChefHat, ShoppingCart,
  Trash2, TrendingUp, History, LineChart,
} from "lucide-react";

const ICONS = { Warehouse, ShoppingBasket, ChefHat, ShoppingCart, Trash2, TrendingUp, History, LineChart };
type ExportDef = { type: string; icon: keyof typeof ICONS; titre: string; desc: string };

// Tous les chiffres de la plateforme, exportables en Excel — pour le
// comptable, les analyses ou une sauvegarde.
const EXPORTS: ExportDef[] = [
  {
    type: "inventaire", icon: "Warehouse", titre: "Inventaire valorisé",
    desc: "Ton stock actuel produit par produit, valorisé au CMUP, avec sous-totaux par catégorie.",
  },
  {
    type: "achats", icon: "ShoppingBasket", titre: "Mercuriale d'achats",
    desc: "Tous tes produits avec conditionnement, prix HT/TTC, coût au kg/L/pièce et rendement, groupés par fournisseur.",
  },
  {
    type: "recettes", icon: "ChefHat", titre: "Fiches techniques & food cost",
    desc: "Toutes tes recettes : coût total, coût par portion, prix de vente, food cost % et marge.",
  },
  {
    type: "commandes", icon: "ShoppingCart", titre: "Commandes fournisseurs",
    desc: "L'historique complet de tes bons de commande, ligne par ligne, avec statuts et totaux.",
  },
  {
    type: "ventes", icon: "TrendingUp", titre: "Ventes & marges",
    desc: "Tes ventes mois par mois et canal par canal : CA, coût matière, marge et food cost par article.",
  },
  {
    type: "pertes", icon: "Trash2", titre: "Pertes & gaspillage",
    desc: "Toutes les pertes enregistrées avec cause, quantité et valeur.",
  },
  {
    type: "mouvements", icon: "History", titre: "Journal des mouvements de stock",
    desc: "Chaque entrée et sortie de stock tracée : réceptions, ventes, pertes, ajustements, inventaires.",
  },
  {
    type: "cout-produit", icon: "LineChart", titre: "Coût produit — évolution des prix",
    desc: "La version détaillée de l'onglet « Évolution des prix » : variation depuis le premier achat, prix mini/maxi, moyenne pondérée, et le détail facture par facture.",
  },
];

export default function ExportsTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Téléchargement par fetch (et non un simple lien) : une session expirée ou
  // une erreur serveur renvoie du texte, ce qui faisait QUITTER la page en
  // affichant « Non autorisé » au lieu de télécharger un fichier.
  async function download(type: string, titre: string) {
    setBusy(type);
    setError(null);
    try {
      const res = await fetch(`/api/export/${type}`);
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(
          res.status === 401
            ? "Ta session a expiré — recharge la page et reconnecte-toi."
            : `Export « ${titre} » impossible${msg ? ` : ${msg}` : ""}. Réessaie dans un instant.`
        );
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${type}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Téléchargement interrompu (connexion). Réessaie.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-4 text-sm text-red bg-error-container border border-red/20 rounded-xl px-4 py-3">{error}</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORTS.map(({ type, icon, titre, desc }) => {
          const Icon = ICONS[icon];
          const loading = busy === type;
          return (
            <div key={type} className="glass-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Icon size={19} />
                </div>
                <h2 className="text-base font-semibold text-on-surface">{titre}</h2>
              </div>
              <p className="text-sm text-on-surface-variant/70 flex-1">{desc}</p>
              <button
                onClick={() => download(type, titre)}
                disabled={busy !== null}
                title={`Télécharger « ${titre} » au format Excel`}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition w-fit disabled:opacity-50"
              >
                {loading
                  ? <><Loader2 size={15} className="animate-spin" /> Préparation…</>
                  : <><Download size={15} /> Télécharger Excel</>}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-on-surface-variant/50 mt-6">
        💡 Les fichiers sont générés à l&apos;instant du téléchargement, avec les données à jour. Les coûts sont valorisés
        au CMUP actuel — sauf la mercuriale d&apos;achats, qui indique le coût net rendement déduit.
      </p>
    </>
  );
}
