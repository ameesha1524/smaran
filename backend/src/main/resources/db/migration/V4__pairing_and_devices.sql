-- Phase 3: device pairing, reworked to the prompt's specification.
--
-- V2 already created the tables this needs (pairing_code, device,
-- pairing_attempt). What was missing:
--
--   * device.expires_at, so a tablet nobody has used for months lapses. It slides
--     forward whenever the tablet is seen, so a used one never does.
--
-- And what goes: the old device_pairing table, in which one row was both a code
-- and the tablet that redeemed it, and whose tablets held a signed token that
-- only expired. Tablets paired that way hold a token this server no longer
-- honours and must be paired again. Nothing is lost from a patient's record,
-- which was never stored on the pairing row.
drop table device_pairing;

alter table device
    add column expires_at timestamptz not null default (now() + interval '180 days');
