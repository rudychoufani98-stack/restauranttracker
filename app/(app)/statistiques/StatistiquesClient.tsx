"use client";

import Link from "next/link";
import clsx from "clsx";
import { TrendingUp, FileSpreadsheet } from "lucide-react";
import type { PriceAlert } from "@/lib/price-alerts";
import PrixTab from "./PrixTab";
import ExportsTab from "./ExportsTab";

/** Un achat facturé, tel qu'affiché dans le détail d'un produit. */
export type AchatLigne = {
  date: string;
  facture: string;
  fournisseur: string;
  qty: number;
  prix: number;              // prix d'UN colis, HT
  commande: number | null;   // prix annoncé sur le bon de commande
};

export type ProduitPrix = {
  id: string;
  nom: string;
  categorie: string;
  fournisseur: string;
  unite: string;             // kg · L · pce
  inactif: boolean;
  taille: number;            // contenance d'un colis, en unité d'affichage
  stock: number;             // en unité d'affichage
  nbAchats: number;
  premier: number;
  dernier: number;
  variationPct: number;
  mini: number;
  maxi: number;
  moyenPondere: number;
  depense: number;
  derniereDate: string;
  prixPaye: number;          // dernier prix payé, au kg/L/pce
  coutRecettes: number;      // CMUP au kg/L/pce — ce qui sert aux fiches
  ecartCmupPct: number;
  points: { t: number; y: number }[];
  achats: AchatLigne[];
};

const ONGLETS = [
  { vue: "prix", href: "/statistiques", label: "Évolution des prix", icon: TrendingUp },
  { vue: "exports", href: "/statistiques?vue=exports", label: "Exports Excel", icon: FileSpreadsheet },
] as const;

export default function StatistiquesClient({
  vue, produits, alertes, aContester, nbFactures,
}: {
  vue: "prix" | "exports";
  produits: ProduitPrix[];
  alertes: PriceAlert[];
  aContester: number;
  nbFactures: number;
}) {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Mes données</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Statistiques</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Comment tes prix d&apos;achat bougent, et tous tes chiffres à télécharger.
        </p>
      </div>

      {/* Onglets — même barre que celle de l'écran Stock, pour ne pas dérouter. */}
      <div className="flex gap-1 mb-6 p-1 bg-surface-container-low/60 rounded-2xl w-fit">
        {ONGLETS.map(({ vue: v, href, label, icon: Icon }) => (
          <Link
            key={v}
            href={href}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
              vue === v
                ? "bg-primary-container text-on-primary-container nav-active-glow"
                : "text-on-surface-variant/60 hover:bg-surface-container-low",
            )}
          >
            <Icon size={14} /> {label}
          </Link>
        ))}
      </div>

      {vue === "prix"
        ? <PrixTab produits={produits} alertes={alertes} aContester={aContester} nbFactures={nbFactures} />
        : <ExportsTab />}
    </div>
  );
}
