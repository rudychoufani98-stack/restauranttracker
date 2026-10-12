// =====================================================================
//  Ranger le catalogue.
//
//  Les cas ci-dessous sont PRIS du catalogue du premier client, releve
//  le 12 octobre 2026 : 67 produits sur 134 dans « Autre », 38 mises en
//  place sur 38 dans « Base », et un menu deroulant qui proposait quatre
//  rayons que pas un seul produit n utilisait.
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  rangerProduits, rangerMeps, familleMep, compter, grouperParCategorie, SANS_CATEGORIE,
  planCategoriesIngredient, planCategoriesMep, planCategoriesMenu,
} from "@/lib/rangement";

const cat = (noms: string[]) => noms.map((name, i) => ({ id: `c${i}`, name, position: i }));

describe("Un produit rejoint la famille que son nom désigne", () => {
  it("sort de « Autre » ce que le nom suffit à classer", () => {
    const { deplacements } = rangerProduits([
      { id: "1", name: "Halloumi", category: "Autre" },
      { id: "2", name: "Viande hachée", category: "Autre" },
      { id: "3", name: "Persil", category: "Autre" },
      { id: "4", name: "Cannelle", category: "Autre" },
      { id: "5", name: "Poulet désossé", category: "Autre" },
    ]);
    const ou = Object.fromEntries(deplacements.map((d) => [d.nom, d.apres]));
    expect(ou["Halloumi"]).toBe("Crèmerie & fromages");
    expect(ou["Viande hachée"]).toBe("Viandes");
    expect(ou["Persil"]).toBe("Fruits & légumes");
    expect(ou["Cannelle"]).toBe("Épicerie");
    expect(ou["Poulet désossé"]).toBe("Viandes");
  });

  it("ne touche pas à un produit déjà rangé", () => {
    // « Viande » n a pas a devenir « Viandes » : le patron a choisi.
    const { deplacements } = rangerProduits([
      { id: "1", name: "Entrecôte", category: "Viande" },
      { id: "2", name: "Yaourt grec", category: "Crèmerie & fromages" },
    ]);
    expect(deplacements).toHaveLength(0);
  });

  it("laisse de côté ce qu il ne sait pas lire, plutôt que d inventer", () => {
    const { deplacements, nonReconnus } = rangerProduits([
      { id: "1", name: "Zbdt", category: "Autre" },
    ]);
    expect(deplacements).toHaveLength(0);
    expect(nonReconnus.map((n) => n.nom)).toEqual(["Zbdt"]);
  });

  it("les pièges relevés chez le client : arômes, vinaigres, agneau", () => {
    const { deplacements } = rangerProduits([
      { id: "1", name: "Eau de rose ou fleur d'oranger", category: "Autre" },
      { id: "2", name: "Vin de vinaigre", category: "Autre" },
      { id: "3", name: "Agneau de lait", category: "Autre" },
    ]);
    const ou = Object.fromEntries(deplacements.map((d) => [d.nom, d.apres]));
    // Un arome n est pas une boisson, un vinaigre n est pas un vin,
    // et un agneau de lait est un agneau.
    expect(ou["Eau de rose ou fleur d'oranger"]).toBe("Épicerie");
    expect(ou["Vin de vinaigre"]).toBe("Épicerie");
    expect(ou["Agneau de lait"]).toBe("Viandes");
  });
});

describe("Une mise en place se range par poste, pas par matière", () => {
  it("classe les 38 préparations du premier client", () => {
    const attendu: Record<string, string> = {
      "Baklawa": "Pâtisseries & glaces",
      "Balorie": "Pâtisseries & glaces",
      "Barasik": "Pâtisseries & glaces",
      "Basma": "Pâtisseries & glaces",
      "Bourma": "Pâtisseries & glaces",
      "Ghraybeh": "Pâtisseries & glaces",
      "Glace Ashta": "Pâtisseries & glaces",
      "Glace Pistache": "Pâtisseries & glaces",
      "Glace Rose": "Pâtisseries & glaces",
      "Halawat el jeben": "Pâtisseries & glaces",
      "Knéfé": "Pâtisseries & glaces",
      "Maamoul dates": "Pâtisseries & glaces",
      "Maamoul Noix": "Pâtisseries & glaces",
      "Mafrouke": "Pâtisseries & glaces",
      "Namura": "Pâtisseries & glaces",
      "Oussmaliye": "Pâtisseries & glaces",
      "Brochette de veau": "Marinades & viandes",
      "Chawarma poulet": "Marinades & viandes",
      "Chawarma viande": "Marinades & viandes",
      "Chiche Taouk": "Marinades & viandes",
      "Coquelet": "Marinades & viandes",
      "Cotelette d'agneau": "Marinades & viandes",
      "Demi Poulet": "Marinades & viandes",
      "Makanek": "Marinades & viandes",
      "Poitrine ou viande de veau": "Marinades & viandes",
      "Soujouk": "Marinades & viandes",
      "Falafel": "Farcis & fritures",
      "Fatayer": "Farcis & fritures",
      "Feuilles de vigne": "Farcis & fritures",
      "Kebbeh boulette": "Farcis & fritures",
      "Rikakat": "Farcis & fritures",
      "Safiha": "Farcis & fritures",
      "Samboussik Fromage": "Farcis & fritures",
      "Samboussik viande": "Farcis & fritures",
      "Crème d'ail": "Sauces & dips",
      "Hommos": "Sauces & dips",
      "Moutabal": "Sauces & dips",
      "Pain Burger": "Pâtes & pains",
    };
    for (const [nom, famille] of Object.entries(attendu)) {
      expect(familleMep(nom), nom).toBe(famille);
    }
    expect(Object.keys(attendu)).toHaveLength(38);
  });

  it("traite « Base » comme un non-classement", () => {
    const { deplacements } = rangerMeps([{ id: "1", name: "Hommos", category: "Base" }]);
    expect(deplacements[0]).toMatchObject({ avant: "Base", apres: "Sauces & dips" });
  });

  it("respecte un classement déjà fait à la main", () => {
    const { deplacements } = rangerMeps([{ id: "1", name: "Hommos", category: "Mezzés froids" }]);
    expect(deplacements).toHaveLength(0);
  });
});

describe("La liste des rayons dit la vérité sur ce qu elle range", () => {
  const DEFAUTS = ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"];

  it("retire le rayon vide qui double un rayon qui sert", () => {
    // Le cas qui a declenche tout ceci : le formulaire proposait
    // « Produits laitiers » pendant que les 8 fromages etaient ranges
    // dans « Cremerie & fromages ».
    const plan = planCategoriesIngredient(
      cat(["Produits laitiers", "Crèmerie & fromages", "Épicerie"]),
      compter([{ category: "Crèmerie & fromages" }, { category: "Épicerie" }]),
      DEFAUTS,
    );
    const retires = plan.aRetirer.map((c) => c.name);
    expect(retires).toContain("Produits laitiers");
    expect(retires).not.toContain("Crèmerie & fromages");
    expect(plan.aRetirer.find((c) => c.name === "Produits laitiers")!.raison)
      .toContain("Crèmerie & fromages");
  });

  it("retire « Autre » une fois vidé", () => {
    const plan = planCategoriesIngredient(cat(["Autre", "Épicerie"]), compter([{ category: "Épicerie" }]), DEFAUTS);
    expect(plan.aRetirer.map((c) => c.name)).toContain("Autre");
  });

  it("garde un rayon vide que le restaurant a créé lui-même", () => {
    // « Traiteur » n est ni un exemple du logiciel ni le double d un
    // autre rayon : c est un projet, on n efface pas un projet.
    const plan = planCategoriesIngredient(cat(["Traiteur", "Épicerie"]), compter([{ category: "Épicerie" }]), DEFAUTS);
    expect(plan.aRetirer.map((c) => c.name)).not.toContain("Traiteur");
  });

  it("crée le rayon que les produits réclament", () => {
    const plan = planCategoriesIngredient(
      cat(["Autre"]),
      compter([{ category: "Crèmerie & fromages" }, { category: "Crèmerie & fromages" }]),
      DEFAUTS,
    );
    expect(plan.aCreer.map((c) => c.name)).toContain("Crèmerie & fromages");
  });

  it("complète les familles standard manquantes, une seule fois", () => {
    const plan = planCategoriesIngredient(
      cat(["Vins rouges", "Vins blancs"]),
      compter([{ category: "Vins rouges" }, { category: "Vins blancs" }]),
      DEFAUTS,
    );
    const crees = plan.aCreer.map((c) => c.name);
    // Les deux rayons de vins couvrent deja la famille des vins.
    expect(crees).not.toContain("Vins & champagnes");
    expect(crees).toContain("Viandes");
    expect(crees).toContain("Épicerie");
    expect(new Set(crees).size).toBe(crees.length);
  });

  it("range la liste dans l ordre des numéros internes", () => {
    const plan = planCategoriesIngredient(
      cat(["Épicerie", "Viande", "Crèmerie & fromages"]),
      compter([{ category: "Épicerie" }, { category: "Viande" }, { category: "Crèmerie & fromages" }]),
      DEFAUTS,
    );
    const place = new Map(plan.aReordonner.map((c) => [c.name, c.position]));
    // 1xxx viandes, 4xxx cremerie, 5xxx epicerie.
    expect(place.get("Viande")!).toBeLessThan(place.get("Crèmerie & fromages")!);
    expect(place.get("Crèmerie & fromages")!).toBeLessThan(place.get("Épicerie")!);
  });

  it("les positions finales sont uniques et contiguës", () => {
    const plan = planCategoriesIngredient(
      cat(["Autre", "Viande", "Épicerie"]),
      compter([{ category: "Viande" }, { category: "Épicerie" }]),
      DEFAUTS,
    );
    const pos = [...plan.aCreer.map((c) => c.position), ...plan.aReordonner.map((c) => c.position)].sort((a, b) => a - b);
    expect(pos).toEqual(pos.map((_, i) => i));
  });
});

describe("Les sections de carte et de mise en place", () => {
  it("retire les sections d exemple que personne n utilise", () => {
    const plan = planCategoriesMenu(
      cat(["Entrée", "Dégustation", "Plat", "Mezzés chauds"]),
      compter([{ category: "Dégustation" }, { category: "Mezzés chauds" }]),
      ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"],
    );
    expect(plan.aRetirer.map((c) => c.name).sort()).toEqual(["Entrée", "Plat"]);
    // L ordre de la carte reste celui que le restaurant a choisi.
    expect(plan.aReordonner.map((c) => c.name)).toEqual(["Dégustation", "Mezzés chauds"]);
  });

  it("ne crée aucune section de carte d office", () => {
    const plan = planCategoriesMenu(cat(["Mezzés chauds"]), compter([{ category: "Mezzés chauds" }]), []);
    expect(plan.aCreer).toHaveLength(0);
  });

  it("remplace les rayons d exemple des mises en place par ceux qui servent", () => {
    const plan = planCategoriesMep(
      cat(["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"]),
      compter([{ category: "Pâtisseries & glaces" }, { category: "Marinades & viandes" }]),
      ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"],
    );
    expect(plan.aRetirer).toHaveLength(6);
    expect(plan.aCreer.map((c) => c.name).sort()).toEqual(["Marinades & viandes", "Pâtisseries & glaces"]);
    // Ordre de cuisine : les marinades avant les patisseries.
    const place = new Map(plan.aCreer.map((c) => [c.name, c.position]));
    expect(place.get("Marinades & viandes")!).toBeLessThan(place.get("Pâtisseries & glaces")!);
  });
});

describe("Une liste coupée en rayons", () => {
  const carte = ["Mezzés froids", "Mezzés chauds", "Grillades", "Desserts"];

  it("suit l ordre de la carte, pas l alphabet", () => {
    const g = grouperParCategorie(
      [
        { name: "Arayes", category: "Mezzés chauds" },
        { name: "Baklawa", category: "Desserts" },
        { name: "Taboulé", category: "Mezzés froids" },
        { name: "Falafel", category: "Mezzés chauds" },
      ],
      carte,
    );
    expect(g.map((x) => x.categorie)).toEqual(["Mezzés froids", "Mezzés chauds", "Desserts"]);
    expect(g[1].articles.map((a) => a.name)).toEqual(["Arayes", "Falafel"]);
  });

  it("met en bas ce qui n est rangé nulle part", () => {
    const g = grouperParCategorie(
      [{ name: "Inconnu", category: null }, { name: "Houmous", category: "Mezzés froids" }],
      carte,
    );
    expect(g.map((x) => x.categorie)).toEqual(["Mezzés froids", SANS_CATEGORIE]);
  });

  it("garde un rayon absent des réglages, après ceux qui y sont", () => {
    const g = grouperParCategorie(
      [{ name: "Arak", category: "Arak" }, { name: "Houmous", category: "Mezzés froids" }],
      carte,
    );
    expect(g.map((x) => x.categorie)).toEqual(["Mezzés froids", "Arak"]);
  });

  it("ne perd aucun article", () => {
    const articles = Array.from({ length: 37 }, (_, i) => ({ name: `a${i}`, category: carte[i % 4] }));
    const g = grouperParCategorie(articles, carte);
    expect(g.reduce((s, x) => s + x.articles.length, 0)).toBe(37);
  });
});

describe("Le classement parle le vocabulaire du restaurant", () => {
  it("reprend le nom que la maison donne déjà à la famille", () => {
    // Sept produits dorment dans « Viande » : la viande hachée les
    // rejoint, elle ne fonde pas un rayon « Viandes » à côté.
    const { deplacements } = rangerProduits([
      { id: "a", name: "Entrecôte", category: "Viande" },
      { id: "b", name: "Viande hachée", category: "Autre" },
      { id: "c", name: "Poulet désossé", category: "Autre" },
    ]);
    expect(deplacements.map((d) => d.apres)).toEqual(["Viande", "Viande"]);
  });

  it("retombe sur le nom standard quand plusieurs rayons se partagent la famille", () => {
    const { deplacements } = rangerProduits([
      { id: "a", name: "Ksara rouge", category: "Vins rouges" },
      { id: "b", name: "Ksara blanc", category: "Vins blancs" },
      { id: "c", name: "Château Kefraya", category: "Autre" },
    ]);
    expect(deplacements[0].apres).toBe("Vins & champagnes");
  });

  it("et ne crée donc pas de rayon jumeau", () => {
    const produits = [
      { id: "a", name: "Entrecôte", category: "Viande" },
      { id: "b", name: "Viande hachée", category: "Autre" },
    ];
    const { deplacements } = rangerProduits(produits);
    const apres = new Map(deplacements.map((d) => [d.id, d.apres]));
    const plan = planCategoriesIngredient(
      cat(["Viande", "Autre"]),
      compter(produits.map((p) => ({ category: apres.get(p.id) ?? p.category }))),
      ["Viande", "Autre"],
    );
    expect(plan.aCreer.map((c) => c.name)).not.toContain("Viandes");
    expect(plan.aRetirer.map((c) => c.name)).toContain("Autre");
  });
});
