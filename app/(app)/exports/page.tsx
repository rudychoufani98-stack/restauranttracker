import { Download, Warehouse, ShoppingBasket, ChefHat, ShoppingCart, Trash2, TrendingUp, History } from "lucide-react";

export const dynamic = "force-dynamic";

// Tous les chiffres de la plateforme, exportables en Excel — pour le
// comptable, les analyses ou une sauvegarde.
const EXPORTS = [
  {
    type: "inventaire", icon: Warehouse, titre: "Inventaire valorisé",
    desc: "Ton stock actuel produit par produit, valorisé au CMUP, avec sous-totaux par catégorie.",
  },
  {
    type: "achats", icon: ShoppingBasket, titre: "Mercuriale d'achats",
    desc: "Tous tes produits avec conditionnement, prix HT/TTC, coût au kg/L/pièce et rendement, groupés par fournisseur.",
  },
  {
    type: "recettes", icon: ChefHat, titre: "Fiches techniques & food cost",
    desc: "Toutes tes recettes : coût total, coût par portion, prix de vente, food cost % et marge.",
  },
  {
    type: "commandes", icon: ShoppingCart, titre: "Commandes fournisseurs",
    desc: "L'historique complet de tes bons de commande, ligne par ligne, avec statuts et totaux.",
  },
  {
    type: "ventes", icon: TrendingUp, titre: "Ventes & marges",
    desc: "Tes ventes mois par mois et canal par canal : CA, coût matière, marge et food cost par article.",
  },
  {
    type: "pertes", icon: Trash2, titre: "Pertes & gaspillage",
    desc: "Toutes les pertes enregistrées avec cause, quantité et valeur.",
  },
  {
    type: "mouvements", icon: History, titre: "Journal des mouvements de stock",
    desc: "Chaque entrée et sortie de stock tracée : réceptions, ventes, pertes, ajustements, inventaires.",
  },
];

export default function ExportsPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Mes données</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Exports Excel</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Tous les chiffres de ta plateforme, téléchargeables en un clic — pour ton comptable, tes analyses ou une sauvegarde.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORTS.map(({ type, icon: Icon, titre, desc }) => (
          <div key={type} className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Icon size={19} />
              </div>
              <h2 className="text-base font-semibold text-on-surface">{titre}</h2>
            </div>
            <p className="text-sm text-on-surface-variant/70 flex-1">{desc}</p>
            <a
              href={`/api/export/${type}`}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition w-fit"
            >
              <Download size={15} /> Télécharger Excel
            </a>
          </div>
        ))}
      </div>

      <p className="text-xs text-on-surface-variant/50 mt-6">
        💡 Les fichiers sont générés à l&apos;instant du téléchargement, avec les données à jour. Les coûts sont valorisés au CMUP actuel.
      </p>
    </div>
  );
}
