import ExportsClient, { type ExportDef } from "./ExportsClient";

export const dynamic = "force-dynamic";

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

      <ExportsClient exports={EXPORTS} />

      <p className="text-xs text-on-surface-variant/50 mt-6">
        💡 Les fichiers sont générés à l&apos;instant du téléchargement, avec les données à jour. Les coûts sont valorisés
        au CMUP actuel — sauf la mercuriale d&apos;achats, qui indique le coût net rendement déduit.
      </p>
    </div>
  );
}
