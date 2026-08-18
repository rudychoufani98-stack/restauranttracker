-- =====================================================================
--  Moment de service : avant / pendant / après
--
--  Pourquoi : un inventaire compté AVANT le service ne veut pas dire la
--  même chose qu'un inventaire compté APRÈS (le service du jour n'est pas
--  encore consommé). Idem pour une livraison : reçue le matin, elle sert
--  au service du jour ; reçue le soir après le service, non.
--
--  Ce que ça change concrètement : chaque réception et chaque inventaire
--  portent l'heure RÉELLE de l'événement (et non l'heure de saisie), et
--  les mouvements de stock sont datés à ce moment-là. Le journal, les
--  achats du mois et les écarts d'inventaire deviennent chronologiquement
--  justes même si tu saisis une livraison du matin le soir.
--
--  À lancer dans Supabase → SQL Editor. Sans danger : ajoute des colonnes
--  optionnelles, ne modifie aucune donnée existante.
-- =====================================================================

-- 1) Horaires de service du restaurant (servent à détecter automatiquement
--    si un événement a lieu avant, pendant ou après le service).
alter table restaurants add column if not exists service_start time default '11:30';
alter table restaurants add column if not exists service_end   time default '23:00';

-- 2) Inventaire : quel moment du service ?  'avant' | 'pendant' | 'apres'
alter table inventory_sessions add column if not exists service_moment text;

-- 3) Réception : heure réelle de livraison + moment de service
alter table delivery_notes add column if not exists received_at timestamptz;
alter table delivery_notes add column if not exists service_moment text;

-- Les réceptions déjà enregistrées gardent leur date de validation comme
-- heure de livraison (meilleure information disponible).
update delivery_notes
   set received_at = coalesce(validated_at, created_at)
 where received_at is null;

-- 4) Contrôle : seules ces trois valeurs sont acceptées.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_sessions_service_moment_check') then
    alter table inventory_sessions
      add constraint inventory_sessions_service_moment_check
      check (service_moment is null or service_moment in ('avant', 'pendant', 'apres'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'delivery_notes_service_moment_check') then
    alter table delivery_notes
      add constraint delivery_notes_service_moment_check
      check (service_moment is null or service_moment in ('avant', 'pendant', 'apres'));
  end if;
end $$;

-- 5) Confirmation
select
  (select count(*) from information_schema.columns
    where table_name = 'restaurants' and column_name in ('service_start', 'service_end')) as horaires_ok,
  (select count(*) from information_schema.columns
    where table_name = 'delivery_notes' and column_name in ('received_at', 'service_moment')) as reception_ok,
  (select count(*) from information_schema.columns
    where table_name = 'inventory_sessions' and column_name = 'service_moment') as inventaire_ok;
-- Attendu : horaires_ok = 2, reception_ok = 2, inventaire_ok = 1
