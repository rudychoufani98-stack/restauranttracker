-- =====================================================================
--  À EXÉCUTER UNE FOIS dans Supabase → SQL Editor (bouton "Run").
--  Regroupe toutes les migrations récentes. Idempotent (relançable sans
--  danger). NE contient PAS la remise à zéro des stocks (voir reset_stock.sql).
-- =====================================================================

-- 0) *** CRITIQUE *** Mouvements de stock : la contrainte sur reference_type
-- rejetait les valeurs utilisées par l'app ('delivery', 'invoice', 'sale'…),
-- donc AUCUN mouvement de stock n'était enregistré (échec silencieux).
do $$
begin
  alter table stock_movements drop constraint if exists stock_movements_reference_type_check;
exception when others then null;
end $$;

alter table stock_movements
  add constraint stock_movements_reference_type_check
  check (reference_type in (
    'delivery',    -- réception d'une commande
    'invoice',     -- ajustement à la facturation
    'sale',        -- déstockage des ventes
    'loss',        -- perte / casse
    'inventory',   -- écart d'inventaire
    'adjustment',  -- ajustement manuel
    'purchase',    -- (héritage)
    'manual'       -- (héritage)
  ));

-- 1) Masquer les prix sur le bon de commande (option Paramètres)
alter table restaurants add column if not exists hide_po_prices boolean not null default false;

-- 2) Facture : ligne "frais divers" (taxes alcool, livraison…)
alter table invoices add column if not exists misc_fees numeric not null default 0;
alter table invoices add column if not exists misc_fees_label text;

-- 3) Réception : numéro de bon de livraison (BL)
alter table delivery_notes add column if not exists bl_number text;

-- 4) Inventaire fournitures : type de fiche d'inventaire
alter table inventory_sessions add column if not exists kind text not null default 'food';

-- 4b) Ventes : canal (sur place / livraison) — permet 2 saisies par mois
alter table sales_periods add column if not exists channel text not null default 'dine_in';

-- 4c) Historique des commandes : journal des modifications de brouillon
create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  type text not null,           -- 'edited' | 'invoice_edited' | ...
  detail text,
  created_at timestamptz not null default now()
);
alter table order_events enable row level security;
drop policy if exists rls_order_events on order_events;
create policy rls_order_events on order_events for all
  using (owns_restaurant(restaurant_id)) with check (owns_restaurant(restaurant_id));
create index if not exists idx_order_events_po on order_events(po_id);

-- 5) Index de performance (filtres par restaurant + jointures)
create index if not exists idx_recipes_restaurant        on recipes(restaurant_id);
create index if not exists idx_ingredients_restaurant     on ingredients(restaurant_id);
create index if not exists idx_categories_restaurant      on categories(restaurant_id);
create index if not exists idx_suppliers_restaurant       on suppliers(restaurant_id);
create index if not exists idx_tags_restaurant            on tags(restaurant_id);
create index if not exists idx_purchase_orders_restaurant on purchase_orders(restaurant_id);
create index if not exists idx_sales_periods_restaurant   on sales_periods(restaurant_id);
create index if not exists idx_restaurants_owner          on restaurants(owner_id);
create index if not exists idx_recipe_lines_recipe        on recipe_lines(recipe_id);
create index if not exists idx_recipe_lines_sub_recipe    on recipe_lines(sub_recipe_id);
create index if not exists idx_recipe_lines_ingredient    on recipe_lines(ingredient_id);
create index if not exists idx_sales_lines_period         on sales_lines(period_id);
create index if not exists idx_stock_movements_rest_date  on stock_movements(restaurant_id, created_at desc);
create index if not exists idx_stock_movements_ingredient on stock_movements(ingredient_id);
create index if not exists idx_ingredient_suppliers_supplier on ingredient_suppliers(supplier_id);

-- ---------------------------------------------------------------------
--  Produits actifs / inactifs (voir aussi supabase/ingredient_actif.sql)
--  On ne supprime plus un produit : on le désactive. Il garde son
--  historique d'achat et ses mouvements, mais ne peut plus être ajouté
--  à une recette ou une mise en place.
-- ---------------------------------------------------------------------
alter table ingredients add column if not exists is_active boolean not null default true;
create index if not exists idx_ingredients_active on ingredients(restaurant_id, is_active);

-- ---------------------------------------------------------------------
--  Pertes de mises en place et de fiches techniques
--  (voir aussi supabase/perte_recette.sql)
--  Jeter 2 kg de sauce ecrit un mouvement par ingredient, relies par
--  reference_id. Ces colonnes permettent de reafficher « Sauce tomate —
--  2 kg » au lieu des lignes d'ingredients.
-- ---------------------------------------------------------------------
alter table stock_movements
  add column if not exists recipe_id uuid references recipes(id) on delete set null;
alter table stock_movements
  add column if not exists recipe_qty numeric;
create index if not exists idx_stock_movements_reference
  on stock_movements(restaurant_id, reference_type, reference_id);

-- ---------------------------------------------------------------------
--  References internes des produits + reference de caisse des recettes
--  (voir aussi supabase/references.sql)
-- ---------------------------------------------------------------------
alter table ingredients add column if not exists internal_ref integer;
create unique index if not exists idx_ingredients_internal_ref
  on ingredients(restaurant_id, internal_ref)
  where internal_ref is not null;

alter table categories add column if not exists ref_start integer;

alter table recipes add column if not exists pos_ref text;
create unique index if not exists idx_recipes_pos_ref
  on recipes(restaurant_id, lower(pos_ref))
  where pos_ref is not null and pos_ref <> '';
