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
-- 6) Seuil de réapprovisionnement par ingrédient (en unité de base g/ml/pièce)
--    Alerte "à commander" quand stock_qty <= reorder_threshold.
-- ---------------------------------------------------------------------
alter table ingredients add column if not exists reorder_threshold numeric not null default 0;

-- ---------------------------------------------------------------------
-- 7) Multi-fournisseurs par ingrédient (façon Yokitup)
--    Un même ingrédient peut être acheté chez plusieurs fournisseurs,
--    chacun avec son prix, son conditionnement et sa référence article
--    (le code à mettre sur le bon de commande). Le coût des recettes
--    suit le CMUP réel ; ces références servent au sourcing + aux BDC.
-- ---------------------------------------------------------------------
-- Référence du fournisseur "principal" (déjà sur l'ingrédient via supplier_id)
alter table ingredients add column if not exists supplier_reference text;

create table if not exists ingredient_suppliers (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_reference text,
  pack_units numeric not null default 1,
  unit_size  numeric not null default 1,
  unit text not null default 'kg',
  pack_price numeric not null default 0,
  vat_rate numeric not null default 0,
  is_preferred boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingredient_suppliers_ingredient on ingredient_suppliers(ingredient_id);

-- Libellé de conditionnement libre par article (ex. "75 cl / bouteille", "sac 18 kg")
alter table ingredient_suppliers add column if not exists pack_label text;
-- Type de conditionnement de commande (colis, caisse, carton, sac, bidon…)
alter table ingredient_suppliers add column if not exists pack_type text not null default 'colis';

-- Fournisseurs : franco (montant mini pour livraison gratuite) + référence client
alter table suppliers add column if not exists min_order_amount numeric not null default 0;
alter table suppliers add column if not exists customer_reference text;

alter table ingredient_suppliers enable row level security;
drop policy if exists rls_ingredient_suppliers on ingredient_suppliers;
create policy rls_ingredient_suppliers on ingredient_suppliers
  for all
  using (exists (select 1 from ingredients i where i.id = ingredient_suppliers.ingredient_id and owns_restaurant(i.restaurant_id)))
  with check (exists (select 1 from ingredients i where i.id = ingredient_suppliers.ingredient_id and owns_restaurant(i.restaurant_id)));

-- ---------------------------------------------------------------------
-- 8) Nettoyage : supprime les recettes de test "Grilled Chicken"
--    (et leurs lignes via la FK on delete cascade).
-- ---------------------------------------------------------------------
delete from recipes where name = 'Grilled Chicken';

-- ---------------------------------------------------------------------
-- 9) Sessions d'inventaire — chaque prise d'inventaire est archivée
--    (date + lignes comptées) pour pouvoir la reconsulter ensuite.
-- ---------------------------------------------------------------------
create table if not exists inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  items_counted int not null default 0,
  manquant_value numeric not null default 0,
  surplus_value numeric not null default 0,
  net_value numeric not null default 0,
  notes text
);
create table if not exists inventory_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references inventory_sessions(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  ingredient_name text,
  unit text,
  theoretical_qty numeric,
  counted_qty numeric,
  ecart numeric,
  cmup numeric,
  ecart_value numeric
);
create index if not exists idx_inventory_lines_session on inventory_lines(session_id);

alter table inventory_sessions enable row level security;
drop policy if exists rls_inventory_sessions on inventory_sessions;
create policy rls_inventory_sessions on inventory_sessions for all
  using (owns_restaurant(restaurant_id)) with check (owns_restaurant(restaurant_id));

alter table inventory_lines enable row level security;
drop policy if exists rls_inventory_lines on inventory_lines;
create policy rls_inventory_lines on inventory_lines for all
  using (exists (select 1 from inventory_sessions s where s.id = inventory_lines.session_id and owns_restaurant(s.restaurant_id)))
  with check (exists (select 1 from inventory_sessions s where s.id = inventory_lines.session_id and owns_restaurant(s.restaurant_id)));

-- =====================================================================
-- Rappel : lance aussi supabase/security.sql (RLS) si ce n'est pas fait.
-- =====================================================================
