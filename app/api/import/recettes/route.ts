import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { newWorkbook, autoWidth, styleHeader, addTitle, workbookToResponse, todayStamp } from "@/lib/excel";
import {
  analyseRecettes, parseCsv, normalise, CHAMP_LABEL,
  type ContexteRecettes, type ComposantRef, type AnalyseRecettes,
} from "@/lib/import-recettes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
//  GET   → modèle Excel à remplir (?fiches=1 : pré-rempli avec tes fiches)
//  POST  → analyse un fichier (n'écrit RIEN, dit ce qui serait fait)
//  PUT   → applique l'analyse validée
//
//  L'import REMPLACE les lignes d'une fiche. Voir lib/import-recettes.ts.
// =====================================================================

const COLONNES_MODELE: [string, string | number, string][] = [
  ["Fiche", "Houmous", "Obligatoire. Le nom de la fiche technique ou de la mise en place."],
  ["Type", "Fiche", "« Fiche » ou « MEP ». Sert uniquement si la fiche n'existe pas encore."],
  ["Composant", "Pois chiche sac 25kg", "Obligatoire. Un ingrédient OU une mise en place, déjà présent dans l'app."],
  ["Quantité", 250, "Obligatoire. Quantité NETTE pour le lot de base de la fiche."],
  ["Unité", "g", "Obligatoire. g, kg, ml, cl, L ou pièce — compatible avec l'unité du composant."],
];

async function modele(lignes?: string[][]) {
  const wb = newWorkbook();
  const ws = wb.addWorksheet("Lignes");
  const entetes = COLONNES_MODELE.map((c) => c[0]);
  autoWidth(ws, [30, 10, 34, 12, 10]);
  const r = addTitle(
    ws,
    "Import des lignes de fiches techniques",
    "Une ligne par composant. Dépose ce fichier dans Recettes → Importer. La feuille « Mode d'emploi » explique chaque colonne.",
    entetes.length,
  );
  ws.getRow(r).values = entetes;
  styleHeader(ws, r);

  if (lignes?.length) {
    for (const l of lignes) ws.addRow(l);
  } else {
    ws.addRow(["Houmous", "Fiche", "Pois chiche sac 25kg", 250, "g"]);
    ws.addRow(["Houmous", "Fiche", "Tahina Tiba 18kg", 60, "g"]);
    ws.addRow(["Houmous", "Fiche", "Ail", 5, "g"]);
    ws.addRow(["Sand Chawarma poulet", "Fiche", "Pain pita", 1, "pièce"]);
    ws.addRow(["Sand Chawarma poulet", "Fiche", "Crème d'ail", 30, "g"]);
  }

  const aide = wb.addWorksheet("Mode d'emploi");
  autoWidth(aide, [16, 24, 84]);
  const ra = addTitle(aide, "Comment remplir le fichier", "Les colonnes peuvent être dans n'importe quel ordre ; seuls les intitulés comptent.", 3);
  aide.getRow(ra).values = ["Colonne", "Exemple", "À quoi ça sert"];
  styleHeader(aide, ra);
  for (const [nom, exemple, explication] of COLONNES_MODELE) aide.addRow([nom, exemple, explication]);
  aide.addRow([]);
  aide.addRow(["", "", "REMPLACEMENT : importer une fiche EFFACE ses lignes existantes et les remplace par celles du fichier. Pour ajouter un ingrédient à une fiche déjà saisie, remets TOUTES ses lignes dans le fichier."]);
  aide.addRow(["", "", "Un composant doit déjà exister dans tes ingrédients ou tes mises en place : l'import n'en crée jamais. Passe par Ingrédients → Importer pour les produits."]);
  aide.addRow(["", "", "Une fiche absente du catalogue sera créée, vide de prix de vente — à compléter ensuite dans Ma carte."]);
  aide.addRow(["", "", "Quantité NETTE : le rendement (parage, épluchage) est appliqué par l'app au moment de la consommation, ne le déduis pas toi-même."]);
  aide.addRow(["", "", "Rien n'est écrit avant que tu aies vu le récapitulatif et cliqué sur « Importer »."]);

  return workbookToResponse(wb, lignes?.length ? `Fiches_${todayStamp()}.xlsx` : "Modele_import_fiches.xlsx");
}

/** Le modèle pré-rempli avec les lignes déjà saisies : corriger en masse puis réimporter. */
async function fichesExistantes(supabase: any, restaurantId: string) {
  // Le nom d'une sous-recette est resolu en JS depuis la liste des recettes :
  // une jointure demanderait le nom exact de la contrainte, qu'on n'a pas.
  const { data } = await supabase
    .from("recipes")
    .select("id, name, is_prep, recipe_lines!recipe_id(quantity, unit, sub_recipe_id, ingredients(name))")
    .eq("restaurant_id", restaurantId)
    .order("name");

  const nomParId = new Map<string, string>((data ?? []).map((r: any) => [r.id, r.name]));
  const lignes: string[][] = [];
  for (const r of data ?? []) {
    for (const l of (r as any).recipe_lines ?? []) {
      const nom = l.ingredients?.name ?? (l.sub_recipe_id ? nomParId.get(l.sub_recipe_id) : null);
      if (!nom) continue;
      lignes.push([r.name, r.is_prep ? "MEP" : "Fiche", nom, l.quantity, l.unit]);
    }
  }
  return modele(lignes);
}

async function tableauDepuisFichier(fichier: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(fichier.name) || fichier.type === "text/csv") {
    return parseCsv(await fichier.text());
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fichier.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const lignes: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[];
    const cellules: unknown[] = [];
    for (let i = 1; i < vals.length; i++) {
      const v = vals[i] as any;
      cellules.push(v && typeof v === "object" ? (v.result ?? v.text ?? v.richText?.map((t: any) => t.text).join("") ?? "") : v);
    }
    lignes.push(cellules);
  });

  // Les modèles téléchargés portent un titre : on démarre aux vrais en-têtes.
  const debut = lignes.findIndex((l) => l.some((c) => normalise(String(c ?? "")) === "fiche"));
  return debut > 0 ? lignes.slice(debut) : lignes;
}

async function contexte(supabase: any, restaurantId: string): Promise<ContexteRecettes> {
  const [{ data: ings }, { data: recs }, { data: lignes }] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit").eq("restaurant_id", restaurantId),
    supabase.from("recipes").select("id, name, is_prep, yield_unit").eq("restaurant_id", restaurantId),
    // recipe_lines ne porte pas de restaurant_id : l'appartenance passe par
    // la recette, d'où la jointure !inner.
    supabase.from("recipe_lines").select("recipe_id, recipes!inner(restaurant_id)").eq("recipes.restaurant_id", restaurantId),
  ]);

  const ingredients = new Map<string, ComposantRef>();
  for (const i of ings ?? []) {
    ingredients.set(normalise(i.name), { id: i.id, nom: i.name, unite: i.unit, type: "ingredient" });
  }
  const recettes = new Map<string, ComposantRef>();
  for (const r of recs ?? []) {
    recettes.set(normalise(r.name), {
      id: r.id, nom: r.name, unite: r.yield_unit || "portion", type: r.is_prep ? "mep" : "fiche",
    });
  }
  const lignesExistantes = new Map<string, number>();
  for (const l of lignes ?? []) {
    lignesExistantes.set(l.recipe_id, (lignesExistantes.get(l.recipe_id) ?? 0) + 1);
  }
  return { ingredients, recettes, lignesExistantes };
}

export async function GET(req: Request) {
  const restaurant = await getRestaurant();
  if (!restaurant) return new Response("Non autorisé", { status: 401 });
  if (new URL(req.url).searchParams.get("fiches") === "1") {
    return fichesExistantes(createClient(), restaurant.id);
  }
  return modele();
}

export async function POST(req: Request) {
  const restaurant = await getRestaurant();
  if (!restaurant) return Response.json({ error: "Session expirée — reconnecte-toi." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const fichier = form?.get("fichier");
  if (!(fichier instanceof File)) return Response.json({ error: "Aucun fichier reçu." }, { status: 400 });
  if (fichier.size > 5 * 1024 * 1024) return Response.json({ error: "Fichier trop lourd (5 Mo maximum)." }, { status: 400 });

  let tableau: unknown[][];
  try {
    tableau = await tableauDepuisFichier(fichier);
  } catch {
    return Response.json({ error: "Fichier illisible. Enregistre-le au format .xlsx ou .csv, puis réessaie." }, { status: 400 });
  }

  const analyse = analyseRecettes(tableau, await contexte(createClient(), restaurant.id));
  return Response.json({
    ...analyse,
    manquantesLabels: analyse.manquantes.map((c) => CHAMP_LABEL[c]),
    nomFichier: fichier.name,
  });
}

export async function PUT(req: Request) {
  const restaurant = await getRestaurant();
  if (!restaurant) return Response.json({ error: "Session expirée — reconnecte-toi." }, { status: 401 });

  const { fiches } = (await req.json().catch(() => ({}))) as { fiches?: AnalyseRecettes["fiches"] };
  if (!Array.isArray(fiches) || fiches.length === 0) {
    return Response.json({ error: "Rien à importer." }, { status: 400 });
  }

  const supabase = createClient();
  // On refait le contexte côté serveur : le client pourrait avoir modifié
  // l'analyse qu'on lui a renvoyée.
  const ctx = await contexte(supabase, restaurant.id);
  const parId = new Map<string, ComposantRef>();
  for (const c of Array.from(ctx.ingredients.values())) parId.set(c.id, c);
  for (const c of Array.from(ctx.recettes.values())) parId.set(c.id, c);

  let creees = 0, misesAJour = 0, lignesEcrites = 0;
  const echecs: string[] = [];

  for (const f of fiches) {
    if (!f?.nom || f.nom === "(sans fiche)") continue;
    const retenues = (f.lignes ?? []).filter((l) => l.cible?.id && parId.has(l.cible.id) && Number(l.quantite) > 0 && l.unite);
    if (retenues.length === 0) continue;

    try {
      // 1. La fiche : retrouvée par son nom, ou créée vide.
      let recetteId = ctx.recettes.get(normalise(f.nom))?.id ?? null;
      if (!recetteId) {
        const { data, error } = await supabase.from("recipes").insert({
          restaurant_id: restaurant.id,
          name: f.nom,
          category: "Autre",
          is_prep: !!f.estMep,
          yield_portions: 1,
          yield_unit: f.estMep ? "kg" : "portion",
          total_cost: 0,
        }).select("id").single();
        if (error) throw new Error(error.message);
        recetteId = data.id;
        creees++;
      } else {
        misesAJour++;
      }

      // 2. Les lignes : on REMPLACE. Sans cela, réimporter doublerait tout.
      const { error: delErr } = await supabase.from("recipe_lines").delete().eq("recipe_id", recetteId);
      if (delErr) throw new Error(delErr.message);

      const rows = retenues.map((l) => {
        const c = parId.get(l.cible!.id)!;
        return {
          recipe_id: recetteId,
          ingredient_id: c.type === "ingredient" ? c.id : null,
          sub_recipe_id: c.type === "ingredient" ? null : c.id,
          quantity: Number(l.quantite),
          unit: l.unite,
        };
      });
      const { error: insErr } = await supabase.from("recipe_lines").insert(rows);
      if (insErr) throw new Error(insErr.message);
      lignesEcrites += rows.length;
    } catch (e) {
      echecs.push(`${f.nom} : ${(e as Error).message}`);
    }
  }

  return Response.json({ creees, misesAJour, lignesEcrites, echecs });
}
