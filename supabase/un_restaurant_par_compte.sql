-- =====================================================================
--  Un compte = UN restaurant (protection définitive)
--
--  Pourquoi : si un compte se retrouvait avec deux restaurants, l'app ne
--  savait plus lequel charger et renvoyait l'utilisateur en boucle vers
--  l'écran de configuration — compte inutilisable.
--  Le code empêche déjà d'en créer un second ; cette contrainte le garantit
--  au niveau de la base, quoi qu'il arrive.
--
--  À lancer dans Supabase → SQL Editor. Sans danger : ne modifie aucune
--  donnée, ajoute seulement une règle d'unicité.
-- =====================================================================

-- 1. Vérification : y a-t-il déjà des comptes avec plusieurs restaurants ?
--    (S'il n'y a aucune ligne, tout va bien, passe à l'étape 2.)
select owner_id, count(*) as nb_restaurants, string_agg(name, ' | ') as restaurants
from restaurants
group by owner_id
having count(*) > 1;

-- 2. La contrainte d'unicité.
--    Si l'étape 1 a renvoyé des lignes, supprime d'abord les doublons
--    (garde le plus ancien) avant de lancer ceci, sinon la commande échouera.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_owner_unique'
  ) then
    alter table restaurants
      add constraint restaurants_owner_unique unique (owner_id);
  end if;
end $$;

-- 3. Confirmation
select conname as contrainte, 'OK — un compte ne peut plus avoir deux restaurants' as statut
from pg_constraint
where conname = 'restaurants_owner_unique';
