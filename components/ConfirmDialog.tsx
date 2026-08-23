"use client";

// Remplace le `window.confirm()` du navigateur, qui affiche le nom de domaine,
// ignore la charte et tronque tout retour à la ligne.
//
// L'API reste celle du natif — une promesse de booléen — pour que les appels
// existants deviennent simplement :
//     if (!(await confirm({ ... }))) return;
//
// Utilisation :
//     const confirm = useConfirm();
//     const ok = await confirm({ title: "Supprimer « X » ?", tone: "danger" });

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import clsx from "clsx";

export type ConfirmOptions = {
  /** La question, en une ligne. Ex. « Supprimer « Acide citrique » ? » */
  title: string;
  /** Ce que ça implique, en une phrase. */
  message?: string;
  /** Les conséquences précises, une par puce. */
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` = action destructrice : rouge, et le bouton d'annulation prend le focus. */
  tone?: "danger" | "default";
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm doit être utilisé dans un <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // On rend la main au bouton qui a ouvert la boîte : sans ça, le focus
  // repart en haut de page et la navigation au clavier est perdue.
  const openerRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((p) => { p?.resolve(ok); return null; });
    openerRef.current?.focus?.();
  }, []);

  const danger = pending?.tone !== "default";

  useEffect(() => {
    if (!pending) return;

    // Sur une action destructrice, le focus va sur « Annuler » : une frappe
    // réflexe sur Entrée ne doit pas supprimer.
    (danger ? cancelRef : confirmRef).current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      if (e.key === "Enter" && !danger) { e.preventDefault(); close(true); return; }
      // Piège à focus : la tabulation ne doit pas sortir de la boîte.
      if (e.key === "Tab") {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>("button");
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [pending, danger, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm dialog-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
        >
          <div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={pending.message ? "confirm-message" : undefined}
            className="dialog-panel w-full max-w-[420px] bg-surface-container-lowest rounded-2xl shadow-modal overflow-hidden"
          >
            <div className="p-6 pb-5">
              <div className="flex gap-4">
                <div className={clsx(
                  "w-11 h-11 rounded-full flex items-center justify-center shrink-0",
                  danger ? "bg-red-light text-red" : "bg-tertiary-fixed text-primary",
                )}>
                  {danger ? <Trash2 size={19} /> : <AlertTriangle size={19} />}
                </div>
                <div className="min-w-0 pt-0.5">
                  <h2 id="confirm-title" className="text-base font-bold text-on-surface leading-snug">
                    {pending.title}
                  </h2>
                  {pending.message && (
                    <p id="confirm-message" className="text-sm text-on-surface-variant/80 mt-1.5 leading-relaxed">
                      {pending.message}
                    </p>
                  )}
                </div>
              </div>

              {pending.consequences && pending.consequences.length > 0 && (
                <ul className={clsx(
                  "mt-4 rounded-xl px-4 py-3 space-y-1.5 text-sm",
                  danger ? "bg-red-light/50 text-red-dark" : "bg-surface-container-low text-on-surface-variant",
                )}>
                  {pending.consequences.map((c, i) => (
                    <li key={i} className="flex gap-2.5 leading-relaxed">
                      <span className={clsx("mt-[7px] w-1.5 h-1.5 rounded-full shrink-0", danger ? "bg-red" : "bg-outline")} />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2.5 px-6 py-4 bg-surface-container-low/60 border-t border-outline-variant/30">
              <button
                ref={cancelRef}
                onClick={() => close(false)}
                className="flex-1 py-3 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant/60 rounded-xl hover:bg-surface-container transition outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {pending.cancelLabel ?? "Annuler"}
              </button>
              <button
                ref={confirmRef}
                onClick={() => close(true)}
                className={clsx(
                  "flex-1 py-3 text-sm font-semibold text-white rounded-xl transition shadow-sm active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                  danger
                    ? "bg-red hover:bg-red-dark focus-visible:ring-red/50"
                    : "bg-primary hover:bg-primary-container focus-visible:ring-primary/50",
                )}
              >
                {pending.confirmLabel ?? (danger ? "Supprimer" : "Confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
