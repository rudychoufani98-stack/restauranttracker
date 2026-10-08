// =====================================================================
//  Import des fiches techniques : la route de bout en bout.
//
//  Deux garanties a tenir :
//   - l ANALYSE n ecrit rien, quoi qu il y ait dans le fichier ;
//   - l IMPORT remplace les lignes d une fiche (delete puis insert), et
//     n ecrit pas de restaurant_id sur recipe_lines : la table n en a
//     pas, l appartenance passe par la recette.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const INGREDIENTS = [
  { id: "i-pois", name: "Pois chiche sac 25kg", unit: "kg" },
  { id: "i-tahina", name: "Tahina Tiba 18kg", unit: "kg" },
  { id: "i-ail", name: "Ail", unit: "kg" },
  { id: "i-pita", name: "Pain pita", unit: "unit" },
];
const RECETTES = [
  { id: "r-houmous", name: "Houmous", is_prep: false, yield_unit: "portion" },
  { id: "r-cremeail", name: "Crème d'ail", is_prep: true, yield_unit: "kg" },
];
let LIGNES: any[] = [{ recipe_id: "r-houmous" }, { recipe_id: "r-houmous" }];

/** Journal de tout ce qui part en base. */
let ecrits: any[] = [];
let prochainId = 0;

function table(t: string): any {
  const o: any = {
    select: () => o,
    eq: () => o,
    order: () => o,
    in: () => o,
    single: async () => ({ data: { id: `nouveau-${++prochainId}` }, error: null }),
    insert: (v: any) => {
      ecrits.push({ table: t, op: "insert", v });
      return { select: () => ({ single: async () => ({ data: { id: `nouveau-${++prochainId}` }, error: null }) }) };
    },
    delete: () => {
      const d: any = { eq: (_c: string, id: string) => { ecrits.push({ table: t, op: "delete", id }); return Promise.resolve({ error: null }); } };
      return d;
    },
    then: (ok: any, ko?: any) =>
      Promise.resolve({
        data: t === "ingredients" ? INGREDIENTS : t === "recipes" ? RECETTES : t === "recipe_lines" ? LIGNES : [],
        error: null,
      }).then(ok, ko),
  };
  return o;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ from: table }) }));
vi.mock("@/lib/auth", () => ({ getRestaurant: async () => ({ id: "r1", name: "Amaly" }) }));

const CSV = `Fiche;Composant;Quantité;Unité
Houmous;Pois chiche sac 25kg;250;g
Houmous;Tahina Tiba 18kg;60;g
Houmous;Fantôme;10;g
Sand Chawarma;Pain pita;1;pièce
Sand Chawarma;Crème d'ail;30;g`;

async function analyse() {
  const { POST } = await import("@/app/api/import/recettes/route");
  const fd = new FormData();
  fd.append("fichier", new File([CSV], "fiches.csv", { type: "text/csv" }));
  const res = await POST(new Request("http://x", { method: "POST", body: fd }));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => { ecrits = []; prochainId = 0; });

describe("Analyse d un fichier de fiches", () => {
  it("n ecrit RIEN et decrit ce qui serait fait", async () => {
    const { status, json } = await analyse();

    expect(status).toBe(200);
    expect(ecrits).toHaveLength(0);                       // ← rien en base
    expect(json.manquantes).toEqual([]);
    expect(json.resume).toMatchObject({ fiches: 2, fiches_creer: 1, lignes: 5, erreur: 1 });
    // Le houmous avait 2 lignes : elles seront remplacees.
    expect(json.resume.remplacees).toBe(2);

    const houmous = json.fiches.find((f: any) => f.nom === "Houmous");
    expect(houmous.recetteId).toBe("r-houmous");
    expect(houmous.lignes.find((l: any) => l.composant === "Fantôme").erreurs[0]).toMatch(/introuvable/);

    const sand = json.fiches.find((f: any) => f.nom === "Sand Chawarma");
    expect(sand.recetteId).toBeNull();                    // a creer
    expect(sand.lignes.map((l: any) => l.cible.type)).toEqual(["ingredient", "mep"]);
  });
});

describe("Import des lignes", () => {
  it("remplace les lignes, cree la fiche manquante, et ecarte la ligne en erreur", async () => {
    const { json } = await analyse();
    ecrits = [];

    const { PUT } = await import("@/app/api/import/recettes/route");
    const res = await PUT(new Request("http://x", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiches: json.fiches }),
    }));
    const bilan = await res.json();

    expect(res.status).toBe(200);
    expect(bilan.echecs).toEqual([]);
    expect(bilan.misesAJour).toBe(1);                     // Houmous
    expect(bilan.creees).toBe(1);                         // Sand Chawarma
    expect(bilan.lignesEcrites).toBe(4);                  // 5 lignes - 1 refusee

    // La fiche absente est bien creee.
    const nouvelleFiche = ecrits.find((e) => e.table === "recipes" && e.op === "insert");
    expect(nouvelleFiche.v).toMatchObject({ name: "Sand Chawarma", is_prep: false, restaurant_id: "r1" });

    // REMPLACEMENT : un delete precede chaque insert de lignes.
    const suppressions = ecrits.filter((e) => e.table === "recipe_lines" && e.op === "delete");
    expect(suppressions.map((s) => s.id)).toContain("r-houmous");
    expect(suppressions).toHaveLength(2);

    const lignes = ecrits.filter((e) => e.table === "recipe_lines" && e.op === "insert").flatMap((e) => e.v);
    expect(lignes).toHaveLength(4);
    expect(lignes.some((l: any) => l.ingredient_id === "i-pois" && l.quantity === 250 && l.unit === "g")).toBe(true);
    // Une MEP part en sous-recette, pas en ingredient.
    const mep = lignes.find((l: any) => l.sub_recipe_id === "r-cremeail");
    expect(mep).toMatchObject({ ingredient_id: null, quantity: 30, unit: "g" });
    // La ligne « Fantome » n a pas ete ecrite.
    expect(lignes.some((l: any) => l.quantity === 10)).toBe(false);

    // recipe_lines ne porte PAS de restaurant_id : la colonne n existe pas.
    for (const l of lignes) expect(l).not.toHaveProperty("restaurant_id");
  });

  it("refuse une charge vide", async () => {
    const { PUT } = await import("@/app/api/import/recettes/route");
    const res = await PUT(new Request("http://x", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiches: [] }),
    }));
    expect(res.status).toBe(400);
    expect(ecrits).toHaveLength(0);
  });

  it("ignore une cible que le client aurait inventee apres coup", async () => {
    const { PUT } = await import("@/app/api/import/recettes/route");
    const res = await PUT(new Request("http://x", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiches: [{
        nom: "Houmous", recetteId: "r-houmous", estMep: false, lignesRemplacees: 2, erreurs: 0,
        lignes: [{ ligne: 2, fiche: "Houmous", composant: "X", quantite: 1, unite: "g",
                   cible: { id: "id-invente", nom: "X", unite: "kg", type: "ingredient" }, erreurs: [], avertissements: [] }],
      }] }),
    }));
    await res.json();
    // Aucune ligne ecrite : l id ne correspond a rien en base.
    expect(ecrits.filter((e) => e.table === "recipe_lines" && e.op === "insert")).toHaveLength(0);
  });
});
