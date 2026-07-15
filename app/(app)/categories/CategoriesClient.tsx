"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, Check, X, Pencil, ArrowUp, ArrowDown } from "lucide-react";
import clsx from "clsx";

type Category = { id: string; type: string; name: string; position: number };
type Tag = { id: string; name: string; color: string };
type TabKey = "menu" | "prep" | "ingredient" | "tags";

const TABS: { key: TabKey; label: string; help: string }[] = [
  { key: "menu", label: "Menu", help: "Catégories de la carte : recettes vendues et produits de revente (Entrée, Plat, Boisson…)." },
  { key: "prep", label: "Mises en place", help: "Catégories des préparations de base (Sauce, Fond, Pâte…)." },
  { key: "ingredient", label: "Ingrédients", help: "Catégories d'achat des ingrédients (Viande, Épicerie…)." },
  { key: "tags", label: "Tags", help: "Étiquettes libres pour marquer des produits — ex. « Fournitures », « Local », « Premium ». Un produit peut porter plusieurs tags, alors qu'il n'a qu'une seule catégorie." },
];

const TAG_COLORS = [
  { label: "Gris", value: "#6B7280" },
  { label: "Rouge", value: "#EF4444" },
  { label: "Orange", value: "#F97316" },
  { label: "Ambre", value: "#F59E0B" },
  { label: "Vert", value: "#10B981" },
  { label: "Turquoise", value: "#14B8A6" },
  { label: "Bleu", value: "#3B82F6" },
  { label: "Violet", value: "#8B5CF6" },
  { label: "Rose", value: "#EC4899" },
];

interface Props {
  restaurantId: string;
  initialCategories: Category[];
  initialTags?: Tag[];
}

export default function CategoriesClient({ restaurantId, initialCategories, initialTags = [] }: Props) {
  const supabase = createClient();
  const [cats, setCats] = useState<Category[]>(initialCategories);
  const [tab, setTab] = useState<TabKey>("menu");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // --- Tags ---
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[4].value);

  async function addTag() {
    const name = newTagName.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setError("Ce tag existe déjà.");
      return;
    }
    setError(null);
    const { data, error: err } = await supabase
      .from("tags")
      .insert({ restaurant_id: restaurantId, name, color: newTagColor })
      .select()
      .single();
    if (err) { setError("Impossible d'ajouter le tag."); return; }
    setTags((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTagName("");
  }

  async function removeTag(id: string) {
    const name = tags.find((t) => t.id === id)?.name ?? "ce tag";
    if (!window.confirm(`Supprimer le tag « ${name} » ? Il sera retiré de tous les produits.`)) return;
    await supabase.from("tags").delete().eq("id", id);
    setTags((p) => p.filter((t) => t.id !== id));
  }

  const list = useMemo(
    () => cats.filter((c) => c.type === tab).sort((a, b) => a.position - b.position),
    [cats, tab]
  );

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError("Cette catégorie existe déjà.");
      return;
    }
    setError(null);
    const position = list.length;
    const { data, error: err } = await supabase
      .from("categories")
      .insert({ restaurant_id: restaurantId, type: tab, name, position })
      .select()
      .single();
    if (err) { setError("Impossible d'ajouter la catégorie."); return; }
    setCats((p) => [...p, data]);
    setNewName("");
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    await supabase.from("categories").update({ name }).eq("id", id);
    setCats((p) => p.map((c) => (c.id === id ? { ...c, name } : c)));
    setEditingId(null);
  }

  async function remove(id: string) {
    const name = cats.find((c) => c.id === id)?.name ?? "cette catégorie";
    if (!window.confirm(`Supprimer la catégorie « ${name} » ?`)) return;
    await supabase.from("categories").delete().eq("id", id);
    setCats((p) => p.filter((c) => c.id !== id));
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = list.findIndex((c) => c.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    // swap positions
    setCats((p) => p.map((c) =>
      c.id === a.id ? { ...c, position: b.position } : c.id === b.id ? { ...c, position: a.position } : c
    ));
    await Promise.all([
      supabase.from("categories").update({ position: b.position }).eq("id", a.id),
      supabase.from("categories").update({ position: a.position }).eq("id", b.id),
    ]);
  }

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-5 pb-5 border-b border-gray-200">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Catalogue</p>
        <h1 className="text-2xl font-bold text-gray-900">Catégories &amp; tags</h1>
        <p className="text-sm text-gray-500 mt-1">Les deux façons de classer tes produits : une <b>catégorie</b> unique par produit, et autant de <b>tags</b> que tu veux.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-lg w-fit">
        {TABS.map((t) => {
          const count = t.key === "tags" ? tags.length : cats.filter((c) => c.type === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setError(null); setEditingId(null); }}
              className={clsx(
                "px-4 py-2 text-sm font-medium rounded-md transition",
                tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t.label} <span className={clsx("ml-1 text-xs", tab === t.key ? "text-emerald-600" : "text-gray-400")}>{count}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 mb-4">{activeTab.help}</p>

      {/* Add */}
      {tab === "tags" ? (
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
            placeholder="Nouveau tag… (ex. Fournitures)"
            className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
          />
          <div className="flex gap-1.5 flex-wrap items-center">
            {TAG_COLORS.map((c) => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => setNewTagColor(c.value)}
                className={clsx("w-6 h-6 rounded-full border-2 transition", newTagColor === c.value ? "border-gray-900 scale-110" : "border-transparent")}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
          <button
            onClick={addTag}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm"
          >
            <Plus size={15} /> Ajouter
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            placeholder="Nouvelle catégorie…"
            className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
          />
          <button
            onClick={addCategory}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm"
          >
            <Plus size={15} /> Ajouter
          </button>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {/* Tag list */}
      {tab === "tags" && (
        tags.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-card p-10 text-center text-sm text-gray-500">
            Aucun tag. Ajoutes-en un ci-dessus.
          </div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-card divide-y divide-gray-100">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 group">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="text-sm text-gray-800">{t.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-2xs font-medium"
                    style={{ backgroundColor: `${t.color}1A`, color: t.color }}>
                    aperçu
                  </span>
                </div>
                <button onClick={() => removeTag(t.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition opacity-0 group-hover:opacity-100">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Category list */}
      {tab !== "tags" && (list.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-10 text-center text-sm text-gray-500">
          Aucune catégorie. Ajoutez-en une ci-dessus.
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-card divide-y divide-[#E5E7EB]">
          {list.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition">
              <div className="flex flex-col">
                <button onClick={() => move(c.id, -1)} disabled={i === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"><ArrowUp size={13} /></button>
                <button onClick={() => move(c.id, 1)} disabled={i === list.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"><ArrowDown size={13} /></button>
              </div>

              {editingId === c.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    autoFocus value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") setEditingId(null); }}
                    className="flex-1 px-2 py-1 text-sm border border-emerald-400 rounded outline-none"
                  />
                  <button onClick={() => saveRename(c.id)} className="text-emerald-600"><Check size={15} /></button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400"><X size={15} /></button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">{c.name}</span>
                  <button
                    onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                  ><Pencil size={14} /></button>
                  <button
                    onClick={() => remove(c.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                  ><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      ))}

      <p className="text-xs text-gray-400 mt-4">
        {tab === "tags"
          ? "Un produit peut porter plusieurs tags (à assigner depuis sa fiche). Supprimer un tag le retire des produits, sans les supprimer."
          : "Supprimer une catégorie ne supprime pas les articles existants — ils gardent leur ancien libellé jusqu'à modification."}
      </p>
    </div>
  );
}
