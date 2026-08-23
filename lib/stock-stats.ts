// Statistiques de stock dans le temps, calculées à partir du journal des
// mouvements (`stock_movements`) et des inventaires finalisés.
//
// Tout est en fonctions pures : l'onglet Statistiques ne fait que les appeler,
// et tests/stock-stats.test.ts les vérifie sans base de données.
//
// Rappel d'unités : `qty` est en unité de BASE (g / ml / pièce) et `unit_cost`
// est le coût d'UNE unité de base. Leur produit est donc un montant en euros,
// quelle que soit l'unité du produit.

export type StatMovement = {
  ingredient_id: string;
  movement_type: "in" | "out" | "adjustment" | "loss";
  qty: number;
  unit_cost: number | null;
  reference_type: string;
  loss_reason?: string | null;
  created_at: string;
};

export type StatIngredient = {
  id: string; name: string; unit: string;
  category?: string;
  /** Coût moyen pondéré actuel, par unité de base — sert de repère sur les courbes. */
  cmup?: number | null;
};

/** Un achat entre en stock via une réception ou une facture. */
const PURCHASE_REFS = new Set(["delivery", "invoice"]);
export const isPurchase = (m: StatMovement) => m.movement_type === "in" && PURCHASE_REFS.has(m.reference_type);
export const isLoss = (m: StatMovement) => m.movement_type === "loss";
/** Sortie liée au service : c'est la matière réellement consommée. */
export const isConsumption = (m: StatMovement) => m.movement_type === "out" && m.reference_type === "sale";

/** Montant en euros d'un mouvement. */
export const moveValue = (m: StatMovement) => Math.abs(Number(m.qty ?? 0)) * Number(m.unit_cost ?? 0);

/** Coût d'une unité de base → coût au kg / L / pièce (ce que lit un chef). */
export function perDisplayUnit(costPerBase: number, unit: string): number {
  return ["g", "kg", "ml", "l"].includes(unit) ? costPerBase * 1000 : costPerBase;
}

export const displayUnit = (u: string) =>
  u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "L" : u === "unit" || u === "piece" ? "pce" : u;

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${String(y).slice(2)}`;
}

/** Ne garde que les mouvements des `months` derniers mois (null = tout l'historique). */
export function withinMonths(movements: StatMovement[], months: number | null, now = new Date()): StatMovement[] {
  if (months === null) return movements;
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime();
  return movements.filter((m) => Date.parse(m.created_at) >= from);
}

// ── Évolution du prix d'achat d'un produit ────────────────────────────
export type PricePoint = { t: number; y: number; iso: string };

/**
 * Série chronologique du prix d'achat d'un produit, au kg / L / pièce.
 * Un achat sans coût connu (0 ou nul) n'est pas un point de prix : l'inclure
 * ferait plonger la courbe à zéro sans que le prix ait bougé.
 */
export function purchasePriceSeries(movements: StatMovement[], ingredientId: string, unit: string): PricePoint[] {
  return movements
    .filter((m) => m.ingredient_id === ingredientId && isPurchase(m) && Number(m.unit_cost ?? 0) > 0)
    .map((m) => ({
      t: Date.parse(m.created_at),
      y: perDisplayUnit(Number(m.unit_cost), unit),
      iso: m.created_at,
    }))
    .sort((a, b) => a.t - b.t);
}

export type Mover = {
  id: string; name: string; unit: string;
  first: number; last: number; min: number; max: number;
  deltaPct: number; count: number; spend: number;
};

/**
 * Produits classés par variation de prix, du plus fort renchérissement à la
 * plus forte baisse. Il faut au moins deux achats pour parler d'évolution.
 */
export function biggestMovers(movements: StatMovement[], ingredients: StatIngredient[], minPurchases = 2): Mover[] {
  const out: Mover[] = [];
  for (const ing of ingredients) {
    const pts = purchasePriceSeries(movements, ing.id, ing.unit);
    if (pts.length < minPurchases) continue;
    const ys = pts.map((p) => p.y);
    const first = ys[0];
    const last = ys[ys.length - 1];
    const spend = movements
      .filter((m) => m.ingredient_id === ing.id && isPurchase(m))
      .reduce((s, m) => s + moveValue(m), 0);
    out.push({
      id: ing.id, name: ing.name, unit: ing.unit,
      first, last, min: Math.min(...ys), max: Math.max(...ys),
      deltaPct: first > 0 ? ((last - first) / first) * 100 : 0,
      count: pts.length, spend,
    });
  }
  return out.sort((a, b) => b.deltaPct - a.deltaPct);
}

// ── Achats / consommation / pertes, mois par mois ─────────────────────
export type MonthRow = {
  month: string;      // "YYYY-MM"
  achats: number;
  conso: number;
  pertes: number;
  tauxPerte: number;  // pertes en % des achats du mois
};

/** Tous les mois de `from` à `to` inclus, même vides : un trou dans une série
 *  temporelle doit se voir comme un creux, pas disparaître de l'axe. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function monthlySummary(movements: StatMovement[]): MonthRow[] {
  if (movements.length === 0) return [];
  const acc = new Map<string, { achats: number; conso: number; pertes: number }>();
  let min = "9999-99", max = "0000-00";

  for (const m of movements) {
    const key = m.created_at.slice(0, 7);
    if (key < min) min = key;
    if (key > max) max = key;
    if (!acc.has(key)) acc.set(key, { achats: 0, conso: 0, pertes: 0 });
    const row = acc.get(key)!;
    const v = moveValue(m);
    if (isPurchase(m)) row.achats += v;
    else if (isLoss(m)) row.pertes += v;
    else if (isConsumption(m)) row.conso += v;
  }

  return monthRange(min, max).map((month) => {
    const r = acc.get(month) ?? { achats: 0, conso: 0, pertes: 0 };
    return { month, ...r, tauxPerte: r.achats > 0 ? (r.pertes / r.achats) * 100 : 0 };
  });
}

// ── Où part l'argent ──────────────────────────────────────────────────
export type SpendRow = { id: string; name: string; value: number; count: number };

export function topPurchased(movements: StatMovement[], ingredients: StatIngredient[], limit = 10): SpendRow[] {
  const names = new Map(ingredients.map((i) => [i.id, i.name]));
  const acc = new Map<string, { value: number; count: number }>();
  for (const m of movements) {
    if (!isPurchase(m)) continue;
    const cur = acc.get(m.ingredient_id) ?? { value: 0, count: 0 };
    cur.value += moveValue(m);
    cur.count += 1;
    acc.set(m.ingredient_id, cur);
  }
  return Array.from(acc.entries())
    .map(([id, v]) => ({ id, name: names.get(id) ?? "Produit supprimé", ...v }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Pertes regroupées par cause, sur la période. */
export function lossesByReason(movements: StatMovement[]): SpendRow[] {
  const acc = new Map<string, { value: number; count: number }>();
  for (const m of movements) {
    if (!isLoss(m)) continue;
    const key = (m.loss_reason ?? "").trim() || "Non précisée";
    const cur = acc.get(key) ?? { value: 0, count: 0 };
    cur.value += moveValue(m);
    cur.count += 1;
    acc.set(key, cur);
  }
  return Array.from(acc.entries())
    .map(([id, v]) => ({ id, name: id, ...v }))
    .sort((a, b) => b.value - a.value);
}

// ── Écart d'inventaire dans le temps ──────────────────────────────────
export type StatSession = {
  created_at: string;
  closing_at?: string | null;
  finalized_at?: string | null;
  status?: string;
  kind?: string;
  net_value?: number | null;
  inventory_lines?: { counted_qty: number | null; cmup: number | null }[];
};
export type InventoryPoint = { t: number; iso: string; valeur: number; ecart: number };

/**
 * Valeur réellement comptée et écart, à chaque inventaire finalisé.
 * Un brouillon d'inventaire n'est pas un constat : on l'ignore.
 */
export function inventorySeries(sessions: StatSession[], kind = "food"): InventoryPoint[] {
  return sessions
    .filter((s) => (s.status ?? "finalized") === "finalized" && (s.kind ?? "food") === kind)
    .map((s) => {
      const iso = s.closing_at || s.finalized_at || s.created_at;
      const valeur = (s.inventory_lines ?? []).reduce(
        (sum, l) => sum + Number(l.counted_qty ?? 0) * Number(l.cmup ?? 0), 0,
      );
      return { t: Date.parse(iso), iso, valeur, ecart: Number(s.net_value ?? 0) };
    })
    .sort((a, b) => a.t - b.t);
}
