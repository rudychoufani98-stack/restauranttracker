// =====================================================================
//  Moment de service : avant / pendant / après.
//
//  Un inventaire compté avant le service et un inventaire compté après ne
//  décrivent pas le même stock ; une livraison reçue le matin sert au
//  service du jour, pas celle reçue le soir. On détecte donc le moment à
//  partir de l'heure réelle de l'événement, et l'utilisateur peut corriger.
// =====================================================================

export type ServiceMoment = "avant" | "pendant" | "apres";

export const SERVICE_MOMENTS: { value: ServiceMoment; label: string; hint: string }[] = [
  { value: "avant",   label: "Avant le service",  hint: "Le service du jour n'a pas encore consommé de stock." },
  { value: "pendant", label: "Pendant le service", hint: "Le service est en cours : le stock bouge encore." },
  { value: "apres",   label: "Après le service",  hint: "Le service du jour est terminé et déjà consommé." },
];

export const DEFAULT_SERVICE_START = "11:30";
export const DEFAULT_SERVICE_END = "23:00";

/** "11:30" ou "11:30:00" → minutes depuis minuit. Renvoie null si illisible. */
export function parseHHMM(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Détecte le moment de service d'une date donnée.
 * Avant l'ouverture → "avant" ; après la fermeture → "apres" ; sinon "pendant".
 * Un service qui finit après minuit (ex. 11:30 → 01:00) est géré.
 */
export function detectServiceMoment(
  when: Date,
  serviceStart?: string | null,
  serviceEnd?: string | null,
): ServiceMoment {
  const start = parseHHMM(serviceStart) ?? parseHHMM(DEFAULT_SERVICE_START)!;
  const end = parseHHMM(serviceEnd) ?? parseHHMM(DEFAULT_SERVICE_END)!;
  const t = when.getHours() * 60 + when.getMinutes();

  // Service à cheval sur minuit : « pendant » = de start à 23h59 puis de 0h à end.
  if (end < start) return t >= start || t <= end ? "pendant" : "avant";

  if (t < start) return "avant";
  if (t > end) return "apres";
  return "pendant";
}

export function serviceMomentLabel(m?: string | null): string {
  return SERVICE_MOMENTS.find((x) => x.value === m)?.label ?? "—";
}

/** Court, pour les tableaux et les exports. */
export function serviceMomentShort(m?: string | null): string {
  if (m === "avant") return "avant service";
  if (m === "pendant") return "pendant service";
  if (m === "apres") return "après service";
  return "—";
}

/** Valeur pour un <input type="datetime-local"> (heure locale, sans fuseau). */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
