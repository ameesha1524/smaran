"""Games to server to dashboards: the showcase steps 2 to 7, in real browsers against the real backend.

A Windows developer script like phase2_ui_flow.py and phase3_pairing_flow.py (same set-up: see the
header of phase2_ui_flow.py; backend in the DEMO profile, frontend on 5173). Phase 7 replaces these
with a Playwright suite in CI.

  python e2e/phase4_games_flow.py

Three Chrome processes with separate profiles: the family's phone, the tablet, and a doctor's computer.
The tablet plays Duck Roll Call through its real screen, and Morning Rituals with the network cut,
then reconnects. The Lotus Frog and Koi games are canvas games that a script cannot play; their
scoring is covered by the unit tests, and their wiring by the same `completeSession` the two
games played here go through.
"""
import asyncio, json, os, re, time, uuid

from phase2_ui_flow import Browser, PW, check, fails, OUT
from phase3_pairing_flow import launch, onboard, mint, pair, wait_exact, token_status

HERE = os.path.dirname(os.path.abspath(__file__))
DUCK_SRC = open(os.path.join(HERE, '..', 'frontend', 'src', 'games', 'DuckRollCall.tsx'), encoding='utf-8').read()

# The number tiles are pixel art, so a script reads each digit by its glyph. Parsed from the game's own
# source, so a changed glyph fails here rather than being silently misread.
GLYPH_BLOCK = re.search(r"const DIGIT_GLYPH[^{]*\{(.*?)\n\}", DUCK_SRC, re.S).group(1)
GLYPH_TO_DIGIT = {m.group(2): int(m.group(1)) for m in re.finditer(r"(\d):\s*'([^']+)'", GLYPH_BLOCK)}


async def click_xy(b, x, y):
    await b.send('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y)
    await b.send('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
    await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)


async def centre(b, selector, nth=0):
    return await b.js("""(() => { const el = document.querySelectorAll(%s)[%d]; if (!el) return null;
      el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2]; })()""" % (json.dumps(selector), nth))


async def duck_round(tablet, wrong_first=False):
    """Play one round of Duck Roll Call: read the flashed numbers, wait for them to vanish, tap in order."""
    await tablet.js("document.querySelector('.drc-btn').click()")
    digits = None
    end = time.time() + 6
    while time.time() < end:
        digits = await tablet.js("""(() => {
          const out = [];
          document.querySelectorAll('.px-stage button[aria-label="Duckling"]').forEach((btn, i) => {
            const wrap = btn.parentElement; const svg = wrap.querySelector('svg[width="90"]');
            if (svg) out.push({i, d: svg.querySelectorAll('path')[2].getAttribute('d')});
          });
          return out; })()""")
        if digits:
            break
        await asyncio.sleep(0.1)
    assert digits, 'no numbers flashed'
    order = sorted(digits, key=lambda x: GLYPH_TO_DIGIT[x['d']])
    # Wait for the numbers to vanish: that is the recall phase.
    end = time.time() + 6
    while time.time() < end:
        gone = await tablet.js("document.querySelectorAll('.px-stage svg[width=\"90\"]').length === 0")
        if gone:
            break
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.3)
    if wrong_first and len(order) > 1:
        await tablet.js("document.querySelectorAll('.px-stage button[aria-label=\"Duckling\"]')[%d].click()" % order[1]['i'])
        await asyncio.sleep(0.2)
    for item in order:
        await tablet.js("document.querySelectorAll('.px-stage button[aria-label=\"Duckling\"]')[%d].click()" % item['i'])
        await asyncio.sleep(0.15)
    await asyncio.sleep(0.6)
    return len(order)


async def pending_count(tablet):
    return await tablet.js("""new Promise((res) => { const open = indexedDB.open('smaran');
      open.onsuccess = () => { const all = open.result.transaction('pending_sessions').objectStore('pending_sessions').getAll();
        all.onsuccess = () => res(all.result.length); all.onerror = () => res(-1); }; open.onerror = () => res(-1); })""")


async def pending_envelopes(tablet):
    return await tablet.js("""new Promise((res) => { const open = indexedDB.open('smaran');
      open.onsuccess = () => { const all = open.result.transaction('pending_sessions').objectStore('pending_sessions').getAll();
        all.onsuccess = () => res(all.result); }; })""")


async def set_offline(b, offline):
    await b.send('Network.enable')
    await b.send('Network.emulateNetworkConditions', offline=offline, latency=0, downloadThroughput=-1, uploadThroughput=-1)


async def play_rituals(tablet):
    """Put the morning in order by trying icons in each place, as a person would: wrong tries included."""
    await tablet.wait_text('Put your morning back in order') if False else await asyncio.sleep(1.0)
    total = await tablet.js("document.querySelectorAll('div.slot-waiting').length")
    for slot in range(total):
        placed = False
        icons = await tablet.js("document.querySelectorAll('button.petal-card').length")
        for k in range(icons):
            before = await tablet.js("document.querySelectorAll('div.slot-waiting').length")
            ix, iy = await centre(tablet, 'button.petal-card', k)
            await click_xy(tablet, ix, iy)
            # The slot that is still waiting at this position.
            sx, sy = await centre(tablet, 'div.slot-waiting', 0)
            await click_xy(tablet, sx, sy)
            await asyncio.sleep(0.5)
            after = await tablet.js("document.querySelectorAll('div.slot-waiting').length")
            if after < before:
                placed = True
                break
            await asyncio.sleep(1.1)  # the misplaced icon drifts home
        assert placed, f'could not place anything in slot {slot}'
    await asyncio.sleep(3.2)  # the game finishes itself after a moment


async def main():
    fp, fws, family = await launch(9471)
    tp, tws, tablet = await launch(9472)
    dp, dws, doc = await launch(9473)
    try:
        # ---------------------------------------------------------- step 2
        await family.sign_in('rupa@example.com', 'smaran')
        await family.wait_path('/caregiver/dashboard')
        check('the demo family sees a populated dashboard', await family.wait_text('Where she is'))
        await family.wait_text('Recent sessions')
        await asyncio.sleep(1.5)
        cards = await family.js("document.querySelectorAll('article[aria-label]').length")
        check('six domain cards, and the one sub-signal the games measured', cards >= 7, cards)
        t = await family.text()
        check('each card says how sure it is, and where it is too early to say',
              'Confidence' in t and ('too early to say' in t or 'steady' in t), t[:400])
        check('the clinician marker shows the working-memory span', 'Clinician markers' in t and '5 things' in t, t[t.find('Clinician'):][:200])
        check('there is a trend chart', bool(await family.js("!!document.querySelector('.recharts-wrapper')")))
        await family.js("[...document.querySelectorAll('summary')].find(s => s.innerText.includes('Duck Roll Call'))?.click()")
        await asyncio.sleep(0.3)
        t = await family.text()
        check('a session opens to its reasons', 'out of 100, with' in t and 'Synthetic demo history.' in t, t[t.find('Recent sessions'):][:300])
        check('and says the server checked a Duck Roll Call session from the raw rounds', 'checked by the server from the raw rounds' in t)
        check('the family sees the live indicator', await family.wait_text('live', 10))
        await family.shot('p4_family_demo')

        # ---------------------------------------------------------- step 3
        await family.sign_out() if await family.has_control('Sign out') else None
        await family.wait_path('/caregiver/login')
        check('a new family adds a patient (with consent)', await onboard(family, 'Mira Sengupta'))
        patient_path = await family.path()
        code = await mint(family)
        check('and mints a code', code is not None)
        await pair(tablet, code)
        check('the tablet pairs', await tablet.wait_path('/language', 10), await tablet.path())
        await tablet.js("document.querySelector('.plaque-fade button').click()")
        check('and reaches her pond', await wait_exact(tablet, '/', 8))
        token = await tablet.js("localStorage.getItem('smaran.deviceToken')")
        await family.goto(patient_path)
        check('the family dashboard says she has not played yet', await family.wait_text('She has not played yet.', 10))
        check('and is listening for her', await family.wait_text('live', 10))

        # ---------------------------------------------------------- step 4
        await tablet.goto('/game/duck-roll-call')
        await asyncio.sleep(1.5)
        n1 = await duck_round(tablet)
        await tablet.js("document.querySelector('.drc-btn').click()")
        await asyncio.sleep(0.4)
        await duck_round(tablet)
        await tablet.js("document.querySelector('.drc-btn').click()")
        await asyncio.sleep(0.4)
        await duck_round(tablet, wrong_first=True)
        await tablet.shot('p4_tablet_duck')
        await tablet.js("document.querySelector('.drc-back').click()")
        check('the tablet played three rounds of Duck Roll Call', n1 >= 3, n1)
        started = time.time()
        shown = await family.wait_text('Duck Roll Call', 12)
        check('within seconds the dashboard shows the session, live', shown, f'{time.time() - started:.1f}s')
        await family.wait_text('from 1 reading', 8)
        t = await family.text()
        check('and the domain it read now has a reading', 'from 1 reading' in t, t[:600])
        await family.js("[...document.querySelectorAll('summary')].find(s => s.innerText.includes('Duck Roll Call'))?.click()")
        await asyncio.sleep(0.3)
        t = await family.text()
        check('the session carries its reason, including the wrong tap in round three',
              'Held about' in t and 'ducklings in mind across 3 rounds, 2 of them with no wrong tap' in t, t[t.find('Held about') - 80:][:300])
        check('and the server agreed with the tablet\'s scoring from the raw rounds',
              'checked by the server from the raw rounds' in t)
        await family.shot('p4_family_after_duck')

        # ---------------------------------------------------------- step 5
        await tablet.goto('/game/morning-rituals')
        await asyncio.sleep(1.5)
        await set_offline(tablet, True)
        await play_rituals(tablet)
        queued = await pending_count(tablet)
        check('offline, the finished game waits in the tablet\'s queue', queued == 1, queued)
        env_list = await pending_envelopes(tablet)
        check('as an envelope with its raw attempts and its reasons',
              bool(env_list) and env_list[0]['gameId'] == 'morning-rituals' and len(env_list[0]['trials']) >= 3
              and env_list[0]['contributions'][0]['because'], json.dumps(env_list)[:300])
        await set_offline(tablet, False)
        await tablet.js("window.dispatchEvent(new Event('online'))")
        end = time.time() + 12
        while time.time() < end and await pending_count(tablet) != 0:
            await asyncio.sleep(0.4)
        check('back online, the queue drains once', await pending_count(tablet) == 0)
        check('and the family sees it', await family.wait_text('Morning Rituals', 12))
        rows_before = await family.js("document.querySelectorAll('details').length")
        replay = await tablet.js("""fetch('/api/device/sessions/batch', {method: 'POST',
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + %s},
          body: JSON.stringify({sessions: %s})}).then(r => r.json())""" % (json.dumps(token), json.dumps(env_list)))
        check('sending the same batch again changes nothing',
              replay.get('accepted') == 0 and replay.get('duplicates') == 1 and not replay.get('rejected'), replay)
        await asyncio.sleep(1.5)
        check('the family\'s list has not grown', await family.js("document.querySelectorAll('details').length") == rows_before)

        # ---------------------------------------------------------- step 6
        await family.fill('Doctor', 'meera.das@example.com')
        await family.click('Share')
        check('the family shares her with the demo doctor', await family.wait_text('Meera Das', 10))
        await doc.sign_in('meera.das@example.com', 'smaran')
        check('the doctor reaches her home', await doc.wait_path('/doctor'))
        check('and sees the patient shared with her', await doc.wait_text('Mira Sengupta', 10))
        await doc.js("[...document.querySelectorAll('li')].find(li => li.innerText.includes('Mira'))?.querySelector('a')?.click()")
        check('the doctor opens her dashboard', await doc.wait_path('/doctor/patient/'))
        await doc.wait_text('Where she is', 12)
        t = await doc.text()
        check('it is read-only, with the date the sharing ends', 'Read-only.' in t and 'Shared with you until' in t)
        check('it shows her trends and sessions', 'Where she is' in t and 'Recent sessions' in t and 'Duck Roll Call' in t)
        check('without the family around her', 'Who she still knows' not in t and 'Add another person' not in t
              and 'Her tablet' not in t and 'Who can see her' not in t and 'I’ve seen this' not in t)
        check('and no raw rounds anywhere on the page (the journal panel shows readings only, never her words)',
              not any(w in t.lower() for w in ('spanlength', 'trials', 'flashduration', 'correctfirstattempt'))
              and 'Her words are never kept or shown' in t)
        did = (await doc.path()).split('/')[-1]
        api = await doc.js("""(async () => {
          const r = await fetch('/api/auth/refresh', {method: 'POST', credentials: 'same-origin'}).then(r => r.json());
          const h = {Authorization: 'Bearer ' + r.accessToken};
          const own = await fetch('/api/caregiver/patients/%s/sessions', {headers: h});
          const other = await fetch('/api/caregiver/patients/%s/sessions', {headers: h});
          const dash = await fetch('/api/caregiver/dashboard/%s', {headers: h});
          const mint = await fetch('/api/patients/%s/pairing-codes', {method: 'POST', headers: h});
          const ack = await fetch('/api/patients/%s/alerts/x/acknowledge', {method: 'POST', headers: h});
          return {own: own.status, ownBody: (await own.text()), other: other.status, dash: (await dash.json()),
                  mint: mint.status, ack: ack.status}; })()""" % (did, str(uuid.uuid4()), did, did, did))
        check('the API gives the doctor her sessions, and not her raw trials',
              api['own'] == 200 and 'trials' not in api['ownBody'].lower() and 'spanLength' not in api['ownBody'], api['ownBody'][:200])
        check('a patient who has not shared with her is a 404', api['other'] == 404, api['other'])
        check('her dashboard payload is the doctor\'s view, with no family members',
              api['dash']['doctorView'] is True and api['dash']['familyPhases'] == [])
        check('a doctor cannot mint a pairing code or acknowledge an alert', api['mint'] == 403 and api['ack'] == 403, (api['mint'], api['ack']))

        # ---------------------------------------------------------- step 7
        await family.goto(patient_path)
        await family.wait_text('Her tablet')
        for _ in range(40):  # the tablet list loads after the panel does
            if await family.has_control('Remove'):
                break
            await asyncio.sleep(0.25)
        await family.click('Remove')
        await family.click('Yes, remove access')
        check('the family removes the tablet', await family.wait_text('None yet', 10))
        check('its next sync is refused', await token_status(tablet, token, '/api/device/sessions/batch', 'POST') == 401)
        await tablet.goto('/')
        await asyncio.sleep(2.5)
        text = await tablet.text()
        check('and the tablet stays calm: still her pond, nothing alarming',
              (await tablet.path()) == '/' and not any(w in text.lower() for w in ('revoked', 'removed', 'unauthor', 'error', 'denied')), text[:200])
        check('it has quietly stopped asking', await tablet.js("localStorage.getItem('smaran.deviceSuspendedAt')") is not None)

        for who, br in (('family', family), ('tablet', tablet), ('doctor', doc)):
            check(f'no uncaught errors in the {who} page', not br.errors, br.errors[:3])
    finally:
        for p in (fp, tp, dp):
            p.terminate()
    print(f'\n{len(fails)} failure(s)')


if __name__ == '__main__':
    asyncio.run(main())
