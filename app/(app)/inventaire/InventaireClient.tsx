"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ingredientsPerYieldBase, type RecipeRow } from "@/lib/costing";
import {
  detectServiceMoment, toDatetimeLocal, SERVICE_MOMENTS, serviceMomentLabel, serviceMomentShort,
  type ServiceMoment,
} from "@/lib/service-moment";
import { inventoryMomentAdvice } from "@/lib/inventory-moment";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Warehouse, TrendingDown, TrendingUp, AlertTriangle, Check, Loader2, History, ClipboardList, Trash2, Download, Search, Package, BarChart3 } from "lucide-react";
import clsx from "clsx";
import StatsTab from "./StatsTab";

type Ingredient = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock_qty: number | null;
  cmup: number | null;
  cost_per_base_unit: number | null;
  pack_price: number | null;
  reorder_threshold?: number | null;
  suppliers?: { name: string } | null;
  secondary_unit_label?: string | null;
  secondary_unit_size?: number | null;
  yield_pct?: number | null;
};

// Conditionnement secondaire (ex. « 1 bouteille = 0,75 L ») : si défini,
// l'inventaire se compte dans ce conditionnement, converti en unité de base.
function secOf(ing: Ingredient): { label: string; size: number } | null {
  const label = (ing.secondary_unit_label ?? "").trim();
  const size = Number(ing.secondary_unit_size ?? 0);
  return label && size > 0 ? { label, size } : null;
}

function baseUnitLabel(unit: string) {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}

function needsReorder(i: { stock_qty: number | null; reorder_threshold?: number | null }) {
  const stock = Number(i.stock_qty ?? 0);
  const threshold = Number(i.reorder_threshold ?? 0);
  return threshold > 0 ? stock <= threshold : stock <= 0;
}

type Movement = {
  ingredient_id: string;
  movement_type: "in" | "out" | "adjustment" | "loss";
  qty: number;
  unit_cost: number | null;
  reference_type: string;
  loss_reason?: string | null;
  created_at: string;
};

type InventoryLine = {
  ingredient_id: string | null; ingredient_name: string | null; unit: string | null;
  theoretical_qty: number | null; counted_qty: number | null; ecart: number | null;
  cmup: number | null; ecart_value: number | null;
  recipe_id?: string | null; // ligne de comptage d'une MEP / recette
};

// MEP / recette comptable à l'inventaire (avec ses lignes pour la conversion
// récursive en équivalents ingrédients).
type CountRecipe = {
  id: string; name: string; is_prep: boolean; countable_in_inventory: boolean;
  yield_portions: number; yield_unit: string;
  recipe_lines: { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string }[];
};
// Libellé de saisie pour une MEP/recette : son unité de rendement.
// FIDÈLE à l'unité de rendement (la saisie est convertie avec la même unité :
// « g » reste g, sinon on compterait 1000× trop).
function yieldLabel(r: CountRecipe): string {
  const u = r.yield_unit || "portion";
  if (u === "kg") return "kg";
  if (u === "g") return "g";
  if (u === "l") return "L";
  if (u === "ml") return "ml";
  if (u === "piece") return "pièce(s)";
  return "portion(s)";
}
type Kind = "food" | "fournitures";
type InventorySession = {
  id: string; created_at: string; closing_at: string | null; status: string; finalized_at: string | null;
  items_counted: number;
  manquant_value: number; surplus_value: number; net_value: number; notes: string | null;
  kind?: string | null;
  /** avant / pendant / apres le service (voir lib/service-moment.ts) */
  service_moment?: string | null;
  inventory_lines: InventoryLine[];
};

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  recentMovements: Movement[];
  inventorySessions: InventorySession[];
  fournitureIds: string[];
  recipes?: CountRecipe[];
  serviceStart?: string | null;
  serviceEnd?: string | null;
  /** Mois « YYYY-MM » pour lesquels des ventes sont saisies */
  salesMonths?: string[];
}

// Pretty number: up to 3 decimals, no trailing zeros.
function fmtNum(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

// Always display stock in the imposed conditionnement (kg / L / pièce), never g/ml.
function formatQty(qty: number | null, unit: string): string {
  if (qty === null || qty === undefined) return "—";
  if (unit === "kg" || unit === "g") return `${fmtNum(qty / 1000)} kg`;
  if (unit === "l" || unit === "ml") return `${fmtNum(qty / 1000)} L`;
  return `${fmtNum(qty)} ${unit === "unit" ? "u" : unit}`;
}

// Friendly display unit label (kg / L / pièce).
function displayUnitLabel(unit: string): string {
  return unit === "g" || unit === "kg" ? "kg" : unit === "ml" || unit === "l" ? "L" : unit === "unit" ? "u" : unit;
}

// Convert a quantity in the ingredient's purchase unit to base units (g/ml/unit)
function toBase(qty: number, unit: string): number {
  if (unit === "kg" || unit === "l") return qty * 1000;
  return qty;
}

// User always types in the display unit (kg / L / pièce) → convert to base (g/ml/pièce).
function displayToBase(qty: number, unit: string): number {
  const isWeightVol = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
  return isWeightVol ? qty * 1000 : qty;
}

export default function InventaireClient({ restaurantId, ingredients, recentMovements, inventorySessions, fournitureIds, recipes = [], serviceStart = null, serviceEnd = null, salesMonths = [] }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const fournitureSet = useMemo(() => new Set(fournitureIds), [fournitureIds]);
  const isFourniture = (id: string) => fournitureSet.has(id);
  // Two sidebar entries share this page: /inventaire (état des stocks) and
  // /inventaire?vue=inventaire (prises d'inventaire). The active view follows the URL.
  const searchParams = useSearchParams();
  const isInventaire = searchParams.get("vue") === "inventaire";
  const [tab, setTab] = useState<"count" | "sessions" | "history" | "count-f" | "sessions-f">("count");
  // Vue Stock : la liste des produits, ou les statistiques dans le temps.
  const [stockTab, setStockTab] = useState<"stock" | "stats">("stock");
  const [expandedIng, setExpandedIng] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [sessions, setSessions] = useState<InventorySession[]>(inventorySessions);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newClosingAt, setNewClosingAt] = useState<string>(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm" (local) for datetime-local input
  });
  // Moment de service du comptage : détecté d'après l'heure choisie, corrigeable.
  const detectedMoment = useMemo(() => {
    const d = new Date(newClosingAt);
    return isNaN(d.getTime()) ? null : detectServiceMoment(d, serviceStart, serviceEnd);
  }, [newClosingAt, serviceStart, serviceEnd]);
  const [momentOverride, setMomentOverride] = useState<ServiceMoment | "">("");
  const serviceMoment: ServiceMoment | null = momentOverride || detectedMoment;

  // Un comptage AVANT service alors que les ventes du mois sont saisies fait
  // apparaître un faux surplus : on le dit avant de finaliser.
  const ventesSaisiesPour = (iso?: string | null) =>
    !!iso && salesMonths.includes(String(iso).slice(0, 7));
  const avisNouvelle = inventoryMomentAdvice(serviceMoment, ventesSaisiesPour(newClosingAt));

  const [creatingDraft, setCreatingDraft] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  // Comptage des MEP / recettes (clé = recipe id, valeur saisie en unité de rendement)
  const [mepCounts, setMepCounts] = useState<Record<string, string>>({});
  const [validatingCount, setValidatingCount] = useState(false);
  const [countDone, setCountDone] = useState<string | null>(null);
  const [localIngredients, setLocalIngredients] = useState<Ingredient[]>(ingredients);
  const [filterCat, setFilterCat] = useState("Toutes");
  const [search, setSearch] = useState("");
  // Recherche dans l'historique des inventaires (date, moment, produit compté)
  const [sessionSearch, setSessionSearch] = useState("");

  // Which kind of stock the count/sessions tabs are working on right now.
  const countKind: Kind = tab === "count-f" || tab === "sessions-f" ? "fournitures" : "food";
  const matchKind = (id: string, kind: Kind) => (kind === "fournitures" ? isFourniture(id) : !isFourniture(id));

  // Ingredients belonging to the active kind (fournitures vs alimentaire).
  const kindIngredients = useMemo(
    () => localIngredients.filter((i) => matchKind(i.id, countKind)),
    [localIngredients, countKind, fournitureSet]
  );

  const categories = useMemo(() => {
    const cats = Array.from(new Set(kindIngredients.map((i) => i.category).filter(Boolean)));
    return ["Toutes", ...cats.sort()];
  }, [kindIngredients]);

  const filtered = useMemo(() => {
    return kindIngredients.filter((i) => {
      const matchCat = filterCat === "Toutes" || i.category === filterCat;
      const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [kindIngredients, filterCat, search]);

  const totalValue = useMemo(() => {
    return localIngredients.reduce((sum, i) => {
      const qty = Number(i.stock_qty ?? 0);
      const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
      return sum + qty * cmup;
    }, 0);
  }, [localIngredients]);

  const lowStockCount = localIngredients.filter(needsReorder).length;

  // ---- MEP / recettes comptables (vue alimentaire uniquement) ----
  const countableMeps = useMemo(() => recipes.filter((r) => r.is_prep), [recipes]);
  const countableRecipes = useMemo(() => recipes.filter((r) => !r.is_prep && r.countable_in_inventory), [recipes]);
  const recipeMap = useMemo(() => new Map<string, RecipeRow>(recipes.map((r) => [r.id, r as unknown as RecipeRow])), [recipes]);

  // Équivalents ingrédients (unités de base) apportés par les MEP / recettes
  // comptées : « 4 L de crème d'ail » → x g d'ail, y ml d'huile… (récursif).
  const mepContributions = useMemo(() => {
    const map = new Map<string, number>();
    if (countKind !== "food") return map;
    for (const [rid, raw] of Object.entries(mepCounts)) {
      const v = parseFloat(raw);
      if (isNaN(v) || v <= 0) continue;
      const yieldBase = toBase(v, recipeMap.get(rid)?.yield_unit ?? "portion");
      const perYieldBase = ingredientsPerYieldBase(rid, recipeMap, new Map(), new Set());
      for (const [ingId, qty] of Array.from(perYieldBase.entries())) {
        // Les recettes indiquent des quantités NETTES ; le stock théorique a été
        // débité en BRUT (net ÷ rendement) — l'équivalent doit l'être aussi,
        // sinon les parures ressortent en faux « écart d'inventaire ».
        const y = Number(localIngredients.find((i) => i.id === ingId)?.yield_pct ?? 100);
        const yf = y > 0 ? y / 100 : 1;
        map.set(ingId, (map.get(ingId) ?? 0) + (qty * yieldBase) / yf);
      }
    }
    return map;
  }, [mepCounts, recipeMap, countKind, localIngredients]);

  // ---- Prise d'inventaire (écart théorique vs réel) ----
  // La saisie se fait dans le conditionnement secondaire s'il existe
  // (ex. « 12 bouteilles » → 12 × 0,75 L → 9 000 ml), sinon en kg/L/pièce.
  // Les MEP/recettes comptées s'ajoutent automatiquement en équivalents.
  function countedBase(ing: Ingredient): number | null {
    const raw = counts[ing.id];
    const contrib = mepContributions.get(ing.id) ?? 0;
    const hasRaw = raw !== undefined && raw !== "";
    if (!hasRaw && contrib <= 0) return null;
    let own = 0;
    if (hasRaw) {
      const v = parseFloat(raw);
      if (isNaN(v) || v < 0) return contrib > 0 ? contrib : null;
      const sec = secOf(ing);
      own = displayToBase(sec ? v * sec.size : v, ing.unit);
    }
    return own + contrib;
  }

  const countSummary = useMemo(() => {
    let manque = 0; // valeur des écarts négatifs (stock réel < théorique)
    let surplus = 0;
    let counted = 0;
    for (const ing of kindIngredients) {
      const real = countedBase(ing);
      if (real === null) continue;
      counted++;
      // Affichage temps réel : stock tel que chargé (la relecture à jour se
      // fait au moment de finaliser, dans saveSession).
      const theo = Number(ing.stock_qty ?? 0);
      const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const diff = real - theo;
      if (diff < 0) manque += Math.abs(diff) * cmup;
      else if (diff > 0) surplus += diff * cmup;
    }
    return { manque, surplus, counted, net: surplus - manque };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, kindIngredients, mepContributions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const foodSessions = useMemo(() => sessions.filter((s) => (s.kind ?? "food") !== "fournitures"), [sessions]);
  const fournitureSessions = useMemo(() => sessions.filter((s) => s.kind === "fournitures"), [sessions]);

  // Historique filtré par la recherche : on cherche dans la date écrite en
  // clair (« 18 août 2026 »), le statut, le moment de service, la note et le
  // nom des produits comptés — pour retrouver « quand ai-je compté le saumon ? ».
  const visibleSessions = useMemo(() => {
    const base = tab === "sessions-f" ? fournitureSessions : foodSessions;
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) => {
      const d = new Date(s.closing_at ?? s.created_at);
      const haystack = [
        d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
        d.toLocaleDateString("fr-FR"),
        d.toISOString().slice(0, 10),
        s.status === "draft" ? "brouillon" : "finalisé finalise",
        serviceMomentShort(s.service_moment),
        s.notes ?? "",
        ...(s.inventory_lines ?? []).map((l) => l.ingredient_name ?? ""),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [tab, foodSessions, fournitureSessions, sessionSearch]);

  // Base (g/ml/pièce) → the display value the user typed (kg/L/pièce)
  function baseToDisplay(qty: number, unit: string): number {
    const wv = unit === "g" || unit === "kg" || unit === "ml" || unit === "l";
    return wv ? qty / 1000 : qty;
  }

  async function createDraft() {
    const kind = countKind;
    setCreatingDraft(true);
    const { data: session, error: crErr } = await supabase.from("inventory_sessions").insert({
      restaurant_id: restaurantId, status: "draft", kind,
      closing_at: newClosingAt ? new Date(newClosingAt).toISOString() : new Date().toISOString(),
      // Avant / pendant / après le service : un comptage d'ouverture et un
      // comptage de fermeture ne décrivent pas le même stock.
      service_moment: serviceMoment,
      items_counted: 0,
    }).select().single();
    setCreatingDraft(false);
    if (crErr || !session) {
      // Sans message, le bouton semblait simplement mort.
      window.alert(`Création de la fiche impossible : ${crErr?.message ?? "réessaie."}`);
      return;
    }
    if (session) {
      setSessions((prev) => [{ ...session, inventory_lines: [] } as InventorySession, ...prev]);
      setActiveSessionId(session.id);
      setCounts({});
      setMepCounts({});
      setCountDone(null);
      setTab(kind === "fournitures" ? "count-f" : "count");
    }
  }

  function loadDraft(s: InventorySession) {
    const next: Record<string, string> = {};
    const nextMep: Record<string, string> = {};

    // 1) Lignes MEP/recettes d'abord (quantité stockée en base de rendement)
    for (const l of s.inventory_lines ?? []) {
      if (l.recipe_id && l.counted_qty != null) {
        const yu = recipeMap.get(l.recipe_id)?.yield_unit ?? l.unit ?? "portion";
        const disp = yu === "kg" || yu === "l" ? Number(l.counted_qty) / 1000 : Number(l.counted_qty);
        nextMep[l.recipe_id] = String(Number(disp.toFixed(3)));
      }
    }
    // Contributions apportées par ces MEP (pour les DÉDUIRE des champs
    // ingrédients : le total sauvegardé les incluait déjà).
    const contrib = new Map<string, number>();
    for (const [rid, raw] of Object.entries(nextMep)) {
      const v = parseFloat(raw);
      if (isNaN(v) || v <= 0) continue;
      const yieldBase = toBase(v, recipeMap.get(rid)?.yield_unit ?? "portion");
      const per = ingredientsPerYieldBase(rid, recipeMap, new Map(), new Set());
      for (const [ingId, qty] of Array.from(per.entries())) {
        // Même règle brut/net que mepContributions (rendement inclus)
        const y = Number(localIngredients.find((i) => i.id === ingId)?.yield_pct ?? 100);
        const yf = y > 0 ? y / 100 : 1;
        contrib.set(ingId, (contrib.get(ingId) ?? 0) + (qty * yieldBase) / yf);
      }
    }

    // 2) Lignes ingrédients : champ = total sauvegardé − part venue des MEP
    for (const l of s.inventory_lines ?? []) {
      if (l.ingredient_id && !l.recipe_id && l.counted_qty != null) {
        const ing = localIngredients.find((i) => i.id === l.ingredient_id);
        const own = Math.max(0, Number(l.counted_qty) - (contrib.get(l.ingredient_id) ?? 0));
        const disp = baseToDisplay(own, ing?.unit ?? l.unit ?? "unit");
        const sec = ing ? secOf(ing) : null;
        next[l.ingredient_id] = String(sec ? Number((disp / sec.size).toFixed(3)) : Number(disp.toFixed(3)));
      }
    }
    setCounts(next);
    setMepCounts(nextMep);
    setActiveSessionId(s.id);
    setCountDone(null);
    setTab(s.kind === "fournitures" ? "count-f" : "count");
  }

  async function saveSession(finalize: boolean) {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    const sessionKind: Kind = (session?.kind as Kind) ?? countKind;
    // Les écarts sont datés du MOMENT DU COMPTAGE (pas de la saisie) : le
    // journal de stock reste chronologique même si tu finalises plus tard.
    const countedAtIso = session?.closing_at ?? new Date().toISOString();

    // Finaliser écrase le stock théorique et écrit des mouvements de perte /
    // ajustement : action irréversible, on demande confirmation.
    if (finalize) {
      const avis = inventoryMomentAdvice(
        (session?.service_moment as any) ?? null,
        salesMonths.includes(String(session?.closing_at ?? "").slice(0, 7)),
      );
      const ok = window.confirm(
        (avis.level === "attention" ? `⚠️ ${avis.message}

` : "") +
        `Finaliser l'inventaire ?\n\n${countSummary.counted} produit(s) compté(s) · écart net €${countSummary.net.toFixed(2)} ` +
        `(manquant €${countSummary.manque.toFixed(2)} / surplus €${countSummary.surplus.toFixed(2)})\n\n` +
        "Le stock théorique sera REMPLACÉ par les quantités comptées et les écarts seront enregistrés en pertes/ajustements. Cette action ne peut pas être annulée."
      );
      if (!ok) return;
    }

    setValidatingCount(true);

    // Le stock « théorique » affiché date de l'ouverture de la fiche. Un
    // comptage peut durer une heure : entre-temps une réception, une vente ou
    // une perte a pu passer. On relit donc le stock JUSTE AVANT de finaliser,
    // sinon on écraserait ces mouvements en silence.
    let freshStock: Map<string, number> | null = null;
    if (finalize) {
      const ids = localIngredients.filter((i) => matchKind(i.id, sessionKind)).map((i) => i.id);
      const { data: fresh, error: freshErr } = await supabase
        .from("ingredients").select("id, stock_qty, cmup, cost_per_base_unit").in("id", ids);
      if (freshErr) {
        setValidatingCount(false);
        window.alert(`Impossible de relire le stock avant finalisation : ${freshErr.message}. Rien n'a été modifié — réessaie.`);
        return;
      }
      freshStock = new Map((fresh ?? []).map((r: any) => [r.id, Number(r.stock_qty ?? 0)]));
      // Signaler les produits dont le stock a bougé pendant le comptage.
      const bouges = (fresh ?? []).filter((r: any) => {
        const avant = Number(localIngredients.find((i) => i.id === r.id)?.stock_qty ?? 0);
        return Math.abs(avant - Number(r.stock_qty ?? 0)) > 0.0001 && counts[r.id] !== undefined && counts[r.id] !== "";
      });
      if (bouges.length > 0) {
        const noms = bouges.slice(0, 8).map((r: any) => localIngredients.find((i) => i.id === r.id)?.name ?? r.id);
        const ok = window.confirm(
          "Le stock de ces produits a changé pendant ton comptage (réception, vente ou perte enregistrée entre-temps) :\n\n" +
          noms.map((n: string) => `• ${n}`).join("\n") + (bouges.length > 8 ? `\n…et ${bouges.length - 8} autre(s)` : "") +
          "\n\nLes écarts seront calculés sur le stock À JOUR. Continuer ?"
        );
        if (!ok) { setValidatingCount(false); return; }
      }
      // Rafraîchir l'affichage pour que les écarts montrés correspondent.
      setLocalIngredients((prev) => prev.map((i) => (freshStock!.has(i.id) ? { ...i, stock_qty: freshStock!.get(i.id)! } : i)));
    }

    const movements: any[] = [];
    const updates: { id: string; qty: number; prevQty: number | null }[] = [];
    const sessionLines: InventoryLine[] = [];

    for (const ing of localIngredients.filter((i) => matchKind(i.id, sessionKind))) {
      const real = countedBase(ing);
      if (real === null) continue;
      // Théorique = stock relu juste avant la finalisation (voir plus haut),
      // sinon celui chargé à l'ouverture de la fiche.
      const theo = freshStock?.has(ing.id) ? freshStock.get(ing.id)! : Number(ing.stock_qty ?? 0);
      const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const diff = real - theo;
      sessionLines.push({
        ingredient_id: ing.id, ingredient_name: ing.name, unit: ing.unit,
        theoretical_qty: theo, counted_qty: real, ecart: diff, cmup, ecart_value: diff * cmup,
      });
      if (finalize && diff !== 0) {
        updates.push({ id: ing.id, qty: real, prevQty: ing.stock_qty ?? null });
        movements.push(diff < 0
          ? { restaurant_id: restaurantId, ingredient_id: ing.id, movement_type: "loss", qty: Math.abs(diff), unit_cost: cmup, reference_type: "inventory", reference_id: activeSessionId, loss_reason: "Écart inventaire", created_at: countedAtIso, notes: `Inventaire ${serviceMomentShort(session?.service_moment)} : ${formatQty(theo, ing.unit)} → ${formatQty(real, ing.unit)}` }
          : { restaurant_id: restaurantId, ingredient_id: ing.id, movement_type: "adjustment", qty: diff, unit_cost: cmup, reference_type: "inventory", reference_id: activeSessionId, created_at: countedAtIso, notes: `Inventaire ${serviceMomentShort(session?.service_moment)} : ${formatQty(theo, ing.unit)} → ${formatQty(real, ing.unit)}` });
      }
    }

    // Lignes MEP / recettes comptées (archivées telles quelles ; leur
    // équivalent ingrédients est déjà inclus dans les lignes ingrédients).
    if (sessionKind === "food") {
      for (const [rid, raw] of Object.entries(mepCounts)) {
        const v = parseFloat(raw);
        if (isNaN(v) || v <= 0) continue;
        const rec = recipes.find((x) => x.id === rid);
        if (!rec) continue;
        sessionLines.push({
          ingredient_id: null, recipe_id: rid,
          ingredient_name: (rec.is_prep ? "MEP — " : "Recette — ") + rec.name,
          unit: rec.yield_unit || "portion",
          theoretical_qty: null, counted_qty: toBase(v, rec.yield_unit || "portion"),
          ecart: null, cmup: null, ecart_value: null,
        });
      }
    }

    // Replace the session's saved lines with the current count
    const { error: lineDelErr } = await supabase.from("inventory_lines").delete().eq("session_id", activeSessionId);
    if (lineDelErr) {
      setValidatingCount(false);
      window.alert(`Mise à jour de la fiche impossible : ${lineDelErr.message}. Rien n'a été modifié — réessaie.`);
      return;
    }
    if (sessionLines.length > 0) {
      const { error: linesErr } = await supabase.from("inventory_lines").insert(sessionLines.map((l) => ({ session_id: activeSessionId, ...l })));
      if (linesErr) { setCountDone(null); setValidatingCount(false); window.alert(`Enregistrement des lignes impossible : ${linesErr.message}`); return; }
    }

    // Counts first — the session is only marked "finalized" once stock and
    // movements are safely written (a mid-flight failure leaves a draft).
    const patch: any = {
      items_counted: sessionLines.length,
      manquant_value: countSummary.manque, surplus_value: countSummary.surplus, net_value: countSummary.net,
    };
    const { error: sessErr } = await supabase.from("inventory_sessions").update(patch).eq("id", activeSessionId);
    if (sessErr) {
      setValidatingCount(false);
      window.alert(`Enregistrement de la fiche impossible : ${sessErr.message}. Le comptage n'a pas été sauvegardé — réessaie.`);
      return;
    }

    // Apply stock only when finalizing — movements FIRST (atomic insert :
    // if the DB refuses them, no stock has been touched), then stock with
    // rollback of already-applied updates on failure.
    if (finalize) {
      if (movements.length > 0) {
        const { error: movErr } = await supabase.from("stock_movements").insert(movements);
        if (movErr) {
          setValidatingCount(false);
          window.alert(`Écriture des mouvements impossible : ${movErr.message}. Rien n'a été appliqué — la fiche reste en brouillon.`);
          return;
        }
      }
      const applied: typeof updates = [];
      for (const u of updates) {
        const { error: upErr } = await supabase.from("ingredients").update({ stock_qty: u.qty }).eq("id", u.id);
        if (upErr) {
          for (const a of applied) await supabase.from("ingredients").update({ stock_qty: a.prevQty }).eq("id", a.id);
          await supabase.from("stock_movements").delete().eq("reference_type", "inventory").eq("reference_id", activeSessionId);
          setValidatingCount(false);
          window.alert(`Mise à jour du stock impossible : ${upErr.message}. Les modifications ont été annulées — la fiche reste en brouillon.`);
          return;
        }
        applied.push(u);
      }
      patch.status = "finalized"; patch.finalized_at = new Date().toISOString();
      const { error: finErr } = await supabase.from("inventory_sessions")
        .update({ status: patch.status, finalized_at: patch.finalized_at }).eq("id", activeSessionId);
      if (finErr) {
        // Le stock EST à jour : le dire clairement pour éviter une 2ᵉ finalisation.
        setValidatingCount(false);
        window.alert(
          `Le stock a bien été ajusté, mais la fiche n'a pas pu être archivée (${finErr.message}).\n\n` +
          "Elle réapparaîtra en brouillon : NE la finalise PAS une seconde fois, le stock est déjà corrigé."
        );
        setLocalIngredients((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? { ...i, stock_qty: u.qty } : i; }));
        router.refresh();
        return;
      }
      setLocalIngredients((prev) => prev.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? { ...i, stock_qty: u.qty } : i; }));
    }

    setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, ...patch, inventory_lines: sessionLines } : s));
    setValidatingCount(false);

    if (finalize) {
      setCounts({});
      setMepCounts({});
      setActiveSessionId(null);
      setCountDone(`Inventaire finalisé : ${updates.length} ajustement(s) appliqué(s), écart net €${countSummary.net.toFixed(2)}.`);
      setTab(sessionKind === "fournitures" ? "sessions-f" : "sessions");
    } else {
      setCountDone("Brouillon enregistré ✓");
    }
  }

  // All movements grouped per ingredient (for the stock & mouvements view)
  const movesByIngredient = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const m of recentMovements) {
      if (!m.ingredient_id) continue;
      if (!map.has(m.ingredient_id)) map.set(m.ingredient_id, []);
      map.get(m.ingredient_id)!.push(m);
    }
    return map;
  }, [recentMovements]);

  // Ingredient rows for the stock & mouvements list (with current stock + value)
  const stockRows = useMemo(() => {
    const q = moveSearch.trim().toLowerCase();
    return localIngredients
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q))
      .map((i) => {
        const qty = Number(i.stock_qty ?? 0);
        const cmup = Number(i.cmup ?? i.cost_per_base_unit ?? 0);
        return { ing: i, qty, value: qty * cmup, moves: movesByIngredient.get(i.id) ?? [] };
      })
      .sort((a, b) => a.ing.name.localeCompare(b.ing.name));
  }, [localIngredients, moveSearch, movesByIngredient]);

  const MOVE_META: Record<string, { label: string; sign: string; color: string }> = {
    in: { label: "Réception", sign: "+", color: "text-emerald-600" },
    out: { label: "Vente (déstockage)", sign: "-", color: "text-gray-600" },
    loss: { label: "Perte", sign: "-", color: "text-red-500" },
    adjustment: { label: "Ajustement", sign: "±", color: "text-blue-600" },
  };
  // Group one ingredient's movements by month (label + list)
  function movesByMonth(moves: Movement[]) {
    const groups = new Map<string, Movement[]>();
    for (const m of moves) {
      const key = m.created_at.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }
  function monthLabel(key: string) {
    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const [y, m] = key.split("-");
    return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y}`;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">{isInventaire ? "Inventaire" : "État des stocks"}</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">
            {isInventaire
              ? "Comptez votre stock physique et suivez les écarts avec le théorique."
              : "Stock théorique mis à jour automatiquement via les réceptions et les ventes."}
          </p>
        </div>
        <a href="/api/export/inventaire"
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low transition w-fit">
          <Download size={15} /> Exporter Excel
        </a>
      </div>

      {/* KPI glass cards — derived from live data (stock view only) */}
      {!isInventaire && (
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-primary">
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Valeur du stock</span>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Warehouse size={18} /></div>
          </div>
          <h3 className="text-2xl font-extrabold text-primary tabular-nums">€{totalValue.toFixed(2)}</h3>
        </div>
        <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4", lowStockCount > 0 ? "border-red" : "border-outline-variant/30")}>
          <div className="flex justify-between items-center">
            <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">À commander</span>
            <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", lowStockCount > 0 ? "bg-red-light text-red" : "bg-surface-container text-on-surface-variant/50")}><AlertTriangle size={18} /></div>
          </div>
          <h3 className={clsx("text-2xl font-extrabold tabular-nums", lowStockCount > 0 ? "text-red" : "text-on-surface")}>{lowStockCount}</h3>
        </div>
      </section>
      )}

      {/* Sub-tabs for the different inventories (Inventaire view only) */}
      {isInventaire && (
        <div className="glass-card rounded-2xl p-2 mb-6 flex flex-wrap gap-1">
          {[
            { key: "count", label: "Prise d'inventaire", icon: Check },
            { key: "sessions", label: `Mes inventaires${foodSessions.length ? ` (${foodSessions.length})` : ""}`, icon: History },
            { key: "count-f", label: "Prise d'inventaire fournitures", icon: ClipboardList },
            { key: "sessions-f", label: `Mes inventaires fournitures${fournitureSessions.length ? ` (${fournitureSessions.length})` : ""}`, icon: History },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={clsx(
                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                tab === key ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}


      {/* COUNT TAB — prise d'inventaire (alimentaire + fournitures) */}
      {isInventaire && (tab === "count" || tab === "count-f") && (
        <>
          {countDone && (
            <div className="mb-4 text-sm text-primary bg-emerald-50 border border-primary/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Check size={15} /> {countDone}
            </div>
          )}

          {!activeSession ? (
            <div className="glass-card rounded-2xl p-8 max-w-md mx-auto text-center">
              <ClipboardList size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-on-surface mb-1">Nouvelle fiche d&apos;inventaire{countKind === "fournitures" ? " fournitures" : ""}</h2>
              {countKind === "fournitures" && kindIngredients.length === 0 && (
                <p className="text-sm text-amber-dark mb-3">Aucun ingrédient n&apos;a le tag « Fournitures ». Assigne ce tag à tes fournitures (couverts, emballages…) depuis la page Ingrédients.</p>
              )}
              <p className="text-sm text-on-surface-variant/70 mb-4">Indique quand le comptage est fait : le moment du service est détecté automatiquement, et les écarts seront datés de cette heure-là. Tu peux laisser la fiche en brouillon et la finir plus tard.</p>
              <div className="flex flex-wrap items-end gap-2 justify-center">
                <div className="text-left">
                  <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1">Date &amp; heure du comptage</label>
                  <input type="datetime-local" value={newClosingAt} onChange={(e) => setNewClosingAt(e.target.value)}
                    className="px-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface" />
                </div>
                <div className="text-left">
                  <label className="block text-2xs font-bold uppercase tracking-wide text-on-surface-variant/60 mb-1">Moment du service</label>
                  <select value={momentOverride || (detectedMoment ?? "")}
                    onChange={(e) => setMomentOverride(e.target.value as ServiceMoment | "")}
                    className="px-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface">
                    {SERVICE_MOMENTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <button onClick={createDraft} disabled={creatingDraft}
                  className="px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container disabled:opacity-50 transition">
                  {creatingDraft ? "Création…" : "Créer la fiche"}
                </button>
              </div>
              {serviceMoment && (
                <p className="text-2xs text-on-surface-variant/60 mt-3">
                  {momentOverride && momentOverride !== detectedMoment
                    ? `Corrigé manuellement (détecté : ${serviceMomentLabel(detectedMoment).toLowerCase()}). `
                    : "Détecté d'après tes horaires de service. "}
                  {SERVICE_MOMENTS.find((m) => m.value === serviceMoment)?.hint}
                </p>
              )}
              <p className={clsx("text-2xs mt-2 rounded-lg px-3 py-2 text-left",
                avisNouvelle.level === "attention"
                  ? "bg-amber-light text-amber-dark border border-amber/30"
                  : "bg-emerald-50 text-primary border border-primary/20")}>
                {avisNouvelle.message}
              </p>
            </div>
          ) : (
          <>
          {/* Fiche header + actions */}
          <div className="glass-card rounded-2xl flex flex-wrap items-center justify-between gap-3 mb-4 px-5 py-4">
            <div>
              <p className="text-base font-semibold text-on-surface">
                Inventaire du {activeSession.closing_at ? new Date(activeSession.closing_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
              <p className="text-2xs text-amber-dark uppercase tracking-wide font-bold">
                Brouillon · {serviceMomentShort(activeSession.service_moment)} · {countSummary.counted} produit(s) compté(s)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // Un comptage peut représenter une heure de travail : ne jamais
                  // le jeter sans prévenir.
                  const saisi = Object.values(counts).some((v) => v !== "") || Object.values(mepCounts).some((v) => v !== "");
                  if (saisi && !window.confirm("Quitter le comptage ?\n\nLes quantités saisies et non enregistrées seront perdues. Utilise « Enregistrer brouillon » pour les garder.")) return;
                  setActiveSessionId(null); setCounts({}); setMepCounts({});
                }}
                className="px-3 py-1.5 text-xs text-on-surface-variant/60 hover:text-on-surface">Quitter</button>
              <button onClick={() => saveSession(false)} disabled={validatingCount}
                className="px-4 py-2 text-sm font-semibold text-on-surface-variant border border-outline-variant/40 rounded-xl hover:bg-surface-container-low disabled:opacity-50 transition">
                Enregistrer brouillon
              </button>
              <button onClick={() => saveSession(true)} disabled={validatingCount || countSummary.counted === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container disabled:opacity-40 transition">
                {validatingCount ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Finaliser
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4 border-red">
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Manquant (écart inexpliqué)</p>
              <p className="text-2xl font-extrabold text-red tabular-nums">-€{countSummary.manque.toFixed(2)}</p>
            </div>
            <div className="glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4 border-primary">
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Surplus trouvé</p>
              <p className="text-2xl font-extrabold text-primary tabular-nums">+€{countSummary.surplus.toFixed(2)}</p>
            </div>
            <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-2 border-l-4", countSummary.net < 0 ? "border-red" : "border-primary")}>
              <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Écart net · {countSummary.counted} comptés</p>
              <p className={clsx("text-2xl font-extrabold tabular-nums", countSummary.net < 0 ? "text-red" : "text-primary")}>
                {countSummary.net < 0 ? "-" : "+"}€{Math.abs(countSummary.net).toFixed(2)}
              </p>
            </div>
          </div>

          <p className="text-sm text-on-surface-variant/70 mb-3">Saisis le stock physique compté. <b>Enregistrer brouillon</b> ne touche pas au stock ; <b>Finaliser</b> applique les écarts et archive la fiche.</p>

          {/* Recherche + catégorie : indispensables pour retrouver un produit
              dans une longue liste pendant le comptage. */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit à compter…"
                aria-label="Rechercher un produit à compter"
                className="w-full pl-9 pr-3 py-2 text-sm glass-card rounded-xl border-none outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
              aria-label="Filtrer par catégorie"
              className="px-3 py-2 text-sm glass-card rounded-xl border-none outline-none focus:ring-2 focus:ring-primary/20">
              {["Toutes", ...categories].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {(search || filterCat !== "Toutes") && (
              <button onClick={() => { setSearch(""); setFilterCat("Toutes"); }}
                title="Effacer les filtres"
                className="px-3 py-2 text-xs text-on-surface-variant/60 hover:text-primary">
                Tout afficher
              </button>
            )}
            <span className="text-2xs text-on-surface-variant/50">
              {filtered.length} produit(s) affiché(s) — les quantités déjà saisies sont conservées.
            </span>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                <tr>
                  <th className="text-left px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Ingrédient</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Théorique</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Compté ({"réel"})</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Écart</th>
                  <th className="text-right px-5 py-3 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Valeur écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {/* SECTION MEP — converties automatiquement en équivalents ingrédients */}
                {countKind === "food" && countableMeps.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={5} className="bg-surface-container-low/40 px-5 py-2 text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">
                        Mises en place — converties automatiquement en ingrédients
                      </td>
                    </tr>
                    {countableMeps.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-container-low/40 transition-colors">
                        <td className="px-5 py-3 font-semibold text-on-surface">{r.name}
                          <span className="block text-2xs text-on-surface-variant/50 font-normal">rendement : {fmtNum(Number(r.yield_portions) || 1)} {yieldLabel(r)}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input type="number" min="0" step="any" value={mepCounts[r.id] ?? ""}
                              onChange={(e) => setMepCounts((p) => ({ ...p, [r.id]: e.target.value }))}
                              placeholder="—"
                              className="w-24 px-2 py-1.5 text-sm text-right bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="text-xs text-on-surface-variant/50 min-w-6 max-w-20 truncate">{yieldLabel(r)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                      </tr>
                    ))}
                  </>
                )}
                {/* SECTION RECETTES activées via « Ajouter au comptage d'inventaire » */}
                {countKind === "food" && countableRecipes.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={5} className="bg-surface-container-low/40 px-5 py-2 text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">
                        Recettes comptables — converties automatiquement en ingrédients
                      </td>
                    </tr>
                    {countableRecipes.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-container-low/40 transition-colors">
                        <td className="px-5 py-3 font-semibold text-on-surface">{r.name}
                          <span className="block text-2xs text-on-surface-variant/50 font-normal">rendement : {fmtNum(Number(r.yield_portions) || 1)} {yieldLabel(r)}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input type="number" min="0" step="any" value={mepCounts[r.id] ?? ""}
                              onChange={(e) => setMepCounts((p) => ({ ...p, [r.id]: e.target.value }))}
                              placeholder="—"
                              className="w-24 px-2 py-1.5 text-sm text-right bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="text-xs text-on-surface-variant/50 min-w-6 max-w-20 truncate">{yieldLabel(r)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                        <td className="px-5 py-3 text-right text-on-surface-variant/30">—</td>
                      </tr>
                    ))}
                  </>
                )}
                {countKind === "food" && (countableMeps.length > 0 || countableRecipes.length > 0) && (
                  <tr>
                    <td colSpan={5} className="bg-surface-container-low/40 px-5 py-2 text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">
                      Ingrédients
                    </td>
                  </tr>
                )}
                {filtered.map((ing) => {
                  const theo = Number(ing.stock_qty ?? 0);
                  const cmup = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
                  const real = countedBase(ing);
                  const diff = real === null ? null : real - theo;
                  const valueGap = diff === null ? null : diff * cmup;
                  const sec = secOf(ing);
                  const theoSec = sec ? Number((baseToDisplay(theo, ing.unit) / sec.size).toFixed(2)) : null;
                  return (
                    <tr key={ing.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="px-5 py-4 font-semibold text-on-surface">{ing.name}
                        <span className="block text-2xs text-on-surface-variant/50 font-normal">
                          {ing.category || "—"}{sec ? ` · 1 ${sec.label} = ${fmtNum(sec.size)} ${displayUnitLabel(ing.unit)}` : ""}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right text-on-surface-variant/80 tabular-nums">
                        {formatQty(theo, ing.unit)}
                        {sec && <span className="block text-2xs text-on-surface-variant/50">≈ {theoSec} {sec.label}{theoSec !== null && theoSec >= 2 ? "s" : ""}</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number" min="0" step="any"
                            value={counts[ing.id] ?? ""}
                            onChange={(e) => setCounts((p) => ({ ...p, [ing.id]: e.target.value }))}
                            placeholder="—"
                            className="w-24 px-2 py-1.5 text-sm text-right bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <span className="text-xs text-on-surface-variant/50 min-w-6 max-w-20 truncate">{sec ? sec.label : displayUnitLabel(ing.unit)}</span>
                        </div>
                        {(mepContributions.get(ing.id) ?? 0) > 0 && (
                          <span className="block text-2xs text-primary mt-1">+ {formatQty(mepContributions.get(ing.id)!, ing.unit)} via MEP/recettes</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {diff === null ? <span className="text-on-surface-variant/30">—</span> : (
                          <span className={clsx("font-semibold tabular-nums", diff < 0 ? "text-red" : diff > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                            {diff > 0 ? "+" : ""}{formatQty(Math.abs(diff), ing.unit).replace(/^/, diff < 0 ? "-" : "")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {valueGap === null ? <span className="text-on-surface-variant/30">—</span> : (
                          <span className={clsx("font-semibold tabular-nums", valueGap < 0 ? "text-red" : valueGap > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                            {valueGap < 0 ? "-" : "+"}€{Math.abs(valueGap).toFixed(2)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant/50 mt-3">
            À la finalisation : le stock théorique est aligné sur le réel. Un manquant devient une perte « Écart inventaire »
            (vol, sur-portionnage, oublis), un surplus devient un ajustement. Les pertes déjà saisies (DLC, casse) ne sont pas recomptées ici.
          </p>
          </>
          )}
        </>
      )}

      {/* SESSIONS TAB — saved inventories (alimentaire + fournitures) */}
      {isInventaire && (tab === "sessions" || tab === "sessions-f") && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="relative flex-1 min-w-[240px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
              <input value={sessionSearch} onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Rechercher : date, mois, « avant service », un produit compté…"
                aria-label="Rechercher un inventaire"
                className="w-full pl-9 pr-3 py-2 text-sm glass-card rounded-xl border-none outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            {sessionSearch.trim() && (
              <span className="text-2xs text-on-surface-variant/50">{visibleSessions.length} fiche(s) trouvée(s)</span>
            )}
            <button onClick={() => { setActiveSessionId(null); setCountDone(null); setTab(tab === "sessions-f" ? "count-f" : "count"); }}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
              <ClipboardList size={14} /> Nouvel inventaire{tab === "sessions-f" ? " fournitures" : ""}
            </button>
          </div>
          {visibleSessions.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center">
              <ClipboardList size={28} className="text-on-surface-variant/30 mx-auto mb-3" />
              <p className="text-sm text-on-surface-variant/70">
                {sessionSearch.trim()
                  ? `Aucun inventaire ne correspond à « ${sessionSearch.trim()} ».`
                  : "Aucun inventaire pour l'instant. Crée ta première fiche."}
              </p>
            </div>
          ) : (
            visibleSessions.map((s) => {
              const open = expandedSession === s.id;
              const draft = s.status === "draft";
              return (
                <div key={s.id} className={clsx("glass-card rounded-2xl overflow-hidden", draft && "border-l-4 border-amber")}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <button onClick={() => draft ? loadDraft(s) : setExpandedSession(open ? null : s.id)} className="flex-1 text-left">
                      <p className="font-semibold text-on-surface flex items-center gap-2 flex-wrap">
                        Inventaire du {new Date(s.closing_at ?? s.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        <span className={clsx("px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide", draft ? "bg-amber-light text-amber-dark" : "bg-emerald-50 text-primary")}>
                          {draft ? "Brouillon" : "Finalisé"}
                        </span>
                        {s.service_moment && (
                          <span className="px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide bg-blue-light text-blue"
                            title="Un comptage avant service et un comptage après service ne décrivent pas le même stock">
                            {serviceMomentShort(s.service_moment)}
                          </span>
                        )}
                      </p>
                      <p className="text-2xs text-on-surface-variant/50 mt-0.5">{s.items_counted} produit{s.items_counted !== 1 ? "s" : ""} compté{s.items_counted !== 1 ? "s" : ""}</p>
                    </button>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Manquant</p>
                        <p className="font-semibold text-red tabular-nums">-€{Number(s.manquant_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Surplus</p>
                        <p className="font-semibold text-primary tabular-nums">+€{Number(s.surplus_value).toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">Écart net</p>
                        <p className={clsx("font-bold tabular-nums", Number(s.net_value) < 0 ? "text-red" : "text-primary")}>
                          {Number(s.net_value) < 0 ? "-" : "+"}€{Math.abs(Number(s.net_value)).toFixed(2)}
                        </p>
                      </div>
                      {draft ? (
                        <button onClick={() => loadDraft(s)} className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wide text-primary bg-emerald-50 border border-primary/20 rounded-xl hover:bg-emerald-100 transition">
                          Continuer →
                        </button>
                      ) : (
                        <button onClick={() => setExpandedSession(open ? null : s.id)} className="text-on-surface-variant/40">
                          {open ? <TrendingUp size={16} className="rotate-180" /> : <TrendingDown size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {open && !draft && (
                    <div className="border-t border-outline-variant/10 bg-surface-container-low/30 px-5 py-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-2xs text-on-surface-variant/50 uppercase tracking-wider">
                            <th className="text-left pb-2">Produit</th>
                            <th className="text-right pb-2">Théorique</th>
                            <th className="text-right pb-2">Compté</th>
                            <th className="text-right pb-2">Écart</th>
                            <th className="text-right pb-2">Valeur</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {(s.inventory_lines ?? []).slice().sort((a, b) => Number(a.ecart_value ?? 0) - Number(b.ecart_value ?? 0)).map((l, i) => {
                            const u = l.unit ?? "unit";
                            const ec = Number(l.ecart ?? 0);
                            const ev = Number(l.ecart_value ?? 0);
                            // Ligne MEP / recette : pas de théorique ni d'écart (comptage informatif)
                            const isRecipeLine = !!l.recipe_id || l.theoretical_qty === null;
                            return (
                              <tr key={i}>
                                <td className="py-1.5 text-on-surface-variant">{l.ingredient_name ?? "—"}</td>
                                <td className="py-1.5 text-right text-on-surface-variant/60 tabular-nums">{isRecipeLine ? "—" : formatQty(Number(l.theoretical_qty ?? 0), u)}</td>
                                <td className="py-1.5 text-right text-on-surface-variant tabular-nums">{formatQty(Number(l.counted_qty ?? 0), u)}</td>
                                <td className={clsx("py-1.5 text-right font-medium tabular-nums", ec < 0 ? "text-red" : ec > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                                  {isRecipeLine || ec === 0 ? "—" : `${ec > 0 ? "+" : "-"}${formatQty(Math.abs(ec), u)}`}
                                </td>
                                <td className={clsx("py-1.5 text-right tabular-nums", ev < 0 ? "text-red" : ev > 0 ? "text-primary" : "text-on-surface-variant/40")}>
                                  {isRecipeLine || ev === 0 ? "—" : `${ev < 0 ? "-" : "+"}€${Math.abs(ev).toFixed(2)}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* STOCK VIEW — état des stocks & mouvements */}
      {/* Sub-tabs de la vue Stock : la liste, ou les statistiques dans le temps */}
      {!isInventaire && (
        <div className="glass-card rounded-2xl p-2 mb-5 flex flex-wrap gap-1">
          {[
            { key: "stock", label: "État des stocks", icon: Package },
            { key: "stats", label: "Statistiques", icon: BarChart3 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setStockTab(key as "stock" | "stats")}
              className={clsx(
                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                stockTab === key ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {!isInventaire && stockTab === "stats" && (
        <StatsTab
          ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, cmup: i.cmup }))}
          movements={recentMovements}
          sessions={inventorySessions as any}
          movementsCapped={recentMovements.length >= 5000}
        />
      )}

      {!isInventaire && stockTab === "stock" && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
            <input value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)} placeholder="Rechercher un ingrédient…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40" />
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {stockRows.length === 0 ? (
              <div className="p-10 text-center text-on-surface-variant/50 text-sm">Aucun ingrédient.</div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {stockRows.map(({ ing, qty, value, moves }) => {
                  const open = false; // rows now link to a dedicated history page instead of expanding
                  const low = needsReorder(ing);
                  return (
                    <div key={ing.id}>
                      <Link href={`/ingredients/${ing.id}/history`}
                        className={clsx(
                          "w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-container-low/40 transition-colors text-left",
                          low && "border-l-4 border-red/40"
                        )}>
                        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", low ? "bg-red-light text-red" : "bg-tertiary-fixed text-primary")}>
                          <Package size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={clsx("text-sm font-semibold truncate", low ? "text-red" : "text-on-surface")}>{ing.name}</p>
                            {ing.category && (
                              <span className="inline-flex px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-2xs font-bold uppercase tracking-wide">{ing.category}</span>
                            )}
                            {low && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-light text-red text-2xs font-bold uppercase tracking-wide">
                                <AlertTriangle size={11} /> À commander
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-on-surface-variant/50 mt-0.5">{moves.length} mouvement{moves.length !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={clsx("text-sm font-semibold tabular-nums", low ? "text-red" : "text-on-surface")}>
                            {formatQty(qty, ing.unit)}
                            {(() => {
                              const sec = secOf(ing);
                              if (!sec) return null;
                              const n = Number((baseToDisplay(qty, ing.unit) / sec.size).toFixed(1));
                              return <span className="font-normal text-on-surface-variant/60"> · {fmtNum(n)} {sec.label}{n >= 2 ? "s" : ""}</span>;
                            })()}
                          </p>
                          <p className="text-2xs text-on-surface-variant/50 tabular-nums">{value > 0 ? `€${value.toFixed(2)}` : "—"}</p>
                        </div>
                        <ChevronRight size={16} className="text-on-surface-variant/30 shrink-0" />
                      </Link>

                      {open && (
                        <div className="bg-surface-container-low/30 border-t border-outline-variant/10 px-5 py-4">
                          {moves.length === 0 ? (
                            <p className="text-xs text-on-surface-variant/50 py-2">Aucun mouvement pour ce produit.</p>
                          ) : (
                            movesByMonth(moves).map(([mk, ms]) => {
                              const inQty = ms.filter((m) => m.movement_type === "in").reduce((s, m) => s + m.qty, 0);
                              const outQty = ms.filter((m) => m.movement_type === "out" || m.movement_type === "loss").reduce((s, m) => s + m.qty, 0);
                              return (
                                <div key={mk} className="mb-3 last:mb-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-wide">{monthLabel(mk)}</p>
                                    <p className="text-2xs text-on-surface-variant/50">
                                      {inQty > 0 && <span className="text-primary">+{formatQty(inQty, ing.unit)} reçu</span>}
                                      {inQty > 0 && outQty > 0 && " · "}
                                      {outQty > 0 && <span className="text-red">-{formatQty(outQty, ing.unit)} sorti</span>}
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    {ms.map((m, i) => {
                                      const meta = MOVE_META[m.movement_type] ?? MOVE_META.adjustment;
                                      return (
                                        <div key={i} className="flex items-center justify-between text-xs bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-1.5">
                                          <span className="text-on-surface-variant/70">
                                            {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · {meta.label}
                                            {m.loss_reason ? ` (${m.loss_reason})` : ""}
                                          </span>
                                          <span className={clsx("font-semibold tabular-nums", meta.color)}>{meta.sign}{formatQty(m.qty, ing.unit)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
