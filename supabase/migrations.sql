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

-- =====================================================================
-- Rappel : lance aussi supabase/security.sql (RLS) si ce n'est pas fait.
-- =====================================================================
