# RBAC architecture

*Written for the engineers implementing this in the existing Spring Boot 3 / Java 21
backend and React PWA frontend. It replaces the current single-`Caregiver`-entity
access model.*

---

## 1. Why this changes

Today the system assumes the person using the tablet is the account holder.
`Caregiver.assignedPatientIds` is the entire security boundary, `Role` is a flat
enum of four values, and `AccessGuard.requireAccessTo(patientId)` answers one
question: *is this patient in your set?*

That model cannot express the thing the product actually needs: **a dementia
patient does not register, does not hold credentials, and does not administer
anything.** A family member creates the account, builds the patient's profile,
uploads the memories that make the therapy work at all, and invites a caregiver
who gets a strictly narrower slice.

So authorization moves from *"which patients are in your list"* to *"which
permission do you hold, over which scope."*

---

## 2. Role model

Five roles, plus `DOCTOR` retained from the current enum for trend-only access.

| Role | Who | Scope |
|---|---|---|
| `SUPER_ADMIN` | Platform staff | Global |
| `FAMILY_ADMIN` | The family member who created the family | One family |
| `FAMILY_MEMBER` | Relatives invited by the admin | One family |
| `CAREGIVER` | Paid or volunteer carer | Specific patients |
| `DOCTOR` | Clinician | Specific patients, trends only |
| `PATIENT` | The person the app is for | Self only |

The critical distinction: **`FAMILY_ADMIN` and `FAMILY_MEMBER` are scoped to a
family; `CAREGIVER` and `DOCTOR` are scoped to individual patients.** A caregiver
assigned to one grandparent must not see that family's other patient.

### Patients hold no credentials

A patient never has a password. The family generates a **pairing code** in the
caregiver app; the tablet redeems it once for a long-lived device token carrying
`PATIENT` role scoped to that one patient.

This is what the patient-facing login screen already does — it asks for a name
so the pond knows what to call her, and nothing else. The name is a display
value, not an identity claim. Authorization rides on the device token.

---

## 3. Schema

New tables. Existing `patient`, `game_session`, `garden_state` etc. are unchanged
apart from the two columns noted on `patient`.

```sql
-- Identity ------------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           VARCHAR(255) UNIQUE,          -- NULL for patients
  phone           VARCHAR(32)  UNIQUE,
  password_hash   VARCHAR(255),                 -- NULL for patients
  display_name    VARCHAR(160) NOT NULL,
  status          VARCHAR(24)  NOT NULL,        -- ACTIVE | INVITED | SUSPENDED
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- Authorization vocabulary --------------------------------------------------
CREATE TABLE roles (
  id        SMALLSERIAL PRIMARY KEY,
  key       VARCHAR(32) UNIQUE NOT NULL,        -- FAMILY_ADMIN, CAREGIVER, ...
  label     VARCHAR(64) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE permissions (
  id          SMALLSERIAL PRIMARY KEY,
  key         VARCHAR(64) UNIQUE NOT NULL,      -- patient.delete, memory.upload
  description VARCHAR(255) NOT NULL
);

CREATE TABLE role_permissions (
  role_id       SMALLINT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id SMALLINT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- The grant: a role held over a scope ---------------------------------------
CREATE TABLE user_roles (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    SMALLINT NOT NULL REFERENCES roles(id),
  scope_type VARCHAR(16) NOT NULL,              -- GLOBAL | FAMILY | PATIENT
  scope_id   UUID,                              -- NULL when GLOBAL
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, role_id, scope_type, scope_id)
);
CREATE INDEX idx_user_roles_lookup ON user_roles (user_id, revoked_at);

-- Grouping ------------------------------------------------------------------
CREATE TABLE families (
  id              UUID PRIMARY KEY,
  name            VARCHAR(160) NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),   -- future care orgs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id         UUID PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  type       VARCHAR(32) NOT NULL,              -- CARE_HOME | CLINIC | NGO
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE patient ADD COLUMN family_id UUID REFERENCES families(id);
ALTER TABLE patient ADD COLUMN user_id   UUID REFERENCES users(id);

-- Assignment ----------------------------------------------------------------
CREATE TABLE caregiver_assignments (
  id                 UUID PRIMARY KEY,
  patient_id         VARCHAR(64) NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  caregiver_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by        UUID NOT NULL REFERENCES users(id),
  starts_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at            TIMESTAMPTZ,
  status             VARCHAR(16) NOT NULL,      -- ACTIVE | ENDED | REVOKED
  UNIQUE (patient_id, caregiver_user_id, starts_at)
);

-- Onboarding ----------------------------------------------------------------
CREATE TABLE invitations (
  id          UUID PRIMARY KEY,
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  patient_id  VARCHAR(64) REFERENCES patient(id),  -- NULL = family-wide invite
  email       VARCHAR(255),
  phone       VARCHAR(32),
  role_key    VARCHAR(32) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,           -- SHA-256; raw token only ever emailed
  invited_by  UUID NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  status      VARCHAR(16) NOT NULL                -- PENDING | ACCEPTED | EXPIRED | REVOKED
);

CREATE TABLE device_pairings (
  id          UUID PRIMARY KEY,
  patient_id  VARCHAR(64) NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  code_hash   CHAR(64) NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  device_label VARCHAR(120)
);

-- Commercial ----------------------------------------------------------------
CREATE TABLE subscriptions (
  id                 UUID PRIMARY KEY,
  family_id          UUID REFERENCES families(id),
  organization_id    UUID REFERENCES organizations(id),
  plan               VARCHAR(32) NOT NULL,      -- FREE | FAMILY | CARE_ORG
  status             VARCHAR(24) NOT NULL,
  seats              INT NOT NULL DEFAULT 1,
  current_period_end TIMESTAMPTZ,
  provider_ref       VARCHAR(128),
  CHECK (family_id IS NOT NULL OR organization_id IS NOT NULL)
);

-- Accountability ------------------------------------------------------------
CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  actor_role    VARCHAR(32),
  action        VARCHAR(64) NOT NULL,           -- patient.delete, memory.upload
  resource_type VARCHAR(32) NOT NULL,
  resource_id   VARCHAR(64),
  patient_id    VARCHAR(64),                    -- denormalised for "who saw Ma's data"
  ip            INET,
  user_agent    VARCHAR(255),
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_patient_time ON audit_logs (patient_id, created_at DESC);
```

**Multiple caregivers per patient** falls out of `caregiver_assignments` being a
row per pair. **Multiple family members per patient** falls out of
`user_roles(scope_type='FAMILY')`. **Care organisations** and **premium plans**
have their tables from day one but need no application logic until sold.

---

## 4. Permission matrix

`✓` granted · `—` denied · `▲` own assigned patients only · `△` read-only

| Permission | SUPER_ADMIN | FAMILY_ADMIN | FAMILY_MEMBER | CAREGIVER | DOCTOR | PATIENT |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `patient.create` | ✓ | ✓ | — | — | — | — |
| `patient.read` | ✓ | ✓ | ✓ | ▲ | ▲△ | self |
| `patient.update` | ✓ | ✓ | ✓ | — | — | — |
| `patient.delete` | ✓ | ✓ | — | — | — | — |
| `memory.upload` | — | ✓ | ✓ | — | — | — |
| `memory.view` | — | ✓ | ✓ | ▲ | — | self |
| `photo.upload` | — | ✓ | ✓ | — | — | — |
| `routine.manage` | — | ✓ | ✓ | — | — | — |
| `routine.complete` | — | ✓ | ✓ | ▲ | — | self |
| `medication.manage` | — | ✓ | ✓ | — | — | — |
| `medication.complete` | — | ✓ | ✓ | ▲ | — | self |
| `observation.create` | — | ✓ | ✓ | ▲ | ▲ | — |
| `carelog.write` | — | ✓ | ✓ | ▲ | — | — |
| `report.view` | ✓ | ✓ | ✓ | ▲ | ▲ | — |
| `session.play` | — | — | — | — | — | self |
| `invitation.create` | ✓ | ✓ | — | — | — | — |
| `caregiver.assign` | ✓ | ✓ | — | — | — | — |
| `family.permissions.manage` | ✓ | ✓ | — | — | — | — |
| `subscription.manage` | ✓ | ✓ | — | — | — | — |
| `device.pair` | ✓ | ✓ | ✓ | — | — | — |
| `platform.analytics.view` | ✓ | — | — | — | — | — |
| `organization.manage` | ✓ | — | — | — | — | — |
| `audit.view` | ✓ | ✓ | — | — | — | — |

Two rules worth stating explicitly, because they are the ones that get broken:

1. **A caregiver cannot delete a patient, manage a subscription, or change
   family permissions.** Those three are the spec's hard boundary.
2. **`SUPER_ADMIN` deliberately lacks `memory.view`.** Platform staff manage the
   platform; they do not read a grandmother's family photographs. Any
   break-glass access is a separate, always-audited, time-boxed grant.

---

## 5. Authorization in code

`AccessGuard` stays as the one readable place the rule lives — its signature
widens from a patient id to a *(permission, scope)* pair.

```java
// before
guard.requireAccessTo(patientId);

// after
guard.require(Permission.MEMORY_UPLOAD, Scope.patient(patientId));
guard.require(Permission.SUBSCRIPTION_MANAGE, Scope.family(familyId));
```

Resolution order, evaluated per request against the JWT's claims:

1. `SUPER_ADMIN` with a global grant → allow, **and always write an audit row**.
2. Direct `PATIENT` scope grant matching the resource → allow if the permission
   is in the patient's own set.
3. `CAREGIVER` / `DOCTOR` → allow if an **active** `caregiver_assignments` row
   covers this patient *and* the role holds the permission.
4. `FAMILY_ADMIN` / `FAMILY_MEMBER` → resolve the patient's `family_id`, allow if
   the user holds a matching family-scoped grant with the permission.
5. Otherwise **404, not 403** — the existing code already gets this right, and it
   should stay that way. Whether a patient exists is itself information.

The JWT should carry `sub`, `roles[]` with scopes, and a `perm_hash`; it should
**not** enumerate patient ids the way it does today. That list grows unbounded
and goes stale the moment an assignment is revoked. Resolve scope server-side,
cached in Redis (already a dependency) keyed by `user:{id}:grants` with a short
TTL and explicit eviction on any `user_roles` or `caregiver_assignments` write.

`@PreAuthorize("hasPermission(#patientId, 'PATIENT', 'memory.upload')")` via a
custom `PermissionEvaluator` is the idiomatic Spring alternative and is fine —
but keep the single readable guard class as the place the policy is written, and
let the annotation delegate to it.

---

## 6. API changes

New:

```
POST   /api/auth/register                 family member self-signup
POST   /api/families                      create family (caller becomes FAMILY_ADMIN)
POST   /api/families/{id}/patients        create a patient profile
POST   /api/families/{id}/invitations     invite relative or caregiver
POST   /api/invitations/{token}/accept    redeem → creates user + user_roles
GET    /api/families/{id}/members
DELETE /api/families/{id}/members/{userId}
POST   /api/patients/{id}/caregivers      assign
DELETE /api/patients/{id}/caregivers/{userId}
POST   /api/patients/{id}/pairing-codes   generate tablet pairing code
POST   /api/devices/redeem                tablet exchanges code for device token
GET    /api/patients/{id}/audit           family-visible access log
GET    /api/me/permissions                drives UI affordances
```

Changed:

- Every `/api/patients/**`, `/api/sessions/**`, `/api/garden/**`, `/api/family/**`
  handler swaps `requireAccessTo` for `require(permission, scope)`.
- `POST /api/auth/login` returns scoped grants instead of `patientIds`.
- `/api/caregiver/**` becomes `/api/care/**`; "caregiver" is now a role, not an
  audience.

Unchanged, deliberately: everything the patient's device calls. The PWA's
offline queue, sync dedupe and garden recompute do not move. The device token
simply carries a narrower grant than today's caregiver token.

---

## 7. Onboarding flow

```
Family member registers  →  POST /api/auth/register
        ↓                   creates users row + FAMILY_ADMIN grant (GLOBAL→FAMILY on family create)
Creates family           →  POST /api/families
        ↓
Creates patient profile  →  POST /api/families/{id}/patients
        ↓                   patient row + users row (no credentials) + PATIENT grant
Uploads memories         →  memory.upload, photo.upload
        ↓
Invites caregivers       →  POST /api/families/{id}/invitations  (role_key=CAREGIVER)
        ↓                   caregiver accepts → users row + caregiver_assignments
Pairs the tablet         →  POST /api/patients/{id}/pairing-codes
        ↓                   tablet redeems once → long-lived device token
Patient opens Smaran     →  language flower → her name → the pond
```

The patient's own first-run experience stays exactly three taps deep and never
mentions any of the above.

---

## 8. Migration plan

The project currently has no Flyway/Liquibase — schema comes from JPA
`ddl-auto`. **Add Flyway first**; an RBAC change is not something to let
Hibernate infer. Expand/contract, five deployable steps, no big-bang cutover:

| Phase | Change | Reversible? |
|---|---|---|
| **0** | Add Flyway, baseline the current schema | yes |
| **1** | Create all new tables empty. Seed `roles`, `permissions`, `role_permissions` from the matrix above | yes |
| **2** | Backfill: one `users` row per existing `Caregiver`; one family per caregiver's patient set; `user_roles` + `caregiver_assignments` from `assigned_patient_ids`. Dual-write both models | yes |
| **3** | `AccessGuard` consults the new tables behind `smaran.security.rbac-v2=true`. Run both in shadow: evaluate old and new, log every disagreement, ship nothing that disagrees | yes |
| **4** | Flip the flag per environment. JWTs stop carrying `patientIds` | flag flip |
| **5** | Drop `caregiver.assigned_patient_ids` and the `Caregiver` entity | **no** — hold ≥1 release after phase 4 |

Phase 3 is the one that protects you. A silent authorization regression is the
worst possible bug in this product; shadow-mode disagreement logs are how you
find it before a caregiver sees another family's patient.

Backfill ambiguity to decide before phase 2: an existing caregiver assigned to
patients who are *not* relatives of one another produces one family per patient,
not one family. Default to that, and let families merge later.

---

## 9. Performance

- Resolve grants once per request into a `SmaranPrincipal`; never query per check.
- Redis cache `user:{id}:grants`, TTL 5 min, evicted on any grant write. Redis is
  already in `docker-compose.yml`.
- `audit_logs` is append-only and will dominate write volume. Partition by month
  and archive cold partitions; never index it into the request path.
- The permission matrix is small and static — load it into memory at boot.

## 10. Accessibility

The patient side inherits the constraints already in the codebase and must not
regress: `--tap-target` floor, `prefers-reduced-motion` stillness, no failure
states, no numbers, no clinical language. **None of the RBAC surface renders on
the patient device** — a permission error there resolves to the pond, never to a
403 screen.

The caregiver side may be information-rich, and should stay conventional: real
tables, real labels, real errors.
