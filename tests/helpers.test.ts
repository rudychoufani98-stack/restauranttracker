// =====================================================================
//  Libellés d'unités, conversions d'affichage, et e-mail de commande.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  displayUnitLabel, unitShort, perDisplayUnit, qtyToDisplay, qtyFromDisplay,
  calcCostPerBase, packTotal, priceTTC, UNIT_OPTIONS,
} from "@/lib/ingredient-helpers";
import { buildOrderMailto, defaultPackType, resolveHidePrices } from "@/lib/order-email";
import { doitCompresser, dimensionsCibles, poidsLisible } from "@/lib/compress-image";

describe("Libellés d'unités (jamais de gramme à l'écran)", () => {
  it("affiche kg / L / pce", () => {
    expect(displayUnitLabel("kg")).toBe("kg");
    expect(displayUnitLabel("g")).toBe("kg");     // ancien produit affiché en kg
    expect(displayUnitLabel("l")).toBe("L");
    expect(displayUnitLabel("ml")).toBe("L");
    expect(displayUnitLabel("unit")).toBe("pce");
    expect(displayUnitLabel("piece")).toBe("pce");
  });

  it("unitShort reste FIDÈLE à l'unité stockée (pour les tailles de colis)", () => {
    expect(unitShort("l")).toBe("L");
    expect(unitShort("unit")).toBe("pièce");
    expect(unitShort("g")).toBe("g");             // 1000 g ne doit pas devenir 1000 kg
    expect(unitShort("kg")).toBe("kg");
  });

  it("ne propose que kg, L et pièce à la saisie", () => {
    expect(UNIT_OPTIONS.map((u) => u.value)).toEqual(["kg", "l", "unit"]);
  });
});

describe("Conversions d'affichage", () => {
  it("coût par unité de base → par kg/L (×1000), pièce inchangée", () => {
    expect(perDisplayUnit(0.0048, "l")).toBeCloseTo(4.8, 6);
    expect(perDisplayUnit(0.0012, "g")).toBeCloseTo(1.2, 6);   // legacy
    expect(perDisplayUnit(0.45, "unit")).toBeCloseTo(0.45, 6);
  });

  it("aller-retour quantité base ↔ affichage", () => {
    expect(qtyToDisplay(15000, "l")).toBe(15);
    expect(qtyFromDisplay(15, "l")).toBe(15000);
    expect(qtyToDisplay(48, "unit")).toBe(48);
    expect(qtyFromDisplay(48, "unit")).toBe(48);
    expect(qtyFromDisplay(qtyToDisplay(2500, "kg"), "kg")).toBe(2500);
  });
});

describe("Coût d'achat par unité de base", () => {
  it("bidon de 5 L à 24 € → 0,0048 €/ml", () => {
    expect(calcCostPerBase(24, 1, 5, "l")).toBeCloseTo(0.0048, 8);
  });
  it("caisse de 24 canettes à 10,80 € → 0,45 €/pièce", () => {
    expect(calcCostPerBase(10.8, 24, 1, "unit")).toBeCloseTo(0.45, 8);
  });
  it("colis de 4 × 3 L à 55 € → 12 L", () => {
    expect(packTotal(4, 3)).toBe(12);
    expect(calcCostPerBase(55, 4, 3, "l")).toBeCloseTo(55 / 12000, 10);
  });
  it("renvoie 0 (et ne divise pas par zéro) si la taille manque", () => {
    expect(calcCostPerBase(24, 1, 0, "l")).toBe(0);
  });
  it("TVA : 24 € HT à 5,5 % → 25,32 € TTC", () => {
    expect(priceTTC(24, 5.5)).toBeCloseTo(25.32, 6);
  });
});

describe("Type de conditionnement déduit de l'unité", () => {
  it("gros volume → bidon", () => {
    expect(defaultPackType("l", 25)).toBe("bidon");
    expect(defaultPackType("l", 5)).toBe("bidon");
    expect(defaultPackType("ml", 5000)).toBe("bidon");
  });
  it("viande au kilo → kg", () => {
    expect(defaultPackType("kg", 1)).toBe("kg");
    expect(defaultPackType("g", 1000)).toBe("kg");
  });
  it("le reste → colis", () => {
    expect(defaultPackType("unit", 24)).toBe("colis");
    expect(defaultPackType("kg", 5)).toBe("colis");
  });
});

describe("E-mail de commande (mailto, envoyé par le restaurateur)", () => {
  const base = {
    to: "commandes@metro.fr",
    restaurantName: "Restaurant Démo",
    orderNumber: "BDC-2026-0001",
    customerReference: "CLI-42",
    lines: [
      { name: "Huile olive", qty: 3, packType: "bidon", ref: "REF-9" },
      { name: "Tomate", qty: 2, packType: "colis" },
    ],
    total: 100,
  };

  it("adresse, objet et contenu reprennent la commande", () => {
    const url = buildOrderMailto(base);
    expect(url.startsWith("mailto:commandes@metro.fr")).toBe(true);
    const body = decodeURIComponent(url.split("body=")[1] ?? "");
    expect(body).toContain("Huile olive");
    expect(body).toContain("3 bidon");
    expect(body).toContain("2 colis");
    expect(body).toContain("CLI-42");
    expect(body).toContain("Restaurant Démo");
  });

  it("l'option « cacher les prix » retire les montants", () => {
    const withPrices = decodeURIComponent(buildOrderMailto(base).split("body=")[1] ?? "");
    const hidden = decodeURIComponent(buildOrderMailto({ ...base, hidePrices: true }).split("body=")[1] ?? "");
    expect(withPrices).toContain("100");
    expect(hidden).not.toContain("100.00");
    expect(hidden).toContain("Huile olive"); // les produits restent
  });
});

describe("Prix sur le bon de commande : par commande ou réglage global", () => {
  it("sans choix sur la commande, on suit le réglage global", () => {
    expect(resolveHidePrices(null, true)).toBe(true);
    expect(resolveHidePrices(null, false)).toBe(false);
    expect(resolveHidePrices(undefined, true)).toBe(true);
  });
  it("un choix sur la commande l'emporte sur le global", () => {
    expect(resolveHidePrices(false, true)).toBe(false);  // global masque, ce bon affiche
    expect(resolveHidePrices(true, false)).toBe(true);   // global affiche, ce bon masque
  });
  it("aucun réglage du tout : les prix sont affichés", () => {
    expect(resolveHidePrices(null, null)).toBe(false);
    expect(resolveHidePrices(undefined, undefined)).toBe(false);
  });
});

describe("Compression des photos de bons de livraison", () => {
  it("compresse une photo de téléphone (2 MB)", () => {
    expect(doitCompresser("image/jpeg", 2 * 1024 * 1024)).toBe(true);
    expect(doitCompresser("image/png", 3 * 1024 * 1024)).toBe(true);
  });
  it("ne touche PAS un PDF fournisseur (document officiel)", () => {
    expect(doitCompresser("application/pdf", 5 * 1024 * 1024)).toBe(false);
  });
  it("laisse tranquille une image déjà légère", () => {
    expect(doitCompresser("image/jpeg", 150 * 1024)).toBe(false);
  });
  it("ne casse pas un GIF animé", () => {
    expect(doitCompresser("image/gif", 2 * 1024 * 1024)).toBe(false);
  });
  it("réduit le plus grand côté à 1600 px en gardant les proportions", () => {
    expect(dimensionsCibles(4032, 3024)).toEqual({ largeur: 1600, hauteur: 1200 });
    expect(dimensionsCibles(3024, 4032)).toEqual({ largeur: 1200, hauteur: 1600 });
    // Une image déjà petite n'est pas agrandie
    expect(dimensionsCibles(800, 600)).toEqual({ largeur: 800, hauteur: 600 });
  });
  it("affiche un poids lisible", () => {
    expect(poidsLisible(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(poidsLisible(300 * 1024)).toBe("300 KB");
  });
});
