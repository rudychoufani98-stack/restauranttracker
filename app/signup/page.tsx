"use client";

import { useState } from "react";
import Link from "next/link";
import { signup } from "@/app/auth/actions";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirm = formData.get("confirm") as string;
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    if (password.length < 6) return setError("Le mot de passe doit contenir au moins 6 caractères.");
    setLoading(true);
    const result = await signup(formData);
    if (result?.error) { setError(result.error); setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-green shadow-sm mb-4 text-lg">🍽</div>
          <h1 className="text-xl font-semibold text-gray-900">Créer un compte</h1>
          <p className="text-sm text-gray-500 mt-1">Commencez à suivre les vrais coûts de votre restaurant</p>
        </div>

        <div className="bg-white rounded-card border border-gray-200 shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
            )}
            {[
              { name: "email", type: "email", label: "Email", placeholder: "chef@restaurant.com", autoComplete: "email" },
              { name: "password", type: "password", label: "Mot de passe", placeholder: "Au moins 6 caractères", autoComplete: "new-password" },
              { name: "confirm", type: "password", label: "Confirmer le mot de passe", placeholder: "••••••••", autoComplete: "new-password" },
            ].map((f) => (
              <div key={f.name}>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{f.label}</label>
                <input name={f.name} type={f.type} required autoComplete={f.autoComplete}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                  placeholder={f.placeholder} />
              </div>
            ))}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 px-4 bg-green text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition shadow-sm mt-1">
              {loading ? "Création du compte…" : "Créer mon compte"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Déjà un compte ?{" "}
          <Link href="/login" className="text-green font-medium hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
