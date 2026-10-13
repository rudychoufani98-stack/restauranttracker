// =====================================================================
//  Lire une facture fournisseur, et surtout la RAPPROCHER du catalogue.
//
//  Les designations ci-dessous sont celles relevees sur les factures
//  d Amaly : c est la ou le rapprochement se joue, pas dans la lecture.
// =====================================================================
import { describe, it, expect } from "vitest";
import { rapprocher, score, consigne, lireReponse, type Attendu } from "@/lib/scan-document";

const ATTENDUS: Attendu[] = [
  { ingredient_id: "hal", nom: "Halloumi", designations: ["FROMAGE GRILL & FRYKOLIOS 40x250G"] },
  { ingredient_id: "tah", nom: "Tahina", designations: ["TAHINE CHIRAG 18 KG"] },
  { ingredient_id: "poi", nom: "Pois chiche", designations: ["POIS CHICHE JOVA SAC 25KG"] },
];

describe("Reconnaître un produit sous le nom du fournisseur", () => {
  it("rapproche par la désignation imprimée, pas par le nom maison", () => {
    const { trouves, orphelines } = rapprocher(
      [
        { name: "FROMAGE GRILL & FRYKOLIOS 40X250G", quantity: 2, price: 95 },
        { name: "TAHINE CHIRAG 18 KG", quantity: 1, price: 68.5 },
      ],
      ATTENDUS,
    );
    expect(trouves.get("hal")).toMatchObject({ quantity: 2, price: 95 });
    expect(trouves.get("tah")).toMatchObject({ price: 68.5 });
    expect(orphelines).toHaveLength(0);
  });

  it("rapproche aussi par le nom maison quand le fournisseur l écrit", () => {
    const { trouves } = rapprocher([{ name: "Halloumi 10 kg", quantity: 1, price: 95 }], ATTENDUS);
    expect(trouves.get("hal")).toMatchObject({ price: 95 });
  });

  it("signale ce qu il n a pas su placer, au lieu de l inventer", () => {
    const { trouves, orphelines, manquants } = rapprocher(
      [{ name: "CONSIGNE PALETTE EUROPE", quantity: 1, price: 18 }],
      ATTENDUS,
    );
    expect(trouves.size).toBe(0);
    expect(orphelines.map((o) => o.name)).toEqual(["CONSIGNE PALETTE EUROPE"]);
    expect(manquants).toHaveLength(3);
  });

  it("ne sert chaque produit qu une fois", () => {
    const { trouves, orphelines } = rapprocher(
      [
        { name: "TAHINE CHIRAG 18 KG", quantity: 1, price: 68.5 },
        { name: "TAHINE CHIRAG 18 KG", quantity: 1, price: 70 },
      ],
      ATTENDUS,
    );
    expect(trouves.size).toBe(1);
    expect(trouves.get("tah")!.price).toBe(68.5);
    expect(orphelines).toHaveLength(1);
  });

  it("s abstient plutôt que de trancher entre deux candidats équivalents", () => {
    // Deux vins qui ne different que par le millesime : un mot commun
    // long suffirait a accrocher n importe lequel. On ne devine pas.
    const vins: Attendu[] = [
      { ingredient_id: "a", nom: "Ksara Merwah blanc 2023" },
      { ingredient_id: "b", nom: "Ksara Merwah blanc 2024" },
    ];
    const { trouves } = rapprocher([{ name: "KSARA MERWAH BLANC", quantity: 6, price: 12 }], vins);
    expect(trouves.size).toBe(0);
  });

  it("accepte la casse, les accents et la ponctuation du fournisseur", () => {
    expect(score("POIS-CHICHE JOVA, SAC 25KG", "POIS CHICHE JOVA SAC 25KG")).toBe(3);
    expect(score("Crème d'ail", "Creme d ail")).toBe(3);
  });

  it("ne s accroche pas à un mot de conditionnement", () => {
    // « colis », « sac », « kg » n identifient aucun produit.
    expect(score("COLIS 6 X 1 KG", "SAC 25 KG")).toBe(0);
  });
});

describe("Lire la réponse du modèle", () => {
  it("prend l objet complet : numéro, date, total, lignes", () => {
    const r = lireReponse(`Voici le résultat :
{"numero":"FA-2026-118","date":"2026-10-12","total_ht":292.8,
 "items":[{"name":"TAHINE CHIRAG 18 KG","quantity":1,"price":"68,50"}]}`);
    expect(r.numero).toBe("FA-2026-118");
    expect(r.date).toBe("2026-10-12");
    expect(r.total_ht).toBe(292.8);
    expect(r.items).toEqual([{ name: "TAHINE CHIRAG 18 KG", quantity: 1, price: 68.5 }]);
  });

  it("accepte l ancien format — un simple tableau de lignes", () => {
    const r = lireReponse(`[{"name":"Halloumi","quantity":2,"price":95}]`);
    expect(r.items).toHaveLength(1);
    expect(r.numero).toBeNull();
  });

  it("rend une lecture vide plutôt que de casser", () => {
    expect(lireReponse("je n'ai pas réussi à lire ce document").items).toEqual([]);
    expect(lireReponse("{ ceci n'est pas du json }").items).toEqual([]);
    expect(lireReponse("").items).toEqual([]);
  });

  it("écarte une date qui n est pas une date", () => {
    expect(lireReponse(`{"date":"12/10/2026","items":[]}`).date).toBeNull();
  });

  it("écarte une ligne sans nom", () => {
    expect(lireReponse(`{"items":[{"quantity":2,"price":9},{"name":"  "}]}`).items).toEqual([]);
  });
});

describe("La consigne envoyée au modèle", () => {
  it("dit de quel document il s agit et donne les désignations", () => {
    const c = consigne("facture", ATTENDUS);
    expect(c).toContain("INVOICE");
    expect(c).toContain("FROMAGE GRILL & FRYKOLIOS 40x250G");
    // Le piege a eviter : un prix de ligne pris pour un prix unitaire.
    expect(c).toContain("never the line total");
  });

  it("dit « bon de livraison » quand c en est un", () => {
    expect(consigne("bl", [])).toContain("DELIVERY NOTE");
  });
});
