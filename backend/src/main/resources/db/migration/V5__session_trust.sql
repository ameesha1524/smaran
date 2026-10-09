-- Phase 4: who vouches for a stored session's scores.
--
-- 'device'  the contributions were computed on the tablet and the server accepted
--           them after range and plausibility checks. This is the documented
--           trust boundary: a tablet that lies within the allowed range is not
--           caught by those checks.
-- 'server'  the server re-scored the session from its raw trials and agreed.
alter table game_session
    add column scoring_trust varchar(20) not null default 'device'
        check (scoring_trust in ('device', 'server'));
