-- =====================================================================
--  SÉCURITÉ — Row Level Security (RLS) + contraintes
--  À exécuter UNE FOIS dans Supabase → SQL Editor.
--  Idempotent : peut être relancé sans danger.
--
--  Pourquoi c'est critique : l'app écrit directement depuis le navigateur
--  avec la clé "anon". La RLS est donc la SEULE barrière qui empêche un
--  utilisateur connecté de lire/modifier les données d'un autre restaurant.
-- =====================================================================

-- Helper : l'utilisateur courant possède-t-il ce restaurant ?
create or replace function public.owns_restaurant(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from restaurants
    where id = rid and owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 1) restaurants
-- ---------------------------------------------------------------------
alter table restaurants enable row level security;
drop policy if exists rls_restaurants on restaurants;
create policy rls_restaurants on restaurants
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) Tables avec restaurant_id direct
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ingredients', 'suppliers', 'tags', 'categories', 'recipes',
    'purchase_orders', 'sales_periods', 'stock_movements',
    'invoices', 'delivery_notes'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists rls_%1$s on %1$s;', t);
    execute format($f$
      create policy rls_%1$s on %1$s
        for all
        using (owns_restaurant(restaurant_id))
        with check (owns_restaurant(restaurant_id));
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Tables enfants — héritent de la propriété via leur parent
-- ---------------------------------------------------------------------

-- recipe_lines.recipe_id -> recipes
alter table recipe_lines enable row level security;
drop policy if exists rls_recipe_lines on recipe_lines;
create policy rls_recipe_lines on recipe_lines
  for all
  using (exists (select 1 from recipes r where r.id = recipe_lines.recipe_id and owns_restaurant(r.restaurant_id)))
  with check (exists (select 1 from recipes r where r.id = recipe_lines.recipe_id and owns_restaurant(r.restaurant_id)));

-- ingredient_tags.ingredient_id -> ingredients
alter table ingredient_tags enable row level security;
drop policy if exists rls_ingredient_tags on ingredient_tags;
create policy rls_ingredient_tags on ingredient_tags
  for all
  using (exists (select 1 from ingredients i where i.id = ingredient_tags.ingredient_id and owns_restaurant(i.restaurant_id)))
  with check (exists (select 1 from ingredients i where i.id = ingredient_tags.ingredient_id and owns_restaurant(i.restaurant_id)));

-- ingredient_price_history.ingredient_id -> ingredients
alter table ingredient_price_history enable row level security;
drop policy if exists rls_ingredient_price_history on ingredient_price_history;
create policy rls_ingredient_price_history on ingredient_price_history
  for all
  using (exists (select 1 from ingredients i where i.id = ingredient_price_history.ingredient_id and owns_restaurant(i.restaurant_id)))
  with check (exists (select 1 from ingredients i where i.id = ingredient_price_history.ingredient_id and owns_restaurant(i.restaurant_id)));

-- purchase_order_lines.po_id -> purchase_orders
alter table purchase_order_lines enable row level security;
drop policy if exists rls_purchase_order_lines on purchase_order_lines;
create policy rls_purchase_order_lines on purchase_order_lines
  for all
  using (exists (select 1 from purchase_orders p where p.id = purchase_order_lines.po_id and owns_restaurant(p.restaurant_id)))
  with check (exists (select 1 from purchase_orders p where p.id = purchase_order_lines.po_id and owns_restaurant(p.restaurant_id)));

-- invoice_lines.invoice_id -> invoices
alter table invoice_lines enable row level security;
drop policy if exists rls_invoice_lines on invoice_lines;
create policy rls_invoice_lines on invoice_lines
  for all
  using (exists (select 1 from invoices v where v.id = invoice_lines.invoice_id and owns_restaurant(v.restaurant_id)))
  with check (exists (select 1 from invoices v where v.id = invoice_lines.invoice_id and owns_restaurant(v.restaurant_id)));

-- delivery_note_lines.delivery_note_id -> delivery_notes
alter table delivery_note_lines enable row level security;
drop policy if exists rls_delivery_note_lines on delivery_note_lines;
create policy rls_delivery_note_lines on delivery_note_lines
  for all
  using (exists (select 1 from delivery_notes d where d.id = delivery_note_lines.delivery_note_id and owns_restaurant(d.restaurant_id)))
  with check (exists (select 1 from delivery_notes d where d.id = delivery_note_lines.delivery_note_id and owns_restaurant(d.restaurant_id)));

-- sales_lines.period_id -> sales_periods
alter table sales_lines enable row level security;
drop policy if exists rls_sales_lines on sales_lines;
create policy rls_sales_lines on sales_lines
  for all
  using (exists (select 1 from sales_periods s where s.id = sales_lines.period_id and owns_restaurant(s.restaurant_id)))
  with check (exists (select 1 from sales_periods s where s.id = sales_lines.period_id and owns_restaurant(s.restaurant_id)));

-- ---------------------------------------------------------------------
-- 4) Contraintes d'intégrité (validation côté base, non contournable)
-- ---------------------------------------------------------------------
do $$
begin
  -- prix / quantités non négatifs
  begin alter table ingredients add constraint chk_ing_pack_price check (pack_price >= 0); exception when others then null; end;
  begin alter table ingredients add constraint chk_ing_selling check (selling_price is null or selling_price >= 0); exception when others then null; end;
  begin alter table ingredients add constraint chk_ing_stock check (stock_qty is null or stock_qty >= 0); exception when others then null; end;
  begin alter table recipes add constraint chk_recipe_price check (menu_price is null or menu_price >= 0); exception when others then null; end;
  begin alter table recipes add constraint chk_recipe_yield check (yield_portions > 0); exception when others then null; end;
  begin alter table sales_lines add constraint chk_sales_qty check (qty_sold >= 0); exception when others then null; end;
  begin alter table purchase_order_lines add constraint chk_pol_qty check (quantity >= 0); exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 5) Storage — rendre le bucket "invoices" PRIVÉ + politiques par restaurant
--     (les fichiers sont rangés sous "<type>/<restaurant_id>/...")
-- ---------------------------------------------------------------------
update storage.buckets set public = false where id = 'invoices';

drop policy if exists rls_storage_invoices on storage.objects;
create policy rls_storage_invoices on storage.objects
  for all
  using (
    bucket_id = 'invoices'
    and owns_restaurant( (string_to_array(name, '/'))[2]::uuid )
  )
  with check (
    bucket_id = 'invoices'
    and owns_restaurant( (string_to_array(name, '/'))[2]::uuid )
  );

-- =====================================================================
-- VÉRIFICATION : lister les tables SANS RLS (doit renvoyer 0 ligne)
-- =====================================================================
-- select tablename from pg_tables
-- where schemaname = 'public'
--   and tablename not in (select tablename from pg_policies where schemaname='public');
