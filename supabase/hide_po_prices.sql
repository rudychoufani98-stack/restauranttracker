-- Option "masquer les prix sur le bon de commande".
-- À lancer UNE FOIS dans Supabase → SQL Editor.
alter table restaurants add column if not exists hide_po_prices boolean not null default false;
