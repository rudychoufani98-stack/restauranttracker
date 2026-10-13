// =====================================================================
//  Lire un document fournisseur : bon de livraison ou facture.
//
//  Le probleme n est pas la lecture, c est le RAPPROCHEMENT. Une facture
//  ne connait pas tes noms : elle imprime les siens. Chez le premier
//  client, le halloumi s appelle « FROMAGE GRILL & FRYKOLIOS 40x250G »
//  chez Chirag. Chercher « halloumi » dedans ne donne rien.
//
//  D ou la regle : on cherche d abord la DESIGNATION FOURNISSEUR — celle
//  que la fiche produit range justement pour ca — puis le nom du
//  produit, puis les mots en commun. Et quand deux lignes se disputent
//  le meme produit, on ne tranche pas : une ligne qu on laisse vide se
//  remarque, une ligne remplie de travers passe inapercue jusqu a
//  l inventaire.
// =====================================================================
import { normalise } from "./import-produits";

/** Une ligne lue sur le document. */
export type LigneLue = { name: string; quantity: number | null; price: number | null };

/** Un produit de la commande, avec les noms sous lesquels il peut apparaitre. */
export type Attendu = {
  ingredient_id: string;
  nom: string;
  /** Designations de ce produit chez CE fournisseur. */
  designations?: string[];
};

/** Mots trop courts ou trop communs pour designer un produit a eux seuls. */
const MOTS_VIDES = new Set([
  "de", "du", "des", "le", "la", "les", "un", "une", "et", "ou", "au", "aux",
  "kg", "kgs", "g", "gr", "l", "ml", "cl", "pce", "pces", "piece", "pieces",
  "colis", "carton", "sac", "sachet", "bidon", "seau", "boite", "caisse",
  "lot", "x", "cat", "ref", "bio", "frais", "surgele", "france",
]);

function motsUtiles(texte: string): string[] {
  return normalise(texte).split(" ").filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
}

/**
 * Le score d un rapprochement, de 0 (rien) a 3 (certain).
 *
 * Exporte pour que les tests disent pourquoi une ligne s accroche.
 */
export function score(lu: string, candidat: string): number {
  const a = normalise(lu), b = normalise(candidat);
  if (!a || !b) return 0;
  if (a === b) return 3;
  // L un contient l autre EN ENTIER : « tahina » dans « tahina chirag 18 kg ».
  if (a.includes(b) || b.includes(a)) return 2;
  const ma = motsUtiles(a), mb = motsUtiles(b);
  if (ma.length === 0 || mb.length === 0) return 0;
  const communs = ma.filter((m) => mb.includes(m));
  if (communs.length >= 2) return 2;
  // Un seul mot en commun suffit s il est long : « halloumi », « basturma ».
  if (communs.length === 1 && communs[0].length >= 6) return 1;
  return 0;
}

export type Rapprochement = {
  /** Ce qui a ete rapproche, par produit. */
  trouves: Map<string, LigneLue>;
  /** Lignes du document qu on n a pas su placer. */
  orphelines: LigneLue[];
  /** Produits attendus qui n apparaissent pas sur le document. */
  manquants: Attendu[];
};

/**
 * Rapproche les lignes lues des produits attendus.
 *
 * Chaque ligne lue ne sert qu une fois, et chaque produit n est servi
 * qu une fois : une facture qui liste deux fois le meme article ne doit
 * pas ecraser la premiere lecture en silence.
 */
export function rapprocher(lues: LigneLue[], attendus: Attendu[]): Rapprochement {
  type Paire = { i: number; j: number; s: number };
  const paires: Paire[] = [];

  lues.forEach((lu, i) => {
    attendus.forEach((att, j) => {
      // La designation fournisseur d abord : c est elle qui est imprimee.
      const candidats = [...(att.designations ?? []), att.nom];
      const s = Math.max(0, ...candidats.map((c) => score(lu.name, c)));
      if (s > 0) paires.push({ i, j, s });
    });
  });

  paires.sort((a, b) => b.s - a.s);

  const trouves = new Map<string, LigneLue>();
  const luesPrises = new Set<number>();
  const attPris = new Set<number>();

  for (const p of paires) {
    if (luesPrises.has(p.i) || attPris.has(p.j)) continue;
    // Egalite parfaite entre deux candidats du meme score : on s abstient.
    const concurrent = paires.find(
      (q) => q !== p && q.s === p.s && !luesPrises.has(q.i) && !attPris.has(q.j) &&
        (q.i === p.i || q.j === p.j),
    );
    if (concurrent && p.s < 3) continue;
    luesPrises.add(p.i);
    attPris.add(p.j);
    trouves.set(attendus[p.j].ingredient_id, lues[p.i]);
  }

  return {
    trouves,
    orphelines: lues.filter((_, i) => !luesPrises.has(i)),
    manquants: attendus.filter((_, j) => !attPris.has(j)),
  };
}

/**
 * La consigne envoyee au modele de lecture.
 *
 * Les designations attendues y figurent : un modele qui sait quoi
 * chercher recopie mieux qu un modele qui decouvre la page.
 */
export function consigne(type: "facture" | "bl", attendus: Attendu[]): string {
  const noms = attendus
    .map((a) => [...(a.designations ?? []), a.nom].filter(Boolean).join(" / "))
    .filter(Boolean)
    .join(" ; ");

  const quoi = type === "facture"
    ? "This is a supplier INVOICE (facture fournisseur)."
    : "This is a supplier DELIVERY NOTE (bon de livraison).";

  return `${quoi}
Extract every line item exactly as printed, plus the document header.
${noms ? `The order contained these products, named like this by the supplier: ${noms}.` : ""}
Return ONLY a JSON object, no other text:
{"numero": "document number or null", "date": "YYYY-MM-DD or null", "total_ht": number_or_null,
 "items": [{"name": "line label as printed", "quantity": number_or_null, "price": unit_price_in_euros_or_null}]}
Rules:
- "price" is the price for ONE unit of the packaging billed (one colis, one sac, one kg…), never the line total.
- If the document shows only a line total, divide it by the quantity.
- Keep the supplier's own wording in "name". Do not translate, do not guess products that are not printed.`;
}

/** Extrait l objet JSON d une reponse de modele, tolerant au bavardage. */
export function lireReponse(texte: string): {
  numero: string | null; date: string | null; total_ht: number | null; items: LigneLue[];
} {
  const vide = { numero: null, date: null, total_ht: null, items: [] as LigneLue[] };
  if (!texte) return vide;

  const nombre = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const propre = (brut: any) => ({
    numero: brut?.numero ? String(brut.numero) : null,
    date: brut?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(brut.date)) ? String(brut.date) : null,
    total_ht: nombre(brut?.total_ht),
    items: (Array.isArray(brut?.items) ? brut.items : [])
      .filter((x: any) => x && typeof x.name === "string" && x.name.trim())
      .map((x: any) => ({ name: String(x.name).trim(), quantity: nombre(x.quantity), price: nombre(x.price) })),
  });

  // Lequel des deux commence ? Un tableau de lignes contient des accolades :
  // chercher l objet d abord y attraperait la PREMIERE ligne et la prendrait
  // pour le document entier.
  const iObj = texte.indexOf("{"), iTab = texte.indexOf("[");
  const tableauDAbord = iTab >= 0 && (iObj < 0 || iTab < iObj);

  if (tableauDAbord) {
    const tab = texte.match(/\[[\s\S]*\]/);
    if (tab) { try { return propre({ items: JSON.parse(tab[0]) }); } catch { /* on tente l objet */ } }
  }
  const obj = texte.match(/\{[\s\S]*\}/);
  if (obj) { try { return propre(JSON.parse(obj[0])); } catch { /* on tente le tableau */ } }
  const tab = texte.match(/\[[\s\S]*\]/);
  if (tab) { try { return propre({ items: JSON.parse(tab[0]) }); } catch { return vide; } }
  return vide;
}
