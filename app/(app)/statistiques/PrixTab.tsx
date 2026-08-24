"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Search, ReceiptText, TrendingUp, Calculator, CheckCircle2,
  LineChart as LineIcon, ArrowRight,
} from "lucide-react";
import { LineChart, Sparkline, CHART } from "@/components/charts";
import { eur, pct, type PriceAlert, type AlertKind } from "@/lib/price-alerts";
import type { ProduitPrix } from "./StatistiquesClient";

/** Date sans dépendre du fuseau : « 2026-08-01 » → « 01/08/2026 ». */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

const KIND = {
  facture: { icon: ReceiptText, label: "Facture à vérifier", texte: "text-red", fond: "bg-red-light", bord: "border-red/20" },
  hausse:  { icon: TrendingUp,  label: "Prix en hausse", texte: "text-amber-dark", fond: "bg-amber-light", bord: "border-amber/25" },
  cmup:    { icon: Calculator,  label: "Recettes à recalculer", texte: "text-blue-dark", fond: "bg-blue-light", bord: "border-blue/25" },
} as const;

const TRIS = [
  { key: "depense", label: "Dépense" },
  { key: "hausse", label: "Hausse" },
  { key: "nom", label: "A → Z" },
] as const;
type Tri = (typeof TRIS)[number]["key"];

export default function PrixTab({
  produits, alertes, aContester, nbFactures,
}: {
  produits: ProduitPrix[];
  alertes: PriceAlert[];
  aContester: number;
  nbFactures: number;
}) {
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<Tri>("depense");
  const [filtre, setFiltre] = useState<AlertKind | "toutes">("toutes");
  // On ouvre d'emblée le produit qui pose le plus gros problème : c'est ce
  // que le restaurateur serait venu chercher.
  const [choisi, setChoisi] = useState<string | null>(
    () => alertes[0]?.ingredientId ?? produits[0]?.id ?? null,
  );

  const depenseTotale = useMemo(() => produits.reduce((s, p) => s + p.depense, 0), [produits]);
  const alertesParProduit = useMemo(() => {
    const m = new Map<string, PriceAlert[]>();
    for (const a of alertes) m.set(a.ingredientId, [...(m.get(a.ingredientId) ?? []), a]);
    return m;
  }, [alertes]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const liste = q
      ? produits.filter((p) =>
          p.nom.toLowerCase().includes(q) ||
          p.fournisseur.toLowerCase().includes(q) ||
          p.categorie.toLowerCase().includes(q))
      : produits.slice();

    if (tri === "nom") liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    else if (tri === "hausse") liste.sort((a, b) => b.variationPct - a.variationPct);
    else liste.sort((a, b) => b.depense - a.depense);
    return liste;
  }, [produits, recherche, tri]);

  // Si une recherche fait disparaître le produit affiché de la liste, on
  // bascule sur le premier résultat : le panneau doit toujours montrer un
  // produit que l'on voit à gauche.
  const produit = visibles.find((p) => p.id === choisi) ?? visibles[0] ?? null;
  const alertesVues = filtre === "toutes" ? alertes : alertes.filter((a) => a.kind === filtre);
  const compte = (k: AlertKind) => alertes.filter((a) => a.kind === k).length;

  if (produits.length === 0) return <Vide />;

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
            {(["toutes", "facture", "hausse", "cmup"] as const).map((key) => {
              const n = key === "toutes" ? alertes.length : compte(key);
              if (n === 0 && key !== "toutes") return null;
              const label = key === "toutes" ? "Toutes" : KIND[key].label;
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
            {alertesVues.map((a, i) => (
              <CarteAlerte
                key={`${a.ingredientId}-${a.kind}-${i}`}
                a={a}
                actif={a.ingredientId === produit?.id}
                onVoir={() => setChoisi(a.ingredientId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Maître-détail : la liste à gauche, la courbe à droite ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* Liste des produits */}
        <div className="glass-card rounded-2xl p-3 space-y-3 lg:sticky lg:top-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Chercher un produit…"
              aria-label="Chercher un produit"
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-surface-container-low border border-outline-variant/40 focus:outline-none focus:border-primary transition"
            />
          </div>

          <div className="flex gap-1 p-1 bg-surface-container-low/70 rounded-xl">
            {TRIS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTri(key)}
                className={clsx(
                  "flex-1 px-2 py-1.5 rounded-lg text-2xs font-bold uppercase tracking-wider transition",
                  tri === key ? "bg-surface-container-lowest text-primary shadow-sm" : "text-on-surface-variant/60 hover:text-on-surface-variant",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="px-1 text-2xs font-bold uppercase tracking-wider text-outline">
            {visibles.length} produit{visibles.length !== 1 ? "s" : ""}
          </p>

          <div className="max-h-[560px] overflow-y-auto -mx-1 px-1 space-y-1">
            {visibles.length === 0 ? (
              <p className="text-sm text-on-surface-variant/60 py-6 text-center">
                Aucun produit ne correspond à « {recherche} ».
              </p>
            ) : (
              visibles.map((p) => (
                <ItemProduit
                  key={p.id}
                  p={p}
                  actif={p.id === produit?.id}
                  nbAlertes={alertesParProduit.get(p.id)?.length ?? 0}
                  onClick={() => setChoisi(p.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Détail du produit choisi */}
        {produit ? (
          <Detail p={produit} alertes={alertesParProduit.get(produit.id) ?? []} />
        ) : (
          <div className="glass-card rounded-2xl p-10 text-center text-sm text-on-surface-variant/60">
            Choisis un produit dans la liste pour voir l&apos;évolution de son prix.
          </div>
        )}
      </div>

      <p className="text-xs text-on-surface-variant/50">
        💡 Les prix viennent de tes <strong>factures validées</strong> — c&apos;est le prix réellement payé, pas celui annoncé
        à la commande. « Coût de tes recettes » est le coût moyen de ton stock (CMUP) : c&apos;est lui qui sert à calculer
        le prix de revient de tes plats.
      </p>
    </div>
  );
}

// ── Liste de gauche ────────────────────────────────────────────────

function ItemProduit({
  p, actif, nbAlertes, onClick,
}: {
  p: ProduitPrix; actif: boolean; nbAlertes: number; onClick: () => void;
}) {
  const hausse = p.variationPct > 0.05;
  const baisse = p.variationPct < -0.05;
  return (
    <button
      onClick={onClick}
      aria-current={actif}
      className={clsx(
        "w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 border",
        actif
          ? "bg-primary-container border-primary/20 nav-active-glow"
          : "border-transparent hover:bg-surface-container-low",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={clsx("text-sm truncate", actif ? "font-bold text-on-primary-container" : "font-semibold text-on-surface")}>
          {p.nom}
        </p>
        {nbAlertes > 0 && (
          <span className="shrink-0 w-4 h-4 rounded-full bg-red text-white text-[9px] font-bold flex items-center justify-center">
            {nbAlertes}
          </span>
        )}
      </div>
      <p className="text-xs text-on-surface-variant/60 truncate">{p.fournisseur}</p>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div>
          <p className="text-sm font-bold text-on-surface leading-none">{eur(p.prixPaye)}
            <span className="text-2xs font-normal text-on-surface-variant/50">/{p.unite}</span>
          </p>
          <p className={clsx(
            "text-2xs font-bold mt-1",
            hausse ? "text-red" : baisse ? "text-green" : "text-on-surface-variant/50",
          )}>
            {p.nbAchats < 2 ? "1 achat" : hausse || baisse ? pct(p.variationPct) : "stable"}
          </p>
        </div>
        <Sparkline
          points={p.points}
          color={hausse ? CHART.red : baisse ? CHART.green : CHART.muted}
          ariaLabel={`Tendance de ${p.nom}`}
        />
      </div>
    </button>
  );
}

// ── Panneau de droite ──────────────────────────────────────────────

function Detail({ p, alertes }: { p: ProduitPrix; alertes: PriceAlert[] }) {
  const hausse = p.variationPct > 0.05;
  const baisse = p.variationPct < -0.05;
  const ecartFort = Math.abs(p.ecartCmupPct) >= 10;

  return (
    <div className="space-y-4">
      {/* En-tête : le produit et les trois chiffres qui comptent */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-primary tracking-tight flex items-center gap-2">
              {p.nom}
              {p.inactif && (
                <span className="text-2xs font-bold uppercase tracking-wider text-on-surface-variant/50">inactif</span>
              )}
            </h2>
            <p className="text-sm text-on-surface-variant/70">
              {p.fournisseur} · {p.categorie} · colis de {p.taille} {p.unite}
            </p>
          </div>
          <p className="text-xs text-on-surface-variant/60">
            {p.nbAchats} achat{p.nbAchats !== 1 ? "s" : ""} facturé{p.nbAchats !== 1 ? "s" : ""} ·
            dernier le {frDate(p.derniereDate)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Gros
            valeur={`${eur(p.prixPaye)}`}
            suffixe={`/${p.unite}`}
            libelle="prix payé aujourd'hui"
          />
          <Gros valeur={eur(p.dernier)} libelle={`le colis de ${p.taille} ${p.unite}`} />
          <Gros
            valeur={p.nbAchats < 2 ? "—" : hausse || baisse ? pct(p.variationPct) : "stable"}
            libelle={p.nbAchats < 2 ? "pas encore de recul" : "depuis ton 1ᵉʳ achat"}
            couleur={hausse ? "text-red" : baisse ? "text-green" : undefined}
          />
        </div>
      </div>

      {/* Alertes de CE produit */}
      {alertes.map((a, i) => {
        const k = KIND[a.kind];
        const Icon = k.icon;
        return (
          <div key={i} className={clsx("rounded-2xl border px-4 py-3 flex items-start gap-3", k.bord, k.fond)}>
            <Icon size={17} className={clsx("mt-0.5 shrink-0", k.texte)} />
            <div className="min-w-0">
              <p className={clsx("text-2xs font-bold uppercase tracking-wider", k.texte)}>{a.titre}</p>
              <p className="text-sm text-on-surface-variant mt-0.5">{a.detail}</p>
              <p className="text-xs text-on-surface-variant/70 mt-0.5">{a.action}</p>
            </div>
          </div>
        );
      })}

      {/* La courbe */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="text-2xs font-bold uppercase tracking-wider text-outline">
            Prix payé au {p.unite}, facture après facture
          </p>
          <p className="text-2xs text-on-surface-variant/50">
            ligne pointillée = coût utilisé par tes recettes
          </p>
        </div>
        <LineChart
          series={[{ name: `${p.nom} — prix au ${p.unite}`, color: CHART.orange, points: p.points }]}
          formatY={(n) => eur(n)}
          height={300}
          reference={{ y: p.coutRecettes, label: `tes recettes · ${eur(p.coutRecettes)}` }}
          ariaLabel={`Évolution du prix de ${p.nom}`}
        />
        {p.points.length < 2 && (
          <p className="text-xs text-on-surface-variant/60 text-center mt-2">
            Un seul achat pour l&apos;instant — la courbe se dessinera dès ta prochaine facture.
          </p>
        )}
      </div>

      {/* Ce que tu payes vs ce que disent tes fiches */}
      <Comparaison p={p} fort={ecartFort} />

      {/* Repères chiffrés */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Mini label="Premier prix" valeur={eur(p.premier)} />
        <Mini label="Prix le plus bas" valeur={eur(p.mini)} />
        <Mini label="Prix le plus haut" valeur={eur(p.maxi)} />
        <Mini label="Prix moyen payé" valeur={eur(p.moyenPondere)} />
        <Mini label="En stock" valeur={`${p.stock.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${p.unite}`} />
      </div>

      {/* Facture par facture */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs font-bold uppercase tracking-wider text-outline bg-surface-container-low/50">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Facture</th>
                <th className="px-4 py-3 text-left">Fournisseur</th>
                <th className="px-4 py-3 text-right">Colis</th>
                <th className="px-4 py-3 text-right">Prix payé</th>
                <th className="px-4 py-3 text-right">Prix commandé</th>
                <th className="px-4 py-3 text-right">Écart</th>
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
                      ecart == null ? "text-on-surface-variant/40"
                        : ecart > 0.004 ? "text-red"
                        : ecart < -0.004 ? "text-green"
                        : "text-on-surface-variant/40",
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
    </div>
  );
}

/**
 * Deux barres côte à côte : ce que tu payes, et ce que tes fiches techniques
 * utilisent. L'écart entre les deux barres EST le message — un chiffre seul
 * ne se voit pas, deux barres inégales si.
 */
function Comparaison({ p, fort }: { p: ProduitPrix; fort: boolean }) {
  const max = Math.max(p.prixPaye, p.coutRecettes) || 1;
  const lignes = [
    { label: "Tu payes", valeur: p.prixPaye, classe: "bg-brand-orange" },
    { label: "Tes recettes utilisent", valeur: p.coutRecettes, classe: "bg-brand-navy" },
  ];
  return (
    <div className="glass-card rounded-2xl p-5">
      <p className="text-2xs font-bold uppercase tracking-wider text-outline mb-3">
        Le prix réel face au coût de tes fiches techniques
      </p>
      <div className="space-y-2.5">
        {lignes.map((l) => (
          <div key={l.label} className="flex items-center gap-3">
            <p className="w-44 shrink-0 text-xs text-on-surface-variant/70">{l.label}</p>
            <div className="flex-1 h-7 bg-surface-container-low rounded-lg overflow-hidden">
              <div
                className={clsx("h-full rounded-lg transition-all duration-500", l.classe)}
                style={{ width: `${Math.max(2, (l.valeur / max) * 100)}%` }}
              />
            </div>
            <p className="w-24 shrink-0 text-right text-sm font-bold text-on-surface whitespace-nowrap">
              {eur(l.valeur)}<span className="text-2xs font-normal text-on-surface-variant/50">/{p.unite}</span>
            </p>
          </div>
        ))}
      </div>
      <p className={clsx("text-xs mt-3", fort ? "font-semibold text-on-surface" : "text-on-surface-variant/60")}>
        {!fort
          ? "Écart normal : tes fiches techniques sont à jour."
          : p.ecartCmupPct > 0
            ? `Tu payes ${pct(p.ecartCmupPct)} de plus que ce que disent tes fiches — le coût de tes plats est sous-estimé.`
            : `Tu payes ${pct(p.ecartCmupPct)} de moins que ce que disent tes fiches — le coût de tes plats est surestimé.`}
      </p>
    </div>
  );
}

// ── Briques d'affichage ────────────────────────────────────────────

function CarteAlerte({ a, actif, onVoir }: { a: PriceAlert; actif: boolean; onVoir: () => void }) {
  const k = KIND[a.kind];
  const Icon = k.icon;
  return (
    <div className={clsx("rounded-2xl border p-4 transition", k.bord, k.fond, actif && "ring-2 ring-primary/30")}>
      <div className="flex items-start gap-3">
        <div className={clsx("w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center shrink-0", k.texte)}>
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-bold text-on-surface truncate">{a.name}</p>
            {Math.abs(a.impactEur) >= 0.01 && (
              <span className={clsx("text-sm font-extrabold shrink-0", k.texte)}>{eur(a.impactEur)}</span>
            )}
          </div>
          <p className={clsx("text-2xs font-bold uppercase tracking-wider mt-0.5", k.texte)}>{a.titre}</p>
          <p className="text-sm text-on-surface-variant mt-1.5">{a.detail}</p>
          <p className="text-xs text-on-surface-variant/70 mt-1">{a.action}</p>
          <button
            onClick={onVoir}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline mt-2"
          >
            Voir la courbe de ce produit <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Chiffre({ valeur, libelle, accent }: { valeur: string; libelle: string; accent?: boolean }) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3.5">
      <p className={clsx("text-2xl font-extrabold tracking-tight", accent ? "text-brand-orange-deep" : "text-primary")}>
        {valeur}
      </p>
      <p className="text-xs text-on-surface-variant/70 mt-0.5">{libelle}</p>
    </div>
  );
}

function Gros({ valeur, suffixe, libelle, couleur }: { valeur: string; suffixe?: string; libelle: string; couleur?: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low/60 px-3.5 py-3">
      <p className={clsx("text-xl font-extrabold tracking-tight whitespace-nowrap", couleur ?? "text-on-surface")}>
        {valeur}
        {suffixe && <span className="text-xs font-normal text-on-surface-variant/50">{suffixe}</span>}
      </p>
      <p className="text-2xs text-on-surface-variant/60 mt-0.5">{libelle}</p>
    </div>
  );
}

function Mini({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="glass-card rounded-xl px-3 py-2.5">
      <p className="text-2xs font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="text-sm font-bold text-on-surface mt-0.5">{valeur}</p>
    </div>
  );
}

function Vide() {
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
