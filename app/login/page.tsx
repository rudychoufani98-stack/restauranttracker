"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { login } from "@/app/auth/actions";

const LINK_ERRORS: Record<string, string> = {
  lien_invalide: "Ce lien n'est plus valide (déjà utilisé, expiré, ou ouvert dans un autre navigateur). Redemande un email de réinitialisation.",
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Chemin demandé avant la connexion, transmis par le middleware.
  const [nextPath, setNextPath] = useState("");

  // Un lien de réinitialisation expiré renvoyait ici SANS aucune explication :
  // l'utilisateur réessayait indéfiniment.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get("error");
    if (code) setError(LINK_ERRORS[code] ?? decodeURIComponent(sp.get("error_description") ?? code));
    // On n'accepte qu'un chemin interne : une URL externe permettrait une
    // redirection malveillante après connexion.
    const n = sp.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNextPath(n);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(new FormData(e.currentTarget));
      if (result?.error) { setError(result.error); setLoading(false); }
      // Succès : la redirection est faite côté serveur, on garde le bouton occupé.
    } catch {
      // Sans ce filet, une coupure réseau laissait le bouton bloqué sur
      // « Connexion… » sans message, et il fallait recharger la page.
      setError("Connexion au serveur impossible. Vérifie ta connexion internet et réessaie.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-ri.svg" alt="" className="w-10 h-10" />
            <p className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "-0.01em" }}>Restointelligence</p>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Connexion</h1>
          <p className="text-sm text-gray-500 mt-1">Plateforme de coûts et marges restaurant</p>
        </div>

        <div className="bg-white rounded-card border border-gray-200 shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Page demandée avant la connexion (posée par le middleware) */}
            <input type="hidden" name="next" value={nextPath} />
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input name="email" type="email" required autoComplete="email"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
                placeholder="chef@restaurant.com" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-600">Mot de passe</label>
                <Link href="/reset-password" className="text-xs text-green hover:underline">Mot de passe oublié ?</Link>
              </div>
              <input name="password" type="password" required autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-600 disabled:opacity-50 transition shadow-sm mt-1">
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-5">
          Accès sur invitation — contactez Restointelligence pour ouvrir votre espace.
        </p>
      </div>
    </div>
  );
}
