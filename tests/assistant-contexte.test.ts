// =====================================================================
//  Le contexte envoye a l assistant.
//
//  Releve en production : a « il y a quoi dans ma recette Arayes ? »
//  l assistant repondait « rendez-vous sur la page Recettes ». Ce n etait
//  pas un defaut du modele — le contexte qu on lui envoyait contenait le
//  nom, le cout et le prix de chaque plat, jamais ses ingredients. Il ne
//  pouvait rien repondre d autre.
// =====================================================================
import { describe, it, expect, vi } from "vitest";
import { sansAccents, fichesVisees, buildSnapshot, fmtStock } from "@/lib/assistant-contexte";

const RECETTES = [
  { id: "r-arayes", name: "Arayes", category: "Mezzés chauds", total_cost: 0, menu_price: 9, yield_portions: 1, yield_unit: "portion", is_prep: false },
  { id: "r-chawarma", name: "Chawarma poulet", category: "Sandwichs", total_cost: 3.2, menu_price: 12, yield_portions: 1, yield_unit: "portion", is_prep: false },
  { id: "r-poulet", name: "Poulet", category: "Grillades", total_cost: 5, menu_price: 22, yield_portions: 1, yield_unit: "portion", is_prep: false },
  { id: "r-ail", name: "Crème d'ail", category: "Mezzés froids", total_cost: 4, menu_price: null, yield_portions: 2, yield_unit: "kg", is_prep: true },
];

const LIGNES = [
  { recipe_id: "r-chawarma", quantity: 150, unit: "g", sub_recipe_id: null, ingredients: { name: "Cuisse de poulet s/os halal" } },
  { recipe_id: "r-chawarma", quantity: 30,  unit: "g", sub_recipe_id: "r-ail", ingredients: null },
];

const INGREDIENTS = [
  { name: "Cuisse de poulet s/os halal", unit: "kg", stock_qty: 20000, cmup: 0.0046, cost_per_base_unit: 0.0046, selling_price: null, reorder_threshold: 0 },
  { name: "Coca 33 cl", unit: "unit", stock_qty: 4, cmup: 0.45, cost_per_base_unit: 0.45, selling_price: 3, reorder_threshold: 12 },
];

/**
 * Client Supabase reduit a ce que buildSnapshot lui demande.
 * Tout est chainable et l objet est lui-meme attendable, comme le vrai
 * constructeur de requetes PostgREST.
 */
function fausseBase() {
  return {
    from(table: string) {
      const o: any = {
        select: () => o,
        eq: () => o,
        order: () => o,
        limit: () => o,
        in: () => o,
        then: (ok: any, ko?: any) =>
          Promise.resolve({ data: jeu(table), error: null }).then(ok, ko),
      };
      return o;
    },
  } as any;
}
function jeu(table: string) {
  if (table === "ingredients") return INGREDIENTS;
  if (table === "recipes") return RECETTES;
  if (table === "recipe_lines") return LIGNES;
  return [];
}

const AMALY = { id: "r1", name: "Amaly", vat_dine_in: 10, vat_takeaway: 5.5, vat_delivery: 10, vat_alcohol: 20 };

describe("Reconnaitre la fiche dont parle la question", () => {
  it("ignore les accents et la casse", () => {
    expect(sansAccents("Crème d'AIL")).toBe("creme d'ail");
    expect(sansAccents("  Mezzé   chaud ")).toBe("mezze chaud");
  });

  it("trouve la fiche nommee dans la question", () => {
    expect(fichesVisees("Il y a quoi dans ma recette Arayes ?", RECETTES)).toEqual(["r-arayes"]);
    expect(fichesVisees("compo de la creme d'ail ?", RECETTES)).toEqual(["r-ail"]);
  });

  it("prefere le nom le plus long", () => {
    // « Chawarma poulet » contient « poulet » : les deux correspondent, mais
    // c est la fiche la plus precise qui doit venir en premier.
    const vues = fichesVisees("le chawarma poulet il est comment ?", RECETTES);
    expect(vues[0]).toBe("r-chawarma");
  });

  it("ne retient rien quand aucune fiche n est nommee", () => {
    expect(fichesVisees("comment je fais un inventaire ?", RECETTES)).toEqual([]);
  });

  it("ne se declenche pas sur un nom trop court", () => {
    expect(fichesVisees("j ai un the a preparer", [{ id: "x", name: "Thé" }])).toEqual([]);
  });
});

describe("Le contexte du restaurant", () => {
  it("joint la composition de la fiche dont on parle", async () => {
    const s = await buildSnapshot(fausseBase(), AMALY, "il y a quoi dans le chawarma poulet ?");
    expect(s).toContain("COMPOSITION DE « Chawarma poulet »");
    expect(s).toContain("Cuisse de poulet s/os halal : 150 g");
    // Une sous-recette est nommee, pas laissee sous forme d identifiant.
    expect(s).toContain("Crème d'ail (mise en place) : 30 g");
  });

  it("dit qu une fiche vide n est pas chiffree, au lieu d annoncer 0 €", async () => {
    const s = await buildSnapshot(fausseBase(), AMALY, "et les Arayes ?");
    expect(s).toContain("COMPOSITION DE « Arayes »");
    expect(s).toContain("AUCUNE ligne d'ingrédient");
    // Le bloc des plats ne doit pas donner de cout ni de food cost pour elle.
    expect(s).toMatch(/Arayes \| NON CHIFFRÉ \| 9\.00€ \| inconnu/);
  });

  it("place la composition avant tout le reste", async () => {
    // Le contexte est tronque par la fin : la reponse a la question posee
    // ne doit jamais etre la premiere sacrifiee.
    const s = await buildSnapshot(fausseBase(), AMALY, "compo des arayes ?");
    expect(s.indexOf("COMPOSITION DE")).toBeLessThan(s.indexOf("PLATS DE LA CARTE"));
  });

  it("calcule le food cost sur du HT, pas sur le prix TTC", async () => {
    const s = await buildSnapshot(fausseBase(), AMALY, "bonjour");
    // Chawarma : 3,20 € de cout, 12 € TTC a 10 % → 3,20 / 10,909 = 29,3 %.
    // Le calcul fautif (3,20 / 12) aurait donne 26,7 %.
    expect(s).toContain("Chawarma poulet | 3.20€ | 12.00€ | 29.3%");
    expect(s).not.toContain("26.7%");
  });

  it("expose les mises en place, invisibles jusqu ici", async () => {
    const s = await buildSnapshot(fausseBase(), AMALY, "bonjour");
    expect(s).toContain("MISES EN PLACE");
    expect(s).toContain("Crème d'ail | 2 kg | 4.00€");
  });

  it("signale un produit sous son seuil et totalise le stock", async () => {
    const s = await buildSnapshot(fausseBase(), AMALY, "bonjour");
    expect(s).toContain("Coca 33 cl | 4 pce | 0.45€/pce | ⚠ SOUS LE SEUIL");
    expect(s).toContain("VALEUR TOTALE DU STOCK : 93.80€");   // 20000×0,0046 + 4×0,45
  });
});

describe("Affichage des quantites", () => {
  it("ramene les unites de base a du lisible", () => {
    expect(fmtStock(20000, "kg")).toBe("20.0 kg");
    expect(fmtStock(1500, "l")).toBe("1.5 L");
    expect(fmtStock(9, "unit")).toBe("9 pce");
  });
});
