"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, Trash2, Mail, KeyRound, LogOut, Loader2, Users, UserPlus, Shield } from "lucide-react";
import { Card, Button, Input, Select, Alert, Badge } from "@/components/ui";
import { logout } from "@/app/auth/actions";
import { parseHHMM, DEFAULT_SERVICE_START, DEFAULT_SERVICE_END, detectServiceMoment, serviceMomentLabel } from "@/lib/service-moment";
import clsx from "clsx";
import { useConfirm } from "@/components/ConfirmDialog";

const CUISINE_TYPES = ["Française", "Italienne", "Japonaise", "Méditerranéenne", "Mexicaine", "Indienne", "Américaine", "Autre"];
// La valeur STOCKÉE doit rester en anglais : le cron du récap compare avec
// toLocaleDateString("en-US", { weekday: "long" }). Enregistrer « Lundi »
// empêchait définitivement l'envoi de l'email hebdomadaire.
const DAYS: { value: string; label: string }[] = [
  { value: "Monday", label: "Lundi" },
  { value: "Tuesday", label: "Mardi" },
  { value: "Wednesday", label: "Mercredi" },
  { value: "Thursday", label: "Jeudi" },
  { value: "Friday", label: "Vendredi" },
  { value: "Saturday", label: "Samedi" },
  { value: "Sunday", label: "Dimanche" },
];

type Restaurant = {
  id: string; name: string; cuisine_type: string;
  target_food_cost_pct: number; digest_enabled?: boolean; digest_day?: string;
  address?: string; phone?: string; siret?: string; hide_po_prices?: boolean;
  service_start?: string | null; service_end?: string | null;
};
type Member = { id: string; email: string; role: string; status: string; created_at: string };

// Les tags sont gérés dans /categories (même rôle : classer les produits).
type Tab = "restaurant" | "digest" | "compte" | "utilisateurs";

// Rôles des membres d'équipe (clé stockée en base → libellé affiché)
const MEMBER_ROLES: { value: string; label: string }[] = [
  { value: "admin",   label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "staff",   label: "Staff" },
];
const roleLabel = (r: string) => MEMBER_ROLES.find((x) => x.value === r)?.label ?? r;

interface Props { restaurant: Restaurant; email: string; initialMembers: Member[] }

export default function SettingsClient({ restaurant, email, initialMembers }: Props) {
  const confirm = useConfirm();
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("restaurant");

  // --- Restaurant form ---
  const [form, setForm] = useState({
    name: restaurant.name,
    cuisine_type: restaurant.cuisine_type,
    target_food_cost_pct: String(restaurant.target_food_cost_pct),
    digest_enabled: restaurant.digest_enabled ?? true,
    digest_day: restaurant.digest_day ?? "Monday",
    address: restaurant.address ?? "",
    phone: restaurant.phone ?? "",
    siret: restaurant.siret ?? "",
    hide_po_prices: restaurant.hide_po_prices ?? false,
    // Horaires de service : servent à dire si une livraison ou un inventaire
    // a lieu avant, pendant ou après le service.
    service_start: (restaurant.service_start ?? DEFAULT_SERVICE_START).slice(0, 5),
    service_end: (restaurant.service_end ?? DEFAULT_SERVICE_END).slice(0, 5),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSaveRestaurant() {
    setSaveError(null);
    if (!form.name.trim()) { setSaveError("Le nom du restaurant est obligatoire."); return; }
    const pct = parseFloat(form.target_food_cost_pct);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      // Un champ vidé donnait NaN → objectif nul → tous les plats signalés
      // « hors objectif » dans le récap hebdo.
      setSaveError("L'objectif de food cost doit être un nombre entre 1 et 100 %.");
      return;
    }
    const day = DAYS.some((d) => d.value === form.digest_day) ? form.digest_day : "Monday";
    if (parseHHMM(form.service_start) === null || parseHHMM(form.service_end) === null) {
      setSaveError("Les horaires de service doivent être au format 11:30.");
      return;
    }

    setSaving(true); setSaved(false);
    const { error } = await supabase.from("restaurants").update({
      name: form.name.trim(),
      cuisine_type: form.cuisine_type,
      target_food_cost_pct: pct,
      digest_enabled: form.digest_enabled,
      digest_day: day,
      address: form.address || null,
      phone: form.phone || null,
      siret: form.siret || null,
      hide_po_prices: form.hide_po_prices,
      service_start: form.service_start,
      service_end: form.service_end,
    }).eq("id", restaurant.id);
    setSaving(false);
    // Sans ce contrôle, l'écran affichait « Enregistré ✓ » même en cas d'échec.
    if (error) { setSaveError(`Enregistrement impossible : ${error.message}`); return; }
    setForm((f) => ({ ...f, digest_day: day }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // --- Account ---
  const [sendingReset, setSendingReset] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  async function handleResetPassword() {
    setSendingReset(true); setPwdMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
    });
    setSendingReset(false);
    setPwdMsg(error ? "Échec de l'envoi. Réessaie." : "Email de réinitialisation envoyé ✓ — vérifie ta boîte mail.");
  }

  // --- Utilisateurs (membres d'équipe) ---
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);

  async function handleInviteMember() {
    setMemberError(null);
    const value = inviteEmail.trim().toLowerCase();
    if (!value) return setMemberError("L'email est requis.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setMemberError("Email invalide.");
    if (value === email.toLowerCase()) return setMemberError("Vous êtes déjà le propriétaire de ce compte.");
    if (members.find((m) => m.email.toLowerCase() === value)) {
      return setMemberError("Ce membre est déjà dans la liste.");
    }
    setInviting(true);
    const { data, error } = await supabase.from("restaurant_members").insert({
      restaurant_id: restaurant.id,
      email: value,
      role: inviteRole,
      status: "invited",
    }).select().single();
    if (error) {
      setMemberError(
        error.message.includes("restaurant_members")
          ? "La table « restaurant_members » n'existe pas encore — lance la migration Supabase (voir migrations.sql §10)."
          : error.message
      );
      setInviting(false);
      return;
    }
    setMembers((p) => [...p, data]);
    setInviteEmail("");
    setInviteRole("staff");
    setInviting(false);
  }

  async function handleChangeMemberRole(id: string, role: string) {
    const before = members.find((m) => m.id === id)?.role;
    setMembers((p) => p.map((m) => (m.id === id ? { ...m, role } : m)));
    const { error } = await supabase.from("restaurant_members").update({ role }).eq("id", id);
    if (error) {
      // Remettre l'ancien rôle : sinon l'écran affiche un rôle jamais enregistré.
      if (before) setMembers((p) => p.map((m) => (m.id === id ? { ...m, role: before } : m)));
      setMemberError(`Changement de rôle impossible : ${error.message}`);
    }
  }

  async function handleDeleteMember(id: string) {
    const who = members.find((m) => m.id === id)?.email ?? "ce membre";
    if (!(await confirm({
      title: `Retirer « ${who} » de l'équipe ?`,
      consequences: ["Cette personne perdra immédiatement l'accès au restaurant.", "Son compte n'est pas supprimé : tu peux la réinviter plus tard."],
      confirmLabel: "Retirer",
    }))) return;
    setMemberError(null);
    setDeletingMemberId(id);
    const { error } = await supabase.from("restaurant_members").delete().eq("id", id);
    setDeletingMemberId(null);
    if (error) { setMemberError(`Suppression impossible : ${error.message}`); return; }
    setMembers((p) => p.filter((m) => m.id !== id));
  }

  // Tags moved next to Categories (both classify products) — see /categories.
  const tabs: { key: Tab; label: string }[] = [
    { key: "restaurant",   label: "Restaurant" },
    { key: "compte",       label: "Compte" },
    { key: "utilisateurs", label: "Utilisateurs" },
    { key: "digest",       label: "Récap hebdo" },
  ];

  return (
    <div className="p-7 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Paramètres</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px",
              tab === key
                ? "border-green text-green"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Restaurant tab ── */}
      {tab === "restaurant" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Informations restaurant</h2>
            <div className="space-y-4">
              <Input
                label="Nom du restaurant"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Type de cuisine"
                  value={form.cuisine_type}
                  onChange={(e) => setForm({ ...form, cuisine_type: e.target.value })}
                >
                  {CUISINE_TYPES.map((c) => <option key={c}>{c}</option>)}
                </Select>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Objectif food cost %</label>
                  <div className="relative">
                    <input
                      type="number" min="1" max="100" step="0.1"
                      value={form.target_food_cost_pct}
                      onChange={(e) => setForm({ ...form, target_food_cost_pct: e.target.value })}
                      className="w-full px-3 py-2 pr-7 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Horaires de service</h2>
            <p className="text-xs text-gray-500 mb-4">
              Servent à savoir automatiquement si une livraison ou un inventaire a lieu <b>avant</b>, <b>pendant</b> ou <b>après</b> le service —
              pour que les stocks soient affectés dans le bon ordre. Tu peux toujours corriger au cas par cas.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Début du service</label>
                <input type="time" value={form.service_start}
                  onChange={(e) => setForm({ ...form, service_start: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Fin du service</label>
                <input type="time" value={form.service_end}
                  onChange={(e) => setForm({ ...form, service_end: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition" />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Exemple : une livraison enregistrée à 8 h est « {serviceMomentLabel(detectServiceMoment(new Date(2026, 0, 1, 8, 0), form.service_start, form.service_end)).toLowerCase()} ».
              Si ton service finit après minuit, indique par exemple 11:30 → 01:00.
            </p>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Coordonnées</h2>
            <p className="text-xs text-gray-500 mb-4">Ces informations apparaissent sur vos bons de commande PDF.</p>
            <div className="space-y-3">
              <Input
                label="Adresse"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="12 rue de la Paix, 75001 Paris"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Téléphone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+33 1 23 45 67 89"
                />
                <Input
                  label="SIRET"
                  value={form.siret}
                  onChange={(e) => setForm({ ...form, siret: e.target.value })}
                  placeholder="123 456 789 00012"
                />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Bons de commande</h2>
            <p className="text-xs text-gray-500 mb-4">
              Réglage par défaut. Tu pourras toujours le changer <b>commande par commande</b> depuis la liste des bons de commande.
            </p>
            {/* Tout le bloc est le bouton : avant, cliquer sur le texte ne
                faisait rien alors que le curseur indiquait le contraire. */}
            <button
              type="button"
              role="switch"
              aria-checked={form.hide_po_prices}
              onClick={() => setForm({ ...form, hide_po_prices: !form.hide_po_prices })}
              className="w-full flex items-start gap-3 text-left cursor-pointer rounded-lg p-1 -m-1 hover:bg-gray-50 transition"
            >
              <span
                aria-hidden="true"
                className={clsx("mt-0.5 relative w-10 h-6 rounded-full transition shrink-0", form.hide_po_prices ? "bg-primary" : "bg-gray-300")}
              >
                <span className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform", form.hide_po_prices && "translate-x-4")} />
              </span>
              <span>
                <span className="block text-sm font-medium text-gray-800">Masquer les prix sur les bons de commande</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {form.hide_po_prices
                    ? "Actuellement : le PDF et l'email n'affichent que les produits et quantités — sans prix unitaires, TVA ni total."
                    : "Actuellement : les prix, la TVA et le total figurent sur le PDF et dans l'email au fournisseur."}
                </span>
              </span>
            </button>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Compte</h2>
            <p className="text-xs text-gray-400 mb-3">L&apos;email ne peut pas être modifié ici.</p>
            <Input label="Email" value={email} disabled />
          </Card>

          <Button
            variant="primary"
            onClick={handleSaveRestaurant}
            disabled={saving}
          >
            {saved ? <><Check size={13} /> Enregistré</> : saving ? "Enregistrement…" : "Enregistrer les paramètres"}
          </Button>
        </div>
      )}

      {/* ── Compte tab ── */}
      {tab === "compte" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Mon compte</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email de connexion</label>
                <div className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                  <Mail size={15} className="text-gray-400" /> {email}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Mot de passe</label>
                <p className="text-xs text-gray-500 mb-2">Pour des raisons de sécurité, le changement se fait par email.</p>
                <Button variant="secondary" onClick={handleResetPassword} disabled={sendingReset}>
                  {sendingReset ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {sendingReset ? "Envoi…" : "Réinitialiser le mot de passe"}
                </Button>
                {pwdMsg && <p className="text-xs text-emerald-600 mt-2">{pwdMsg}</p>}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Session</h2>
            <p className="text-xs text-gray-500 mb-3">Déconnecte-toi de cet appareil.</p>
            <form action={logout}>
              <button type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition">
                <LogOut size={14} /> Se déconnecter
              </button>
            </form>
          </Card>
        </div>
      )}

      {/* ── Utilisateurs tab ── */}
      {tab === "utilisateurs" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Utilisateurs</h2>
            <p className="text-xs text-gray-500 mb-5">
              Invitez votre équipe (manager, cuisine, salle) à ce restaurant. Pour l&apos;instant c&apos;est un annuaire d&apos;équipe : les membres invités n&apos;ont pas encore d&apos;accès de connexion partagé — cela viendra dans une prochaine étape.
            </p>

            {/* Invite form */}
            <div className="flex gap-2 items-end mb-5">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email du membre</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInviteMember()}
                  placeholder="manager@restaurant.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
                />
              </div>
              <Select
                label="Rôle"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-36"
              >
                {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
              <Button variant="primary" onClick={handleInviteMember} disabled={inviting}>
                {inviting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                Inviter
              </Button>
            </div>

            {memberError && <Alert variant="error">{memberError}</Alert>}

            {/* Owner + members list */}
            <div className="mt-1 divide-y divide-gray-100">
              {/* Owner row (toujours en premier, non modifiable) */}
              <div className="flex items-center justify-between px-3 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                    <Shield size={15} className="text-emerald-600" />
                  </div>
                  <span className="text-sm text-gray-800 truncate">{email}</span>
                </div>
                <Badge variant="green">Propriétaire</Badge>
              </div>

              {/* Invited members */}
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-3 py-3 group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <Mail size={14} className="text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{m.email}</p>
                      {m.status === "invited" && <p className="text-2xs text-amber-600 mt-0.5">Invité — en attente</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeMemberRole(m.id, e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition appearance-none"
                    >
                      {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <button
                      onClick={() => handleDeleteMember(m.id)}
                      disabled={deletingMemberId === m.id}
                      className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                    >
                      {deletingMemberId === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              ))}

              {members.length === 0 && (
                <div className="py-8 text-center">
                  <Users size={28} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-500">Aucun membre invité. Ajoutez votre équipe ci-dessus.</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── Digest tab ── */}
      {tab === "digest" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Email récapitulatif hebdomadaire</h2>
            <p className="text-xs text-gray-500 mb-5">
              Un résumé hebdomadaire envoyé à {email} : food cost moyen, plats hors objectif, plus fortes hausses de prix depuis les livraisons validées, et le plat le moins rentable.
            </p>

            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-800">Activer le récapitulatif</p>
                <p className="text-xs text-gray-400 mt-0.5">Désactivez pour arrêter les emails hebdomadaires</p>
              </div>
              <button
                onClick={() => setForm({ ...form, digest_enabled: !form.digest_enabled })}
                className={clsx(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  form.digest_enabled ? "bg-primary" : "bg-gray-200"
                )}
              >
                <span className={clsx(
                  "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  form.digest_enabled ? "translate-x-6" : "translate-x-1"
                )} />
              </button>
            </div>

            {form.digest_enabled && (
              <div className="pt-4">
                <Select
                  label="Envoyer le"
                  value={form.digest_day}
                  onChange={(e) => setForm({ ...form, digest_day: e.target.value })}
                  className="w-48"
                >
                  {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </Select>
              </div>
            )}
          </Card>

          {saveError && <Alert variant="error">{saveError}</Alert>}
          <Button variant="primary" onClick={handleSaveRestaurant} disabled={saving}>
            {saved ? <><Check size={13} /> Enregistré</> : saving ? "Enregistrement…" : "Enregistrer les paramètres"}
          </Button>
        </div>
      )}
    </div>
  );
}
