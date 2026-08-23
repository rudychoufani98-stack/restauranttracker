// =====================================================================
//  Chargement des ingrédients tolérant à la migration `is_active`.
//  Entre le déploiement du code et l'exécution du SQL, demander une
//  colonne absente fait échouer TOUTE la requête : l'écran se retrouve
//  sans aucun ingrédient. Ce filet doit rattraper ce cas.
// =====================================================================
import { describe, it, expect } from "vitest";
import { selectIngredients } from "@/lib/ingredients-query";

const ROWS = [{ id: "a", name: "Beurre" }, { id: "b", name: "Tomate" }];

/** Faux client : `hasColumn` dit si `is_active` existe déjà en base. */
function fakeSupabase(hasColumn: boolean, log: string[] = []) {
  return {
    log,
    from() {
      const q: any = {
        _cols: "",
        select(c: string) { q._cols = c; return q; },
        eq() { return q; },
        order() {
          log.push(q._cols);
          const missing = !hasColumn && q._cols.includes("is_active");
          return Promise.resolve(
            missing
              ? { data: null, error: { message: `column ingredients.is_active does not exist` } }
              : { data: ROWS, error: null },
          );
        },
      };
      return q;
    },
  };
}

describe("selectIngredients", () => {
  it("demande la colonne is_active quand elle existe et rend les lignes", async () => {
    const log: string[] = [];
    const { data } = await selectIngredients(fakeSupabase(true, log), "r1", "id, name");
    expect(data).toEqual(ROWS);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("is_active");
  });

  it("retente sans la colonne plutôt que de rendre un écran vide", async () => {
    const log: string[] = [];
    const { data } = await selectIngredients(fakeSupabase(false, log), "r1", "id, name");
    expect(data).toEqual(ROWS); // ← le point crucial : PAS null
    expect(log).toHaveLength(2);
    expect(log[0]).toContain("is_active");
    expect(log[1]).not.toContain("is_active");
  });

  it("n'ajoute pas is_active deux fois si l'appelant l'a déjà mise", async () => {
    const log: string[] = [];
    await selectIngredients(fakeSupabase(true, log), "r1", "id, name, is_active");
    expect(log[0].match(/is_active/g)).toHaveLength(1);
  });

  it("retire proprement la colonne au milieu d'une longue liste", async () => {
    const log: string[] = [];
    await selectIngredients(fakeSupabase(false, log), "r1", "id, name, is_active, suppliers(name)");
    expect(log[1]).toBe("id, name, suppliers(name)");
  });
});
