-- =====================================================================
--  UNIFICATION DES UNITÉS : l'app parle uniquement en kg / L / pièce.
--  Convertit les produits encore en « g » / « ml » (unités internes qui
--  fuyaient dans l'interface) vers kg / L, en convertissant les TAILLES
--  de colisage (÷1000). Le stock, les coûts et les seuils sont déjà
--  stockés en unités de base : ils ne changent PAS.
--  À exécuter une fois dans Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- 1) Articles fournisseurs saisis en g / ml → kg / L (tailles converties)
update ingredient_suppliers set unit = 'kg', unit_size = unit_size / 1000.0 where unit = 'g';
update ingredient_suppliers set unit = 'l',  unit_size = unit_size / 1000.0 where unit = 'ml';

-- 2) Produits en g / ml → kg / L (tailles de colisage converties)
update ingredients
set unit = 'kg', unit_size = unit_size / 1000.0, pack_quantity = pack_quantity / 1000.0
where unit = 'g';

update ingredients
set unit = 'l', unit_size = unit_size / 1000.0, pack_quantity = pack_quantity / 1000.0
where unit = 'ml';

-- 3) VÉRIFICATION — il ne doit rester que kg / l / unit
select unit, count(*) as nb_produits from ingredients group by unit order by unit;
