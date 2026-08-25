-- =====================================================================
--  Références internes des produits + référence de caisse des recettes
--  À EXÉCUTER dans Supabase → SQL Editor. Idempotent (relançable).
--
--  1) Chaque produit reçoit un numéro interne unique, attribué par blocs
--     de famille : 1xxx = viandes, 5xxx = épicerie, 9xxx = bières,
--     10xxx = vins, 11xxx = spiritueux…
--     Le premier chiffre dit la famille, ce qui rend le numéro lisible
--     à l'œil sur un bon de commande ou une étiquette de bac.
--
--  2) Chaque recette porte la référence de la TOUCHE de caisse qui la
--     vend. C'est ce qui permettra, plus tard, de rapprocher les ventes
--     de la caisse et les fiches techniques automatiquement.
-- =====================================================================

-- 1) Numéro interne du produit
alter table ingredients add column if not exists internal_ref integer;

-- Deux produits ne peuvent pas porter le même numéro chez un même client.
-- Index partiel : les produits sans numéro ne se gênent pas entre eux.
create unique index if not exists idx_ingredients_internal_ref
  on ingredients(restaurant_id, internal_ref)
  where internal_ref is not null;

-- 2) Début du bloc de numérotation, par catégorie d'achat
--    (Viande → 1000, Épicerie → 5000…). Modifiable depuis l'app.
alter table categories add column if not exists ref_start integer;

-- 3) Référence de la touche de caisse, sur les recettes
alter table recipes add column if not exists pos_ref text;

-- Une touche de caisse ne peut pas vendre deux plats différents.
create unique index if not exists idx_recipes_pos_ref
  on recipes(restaurant_id, lower(pos_ref))
  where pos_ref is not null and pos_ref <> '';

-- =====================================================================
--  Vérification — doit renvoyer 3 lignes
-- =====================================================================
select table_name, column_name
from information_schema.columns
where (table_name = 'ingredients' and column_name = 'internal_ref')
   or (table_name = 'categories'  and column_name = 'ref_start')
   or (table_name = 'recipes'     and column_name = 'pos_ref')
order by table_name;
