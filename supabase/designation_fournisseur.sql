-- =====================================================================
--  DÉSIGNATION FOURNISSEUR — à lancer une fois dans Supabase → SQL Editor.
--
--  Le nom du produit dans l'app reste GÉNÉRIQUE (« Aubergine ») ; le nom
--  exact du catalogue fournisseur (« AUBERGINE CAL 3/4 CAT1 — Belgique »)
--  vit sur l'article fournisseur et s'imprime sur les bons de commande.
--  Idempotent : relançable sans danger.
-- =====================================================================

-- 1) La colonne : une désignation par article fournisseur.
alter table ingredient_suppliers add column if not exists supplier_label text;

-- 2) Rattrapage des produits importés depuis une mercuriale : leur nom
--    actuel EST la désignation fournisseur (reconnaissable : tout en
--    majuscules). On la recopie sur l'article fournisseur — en le créant
--    s'il n'existe pas encore — pour pouvoir ensuite renommer le produit
--    en générique sans rien perdre.
insert into ingredient_suppliers
  (ingredient_id, supplier_id, supplier_reference, pack_units, unit_size,
   unit, pack_price, vat_rate, is_preferred, supplier_label)
select i.id, i.supplier_id, i.supplier_reference,
       coalesce(i.pack_units, 1),
       coalesce(nullif(i.unit_size, 0), nullif(i.pack_quantity, 0), 1),
       i.unit, coalesce(i.pack_price, 0), coalesce(i.vat_rate, 0),
       true, i.name
from ingredients i
where i.supplier_id is not null
  and upper(i.name) = i.name and i.name ~ '[A-Z]{3}'        -- nom tout en majuscules = désignation importée
  and not exists (select 1 from ingredient_suppliers s where s.ingredient_id = i.id);

update ingredient_suppliers s
set supplier_label = i.name
from ingredients i
where i.id = s.ingredient_id
  and s.supplier_label is null
  and upper(i.name) = i.name and i.name ~ '[A-Z]{3}';

-- 3) Aperçu : les produits dont le nom reste à rendre générique dans
--    l'app (fiche produit → crayon à côté du nom).
select i.internal_ref as ref, i.name as nom_actuel_a_renommer, s.supplier_label as designation_conservee
from ingredients i
join ingredient_suppliers s on s.ingredient_id = i.id
where upper(i.name) = i.name and i.name ~ '[A-Z]{3}'
order by i.internal_ref;
