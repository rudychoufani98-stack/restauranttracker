import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { newWorkbook, autoWidth, styleHeader, addTitle, workbookToResponse } from "@/lib/excel";
import {
  analyseTableau, parseCsv, normalise, CHAMP_LABEL,
  type Contexte, type LigneAnalysee, type ProduitImporte,
} from "@/lib/import-produits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
//  GET   → télécharge le modèle Excel à remplir
//  POST  → analyse un fichier (ne touche à RIEN, renvoie ce qui serait fait)
//  PUT   → écrit les lignes validées
// =====================================================================

const COLONNES_MODELE = [
  ["Nom", "Tomate grappe", "Obligatoire. Le nom qui apparaîtra dans l'app."],
  ["Catégorie", "Légumes", "Laisse vide et le produit ira dans « Autre »."],
  ["Fournisseur", "Metro", "Créé automatiquement s'il n'existe pas encore."],
  ["Référence", "REF-1234", "La référence du fournisseur, pour tes bons de commande."],
  ["Unité", "kg", "Obligatoire. kg, L ou pièce."],
  ["Nombre par colis", 1, "Combien d'unités dans un colis. 24 pour une caisse de 24 canettes."],
  ["Taille unitaire", 5, "Obligatoire. Contenance d'UNE unité : 5 pour un sac de 5 kg."],
  ["Prix HT", 12.5, "Obligatoire. Prix du COLIS entier, hors taxes."],
  ["TVA", 5.5, "En pourcentage. 5,5 par défaut si tu laisses vide."],
  ["Rendement", 90, "Ce qu'il reste après parage, en %. 100 si tu ne sais pas."],
  ["Seuil", 10, "Alerte « à commander » sous cette quantité. Laisse vide si tu ne veux pas d'alerte."],
  ["Stock initial", 20, "Ce que tu as en stock aujourd'hui. Laisse vide pour 0."],
  ["Prix de vente", "", "Seulement pour un produit revendu tel quel (une canette, une bière)."],
  ["Référence interne", "", "Laisse vide : le bouton « Numéroter » attribue les numéros par famille."],
];

async function modele() {
  const wb = newWorkbook();

  const ws = wb.addWorksheet("Produits");
  const entetes = COLONNES_MODELE.map((c) => c[0] as string);
  autoWidth(ws, entetes.map(() => 18));
  const r = addTitle(
    ws,
    "Modèle d'import de produits",
    "Remplis une ligne par produit, puis dépose ce fichier dans Ingrédients → Importer. La feuille « Mode d'emploi » explique chaque colonne.",
    entetes.length,
  );
  ws.getRow(r).values = entetes;
  styleHeader(ws, r);
  ws.addRow(COLONNES_MODELE.map((c) => c[1]));
  ws.addRow(["Coca 33 cl", "Boissons", "Metro", "", "pièce", 24, 1, 10.8, 20, 100, 24, 48, 2.5, ""]);

  const aide = wb.addWorksheet("Mode d'emploi");
  autoWidth(aide, [22, 18, 80]);
  const ra = addTitle(aide, "Comment remplir le fichier", "Les colonnes peuvent être dans n'importe quel ordre ; seuls les intitulés comptent.", 3);
  aide.getRow(ra).values = ["Colonne", "Exemple", "À quoi ça sert"];
  styleHeader(aide, ra);
  for (const [nom, exemple, explication] of COLONNES_MODELE) {
    aide.addRow([nom, exemple, explication]);
  }
  aide.addRow([]);
  aide.addRow(["", "", "Un produit déjà présent dans l'app est MIS À JOUR, jamais dupliqué (comparaison sur le nom)."]);
  aide.addRow(["", "", "Rien n'est écrit avant que tu aies vu le récapitulatif et cliqué sur « Importer »."]);

  return workbookToResponse(wb, "Modele_import_produits.xlsx");
}

/** Transforme le fichier reçu en tableau de cellules. */
async function tableauDepuisFichier(fichier: File): Promise<unknown[][]> {
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith(".csv") || nom.endsWith(".txt")) {
    return parseCsv(await fichier.text());
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fichier.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const lignes: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cellules: unknown[] = [];
    // row.values est décalé de 1 (l'index 0 n'est pas utilisé par ExcelJS).
    const vals = row.values as unknown[];
    for (let i = 1; i < vals.length; i++) {
      const v = vals[i] as any;
      // Une cellule peut porter une formule ou un texte enrichi.
      cellules.push(v && typeof v === "object" ? (v.result ?? v.text ?? v.richText?.map((t: any) => t.text).join("") ?? "") : v);
    }
    lignes.push(cellules);
  });

  // Les modèles téléchargés portent un titre : on démarre aux vrais en-têtes.
  const debut = lignes.findIndex((l) => l.some((c) => normalise(String(c ?? "")) === "nom"));
  return debut > 0 ? lignes.slice(debut) : lignes;
}

async function contexte(supabase: any, restaurantId: string): Promise<Contexte> {
  const [{ data: ings }, { data: fours }] = await Promise.all([
    supabase.from("ingredients").select("id, name, vat_rate, internal_ref").eq("restaurant_id", restaurantId),
    supabase.from("suppliers").select("id, name").eq("restaurant_id", restaurantId),
  ]);

  // TVA par defaut = celle que le restaurant utilise deja le plus souvent.
  // Plus juste qu une constante : un traiteur est a 10 %, une epicerie a 5,5 %.
  const compte = new Map<number, number>();
  for (const i of ings ?? []) {
    const t = Number((i as any).vat_rate);
    if (Number.isFinite(t)) compte.set(t, (compte.get(t) ?? 0) + 1);
  }
  const frequente = Array.from(compte.entries()).sort((x, y) => y[1] - x[1])[0];

  return {
    existants: new Map<string, string>((ings ?? []).map((i: any) => [normalise(i.name), i.id])),
    fournisseurs: new Map<string, string>((fours ?? []).map((f: any) => [normalise(f.name), f.id])),
    refsPrises: new Set<number>(
      (ings ?? []).map((i: any) => Number(i.internal_ref)).filter((n: number) => Number.isFinite(n)),
    ),
    tvaDefaut: frequente ? frequente[0] : 5.5,
  };
}

export async function GET() {
  const restaurant = await getRestaurant();
  if (!restaurant) return new Response("Non autorisé", { status: 401 });
  return modele();
}

export async function POST(req: Request) {
  const restaurant = await getRestaurant();
  if (!restaurant) return Response.json({ error: "Session expirée — reconnecte-toi." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const fichier = form?.get("fichier");
  if (!(fichier instanceof File)) {
    return Response.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  if (fichier.size > 5 * 1024 * 1024) {
    return Response.json({ error: "Fichier trop lourd (5 Mo maximum)." }, { status: 400 });
  }

  let tableau: unknown[][];
  try {
    tableau = await tableauDepuisFichier(fichier);
  } catch {
    return Response.json(
      { error: "Fichier illisible. Enregistre-le au format .xlsx ou .csv, puis réessaie." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const analyse = analyseTableau(tableau, await contexte(supabase, restaurant.id));

  return Response.json({
    ...analyse,
    manquantesLabels: analyse.manquantes.map((c) => CHAMP_LABEL[c]),
    nomFichier: fichier.name,
  });
}

export async function PUT(req: Request) {
  const restaurant = await getRestaurant();
  if (!restaurant) return Response.json({ error: "Session expirée — reconnecte-toi." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const lignes: LigneAnalysee[] = Array.isArray(body?.lignes) ? body.lignes : [];
  const aEcrire = lignes.filter((l) => l.statut !== "erreur" && l.produit);
  if (aEcrire.length === 0) return Response.json({ error: "Rien à importer." }, { status: 400 });

  const supabase = createClient();
  // On relit le contexte : le fichier a pu être analysé il y a plusieurs
  // minutes, et un produit a pu être créé entre-temps dans un autre onglet.
  const ctx = await contexte(supabase, restaurant.id);

  const fournisseurs = new Map(ctx.fournisseurs);
  let crees = 0, misAJour = 0;
  const echecs: { nom: string; raison: string }[] = [];

  for (const ligne of aEcrire) {
    const p = ligne.produit as ProduitImporte;
    try {
      // Fournisseur : réutilisé s'il existe, créé sinon.
      let supplier_id: string | null = null;
      if (p.fournisseur) {
        const cle = normalise(p.fournisseur);
        supplier_id = fournisseurs.get(cle) ?? null;
        if (!supplier_id) {
          const { data: cree, error } = await supabase
            .from("suppliers")
            .insert({ restaurant_id: restaurant.id, name: p.fournisseur.trim() })
            .select("id").single();
          if (error) throw new Error(`fournisseur « ${p.fournisseur} » : ${error.message}`);
          supplier_id = cree.id;
          fournisseurs.set(cle, cree.id);
        }
      }

      const payload: Record<string, unknown> = {
        name: p.name,
        category: p.category,
        unit: p.unit,
        pack_units: p.pack_units,
        unit_size: p.unit_size,
        pack_quantity: p.pack_quantity,
        pack_price: p.pack_price,
        cost_per_base_unit: p.cost_per_base_unit,
        vat_rate: p.vat_rate,
        yield_pct: p.yield_pct,
        reorder_threshold: p.reorder_threshold,
        selling_price: p.selling_price,
        supplier_reference: p.supplier_reference,
        ...(p.internal_ref != null ? { internal_ref: p.internal_ref } : {}),
        supplier_id,
        updated_at: new Date().toISOString(),
      };

      const existantId = ctx.existants.get(normalise(p.name)) ?? null;
      if (existantId) {
        // Le stock d'un produit DÉJÀ suivi ne se réécrit pas depuis un fichier :
        // il appartient aux réceptions et aux inventaires. On l'ignore ici.
        const { error } = await supabase.from("ingredients").update(payload).eq("id", existantId);
        if (error) throw new Error(error.message);
        misAJour++;
      } else {
        // Le CMUP part du prix d'achat : sans lui, un stock initial ne vaudrait rien.
        const { error } = await supabase.from("ingredients").insert({
          ...payload,
          restaurant_id: restaurant.id,
          stock_qty: p.stock_qty ?? 0,
          cmup: p.cost_per_base_unit,
        });
        if (error) throw new Error(error.message);
        crees++;
      }
    } catch (e) {
      echecs.push({ nom: p.name, raison: (e as Error).message });
    }
  }

  return Response.json({ crees, misAJour, echecs });
}
