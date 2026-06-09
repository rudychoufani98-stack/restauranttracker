"use client";

import { useState } from "react";
import Link from "next/link";
import { login } from "@/app/auth/actions";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(new FormData(e.currentTarget));
    if (result?.error) { setError(result.error); setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-green shadow-sm mb-4 text-lg">🍽</div>
          <h1 className="text-xl font-semibold text-gray-900">Connexion</h1>
          <p className="text-sm text-gray-500 mt-1">Plateforme de coûts et marges restaurant</p>
        </div>

        <div className="bg-white rounded-card border border-gray-200 shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input name="email" type="email" required autoComplete="email"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                placeholder="chef@restaurant.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Mot de passe</label>
              <input name="password" type="password" required autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 px-4 bg-green text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition shadow-sm mt-1">
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Pas de compte ?{" "}
          <Link href="/signup" className="text-green font-medium hover:underline">Créer un compte gratuit</Link>
        </p>
      </div>
    </div>
  );
}
