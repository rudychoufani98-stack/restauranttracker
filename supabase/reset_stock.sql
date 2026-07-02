-- Remise à zéro de TOUS les stocks + effacement de l'historique des mouvements.
-- À lancer UNE FOIS dans Supabase → SQL Editor. IRRÉVERSIBLE.
-- À utiliser après avoir supprimé toutes les commandes, pour repartir propre.

-- 1) Tous les stocks à zéro (et CMUP réinitialisé)
update ingredients set stock_qty = 0, cmup = null;

-- 2) Efface l'historique des mouvements de stock (réceptions, ventes, pertes…)
delete from stock_movements;
