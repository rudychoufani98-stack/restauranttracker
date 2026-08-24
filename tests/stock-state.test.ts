// =====================================================================
//  État des stocks : distinguer « épuisé » de « jamais reçu ».
//
//  Le cas réel qui a motivé ce code : un compte avec 100 fiches produits
//  créées à l'ouverture, dont 97 jamais reçues. L'écran affichait
//  « 97 à commander » — un nombre vrai mais inutilisable.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  etatStock, aCommander, compteEtats, dernierMouvement, depuisQuand,
  ETAT_LABEL, type EtatStock,
} from "@/lib/stock-state";
import { eur, pct, nombre } from "@/lib/format";

describe("État d'un produit", () => {
  it("fiche créée mais jamais reçue → ce n'est PAS une alerte", () => {
    expect(etatStock({ stock_qty: 0 }, 0)).toBe("jamais");
    expect(etatStock({ stock_qty: null, reorder_threshold: null }, 0)).toBe("jamais");
    expect(aCommander("jamais")).toBe(false);
  });

  it("produit utilisé puis tombé à zéro → en rupture", () => {
    expect(etatStock({ stock_qty: 0 }, 12)).toBe("rupture");
    expect(aCommander("rupture")).toBe(true);
  });

  it("un seuil de réappro vaut décision : le produit est suivi même sans mouvement", () => {
    // Le restaurateur a saisi « alerte sous 5 kg » : il attend l'alerte.
    expect(etatStock({ stock_qty: 0, reorder_threshold: 5000 }, 0)).toBe("rupture");
  });

  it("sous le seuil mais pas à zéro → à commander", () => {
    expect(etatStock({ stock_qty: 3000, reorder_threshold: 5000 }, 4)).toBe("bas");
    expect(etatStock({ stock_qty: 5000, reorder_threshold: 5000 }, 4)).toBe("bas"); // seuil inclus
  });

  it("stock confortable → rien à signaler", () => {
    expect(etatStock({ stock_qty: 20000, reorder_threshold: 5000 }, 4)).toBe("ok");
    expect(etatStock({ stock_qty: 20000 }, 4)).toBe("ok");
    expect(aCommander("ok")).toBe(false);
  });

  it("un stock négatif (sortie de plus que le stock) reste une rupture", () => {
    expect(etatStock({ stock_qty: -500 }, 8)).toBe("rupture");
  });

  it("chaque état a un libellé lisible", () => {
    const etats: EtatStock[] = ["rupture", "bas", "ok", "jamais"];
    for (const e of etats) expect(ETAT_LABEL[e].length).toBeGreaterThan(2);
  });
});

describe("Comptage sur une carte réaliste", () => {
  // 100 produits : 95 jamais reçus, 2 en rupture, 1 sous le seuil, 2 en stock.
  const rows = [
    ...Array.from({ length: 95 }, () => ({ etat: "jamais" as EtatStock, value: 0 })),
    { etat: "rupture" as EtatStock, value: 0 },
    { etat: "rupture" as EtatStock, value: 0 },
    { etat: "bas" as EtatStock, value: 40 },
    { etat: "ok" as EtatStock, value: 900 },
    { etat: "ok" as EtatStock, value: 312.3 },
  ];

  it("l'alerte tombe de 98 à 3 — c'est le but", () => {
    const c = compteEtats(rows);
    expect(c.total).toBe(100);
    expect(c.jamais).toBe(95);
    expect(c.rupture + c.bas).toBe(3);
    expect(c.ok).toBe(2);
  });

  it("la valeur totale du stock reste juste", () => {
    expect(compteEtats(rows).valeur).toBeCloseTo(1252.3, 4);
  });

  it("une liste vide ne casse rien", () => {
    const c = compteEtats([]);
    expect(c.total).toBe(0);
    expect(c.valeur).toBe(0);
  });
});

describe("Dernier mouvement", () => {
  it("prend le plus récent, quel que soit l'ordre reçu", () => {
    expect(dernierMouvement([
      { created_at: "2026-03-01T10:00:00Z" },
      { created_at: "2026-08-15T09:00:00Z" },
      { created_at: "2026-05-20T12:00:00Z" },
    ])).toBe("2026-08-15T09:00:00Z");
  });

  it("renvoie null quand le produit n'a jamais bougé", () => {
    expect(dernierMouvement([])).toBeNull();
  });

  it("ignore les dates manquantes", () => {
    expect(dernierMouvement([{ created_at: "" }, { created_at: "2026-01-02T00:00:00Z" }]))
      .toBe("2026-01-02T00:00:00Z");
  });
});

describe("Depuis quand (repère lisible)", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");

  it("dit les choses comme on les dit en cuisine", () => {
    expect(depuisQuand("2026-08-24T08:00:00Z", now)).toBe("aujourd'hui");
    expect(depuisQuand("2026-08-23T08:00:00Z", now)).toBe("hier");
    expect(depuisQuand("2026-08-14T12:00:00Z", now)).toBe("il y a 10 jours");
    expect(depuisQuand("2026-05-24T12:00:00Z", now)).toBe("il y a 3 mois");
    expect(depuisQuand("2025-01-24T12:00:00Z", now)).toBe("il y a plus d'un an");
  });

  it("ne ment pas quand il n'y a rien", () => {
    expect(depuisQuand(null, now)).toBe("jamais reçu");
    expect(depuisQuand("pas une date", now)).toBe("jamais reçu");
  });
});

describe("Formatage français des montants", () => {
  it("sépare les milliers et met la virgule", () => {
    expect(eur(1252.3)).toBe("1 252,30 €");
    expect(eur(899)).toBe("899,00 €");
    expect(eur(0)).toBe("0,00 €");
    expect(eur(1234567.891)).toBe("1 234 567,89 €");
  });

  it("affiche un négatif avec un vrai signe moins", () => {
    expect(eur(-6)).toBe("−6,00 €");
  });

  it("survit à une valeur absente", () => {
    expect(eur(NaN)).toBe("0,00 €");
  });

  it("garde le signe des pourcentages", () => {
    expect(pct(25)).toBe("+25,0 %");
    expect(pct(-4.25)).toBe("−4,3 %");
  });

  it("écrit les quantités sans zéros inutiles", () => {
    expect(nombre(1250)).toBe("1 250");
    expect(nombre(2.5)).toBe("2,5");
    expect(nombre(2.004)).toBe("2");
  });
});
