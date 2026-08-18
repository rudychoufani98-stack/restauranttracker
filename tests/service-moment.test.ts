// =====================================================================
//  Détection du moment de service (avant / pendant / après).
// =====================================================================
import { describe, it, expect } from "vitest";
import { detectServiceMoment, parseHHMM, toDatetimeLocal, serviceMomentShort } from "@/lib/service-moment";

const at = (h: number, m = 0) => new Date(2026, 7, 18, h, m, 0);

describe("Lecture d'une heure", () => {
  it("accepte HH:MM et HH:MM:SS (format Postgres)", () => {
    expect(parseHHMM("11:30")).toBe(690);
    expect(parseHHMM("23:00:00")).toBe(1380);
    expect(parseHHMM("09:05")).toBe(545);
  });
  it("refuse une heure illisible", () => {
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM("midi")).toBeNull();
  });
});

describe("Service classique (11:30 → 23:00)", () => {
  const S = "11:30", E = "23:00";
  it("livraison du matin → avant le service", () => {
    expect(detectServiceMoment(at(7, 45), S, E)).toBe("avant");
    expect(detectServiceMoment(at(11, 29), S, E)).toBe("avant");
  });
  it("comptage en plein service → pendant", () => {
    expect(detectServiceMoment(at(11, 30), S, E)).toBe("pendant");
    expect(detectServiceMoment(at(14, 0), S, E)).toBe("pendant");
    expect(detectServiceMoment(at(23, 0), S, E)).toBe("pendant");
  });
  it("inventaire de fermeture → après le service", () => {
    expect(detectServiceMoment(at(23, 1), S, E)).toBe("apres");
    expect(detectServiceMoment(at(23, 59), S, E)).toBe("apres");
  });
});

describe("Service qui finit après minuit (11:30 → 01:00)", () => {
  const S = "11:30", E = "01:00";
  it("2 h du matin est en dehors du service", () => {
    expect(detectServiceMoment(at(2, 0), S, E)).toBe("avant");
  });
  it("minuit trente est encore pendant le service", () => {
    expect(detectServiceMoment(at(0, 30), S, E)).toBe("pendant");
    expect(detectServiceMoment(at(23, 30), S, E)).toBe("pendant");
  });
  it("le matin reste avant le service", () => {
    expect(detectServiceMoment(at(9, 0), S, E)).toBe("avant");
  });
});

describe("Réglages absents", () => {
  it("retombe sur 11:30 → 23:00 par défaut", () => {
    expect(detectServiceMoment(at(8, 0), null, null)).toBe("avant");
    expect(detectServiceMoment(at(20, 0), null, null)).toBe("pendant");
    expect(detectServiceMoment(at(23, 30), undefined, undefined)).toBe("apres");
  });
});

describe("Affichage", () => {
  it("libellés courts", () => {
    expect(serviceMomentShort("avant")).toBe("avant service");
    expect(serviceMomentShort("apres")).toBe("après service");
    expect(serviceMomentShort(null)).toBe("—");
  });
  it("valeur pour un champ date+heure (heure locale, jamais UTC)", () => {
    expect(toDatetimeLocal(new Date(2026, 0, 5, 7, 5))).toBe("2026-01-05T07:05");
    expect(toDatetimeLocal(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31T23:59");
  });
});
