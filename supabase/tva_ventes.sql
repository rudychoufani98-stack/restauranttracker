-- =====================================================================
--  TVA sur les ventes + seuils d'alerte de prix
--  À EXÉCUTER dans Supabase → SQL Editor. Idempotent (relançable).
--
--  POURQUOI : le coût d'un plat est en HT (prix d'achat fournisseur), son
--  prix de carte est en TTC. Diviser l'un par l'autre sous-estime TOUJOURS
--  le food cost. Un plat à 15 € avec 4 € de matière affichait 26,7 % alors
--  qu'il est à 29,3 % (TVA 10 %) — 2,6 points d'écart dans un métier où on
--  se bat pour un point.
--
--  Les taux sont RÉGLABLES et non codés en dur : la règle française dépend
--  du mode de consommation, elle change, et elle ne s'applique pas hors de
--  France. Les valeurs ci-dessous sont un point de départ à confirmer avec
--  un comptable.
-- =====================================================================

-- Consommation sur place
alter table restaurants add column if not exists vat_dine_in numeric not null default 10;
-- Vente à emporter
alter table restaurants add column if not exists vat_takeaway numeric not null default 5.5;
-- Livraison (plateformes ou en propre)
alter table restaurants add column if not exists vat_delivery numeric not null default 10;
-- Boissons alcoolisées : le taux ne dépend pas du mode de consommation
alter table restaurants add column if not exists vat_alcohol numeric not null default 20;

-- ---------------------------------------------------------------------
--  Seuils des alertes de prix (écran Statistiques → Évolution des prix)
-- ---------------------------------------------------------------------
-- Au-delà, le prix d'achat a « vraiment » augmenté depuis le premier achat
alter table restaurants add column if not exists alert_hausse_pct numeric not null default 10;
-- Au-delà, l'écart entre le bon de commande et la facture n'est plus un arrondi
alter table restaurants add column if not exists alert_facture_pct numeric not null default 2;
-- Au-delà, le coût utilisé par les recettes s'écarte trop du prix réel
alter table restaurants add column if not exists alert_cmup_pct numeric not null default 10;

-- ---------------------------------------------------------------------
--  Canal de vente « à emporter », en plus de sur place et livraison
-- ---------------------------------------------------------------------
do $$
begin
  alter table sales_periods drop constraint if exists sales_periods_channel_check;
exception when others then null;
end $$;

alter table sales_periods
  add constraint sales_periods_channel_check
  check (channel in ('dine_in', 'takeaway', 'delivery'));

-- =====================================================================
--  Vérification — doit renvoyer 7 lignes
-- =====================================================================
select column_name, column_default
from information_schema.columns
where table_name = 'restaurants'
  and column_name in (
    'vat_dine_in', 'vat_takeaway', 'vat_delivery', 'vat_alcohol',
    'alert_hausse_pct', 'alert_facture_pct', 'alert_cmup_pct'
  )
order by column_name;
