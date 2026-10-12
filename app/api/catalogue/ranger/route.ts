// =====================================================================
//  GET  /api/catalogue/ranger  → ce qui serait fait, sans rien faire
//  POST /api/catalogue/ranger  → le fait
//
//  Deux verbes pour une seule logique : un catalogue se range sous les
//  yeux de celui a qui il appartient. L ecran affiche le detail — quel
//  produit part dans quel rayon, quel rayon disparait et pourquoi — et
//  n ecrit qu apres un clic.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import {
  rangerProduits, rangerMeps, compter, CATEGORIES_EXEMPLES,
  planCategoriesIngredient, planCategoriesMep, planCategoriesMenu,
  type Deplacement, type PlanCategories, type CategorieExistante,
} from "@/lib/rangement";

type Plan = {
  produits: { deplacements: Deplacement[]; nonReconnus: { id: string; nom: string }[] };
  meps: { deplacements: Deplacement[]; nonReconnus: { id: string; nom: string }[] };
  categories: { ingredient: PlanCategories; prep: PlanCategories; menu: PlanCategories };
};

/** Tout le calcul, sans aucune ecriture. */
async function calculer(restaurantId: string): Promise<Plan> {
  const supabase = createClient();

  const [{ data: produits }, { data: recettes }, { data: cats }] = await Promise.all([
    supabase.from("ingredients").select("id, name, category").eq("restaurant_id", restaurantId),
    supabase.from("recipes").select("id, name, category, is_prep").eq("restaurant_id", restaurantId),
    supabase.from("categories").select("id, type, name, position").eq("restaurant_id", restaurantId),
  ]);

  const tousProduits = produits ?? [];
  const toutesRecettes = recettes ?? [];
  const meps = toutesRecettes.filter((r) => r.is_prep);
  const plats = toutesRecettes.filter((r) => !r.is_prep);

  const planProduits = rangerProduits(tousProduits);
  const planMeps = rangerMeps(meps);

  // Les comptes se calculent APRES deplacement : la liste des rayons doit
  // refleter le catalogue tel qu il sera, pas tel qu il etait.
  const apres = new Map<string, string>();
  for (const d of planProduits.deplacements) apres.set(d.id, d.apres);
  const comptesProduits = compter(tousProduits.map((p) => ({ category: apres.get(p.id) ?? p.category })));

  const apresMep = new Map<string, string>();
  for (const d of planMeps.deplacements) apresMep.set(d.id, d.apres);
  const comptesMeps = compter(meps.map((m) => ({ category: apresMep.get(m.id) ?? m.category })));
  const comptesPlats = compter(plats);

  const parType = (t: string): CategorieExistante[] =>
    (cats ?? []).filter((c) => c.type === t).map((c) => ({ id: c.id, name: c.name, position: c.position }));

  return {
    produits: planProduits,
    meps: planMeps,
    categories: {
      ingredient: planCategoriesIngredient(parType("ingredient"), comptesProduits, CATEGORIES_EXEMPLES.ingredient),
      prep: planCategoriesMep(parType("prep"), comptesMeps, CATEGORIES_EXEMPLES.prep),
      menu: planCategoriesMenu(parType("menu"), comptesPlats, CATEGORIES_EXEMPLES.menu),
    },
  };
}

async function restaurantOuErreur() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erreur: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  const restaurant = await getRestaurant();
  if (!restaurant) return { erreur: NextResponse.json({ error: "Aucun restaurant" }, { status: 403 }) };
  return { restaurant };
}

export async function GET() {
  try {
    const { restaurant, erreur } = await restaurantOuErreur();
    if (erreur) return erreur;
    return NextResponse.json(await calculer(restaurant!.id));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { restaurant, erreur } = await restaurantOuErreur();
    if (erreur) return erreur;
    const rid = restaurant!.id;
    const supabase = createClient();

    // Ce que l ecran a montre peut avoir vieilli d une minute : on
    // recalcule, et on n applique que ce qui est encore vrai.
    const plan = await calculer(rid);

    // Un filtre de l ecran peut restreindre l application : « range les
    // produits mais laisse la carte tranquille ».
    let portee: string[] = ["produits", "meps", "categories"];
    try {
      const corps = await req.json();
      if (Array.isArray(corps?.portee) && corps.portee.length) portee = corps.portee;
    } catch { /* corps vide : tout */ }
    const fait = (quoi: string) => portee.includes(quoi);

    const compte = { produits: 0, meps: 0, creees: 0, retirees: 0, reordonnees: 0 };

    if (fait("produits")) {
      for (const d of plan.produits.deplacements) {
        const { error } = await supabase.from("ingredients").update({ category: d.apres })
          .eq("id", d.id).eq("restaurant_id", rid);
        if (!error) compte.produits++;
      }
    }

    if (fait("meps")) {
      for (const d of plan.meps.deplacements) {
        const { error } = await supabase.from("recipes").update({ category: d.apres })
          .eq("id", d.id).eq("restaurant_id", rid);
        if (!error) compte.meps++;
      }
    }

    if (fait("categories")) {
      const types: ("ingredient" | "prep" | "menu")[] = ["ingredient", "prep", "menu"];
      for (const type of types) {
        const p = plan.categories[type];
        // Creer d abord : si une creation echoue, mieux vaut un doublon
        // qu un rayon qui a disparu sans remplacant.
        for (const c of p.aCreer) {
          const { error } = await supabase.from("categories")
            .insert({ restaurant_id: rid, type, name: c.name, position: c.position });
          if (!error) compte.creees++;
        }
        for (const c of p.aReordonner) {
          const { error } = await supabase.from("categories")
            .update({ position: c.position }).eq("id", c.id).eq("restaurant_id", rid);
          if (!error) compte.reordonnees++;
        }
        for (const c of p.aRetirer) {
          const { error } = await supabase.from("categories")
            .delete().eq("id", c.id).eq("restaurant_id", rid);
          if (!error) compte.retirees++;
        }
      }
    }

    return NextResponse.json({ ok: true, ...compte, plan });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur" }, { status: 500 });
  }
}
