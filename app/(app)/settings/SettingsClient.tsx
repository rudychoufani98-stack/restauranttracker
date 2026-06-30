"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, Plus, Trash2, Tag, Mail, KeyRound, LogOut, Loader2, Users, UserPlus, Shield } from "lucide-react";
import { Card, Button, Input, Select, Alert, Badge } from "@/components/ui";
import { logout } from "@/app/auth/actions";
import clsx from "clsx";

const CUISINE_TYPES = ["Française", "Italienne", "Japonaise", "Méditerranéenne", "Mexicaine", "Indienne", "Américaine", "Autre"];
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const TAG_COLORS = [
  { label: "Gray",    value: "#6B7280" },
  { label: "Red",     value: "#EF4444" },
  { label: "Orange",  value: "#F97316" },
  { label: "Amber",   value: "#F59E0B" },
  { label: "Green",   value: "#10B981" },
  { label: "Teal",    value: "#14B8A6" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Violet",  value: "#8B5CF6" },
  { label: "Pink",    value: "#EC4899" },
];

type Restaurant = {
  id: string; name: string; cuisine_type: string;
  target_food_cost_pct: number; digest_enabled?: boolean; digest_day?: string;
  address?: string; phone?: string; siret?: string;
};
type Tag = { id: string; name: string; color: string };
type Member = { id: string; email: string; role: string; status: string; created_at: string };

type Tab = "restaurant" | "tags" | "digest" | "compte" | "utilisateurs";

// Rôles des membres d'équipe (clé stockée en base → libellé affiché)
const MEMBER_ROLES: { value: string; label: string }[] = [
  { value: "admin",   label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "staff",   label: "Staff" },
];
const roleLabel = (r: string) => MEMBER_ROLES.find((x) => x.value === r)?.label ?? r;

interface Props { restaurant: Restaurant; email: string; initialTags: Tag[]; initialMembers: Member[] }

export default function SettingsClient({ restaurant, email, initialTags, initialMembers }: Props) {
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
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSaveRestaurant() {
    setSaving(true); setSaved(false);
    await supabase.from("restaurants").update({
      name: form.name,
      cuisine_type: form.cuisine_type,
      target_food_cost_pct: parseFloat(form.target_food_cost_pct),
      digest_enabled: form.digest_enabled,
      digest_day: form.digest_day,
      address: form.address || null,
      phone: form.phone || null,
      siret: form.siret || null,
    }).eq("id", restaurant.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // --- Tags ---
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[4].value); // green default
  const [tagError, setTagError] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

  async function handleAddTag() {
    setTagError(null);
    if (!newTagName.trim()) return setTagError("Le nom du tag est requis.");
    if (tags.find((t) => t.name.toLowerCase() === newTagName.trim().toLowerCase())) {
      return setTagError("Un tag avec ce nom existe déjà.");
    }
    setAddingTag(true);
    const { data, error } = await supabase.from("tags").insert({
      restaurant_id: restaurant.id,
      name: newTagName.trim(),
      color: newTagColor,
    }).select().single();
    if (error) { setTagError(error.message); setAddingTag(false); return; }
    setTags((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTagName("");
    setAddingTag(false);
  }

  async function handleDeleteTag(id: string) {
    setDeletingTagId(id);
    await supabase.from("tags").delete().eq("id", id);
    setTags((p) => p.filter((t) => t.id !== id));
    setDeletingTagId(null);
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
    setMembers((p) => p.map((m) => (m.id === id ? { ...m, role } : m)));
    await supabase.from("restaurant_members").update({ role }).eq("id", id);
  }

  async function handleDeleteMember(id: string) {
    setDeletingMemberId(id);
    await supabase.from("restaurant_members").delete().eq("id", id);
    setMembers((p) => p.filter((m) => m.id !== id));
    setDeletingMemberId(null);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "restaurant",   label: "Restaurant" },
    { key: "compte",       label: "Compte" },
    { key: "utilisateurs", label: "Utilisateurs" },
    { key: "tags",         label: "Tags" },
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
                      className="w-full px-3 py-2 pr-7 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>
              </div>
            </div>
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
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
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
                      className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition appearance-none"
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

      {/* ── Tags tab ── */}
      {tab === "tags" && (
        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Tags ingrédients</h2>
            <p className="text-xs text-gray-500 mb-5">
              Créez des tags pour organiser vos ingrédients — ex. &ldquo;Local&rdquo;, &ldquo;Saisonnier&rdquo;, &ldquo;Allergène&rdquo;, &ldquo;Premium&rdquo;. Vous pouvez en affecter plusieurs par ingrédient.
            </p>

            {/* Add new tag */}
            <div className="flex gap-2 items-end mb-5">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nom du tag</label>
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="ex. Saisonnier, Local, Allergène…"
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Couleur</label>
                <div className="flex gap-1.5 flex-wrap">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => setNewTagColor(c.value)}
                      className={clsx(
                        "w-6 h-6 rounded-full border-2 transition",
                        newTagColor === c.value ? "border-gray-900 scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>
              </div>
              <Button variant="primary" onClick={handleAddTag} disabled={addingTag}>
                <Plus size={13} /> Ajouter
              </Button>
            </div>

            {tagError && <Alert variant="error">{tagError}</Alert>}

            {/* Tag list */}
            {tags.length === 0 ? (
              <div className="py-8 text-center">
                <Tag size={28} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm text-gray-500">Aucun tag. Ajoutez-en un ci-dessus.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="text-sm text-gray-800">{tag.name}</span>
                      {/* Preview pill */}
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white opacity-80"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      disabled={deletingTagId === tag.id}
                      className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                  form.digest_enabled ? "bg-green" : "bg-gray-200"
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
                  {DAYS.map((d) => <option key={d}>{d}</option>)}
                </Select>
              </div>
            )}
          </Card>

          <Button variant="primary" onClick={handleSaveRestaurant} disabled={saving}>
            {saved ? <><Check size={13} /> Enregistré</> : saving ? "Enregistrement…" : "Enregistrer les paramètres"}
          </Button>
        </div>
      )}
    </div>
  );
}
