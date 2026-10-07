-- Phase 2: real user accounts replace the single `caregiver` table.
--
-- Accounts move to app_user (created in V2). Who owns a patient is
-- patient.caregiver_id, now a foreign key. A doctor's old "assigned patient"
-- rows become time-limited grants. caregiver and caregiver_patient are then
-- dropped: nothing reads them any more.

-- Accounts. Roles other than ADMIN, CAREGIVER and DOCTOR (the old PATIENT value)
-- were never accounts and are not carried over.
insert into app_user (id, email, password_hash, name, phone, role, status)
select id, lower(email), password_hash, name, phone, role, 'ACTIVE'
from caregiver
where role in ('ADMIN', 'CAREGIVER', 'DOCTOR');

-- Ownership: a caregiver's assigned patients become owned patients, unless the
-- patient already names an owner.
update patient p
set caregiver_id = cp.caregiver_id
from caregiver_patient cp
join caregiver c on c.id = cp.caregiver_id
where cp.patient_id = p.id
  and p.caregiver_id is null
  and c.role in ('CAREGIVER', 'ADMIN');

-- A patient that named an owner who is not an account cannot keep a dangling id.
update patient set caregiver_id = null
where caregiver_id is not null
  and not exists (select 1 from app_user u where u.id = patient.caregiver_id);

alter table patient
    add constraint fk_patient_owner foreign key (caregiver_id) references app_user (id) on delete set null;
create index idx_patient_owner on patient (caregiver_id);

-- A doctor's old assignments become 90-day grants, given by the patient's owner.
insert into doctor_grant (id, patient_id, doctor_user_id, granted_by, expires_at)
select gen_random_uuid()::text, cp.patient_id, cp.caregiver_id, p.caregiver_id, now() + interval '90 days'
from caregiver_patient cp
join caregiver c on c.id = cp.caregiver_id and c.role = 'DOCTOR'
join patient p on p.id = cp.patient_id and p.caregiver_id is not null;

drop table caregiver_patient;
drop table caregiver;

-- One live grant per doctor and patient. A new grant replaces the old one by
-- revoking it first, so history stays in the table.
create unique index uq_grant_live on doctor_grant (patient_id, doctor_user_id) where revoked_at is null;

-- The consent notice a caregiver agreed to is part of the record.
alter table consent_record add column guardian_name varchar(200);
