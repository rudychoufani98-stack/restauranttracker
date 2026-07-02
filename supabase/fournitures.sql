-- Inventaire fournitures — à lancer une fois dans le SQL Editor de Supabase.
-- Ajoute une colonne "kind" aux sessions d'inventaire pour distinguer
-- les inventaires alimentaires ('food') des inventaires de fournitures
-- (couverts, emballages…). Le tag « Fournitures » est créé automatiquement
-- par l'application au premier chargement de la page Stock.
alter table inventory_sessions add column if not exists kind text not null default 'food';
