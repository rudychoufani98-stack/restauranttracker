"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, Plus, Trash2, Tag } from "lucide-react";
import { Card, Button, Input, Select, Alert } from "@/components/ui";
import clsx from "clsx";

const CUISINE_TYPES = ["French", "Italian", "Japanese", "Mediterranean", "Mexican", "Indian", "American", "Other"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const TAG_COLORS = [
  { label: "Gray",    value: "#6B7280" },
  { label: "Red",     value: "#EF4444" },
  { label: "Orange",  value: "#F97316" },
  { label: "Amber",   value: "#F59E0B" },
  { label: "Green",   value: "#10B981" },
  { label: "Teal",    value: "#14B8A6" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Violet",  value: "#8B5CF6" },
  { label: "Pink",    value: "#EC4899" },
];

type Restaurant = {
  id: string; name: string; cuisine_type: string;
  target_food_cost_pct: number; digest_enabled?: boolean; digest_day?: string;
};
type Tag = { id: string; name: string; color: string };

type Tab = "restaurant" | "tags" | "digest";

interface Props { restaurant: Restaurant; email: string; initialTags: Tag[] }

export default function SettingsClient({ restaurant, email, initialTags }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("restaurant");

  // --- Restaurant form ---
  const [form, setForm] = useState({
    name: restaurant.name,
    cuisine_type: restaurant.cuisine_type,
    target_food_cost_pct: String(restaurant.target_food_cost_pct),
    digest_enabled: restaurant.digest_enabled ?? true,
    digest_day: restaurant.digest_day ?? "Monday",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSaveRestaurant() {
    setSaving(true); setSaved(false);
    await supabase.from("restaurants").update({
      name: form.name,
      cuisine_type: form.cuisine_type,
      target_food_cost_pct: parseFloat(form.target_food_cost_pct),
      digest_enabled: form.digest_enabled,
      digest_day: form.digest_day,
    }).eq("id", restaurant.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // --- Tags ---
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[4].value); // green default
  const [tagError, setTagError] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

  async function handleAddTag() {
    setTagError(null);
    if (!newTagName.trim()) return setTagError("Tag name is required.");
    if (tags.find((t) => t.name.toLowerCase() === newTagName.trim().toLowerCase())) {
      return setTagError("A tag with that name already exists.");
    }
    setAddingTag(true);
    const { data, error } = await supabase.from("tags").insert({
      restaurant_id: restaurant.id,
      name: newTagName.trim(),
      color: newTagColor,
    }).select().single();
    if (error) { setTagError(error.message); setAddingTag(false); return; }
    setTags((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTagName("");
    setAddingTag(false);
  }

  async function handleDeleteTag(id: string) {
    setDeletingTagId(id);
    await supabase.from("tags").delete().eq("id", id);
    setTags((p) => p.filter((t) => t.id !== id));
    setDeletingTagId(null);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "restaurant", label: "Restaurant" },
    { key: "tags",       label: "Tags" },
    { key: "digest",     label: "Weekly digest" },
  ];

  return (
    <div className="p-7 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px",
              tab === key
                ? "border-green text-green"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Restaurant tab ── */}
      {tab === "restaurant" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Restaurant details</h2>
            <div className="space-y-4">
              <Input
                label="Restaurant name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Cuisine type"
                  value={form.cuisine_type}
                  onChange={(e) => setForm({ ...form, cuisine_type: e.target.value })}
                >
                  {CUISINE_TYPES.map((c) => <option key={c}>{c}</option>)}
                </Select>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Target food-cost %</label>
                  <div className="relative">
                    <input
                      type="number" min="1" max="100" step="0.1"
                      value={form.target_food_cost_pct}
                      onChange={(e) => setForm({ ...form, target_food_cost_pct: e.target.value })}
                      className="w-full px-3 py-2 pr-7 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Account</h2>
            <p className="text-xs text-gray-400 mb-3">Email cannot be changed here.</p>
            <Input label="Email" value={email} disabled />
          </Card>

          <Button
            variant="primary"
            onClick={handleSaveRestaurant}
            disabled={saving}
          >
            {saved ? <><Check size={13} /> Saved</> : saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}

      {/* ── Tags tab ── */}
      {tab === "tags" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Ingredient tags</h2>
            <p className="text-xs text-gray-500 mb-5">
              Create tags to organise your ingredients — e.g. &ldquo;Local&rdquo;, &ldquo;Seasonal&rdquo;, &ldquo;Allergen&rdquo;, &ldquo;Premium&rdquo;. You can assign multiple tags to each ingredient.
            </p>

            {/* Add new tag */}
            <div className="flex gap-2 items-end mb-5">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Tag name</label>
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="e.g. Seasonal, Local, Allergen…"
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Colour</label>
                <div className="flex gap-1.5 flex-wrap">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => setNewTagColor(c.value)}
                      className={clsx(
                        "w-6 h-6 rounded-full border-2 transition",
                        newTagColor === c.value ? "border-gray-900 scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>
              </div>
              <Button variant="primary" onClick={handleAddTag} disabled={addingTag}>
                <Plus size={13} /> Add
              </Button>
            </div>

            {tagError && <Alert variant="error">{tagError}</Alert>}

            {/* Tag list */}
            {tags.length === 0 ? (
              <div className="py-8 text-center">
                <Tag size={28} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm text-gray-500">No tags yet. Add your first one above.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="text-sm text-gray-800">{tag.name}</span>
                      {/* Preview pill */}
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white opacity-80"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      disabled={deletingTagId === tag.id}
                      className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Digest tab ── */}
      {tab === "digest" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Weekly digest email</h2>
            <p className="text-xs text-gray-500 mb-5">
              A weekly summary sent to {email}: average food costs, dishes over target, biggest price increases from validated deliveries, and your worst-performing dish.
            </p>

            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-800">Enable digest</p>
                <p className="text-xs text-gray-400 mt-0.5">Turn off to stop receiving weekly emails</p>
              </div>
              <button
                onClick={() => setForm({ ...form, digest_enabled: !form.digest_enabled })}
                className={clsx(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  form.digest_enabled ? "bg-green" : "bg-gray-200"
                )}
              >
                <span className={clsx(
                  "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  form.digest_enabled ? "translate-x-6" : "translate-x-1"
                )} />
              </button>
            </div>

            {form.digest_enabled && (
              <div className="pt-4">
                <Select
                  label="Send on"
                  value={form.digest_day}
                  onChange={(e) => setForm({ ...form, digest_day: e.target.value })}
                  className="w-48"
                >
                  {DAYS.map((d) => <option key={d}>{d}</option>)}
                </Select>
              </div>
            )}
          </Card>

          <Button variant="primary" onClick={handleSaveRestaurant} disabled={saving}>
            {saved ? <><Check size={13} /> Saved</> : saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
