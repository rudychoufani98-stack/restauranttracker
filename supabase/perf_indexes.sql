-- Performance indexes — run once in the Supabase SQL editor.
-- Every page filters by restaurant_id; without these indexes Postgres scans
-- the whole table each time. `if not exists` makes this safe to re-run.

-- Core per-restaurant filters
create index if not exists idx_recipes_restaurant        on recipes(restaurant_id);
create index if not exists idx_ingredients_restaurant     on ingredients(restaurant_id);
create index if not exists idx_categories_restaurant      on categories(restaurant_id);
create index if not exists idx_suppliers_restaurant       on suppliers(restaurant_id);
create index if not exists idx_tags_restaurant            on tags(restaurant_id);
create index if not exists idx_purchase_orders_restaurant on purchase_orders(restaurant_id);
create index if not exists idx_sales_periods_restaurant   on sales_periods(restaurant_id);

-- The restaurant lookup done on every navigation (restaurants by owner)
create index if not exists idx_restaurants_owner          on restaurants(owner_id);

-- Recipe cost / destockage joins
create index if not exists idx_recipe_lines_recipe        on recipe_lines(recipe_id);
create index if not exists idx_recipe_lines_sub_recipe    on recipe_lines(sub_recipe_id);
create index if not exists idx_recipe_lines_ingredient    on recipe_lines(ingredient_id);

-- Sales lines lookups
create index if not exists idx_sales_lines_period         on sales_lines(period_id);

-- Stock movements — dashboard/history query filters by restaurant + type + date
create index if not exists idx_stock_movements_rest_date
  on stock_movements(restaurant_id, created_at desc);
create index if not exists idx_stock_movements_ingredient on stock_movements(ingredient_id);

-- Ingredient supplier links (already partially indexed)
create index if not exists idx_ingredient_suppliers_supplier on ingredient_suppliers(supplier_id);
