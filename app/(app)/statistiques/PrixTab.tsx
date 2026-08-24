"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Search, ChevronDown, ReceiptText, TrendingUp, Calculator,
  CheckCircle2, LineChart as LineIcon,
} from "lucide-react";
import { LineChart, CHART } from "@/components/charts";
import { eur, pct, type PriceAlert, type AlertKind } from "@/lib/price-alerts";
import type { ProduitPrix } from "./StatistiquesClient";

/** Date sans dépendre du fuseau : « 2026-08-01 » → « 01/08/2026 ». */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

const KIND = {
  facture: { icon: ReceiptText, label: "Facture à vérifier", couleur: "text-red", fond: "bg-red-light", bord: "border-red/20" },
  hausse:  { icon: TrendingUp,  label: "Prix en hausse",     couleur: "text-amber-dark", fond: "bg-amber-light", bord: "border-amber/20" },
  cmup:    { icon: Calculator,  label: "Recettes à recalculer", couleur: "text-blue-dark", fond: "bg-blue-light", bord: "border-blue/20" },
} as const;

const FILTRES: { key: AlertKind | "toutes"; label: string }[] = [
  { key: "toutes",  label: "Toutes" },
  { key: "facture", label: "Factures à vérifier" },
  { key: "hausse",  label: "Prix en hausse" },
  { key: "cmup",    label: "Recettes à recalculer" },
];

export default function PrixTab({
  produits, alertes, aContester, nbFactures,
}: {
  produits: ProduitPrix[];
  alertes: PriceAlert[];
  aContester: number;
  nbFactures: number;
}) {
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<AlertKind | "toutes">("toutes");

  const depenseTotale = useMemo(() => produits.reduce((s, p) => s + p.depense, 0), [produits]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return produits;
    return produits.filter(
      (p) => p.nom.toLowerCase().includes(q) || p.fournisseur.toLowerCase().includes(q) || p.categorie.toLowerCase().includes(q),
    );
  }, [produits, recherche]);

  const alertesVues = filtre === "toutes" ? alertes : alertes.filter((a) => a.kind === filtre);
  const compte = (k: AlertKind) => alertes.filter((a) => a.kind === k).length;

  if (produits.length === 0) {
    return (
      <div className="glass-card rounded-2xl">
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
            <LineIcon size={26} />
          </div>
          <h3 className="text-base font-semibold text-on-surface mb-1">Pas encore d&apos;historique de prix</h3>
          <p className="text-sm text-on-surface-variant/70 max-w-md">
            Cet écran se remplit tout seul à mesure que tu valides les factures de tes commandes reçues.
            C&apos;est à ce moment-là que le prix réellement payé est confirmé — le bon de livraison, lui,
            ne porte que les quantités.
          </p>
          <p className="text-sm text-on-surface-variant/70 max-w-md mt-3">
            Va dans <strong>Commandes</strong> → une commande réceptionnée → <strong>Saisir la facture</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Ce qu'il faut retenir en un coup d'œil ─────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Chiffre valeur={String(produits.length)} libelle="produits suivis" />
        <Chiffre valeur={String(nbFactures)} libelle={`facture${nbFactures !== 1 ? "s" : ""} analysée${nbFactures !== 1 ? "s" : ""}`} />
        <Chiffre valeur={eur(depenseTotale)} libelle="d'achats facturés" />
        <Chiffre
          valeur={String(alertes.length)}
          libelle={alertes.length === 0 ? "rien à signaler" : `alerte${alertes.length !== 1 ? "s" : ""}`}
          accent={alertes.length > 0}
        />
      </div>

      {/* ── Alertes ────────────────────────────────────────────────── */}
      {alertes.length === 0 ? (
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green shrink-0" />
          <p className="text-sm text-on-surface-variant">
            Rien à signaler : tes fournisseurs facturent ce qu&apos;ils annoncent, aucun produit ne s&apos;envole,
            et le coût utilisé par tes recettes colle au prix que tu payes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-on-surface mr-1">Ce qui mérite ton attention</h2>
            {FILTRES.map(({ key, label }) => {
              const n = key === "toutes" ? alertes.length : compte(key as AlertKind);
              if (n === 0 && key !== "toutes") return null;
              return (
                <button
                  key={key}
                  onClick={() => setFiltre(key)}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-xs font-semibold transition",
                    filtre === key
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-variant/50",
                  )}
                >
                  {label} · {n}
                </button>
              );
            })}
          </div>

          {aContester > 0 && (
            <div className="rounded-2xl border border-red/20 bg-red-light px-5 py-4">
              <p className="text-sm text-red-dark">
                <strong>{eur(aContester)}</strong> facturés au-delà de ce que tes commandes annonçaient.
                Un appel au fournisseur, et c&apos;est de la marge récupérée.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {alertesVues.map((a, i) => {
              const k = KIND[a.kind];
              const Icon = k.icon;
              return (
                <div key={`${a.ingredientId}-${a.kind}-${i}`} className={clsx("rounded-2xl border p-4", k.bord, k.fond)}>
                  <div className="flex items-start gap-3">
                    <div className={clsx("w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center shrink-0", k.couleur)}>
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-bold text-on-surface truncate">{a.name}</p>
                        {Math.abs(a.impactEur) >= 0.01 && (
                          <span className={clsx("text-sm font-extrabold shrink-0", k.couleur)}>{eur(a.impactEur)}</span>
                        )}
                      </div>
                      <p className={clsx("text-2xs font-bold uppercase tracking-wider mt-0.5", k.couleur)}>{a.titre}</p>
                      <p className="text-sm text-on-surface-variant mt-1.5">{a.detail}</p>
                      <p className="text-xs text-on-surface-variant/70 mt-1">{a.action}</p>
                      <button
                        onClick={() => {
                          setOuvert(a.ingredientId);
                          document.getElementById(`p-${a.ingredientId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        className="text-xs font-semibold text-primary hover:underline mt-2"
                      >
                        Voir l&apos;historique de ce produit →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tableau des produits ───────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-on-surface">Tous tes produits achetés</h2>
          <div className="relative max-w-xs w-full">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Chercher un produit ou un fournisseur…"
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 focus:outline-none focus:border-primary transition"
            />
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="text-sm text-on-surface-variant/60 py-8 text-center">Aucun produit ne correspond à « {recherche} ».</p>
        ) : (
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Produit</Th>
                    <Th>Colis</Th>
                    <Th right>Dernier prix</Th>
                    <Th right>Depuis le 1ᵉʳ achat</Th>
                    <Th right>Payé</Th>
                    <Th right>Coût de tes recettes</Th>
                    <Th right>Dépensé</Th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/15">
                  {visibles.map((p) => (
                    <LigneProduit
                      key={p.id}
                      p={p}
                      ouvert={ouvert === p.id}
                      onToggle={() => setOuvert(ouvert === p.id ? null : p.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-on-surface-variant/50">
          💡 Les prix viennent de tes <strong>factures validées</strong> — c&apos;est le prix réellement payé, pas celui annoncé
          à la commande. « Coût de tes recettes » est le coût moyen de ton stock (CMUP) : c&apos;est lui qui sert à calculer
          le prix de revient de tes plats.
        </p>
      </div>
    </div>
  );
}

// ── Petits composants ──────────────────────────────────────────────

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={clsx(
      "px-4 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider bg-surface-container-low/50 border-b border-outline-variant/20",
      right ? "text-right" : "text-left",
    )}>
      {children}
    </th>
  );
}

function Chiffre({ valeur, libelle, accent }: { valeur: string; libelle: string; accent?: boolean }) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3.5">
      <p className={clsx("text-2xl font-extrabold tracking-tight", accent ? "text-orange" : "text-primary")}>{valeur}</p>
      <p className="text-xs text-on-surface-variant/70 mt-0.5">{libelle}</p>
    </div>
  );
}

function Variation({ v }: { v: number }) {
  if (Math.abs(v) < 0.05) return <span className="text-on-surface-variant/50">stable</span>;
  const hausse = v > 0;
  return (
    <span className={clsx(
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold",
      hausse ? "bg-red-light text-red-dark" : "bg-green-light text-green-dark",
    )}>
      {pct(v)}
    </span>
  );
}

function LigneProduit({ p, ouvert, onToggle }: { p: ProduitPrix; ouvert: boolean; onToggle: () => void }) {
  const ecartFort = Math.abs(p.ecartCmupPct) >= 10;
  return (
    <>
      <tr
        id={`p-${p.id}`}
        onClick={onToggle}
        className={clsx("cursor-pointer transition hover:bg-surface-container-low/50", ouvert && "bg-surface-container-low/40")}
      >
        <td className="px-4 py-3.5">
          <p className="font-semibold text-on-surface flex items-center gap-2">
            {p.nom}
            {p.inactif && (
              <span className="text-2xs font-bold uppercase tracking-wider text-on-surface-variant/50">inactif</span>
            )}
          </p>
          <p className="text-xs text-on-surface-variant/60">{p.fournisseur} · {p.categorie}</p>
        </td>
        <td className="px-4 py-3.5 text-on-surface-variant/70">{p.taille} {p.unite}</td>
        <td className="px-4 py-3.5 text-right">
          <p className="font-semibold text-on-surface">{eur(p.dernier)}</p>
          <p className="text-xs text-on-surface-variant/50">{frDate(p.derniereDate)}</p>
        </td>
        <td className="px-4 py-3.5 text-right">
          <Variation v={p.variationPct} />
          <p className="text-xs text-on-surface-variant/50 mt-0.5">
            {p.nbAchats} achat{p.nbAchats !== 1 ? "s" : ""}
          </p>
        </td>
        <td className="px-4 py-3.5 text-right font-semibold text-on-surface whitespace-nowrap">
          {eur(p.prixPaye)}<span className="text-xs font-normal text-on-surface-variant/50">/{p.unite}</span>
        </td>
        <td className="px-4 py-3.5 text-right whitespace-nowrap">
          <p className={clsx(ecartFort ? "font-semibold text-on-surface" : "text-on-surface-variant/70")}>
            {eur(p.coutRecettes)}<span className="text-xs font-normal text-on-surface-variant/50">/{p.unite}</span>
          </p>
          {ecartFort && (
            <p className={clsx("text-xs font-bold", p.ecartCmupPct > 0 ? "text-red" : "text-green")}>
              {pct(p.ecartCmupPct)} d&apos;écart
            </p>
          )}
        </td>
        <td className="px-4 py-3.5 text-right text-on-surface-variant/70">{eur(p.depense)}</td>
        <td className="px-2">
          <ChevronDown size={16} className={clsx("text-on-surface-variant/40 transition-transform", ouvert && "rotate-180")} />
        </td>
      </tr>

      {ouvert && (
        <tr>
          <td colSpan={8} className="px-4 pb-6 pt-2 bg-surface-container-low/30">
            <Detail p={p} />
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ p }: { p: ProduitPrix }) {
  const serie = [{ name: `${p.nom} — prix au ${p.unite}`, color: CHART.orange, points: p.points }];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/30 p-4">
        <p className="text-2xs font-bold uppercase tracking-wider text-outline mb-2">
          Prix payé au {p.unite}, facture après facture
        </p>
        {p.points.length < 2 ? (
          <p className="text-sm text-on-surface-variant/60 py-6 text-center">
            Un seul achat pour l&apos;instant — la courbe apparaîtra dès la deuxième facture.
          </p>
        ) : (
          <LineChart
            series={serie}
            formatY={(n) => eur(n)}
            height={200}
            reference={{ y: p.coutRecettes, label: "coût de tes recettes" }}
            ariaLabel={`Évolution du prix de ${p.nom}`}
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Mini label="Premier prix" valeur={eur(p.premier)} />
        <Mini label="Prix le plus bas" valeur={eur(p.mini)} />
        <Mini label="Prix le plus haut" valeur={eur(p.maxi)} />
        <Mini label="Prix moyen payé" valeur={eur(p.moyenPondere)} />
        <Mini label="En stock" valeur={`${p.stock.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${p.unite}`} />
      </div>

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-2xs font-bold uppercase tracking-wider text-outline">
              <td className="px-4 py-2.5">Date</td>
              <td className="px-4 py-2.5">Facture</td>
              <td className="px-4 py-2.5">Fournisseur</td>
              <td className="px-4 py-2.5 text-right">Colis</td>
              <td className="px-4 py-2.5 text-right">Prix payé</td>
              <td className="px-4 py-2.5 text-right">Prix commandé</td>
              <td className="px-4 py-2.5 text-right">Écart</td>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/15">
            {p.achats.slice().reverse().map((a, i) => {
              const ecart = a.commande != null && a.commande > 0 ? a.prix - a.commande : null;
              return (
                <tr key={i}>
                  <td className="px-4 py-2.5 text-on-surface-variant">{frDate(a.date)}</td>
                  <td className="px-4 py-2.5 text-on-surface-variant/70">{a.facture}</td>
                  <td className="px-4 py-2.5 text-on-surface-variant/70">{a.fournisseur}</td>
                  <td className="px-4 py-2.5 text-right text-on-surface-variant">{a.qty}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-on-surface">{eur(a.prix)}</td>
                  <td className="px-4 py-2.5 text-right text-on-surface-variant/70">
                    {a.commande != null ? eur(a.commande) : "—"}
                  </td>
                  <td className={clsx(
                    "px-4 py-2.5 text-right font-semibold",
                    ecart == null ? "text-on-surface-variant/40" : ecart > 0.004 ? "text-red" : ecart < -0.004 ? "text-green" : "text-on-surface-variant/40",
                  )}>
                    {ecart == null ? "—" : Math.abs(ecart) < 0.005 ? "conforme" : eur(ecart)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mini({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 px-3 py-2.5">
      <p className="text-2xs font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="text-sm font-bold text-on-surface mt-0.5">{valeur}</p>
    </div>
  );
}
