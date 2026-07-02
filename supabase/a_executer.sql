-- =====================================================================
--  À EXÉCUTER UNE FOIS dans Supabase → SQL Editor (bouton "Run").
--  Regroupe toutes les migrations récentes. Idempotent (relançable sans
--  danger). NE contient PAS la remise à zéro des stocks (voir reset_stock.sql).
-- =====================================================================

-- 1) Masquer les prix sur le bon de commande (option Paramètres)
alter table restaurants add column if not exists hide_po_prices boolean not null default false;

-- 2) Facture : ligne "frais divers" (taxes alcool, livraison…)
alter table invoices add column if not exists misc_fees numeric not null default 0;
alter table invoices add column if not exists misc_fees_label text;

-- 3) Réception : numéro de bon de livraison (BL)
alter table delivery_notes add column if not exists bl_number text;

-- 4) Inventaire fournitures : type de fiche d'inventaire
alter table inventory_sessions add column if not exists kind text not null default 'food';

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
