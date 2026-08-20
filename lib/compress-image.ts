// =====================================================================
//  Compression des photos avant envoi (bons de livraison).
//
//  Une photo de téléphone pèse 2 à 4 MB. Redimensionnée à 1 600 px de côté
//  et réencodée en JPEG, elle tombe à 200-400 KB en restant parfaitement
//  lisible (on doit pouvoir relire des quantités et des prix, pas admirer
//  la photo). Sur le plan gratuit Supabase — 1 GB de stockage — cela fait
//  passer l'autonomie de ~17 mois à plus de 10 ans pour un restaurant.
//
//  Un PDF fourni par le fournisseur n'est jamais touché : il est déjà léger
//  et le recompresser dégraderait un document officiel.
// =====================================================================

/** Taille maximale du plus grand côté, en pixels. */
export const MAX_COTE = 1600;
/** Qualité JPEG : 0,75 garde les chiffres nets pour un poids divisé par ~8. */
export const QUALITE = 0.75;
/** En dessous de ce poids, compresser n'apporte rien. */
export const SEUIL_OCTETS = 400 * 1024; // 400 KB

/** Faut-il tenter de compresser ce fichier ? (fonction pure, testable) */
export function doitCompresser(type: string, taille: number): boolean {
  if (!type.startsWith("image/")) return false;   // PDF : on n'y touche pas
  if (type === "image/gif") return false;         // animation : perdrait ses images
  return taille > SEUIL_OCTETS;
}

/** Dimensions cibles en respectant les proportions. */
export function dimensionsCibles(largeur: number, hauteur: number, maxCote = MAX_COTE) {
  const plusGrand = Math.max(largeur, hauteur);
  if (plusGrand <= maxCote) return { largeur, hauteur };
  const ratio = maxCote / plusGrand;
  return { largeur: Math.round(largeur * ratio), hauteur: Math.round(hauteur * ratio) };
}

/**
 * Compresse une image dans le navigateur. Renvoie TOUJOURS un fichier
 * utilisable : en cas de souci (format exotique, canvas indisponible), on
 * rend l'original plutôt que de bloquer une réception.
 */
export async function compresserImage(fichier: File): Promise<File> {
  if (!doitCompresser(fichier.type, fichier.size)) return fichier;
  if (typeof document === "undefined") return fichier;

  try {
    const bitmap = await createImageBitmap(fichier);
    const { largeur, hauteur } = dimensionsCibles(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fichier;
    ctx.drawImage(bitmap, 0, 0, largeur, hauteur);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITE)
    );
    if (!blob || blob.size === 0) return fichier;
    // Si la « compression » alourdit le fichier, on garde l'original.
    if (blob.size >= fichier.size) return fichier;

    const nom = fichier.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nom, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return fichier;
  }
}

/** « 2,4 MB » — pour dire à l'utilisateur ce qui a été gagné. */
export function poidsLisible(octets: number): string {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(octets / 1024)} KB`;
}
