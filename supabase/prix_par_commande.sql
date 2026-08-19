-- =====================================================================
--  Masquer / afficher les prix : choix par commande
--
--  Le réglage global vit dans restaurants.hide_po_prices (Paramètres).
--  Cette colonne permet de DÉROGER au cas par cas :
--    null  → suit le réglage global du restaurant
--    true  → prix masqués sur CE bon (PDF + email)
--    false → prix affichés sur CE bon, même si le global les masque
--
--  À lancer dans Supabase → SQL Editor. Sans danger : ajoute une colonne
--  optionnelle, ne modifie aucune donnée existante.
-- =====================================================================

alter table purchase_orders add column if not exists hide_prices boolean;

comment on column purchase_orders.hide_prices is
  'null = suit restaurants.hide_po_prices ; true = prix masques ; false = prix affiches';

-- Confirmation
select count(*) as colonne_ok
from information_schema.columns
where table_name = 'purchase_orders' and column_name = 'hide_prices';
-- Attendu : 1
