"use client";

import { useState } from "react";
import Link from "next/link";
import { updatePassword } from "@/app/auth/actions";

export default function UpdatePasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await updatePassword(new FormData(e.currentTarget));
    if (result?.error) { setError(result.error); setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <p className="text-4xl font-bold text-gray-900 mb-4" style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "-0.01em" }}>Amaly</p>
          <h1 className="text-xl font-semibold text-gray-900">Nouveau mot de passe</h1>
          <p className="text-sm text-gray-500 mt-1">Choisis un mot de passe d&apos;au moins 8 caractères</p>
        </div>

        <div className="bg-white rounded-card border border-gray-200 shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nouveau mot de passe</label>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirmer</label>
              <input name="confirm" type="password" required minLength={8} autoComplete="new-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 px-4 bg-green text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition shadow-sm mt-1">
              {loading ? "Enregistrement…" : "Changer le mot de passe"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          <Link href="/login" className="text-green font-medium hover:underline">← Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
