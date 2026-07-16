-- =====================================================================
--  Conditionnement secondaire par produit (ex. « 1 bouteille = 0,75 L »)
--  Permet de compter l'inventaire (et libeller les commandes sans article)
--  dans ce conditionnement plutôt qu'en unité de base.
--  À exécuter dans Supabase → SQL Editor. Sans danger : ajoute 2 colonnes
--  optionnelles, ne touche à aucune donnée existante.
-- =====================================================================

alter table ingredients add column if not exists secondary_unit_label text;
alter table ingredients add column if not exists secondary_unit_size numeric;

comment on column ingredients.secondary_unit_label is 'Nom du conditionnement secondaire (bouteille, boîte…) — optionnel';
comment on column ingredients.secondary_unit_size is 'Taille du conditionnement secondaire en unité d''affichage (ex. 0.75 pour 75 cl)';
