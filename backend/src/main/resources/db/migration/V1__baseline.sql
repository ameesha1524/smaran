-- Smaran baseline schema.
--
-- The tables the application already had, written down. Until now Hibernate
-- created them on start-up; from here on this directory is the only place the
-- schema changes, and Hibernate only validates against it.
--
-- Ids are application-generated UUID strings. Enum-like columns carry a CHECK
-- so a bad value fails at the database, with one deliberate exception:
-- game_session.game_type has none, because adding a game must not need a
-- migration.

create table patient (
    id              varchar(255) primary key,
    name            varchar(255) not null,
    language_code   varchar(255) not null,
    kinship_term    varchar(255) not null,
    region          varchar(255),
    faith           varchar(255),
    peak_window     varchar(255) not null
        check (peak_window in ('EARLY_MORNING','MORNING','MIDDAY','AFTERNOON','EVENING','NIGHT')),
    profile_version varchar(255) not null,
    caregiver_id    varchar(255),
    created_at      timestamptz
);

create table caregiver (
    id            varchar(255) primary key,
    name          varchar(255) not null,
    email         varchar(255) not null unique,
    password_hash varchar(255) not null,
    role          varchar(255) not null check (role in ('PATIENT','CAREGIVER','DOCTOR','ADMIN')),
    phone         varchar(255)
);

create table caregiver_patient (
    caregiver_id varchar(255) not null references caregiver (id) on delete cascade,
    patient_id   varchar(255)
);
create index idx_caregiver_patient_caregiver on caregiver_patient (caregiver_id);

create table cognitive_profile (
    patient_id         varchar(255) primary key references patient (id) on delete cascade,
    -- 0-1 per domain, derived from scoring_state.
    domain_scores      text not null,
    -- The scoring engine state; null on a profile that predates the engine.
    scoring_state      text,
    cluster_accuracy   text not null,
    motor_tier         varchar(255) not null check (motor_tier in ('FLUID','MODERATE','SUPPORTED')),
    anxiety_threshold  double precision not null,
    starting_phase     integer not null,
    sundowning_pattern boolean not null,
    self_reported_peak varchar(255) not null
        check (self_reported_peak in ('EARLY_MORNING','MORNING','MIDDAY','AFTERNOON','EVENING','NIGHT')),
    derived_peak       varchar(255)
        check (derived_peak in ('EARLY_MORNING','MORNING','MIDDAY','AFTERNOON','EVENING','NIGHT')),
    version            varchar(255) not null,
    updated_at         timestamptz
);

create table game_session (
    id                   varchar(255) primary key,
    patient_id           varchar(255) not null references patient (id) on delete cascade,
    game_type            varchar(255) not null,
    started_at           timestamptz not null,
    received_at          timestamptz,
    duration_ms          bigint not null,
    completion_rate      double precision not null,
    difficulty_tier      integer not null,
    cognitive_load_score double precision not null,
    eased_mid_session    boolean not null,
    mood_at_start        varchar(255)
        check (mood_at_start in ('JOYFUL','PEACEFUL','QUIET','SLEEPY','A_LITTLE_LOW','WORRIED','RESTLESS','THINKING')),
    domain_readings      text,
    metrics              text,
    -- The dedupe key: a replayed offline queue can never store a sitting twice.
    constraint uq_session_patient_started unique (patient_id, started_at)
);

create table cognitive_object_result (
    id               varchar(255) primary key,
    patient_id       varchar(255) not null references patient (id) on delete cascade,
    session_id       varchar(255),
    object_name      varchar(255) not null,
    semantic_cluster varchar(255) not null
        check (semantic_cluster in ('MUSICAL','NATURE','DAILY_LIFE','CRAFT','FOOD')),
    tapped_ms        bigint not null,
    was_correct      boolean not null,
    captured_at      timestamptz not null
);
create index idx_object_patient_time on cognitive_object_result (patient_id, captured_at);

create table garden_state (
    patient_id           varchar(255) primary key references patient (id) on delete cascade,
    bloom_stage          integer not null,
    growth_points        integer not null,
    bloom_count          integer not null,
    resting_phase        boolean not null,
    last_activity        timestamptz,
    last_caregiver_alert timestamptz
);

create table mood_log (
    id         varchar(255) primary key,
    patient_id varchar(255) not null references patient (id) on delete cascade,
    mood       varchar(255) not null
        check (mood in ('JOYFUL','PEACEFUL','QUIET','SLEEPY','A_LITTLE_LOW','WORRIED','RESTLESS','THINKING')),
    at         timestamptz not null,
    local_hour integer not null
);
create index idx_mood_patient_time on mood_log (patient_id, at);

create table family_member (
    id                 varchar(255) primary key,
    patient_id         varchar(255) not null references patient (id) on delete cascade,
    name               varchar(255) not null,
    relationship       varchar(255),
    kinship_term_local varchar(255),
    context_hint       text,
    photos3key         varchar(255),
    voice_notes3key    varchar(255),
    notify_token       varchar(255),
    current_phase      integer not null,
    correct_streak     integer not null,
    last_recognised_at timestamptz
);
create index idx_family_patient on family_member (patient_id);

create table meaningful_object (
    id               varchar(255) primary key,
    patient_id       varchar(255) not null references patient (id) on delete cascade,
    name             varchar(255) not null,
    semantic_cluster varchar(255) not null
        check (semantic_cluster in ('MUSICAL','NATURE','DAILY_LIFE','CRAFT','FOOD')),
    images3key       varchar(255),
    glyph            varchar(255)
);
create index idx_object_patient on meaningful_object (patient_id);

create table reminder_schedule (
    id               varchar(255) primary key,
    patient_id       varchar(255) not null references patient (id) on delete cascade,
    type             varchar(255) not null check (type in ('MEDICINE','HYDRATION','APPOINTMENT')),
    scheduled_time   varchar(255) not null,
    message_template text not null,
    language_code    varchar(255) not null,
    photos3key       varchar(255),
    active           boolean not null
);
create index idx_reminder_patient on reminder_schedule (patient_id);

create table acoustic_vector (
    id                 varchar(255) primary key,
    patient_id         varchar(255) not null references patient (id) on delete cascade,
    session_id         varchar(255),
    captured_at        timestamptz not null,
    jitter             double precision not null,
    shimmer            double precision not null,
    pause_duration_avg double precision not null,
    speech_rate        double precision not null,
    phonation_ratio    double precision not null,
    constraint uq_acoustic_patient_captured unique (patient_id, captured_at)
);

create table device_pairing (
    id               varchar(255) primary key,
    patient_id       varchar(255) not null references patient (id) on delete cascade,
    code_hash        varchar(64) not null unique,
    created_by       varchar(255),
    created_at       timestamptz not null,
    expires_at       timestamptz not null,
    redeemed_at      timestamptz,
    revoked_at       timestamptz,
    device_label     varchar(120),
    token_expires_at timestamptz,
    last_seen_at     timestamptz
);
create index idx_pairing_patient on device_pairing (patient_id);

-- A receipt that a device took part in a federated round. Deliberately not
-- tied to a patient row: it must outlive one and attribute nothing.
create table fl_gradient_record (
    id            varchar(255) primary key,
    device_id     varchar(255) not null,
    patient_id    varchar(255),
    model_version varchar(255) not null,
    gradient_hash varchar(255) not null,
    sample_count  integer not null,
    received_at   timestamptz not null
);
