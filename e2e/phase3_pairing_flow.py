"""Two browsers, one patient: the family mints a code, a second browser (the tablet) pairs with it
and reaches her pond, and removing the tablet stops its sync without alarming anyone.

A Windows developer script, like phase2_ui_flow.py (same set-up: see its header; run the backend in
the DEMO profile and the frontend on 5173). Phase 7 replaces both with a Playwright suite in CI.

  python e2e/phase3_pairing_flow.py

The two browsers are two Chrome processes with separate profiles, so they share no storage, exactly
as a family phone and a tablet would not.
"""
import asyncio, json, os, re, subprocess, time, urllib.request, uuid

import websockets

from phase2_ui_flow import Browser, CHROME, OUT, PW, check, fails  # noqa: E402

CODE = re.compile(r'\b[ACDEFGHJKMNPQRTUVWXYZ2-9]{4}-[ACDEFGHJKMNPQRTUVWXYZ2-9]{2}\b')


async def launch(port):
    proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', f'--remote-debugging-port={port}',
                             f'--user-data-dir={OUT}\\chrome-p3-{port}-{uuid.uuid4().hex[:6]}', '--window-size=1280,1000',
                             'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tabs = None
    for _ in range(80):
        try:
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            break
        except Exception:
            time.sleep(0.25)
    ws_url = [t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']
    ws = await websockets.connect(ws_url, max_size=50_000_000)
    b = Browser(ws)
    await b.send('Runtime.enable')
    await b.send('Page.enable')
    return proc, ws, b


async def wait_exact(browser, path, timeout=10):
    """Wait for exactly this path. Browser.wait_path matches by prefix, and every path starts with '/'."""
    end = time.time() + timeout
    while time.time() < end:
        if (await browser.path()) == path:
            return True
        await asyncio.sleep(0.3)
    return False


async def onboard(family, patient_name):
    """A new family: register, then add the person they care for (with the guardian's consent)."""
    email = f'p3{uuid.uuid4().hex[:8]}@example.com'
    await family.goto('/caregiver/register')
    await family.wait_text('Create an account')
    await family.fill('Your name', 'Rupa Sharma')
    await family.fill('Email', email)
    await family.fill('Password', PW)
    await family.click('Create account')
    await family.wait_text('You have not added anyone yet')
    await family.click('Add the person you care for')
    await family.wait_text('Who do you care for?')
    await family.fill('Her name', patient_name)
    await family.js("document.querySelector('input[type=checkbox]').click()")
    await family.fill('Your name, as her guardian', 'Rupa Sharma')
    await family.click('Add her')
    return await family.wait_text(patient_name.split()[0])


async def type_code(tablet, code):
    ok = await tablet.js("""(() => {
      const el = document.querySelector('input[aria-label^="Pairing code"]'); if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, %s);
      el.dispatchEvent(new Event('input', {bubbles: true})); return true; })()""" % json.dumps(code))
    assert ok, 'no pairing input'


async def mint(family):
    """Press 'Get a pairing code' (or 'Get a new code') and read what the screen shows."""
    await family.wait_text('Her tablet')
    before = set(CODE.findall(await family.text()))
    await family.click('Get a pairing code' if await family.has_control('Get a pairing code') else 'Get a new code')
    end = time.time() + 10
    while time.time() < end:
        found = [c for c in CODE.findall(await family.text()) if c not in before]
        if found:
            return found[0]
        await asyncio.sleep(0.3)
    return None


async def pair(tablet, code):
    await tablet.goto('/pair')
    await tablet.wait_text('Pair this tablet')
    await type_code(tablet, code)
    await asyncio.sleep(0.2)
    await tablet.click('Pair this tablet')


async def token_status(tablet, token, path='/api/device/me', method='GET'):
    return await tablet.js("""fetch(%s, {method: %s, headers: {Authorization: 'Bearer ' + %s}}).then(r => r.status)"""
                           % (json.dumps(path), json.dumps(method), json.dumps(token)))


async def main():
    fp, fws, family = await launch(9461)
    tp, tws, tablet = await launch(9462)
    try:
        # 1. The family signs in and asks for a code.
        # A new family each run, so earlier runs leave nothing behind to interfere.
        check('a new family adds the person they care for', await onboard(family, 'Mira Sengupta'))
        code1 = await mint(family)
        check('a code is shown as HJ4K-2M', code1 is not None, (await family.text())[-400:])
        t = await family.text()
        check('it says it lasts three days, and can be copied', 'three days' in t and await family.has_control('Copy the code'))
        await family.shot('p3_family_code')

        # 2. A second browser, with nothing in it, is sent to /pair.
        await tablet.goto('/')
        check('a tablet that is not paired is sent to /pair', await tablet.wait_path('/pair'))
        check('and it asks for the code in plain words', await tablet.wait_text('Pair this tablet'))
        await tablet.shot('p3_pair_empty')

        # 3. A wrong code gets a gentle answer, and nothing else.
        await type_code(tablet, 'AAAAAA')
        await asyncio.sleep(0.2)
        await tablet.click('Pair this tablet')
        check('a wrong code gets a gentle answer', await tablet.wait_text('didn’t work'))
        check('and stays on /pair', (await tablet.path()) == '/pair')
        await tablet.shot('p3_pair_wrong')

        # 4. The right code pairs it; she confirms her language; she is at her pond.
        await type_code(tablet, code1.lower())
        await asyncio.sleep(0.2)
        await tablet.click('Pair this tablet')
        check('the right code pairs the tablet (typed in lower case)', await tablet.wait_path('/language'), await tablet.path())
        await tablet.shot('p3_language')
        await tablet.js("document.querySelector('.plaque-fade button').click()")
        check('after her language she reaches the pond', await wait_exact(tablet, '/', 8), await tablet.path())
        await asyncio.sleep(1.5)
        check('and stays there', (await tablet.path()) == '/')
        await tablet.shot('p3_pond')

        token = await tablet.js("localStorage.getItem('smaran.deviceToken')")
        check('the tablet holds an opaque token, not a JWT', bool(token) and token.startswith('sdt_') and '.' not in token, token)
        check('the family-side token is not on the tablet', 'eyJ' not in (await tablet.js('JSON.stringify(Object.entries(localStorage))') or ''))
        cached = await tablet.js("""new Promise((res) => {
          const open = indexedDB.open('smaran');
          open.onsuccess = () => { const all = open.result.transaction('cache').objectStore('cache').getAll();
            all.onsuccess = () => res(JSON.stringify(all.result)); all.onerror = () => res('error'); };
          open.onerror = () => res('error'); })""")
        check('what the tablet kept holds her first name and not her surname', 'Mira' in cached and 'Sengupta' not in cached, cached[:300])

        # 5. The tablet reaches only its own door.
        check('the token opens /api/device/me', await token_status(tablet, token) == 200)
        check('the token opens nothing of the family\'s', await token_status(tablet, token, '/api/patients') == 403)

        # 6. The family sees the tablet.
        await family.goto('/caregiver/dashboard')
        await family.wait_text('Her tablet')
        check('the family sees the paired tablet', await family.wait_text('Paired just now'), (await family.text())[-600:])
        await family.shot('p3_family_devices')

        # 7. A story only the tablet knows: something she has written, kept on the tablet.
        await tablet.js("localStorage.setItem('smaran.journal', JSON.stringify([{id:'j1', text:'a private thought', timestamp: 1}]))")

        # 8. The family removes the tablet; its next request is refused and it goes quiet.
        await family.click('Remove')
        await family.click('Yes, remove access')
        check('the family no longer lists the tablet', await family.wait_text('None yet'))
        check('the removed token is refused at once', await token_status(tablet, token) == 401)
        check('and so is a session it was about to send',
              await token_status(tablet, token, '/api/device/sessions', 'POST') == 401)

        await tablet.goto('/')
        await asyncio.sleep(2.5)
        check('the removed tablet still shows her pond: nothing alarming', (await tablet.path()) == '/', await tablet.path())
        text = await tablet.text()
        check('and says nothing about it', not any(w in text.lower() for w in ('revoked', 'removed', 'unauthor', 'error', 'denied')), text[:300])
        check('it went quiet, keeping what she had',
              await tablet.js("localStorage.getItem('smaran.deviceSuspendedAt')") is not None
              and 'private thought' in (await tablet.js("localStorage.getItem('smaran.journal')") or ''))

        # 9. Pairing again to the SAME patient resumes, and keeps what she had.
        code2 = await mint(family)
        check('the family can mint another code', code2 is not None and code2 != code1)
        await pair(tablet, code2)
        check('the same patient: pairs again and goes straight to her pond (she has already chosen a language)',
              await wait_exact(tablet, '/', 10), await tablet.path())
        await asyncio.sleep(1.2)
        check('the suspension is cleared',
              await tablet.js("localStorage.getItem('smaran.deviceSuspendedAt')") is None)
        check('and what she had written is still there',
              'private thought' in (await tablet.js("localStorage.getItem('smaran.journal')") or ''))
        token2 = await tablet.js("localStorage.getItem('smaran.deviceToken')")
        check('with a new token', token2 and token2 != token and await token_status(tablet, token2) == 200)

        # 10. Pairing to a DIFFERENT patient wipes the first one's information first.
        await family.goto('/caregiver/patients/new')
        await family.wait_text('Who do you care for?')
        await family.fill('Her name', 'Second Patient')
        await family.js("document.querySelector('input[type=checkbox]').click()")
        await family.fill('Your name, as her guardian', 'Rupa Sharma')
        await family.click('Add her')
        check('the family adds a second patient', await family.wait_text('Second Patient'))
        code3 = await mint(family)
        check('and mints a code for her', code3 is not None)
        await pair(tablet, code3)
        check('the tablet pairs to the second patient', await tablet.wait_path('/language', 10), await tablet.path())
        check('the first patient\'s journal was wiped first',
              (await tablet.js("localStorage.getItem('smaran.journal')")) is None)
        cached = await tablet.js("""new Promise((res) => {
          const open = indexedDB.open('smaran');
          open.onsuccess = () => { const all = open.result.transaction('cache').objectStore('cache').getAll();
            all.onsuccess = () => res(JSON.stringify(all.result)); all.onerror = () => res('error'); };
          open.onerror = () => res('error'); })""")
        check('and the tablet now holds the second patient, not the first', 'Second' in cached and 'Mira' not in cached, cached[:300])
        check('the first token no longer works either', await token_status(tablet, token) == 401)

        for who, br in (('family', family), ('tablet', tablet)):
            check(f'no uncaught errors in the {who} page', not br.errors, br.errors[:3])
    finally:
        for p in (fp, tp):
            p.terminate()
    print(f'\n{len(fails)} failure(s)')


if __name__ == '__main__':
    asyncio.run(main())
