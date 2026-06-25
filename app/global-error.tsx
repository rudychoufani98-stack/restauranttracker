"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#F7F8FA" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 14, padding: 32, maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Une erreur est survenue</h1>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 24px" }}>
              L&apos;application a rencontré un problème. Réessaie.
            </p>
            <button
              onClick={reset}
              style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, color: "#fff", background: "#059669", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
