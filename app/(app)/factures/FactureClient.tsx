"use client";

// =====================================================================
//  Déposer une facture : la photo entre, le stock sort.
//
//  Trois temps, et pas un de plus :
//    1. le fournisseur et le fichier
//    2. la relecture — c'est ici que tout se joue
//    3. la validation
//
//  Le temps 2 n'est pas une formalité. Une facture imprime les noms du
//  FOURNISSEUR : « FROMAGE GRILL & FRYKOLIOS 40x250G » et pas
//  « Halloumi ». Chaque ligne doit donc pointer un produit du catalogue,
//  et l'écran dit, avant d'écrire, ce que chaque ligne va mettre en
//  stock et ce qu'elle va faire au coût moyen.
//
//  Ce que l'écran apprend, il le retient : la désignation reconnue est
//  enregistrée comme article d'achat du fournisseur. La facture du mois
//  suivant se rapproche toute seule.
// =====================================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Camera, Loader2, Check, FileText, AlertTriangle, Trash2 } from "lucide-react";
import clsx from "clsx";
import { eur } from "@/lib/format";
import { useConfirm, useAlert } from "@/components/ConfirmDialog";
import { grouperParCategorie, ordreParFamille } from "@/lib/rangement";
import { rapprocher, type LigneLue } from "@/lib/scan-document";
import { planFacture, contenuColis, type LigneFacture, type ProduitStock } from "@/lib/facture-directe";
import { unitShort, displayUnitLabel, perDisplayUnit } from "@/lib/ingredient-helpers";

type Supplier = { id: string; name: string };
type Ingredient = {
  id: string; name: string; category: string | null; unit: string;
  stock_qty: number; cmup: number | null; pack_quantity: number;
  pack_price: number | null; cost_per_base_unit: number; vat_rate: number | null;
};
type Article = {
  ingredient_id: string; supplier_id: string; supplier_label: string | null;
  pack_type: string | null; pack_units: number | null; unit_size: number | null;
  unit: string | null; pack_price: number | null;
};

type Brouillon = LigneFacture & { lue: LigneLue };

interface Props {
  restaurantId: string;
  suppliers: Supplier[];
  ingredients: Ingredient[];
  articles: Article[];
  categories: string[];
}

export default function FactureClient({ restaurantId, suppliers, ingredients, articles, categories }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useAlert();

  const [supplierId, setSupplierId] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalImprime, setTotalImprime] = useState<number | null>(null);
  const [lignes, setLignes] = useState<Brouillon[] | null>(null);
  const [lecture, setLecture] = useState(false);
  const [ecriture, setEcriture] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const parId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  /** Le conditionnement de CE fournisseur, par produit. */
  const articlesDuFournisseur = useMemo(() => {
    const m = new Map<string, Article>();
    for (const a of articles) if (a.supplier_id === supplierId) m.set(a.ingredient_id, a);
    return m;
  }, [articles, supplierId]);

  const contenuDuColis = (ing: Ingredient): number => {
    const a = articlesDuFournisseur.get(ing.id);
    const base = a ? (Number(a.pack_units ?? 1) || 1) * (Number(a.unit_size ?? 0) || 0) *
      ((a.unit ?? ing.unit) === "kg" || (a.unit ?? ing.unit) === "l" ? 1000 : 1) : 0;
    return base > 0 ? base : contenuColis(produitStock(ing, 0));
  };

  function produitStock(ing: Ingredient, base: number): ProduitStock {
    return {
      id: ing.id, name: ing.name, unit: ing.unit,
      stock_qty: Number(ing.stock_qty ?? 0), cmup: ing.cmup,
      pack_quantity: Number(ing.pack_quantity ?? 0),
      cost_per_base_unit: Number(ing.cost_per_base_unit ?? 0),
      basePerPack: base > 0 ? base : null,
    };
  }

  const produits: ProduitStock[] = useMemo(
    () => ingredients.map((i) => produitStock(i, contenuDuColis(i))),
    [ingredients, articlesDuFournisseur],
  );

  const plan = useMemo(
    () => planFacture(lignes ?? [], produits, totalImprime),
    [lignes, produits, totalImprime],
  );

  const ordreRayons = useMemo(
    () => (categories.length > 0 ? categories : ordreParFamille(ingredients.map((i) => i.category ?? ""))),
    [categories, ingredients],
  );
  const groupes = useMemo(() => grouperParCategorie(ingredients, ordreRayons), [ingredients, ordreRayons]);

  // ── 1. Lecture ──────────────────────────────────────────────────────
  async function lire() {
    if (!fichier || !supplierId) return;
    setLecture(true); setMessage(null);
    try {
      // On donne au lecteur les noms que CE fournisseur imprime.
      const attendus = ingredients.map((i) => ({
        ingredient_id: i.id,
        nom: i.name,
        designations: [articlesDuFournisseur.get(i.id)?.supplier_label].filter(Boolean) as string[],
      }));

      const fd = new FormData();
      fd.append("file", fichier);
      fd.append("document", "facture");
      // Seuls les produits déjà connus de ce fournisseur : envoyer les 134
      // noms du catalogue noierait la consigne.
      fd.append("lines", JSON.stringify(attendus.filter((a) => a.designations.length > 0).slice(0, 60)));

      const res = await fetch("/api/scan-bl", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Lecture impossible");

      const lues: LigneLue[] = json.items ?? [];
      if (lues.length === 0) {
        setMessage({ ok: false, texte: "Aucune ligne lue. Vérifie que la photo est nette et cadrée sur le tableau des articles." });
        setLecture(false);
        return;
      }

      const { trouves } = rapprocher(lues, attendus);
      // Par IDENTITÉ de ligne, pas par nom : une facture qui imprime deux
      // fois la même référence ne doit pas voir la seconde hériter du
      // rapprochement de la première.
      const produitDe = new Map<LigneLue, string>();
      for (const [ingId, lu] of Array.from(trouves.entries())) produitDe.set(lu, ingId);

      setLignes(lues.map((lu) => ({
        lue: lu,
        designation: lu.name,
        ingredient_id: produitDe.get(lu) ?? null,
        qty: lu.quantity ?? 1,
        prix: lu.price ?? 0,
        action: "stock" as const,
      })));
      if (json.numero) setNumero(String(json.numero));
      if (json.date) setDate(String(json.date));
      setTotalImprime(json.total_ht ?? null);

      const n = trouves.size;
      setMessage({
        ok: true,
        texte: `${lues.length} ligne${lues.length > 1 ? "s" : ""} lue${lues.length > 1 ? "s" : ""}, ${n} rapprochée${n > 1 ? "s" : ""} automatiquement. ` +
          (n < lues.length ? "Choisis le produit pour les autres — l'app s'en souviendra la prochaine fois." : "Relis les montants avant de valider."),
      });
    } catch (e: any) {
      setMessage({ ok: false, texte: e?.message ?? "Lecture impossible" });
    } finally {
      setLecture(false);
    }
  }

  function majLigne(i: number, patch: Partial<Brouillon>) {
    setLignes((p) => (p ? p.map((l, j) => (j === i ? { ...l, ...patch } : l)) : p));
  }

  // ── 2. Écriture ─────────────────────────────────────────────────────
  async function valider() {
    if (!lignes || !supplierId) return;
    const enStock = lignes.filter((l) => l.action === "stock" && l.ingredient_id && l.qty > 0);
    if (enStock.length === 0) {
      setMessage({ ok: false, texte: "Aucune ligne n'entre en stock. Choisis au moins un produit." });
      return;
    }
    const bloquants = plan.avertissements.filter((a) => a.ligne !== "Total");
    if (!(await confirm(
      `Enregistrer cette facture ?\n\nTotal HT ${eur(plan.total)}\n${plan.mouvements.length} produit(s) entrent en stock.\n\n` +
      (bloquants.length > 0 ? `⚠️ ${bloquants.length} avertissement(s) non résolu(s).\n\n` : "") +
      "Le stock sera augmenté et le coût moyen (CMUP) recalculé au prix facturé."
    ))) return;

    setEcriture(true); setMessage(null);

    // Une facture sans bon de commande en crée un, déjà facturé : tout le
    // reste de l'app (journal d'achat, achats du mois, exports) s'appuie
    // sur la commande. Mieux vaut une commande rétroactive qu'une facture
    // orpheline qu'aucun écran ne sait montrer.
    const annee = new Date().getFullYear();
    const { data: dernier } = await supabase
      .from("purchase_orders").select("order_number")
      .eq("restaurant_id", restaurantId).like("order_number", `BDC-${annee}-%`)
      .order("order_number", { ascending: false }).limit(1).maybeSingle();
    const seq = dernier?.order_number ? parseInt(String(dernier.order_number).split("-")[2] ?? "0", 10) : 0;
    const numeroBdc = `BDC-${annee}-${String((isNaN(seq) ? 0 : seq) + 1).padStart(4, "0")}`;

    const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({
      restaurant_id: restaurantId, supplier_id: supplierId,
      order_number: numeroBdc, status: "Invoiced", expected_total: plan.total,
    }).select().single();
    if (poErr || !po) { setMessage({ ok: false, texte: `Création impossible : ${poErr?.message}` }); setEcriture(false); return; }

    // Tout ce que cette tentative a créé, pour pouvoir l'effacer.
    const annuler = async (texte: string) => {
      if (factureId) {
        await supabase.from("stock_movements").delete().eq("reference_type", "invoice").eq("reference_id", factureId);
        await supabase.from("invoice_lines").delete().eq("invoice_id", factureId);
        await supabase.from("invoices").delete().eq("id", factureId);
      }
      await supabase.from("purchase_order_lines").delete().eq("po_id", po.id);
      await supabase.from("purchase_orders").delete().eq("id", po.id);
      setMessage({ ok: false, texte });
      setEcriture(false);
    };
    let factureId: string | null = null;

    try {
      const { error: polErr } = await supabase.from("purchase_order_lines").insert(
        plan.lignes.map((l) => ({ po_id: po.id, ingredient_id: l.ingredient_id, quantity: l.quantity, expected_price: l.unit_price })),
      );
      if (polErr) return annuler(`Lignes de commande : ${polErr.message}. Rien n'a été appliqué.`);

      // La facture naît en BROUILLON : une panne en cours de route ne doit
      // pas laisser derrière elle une facture qui a l'air appliquée.
      const { data: facture, error: facErr } = await supabase.from("invoices").insert({
        po_id: po.id, restaurant_id: restaurantId, delivery_note_id: null,
        invoice_number: numero || null, invoice_date: date,
        total_ht: plan.total,
        misc_fees: plan.totalFrais, misc_fees_label: plan.totalFrais > 0 ? "Frais de la facture" : null,
        validated: false, validated_at: null,
      }).select().single();
      if (facErr || !facture) return annuler(`Facture : ${facErr?.message}. Rien n'a été appliqué.`);
      factureId = facture.id;

      const { error: ilErr } = await supabase.from("invoice_lines").insert(
        plan.lignes.map((l) => ({
          invoice_id: facture.id, ingredient_id: l.ingredient_id,
          quantity: l.quantity, unit_price: l.unit_price, price_changed: false,
        })),
      );
      if (ilErr) return annuler(`Lignes de facture : ${ilErr.message}. Rien n'a été appliqué.`);

      // Les mouvements AVANT le stock : si l'écriture casse ici, le stock
      // n'a pas bougé et il n'y a rien à rattraper.
      const { error: movErr } = await supabase.from("stock_movements").insert(
        plan.mouvements.map((m) => ({
          restaurant_id: restaurantId, ingredient_id: m.ingredient_id,
          movement_type: "in", qty: m.qty, unit_cost: m.unit_cost,
          reference_type: "invoice", reference_id: facture.id,
          notes: "Facture saisie directement",
        })),
      );
      if (movErr) return annuler(`Mouvements de stock : ${movErr.message}. Rien n'a été appliqué.`);

      // Historique de prix : best-effort, il n'empêche rien.
      const historique = plan.patches
        .map((p) => {
          const ing = parId.get(p.id);
          const ancien = Number(ing?.cost_per_base_unit ?? 0);
          if (!(ancien > 0) || Math.abs(p.cost_per_base_unit - ancien) < 1e-9) return null;
          const colisFiche = (ing!.unit === "kg" || ing!.unit === "l" ? 1000 : 1) * (Number(ing!.pack_quantity) || 1);
          return {
            ingredient_id: p.id,
            old_price: ancien * colisFiche, new_price: p.cost_per_base_unit * colisFiche,
            source: "invoice", delivery_note_id: null,
          };
        })
        .filter(Boolean);
      if (historique.length > 0) await supabase.from("ingredient_price_history").insert(historique as any[]);

      // Le stock, produit par produit, avec retour en arrière si ça casse.
      const faits: { id: string; avant: any }[] = [];
      for (const p of plan.patches) {
        const ing = parId.get(p.id);
        const avant = {
          stock_qty: ing?.stock_qty ?? null, cmup: ing?.cmup ?? null,
          pack_price: ing?.pack_price ?? null, cost_per_base_unit: ing?.cost_per_base_unit ?? null,
        };
        const { error: upErr } = await supabase.from("ingredients").update({
          stock_qty: p.stock_qty, cmup: p.cmup,
          cost_per_base_unit: p.cost_per_base_unit, pack_price: p.pack_price,
          updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        if (upErr) {
          for (const f of faits) await supabase.from("ingredients").update(f.avant).eq("id", f.id);
          return annuler(`Stock de « ${ing?.name ?? p.id} » : ${upErr.message}. Tout a été remis comme avant.`);
        }
        faits.push({ id: p.id, avant });
      }

      const { error: valErr } = await supabase.from("invoices")
        .update({ validated: true, validated_at: new Date().toISOString() }).eq("id", facture.id);
      if (valErr) {
        for (const f of faits) await supabase.from("ingredients").update(f.avant).eq("id", f.id);
        return annuler(`Validation impossible : ${valErr.message}. Tout a été remis comme avant.`);
      }

      // Ce que l'app vient d'apprendre, elle le garde : la désignation
      // reconnue devient l'article d'achat de ce fournisseur. La prochaine
      // facture se rapprochera toute seule.
      await apprendreLesDesignations();

      // Les recettes qui utilisent ces produits changent de coût.
      try {
        await fetch("/api/recalculate-recipes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantId, changedIngredientIds: plan.patches.map((p) => p.id) }),
        });
      } catch { /* best-effort : les coûts produits sont déjà justes */ }

      notify(`Facture enregistrée. ${plan.mouvements.length} produit(s) sont entrés en stock pour ${eur(plan.total)} HT.`);
      router.push("/orders?invoiced=1");
    } catch (e: any) {
      return annuler(e?.message ?? "Erreur pendant l'enregistrement.");
    }
  }

  /** Enregistre les désignations nouvellement reconnues (best-effort). */
  async function apprendreLesDesignations() {
    if (!lignes) return;
    const nouvelles = lignes.filter(
      (l) => l.action === "stock" && l.ingredient_id && !articlesDuFournisseur.has(l.ingredient_id),
    );
    for (const l of nouvelles) {
      const ing = parId.get(l.ingredient_id!);
      if (!ing) continue;
      const contenu = contenuDuColis(ing);
      if (!(contenu > 0)) continue;
      const facteur = ing.unit === "kg" || ing.unit === "l" ? 1000 : 1;
      await supabase.from("ingredient_suppliers").insert({
        ingredient_id: ing.id, supplier_id: supplierId,
        supplier_label: l.designation,
        pack_units: 1, unit_size: contenu / facteur,
        unit: ing.unit, pack_price: l.prix,
        vat_rate: ing.vat_rate ?? 0,
        pack_type: "colis", pack_label: null, is_preferred: false,
      });
    }
  }

  // ── Rendu ───────────────────────────────────────────────────────────
  const champ = "w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition";

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto pb-24">
      <div className="mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Achats</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Déposer une facture</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Pour les achats qui n&apos;ont pas eu de bon de commande. Photo ou PDF : les produits, les quantités
          et les prix entrent en stock, et le coût moyen se met à jour.
        </p>
      </div>

      {/* 1. Le fournisseur et le fichier */}
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <label className="block text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Fournisseur</label>
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLignes(null); }} className={champ}>
              <option value="">Choisir…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <label className={clsx(
            "px-4 py-2 text-sm font-medium rounded-xl border transition shrink-0",
            supplierId ? "text-gray-700 border-gray-200 hover:bg-gray-50 cursor-pointer" : "text-gray-300 border-gray-100 cursor-not-allowed",
          )}>
            {fichier ? fichier.name.slice(0, 26) : "Choisir la facture"}
            <input type="file" accept="image/*,application/pdf" className="hidden" disabled={!supplierId}
              onChange={(e) => { setFichier(e.target.files?.[0] ?? null); setLignes(null); setMessage(null); }} />
          </label>
          <button onClick={lire} disabled={!fichier || !supplierId || lecture}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-40 shrink-0">
            {lecture ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            {lecture ? "Lecture…" : "Lire la facture"}
          </button>
        </div>
        {!supplierId && <p className="text-2xs text-gray-400 mt-2">Choisis d&apos;abord le fournisseur : c&apos;est lui qui dit quels noms chercher sur la facture.</p>}
        {message && (
          <p className={clsx("mt-3 text-sm rounded-xl px-3 py-2 border",
            message.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800")}>
            {message.texte}
          </p>
        )}
      </div>

      {lignes && (
        <>
          {/* 2. Le document */}
          <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <FileText size={15} className="text-gray-400" /> La facture
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Numéro</label>
                <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="FA-2026-118" className={champ} />
              </div>
              <div>
                <label className="block text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champ} />
              </div>
              <div>
                <label className="block text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total HT imprimé</label>
                <input type="number" step="0.01" value={totalImprime ?? ""} placeholder="—"
                  onChange={(e) => setTotalImprime(e.target.value === "" ? null : parseFloat(e.target.value))} className={champ} />
                <p className="text-2xs text-gray-400 mt-1">Sert à vérifier que la somme tombe juste.</p>
              </div>
            </div>
          </div>

          {/* 3. Les lignes */}
          <div className="bg-white border border-gray-100 rounded-card shadow-card overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-2xs font-bold text-gray-500 uppercase tracking-wide">
                Ce que la facture dit · ce que ça met en stock
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {lignes.map((l, i) => {
                const ing = l.ingredient_id ? parId.get(l.ingredient_id) : null;
                const contenu = ing ? contenuDuColis(ing) : 0;
                const base = l.qty * contenu;
                const coutBase = base > 0 ? (l.qty * l.prix) / base : 0;
                return (
                  <div key={i} className={clsx("px-5 py-4", l.action !== "stock" && "bg-gray-50/60")}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      {/* La désignation imprimée reste visible : c'est la preuve. */}
                      <p className={clsx("text-sm font-semibold", l.action === "ignorer" ? "text-gray-400 line-through" : "text-gray-900")}>
                        {l.designation}
                      </p>
                      <select value={l.action} onChange={(e) => majLigne(i, { action: e.target.value as LigneFacture["action"] })}
                        className="text-2xs font-bold uppercase tracking-wide px-2 py-1 border border-gray-200 rounded-lg bg-white shrink-0">
                        <option value="stock">Entre en stock</option>
                        <option value="frais">Frais (pas de stock)</option>
                        <option value="ignorer">Ignorer</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      {l.action === "stock" && (
                        <div className="flex-1 min-w-[220px]">
                          <label className="block text-2xs text-gray-400 mb-1">Produit du catalogue</label>
                          <select value={l.ingredient_id ?? ""} onChange={(e) => majLigne(i, { ingredient_id: e.target.value || null })}
                            className={clsx(champ, !l.ingredient_id && "border-amber-300 bg-amber-50")}>
                            <option value="">— à choisir —</option>
                            {groupes.map((g) => (
                              <optgroup key={g.categorie} label={g.categorie}>
                                {g.articles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="w-24">
                        <label className="block text-2xs text-gray-400 mb-1">
                          {l.action === "stock" ? (articlesDuFournisseur.get(l.ingredient_id ?? "")?.pack_type || "colis") : "qté"}
                        </label>
                        <input type="number" min="0" step="any" value={l.qty}
                          onChange={(e) => majLigne(i, { qty: parseFloat(e.target.value) || 0 })} className={champ} />
                      </div>
                      <div className="w-28">
                        <label className="block text-2xs text-gray-400 mb-1">Prix unitaire HT</label>
                        <input type="number" min="0" step="0.01" value={l.prix}
                          onChange={(e) => majLigne(i, { prix: parseFloat(e.target.value) || 0 })} className={champ} />
                      </div>
                      <div className="text-right text-xs text-gray-500 pb-2 ml-auto">
                        {eur(l.qty * l.prix)}
                        {l.action === "stock" && ing && base > 0 && (
                          <span className="block text-2xs text-emerald-600 font-medium">
                            + {base >= 1000 && (ing.unit === "kg" || ing.unit === "l") ? `${(base / 1000).toFixed(2)} ${unitShort(ing.unit)}` : `${base} ${unitShort(ing.unit)}`}
                            {" · "}{eur(perDisplayUnit(coutBase, ing.unit))}/{displayUnitLabel(ing.unit)}
                          </span>
                        )}
                        {l.action === "stock" && ing && base === 0 && (
                          <span className="block text-2xs text-amber-600">conditionnement inconnu</span>
                        )}
                      </div>
                      <button onClick={() => setLignes((p) => (p ? p.filter((_, j) => j !== i) : p))}
                        title="Retirer cette ligne" className="pb-2.5 text-gray-300 hover:text-red-400 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Marchandise</span><span>{eur(plan.totalMarchandise)}</span>
              </div>
              {plan.totalFrais > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Frais</span><span>{eur(plan.totalFrais)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-medium text-gray-700">Total HT</span>
                <span className="text-lg font-semibold text-gray-900">{eur(plan.total)}</span>
              </div>
            </div>
          </div>

          {/* 4. Ce qui cloche, avant d'écrire */}
          {plan.avertissements.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-card p-4 mb-4">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-2">
                <AlertTriangle size={15} /> À vérifier avant de valider
              </p>
              <ul className="space-y-1">
                {plan.avertissements.map((a, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    <b>{a.ligne}</b> — {a.texte}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={valider} disabled={ecriture}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-container transition disabled:opacity-50">
              {ecriture ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {ecriture ? "Enregistrement…" : "Enregistrer et mettre en stock"}
            </button>
            <span className="text-xs text-gray-500">
              {plan.mouvements.length} produit{plan.mouvements.length > 1 ? "s" : ""} entrent en stock · le coût moyen est recalculé au prix facturé.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
