-- =====================================================================
--  Pertes de mises en place et de fiches techniques
--  À EXÉCUTER dans Supabase → SQL Editor. Idempotent (relançable).
--
--  Jeter 2 kg de sauce fait sortir du stock la tomate et l'huile qu'elle
--  contient : la perte s'écrit donc en PLUSIEURS mouvements, un par
--  ingrédient, reliés entre eux par `reference_id` (déjà existant).
--
--  Ces deux colonnes servent uniquement à réafficher la perte telle qu'elle
--  a été vécue en cuisine — « Sauce tomate — 2 kg » — au lieu des six lignes
--  d'ingrédients qui n'apprennent rien au chef.
-- =====================================================================

alter table stock_movements
  add column if not exists recipe_id uuid references recipes(id) on delete set null;

-- Quantité perdue dans l'unité de la fiche (2 kg de sauce, 3 portions…).
alter table stock_movements
  add column if not exists recipe_qty numeric;

-- L'historique des pertes regroupe par reference_id : un index évite de
-- balayer toute la table quand l'historique s'allonge.
create index if not exists idx_stock_movements_reference
  on stock_movements(restaurant_id, reference_type, reference_id);

-- Confirmation
select column_name
from information_schema.columns
where table_name = 'stock_movements'
  and column_name in ('recipe_id', 'recipe_qty');
