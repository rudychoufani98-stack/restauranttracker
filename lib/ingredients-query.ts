// Chargement des ingrédients, tolérant à une migration pas encore passée.
//
// `is_active` arrive avec supabase/ingredient_actif.sql. Entre le déploiement
// du code et l'exécution du SQL, demander cette colonne fait échouer toute la
// requête : PostgREST renvoie une erreur, `data` vaut null, et l'écran se
// retrouve SANS AUCUN ingrédient — une recette devient inéditable.
//
// On réessaie donc sans la colonne. Le filtre actif/inactif est alors inopérant
// (tout est considéré actif, ce qui est le défaut de la colonne), mais l'app
// reste utilisable. Une fois le SQL passé, le premier appel réussit et ce
// second chemin ne sert plus.

export async function selectIngredients(
  supabase: any,
  restaurantId: string,
  cols: string,
): Promise<{ data: any[] | null }> {
  const run = (c: string) =>
    supabase.from("ingredients").select(c).eq("restaurant_id", restaurantId).order("name");

  const withFlag = cols.includes("is_active") ? cols : `${cols}, is_active`;
  const first = await run(withFlag);
  if (!first.error) return { data: first.data };

  console.warn("[ingredients] is_active absente — exécute supabase/ingredient_actif.sql");
  const fallback = await run(withFlag.replace(/,\s*is_active/, ""));
  return { data: fallback.data };
}
