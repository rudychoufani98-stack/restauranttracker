// =====================================================================
//  Import de produits : la route de bout en bout.
//
//  Le point le plus important est verifie ici : l ANALYSE n ecrit RIEN.
//  Un fichier peut etre depose, relu, corrige autant de fois qu on veut
//  sans qu une seule ligne ne parte en base.
// =====================================================================
import { describe, it, expect, vi } from "vitest";

const ING: any[] = [{ id: "id-h", name: "Huile olive", vat_rate: 5.5 }];
const FOURN: any[] = [{ id: "f-1", name: "Metro" }];
const ecrits: any[] = [];

function table(t: string) {
  const o: any = {
    select: () => o, eq: () => o, order: () => o,
    insert: (v: any) => { ecrits.push({ t, v }); return { select: () => ({ single: async () => ({ data: { id: "nouveau" }, error: null }) }) }; },
    update: (v: any) => { ecrits.push({ t, op: "update", v }); return { eq: async () => ({ error: null }) }; },
    maybeSingle: async () => ({ data: null, error: null }),
    then: (ok: any) => Promise.resolve({ data: t === "ingredients" ? ING : t === "suppliers" ? FOURN : [], error: null }).then(ok),
  };
  return o;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ from: table }) }));
vi.mock("@/lib/auth", () => ({ getRestaurant: async () => ({ id: "r1", name: "Amaly" }) }));

const CSV = `Désignation;Famille;Fournisseur;Unité;Colisage;Contenance;Prix HT;TVA;Rendement
Tomate grappe;Légumes;Metro;kg;1;5;12,50 €;5,5;90
Huile olive;Épicerie;Metro;Litre;1;5;24,00 €;5,5;
Coca 33 cl;Boissons;Nouveau Grossiste;pièce;24;1;10,80;20;
Mystère;Autre;;carton;1;5;10,00;;
Tomate grappe;Légumes;Metro;kg;1;5;13,00;;`;

describe("Import de produits — parcours complet", () => {
  it("analyse un fichier sale sans rien écrire", async () => {
    const { POST } = await import("@/app/api/import/produits/route");
    const fd = new FormData();
    fd.append("fichier", new File([CSV], "mercuriale.csv", { type: "text/csv" }));
    const res = await POST(new Request("http://x", { method: "POST", body: fd }));
    const j = await res.json();

    expect(res.status).toBe(200);
    expect(j.manquantes).toEqual([]);
    expect(j.resume).toEqual({ creer: 2, mettre_a_jour: 1, erreur: 2, avertissements: 1 });
    expect(ecrits).toHaveLength(0);          // ← RIEN n'a été écrit

    const coca = j.lignes.find((l: any) => l.nom === "Coca 33 cl");
    expect(coca.produit.cost_per_base_unit).toBeCloseTo(0.45, 8);
    expect(coca.avertissements[0]).toContain("Nouveau Grossiste");
    const huile = j.lignes.find((l: any) => l.nom === "Huile olive");
    expect(huile.statut).toBe("mettre_a_jour");
    expect(huile.produit.vat_rate).toBe(5.5);

    // Écriture
    const { PUT } = await import("@/app/api/import/produits/route");
    const res2 = await PUT(new Request("http://x", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lignes: j.lignes }),
    }));
    const bilan = await res2.json();
    expect(bilan).toMatchObject({ crees: 2, misAJour: 1, echecs: [] });

    const fournisseurCree = ecrits.filter((e) => e.t === "suppliers");
    expect(fournisseurCree).toHaveLength(1);            // Metro réutilisé, pas recréé
    expect(fournisseurCree[0].v.name).toBe("Nouveau Grossiste");
    const maj = ecrits.find((e) => e.op === "update");
    expect(maj.v.stock_qty).toBeUndefined();            // le stock d'un produit suivi n'est pas écrasé
  });

  it("le modèle Excel se génère", async () => {
    const { GET } = await import("@/app/api/import/produits/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(3000);
  });
});
