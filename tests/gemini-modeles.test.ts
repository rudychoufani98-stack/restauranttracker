// =====================================================================
//  Choisir un modèle de lecture quand le modèle visé est saturé.
// =====================================================================
import { describe, it, expect, vi, afterEach } from "vitest";
import { ordreDEssai } from "@/lib/gemini-modeles";

const liste = (noms: string[]) => ({
  ok: true,
  json: async () => ({
    models: noms.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ["generateContent"] })),
  }),
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("L ordre d essai des modèles", () => {
  it("garde le modèle préféré en tête, puis propose les autres", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => liste([
      "gemini-3.6-flash", "gemini-3.6-pro", "gemini-2.5-flash",
    ])));
    const ordre = await ordreDEssai("k" + Math.random(), "gemini-3.6-flash");
    expect(ordre[0]).toBe("gemini-3.6-flash");
    expect(ordre).toHaveLength(3);
    expect(new Set(ordre).size).toBe(3); // jamais deux fois le même
  });

  it("préfère un flash à un pro, et une version récente à une ancienne", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => liste([
      "gemini-3.6-pro", "gemini-2.5-flash", "gemini-3.6-flash",
    ])));
    const ordre = await ordreDEssai("k" + Math.random(), "inexistant");
    expect(ordre[1]).toBe("gemini-3.6-flash");
    expect(ordre[2]).toBe("gemini-2.5-flash");
  });

  it("écarte ce qui ne sait pas lire une facture", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => liste([
      "text-embedding-004", "imagen-4.0", "veo-3.0", "gemini-3.6-flash",
    ])));
    const ordre = await ordreDEssai("k" + Math.random(), "gemini-3.6-flash");
    expect(ordre).toEqual(["gemini-3.6-flash"]);
  });

  it("repousse les variantes lite et preview derrière les modèles pleins", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => liste([
      "gemini-3.6-flash-lite", "gemini-3.6-flash-preview", "gemini-3.6-flash",
    ])));
    const ordre = await ordreDEssai("k" + Math.random(), "autre", 4);
    expect(ordre[1]).toBe("gemini-3.6-flash");
    expect(ordre[2]).toBe("gemini-3.6-flash-lite");
  });

  it("garde quand même le préféré quand la liste est inaccessible", async () => {
    // Une panne de découverte ne doit pas empêcher l essai qui aurait
    // peut-être marché.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
    expect(await ordreDEssai("k" + Math.random(), "gemini-3.6-flash")).toEqual(["gemini-3.6-flash"]);
  });

  it("n interroge l API qu une fois par clé, grâce au cache", async () => {
    const f = vi.fn(async () => liste(["gemini-3.6-flash", "gemini-3.6-pro"]));
    vi.stubGlobal("fetch", f);
    const cle = "cle-" + Math.random();
    await ordreDEssai(cle, "gemini-3.6-flash");
    await ordreDEssai(cle, "gemini-3.6-flash");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
