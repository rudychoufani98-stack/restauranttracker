// =====================================================================
//  Numérotation interne des produits.
//
//  Le principe : le PREMIER CHIFFRE dit la famille. En voyant 5042 sur un
//  bon de commande ou une étiquette de bac, on sait qu'on est en épicerie
//  sans rien consulter.
//
//    1xxx  Viandes                 7xxx  Surgelés
//    2xxx  Poissons                8xxx  Boissons sans alcool
//    3xxx  Fruits & légumes        9xxx  Bières & cidres
//    4xxx  Crèmerie & fromages    10xxx  Vins & champagnes
//    5xxx  Épicerie               11xxx  Spiritueux & apéritifs
//    6xxx  Boulangerie            12xxx  Fournitures & emballages
//
//  L'alcool occupe TROIS blocs distincts, et ce n'est pas du luxe : la
//  cave se gère et s'inventorie à part, sa TVA n'est pas celle de la
//  nourriture, et un seul bloc « Boissons » aurait envoyé les vins et les
//  spiritueux dans les blocs libres — donc rangés au hasard.
//  Bénéfice au passage : le coût boissons se sépare du coût matière d'un
//  simple regard sur le premier chiffre.
//
//  Des blocs de MÊME taille, sans chevauchement : « viandes 0-100 puis
//  épicerie 100-1000 » se marcherait dessus dès le centième produit, et
//  un numéro à 2 chiffres à côté d'un numéro à 4 ne se trie pas à l'œil.
//
//  Les blocs restent modifiables par catégorie (categories.ref_start) :
//  ceci n'est qu'un point de départ raisonnable.
// =====================================================================
import { normalise } from "./import-produits";

export const TAILLE_BLOC = 1000;

export type Famille = { debut: number; nom: string; motsCles: string[] };

/** Familles reconnues, dans l'ordre des blocs. */
export const FAMILLES: Famille[] = [
  { debut: 1000, nom: "Viandes", motsCles: ["viande", "viandes", "boucherie", "volaille", "volailles", "charcuterie", "gibier", "agneau", "boeuf", "porc", "poulet"] },
  { debut: 2000, nom: "Poissons & fruits de mer", motsCles: ["poisson", "poissons", "maree", "fruits de mer", "crustace", "crustaces", "coquillage", "saumon", "thon"] },
  { debut: 3000, nom: "Fruits & légumes", motsCles: ["legume", "legumes", "fruit", "fruits", "primeur", "primeurs", "salade", "herbes fraiches"] },
  { debut: 4000, nom: "Crèmerie & fromages", motsCles: ["cremerie", "fromage", "fromages", "laitier", "laitiers", "lait", "beurre", "creme", "oeuf", "oeufs", "yaourt"] },
  { debut: 5000, nom: "Épicerie", motsCles: ["epicerie", "huile", "huiles", "sauce", "sauces", "condiment", "condiments", "herbe", "herbes", "epice", "epices", "grain", "grains", "riz", "pate", "pates", "conserve", "conserves", "farine", "sucre", "sec", "secs", "legumineuse"] },
  { debut: 6000, nom: "Boulangerie & pâtisserie", motsCles: ["pain", "pains", "boulangerie", "patisserie", "viennoiserie", "viennoiseries", "dessert", "desserts"] },
  { debut: 7000, nom: "Surgelés", motsCles: ["surgele", "surgeles", "congele", "congeles", "glace", "glaces", "sorbet"] },
  { debut: 8000, nom: "Boissons sans alcool", motsCles: ["boisson", "boissons", "soft", "softs", "soda", "sodas", "eau", "eaux", "jus", "cafe", "the", "infusion", "sirop", "sirops"] },
  { debut: 9000, nom: "Bières & cidres", motsCles: ["biere", "bieres", "cidre", "cidres", "pression"] },
  { debut: 10000, nom: "Vins & champagnes", motsCles: ["vin", "vins", "champagne", "champagnes", "cave", "rouge", "blanc", "rose", "petillant"] },
  { debut: 11000, nom: "Spiritueux & apéritifs", motsCles: ["spiritueux", "alcool", "alcools", "aperitif", "aperitifs", "digestif", "digestifs", "whisky", "vodka", "rhum", "gin", "arak", "ouzo", "raki", "liqueur", "liqueurs", "cocktail", "cocktails"] },
  { debut: 12000, nom: "Fournitures & emballages", motsCles: ["fourniture", "fournitures", "emballage", "emballages", "entretien", "hygiene", "consommable", "consommables", "gobelet", "gobelets", "barquette", "serviette", "produit menager"] },
];

/**
 * Catégories qui ne classent rien : quand un produit porte l'une d'elles,
 * c'est son NOM qui doit décider de sa famille.
 */
const CATEGORIES_GENERIQUES = ["autre", "autres", "divers", "non classe", "sans categorie", "a classer"];

/**
 * Vocabulaire des noms de PRODUITS, par bloc de famille.
 *
 * Sur un catalogue réel, la moitié des fiches est rangée dans « Autre » —
 * les numéroter sur la seule foi de la catégorie n'apprendrait rien. Le nom,
 * lui, dit presque toujours la vérité : « Agneau de lait » est une viande,
 * « Ailes de poulet halal » aussi.
 *
 * Cette liste n'a pas vocation à être exhaustive : elle couvre ce qu'on
 * rencontre vraiment, et tout ce qu'elle ne reconnaît pas retombe sur la
 * catégorie, comme avant.
 */
export const MOTS_PRODUITS: Record<number, string[]> = {
  1000: [
    "agneau", "boeuf", "veau", "porc", "poulet", "poule", "dinde", "canard", "lapin", "mouton",
    "entrecote", "bavette", "onglet", "gigot", "epaule", "collier", "jarret", "abats", "foie",
    "merguez", "chipolata", "saucisse", "saucisses", "jambon", "bacon", "lardons", "chorizo",
    "kefta", "kafta", "chawarma", "shawarma", "taouk", "kebab", "viande", "halal", "carcasse",
  ],
  2000: [
    "saumon", "thon", "cabillaud", "colin", "merlu", "dorade", "daurade",
    "truite", "sardine", "sardines", "anchois", "maquereau", "crevette", "crevettes", "gambas",
    "moule", "moules", "huitre", "huitres", "calamar", "calamars", "poulpe", "encornet", "seiche",
    "homard", "langoustine", "langoustines", "crabe", "poisson", "surimi",
  ],
  3000: [
    "tomate", "tomates", "salade", "laitue", "roquette", "concombre", "courgette", "courgettes",
    "aubergine", "aubergines", "poivron", "poivrons", "oignon", "oignons", "ail", "echalote",
    "carotte", "carottes", "pomme", "pommes", "patate", "navet", "poireau", "celeri", "chou",
    "champignon", "champignons", "epinard", "epinards", "haricot", "haricots", "petit pois",
    "citron", "citrons", "orange", "oranges", "banane", "bananes", "fraise", "fraises", "raisin",
    "melon", "pasteque", "avocat", "avocats", "persil", "coriandre", "menthe", "basilic", "aneth",
    "radis", "betterave", "courge", "potiron", "gingembre", "grenade", "figue", "figues",
    "datte", "dattes", "date", "dates", "feve", "feves", "artichaut", "artichauts",
  ],
  4000: [
    "lait", "beurre", "creme", "yaourt", "yaourts", "fromage", "mozzarella", "feta", "halloumi",
    "labneh", "labne", "akkawi", "kachkaval", "gruyere", "emmental", "parmesan", "comte", "chevre",
    "ricotta", "mascarpone", "oeuf", "oeufs", "cheddar", "raclette",
    "fetta", "samneh", "smen", "ghee", "kachta", "ashta",
  ],
  5000: [
    "huile", "vinaigre", "sel", "poivre", "sucre", "farine", "riz", "boulgour", "semoule",
    "couscous", "lentille", "lentilles", "pois chiche", "pois chiches", "haricot sec", "quinoa",
    "tahina", "tahini", "houmous", "melasse", "sumac", "zaatar", "za atar", "cumin", "curcuma",
    "paprika", "cannelle", "muscade", "curry", "safran", "origan", "thym", "laurier", "epice", "epices",
    "sauce", "ketchup", "mayonnaise", "moutarde", "harissa", "concentre", "conserve", "bocal",
    "olive", "olives", "cornichon", "cornichons", "miel", "confiture", "levure", "bicarbonate",
    "acide", "citrique", "amidon", "gelatine", "agar", "sesame", "noix", "amande", "amandes",
    "pistache", "pistaches", "noisette", "cacahuete", "chocolat", "cacao", "vanille", "pate", "pates",
    // Épices et aromates d'une carte libanaise.
    "cardamome", "cardamon", "girofle", "clou de girofle", "cloux girofle", "piment", "piments",
    "anis", "fenouil", "fenugrec", "carvi", "nigelle", "mahleb", "colorant", "colorants", "arome",
    "cheveux d ange", "vermicelle", "vermicelles", "feuille de vigne", "feuilles de vigne",
    "pignon", "pignons", "cajou", "graine", "graines",
    // « Eau de rose » et « Fleur d'oranger » sont des ARÔMES, pas des boissons :
    // sans ces expressions, le mot « eau » les envoyait au rayon soft.
    "eau de rose", "eau de fleur d oranger", "fleur d oranger", "eau de fleur",
    // « Vin de vinaigre » est du vinaigre, pas du vin.
    "vin de vinaigre", "vinaigre de vin",
    // Une plante moulue est une épice, même si fraîche c'est une herbe.
    "coriandre moulue", "menthe sechee", "persil seche",
  ],
  6000: ["pain", "pita", "baguette", "brioche", "croissant", "biscuit", "biscuits", "gateau", "tarte", "feuille de brick", "filo", "kunafa", "baklava"],
  7000: ["surgele", "surgelee", "congele", "congelee", "glace", "glaces", "sorbet", "frite", "frites"],
  8000: [
    "eau", "eaux", "jus", "soda", "limonade", "sirop", "cafe", "the", "infusion", "tisane",
    "coca", "cola", "pepsi", "fanta", "sprite", "seven up", "orangina", "schweppes", "perrier",
    "evian", "vittel", "badoit", "san pellegrino", "ice tea", "red bull", "ayran", "jallab",
  ],
  9000: ["biere", "bieres", "cidre", "almaza", "heineken", "kronenbourg", "corona", "desperados", "leffe", "1664", "beirut beer", "961"],
  10000: ["vin", "vins", "champagne", "prosecco", "chardonnay", "merlot", "cabernet", "rose",
          "bordeaux", "ksara", "kefraya", "ixsir"],
  // L'arak titre 50° : c'est un distillat, pas un vin. Relevé sur la carte
  // d'Amaly, où « Arak Brun 70 cl » partait dans la cave à vins.
  11000: ["whisky", "vodka", "rhum", "gin", "tequila", "arak", "ouzo", "raki", "liqueur",
          "cognac", "armagnac", "porto", "martini", "aperol", "campari", "triple sec", "curacao"],
  12000: [
    "gobelet", "gobelets", "serviette", "serviettes", "barquette", "barquettes", "sac", "sacs",
    "papier", "aluminium", "film", "essuie", "detergent", "javel", "liquide vaisselle", "gant",
    "gants", "couvercle", "couvercles", "boite a emporter", "carton", "cartons", "paille", "pailles",
  ],
};

/**
 * Mots qui n'engagent presque rien tout seuls : une découpe s'applique
 * aussi bien à une viande qu'à un poisson, et « bar », « sole » ou « lieu »
 * sont des mots courants du français avant d'être des poissons.
 *
 * Ils ne décident qu'en DERNIER recours : « Filet de saumon » est un
 * saumon, « Filet mignon » est une viande.
 */
export const MOTS_FAIBLES: Record<number, string[]> = {
  1000: ["filet", "filets", "cote", "cotes", "escalope", "escalopes", "aile", "ailes",
         "cuisse", "cuisses", "hache", "steak", "brochette", "brochettes"],
  2000: ["bar", "sole", "lieu", "raie"],
};

/** Premier bloc laissé aux catégories que l'on ne reconnaît pas. */
export const PREMIER_BLOC_LIBRE = 13000;

/** « 5042 » — toujours au moins 4 chiffres, pour que le tri texte marche. */
export function formatRef(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return String(Math.trunc(Number(n))).padStart(4, "0");
}

/**
 * La famille dont un nom de catégorie relève, ou null si on ne sait pas.
 *
 * L'ordre des tentatives compte, parce que les noms de catégories sont
 * ambigus : « Jus de fruits » contient « fruits » mais c'est une boisson,
 * et « Fruits de mer » contient « fruits » mais c'est de la marée.
 */
export function familleDe(nomCategorie: string): Famille | null {
  const t = normalise(nomCategorie);
  if (!t) return null;
  const mots = t.split(" ").filter(Boolean);
  const cle = (m: string) => normalise(m);

  // 1. Le nom EST un mot-clé. « Pâtes » ne doit pas basculer en boulangerie
  //    par le fragment « patisserie ».
  for (const f of FAMILLES) if (f.motsCles.some((m) => cle(m) === t)) return f;

  // 2. Un mot-clé en PLUSIEURS mots apparaît tel quel : « Fruits de mer »
  //    est de la marée, pas du primeur.
  for (const f of FAMILLES) {
    if (f.motsCles.some((m) => cle(m).includes(" ") && t.includes(cle(m)))) return f;
  }

  // 3. Le PREMIER mot décide : en français c'est lui qui porte le sens.
  //    « Jus de fruits » est un jus ; « Vins rouges » est un vin.
  for (const f of FAMILLES) if (f.motsCles.some((m) => cle(m) === mots[0])) return f;

  // 4. À défaut, n'importe quel mot du nom.
  for (const f of FAMILLES) if (f.motsCles.some((m) => mots.includes(cle(m)))) return f;

  return null;
}

/** Un nom de catégorie qui ne classe rien (« Autre », « Divers », vide). */
export function categorieGenerique(nom: string | null | undefined): boolean {
  const t = normalise(String(nom ?? ""));
  return !t || CATEGORIES_GENERIQUES.includes(t);
}

/**
 * Le bloc que le NOM d'un produit désigne, ou null.
 *
 * Même précédence que pour les catégories : un mot-clé en plusieurs mots
 * d'abord (« pois chiche »), puis le premier mot (« Agneau de lait » est un
 * agneau, pas du lait), puis n'importe quel mot (« Ailes de poulet »).
 */
export function familleDuNom(nomProduit: string): number | null {
  const t = normalise(String(nomProduit ?? ""));
  if (!t) return null;
  const mots = t.split(" ").filter(Boolean);
  const blocs = Object.keys(MOTS_PRODUITS).map(Number).sort((a, b) => a - b);

  for (const b of blocs) {
    if (MOTS_PRODUITS[b].some((m) => m.includes(" ") && t.includes(normalise(m)))) return b;
  }
  for (const b of blocs) {
    if (MOTS_PRODUITS[b].some((m) => normalise(m) === mots[0])) return b;
  }
  for (const b of blocs) {
    if (MOTS_PRODUITS[b].some((m) => mots.includes(normalise(m)))) return b;
  }

  // Dernier recours : les mots faibles. « Filet mignon » n'a rien d'autre
  // pour se faire reconnaître, mais « Filet de saumon » est déjà parti.
  for (const b of Object.keys(MOTS_FAIBLES).map(Number).sort((x, y) => x - y)) {
    if (MOTS_FAIBLES[b].some((m) => mots.includes(normalise(m)))) return b;
  }
  return null;
}

export type CategorieRef = { name: string; ref_start?: number | null };

/**
 * Attribue un bloc à chaque catégorie. Ce qui est déjà réglé n'est jamais
 * déplacé — un numéro imprimé sur une étiquette ne doit pas changer de sens.
 */
export function suggerePlages(categories: CategorieRef[]): Map<string, number> {
  const plages = new Map<string, number>();
  const pris = new Set<number>();

  for (const c of categories) {
    if (c.ref_start != null && Number.isFinite(Number(c.ref_start))) {
      plages.set(c.name, Number(c.ref_start));
      pris.add(Number(c.ref_start));
    }
  }

  // Plusieurs catégories PEUVENT partager le bloc de leur famille.
  // Sur une vraie carte, « Vins rouges », « Vins blancs » et « Vins rosés »
  // sont trois catégories : les envoyer dans trois blocs éloignés faisait
  // perdre au premier chiffre tout son sens. Les numéros restent uniques
  // parce que l'attribution vérifie ce qui est déjà pris, pas le bloc.
  const inconnues: string[] = [];
  for (const c of categories) {
    if (plages.has(c.name)) continue;
    const f = familleDe(c.name);
    if (f) {
      plages.set(c.name, f.debut);
      pris.add(f.debut);
    } else {
      inconnues.push(c.name);
    }
  }

  // Les catégories non reconnues (ou dont le bloc est déjà pris par une
  // autre catégorie) prennent les blocs libres suivants, par ordre alphabétique.
  let libre = PREMIER_BLOC_LIBRE;
  for (const nom of inconnues.sort((a, b) => a.localeCompare(b, "fr"))) {
    while (pris.has(libre)) libre += TAILLE_BLOC;
    plages.set(nom, libre);
    pris.add(libre);
    libre += TAILLE_BLOC;
  }

  return plages;
}

/** Le nom de la famille d'un bloc, ou null pour un bloc libre. */
export function nomDeBloc(bloc: number): string | null {
  return FAMILLES.find((f) => f.debut === bloc)?.nom ?? null;
}

/** Prochain numéro libre dans un bloc, ou null si le bloc est plein. */
export function prochaineRef(debut: number, prises: Set<number>): number | null {
  for (let n = debut; n < debut + TAILLE_BLOC; n++) {
    if (!prises.has(n)) return n;
  }
  return null;
}

export type ProduitRef = {
  id: string;
  name: string;
  category?: string | null;
  internal_ref?: number | null;
};

export type Attribution = {
  id: string;
  nom: string;
  categorie: string;
  ref: number;
  /**
   * Bloc réellement retenu. Il ne suit pas toujours la catégorie : un
   * produit rangé dans « Autre » est classé par son NOM. Sans cette
   * information, le récapitulatif affiché avant écriture annonçait le bloc
   * de la catégorie — donc une répartition fausse.
   */
  bloc: number;
};

export type ResultatAttribution = {
  attributions: Attribution[];
  /** Produits qu'on n'a pas pu numéroter, avec la raison. */
  refuses: { nom: string; raison: string }[];
  /** Blocs utilisés, pour expliquer ce qui va se passer. */
  plages: Map<string, number>;
};

/**
 * Numérote les produits qui n'ont pas encore de référence.
 *
 * Un produit DÉJÀ numéroté n'est jamais renuméroté, même si sa catégorie a
 * changé : la référence est imprimée sur des bacs et recopiée sur des bons
 * de commande, elle doit rester stable.
 */
export function attribueReferences(
  produits: ProduitRef[],
  categories: CategorieRef[],
): ResultatAttribution {
  const plages = suggerePlages(categories);
  const prises = new Set<number>();
  for (const p of produits) {
    if (p.internal_ref != null && Number.isFinite(Number(p.internal_ref))) prises.add(Number(p.internal_ref));
  }

  const attributions: Attribution[] = [];
  const refuses: { nom: string; raison: string }[] = [];

  // Par catégorie puis par nom : les numéros suivent l'ordre du catalogue,
  // ce qui rend la liste imprimée lisible.
  const aNumeroter = produits
    .filter((p) => p.internal_ref == null || !Number.isFinite(Number(p.internal_ref)))
    .sort((a, b) => {
      const ca = a.category || "Autre", cb = b.category || "Autre";
      return ca.localeCompare(cb, "fr") || a.name.localeCompare(b.name, "fr");
    });

  for (const p of aNumeroter) {
    const categorie = p.category || "Autre";

    // Précédence : un bloc réglé à la main, puis une catégorie qui classe
    // vraiment, puis le NOM du produit, puis le bloc de repli de la
    // catégorie. C'est le 3ᵉ cas qui sauve un catalogue où tout est rangé
    // dans « Autre » — sans lui, tous les produits auraient le même préfixe.
    const regleAlaMain = categories.find((c) => c.name === categorie)?.ref_start ?? null;
    const parCategorie = categorieGenerique(categorie) ? null : familleDe(categorie)?.debut ?? null;
    const parNom = familleDuNom(p.name);
    const debut = regleAlaMain ?? parCategorie ?? parNom ?? plages.get(categorie);

    if (debut === undefined || debut === null) {
      refuses.push({ nom: p.name, raison: `Catégorie « ${categorie} » sans bloc de numérotation.` });
      continue;
    }
    const ref = prochaineRef(debut, prises);
    if (ref === null) {
      refuses.push({ nom: p.name, raison: `Bloc ${debut}–${debut + TAILLE_BLOC - 1} plein (${TAILLE_BLOC} produits).` });
      continue;
    }
    prises.add(ref);
    attributions.push({ id: p.id, nom: p.name, categorie, ref, bloc: debut });
  }

  return { attributions, refuses, plages };
}

// ── Référence de caisse des recettes ─────────────────────────────────

/**
 * La touche de caisse est saisie à la main : on nettoie juste les espaces
 * et on met en majuscules, pour que « plt12 » et « PLT 12 » ne finissent
 * pas sur deux fiches différentes.
 */
export function normaliseRefCaisse(valeur: string): string {
  return String(valeur ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

/** Deux recettes ne peuvent pas partager la même touche de caisse. */
export function refCaisseEnDouble(
  refs: { id: string; name: string; pos_ref?: string | null }[],
): { ref: string; recettes: string[] }[] {
  const parRef = new Map<string, string[]>();
  for (const r of refs) {
    const cle = normaliseRefCaisse(r.pos_ref ?? "");
    if (!cle) continue;
    parRef.set(cle, [...(parRef.get(cle) ?? []), r.name]);
  }
  return Array.from(parRef.entries())
    .filter(([, noms]) => noms.length > 1)
    .map(([ref, recettes]) => ({ ref, recettes }));
}
