"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] p-6">
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={22} className="text-red-500" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Une erreur est survenue</h1>
        <p className="text-sm text-gray-500 mb-6">
          Quelque chose s&apos;est mal passé sur cette page. Tu peux réessayer — tes données ne sont pas affectées.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
          >
            <RotateCcw size={14} /> Réessayer
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            Tableau de bord
          </a>
        </div>
        {error.digest && <p className="text-2xs text-gray-300 mt-4">Réf. {error.digest}</p>}
      </div>
    </div>
  );
}
