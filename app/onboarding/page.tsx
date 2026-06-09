"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CUISINE_TYPES = [
  "Française", "Italienne", "Japonaise", "Méditerranéenne",
  "Mexicaine", "Indienne", "Américaine", "Autre",
];

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    cuisine_type: "",
    target_food_cost_pct: "28",
  });

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error: dbError } = await supabase.from("restaurants").insert({
      name: form.name.trim(),
      cuisine_type: form.cuisine_type,
      target_food_cost_pct: parseFloat(form.target_food_cost_pct),
      owner_id: user.id,
    });

    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-card bg-emerald-500 mb-4">
            <span className="text-white text-xl">🍽</span>
          </div>
          <h1 className="text-xl font-medium text-gray-900">Configurer votre restaurant</h1>
          <p className="text-sm text-gray-500 mt-1">Quelques informations — modifiables ensuite dans les Paramètres</p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-card p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nom du restaurant
              </label>
              <input
                required
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                placeholder="ex. Le Petit Bistro"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type de cuisine
              </label>
              <select
                required
                value={form.cuisine_type}
                onChange={(e) => update("cuisine_type", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition bg-white"
              >
                <option value="">Choisir un type…</option>
                {CUISINE_TYPES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Objectif food cost (%)
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                  value={form.target_food_cost_pct}
                  onChange={(e) => update("target_food_cost_pct", e.target.value)}
                  className="w-full px-3 py-2 pr-8 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                28% est la norme du secteur. C&apos;est le food cost que vous souhaitez ne pas dépasser par plat.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? "Enregistrement…" : "Accéder à mon tableau de bord →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
