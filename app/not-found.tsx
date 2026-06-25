import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] p-6">
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Compass size={22} className="text-gray-400" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Page introuvable</h1>
        <p className="text-sm text-gray-500 mb-6">
          La page que tu cherches n&apos;existe pas ou a été déplacée.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
        >
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
