// Shared helpers for ingredient costing & conditionnement.

export const UNITS = ["g", "kg", "ml", "l", "unit"];

// Common EU VAT rates — user can type any value too
export const VAT_PRESETS = [
  { label: "0% — Exonéré", value: "0" },
  { label: "5,5% — Produits alimentaires", value: "5.5" },
  { label: "10% — Restauration", value: "10" },
  { label: "20% — Taux normal", value: "20" },
];

// 14 allergènes à déclaration obligatoire (règlement UE 1169/2011)
export const ALLERGENS = [
  "Gluten", "Crustacés", "Œufs", "Poisson", "Arachides", "Soja", "Lait",
  "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques",
];

export function toBaseUnits(qty: number, unit: string): number {
  return unit === "kg" || unit === "l" ? qty * 1000 : qty;
}

// Total quantity of one purchase pack, in the usage unit (e.g. 6 × 0.75 L = 4.5 L).
export function packTotal(packUnits: number, unitSize: number): number {
  return (packUnits || 0) * (unitSize || 0);
}

// GROSS cost per base unit (g/ml/piece). Yield is applied later at consumption.
export function calcCostPerBase(packPrice: number, packUnits: number, unitSize: number, unit: string): number {
  const totalBase = toBaseUnits(packTotal(packUnits, unitSize), unit);
  if (!totalBase) return 0;
  return packPrice / totalBase;
}

export function baseUnitLabel(unit: string): string {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}

// Friendly display unit: weights → kg, volumes → L, else the unit itself.
export function displayUnitLabel(unit: string): string {
  return unit === "g" || unit === "kg" ? "kg" : unit === "ml" || unit === "l" ? "L" : unit;
}

// Convert a per-base-unit cost (€/g or €/ml) to a per-display-unit cost (€/kg or €/L).
export function perDisplayUnit(costPerBase: number, unit: string): number {
  const isWeightVol = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return isWeightVol ? costPerBase * 1000 : costPerBase;
}

export function priceTTC(priceHT: number, vatRate: number): number {
  return priceHT * (1 + vatRate / 100);
}
