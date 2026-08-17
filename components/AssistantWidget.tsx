"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";

type Msg = { role: "user" | "assistant"; content: string };

const WELCOME: Msg = {
  role: "assistant",
  content:
    "Bonjour 👋 Je suis l'assistant de la plateforme. Pose-moi une question sur son fonctionnement — par exemple :\n· Comment réceptionner une commande ?\n· C'est quoi le CMUP ?\n· Comment faire un inventaire ?",
};

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Le message d'accueil n'est pas envoyé (économie de contexte)
        body: JSON.stringify({ messages: next.slice(1) }),
      });
      const json = await res.json().catch(() => ({}));
      setMessages((p) => [...p, {
        role: "assistant",
        content: res.ok
          ? (json.reply ?? "Désolé, je n'ai pas compris — reformule ?")
          : (json.error ?? "L'assistant est momentanément indisponible."),
      }]);
    } catch {
      setMessages((p) => [...p, { role: "assistant", content: "Problème de connexion — réessaie dans un instant." }]);
    }
    setLoading(false);
  }

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Assistant d'aide"
        className={clsx(
          "fixed bottom-6 right-6 z-[90] w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95",
          open ? "bg-surface-container-highest text-on-surface-variant" : "bg-primary text-on-primary hover:scale-105 nav-active-glow"
        )}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {/* Panneau de chat */}
      {open && (
        <div className="fixed bottom-24 right-6 z-[90] w-[min(380px,calc(100vw-3rem))] h-[520px] max-h-[70vh] glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-primary text-on-primary flex items-center gap-2 shrink-0">
            <Sparkles size={16} />
            <div>
              <p className="text-sm font-bold leading-tight">Assistant</p>
              <p className="text-[10px] opacity-80 leading-tight">Répond à tes questions sur la plateforme</p>
            </div>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-surface/60">
            {messages.map((m, i) => (
              <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={clsx(
                  "max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-on-primary rounded-br-md"
                    : "bg-surface-container-lowest border border-outline-variant/20 text-on-surface rounded-bl-md"
                )}>
                  {m.role === "assistant" ? m.content.replace(/\*\*/g, "").replace(/^#+\s*/gm, "") : m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-2xl bg-surface-container-lowest border border-outline-variant/20">
                  <Loader2 size={16} className="animate-spin text-primary" />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-outline-variant/20 bg-surface-container-lowest/80 shrink-0">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Pose ta question…"
                className="flex-1 px-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40"
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:bg-primary-container disabled:opacity-40 transition shrink-0"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
