-- Tables for the work that follows the baseline: accounts and access
-- (Phase 2), device pairing (Phase 3), session envelopes, snapshots, alerts,
-- journal signals and voice notes (Phase 4).
--
-- They are created here so the whole schema is visible in one place from the
-- start. No entity maps them yet. A later phase that needs a different shape
-- changes it with a new migration, never by editing this file.

/* ---------------------------------------------------------------- accounts */

create table app_user (
    id            varchar(36) primary key,
    -- Stored lower-case; uniqueness is on that form.
    email         varchar(320) not null unique check (email = lower(email)),
    -- BCrypt. Never logged, never returned by any endpoint.
    password_hash varchar(100) not null,
    name          varchar(200) not null,
    phone         varchar(40),
    role          varchar(20) not null check (role in ('ADMIN','CAREGIVER','DOCTOR')),
    -- A doctor registers as PENDING and can do nothing until an admin approves.
    status        varchar(20) not null default 'ACTIVE' check (status in ('ACTIVE','PENDING','DISABLED')),
    failed_logins integer not null default 0,
    locked_until  timestamptz,
    created_at    timestamptz not null default now(),
    last_login_at timestamptz
);

-- Refresh tokens are opaque and rotate on every use. Only a hash is stored.
-- family_id ties a chain of rotations together: presenting a token that was
-- already used means it was stolen, and the whole family is revoked.
create table refresh_token (
    id          varchar(36) primary key,
    user_id     varchar(36) not null references app_user (id) on delete cascade,
    family_id   varchar(36) not null,
    token_hash  varchar(64) not null unique,
    issued_at   timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz,
    revoked_at  timestamptz
);
create index idx_refresh_user on refresh_token (user_id);
create index idx_refresh_family on refresh_token (family_id);

-- Guardian consent, recorded when a patient is created and before any data
-- about her is collected.
create table consent_record (
    id             varchar(36) primary key,
    patient_id     varchar(255) not null references patient (id) on delete cascade,
    given_by       varchar(36) not null references app_user (id),
    notice_version varchar(40) not null,
    given_at       timestamptz not null default now()
);
create index idx_consent_patient on consent_record (patient_id);

-- A caregiver lets a doctor see a patient, until a date, and can end it early.
create table doctor_grant (
    id             varchar(36) primary key,
    patient_id     varchar(255) not null references patient (id) on delete cascade,
    doctor_user_id varchar(36) not null references app_user (id) on delete cascade,
    granted_by     varchar(36) not null references app_user (id),
    granted_at     timestamptz not null default now(),
    expires_at     timestamptz not null,
    revoked_at     timestamptz
);
create index idx_grant_doctor on doctor_grant (doctor_user_id);
create index idx_grant_patient on doctor_grant (patient_id);

-- Who looked at what, and every grant, revoke, pairing and login. No foreign
-- keys on purpose: the record must survive the user or patient it names.
create table audit_event (
    id         bigserial primary key,
    at         timestamptz not null default now(),
    actor_type varchar(20) not null check (actor_type in ('ADMIN','CAREGIVER','DOCTOR','DEVICE','ANONYMOUS','SYSTEM')),
    actor_id   varchar(255),
    action     varchar(60) not null,
    patient_id varchar(255),
    resource   varchar(200),
    ip         varchar(64),
    detail     jsonb
);
create index idx_audit_patient_time on audit_event (patient_id, at);
create index idx_audit_actor_time on audit_event (actor_id, at);

-- Append-only, enforced by the database and not only by the application.
create function audit_event_is_append_only() returns trigger as $$
begin
    raise exception 'audit_event is append-only';
end;
$$ language plpgsql;

create trigger audit_event_no_update_or_delete
    before update or delete on audit_event
    for each row execute function audit_event_is_append_only();

/* ----------------------------------------------------------------- pairing */

-- A tablet paired to exactly one patient. Its token is opaque; only a hash is
-- stored. Revoking a device deletes nothing about the patient.
create table device (
    id           varchar(36) primary key,
    patient_id   varchar(255) not null references patient (id) on delete cascade,
    token_hash   varchar(64) not null unique,
    label        varchar(120),
    fingerprint  varchar(64),
    paired_at    timestamptz not null default now(),
    last_seen_at timestamptz,
    revoked_at   timestamptz
);
create index idx_device_patient on device (patient_id);

-- A one-time code. Stored hashed, redeemed at most once.
create table pairing_code (
    id                 varchar(36) primary key,
    patient_id         varchar(255) not null references patient (id) on delete cascade,
    code_hash          varchar(64) not null unique,
    created_by         varchar(36) references app_user (id),
    created_at         timestamptz not null default now(),
    expires_at         timestamptz not null,
    redeemed_at        timestamptz,
    redeemed_device_id varchar(36) references device (id),
    revoked_at         timestamptz
);
create index idx_pairing_code_patient on pairing_code (patient_id);

-- Every redemption attempt, for rate limiting per address and per device.
create table pairing_attempt (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    ip          varchar(64),
    fingerprint varchar(64),
    succeeded   boolean not null
);
create index idx_attempt_ip_time on pairing_attempt (ip, at);
create index idx_attempt_fingerprint_time on pairing_attempt (fingerprint, at);

/* ---------------------------------------------------------------- sessions */

-- The session envelope (docs/MASTER_PROMPT.md, Appendix A.1). All nullable:
-- rows written before the envelope existed stay valid.
alter table game_session
    add column client_session_id   varchar(36),
    add column game_id             varchar(60),
    add column device_id           varchar(36),
    add column completed           boolean,
    add column abandoned           boolean,
    add column hour_of_day         integer check (hour_of_day between 0 and 23),
    add column trials              jsonb,
    add column contributions       jsonb,
    add column markers             jsonb,
    add column difficulty          jsonb,
    add column precomputed_reading boolean,
    add column engine_version      varchar(20);

-- The second dedupe key, beside (patient_id, started_at).
create unique index uq_session_client_id on game_session (client_session_id)
    where client_session_id is not null;

-- The profile as it stood after each session, so a time series is a read and
-- not a recomputation.
create table profile_snapshot (
    id             bigserial primary key,
    patient_id     varchar(255) not null references patient (id) on delete cascade,
    session_id     varchar(255) not null references game_session (id) on delete cascade,
    at             timestamptz not null,
    levels         jsonb not null,
    velocities     jsonb not null,
    statuses       jsonb not null,
    confidences    jsonb not null,
    markers        jsonb,
    engine_version varchar(20) not null,
    constraint uq_snapshot_session unique (session_id)
);
create index idx_snapshot_patient_time on profile_snapshot (patient_id, at);

/* ------------------------------------------------------------------ alerts */

create table alert (
    id              varchar(36) primary key,
    patient_id      varchar(255) not null references patient (id) on delete cascade,
    kind            varchar(40) not null,
    -- The domain or sub-signal for DOMAIN_DECLINE; empty for alerts without one.
    target          varchar(40) not null default '',
    severity        varchar(20) not null check (severity in ('watch','decline','info')),
    message         text not null,
    opened_at       timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    resolved_at     timestamptz,
    acknowledged_at timestamptz,
    acknowledged_by varchar(36) references app_user (id)
);
create index idx_alert_patient_time on alert (patient_id, opened_at);

-- One open alert per patient, kind and target: a continuing episode updates
-- its row instead of raising a duplicate.
create unique index uq_alert_open_episode on alert (patient_id, kind, target)
    where resolved_at is null;

/* ------------------------------------------------------- journal and voice */

-- What the model read out of a journal entry. The entry text is never stored.
create table journal_signal (
    id            varchar(36) primary key,
    patient_id    varchar(255) not null references patient (id) on delete cascade,
    at            timestamptz not null,
    valence       double precision not null check (valence between -1 and 1),
    arousal       double precision not null check (arousal between 0 and 1),
    themes        jsonb not null default '[]',
    concern_flags jsonb not null default '[]',
    summary       text,
    entry_length  integer not null,
    model         varchar(80)
);
create index idx_journal_patient_time on journal_signal (patient_id, at);

-- A short recording a caregiver leaves for the patient.
create table voice_note (
    id           varchar(36) primary key,
    patient_id   varchar(255) not null references patient (id) on delete cascade,
    from_user_id varchar(36) references app_user (id),
    kinship_term varchar(120),
    storage_key  varchar(400) not null,
    duration_ms  integer,
    created_at   timestamptz not null default now(),
    listened_at  timestamptz
);
create index idx_voice_note_patient on voice_note (patient_id, created_at);
