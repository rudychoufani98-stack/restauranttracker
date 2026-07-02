-- Réception : numéro du bon de livraison (BL) fourni par le fournisseur.
-- À lancer UNE FOIS dans Supabase → SQL Editor.
alter table delivery_notes add column if not exists bl_number text;
