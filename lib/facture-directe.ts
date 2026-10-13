// =====================================================================
//  Une facture déposée telle quelle, sans bon de commande.
//
//  Le circuit normal est commande → réception → facture. Mais la moitié
//  des achats d'un restaurant n'a jamais vu de bon de commande : on passe
//  chez le grossiste, on appelle le boucher, le livreur laisse un ticket.
//  Ces factures-là finissaient saisies à la main, produit par produit —
//  ou pas saisies du tout, et l'inventaire s'en apercevait trois mois
//  plus tard.
//
//  Ce fichier calcule TOUT avant la moindre écriture : les quantités en
//  unités de base, le nouveau coût moyen, les mouvements de stock, et
//  les avertissements. L'écran montre le plan, le restaurateur corrige,
//  et seulement ensuite on écrit. Un chiffre lu sur une photo n'a pas
//  l'autorité d'un chiffre saisi : il se relit avant de toucher au stock.
// =====================================================================
import { applyReception, basePerPack } from "./costing";

/** Ce que le catalogue sait d'un produit au moment de la facture. */
export type ProduitStock = {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  cmup: number | null;
  pack_quantity: number;
  cost_per_base_unit: number;
  /** Contenu d'un colis CHEZ CE FOURNISSEUR, en unités de base (g/ml/pièce). */
  basePerPack?: number | null;
};

/** Une ligne de la facture, après relecture par le restaurateur. */
export type LigneFacture = {
  /** Ce que la facture imprime — gardé tel quel, c'est la preuve. */
  designation: string;
  /** Le produit du catalogue auquel cette ligne va. */
  ingredient_id: string | null;
  /** Nombre de colis facturés. */
  qty: number;
  /** Prix d'UN colis, HT. */
  prix: number;
  /**
   * Ce qu'on en fait :
   *   stock   — entre en stock sur le produit choisi
   *   frais   — compte dans le total sans toucher au stock (consigne,
   *             transport, taxe) : la facture doit tomber juste même
   *             quand toutes ses lignes ne sont pas de la marchandise
   *   ignorer — ne compte nulle part
   */
  action: "stock" | "frais" | "ignorer";
};

export type Mouvement = {
  ingredient_id: string;
  /** Quantité en unités de base (g / ml / pièce). */
  qty: number;
  /** Coût d'une unité de base, au prix facturé. */
  unit_cost: number;
};

export type Patch = {
  id: string;
  stock_qty: number;
  cmup: number;
  cost_per_base_unit: number;
  pack_price: number;
};

export type Avertissement = { ligne: string; texte: string };

export type PlanFacture = {
  mouvements: Mouvement[];
  patches: Patch[];
  /** Lignes à écrire dans invoice_lines (marchandise seulement). */
  lignes: { ingredient_id: string; quantity: number; unit_price: number }[];
  /** Somme des lignes marchandise. */
  totalMarchandise: number;
  /** Somme des lignes « frais ». */
  totalFrais: number;
  /** Ce que la facture coûte en tout. */
  total: number;
  avertissements: Avertissement[];
};

const arrondi = (n: number) => Math.round(n * 100) / 100;

/**
 * Le contenu d'un colis en unités de base, pour ce produit.
 *
 * Priorité au conditionnement du FOURNISSEUR : le même sac de pois
 * chiches fait 25 kg chez l'un et 5 kg chez l'autre, et c'est le colis
 * facturé qui décide de ce qui entre en stock.
 */
export function contenuColis(p: ProduitStock): number {
  const fournisseur = Number(p.basePerPack ?? 0);
  if (fournisseur > 0) return fournisseur;
  // Zéro veut dire INCONNU, pas « un kilo ». Ailleurs dans l'app, un
  // colisage absent retombe sur 1 parce qu'une commande a déjà fixé les
  // quantités ; ici la facture est la seule source, et supposer « 1 kg »
  // mettrait un kilo en stock à la place d'un sac de 25.
  const q = Number(p.pack_quantity ?? 0);
  if (!(q > 0)) return 0;
  return p.unit === "kg" || p.unit === "l" ? q * 1000 : q;
}

/**
 * Construit le plan complet — sans rien écrire.
 *
 * Deux lignes du même produit s'ADDITIONNENT : une facture qui liste la
 * même référence deux fois (deux palettes, deux dates de livraison) ne
 * doit pas voir la seconde écraser la première.
 */
export function planFacture(
  lignes: LigneFacture[],
  produits: ProduitStock[],
  /** Le total HT imprimé sur la facture, quand on a su le lire. */
  totalImprime?: number | null,
): PlanFacture {
  const parId = new Map(produits.map((p) => [p.id, p]));
  const avertissements: Avertissement[] = [];

  // 1. Cumuler par produit AVANT de toucher au stock.
  const cumul = new Map<string, { base: number; valeur: number; colis: number; prix: number }>();
  const lignesFacture: PlanFacture["lignes"] = [];
  let totalMarchandise = 0;
  let totalFrais = 0;

  for (const l of lignes) {
    if (l.action === "ignorer") continue;

    if (l.action === "frais") {
      totalFrais += (l.qty || 1) * l.prix;
      continue;
    }

    if (!l.ingredient_id) {
      avertissements.push({ ligne: l.designation, texte: "Aucun produit choisi — cette ligne n'entrera pas en stock." });
      continue;
    }
    const p = parId.get(l.ingredient_id);
    if (!p) {
      avertissements.push({ ligne: l.designation, texte: "Produit introuvable dans le catalogue." });
      continue;
    }
    if (!(l.qty > 0)) {
      avertissements.push({ ligne: l.designation, texte: "Quantité à zéro — ligne sans effet." });
      continue;
    }
    const contenu = contenuColis(p);
    if (!(contenu > 0)) {
      avertissements.push({
        ligne: l.designation,
        texte: `« ${p.name} » n'a pas de conditionnement connu : impossible de savoir ce qu'un colis met en stock. Renseigne-le sur la fiche produit.`,
      });
      continue;
    }

    const base = l.qty * contenu;
    const c = cumul.get(p.id) ?? { base: 0, valeur: 0, colis: 0, prix: l.prix };
    c.base += base;
    c.valeur += l.qty * l.prix;
    c.colis += l.qty;
    c.prix = l.prix; // le dernier prix facturé fait foi pour la fiche
    cumul.set(p.id, c);

    totalMarchandise += l.qty * l.prix;
    lignesFacture.push({ ingredient_id: p.id, quantity: l.qty, unit_price: l.prix });
  }

  // 2. Un seul mouvement et un seul patch par produit.
  const mouvements: Mouvement[] = [];
  const patches: Patch[] = [];

  for (const [id, c] of Array.from(cumul.entries())) {
    const p = parId.get(id)!;
    const coutBase = c.valeur / c.base;
    const { newStock, newCmup } = applyReception(
      Number(p.stock_qty ?? 0), p.cmup ?? null, c.base, coutBase,
    );

    mouvements.push({ ingredient_id: id, qty: c.base, unit_cost: coutBase });

    // pack_price reste exprimé dans le colisage de la FICHE produit : si la
    // facture est dans celui du fournisseur, on convertit.
    const colisFiche = basePerPack(Number(p.pack_quantity ?? 1) || 1, 1, p.unit);
    const contenu = contenuColis(p);
    patches.push({
      id,
      stock_qty: newStock,
      cmup: newCmup,
      cost_per_base_unit: coutBase,
      pack_price: contenu === colisFiche ? c.prix : coutBase * colisFiche,
    });

    // Une hausse brutale se signale : c'est le moment de la voir, pas au
    // moment où la marge du plat s'effondre.
    const ancien = Number(p.cost_per_base_unit ?? 0);
    if (ancien > 0 && coutBase > ancien * 1.3) {
      avertissements.push({
        ligne: p.name,
        texte: `Le prix passe de ${(ancien * 1000).toFixed(2)} à ${(coutBase * 1000).toFixed(2)} € — vérifie le conditionnement avant de valider.`,
      });
    }
  }

  const total = arrondi(totalMarchandise + totalFrais);

  // 3. La somme tombe-t-elle sur le total imprimé ? C'est le contrôle que
  //    fait un comptable, et il attrape une ligne oubliée ou un prix lu de
  //    travers avant que ça n'entre en stock.
  if (totalImprime != null && Number.isFinite(totalImprime) && totalImprime > 0) {
    const ecart = arrondi(total - totalImprime);
    if (Math.abs(ecart) > 0.01) {
      avertissements.push({
        ligne: "Total",
        texte: `La somme des lignes fait ${total.toFixed(2)} € alors que la facture annonce ${totalImprime.toFixed(2)} € (${ecart > 0 ? "+" : ""}${ecart.toFixed(2)} €). Une ligne manque, ou un prix a été mal lu.`,
      });
    }
  }

  return {
    mouvements, patches, lignes: lignesFacture,
    totalMarchandise: arrondi(totalMarchandise),
    totalFrais: arrondi(totalFrais),
    total,
    avertissements,
  };
}
