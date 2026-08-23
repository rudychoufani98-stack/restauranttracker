"use client";

// Remplace `window.confirm()` et `window.alert()`, qui affichent le nom de
// domaine Vercel, ignorent la charte et écrasent la mise en forme du texte.
//
// Deux hooks :
//   const confirm = useConfirm();   // promesse de booléen, comme le natif
//   const notify  = useAlert();     // message simple, ne bloque pas le code
//
//   if (!(await confirm({ title: "Supprimer « X » ?" }))) return;
//   notify(`Suppression impossible : ${error.message}`);
//
// Les deux acceptent aussi une simple chaîne : la première ligne devient le
// titre, le reste le corps. C'est ce qui a permis de reprendre tels quels les
// messages déjà écrits pour les boîtes natives.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { AlertTriangle, Trash2, Info, CheckCircle2, XCircle } from "lucide-react";
import clsx from "clsx";

export type Tone = "danger" | "default" | "error" | "success" | "info";

export type ConfirmOptions = {
  /** La question, en une ligne. Ex. « Supprimer « Acide citrique » ? » */
  title: string;
  /** Ce que ça implique. Les retours à la ligne sont conservés. */
  message?: string;
  /** Les conséquences précises, une par puce. */
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` = destructeur : rouge, et « Annuler » prend le focus. */
  tone?: Tone;
};

export type ConfirmInput = string | ConfirmOptions;

/** Première ligne = titre, le reste = corps. Une ligne unique et longue part
 *  dans le corps : un pavé en gras se lit mal. */
function parse(input: ConfirmInput): ConfirmOptions {
  if (typeof input !== "string") return input;
  const [head, ...rest] = input.split(/\n{2,}/);
  const body = rest.join("\n\n").trim();
  const title = head.trim();
  if (body) return { title, message: body };
  return title.length <= 90 ? { title } : { title: "Information", message: title };
}

type Job =
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: "alert" } & ConfirmOptions);

type Api = {
  confirm: (o: ConfirmInput) => Promise<boolean>;
  notify: (o: ConfirmInput) => void;
};

const Ctx = createContext<Api | null>(null);

export function useConfirm() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useConfirm doit être utilisé dans un <ConfirmProvider>");
  return api.confirm;
}
export function useAlert() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAlert doit être utilisé dans un <ConfirmProvider>");
  return api.notify;
}

const ICONS: Record<Tone, typeof Info> = {
  danger: Trash2,
  default: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
  info: Info,
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  // Une file d'attente : deux messages coup sur coup ne doivent pas s'écraser.
  const [queue, setQueue] = useState<Job[]>([]);
  const job = queue[0] ?? null;

  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // On rend la main au bouton qui a ouvert la boîte : sans ça le focus repart
  // en haut de page et la navigation au clavier est perdue.
  const openerRef = useRef<HTMLElement | null>(null);

  const push = useCallback((j: Job) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setQueue((q) => [...q, j]);
  }, []);

  const confirm = useCallback(
    (input: ConfirmInput) =>
      new Promise<boolean>((resolve) => push({ kind: "confirm", resolve, ...parse(input) })),
    [push],
  );
  const notify = useCallback((input: ConfirmInput) => push({ kind: "alert", ...parse(input) }), [push]);

  const close = useCallback((ok: boolean) => {
    setQueue((q) => {
      const [head, ...rest] = q;
      if (head?.kind === "confirm") head.resolve(ok);
      if (rest.length === 0) openerRef.current?.focus?.();
      return rest;
    });
  }, []);

  const isConfirm = job?.kind === "confirm";
  // Le rouge et le mot « Supprimer » ne s’appliquent QUE si on les demande :
  // une confirmation ordinaire (valider, quitter, envoyer) ne doit pas crier.
  const tone: Tone = job?.tone ?? (isConfirm ? "default" : "info");
  const destructive = tone === "danger";
  const Icon = ICONS[tone];

  useEffect(() => {
    if (!job) return;

    // Sur une action destructrice, le focus va sur « Annuler » : une frappe
    // réflexe sur Entrée ne doit pas supprimer.
    (destructive && isConfirm ? cancelRef : confirmRef).current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      if (e.key === "Enter" && !(destructive && isConfirm)) { e.preventDefault(); close(true); return; }
      if (e.key === "Tab") {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>("button");
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [job, destructive, isConfirm, close]);

  const accent = {
    danger:  { chip: "bg-red-light text-red",            list: "bg-red-light/50 text-red-dark",             dot: "bg-red" },
    error:   { chip: "bg-red-light text-red",            list: "bg-red-light/50 text-red-dark",             dot: "bg-red" },
    default: { chip: "bg-amber-light text-amber-dark",   list: "bg-amber-light/50 text-amber-dark",         dot: "bg-amber" },
    success: { chip: "bg-green-light text-green-dark",   list: "bg-green-light/60 text-green-dark",         dot: "bg-emerald-600" },
    info:    { chip: "bg-tertiary-fixed text-primary",   list: "bg-surface-container-low text-on-surface-variant", dot: "bg-outline" },
  }[tone];

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      {job && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm dialog-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
        >
          <div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={job.message ? "confirm-message" : undefined}
            className="dialog-panel w-full max-w-[440px] bg-surface-container-lowest rounded-2xl shadow-modal overflow-hidden"
          >
            <div className="p-6 pb-5 max-h-[60vh] overflow-y-auto">
              <div className="flex gap-4">
                <div className={clsx("w-11 h-11 rounded-full flex items-center justify-center shrink-0", accent.chip)}>
                  <Icon size={19} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <h2 id="confirm-title" className="text-base font-bold text-on-surface leading-snug">{job.title}</h2>
                  {job.message && (
                    <p id="confirm-message" className="text-sm text-on-surface-variant/80 mt-1.5 leading-relaxed whitespace-pre-line">
                      {job.message}
                    </p>
                  )}
                </div>
              </div>

              {job.consequences && job.consequences.length > 0 && (
                <ul className={clsx("mt-4 rounded-xl px-4 py-3 space-y-1.5 text-sm", accent.list)}>
                  {job.consequences.map((c, i) => (
                    <li key={i} className="flex gap-2.5 leading-relaxed">
                      <span className={clsx("mt-[7px] w-1.5 h-1.5 rounded-full shrink-0", accent.dot)} />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2.5 px-6 py-4 bg-surface-container-low/60 border-t border-outline-variant/30">
              {isConfirm && (
                <button
                  ref={cancelRef}
                  onClick={() => close(false)}
                  className="flex-1 py-3 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant/60 rounded-xl hover:bg-surface-container transition outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {job.cancelLabel ?? "Annuler"}
                </button>
              )}
              <button
                ref={confirmRef}
                onClick={() => close(true)}
                className={clsx(
                  "flex-1 py-3 text-sm font-semibold text-white rounded-xl transition shadow-sm active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                  destructive || tone === "error"
                    ? "bg-red hover:bg-red-dark focus-visible:ring-red/50"
                    : "bg-primary hover:bg-primary-container focus-visible:ring-primary/50",
                )}
              >
                {job.confirmLabel ?? (isConfirm ? (destructive ? "Supprimer" : "Confirmer") : "J’ai compris")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
