"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await requestPasswordReset(new FormData(e.currentTarget));
    if (result?.error) setError(result.error);
    else setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <p className="text-4xl font-bold text-gray-900 mb-4" style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "-0.01em" }}>Amaly</p>
          <h1 className="text-xl font-semibold text-gray-900">Mot de passe oublié</h1>
          <p className="text-sm text-gray-500 mt-1">On t&apos;envoie un lien pour en choisir un nouveau</p>
        </div>

        <div className="bg-white rounded-card border border-gray-200 shadow-card p-6">
          {sent ? (
            <div className="text-center">
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 mb-4">
                Si un compte existe avec cet email, un lien de réinitialisation vient d&apos;être envoyé.
              </p>
              <p className="text-xs text-gray-500">Pense à vérifier tes spams. Le lien expire au bout d&apos;une heure.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                <input name="email" type="email" required autoComplete="email" autoFocus
                  className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                  placeholder="chef@restaurant.com" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 px-4 bg-green text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition shadow-sm mt-1">
                {loading ? "Envoi…" : "Envoyer le lien"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          <Link href="/login" className="text-green font-medium hover:underline">← Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
