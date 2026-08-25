// =====================================================================
//  Alertes d'écart de prix.
//
//  Trois questions auxquelles un chef veut une réponse sans ouvrir Excel :
//
//   1. « Me facture-t-on ce que j'ai commandé ? »   → alerte FACTURE
//   2. « Ce produit augmente-t-il ? »                → alerte HAUSSE
//   3. « Mes fiches techniques sont-elles à jour ? » → alerte CMUP
//
//  La 3ᵉ mérite une explication : le coût de revient des plats est calculé
//  au CMUP (coût moyen du stock), qui est par nature en retard sur le
//  dernier prix payé. Un petit écart est normal. Un GROS écart veut dire
//  que les coûts de tes plats sont faux — trop bas si les prix montent.
//
//  Tout est en fonctions pures : l'écran ne fait que les appeler, et
//  tests/price-alerts.test.ts les vérifie sans base de données.
// =====================================================================
import { summarizePurchases, packSize, type Purchase, type CostSummary } from "./cost-history";
import { displayUnitLabel, perDisplayUnit, qtyToDisplay } from "./ingredient-helpers";
import { eur, pct } from "./format";

// Re-exportes : les ecrans qui affichent des alertes formatent aussi des montants.
export { eur, pct };

/**
 * Seuils par défaut. Ils sont RÉGLABLES par restaurant (Paramètres →
 * Alertes de prix) : trop bas l'alerte devient du bruit et plus personne
 * ne la regarde, trop haut elle arrive quand l'argent est déjà parti.
 */
export const SEUIL_HAUSSE_PCT = 10;
export const SEUIL_CMUP_PCT = 10;
export const SEUIL_FACTURE_PCT = 2;

export type Seuils = { hausse: number; cmup: number; facture: number };

export const SEUILS_DEFAUT: Seuils = {
  hausse: SEUIL_HAUSSE_PCT,
  cmup: SEUIL_CMUP_PCT,
  facture: SEUIL_FACTURE_PCT,
};

/** Lit les seuils d'un restaurant, en comblant ce qui manque. */
export function seuilsDe(restaurant: any): Seuils {
  const n = (v: unknown, defaut: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 && x <= 100 ? x : defaut;
  };
  return {
    hausse: n(restaurant?.alert_hausse_pct, SEUIL_HAUSSE_PCT),
    cmup: n(restaurant?.alert_cmup_pct, SEUIL_CMUP_PCT),
    facture: n(restaurant?.alert_facture_pct, SEUIL_FACTURE_PCT),
  };
}

export type AlertKind = "facture" | "hausse" | "cmup";

export type PriceAlert = {
  ingredientId: string;
  name: string;
  kind: AlertKind;
  /** Écart en %, signé (positif = défavorable au restaurant). */
  ecartPct: number;
  /** Ce que l'écart représente en euros — sert à trier par importance. */
  impactEur: number;
  titre: string;
  detail: string;
  /** Ce qu'il y a à faire. Vide si rien de particulier. */
  action: string;
};

export type AlertIngredient = {
  id: string;
  name: string;
  unit: string;
  cmup?: number | null;
  cost_per_base_unit?: number | null;
  stock_qty?: number | null;
  pack_quantity?: number | null;
  pack_units?: number | null;
  unit_size?: number | null;
};


/** Prix payé pour UN kg / L / pièce au dernier achat facturé. */
export function pricePerDisplayUnit(prixColis: number, tailleColis: number): number {
  return tailleColis > 0 ? prixColis / tailleColis : 0;
}

/** Coût utilisé par les recettes, ramené au kg / L / pièce. */
export function costUsedByRecipes(ing: AlertIngredient): number {
  const base = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
  return perDisplayUnit(base, ing.unit);
}

/** Points de la courbe d'un produit : un point par facture, prix au kg/L/pce. */
export function priceSeriePoints(purchases: Purchase[], tailleColis: number): { t: number; y: number }[] {
  return purchases
    .map((p) => ({ t: Date.parse(p.date), y: pricePerDisplayUnit(p.unitPrice, tailleColis) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
}

// ── Les trois alertes, une fonction chacune ──────────────────────────

/**
 * Facture plus chère que la commande. C'est la seule alerte qui porte sur de
 * l'argent immédiatement récupérable, d'où sa priorité d'affichage.
 */
export function alerteFacture(ing: AlertIngredient, purchases: Purchase[], seuils: Seuils = SEUILS_DEFAUT): PriceAlert | null {
  const dernier = purchases[purchases.length - 1];
  if (!dernier || dernier.expected == null || dernier.expected <= 0) return null;

  const ecart = dernier.unitPrice - dernier.expected;
  const ecartPct = (ecart / dernier.expected) * 100;
  if (ecartPct <= seuils.facture) return null;   // facturé au prix prévu, ou moins cher

  return {
    ingredientId: ing.id,
    name: ing.name,
    kind: "facture",
    ecartPct,
    impactEur: ecart * Math.max(0, dernier.qty),
    titre: "Facturé plus cher que commandé",
    detail:
      `Le colis a été facturé ${eur(dernier.unitPrice)} alors que ta commande annonçait ` +
      `${eur(dernier.expected)} (${pct(ecartPct)}).`,
    action: `À vérifier auprès de ${dernier.supplier} — ${eur(ecart * Math.max(0, dernier.qty))} sur cette livraison.`,
  };
}

/**
 * Le prix d'achat monte depuis le premier achat.
 * L'impact est chiffré sur le volume déjà acheté : « si tout ce que tu as
 * acheté cette année l'avait été au prix d'aujourd'hui, tu aurais payé X € de
 * plus » — c'est ce que la hausse te coûtera sur ton rythme habituel.
 */
export function alerteHausse(ing: AlertIngredient, purchases: Purchase[], s: CostSummary, seuils: Seuils = SEUILS_DEFAUT): PriceAlert | null {
  if (s.count < 2 || s.first <= 0) return null;
  if (s.deltaPct < seuils.hausse) return null;

  const surcout = Math.max(0, (s.last - s.wavg) * s.qtyTotal);
  return {
    ingredientId: ing.id,
    name: ing.name,
    kind: "hausse",
    ecartPct: s.deltaPct,
    impactEur: surcout,
    titre: "Le prix monte",
    detail:
      `${eur(s.last)} le colis aujourd'hui, contre ${eur(s.first)} à ton premier achat ` +
      `(${pct(s.deltaPct)}, sur ${s.count} achats).`,
    action:
      surcout > 0
        ? `Sur ton volume acheté, la hausse représente ${eur(surcout)}. Compare avec un autre fournisseur.`
        : "Compare avec un autre fournisseur avant ta prochaine commande.",
  };
}

/**
 * Le coût qui sert à calculer tes plats s'écarte du prix réellement payé.
 * Vers le haut (tu payes plus cher que ce que disent tes fiches) c'est
 * défavorable : tes food costs sont sous-estimés.
 */
export function alerteCmup(ing: AlertIngredient, s: CostSummary, seuils: Seuils = SEUILS_DEFAUT): PriceAlert | null {
  const utilise = costUsedByRecipes(ing);
  if (!(utilise > 0)) return null;

  const paye = pricePerDisplayUnit(s.last, packSize(ing));
  if (!(paye > 0)) return null;

  const ecartPct = ((paye - utilise) / utilise) * 100;
  if (Math.abs(ecartPct) < seuils.cmup) return null;

  const u = displayUnitLabel(ing.unit);
  const stock = qtyToDisplay(Number(ing.stock_qty ?? 0), ing.unit);
  const hausse = ecartPct > 0;

  return {
    ingredientId: ing.id,
    name: ing.name,
    kind: "cmup",
    ecartPct,
    impactEur: (paye - utilise) * Math.max(0, stock),
    titre: hausse ? "Tes recettes sont calculées trop bas" : "Tes recettes sont calculées trop haut",
    detail:
      `Tes fiches techniques utilisent ${eur(utilise)}/${u} (coût moyen de ton stock) ` +
      `alors que tu payes ${eur(paye)}/${u} aujourd'hui (${pct(ecartPct)}).`,
    action: hausse
      ? "Le coût de tes plats est sous-estimé : ta marge réelle est plus faible qu'affichée."
      : "Le coût de tes plats est surestimé : ta marge réelle est meilleure qu'affichée.",
  };
}

/**
 * Toutes les alertes, les plus coûteuses d'abord.
 * À impact égal, une facture à contester passe avant une simple tendance.
 */
export function buildPriceAlerts(
  purchasesByIngredient: Map<string, Purchase[]>,
  ingredients: Map<string, AlertIngredient>,
  seuils: Seuils = SEUILS_DEFAUT,
): PriceAlert[] {
  const rang: Record<AlertKind, number> = { facture: 0, hausse: 1, cmup: 2 };
  const out: PriceAlert[] = [];

  for (const [id, purchases] of Array.from(purchasesByIngredient.entries())) {
    const ing = ingredients.get(id);
    if (!ing || purchases.length === 0) continue;
    const s = summarizePurchases(purchases);

    for (const a of [alerteFacture(ing, purchases, seuils), alerteHausse(ing, purchases, s, seuils), alerteCmup(ing, s, seuils)]) {
      if (a) out.push(a);
    }
  }

  return out.sort((a, b) => {
    const d = Math.abs(b.impactEur) - Math.abs(a.impactEur);
    if (Math.abs(d) > 0.005) return d;
    if (rang[a.kind] !== rang[b.kind]) return rang[a.kind] - rang[b.kind];
    return Math.abs(b.ecartPct) - Math.abs(a.ecartPct);
  });
}

/** Total à contester auprès des fournisseurs — le chiffre qui décide d'un appel. */
export function totalAContester(alerts: PriceAlert[]): number {
  return alerts.filter((a) => a.kind === "facture").reduce((s, a) => s + a.impactEur, 0);
}
