-- =====================================================================
--  Correction des conditionnements (pack_type) des articles fournisseurs
--  À exécuter dans Supabase → SQL Editor.
--
--  Règles (on ne touche QUE les articles restés au défaut 'colis',
--  jamais ceux que tu as déjà réglés à la main) :
--   1. BIDON  : liquide en contenant unique de 5 L ou plus (huile 25 L…)
--   2. KG     : produit vendu au poids — colis de 1 kg exactement (viande…)
--   3. CARTON : plusieurs unités par colis (carton de x pièces / x bouteilles)
-- =====================================================================

-- ÉTAPE 1 — APERÇU : exécute d'abord ce SELECT seul pour voir ce qui va changer.
select
  i.name          as ingredient,
  s.pack_units,
  s.unit_size,
  s.unit,
  s.pack_type     as actuel,
  case
    when coalesce(s.pack_units, 1) = 1
         and ((lower(s.unit) = 'l'  and s.unit_size >= 5)
           or (lower(s.unit) = 'ml' and s.unit_size >= 5000)) then 'bidon'
    when coalesce(s.pack_units, 1) = 1
         and ((lower(s.unit) = 'kg' and s.unit_size = 1)
           or (lower(s.unit) = 'g'  and s.unit_size = 1000)) then 'kg'
    when coalesce(s.pack_units, 1) > 1 then 'carton'
    else s.pack_type
  end             as nouveau
from ingredient_suppliers s
join ingredients i on i.id = s.ingredient_id
where s.pack_type = 'colis'
order by i.name;

-- ÉTAPE 2 — APPLIQUER : si l'aperçu te convient, exécute les 3 UPDATE ci-dessous.

-- 1) Bidon : liquides en contenant unique >= 5 L
update ingredient_suppliers
set pack_type = 'bidon'
where pack_type = 'colis'
  and coalesce(pack_units, 1) = 1
  and ((lower(unit) = 'l'  and unit_size >= 5)
    or (lower(unit) = 'ml' and unit_size >= 5000));

-- 2) Kg : vendu au poids (colis de 1 kg)
update ingredient_suppliers
set pack_type = 'kg'
where pack_type = 'colis'
  and coalesce(pack_units, 1) = 1
  and ((lower(unit) = 'kg' and unit_size = 1)
    or (lower(unit) = 'g'  and unit_size = 1000));

-- 3) Carton : plusieurs unités par colis
update ingredient_suppliers
set pack_type = 'carton'
where pack_type = 'colis'
  and coalesce(pack_units, 1) > 1;

-- ÉTAPE 3 — VÉRIFIER : le récap après application.
select pack_type, count(*) as nb_articles
from ingredient_suppliers
group by pack_type
order by nb_articles desc;
