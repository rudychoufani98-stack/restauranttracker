"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search, Trash2, Check, ChevronDown, Copy, Package, Layers, TrendingUp, Archive, RotateCcw , Upload , Hash } from "lucide-react";
import { Card, Button, Input, Select, Modal, Alert, EmptyState } from "@/components/ui";
import clsx from "clsx";
import { useConfirm, useAlert } from "@/components/ConfirmDialog";
import { formatRef, attribueReferences, normaliseRefCaisse, nomDeBloc, TAILLE_BLOC } from "@/lib/references";

// L'interface ne parle que kg / L / pièce (g/ml restent internes).
const UNIT_CHOICES = [
  { value: "kg", label: "kg" },
  { value: "l", label: "L" },
  { value: "unit", label: "pièce" },
];

// 14 allergènes à déclaration obligatoire (règlement UE 1169/2011)
const ALLERGENS = [
  "Gluten", "Crustacés", "Œufs", "Poisson", "Arachides", "Soja", "Lait",
  "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques",
];

// Common EU VAT rates — user can type any value too
const VAT_PRESETS = [
  { label: "0% — Exonéré", value: "0" },
  { label: "5,5% — Produits alimentaires", value: "5.5" },
  { label: "10% — Restauration", value: "10" },
  { label: "20% — Taux normal", value: "20" },
];

type TagInfo = { id: string; name: string; color: string };
type Supplier = { id: string; name: string };
type Ingredient = {
  id: string; name: string; category: string; supplier_id: string | null;
  pack_description: string | null; pack_price: number; pack_quantity: number;
  unit: string; cost_per_base_unit: number; cmup?: number | null; vat_rate: number;
  selling_price: number | null;
  /** Touche de caisse, pour un produit vendu tel quel (un Coca, une bière). */
  pos_ref?: string | null;
  pack_units?: number | null; unit_size?: number | null; yield_pct?: number | null;
  reorder_threshold?: number | null;
  supplier_reference?: string | null;
  allergens?: string[] | null;
  /** Numéro interne : le premier chiffre donne la famille (1xxx viandes, 5xxx épicerie…). */
  internal_ref?: number | null;
  /** Un produit désactivé garde tout son historique mais ne peut plus être ajouté à une recette. */
  is_active?: boolean;
  suppliers?: { name: string } | null;
  ingredient_tags?: { tag_id: string; tags: TagInfo }[];
  ingredient_suppliers?: SupplierRef[];
};

type SupplierRef = {
  id?: string;
  supplier_id: string | null;
  supplier_reference: string | null;
  pack_units: number | null;
  unit_size: number | null;
  unit: string;
  pack_price: number | null;
  vat_rate: number | null;
  pack_type?: string | null;
  pack_label?: string | null;
  is_preferred?: boolean;
  suppliers?: { name: string } | null;
};

// Base conditionnement = how the product is used/counted (kg / L / pièce).
function baseCondText(unit: string): string {
  if (unit === "kg" || unit === "g") return "au kg";
  if (unit === "l" || unit === "ml") return "au litre";
  return "à la pièce";
}

// Editable form row for an alternate supplier
type SupplierLine = {
  id?: string;
  supplier_id: string;
  supplier_reference: string;
  pack_units: string;
  unit_size: string;
  unit: string;
  pack_price: string;
  vat_rate: string;
  // Préservés lors d'une sauvegarde depuis ce modal (édités sur la fiche produit)
  pack_type?: string | null;
  pack_label?: string | null;
  is_preferred?: boolean | null;
};

const EMPTY_FORM = {
  name: "", category: "Légumes/Fruits", supplier_id: "",
  pack_description: "", pack_price: "",
  pack_units: "1", unit_size: "", unit: "kg", supplier_reference: "",
  yield_pct: "100", reorder_threshold: "0", vat_rate: "0", selling_price: "", pos_ref: "",
};

function toBaseUnits(qty: number, unit: string): number {
  return unit === "kg" || unit === "l" ? qty * 1000 : qty;
}

// Total quantity of one purchase pack, in the usage unit (e.g. 6 × 0.75 L = 4.5 L).
function packTotal(packUnits: number, unitSize: number): number {
  return (packUnits || 0) * (unitSize || 0);
}

// GROSS cost per base unit (g/ml/piece) — used for stock valuation. Yield is
// applied later at consumption, not here.
function calcCostPerBase(packPrice: number, packUnits: number, unitSize: number, unit: string): number {
  const totalBase = toBaseUnits(packTotal(packUnits, unitSize), unit);
  if (!totalBase) return 0;
  return packPrice / totalBase;
}

// Friendly display unit: weights → kg, volumes → L, else the unit itself.
function displayUnitLabel(unit: string) {
  return unit === "g" || unit === "kg" ? "kg" : unit === "ml" || unit === "l" ? "L" : unit === "unit" || unit === "piece" ? "pce" : unit;
}

// Convert a per-base-unit cost (€/g or €/ml) to a per-display-unit cost (€/kg or €/L).
function perDisplayUnit(costPerBase: number, unit: string) {
  const isWeightVol = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return isWeightVol ? costPerBase * 1000 : costPerBase;
}

// Quantity base (g/ml) → display (kg/L) and back.
function qtyToDisplay(baseQty: number, unit: string) {
  const wv = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return wv ? baseQty / 1000 : baseQty;
}
function qtyFromDisplay(dispQty: number, unit: string) {
  const wv = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return wv ? dispQty * 1000 : dispQty;
}

function priceTTC(priceHT: number, vatRate: number) {
  return priceHT * (1 + vatRate / 100);
}

interface Props {
  restaurantId: string;
  initialIngredients: Ingredient[];
  suppliers: Supplier[];
  allTags: TagInfo[];
  categories: string[];
  /** Catégories d’achat avec leur bloc de numérotation (references.sql). */
  categoriesRef?: { name: string; ref_start: number | null }[];
}

export default function IngredientsClient({ restaurantId, initialIngredients, suppliers, allTags, categories: CATEGORIES, categoriesRef = [] }: Props) {
  const notify = useAlert();
  const confirm = useConfirm();
  const supabase = createClient();
  const router = useRouter();
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [attribuant, setAttribuant] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterTagId, setFilterTagId] = useState("All");
  // Par défaut on ne montre que les produits actifs : les désactivés sont du passé.
  const [filterState, setFilterState] = useState<"active" | "inactive" | "all">("active");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [supplierLines, setSupplierLines] = useState<SupplierLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Live calculations
  const priceHT = parseFloat(form.pack_price) || 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const packUnits = parseFloat(form.pack_units) || 0;
  const unitSize = parseFloat(form.unit_size) || 0;
  const yieldPct = parseFloat(form.yield_pct) || 100;
  const packQty = packTotal(packUnits, unitSize);
  const priceTTCVal = priceTTC(priceHT, vatRate);
  const previewCostPerBase = priceHT && packQty ? calcCostPerBase(priceHT, packUnits, unitSize, form.unit) : null;
  // Net cost = gross / yield (real cost of an usable base unit, loss included)
  const previewNetCost = previewCostPerBase !== null && yieldPct > 0 ? previewCostPerBase / (yieldPct / 100) : previewCostPerBase;

  const filtered = useMemo(() =>
    ingredients.filter((i) => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || i.category === filterCategory;
      const matchTag = filterTagId === "All" || (i.ingredient_tags ?? []).some((it) => it.tag_id === filterTagId);
      const active = i.is_active !== false;
      const matchState = filterState === "all" || (filterState === "active" ? active : !active);
      return matchSearch && matchCat && matchTag && matchState;
    }), [ingredients, search, filterCategory, filterTagId, filterState]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category: CATEGORIES[0] ?? EMPTY_FORM.category });
    setSelectedTagIds([]);
    setSelectedAllergens([]);
    setSupplierLines([]);
    setShowAdvanced(false);
    setError(null);
    setShowForm(true);
  }

  function openEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setForm({
      name: ing.name, category: ing.category, supplier_id: ing.supplier_id ?? "",
      pack_description: ing.pack_description ?? "", pack_price: String(ing.pack_price),
      pack_units: String(ing.pack_units ?? 1),
      unit_size: String(ing.unit_size ?? ing.pack_quantity ?? ""),
      unit: ing.unit,
      yield_pct: String(ing.yield_pct ?? 100),
      reorder_threshold: String(qtyToDisplay(Number(ing.reorder_threshold ?? 0), ing.unit)),
      supplier_reference: ing.supplier_reference ?? "",
      vat_rate: String(ing.vat_rate ?? 0),
      selling_price: ing.selling_price != null ? String(ing.selling_price) : "",
      pos_ref: ing.pos_ref ?? "",
    });
    setSupplierLines((ing.ingredient_suppliers ?? []).map((s) => ({
      id: s.id,
      supplier_id: s.supplier_id ?? "",
      supplier_reference: s.supplier_reference ?? "",
      pack_units: String(s.pack_units ?? 1),
      unit_size: String(s.unit_size ?? ""),
      unit: s.unit ?? ing.unit,
      pack_price: String(s.pack_price ?? ""),
      vat_rate: String(s.vat_rate ?? 0),
      pack_type: (s as any).pack_type ?? null,
      pack_label: (s as any).pack_label ?? null,
      is_preferred: (s as any).is_preferred ?? null,
    })));
    setSelectedTagIds((ing.ingredient_tags ?? []).map((it) => it.tag_id));
    setSelectedAllergens(ing.allergens ?? []);
    // Open advanced section if any advanced field is set
    setShowAdvanced(
      Number(ing.yield_pct ?? 100) < 100 ||
      Number(ing.reorder_threshold ?? 0) > 0 ||
      ing.selling_price != null ||
      (ing.ingredient_tags ?? []).length > 0
    );
    setError(null);
    setShowForm(true);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  function toggleAllergen(a: string) {
    setSelectedAllergens((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }

  function addSupplierLine() {
    setSupplierLines((prev) => [...prev, {
      supplier_id: "", supplier_reference: "", pack_units: "1",
      unit_size: form.unit_size || "", unit: form.unit, pack_price: "", vat_rate: form.vat_rate,
    }]);
  }
  function updateSupplierLine(idx: number, field: keyof SupplierLine, value: string) {
    setSupplierLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function removeSupplierLine(idx: number) {
    setSupplierLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setError(null);
    const price = parseFloat(form.pack_price);
    const pUnits = parseFloat(form.pack_units);
    const uSize = parseFloat(form.unit_size);
    const yld = parseFloat(form.yield_pct);
    const vat = parseFloat(form.vat_rate) || 0;
    if (!form.name.trim()) return setError("Le nom est requis.");
    if (isNaN(price) || price < 0) return setError("Saisissez un prix d'achat HT valide.");
    if (isNaN(pUnits) || pUnits <= 0) return setError("Le nombre d'unités par colis doit être supérieur à 0.");
    if (isNaN(uSize) || uSize <= 0) return setError("La contenance par unité doit être supérieure à 0.");
    if (isNaN(yld) || yld <= 0 || yld > 100) return setError("Le rendement doit être entre 1 et 100 %.");
    // Ces deux champs alimentent la marge et l'alerte de stock : une valeur
    // négative passait silencieusement (min="0" n'est pas contraignant ici).
    if (form.selling_price !== "" && !(parseFloat(form.selling_price) >= 0)) return setError("Le prix de vente doit être un nombre positif.");
    if (form.reorder_threshold !== "" && !(parseFloat(form.reorder_threshold) >= 0)) return setError("Le seuil d'alerte doit être un nombre positif.");
    setSaving(true);

    // Ancien produit en g/ml passé en kg/L : tailles saisies en g/ml → ÷1000
    // (même garde que la fiche produit).
    const oldIng = editingId ? ingredients.find((i) => i.id === editingId) : null;
    const legacyRescale = oldIng && ((oldIng.unit === "g" && form.unit === "kg") || (oldIng.unit === "ml" && form.unit === "l")) ? 1000 : 1;
    const uSizeR = uSize / legacyRescale;

    const qty = packTotal(pUnits, uSizeR); // total du colis, dans l'unité d'usage
    // Coût de référence = l'article LE MOINS CHER (colis principal + autres
    // fournisseurs) — même règle que la fiche produit, pour ne pas stocker
    // deux valeurs différentes selon l'écran qui a sauvegardé en dernier.
    let cost_per_base_unit = calcCostPerBase(price, pUnits, uSizeR, form.unit);
    for (const l of supplierLines) {
      const p2 = parseFloat(l.pack_price) || 0;
      const s2 = (parseFloat(l.unit_size) || 0) / legacyRescale;
      if (p2 > 0 && s2 > 0) {
        const c = calcCostPerBase(p2, parseFloat(l.pack_units) || 1, s2, form.unit);
        if (c > 0 && (cost_per_base_unit <= 0 || c < cost_per_base_unit)) cost_per_base_unit = c;
      }
    }
    const selling = form.selling_price !== "" ? parseFloat(form.selling_price) : null;
    const payload = {
      name: form.name.trim(), category: form.category,
      supplier_id: form.supplier_id || null,
      pack_description: form.pack_description || null,
      pack_price: price, pack_quantity: qty, unit: form.unit,
      pack_units: pUnits, unit_size: uSizeR, yield_pct: yld,
      reorder_threshold: qtyFromDisplay(parseFloat(form.reorder_threshold) || 0, form.unit),
      supplier_reference: form.supplier_reference || null,
      cost_per_base_unit, vat_rate: vat,
      selling_price: selling,
      // Une touche de caisse n'a de sens que pour un produit revendu tel
      // quel : on ne la garde pas sur un ingrédient de recette.
      pos_ref: selling != null ? (normaliseRefCaisse(form.pos_ref) || null) : null,
      allergens: selectedAllergens,
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };

    let ingredientId = editingId;

    if (editingId) {
      const old = ingredients.find((i) => i.id === editingId);
      const { data, error: err } = await supabase
        .from("ingredients").update(payload).eq("id", editingId)
        .select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      if (old && Math.abs(old.pack_price - price) > 0.0001) {
        await supabase.from("ingredient_price_history").insert({
          ingredient_id: editingId, old_price: old.pack_price, new_price: price, source: "manual",
        });
      }
      // Update tags: delete all then re-insert
      await supabase.from("ingredient_tags").delete().eq("ingredient_id", editingId);
      if (selectedTagIds.length > 0) {
        await supabase.from("ingredient_tags").insert(
          selectedTagIds.map((tag_id) => ({ ingredient_id: editingId, tag_id }))
        );
      }
      // Re-fetch with tags
      const { data: withTags } = await supabase
        .from("ingredients")
        .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color))")
        .eq("id", editingId).single();
      setIngredients((p) => p.map((i) => i.id === editingId ? (withTags ?? data) : i));
    } else {
      const { data, error: err } = await supabase
        .from("ingredients").insert(payload)
        .select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      ingredientId = data.id;
      await supabase.from("ingredient_price_history").insert({
        ingredient_id: data.id, old_price: null, new_price: price, source: "manual",
      });
      if (selectedTagIds.length > 0) {
        await supabase.from("ingredient_tags").insert(
          selectedTagIds.map((tag_id) => ({ ingredient_id: ingredientId, tag_id }))
        );
      }
      const { data: withTags } = await supabase
        .from("ingredients")
        .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color))")
        .eq("id", data.id).single();
      setIngredients((p) => [...p, withTags ?? data]);
    }

    // Sync alternate suppliers (delete all + re-insert)
    if (ingredientId) {
      // Sauvegarde de l'existant : un échec d'insertion effacerait sinon tous
      // les prix fournisseurs sans que rien ne l'indique.
      const { data: beforeArts } = await supabase
        .from("ingredient_suppliers").select("*").eq("ingredient_id", ingredientId);
      const { error: delArtErr } = await supabase.from("ingredient_suppliers").delete().eq("ingredient_id", ingredientId);
      if (delArtErr) {
        setError(`Mise à jour des fournisseurs impossible : ${delArtErr.message}`);
        setSaving(false); return;
      }
      const rows = supplierLines
        .filter((l) => l.supplier_id)
        .map((l) => ({
          ingredient_id: ingredientId,
          supplier_id: l.supplier_id,
          supplier_reference: l.supplier_reference || null,
          pack_units: parseFloat(l.pack_units) || 1,
          unit_size: (parseFloat(l.unit_size) || 1) / legacyRescale,
          // Toujours l'unité du PRODUIT : un article en « kg » sur un produit
          // en « pièce » fausserait la conversion à la réception (×1000).
          unit: form.unit,
          pack_price: parseFloat(l.pack_price) || 0,
          vat_rate: parseFloat(l.vat_rate) || 0,
          // Préservés (édités sur la fiche produit, pas dans ce modal)
          pack_type: l.pack_type ?? null,
          pack_label: l.pack_label ?? null,
          is_preferred: l.is_preferred ?? false,
        }));
      if (rows.length > 0) {
        const { error: insArtErr } = await supabase.from("ingredient_suppliers").insert(rows);
        if (insArtErr) {
          if ((beforeArts ?? []).length > 0) await supabase.from("ingredient_suppliers").insert(beforeArts!);
          setError(`Enregistrement des fournisseurs impossible : ${insArtErr.message}. La version précédente a été rétablie.`);
          setSaving(false); return;
        }
      }

      // Refetch full ingredient so the list reflects everything
      const { data: full } = await supabase
        .from("ingredients")
        .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color)), ingredient_suppliers(*, suppliers(name))")
        .eq("id", ingredientId).single();
      if (full) setIngredients((p) => p.map((i) => i.id === ingredientId ? full : i));
    }

    // Le coût des recettes dépend des prix d'achat : recalcul serveur, sinon
    // le food cost affiché resterait celui d'avant la modification.
    let recalcOk = true;
    try {
      const res = await fetch("/api/recalculate-recipes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      recalcOk = res.ok;
    } catch { recalcOk = false; }

    setSaving(false);
    setShowForm(false);
    if (!recalcOk) {
      notify("Produit enregistré, mais le recalcul des coûts de recettes a échoué. Lance « Tout recalculer » depuis les recettes.");
    }
    router.refresh();
  }

  // Un produit ne se supprime pas : il se désactive. Le supprimer effacerait
  // son historique d'achat et ses mouvements de stock, et casserait les fiches
  // techniques qui l'utilisent. Désactiver garde tout, et le rend simplement
  // inutilisable dans les nouvelles recettes et mises en place.
  async function handleToggleActive(id: string) {
    const ing = ingredients.find((i) => i.id === id);
    if (!ing) return;
    const name = ing.name;
    const active = ing.is_active !== false;

    if (active) {
      if (!(await confirm({
        title: `Désactiver « ${name} » ?`,
        consequences: [
          "Il ne pourra plus être ajouté à une recette ou une mise en place.",
          "Les fiches qui l'utilisent déjà continuent de fonctionner, mais seront signalées.",
          "Son historique d'achat, son stock et ses mouvements sont conservés.",
          "Réversible à tout moment : tu peux le réactiver d'un clic.",
        ],
        confirmLabel: "Désactiver",
        tone: "default",
      }))) return;
    }

    setDeletingId(id);
    const { error } = await supabase.from("ingredients").update({ is_active: !active }).eq("id", id);
    setDeletingId(null);
    if (error) {
      notify(`Changement d'état impossible : ${error.message}`);
      return;
    }
    setIngredients((p) => p.map((i) => (i.id === id ? { ...i, is_active: !active } : i)));
  }

  // ── Numérotation interne ──────────────────────────────────────────
  // Attribue un numéro aux produits qui n'en ont pas encore. Les produits
  // déjà numérotés ne sont JAMAIS touchés : leur référence est imprimée sur
  // des étiquettes de bac et recopiée sur des bons de commande.
  async function attribuerReferences() {
    const cats = categoriesRef.length > 0
      ? categoriesRef
      : CATEGORIES.map((name) => ({ name, ref_start: null }));

    const { attributions, refuses, plages } = attribueReferences(
      ingredients.map((i) => ({ id: i.id, name: i.name, category: i.category, internal_ref: i.internal_ref })),
      cats,
    );

    if (attributions.length === 0) {
      notify(
        refuses.length > 0
          ? `Aucun numéro attribué.\n\n${refuses.map((r) => `• ${r.nom} — ${r.raison}`).join("\n")}`
          : "Tous tes produits ont déjà un numéro interne.",
      );
      return;
    }

    // On montre les blocs utilisés AVANT d'écrire : c'est la seule occasion
    // de dire non à un rangement qui ne correspondrait pas à sa cuisine.
    //
    // On groupe par BLOC REELLEMENT retenu, pas par catégorie : un produit
    // rangé dans « Autre » est classé par son nom, et l'ancien récapitulatif
    // annonçait « Autre : 75 produits » alors qu'ils partaient en viandes,
    // légumes et épicerie. Il faut montrer ce qui va vraiment se passer.
    const parBloc = new Map<number, { n: number; exemples: string[] }>();
    for (const a of attributions) {
      const e = parBloc.get(a.bloc) ?? { n: 0, exemples: [] };
      e.n += 1;
      if (e.exemples.length < 2) e.exemples.push(a.nom);
      parBloc.set(a.bloc, e);
    }
    const detail = Array.from(parBloc.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bloc, { n, exemples }]) => {
        const nom = nomDeBloc(bloc)
          ?? Array.from(plages.entries()).find(([, b]) => b === bloc)?.[0]
          ?? "Sans famille";
        return `${formatRef(bloc)} — ${nom} : ${n} produit${n !== 1 ? "s" : ""} (${exemples.join(", ")}…)`;
      });

    const ok = await confirm({
      title: `Numéroter ${attributions.length} produit${attributions.length !== 1 ? "s" : ""} ?`,
      message:
        `Le premier chiffre donne la famille, ${TAILLE_BLOC} numéros par catégorie :\n\n` +
        detail.join("\n") +
        (refuses.length > 0 ? `\n\nNon numérotés :\n${refuses.map((r) => `• ${r.nom} — ${r.raison}`).join("\n")}` : ""),
      consequences: [
        "Les produits qui ont déjà un numéro ne sont pas touchés.",
        "Un numéro attribué ne change plus, même si tu changes la catégorie du produit.",
      ],
      confirmLabel: "Numéroter",
      tone: "default",
    });
    if (!ok) return;

    setAttribuant(true);
    const faits: string[] = [];
    for (const a of attributions) {
      const { error } = await supabase.from("ingredients").update({ internal_ref: a.ref }).eq("id", a.id);
      if (error) {
        setAttribuant(false);
        notify(
          `Numérotation interrompue sur « ${a.nom} » : ${error.message}\n\n` +
          `${faits.length} produit${faits.length !== 1 ? "s ont" : " a"} été numéroté${faits.length !== 1 ? "s" : ""} avant l'arrêt — relance pour continuer.`,
        );
        setIngredients((prev) => prev.map((i) => {
          const f = attributions.find((x) => x.id === i.id && faits.includes(x.id));
          return f ? { ...i, internal_ref: f.ref } : i;
        }));
        return;
      }
      faits.push(a.id);
    }

    setIngredients((prev) => prev.map((i) => {
      const a = attributions.find((x) => x.id === i.id);
      return a ? { ...i, internal_ref: a.ref } : i;
    }));
    setAttribuant(false);
    router.refresh();
  }

  // Deux articles ne peuvent pas partager une touche de caisse : la vente
  // serait imputée au mauvais produit.
  const toucheDejaPrise = (() => {
    const t = normaliseRefCaisse(form.pos_ref);
    if (!t) return false;
    return ingredients.some((i) => i.id !== editingId && normaliseRefCaisse(i.pos_ref ?? "") === t);
  })();

  async function handleDuplicate(ing: Ingredient) {
    setDuplicatingId(ing.id);
    const payload = {
      restaurant_id: restaurantId,
      name: `${ing.name} (copie)`,
      category: ing.category,
      supplier_id: ing.supplier_id ?? null,
      pack_description: ing.pack_description ?? null,
      pack_price: ing.pack_price,
      pack_quantity: ing.pack_quantity,
      unit: ing.unit,
      cost_per_base_unit: ing.cost_per_base_unit,
      vat_rate: ing.vat_rate ?? 0,
      selling_price: ing.selling_price ?? null,
      pack_units: ing.pack_units ?? 1,
      // Ancien produit sans unit_size : la taille vit dans pack_quantity
      unit_size: ing.unit_size ?? ing.pack_quantity ?? 1,
      yield_pct: ing.yield_pct ?? 100,
      reorder_threshold: ing.reorder_threshold ?? 0,
      supplier_reference: ing.supplier_reference ?? null,
      allergens: ing.allergens ?? [],
    };
    const { data: created, error: err } = await supabase
      .from("ingredients").insert(payload).select("*, suppliers(name)").single();
    if (err || !created) {
      setDuplicatingId(null);
      notify(`Duplication impossible : ${err?.message ?? "réessaie."}`);
      return;
    }

    // Copie des articles fournisseurs
    const arts = (ing.ingredient_suppliers ?? []).map((a) => ({
      ingredient_id: created.id,
      supplier_id: a.supplier_id ?? null,
      supplier_reference: a.supplier_reference ?? null,
      pack_units: a.pack_units ?? 1,
      unit_size: a.unit_size ?? 1,
      unit: a.unit,
      pack_price: a.pack_price ?? 0,
      vat_rate: a.vat_rate ?? 0,
      pack_type: a.pack_type ?? "colis",
      pack_label: a.pack_label ?? null,
      is_preferred: a.is_preferred ?? false,
    }));
    if (arts.length > 0) await supabase.from("ingredient_suppliers").insert(arts);

    // Copie des tags
    const tagIds = (ing.ingredient_tags ?? []).map((it) => it.tag_id);
    if (tagIds.length > 0) {
      await supabase.from("ingredient_tags").insert(tagIds.map((tag_id) => ({ ingredient_id: created.id, tag_id })));
    }

    const { data: full } = await supabase
      .from("ingredients")
      .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color)), ingredient_suppliers(*, suppliers(name))")
      .eq("id", created.id).single();
    setIngredients((p) => [...p, full ?? created]);
    setDuplicatingId(null);
  }

  // ── Read-only summary stats, all derived from the live ingredients list ──
  const categoriesUsed = new Set(ingredients.map((i) => i.category)).size;
  const resaleCount = ingredients.filter((i) => i.selling_price != null).length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Catalogue</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Ingrédients</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">
            {ingredients.length} ingrédient{ingredients.length !== 1 ? "s" : ""} dans votre bibliothèque
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={attribuerReferences}
            disabled={attribuant}
            title="Donner un numéro interne aux produits qui n’en ont pas encore"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition disabled:opacity-50">
            <Hash size={15} /> {attribuant ? "Numérotation…" : "Numéroter"}
          </button>
          <Link href="/ingredients/import"
            title="Importer une liste de produits depuis Excel ou CSV"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition">
            <Upload size={15} /> Importer
          </Link>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg hover:nav-active-glow active:scale-[0.98]">
            <Plus size={15} /> Ajouter un ingrédient
          </button>
        </div>
      </div>

      {/* Summary stats — all derived from live ingredients */}
      {ingredients.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Ingrédients</span>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Package size={18} /></div>
            </div>
            <div>
              <h3 className="text-2xl font-extrabold text-primary tabular-nums">{ingredients.length}</h3>
              <p className="text-2xs text-on-surface-variant/60 mt-1">dans votre bibliothèque</p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Catégories</span>
              <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-secondary"><Layers size={18} /></div>
            </div>
            <div>
              <h3 className="text-2xl font-extrabold text-on-surface tabular-nums">{categoriesUsed}</h3>
              <p className="text-2xs text-on-surface-variant/60 mt-1">catégorie{categoriesUsed !== 1 ? "s" : ""} utilisée{categoriesUsed !== 1 ? "s" : ""}</p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Revente directe</span>
              <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary-container"><TrendingUp size={18} /></div>
            </div>
            <div>
              <h3 className="text-2xl font-extrabold text-on-surface tabular-nums">{resaleCount}</h3>
              <p className="text-2xs text-on-surface-variant/60 mt-1">produit{resaleCount !== 1 ? "s" : ""} avec prix de vente</p>
            </div>
          </div>
        </section>
      )}

      {/* Filters — glass bar */}
      <div className="glass-card rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un ingrédient…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40 text-on-surface" />
        </div>
        {/* Actifs / inactifs — les désactivés sont masqués par défaut. */}
        <div className="flex rounded-xl bg-surface-container-low p-1 gap-0.5">
          {([
            { key: "active", label: "Actifs", n: ingredients.filter((i) => i.is_active !== false).length },
            { key: "inactive", label: "Inactifs", n: ingredients.filter((i) => i.is_active === false).length },
            { key: "all", label: "Tous", n: ingredients.length },
          ] as const).map((o) => (
            <button key={o.key} onClick={() => setFilterState(o.key)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-2xs font-bold uppercase tracking-wider transition",
                filterState === o.key ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant/60 hover:bg-surface-container",
              )}>
              {o.label} <span className="tabular-nums opacity-70">{o.n}</span>
            </button>
          ))}
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-surface-container-low border-none rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 text-on-surface-variant cursor-pointer">
          <option value="All">Toutes les catégories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={filterTagId} onChange={(e) => setFilterTagId(e.target.value)}
            className="bg-surface-container-low border-none rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 text-on-surface-variant cursor-pointer">
            <option value="All">Tous les tags</option>
            {allTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <Modal
          title={editingId ? "Modifier l'ingrédient" : "Ajouter un ingrédient"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowForm(false)} className="flex-1 justify-center">Annuler</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving} className="flex-1 justify-center">
                {saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Ajouter"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert>{error}</Alert>}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ex. Huile d'olive" className="col-span-2" />

              <Select label="Catégorie" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Array.from(new Set([...CATEGORIES, form.category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
              </Select>

              <Select label="Fournisseur principal" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Sans fournisseur</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>

              <Input label="Référence fournisseur (code article)" value={form.supplier_reference}
                onChange={(e) => setForm({ ...form, supplier_reference: e.target.value })}
                placeholder="ex. BAVFLA2 — apparaît sur le bon de commande" className="col-span-2" />
            </div>

            {/* Comment tu l'achètes — bloc unique et simple */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Comment tu l&apos;achètes</p>
                <p className="text-xs text-gray-500 mt-0.5">Décris un colis tel qu&apos;il arrive de ton fournisseur, et son prix.</p>
              </div>

              {/* Le colis, écrit comme une phrase */}
              <div className="flex flex-wrap items-end gap-2">
                <span className="text-sm text-gray-500 pb-2">1 colis =</span>
                <div>
                  <label className="block text-2xs text-gray-400 mb-1">Nombre d&apos;unités</label>
                  <input type="number" min="1" step="any" value={form.pack_units}
                    onChange={(e) => setForm({ ...form, pack_units: e.target.value })}
                    placeholder="6"
                    className="w-24 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
                </div>
                <span className="text-gray-400 pb-2.5 text-base">×</span>
                <div>
                  <label className="block text-2xs text-gray-400 mb-1">Contenance</label>
                  <input type="number" min="0" step="any" value={form.unit_size}
                    onChange={(e) => setForm({ ...form, unit_size: e.target.value })}
                    placeholder="0,75"
                    className="w-24 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
                </div>
                <div>
                  <label className="block text-2xs text-gray-400 mb-1">en</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary transition">
                    {UNIT_CHOICES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Ex. : 6 bouteilles de 0,75 L → <b>6</b> × <b>0,75</b> <b>l</b>. &nbsp;·&nbsp; Un sac de 5 kg → <b>1</b> × <b>5</b> <b>kg</b>.
              </p>

              {/* Prix */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix payé (HT)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input type="number" min="0" step="0.01" value={form.pack_price}
                      onChange={(e) => setForm({ ...form, pack_price: e.target.value })}
                      placeholder="0.00"
                      className="w-full pl-6 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
                  </div>
                  <p className="text-2xs text-gray-400 mt-1">pour 1 colis entier</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">TVA</label>
                  <select value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary transition">
                    {VAT_PRESETS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix TTC</label>
                  <div className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 font-medium">
                    €{priceTTCVal.toFixed(2)}
                  </div>
                  <p className="text-2xs text-gray-400 mt-1">calculé tout seul</p>
                </div>
              </div>

              {/* Récap en français clair */}
              {previewCostPerBase !== null && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <Check size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-emerald-800 leading-snug">
                    1 colis = <b>{Number((packQty || 0).toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} {form.unit === "unit" ? "pièce" : form.unit === "l" ? "L" : form.unit}</b> · ça te revient à{" "}
                    <b>€{perDisplayUnit(previewNetCost ?? 0, form.unit).toFixed(2)}/{displayUnitLabel(form.unit)}</b>
                    {yieldPct < 100 && <span className="text-emerald-600"> (perte incluse)</span>}
                  </p>
                </div>
              )}

              {/* Options avancées */}
              <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1 pt-1">
                <ChevronDown size={13} className={clsx("transition", showAdvanced && "rotate-180")} />
                Options avancées — perte matière & alerte stock
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Part réellement utilisable</label>
                    <div className="relative">
                      <input type="number" min="1" max="100" step="any" value={form.yield_pct}
                        onChange={(e) => setForm({ ...form, yield_pct: e.target.value })}
                        placeholder="100"
                        className="w-full pr-7 pl-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                    <p className="text-2xs text-gray-400 mt-1">après épluchage/parage. 100 = tout est utilisé</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">M&apos;alerter si le stock descend sous</label>
                    <div className="relative">
                      <input type="number" min="0" step="any" value={form.reorder_threshold}
                        onChange={(e) => setForm({ ...form, reorder_threshold: e.target.value })}
                        placeholder="0"
                        className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{displayUnitLabel(form.unit)}</span>
                    </div>
                    <p className="text-2xs text-gray-400 mt-1">affiche « à commander » dans l&apos;inventaire</p>
                  </div>
                </div>
              )}
            </div>

            {/* Autres fournisseurs pour ce produit (références multiples) */}
            <div className="rounded-lg p-4 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Autres fournisseurs</p>
                  <p className="text-xs text-gray-500 mt-0.5">Même produit, autre fournisseur : son prix et sa référence (pour les bons de commande).</p>
                </div>
                <button type="button" onClick={addSupplierLine}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 shrink-0">
                  <Plus size={13} /> Ajouter
                </button>
              </div>

              {supplierLines.length === 0 ? (
                <p className="text-xs text-gray-400">Aucun autre fournisseur. Le coût des recettes suit toujours le prix réellement payé (CMUP).</p>
              ) : (
                <div className="space-y-2.5">
                  {supplierLines.map((line, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-gray-50/50">
                      <div className="flex gap-2">
                        <select value={line.supplier_id} onChange={(e) => updateSupplierLine(idx, "supplier_id", e.target.value)}
                          className="flex-1 px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary transition">
                          <option value="">Choisir un fournisseur…</option>
                          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button type="button" onClick={() => removeSupplierLine(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input value={line.supplier_reference} onChange={(e) => updateSupplierLine(idx, "supplier_reference", e.target.value)}
                          placeholder="Référence / code article"
                          className="flex-1 px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary transition" />
                        <div className="relative w-28">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                          <input type="number" min="0" step="0.01" value={line.pack_price} onChange={(e) => updateSupplierLine(idx, "pack_price", e.target.value)}
                            placeholder="prix HT"
                            className="w-full pl-5 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary transition" />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span>1 colis =</span>
                        <input type="number" min="1" step="any" value={line.pack_units} onChange={(e) => updateSupplierLine(idx, "pack_units", e.target.value)}
                          className="w-14 px-2 py-1 text-xs bg-white border border-gray-200 rounded outline-none focus:border-primary transition" />
                        <span>×</span>
                        <input type="number" min="0" step="any" value={line.unit_size} onChange={(e) => updateSupplierLine(idx, "unit_size", e.target.value)}
                          className="w-16 px-2 py-1 text-xs bg-white border border-gray-200 rounded outline-none focus:border-primary transition" />
                        {/* L'unité est celle du produit — pas de mélange kg/pièce entre articles */}
                        <span className="font-medium text-gray-600">{UNIT_CHOICES.find((u) => u.value === form.unit)?.label ?? form.unit}</span>
                        {parseFloat(line.pack_price) > 0 && parseFloat(line.unit_size) > 0 && (
                          <span className="ml-auto text-green font-medium">
                            €{perDisplayUnit(calcCostPerBase(parseFloat(line.pack_price), parseFloat(line.pack_units) || 1, parseFloat(line.unit_size), form.unit), form.unit).toFixed(2)}/{displayUnitLabel(form.unit)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prix de vente (produit revendu directement) */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-2 border border-blue-100">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Revente directe (optionnel)</p>
              <p className="text-xs text-blue-500">Remplissez si ce produit est revendu tel quel (canette, bouteille…). Laissez vide pour les ingrédients de recettes.</p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix de vente TTC (€)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input type="number" min="0" step="0.01" value={form.selling_price}
                      onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                      placeholder="ex. 2.00"
                      className="w-full pl-6 pr-3 py-2 text-sm bg-white border border-blue-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition" />
                  </div>
                  {form.selling_price !== "" && (
                    <>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5 mt-3">Référence de caisse</label>
                      <input
                        value={form.pos_ref}
                        onChange={(e) => setForm({ ...form, pos_ref: e.target.value })}
                        placeholder="ex. BOI04"
                        className="w-full px-3 py-2 text-sm bg-white border border-blue-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition" />
                      <p className="text-xs text-blue-500 mt-1">
                        Le code de la touche qui vend ce produit sur ta caisse.
                      </p>
                      {toucheDejaPrise && (
                        <p className="text-xs text-red-600 mt-1">
                          Cette touche est déjà utilisée par un autre produit — deux articles ne peuvent pas partager la même.
                        </p>
                      )}
                    </>
                  )}
                </div>
                {form.selling_price && parseFloat(form.selling_price) > 0 && priceHT > 0 && (
                  <div className="px-3 py-2.5 bg-white border border-blue-200 rounded-lg">
                    <p className="text-xs text-gray-400">Marge unitaire</p>
                    <p className="text-sm font-semibold text-emerald-600">
                      {/* prix de vente à la pièce − coût unitaire (jamais le prix du colis entier) */}
                      €{(parseFloat(form.selling_price) - (previewNetCost !== null ? perDisplayUnit(previewNetCost, form.unit) : 0)).toFixed(2)}
                      <span className="text-xs text-gray-400 font-normal ml-1">
                        ({parseFloat(form.selling_price) > 0 ? (((parseFloat(form.selling_price) - (previewNetCost !== null ? perDisplayUnit(previewNetCost, form.unit) : 0)) / parseFloat(form.selling_price)) * 100).toFixed(0) : 0}%)
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Allergènes */}
            <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Allergènes</p>
              <p className="text-xs text-amber-600 mb-3">14 allergènes réglementaires UE. Les recettes hériteront automatiquement de ceux-ci.</p>
              <div className="flex flex-wrap gap-1.5">
                {ALLERGENS.map((a) => {
                  const on = selectedAllergens.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAllergen(a)}
                      className={clsx(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition",
                        on
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white text-gray-600 border-gray-200 hover:border-amber-300"
                      )}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags section */}
            {allTags.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Tags ingrédient</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTagDropdown((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition"
                  >
                    <div className="flex flex-wrap gap-1.5 min-h-[22px]">
                      {selectedTagIds.length === 0 ? (
                        <span className="text-gray-400">Choisir des tags…</span>
                      ) : (
                        selectedTagIds.map((id) => {
                          const tag = allTags.find((t) => t.id === id);
                          if (!tag) return null;
                          return (
                            <span key={id} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: tag.color }}>
                              {tag.name}
                            </span>
                          );
                        })
                      )}
                    </div>
                    <ChevronDown size={14} className="text-gray-400 shrink-0 ml-2" />
                  </button>

                  {showTagDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-modal z-10 py-1 max-h-48 overflow-y-auto">
                      {allTags.map((tag) => {
                        const selected = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => { toggleTag(tag.id); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition text-left"
                          >
                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition",
                              selected ? "border-transparent" : "border-gray-300")}
                              style={selected ? { backgroundColor: tag.color } : {}}>
                              {selected && <Check size={10} className="text-white" />}
                            </div>
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                            <span className="text-sm text-gray-700">{tag.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {showTagDropdown && (
                  <div className="fixed inset-0 z-[9]" onClick={() => setShowTagDropdown(false)} />
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="🥦"
            title={ingredients.length === 0 ? "Aucun ingrédient" : "Aucun résultat"}
            description={ingredients.length === 0
              ? "Ajoutez votre premier ingrédient pour commencer à construire des recettes et suivre vos coûts."
              : "Essayez de modifier votre recherche ou vos filtres."}
            action={ingredients.length === 0
              ? <Button variant="primary" onClick={openAdd}><Plus size={14} /> Ajouter le premier ingrédient</Button>
              : undefined}
          />
        </Card>
      ) : (
        <>
          {/* Main catalogue table (glass) */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                  <tr>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60" title="Numéro interne : le premier chiffre donne la famille">Réf.</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Nom</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Catégorie</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Tags</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Conditionnement</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix HT</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">TVA</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix TTC</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Coût / kg · L · pce</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix vente</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Marge</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Fournisseur</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filtered.map((ing) => {
                    const ttc = priceTTC(ing.pack_price, ing.vat_rate ?? 0);
                    const tags = (ing.ingredient_tags ?? []).map((it) => it.tags).filter(Boolean);
                    return (
                      <tr key={ing.id}
                        className={clsx(
                          "group cursor-pointer transition-colors hover:bg-surface-container-low/40",
                          ing.is_active === false && "opacity-55",
                        )}
                        onClick={() => router.push(`/ingredients/${ing.id}`)}>
                        <td className="px-5 py-4 tabular-nums text-2xs font-bold text-on-surface-variant/60 whitespace-nowrap">
                          {formatRef(ing.internal_ref)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-tertiary-fixed flex items-center justify-center text-primary shrink-0">
                              <Package size={15} />
                            </div>
                            <Link href={`/ingredients/${ing.id}`} onClick={(e) => e.stopPropagation()}
                              className="font-semibold text-primary hover:text-primary-container transition whitespace-nowrap">
                              {ing.name}
                            </Link>
                            {ing.is_active === false && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-light text-amber-dark text-2xs font-bold uppercase tracking-wide shrink-0">
                                <Archive size={10} /> Inactif
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-2xs font-bold uppercase tracking-wide">
                            {ing.category}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-1">
                            {tags.length > 0
                              ? tags.map((tag) => (
                                  <span key={tag.id} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                                    style={{ backgroundColor: tag.color }}>
                                    {tag.name}
                                  </span>
                                ))
                              : <span className="text-on-surface-variant/30 text-xs">—</span>}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-on-surface-variant/70">
                          {baseCondText(ing.unit)}
                          {(ing.yield_pct ?? 100) < 100 && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-light text-amber-dark text-2xs font-medium">rdt {ing.yield_pct}%</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right text-sm text-on-surface-variant/80 tabular-nums">€{Number(ing.pack_price).toFixed(2)}</td>
                        <td className="px-5 py-4 text-right text-sm text-on-surface-variant/60 tabular-nums">{ing.vat_rate ?? 0}%</td>
                        <td className="px-5 py-4 text-right text-sm text-on-surface-variant/80 tabular-nums">€{ttc.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right tabular-nums">
                          {(() => {
                            const y = Number(ing.yield_pct ?? 100);
                            const netBase = y > 0 ? Number(ing.cost_per_base_unit) / (y / 100) : Number(ing.cost_per_base_unit);
                            const net = perDisplayUnit(netBase, ing.unit);
                            const gross = perDisplayUnit(Number(ing.cost_per_base_unit), ing.unit);
                            return (
                              <span className="font-semibold text-primary">
                                €{net.toFixed(2)}/{displayUnitLabel(ing.unit)}
                                {y < 100 && <span className="block text-2xs text-on-surface-variant/40 font-normal">brut €{gross.toFixed(2)}</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-4 text-right text-sm tabular-nums">
                          {ing.selling_price != null
                            ? <span className="text-on-surface-variant/80">€{Number(ing.selling_price).toFixed(2)}</span>
                            : <span className="text-on-surface-variant/30 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-4 text-right text-sm tabular-nums">
                          {ing.selling_price != null
                            ? (() => {
                                // Marge à l'unité vendue : prix de vente − CMUP (coût moyen réel
                                // du stock), même base que Caisse / Ventes & marges / dashboard.
                                const unitCost = perDisplayUnit(Number(ing.cmup ?? ing.cost_per_base_unit ?? 0), ing.unit);
                                const marge = ing.selling_price - unitCost;
                                const pct = ing.selling_price > 0 ? (marge / ing.selling_price) * 100 : 0;
                                return (
                                  <span className={marge >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red"}>
                                    €{marge.toFixed(2)} <span className="text-xs text-on-surface-variant/40">({pct.toFixed(0)}%)</span>
                                  </span>
                                );
                              })()
                            : <span className="text-on-surface-variant/30 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-4 text-sm text-on-surface-variant/70">
                          {(() => {
                            const alts = ing.ingredient_suppliers ?? [];
                            const main = ing.suppliers?.name ?? "—";
                            if (alts.length === 0) return main;
                            const names = alts.map((a) => a.suppliers?.name).filter(Boolean).join(", ");
                            return (
                              <span title={`Aussi : ${names}`}>
                                {main}
                                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-light text-blue-dark text-2xs font-medium">+{alts.length}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1 justify-end">
                            <Link href={`/ingredients/${ing.id}`} onClick={(e) => e.stopPropagation()}
                              className="px-3 py-1.5 bg-surface-container-low text-primary text-2xs font-bold uppercase tracking-wide rounded-lg hover:bg-primary hover:text-on-primary transition opacity-0 group-hover:opacity-100">
                              Ouvrir
                            </Link>
                            <button onClick={(e) => { e.stopPropagation(); handleDuplicate(ing); }} disabled={duplicatingId === ing.id}
                              title="Dupliquer"
                              className="p-1.5 rounded-md text-on-surface-variant/50 hover:text-primary hover:bg-surface-container-low transition disabled:opacity-50">
                              <Copy size={13} />
                            </button>
                            {ing.is_active === false ? (
                              <button onClick={(e) => { e.stopPropagation(); handleToggleActive(ing.id); }}
                                title="Réactiver ce produit" aria-label={`Réactiver ${ing.name}`} disabled={deletingId === ing.id}
                                className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition disabled:opacity-50">
                                <RotateCcw size={13} />
                              </button>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); handleToggleActive(ing.id); }}
                                title="Désactiver ce produit" aria-label={`Désactiver ${ing.name}`} disabled={deletingId === ing.id}
                                className="p-1.5 rounded-md text-on-surface-variant/50 hover:text-amber-dark hover:bg-amber-light transition disabled:opacity-50">
                                <Archive size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 bg-surface-container-low/30 border-t border-outline-variant/20 text-sm text-on-surface-variant/60">
              {filtered.length} ingrédient{filtered.length !== 1 ? "s" : ""} affiché{filtered.length !== 1 ? "s" : ""} sur {ingredients.length}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
