-- =====================================================================
--  INVENTAIRE : comptage des mises en place et des recettes.
--  - Les MEP comptées sont converties en équivalents ingrédients.
--  - Les recettes ne sont comptables que si activées (bouton sur la fiche).
--  À exécuter une fois dans Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- Recette comptable à l'inventaire (facultatif, désactivé par défaut)
alter table recipes add column if not exists countable_in_inventory boolean not null default false;

-- Les lignes d'inventaire peuvent référencer une MEP/recette comptée
alter table inventory_lines add column if not exists recipe_id uuid references recipes(id) on delete set null;

-- Vérification
select 'ok' as info,
  (select count(*) from recipes where countable_in_inventory) as recettes_activees;
