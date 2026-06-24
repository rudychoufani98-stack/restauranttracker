-- =====================================================================
--  MIGRATIONS — à exécuter UNE FOIS dans Supabase → SQL Editor.
--  Idempotent : peut être relancé sans danger.
--  Regroupe toutes les évolutions de schéma pour éviter les oublis.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Mises en place : sépare les sous-recettes des plats vendus
--    (DÉBLOQUE Menu / Recettes / Rentabilité / Dashboard)
-- ---------------------------------------------------------------------
alter table recipes add column if not exists is_prep boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) Pertes : enregistrement du gaspillage / casse
-- ---------------------------------------------------------------------
-- Colonnes pour tracer la raison + une note libre sur les mouvements
alter table stock_movements add column if not exists loss_reason text;
alter table stock_movements add column if not exists notes text;

-- Autoriser le type de mouvement "loss" (en plus de in/out/adjustment)
do $$
begin
  alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
exception when others then null;
end $$;

alter table stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in ('in', 'out', 'adjustment', 'loss'));

-- ---------------------------------------------------------------------
-- 3) Conditionnement / rendement des recettes & mises en place
--    yield_portions = quantité produite ; yield_unit = unité de cette
--    quantité (portion / g / kg / ml / l / piece). Permet à une MEP de
--    produire "2 kg" et à une FT d'en consommer "100 g" au prorata réel.
-- ---------------------------------------------------------------------
alter table recipes add column if not exists yield_unit text not null default 'portion';

do $$
begin
  alter table recipes drop constraint if exists recipes_yield_unit_check;
exception when others then null;
end $$;

alter table recipes
  add constraint recipes_yield_unit_check
  check (yield_unit in ('portion', 'g', 'kg', 'ml', 'l', 'piece'));

-- ---------------------------------------------------------------------
-- 4) Allergènes (14 allergènes réglementaires UE)
--    Source : sur l'ingrédient. La recette hérite (calcul auto).
-- ---------------------------------------------------------------------
alter table ingredients add column if not exists allergens text[] not null default '{}';
alter table recipes     add column if not exists allergens text[] not null default '{}';

-- ---------------------------------------------------------------------
-- 5) Conditionnement d'achat détaillé des ingrédients (façon Yokitup)
--    pack_units  = nb de sous-unités par colis (6 bouteilles, 30 œufs, 1 sac)
--    unit_size   = contenance d'une sous-unité, exprimée dans `unit`
--    yield_pct   = rendement matière % (perte épluchage/parage)
--    pack_quantity reste = pack_units * unit_size (total du colis dans `unit`),
--    pour préserver la logique des commandes/réceptions.
-- ---------------------------------------------------------------------
alter table ingredients add column if not exists pack_units numeric not null default 1;
alter table ingredients add column if not exists unit_size  numeric not null default 1;
alter table ingredients add column if not exists yield_pct  numeric not null default 100;

-- Backfill : reprendre l'ancien "quantité par colis" comme contenance unitaire.
update ingredients set unit_size = pack_quantity
  where pack_quantity is not null and pack_units = 1 and unit_size = 1;

-- ---------------------------------------------------------------------
-- 6) Nettoyage : supprime les recettes de test "Grilled Chicken"
--    (et leurs lignes via la FK on delete cascade).
-- ---------------------------------------------------------------------
delete from recipes where name = 'Grilled Chicken';

-- =====================================================================
-- Rappel : lance aussi supabase/security.sql (RLS) si ce n'est pas fait.
-- =====================================================================
