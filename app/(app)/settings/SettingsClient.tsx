"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check } from "lucide-react";

const CUISINE_TYPES = ["French", "Italian", "Japanese", "Mediterranean", "Mexican", "Indian", "American", "Other"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Restaurant = {
  id: string;
  name: string;
  cuisine_type: string;
  target_food_cost_pct: number;
  digest_enabled?: boolean;
  digest_day?: string;
};

interface Props { restaurant: Restaurant; email: string }

export default function SettingsClient({ restaurant, email }: Props) {
  const supabase = createClient();
  const [form, setForm] = useState({
    name: restaurant.name,
    cuisine_type: restaurant.cuisine_type,
    target_food_cost_pct: String(restaurant.target_food_cost_pct),
    digest_enabled: restaurant.digest_enabled ?? true,
    digest_day: restaurant.digest_day ?? "Monday",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
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

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-medium text-gray-900 mb-6">Settings</h1>

      <div className="space-y-5">
        {/* Restaurant details */}
        <div className="bg-white border border-[#E5E7EB] rounded-card p-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Restaurant details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Restaurant name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cuisine type</label>
                <select value={form.cuisine_type} onChange={(e) => setForm({ ...form, cuisine_type: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  {CUISINE_TYPES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Target food-cost %</label>
                <div className="relative">
                  <input type="number" min="1" max="100" step="0.1" value={form.target_food_cost_pct}
                    onChange={(e) => setForm({ ...form, target_food_cost_pct: e.target.value })}
                    className="w-full px-3 py-2 pr-7 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white border border-[#E5E7EB] rounded-card p-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Account</h2>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input value={email} disabled className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-gray-50 text-gray-400" />
          </div>
        </div>

        {/* Weekly digest */}
        <div className="bg-white border border-[#E5E7EB] rounded-card p-6">
          <h2 className="text-sm font-medium text-gray-900 mb-1">Weekly digest email</h2>
          <p className="text-xs text-gray-500 mb-4">A weekly summary of your food costs, price changes, and worst-performing dishes.</p>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-700">Enable weekly digest</span>
            <button
              onClick={() => setForm({ ...form, digest_enabled: !form.digest_enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.digest_enabled ? "bg-emerald-500" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.digest_enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          {form.digest_enabled && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Send on</label>
              <select value={form.digest_day} onChange={(e) => setForm({ ...form, digest_day: e.target.value })}
                className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                {DAYS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>

        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
          {saved ? <><Check size={14} /> Saved!</> : saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
