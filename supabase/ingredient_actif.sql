-- =====================================================================
--  Produits actifs / inactifs
--  À EXÉCUTER dans Supabase → SQL Editor. Idempotent.
--
--  On ne supprime plus un produit : on le désactive. Supprimer effaçait
--  aussi son historique d'achat, ses mouvements de stock et cassait les
--  fiches techniques qui l'utilisaient. Un produit désactivé garde tout
--  son passé, mais ne peut plus être ajouté à une recette ou une MEP.
-- =====================================================================

alter table ingredients add column if not exists is_active boolean not null default true;

-- Les écrans filtrent presque toujours sur (restaurant, actif).
create index if not exists idx_ingredients_active on ingredients(restaurant_id, is_active);
