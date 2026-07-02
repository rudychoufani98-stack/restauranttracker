-- Facture : ligne "frais divers" optionnelle (taxes alcool, frais de livraison…).
-- À lancer UNE FOIS dans Supabase → SQL Editor.
alter table invoices add column if not exists misc_fees numeric not null default 0;
alter table invoices add column if not exists misc_fees_label text;
