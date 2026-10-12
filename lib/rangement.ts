// =====================================================================
//  Ranger le catalogue : mettre chaque chose dans un rayon qui existe.
//
//  Un restaurant n arrive jamais avec un catalogue propre. Les produits
//  entrent par trois portes — l import d une mercuriale, la saisie d une
//  facture, les notes de cuisine — et chaque porte a son vocabulaire.
//  Resultat observe chez le premier client : 67 produits sur 134 ranges
//  dans « Autre », pendant que le menu deroulant du formulaire proposait
//  « Produits laitiers » et « Legumes/Fruits », deux rayons que PERSONNE
//  n utilisait. Deux vocabulaires paralleles, dont aucun ne classe rien.
//
//  Ce fichier remet les deux bouts ensemble :
//    - chaque produit rejoint la famille que son NOM designe (le moteur
//      existe deja : familleDuNom, dans references.ts, celui-la meme qui
//      attribue les numeros internes) ;
//    - la liste des rayons proposes devient exactement la liste des
//      rayons qui servent, sans doublon sous un autre nom.
//
//  Rien ici n ecrit : ces fonctions PROPOSENT. L ecran montre le detail
//  avant d appliquer, parce qu un catalogue se range sous les yeux de
//  celui a qui il appartient.
// =====================================================================
import { normalise } from "./import-produits";
import { FAMILLES, familleDe, familleDuNom, categorieGenerique, nomDeBloc } from "./references";

/**
 * Les rayons que le logiciel pose lui-meme au premier passage.
 *
 * Ce sont des EXEMPLES, pas un classement : un restaurant qui n a jamais
 * ouvert cet ecran les garde tels quels, et ils se retrouvent au milieu
 * de ses vrais rayons. Les connaitre permet de les retirer quand ils
 * n ont rien classe — et seulement dans ce cas.
 */
export const CATEGORIES_EXEMPLES: Record<"menu" | "prep" | "ingredient", string[]> = {
  menu: ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"],
  prep: ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"],
  ingredient: ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"],
};

// ---------------------------------------------------------------------
//  Produits
// ---------------------------------------------------------------------

export type ProduitARanger = { id: string; name: string; category?: string | null };

/** Un deplacement propose : d ou vient le produit, ou il va, et pourquoi. */
export type Deplacement = { id: string; nom: string; avant: string; apres: string };

/**
 * Les produits dont la categorie ne classe rien (« Autre », « Divers »,
 * vide) et dont le nom, lui, est explicite.
 *
 * Un produit deja range n est JAMAIS deplace : « Viande » n a pas a
 * devenir « Viandes » parce qu un fichier le dit — le patron a choisi,
 * et un rayon qui change de nom tout seul est un rayon qu on ne retrouve
 * plus.
 */
export function rangerProduits(produits: ProduitARanger[]): {
  deplacements: Deplacement[];
  nonReconnus: { id: string; nom: string }[];
} {
  const deplacements: Deplacement[] = [];
  const nonReconnus: { id: string; nom: string }[] = [];

  for (const p of produits) {
    const avant = (p.category ?? "").trim();
    if (!categorieGenerique(avant)) continue; // deja range
    const bloc = familleDuNom(p.name);
    const apres = bloc === null ? null : nomDeBloc(bloc);
    if (!apres) {
      nonReconnus.push({ id: p.id, nom: p.name });
      continue;
    }
    deplacements.push({ id: p.id, nom: p.name, avant: avant || "—", apres });
  }

  return { deplacements, nonReconnus };
}

// ---------------------------------------------------------------------
//  La liste des rayons
// ---------------------------------------------------------------------

export type CategorieExistante = { id: string; name: string; position?: number | null };

export type PlanCategories = {
  /** Rayons a creer : des familles standard qui manquent a l appel. */
  aCreer: { name: string; position: number }[];
  /** Rayons a retirer : vides ET doublons d un rayon qui sert. */
  aRetirer: { id: string; name: string; raison: string }[];
  /** Rayons gardes, avec leur nouvelle place dans la liste. */
  aReordonner: { id: string; name: string; position: number }[];
};

/**
 * Le rang d une categorie : son bloc de famille (1000 viandes, 2000
 * poissons…), ce qui range le menu deroulant dans l ordre meme des
 * numeros internes. Une categorie hors famille passe a la fin.
 */
function rangDe(nom: string): number {
  return familleDe(nom)?.debut ?? 99000;
}

/**
 * Accorde la liste des rayons avec ce qui est reellement range dedans.
 *
 * Trois regles, dans cet ordre :
 *  1. un rayon VIDE qui double un rayon de la meme famille s en va — c est
 *     lui qui fait choisir « Produits laitiers » a un debutant alors que
 *     tout le monde ecrit « Cremerie & fromages » ;
 *  2. un rayon vide pose par le logiciel lui-meme (la liste par defaut)
 *     s en va aussi : il n a jamais rien classe ;
 *  3. chaque famille standard non couverte est creee, pour que la liste
 *     soit la meme d un restaurant a l autre.
 *
 * Un rayon vide CREE PAR LE RESTAURANT reste : on prepare une carte a
 * l avance, et effacer « Brunch » parce qu il est encore vide serait
 * effacer un projet.
 */
export function planCategoriesIngredient(
  categories: CategorieExistante[],
  comptes: Map<string, number>,
  defauts: string[] = [],
): PlanCategories {
  const nb = (nom: string) => comptes.get(nom) ?? 0;
  const estDefaut = new Set(defauts.map(normalise));

  // Les familles couvertes par un rayon qui SERT : « Vins rouges » et
  // « Vins blancs » couvrent tous deux la famille des vins — pas besoin
  // d y ajouter « Vins & champagnes ».
  const familleServie = new Set<number>();
  for (const c of categories) {
    if (nb(c.name) > 0 && !categorieGenerique(c.name)) {
      const f = familleDe(c.name);
      if (f) familleServie.add(f.debut);
    }
  }

  const aRetirer: PlanCategories["aRetirer"] = [];
  const gardees: CategorieExistante[] = [];

  for (const c of categories) {
    if (nb(c.name) > 0) { gardees.push(c); continue; }
    const f = familleDe(c.name);
    if (categorieGenerique(c.name)) {
      // « Autre » une fois vide s en va : le laisser dans le menu
      // deroulant, c est inviter le prochain produit a y retomber.
      aRetirer.push({ id: c.id, name: c.name, raison: "ne classe rien, et plus aucun produit dedans" });
    } else if (f && familleServie.has(f.debut)) {
      const jumeau = categories.find((o) => o.name !== c.name && nb(o.name) > 0 && familleDe(o.name)?.debut === f.debut);
      aRetirer.push({ id: c.id, name: c.name, raison: `vide — tes produits sont rangés dans « ${jumeau?.name ?? f.nom} »` });
    } else if (estDefaut.has(normalise(c.name))) {
      aRetirer.push({ id: c.id, name: c.name, raison: "rayon d'exemple, jamais utilisé" });
    } else {
      gardees.push(c);
    }
  }

  // Ce que les produits reclament et qui n existe pas encore.
  const nomsGardes = new Set(gardees.map((c) => normalise(c.name)));
  const aCreer: PlanCategories["aCreer"] = [];
  for (const [nom, n] of Array.from(comptes.entries())) {
    if (n > 0 && nom && !nomsGardes.has(normalise(nom)) && !categorieGenerique(nom)) {
      aCreer.push({ name: nom, position: 0 });
      nomsGardes.add(normalise(nom));
    }
  }

  // Les familles standard encore absentes, pour que la liste soit complete.
  const couvertes = new Set<number>();
  for (const nom of Array.from(nomsGardes)) {
    const f = familleDe(nom);
    if (f) couvertes.add(f.debut);
  }
  for (const f of FAMILLES) {
    if (!couvertes.has(f.debut)) {
      aCreer.push({ name: f.nom, position: 0 });
      couvertes.add(f.debut);
    }
  }

  // Ordre final : par famille, puis alphabetique — l ordre des numeros.
  const finale = [...gardees.map((c) => c.name), ...aCreer.map((c) => c.name)]
    .sort((a, b) => rangDe(a) - rangDe(b) || a.localeCompare(b, "fr"));
  const place = new Map(finale.map((nom, i) => [normalise(nom), i]));

  return {
    aCreer: aCreer.map((c) => ({ ...c, position: place.get(normalise(c.name)) ?? 0 })),
    aRetirer,
    aReordonner: gardees.map((c) => ({ id: c.id, name: c.name, position: place.get(normalise(c.name)) ?? 0 })),
  };
}

// ---------------------------------------------------------------------
//  Mises en place
// ---------------------------------------------------------------------

/**
 * Les familles d une mise en place.
 *
 * Une MEP ne se range pas comme un produit : ce qui compte n est pas la
 * matiere mais le POSTE qui la produit. Le patissier ne cherche pas ses
 * baklawas dans « farines », il les cherche dans « patisseries ». Les
 * noms sont ceux d une cuisine, pas d un entrepot.
 */
export type FamilleMep = { nom: string; motsCles: string[] };

export const FAMILLES_MEP: FamilleMep[] = [
  {
    nom: "Pâtes & pains",
    motsCles: ["pate", "pates", "pain", "pains", "manakich", "manakiche", "manouche", "brioche",
      "feuilletee", "feuilletage", "pizza", "focaccia", "levain", "petrissage", "burger"],
  },
  {
    nom: "Sauces & dips",
    motsCles: ["sauce", "sauces", "dip", "dips", "creme", "taratour", "tarator", "houmous", "hommos",
      "moutabal", "baba ganoush", "labneh", "labne", "mayonnaise", "vinaigrette", "coulis",
      "puree", "tahina", "tahine", "harissa", "pesto"],
  },
  {
    nom: "Marinades & viandes",
    motsCles: ["marinade", "marine", "marinee", "chawarma", "shawarma", "taouk", "chiche",
      "brochette", "brochettes", "kefta", "kafta", "makanek", "soujouk", "sujuk", "merguez",
      "poulet", "coquelet", "agneau", "veau", "boeuf", "viande", "cotelette", "cotelettes",
      "poitrine", "entrecote", "escalope", "confit", "saumure"],
  },
  {
    nom: "Farcis & fritures",
    motsCles: ["falafel", "fatayer", "samboussik", "sambousek", "rikakat", "safiha", "sfiha",
      "kebbeh", "kibbeh", "boulette", "boulettes", "farci", "farcis", "farcie", "farcies",
      "feuilles de vigne", "warak", "beignet", "beignets", "croquette", "croquettes", "panure",
      "chausson", "chaussons"],
  },
  {
    nom: "Pâtisseries & glaces",
    motsCles: ["baklawa", "baklava", "maamoul", "mamoul", "knefe", "knafeh", "kunafa", "namura",
      "namoura", "ghraybeh", "graybeh", "mafrouke", "balorie", "barasik", "basma", "bourma",
      "oussmaliye", "osmalieh", "halawat", "ashta", "achta", "kachta", "glace", "glaces", "sorbet",
      "gateau", "gateaux", "tarte", "tartes", "biscuit", "biscuits", "mouhalabieh", "riz au lait",
      "chantilly", "ganache", "sirop"],
  },
  {
    nom: "Fonds & bouillons",
    motsCles: ["fond", "fonds", "bouillon", "bouillons", "fumet", "jus de", "consomme", "veloute"],
  },
  {
    nom: "Garnitures",
    motsCles: ["garniture", "garnitures", "riz", "frite", "frites", "legumes", "salade", "taboule",
      "fattouche", "fattoush", "pickles", "oignons frits", "persillade"],
  },
];

/** La famille d une mise en place d apres son nom, ou null. */
export function familleMep(nom: string): string | null {
  const t = normalise(nom);
  if (!t) return null;
  const mots = t.split(" ").filter(Boolean);

  // Un mot-cle en plusieurs mots d abord (« feuilles de vigne »), puis le
  // premier mot (« Creme d ail » est une creme), puis n importe quel mot.
  for (const f of FAMILLES_MEP) {
    if (f.motsCles.some((m) => m.includes(" ") && t.includes(normalise(m)))) return f.nom;
  }
  for (const f of FAMILLES_MEP) {
    if (f.motsCles.some((m) => normalise(m) === mots[0])) return f.nom;
  }
  for (const f of FAMILLES_MEP) {
    if (f.motsCles.some((m) => mots.includes(normalise(m)))) return f.nom;
  }
  return null;
}

export type MepARanger = { id: string; name: string; category?: string | null };

/**
 * Range les mises en place. Meme regle que pour les produits : on ne
 * touche qu a ce qui n est pas range.
 *
 * « Base » compte comme non range : c est la categorie que l import pose
 * par defaut, et chez le premier client les 38 mises en place y etaient
 * toutes — un classement qui ne separe rien.
 */
const MEP_GENERIQUES = ["base", "bases", "autre", "autres", "divers", "sans categorie", "a classer"];

export function rangerMeps(meps: MepARanger[]): {
  deplacements: Deplacement[];
  nonReconnus: { id: string; nom: string }[];
} {
  const deplacements: Deplacement[] = [];
  const nonReconnus: { id: string; nom: string }[] = [];

  for (const m of meps) {
    const avant = (m.category ?? "").trim();
    if (avant && !MEP_GENERIQUES.includes(normalise(avant))) continue;
    const apres = familleMep(m.name);
    if (!apres) { nonReconnus.push({ id: m.id, nom: m.name }); continue; }
    if (apres === avant) continue;
    deplacements.push({ id: m.id, nom: m.name, avant: avant || "—", apres });
  }

  return { deplacements, nonReconnus };
}

/**
 * La liste des rayons de mises en place, accordee a ce qu elle range.
 *
 * Pas de familles standard ajoutees d office ici : une cuisine qui ne
 * fait ni fond ni bouillon n a rien a faire d un rayon « Fonds ».
 */
export function planCategoriesMep(
  categories: CategorieExistante[],
  comptes: Map<string, number>,
  defauts: string[] = [],
): PlanCategories {
  const nb = (nom: string) => comptes.get(nom) ?? 0;
  const estDefaut = new Set(defauts.map(normalise));
  const ordre = new Map(FAMILLES_MEP.map((f, i) => [normalise(f.nom), i]));
  const rang = (nom: string) => ordre.get(normalise(nom)) ?? 90;

  const aRetirer: PlanCategories["aRetirer"] = [];
  const gardees: CategorieExistante[] = [];
  for (const c of categories) {
    if (nb(c.name) > 0) { gardees.push(c); continue; }
    if (estDefaut.has(normalise(c.name)) || MEP_GENERIQUES.includes(normalise(c.name))) {
      aRetirer.push({ id: c.id, name: c.name, raison: "rayon d'exemple, plus aucune préparation dedans" });
    } else {
      gardees.push(c);
    }
  }

  const nomsGardes = new Set(gardees.map((c) => normalise(c.name)));
  const aCreer: PlanCategories["aCreer"] = [];
  for (const [nom, n] of Array.from(comptes.entries())) {
    if (n > 0 && nom && !nomsGardes.has(normalise(nom))) {
      aCreer.push({ name: nom, position: 0 });
      nomsGardes.add(normalise(nom));
    }
  }

  const finale = [...gardees.map((c) => c.name), ...aCreer.map((c) => c.name)]
    .sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "fr"));
  const place = new Map(finale.map((nom, i) => [normalise(nom), i]));

  return {
    aCreer: aCreer.map((c) => ({ ...c, position: place.get(normalise(c.name)) ?? 0 })),
    aRetirer,
    aReordonner: gardees.map((c) => ({ id: c.id, name: c.name, position: place.get(normalise(c.name)) ?? 0 })),
  };
}

// ---------------------------------------------------------------------
//  Catégories de la carte
// ---------------------------------------------------------------------

/**
 * Les rayons de la carte ne se devinent pas : « Mezzes chauds » ne se
 * deduit d aucun dictionnaire. On se contente donc de retirer les
 * exemples poses par le logiciel que personne n a utilises — chez le
 * premier client, « Entree / Plat / Accompagnement / Dessert / Boisson /
 * Menu » restaient au milieu de quinze vraies sections de carte.
 */
export function planCategoriesMenu(
  categories: CategorieExistante[],
  comptes: Map<string, number>,
  defauts: string[],
): PlanCategories {
  const nb = (nom: string) => comptes.get(nom) ?? 0;
  const estDefaut = new Set(defauts.map(normalise));

  const aRetirer: PlanCategories["aRetirer"] = [];
  const gardees: CategorieExistante[] = [];
  for (const c of categories) {
    if (nb(c.name) === 0 && estDefaut.has(normalise(c.name))) {
      aRetirer.push({ id: c.id, name: c.name, raison: "section d'exemple, aucune fiche dedans" });
    } else {
      gardees.push(c);
    }
  }

  // L ordre de la carte est celui que le restaurant a choisi : on le
  // garde, on se contente de reboucher les trous laisses par les retraits.
  const nomsGardes = new Set(gardees.map((c) => normalise(c.name)));
  const aCreer: PlanCategories["aCreer"] = [];
  for (const [nom, n] of Array.from(comptes.entries())) {
    if (n > 0 && nom && !nomsGardes.has(normalise(nom))) {
      aCreer.push({ name: nom, position: gardees.length + aCreer.length });
      nomsGardes.add(normalise(nom));
    }
  }

  return {
    aCreer,
    aRetirer,
    aReordonner: gardees.map((c, i) => ({ id: c.id, name: c.name, position: i })),
  };
}

// ---------------------------------------------------------------------
//  Afficher le classement
// ---------------------------------------------------------------------

/** Ce qu on affiche d un article sans categorie — jamais une case vide. */
export const SANS_CATEGORIE = "Sans catégorie";

export type Groupe<T> = { categorie: string; articles: T[] };

/**
 * L ordre des rayons d achat quand on n a pas celui des reglages sous la
 * main : celui des familles, donc celui des numeros internes.
 */
export function ordreParFamille(noms: string[]): string[] {
  return Array.from(new Set(noms.filter(Boolean)))
    .sort((a, b) => (familleDe(a)?.debut ?? 99000) - (familleDe(b)?.debut ?? 99000) || a.localeCompare(b, "fr"));
}

/**
 * Coupe une liste en rayons, dans l ordre des rayons du restaurant.
 *
 * Une liste de 134 produits ou de 111 fiches, triee par ordre
 * alphabetique avec une pastille de categorie au bout de chaque ligne,
 * ne montre AUCUN classement : il faut lire les 134 lignes pour deviner
 * qu il existe des rayons. Les memes lignes, coupees par rayon avec un
 * titre, se lisent d un coup d oeil.
 *
 * L ordre vient des reglages (celui que le patron a choisi), pas de
 * l alphabet : sur une carte, les mezzes viennent avant les desserts.
 */
export function grouperParCategorie<T extends { category?: string | null }>(
  articles: T[],
  ordre: string[],
): Groupe<T>[] {
  const rang = new Map(ordre.map((n, i) => [normalise(n), i]));
  const groupes = new Map<string, T[]>();

  for (const a of articles) {
    const nom = (a.category ?? "").trim() || SANS_CATEGORIE;
    groupes.set(nom, [...(groupes.get(nom) ?? []), a]);
  }

  return Array.from(groupes.entries())
    .map(([categorie, liste]) => ({ categorie, articles: liste }))
    .sort((a, b) => {
      // Ce qui n est dans aucun rayon connu finit en bas : c est la
      // reserve, et elle doit se voir sans masquer le reste.
      if (a.categorie === SANS_CATEGORIE) return 1;
      if (b.categorie === SANS_CATEGORIE) return -1;
      const ra = rang.get(normalise(a.categorie)) ?? 9999;
      const rb = rang.get(normalise(b.categorie)) ?? 9999;
      return ra - rb || a.categorie.localeCompare(b.categorie, "fr");
    });
}

/** Compte les occurrences d une categorie, en gardant le libelle exact. */
export function compter(articles: { category?: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of articles) {
    const c = (a.category ?? "").trim();
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}
