// Formatage des montants et pourcentages, en français.
//
// On n'utilise pas toLocaleString pour l'argent : le rendu serveur et le
// rendu navigateur doivent produire exactement la même chaîne, sans dépendre
// de la locale ou de la version d'ICU de la machine.

/** « 1 252,30 € » — espace insécable avant l'unité, virgule décimale. */
export function eur(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const neg = v < 0;
  const [ent, dec] = Math.abs(v).toFixed(2).split(".");
  // Séparateur de milliers : espace ordinaire — une espace fine casserait
  // toute comparaison de chaîne pour un gain invisible.
  const milliers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "−" : ""}${milliers},${dec} €`;
}

/** « +12,4 % » — le signe est porteur de sens, on le garde toujours. */
export function pct(n: number): string {
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

/** Quantité lisible : « 1 250 » ou « 2,5 », sans zéros inutiles. */
export function nombre(n: number, maxDecimales = 2): string {
  const v = Number(n) || 0;
  const arrondi = Number(v.toFixed(maxDecimales));
  const [ent, dec] = String(Math.abs(arrondi)).split(".");
  const milliers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${arrondi < 0 ? "−" : ""}${milliers}${dec ? `,${dec}` : ""}`;
}

/**
 * « 1 206 € » — sans centimes, pour les tuiles de synthèse où l'ordre de
 * grandeur compte plus que le détail. Le symbole reste APRÈS le nombre.
 */
export function eur0(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}
