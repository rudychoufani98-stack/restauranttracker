import Link from "next/link";

// L'inscription publique est fermée : les comptes clients sont créés par
// l'administrateur de la plateforme depuis son panel (« Créer un client »).
export default function SignupPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[400px] text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-ri.svg" alt="" className="w-10 h-10" />
          <p className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "-0.01em" }}>Restointelligence</p>
        </div>
        <div className="bg-white rounded-card border border-gray-200 shadow-card p-8">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Accès sur invitation</h1>
          <p className="text-sm text-gray-500 mb-6">
            Les espaces restaurant sont ouverts par l&apos;équipe Restointelligence.
            Contactez-nous pour rejoindre la plateforme — vos identifiants vous seront transmis directement.
          </p>
          <Link href="/login" className="inline-block px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-container transition">
            Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
