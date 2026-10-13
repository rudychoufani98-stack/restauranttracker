// =====================================================================
//  Quel modèle Gemini appeler, quand celui qu'on visait est saturé.
//
//  Relevé en production le 13 octobre 2026 : `gemini-3.6-flash` a
//  renvoyé « This model is currently experiencing high demand » trois
//  fois de suite, et la lecture d'une facture devenait impossible alors
//  que le compte avait d'autres modèles sous la main.
//
//  Plutôt que d'écrire en dur une liste de noms — qui vieillit, et dont
//  rien ne garantit qu'ils soient servis à CE compte — on demande à
//  l'API ce qu'elle propose. C'est elle qui sait.
// =====================================================================

const LISTE = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200";

/** Modèles qui ne savent pas lire une facture, quoi qu'en dise leur nom. */
const HORS_SUJET = [
  "embedding", "aqa", "imagen", "veo", "tts", "audio", "image-generation",
  "learnlm", "gemma", // utiles ailleurs, pas pour de la vision documentaire
];

/**
 * Le rang d'un modèle : plus petit = essayé plus tôt.
 *
 * On préfère un « flash » — rapide et bon marché pour de la lecture de
 * document — puis un « pro ». À génération égale, la plus récente
 * d'abord, ce que l'ordre alphabétique inverse donne correctement
 * (3.6 avant 2.5).
 */
function rang(nom: string): number {
  const n = nom.toLowerCase();
  let r = n.includes("flash") ? 0 : n.includes("pro") ? 100 : 200;
  // Les variantes « lite » lisent moins bien une page dense.
  if (n.includes("lite")) r += 10;
  if (n.includes("preview") || n.includes("exp")) r += 20;
  return r;
}

// Le cache est indexé PAR CLÉ : deux comptes n'ont pas forcément les
// mêmes modèles, et une clé changée doit redécouvrir les siens.
const cache = new Map<string, { noms: string[]; expire: number }>();

/**
 * Les modèles de ce compte capables de `generateContent`, du plus
 * indiqué au moins indiqué. Mis en cache dix minutes : la liste ne
 * change pas d'une facture à l'autre, et on ne va pas la redemander à
 * chaque échec.
 */
export async function modelesDisponibles(apiKey: string): Promise<string[]> {
  const connu = cache.get(apiKey);
  if (connu && connu.expire > Date.now()) return connu.noms;

  const res = await fetch(LISTE, {
    headers: { "x-goog-api-key": apiKey.trim() },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ListModels ${res.status}`);
  const json = await res.json();

  const noms: string[] = ((json?.models ?? []) as any[])
    .filter((m) => (m?.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => String(m.name ?? "").replace(/^models\//, ""))
    .filter((n) => n && !HORS_SUJET.some((mot) => n.toLowerCase().includes(mot)))
    .sort((a, b) => rang(a) - rang(b) || b.localeCompare(a));

  cache.set(apiKey, { noms, expire: Date.now() + 10 * 60 * 1000 });
  return noms;
}

/**
 * L'ordre dans lequel essayer les modèles : le préféré d'abord, puis ce
 * que le compte propose. Si la liste est inaccessible, on garde au
 * moins le préféré — un échec de découverte ne doit pas empêcher
 * l'essai qui aurait peut-être marché.
 */
export async function ordreDEssai(apiKey: string, prefere: string, combien = 3): Promise<string[]> {
  let autres: string[] = [];
  try {
    autres = await modelesDisponibles(apiKey);
  } catch {
    return [prefere];
  }
  const suite = autres.filter((n) => n !== prefere);
  return [prefere, ...suite].slice(0, combien);
}
