"""Drive the real UI in headless Chrome against the real backend: caregiver, doctor, admin.

A Windows developer script, kept so the Phase 2 result is reproducible. Phase 7
replaces it with a Playwright suite that runs in CI.

Needs (all from the repo root):

  1. The backend in the DEMO profile (seeded accounts, authentication on), no Docker needed:
       cd backend
       mvn spring-boot:test-run -Dspring-boot.run.main-class=org.smaran.LocalDevApplication \
           "-Dspring-boot.run.jvmArguments=-Dspring.profiles.active=demo -Dserver.port=8089 -Dsmaran.local.pg.dir=C:/path/outside/onedrive"
  2. The frontend on port 5173 (the one origin the backend allows), proxied to it:
       cd frontend
       set VITE_API_TARGET=http://localhost:8089 && npx vite --port 5173 --strictPort
  3. pip install websockets, and Google Chrome in its default location.

Run:  python e2e/phase2_ui_flow.py

It creates new accounts every run. The backend allows 10 sign-ups per address
per hour, which is more than one run uses.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request, uuid
import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(tempfile.gettempdir(), 'smaran-e2e')
os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:5173'
PORT = 9444
PW = 'correct-horse-battery'
fails = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else '   -> ' + str(detail)))
    if not ok:
        fails.append(name)


class Browser:
    def __init__(self, ws):
        self.ws, self.mid, self.errors = ws, 0, []

    async def send(self, method, **params):
        self.mid += 1
        mid = self.mid
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('method') == 'Runtime.exceptionThrown':
                self.errors.append(msg['params']['exceptionDetails'].get('exception', {}).get('description', '')[:200])
            if msg.get('id') == mid:
                return msg.get('result', {})

    async def js(self, expr):
        r = await self.send('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        return r.get('result', {}).get('value')

    async def goto(self, path):
        await self.send('Page.navigate', url=BASE + path)
        await asyncio.sleep(0.8)

    async def text(self):
        return await self.js('document.body.innerText') or ''

    async def path(self):
        return await self.js('location.pathname')

    async def wait_text(self, needle, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            t = await self.text()
            if needle in t:
                return True
            await asyncio.sleep(0.4)
        return False

    async def wait_path(self, prefix, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            if (await self.path() or '').startswith(prefix):
                return True
            await asyncio.sleep(0.4)
        return False

    async def fill(self, label, value):
        ok = await self.js("""(() => {
          const l = [...document.querySelectorAll('label')].find(x => x.innerText.trim().startsWith(%s));
          const el = l && l.querySelector('input,select'); if (!el) return false;
          const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, %s);
          el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
          return true; })()""" % (json.dumps(label), json.dumps(value)))
        assert ok, f'no field labelled {label}'

    async def click(self, text, tag='button,a'):
        ok = await self.js("""(() => {
          const b = [...document.querySelectorAll(%s)].find(x => x.innerText.trim() === %s || x.innerText.trim().startsWith(%s));
          if (!b) return false; b.click(); return true; })()""" % (json.dumps(tag), json.dumps(text), json.dumps(text)))
        assert ok, f'no control {text}'

    async def has_control(self, text):
        return bool(await self.js("""[...document.querySelectorAll('button,a')].some(x => x.innerText.trim().startsWith(%s))""" % json.dumps(text)))

    async def shot(self, name):
        r = await self.send('Page.captureScreenshot', format='png', captureBeyondViewport=True)
        open(os.path.join(OUT, f'ui_{name}.png'), 'wb').write(base64.b64decode(r['data']))

    async def sign_in(self, email, pw=PW):
        await self.goto('/caregiver/login')
        await self.wait_text('For family')
        await self.fill('Email', email)
        await self.fill('Password', pw)
        await self.click('Sign in')

    async def sign_out(self):
        await self.click('Sign out')
        await self.wait_path('/caregiver/login')


async def main():
    proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', f'--remote-debugging-port={PORT}',
                             f'--user-data-dir={OUT}\\chrome-e2e-{uuid.uuid4().hex[:6]}', '--window-size=1280,1600', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json'))
                break
            except Exception:
                time.sleep(0.25)
        ws_url = [t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']
        async with websockets.connect(ws_url, max_size=50_000_000) as ws:
            b = Browser(ws)
            await b.send('Runtime.enable')
            await b.send('Page.enable')

            # 1. A caregiver signs in with the seeded demo account.
            await b.sign_in('rupa@example.com', 'smaran')
            check('caregiver reaches her dashboard', await b.wait_path('/caregiver/dashboard'))
            check('it shows the patient', await b.wait_text('Anima Baruah'))
            t = await b.text()
            check('caregiver sees the pairing and sharing panels', 'Her tablet' in t and 'Who can see her' in t)
            check('the demo doctor is listed as having access', await b.wait_text('Meera Das'), (await b.text())[-500:])
            await b.shot('caregiver_dashboard')

            # 2. Still signed in after a full reload: the HttpOnly cookie, not storage.
            await b.goto('/caregiver/dashboard')
            check('still signed in after a reload', await b.wait_text('Anima Baruah'))
            stored = await b.js("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
            check('no token is in browser storage', 'eyJ' not in (stored or ''), stored)
            check('the refresh cookie is not readable by script', 'smaran_rt' not in (await b.js('document.cookie') or ''))

            # 3. Signing out ends it, and the dashboard is closed again.
            await b.sign_out()
            await b.goto('/caregiver/dashboard')
            check('signed out: the dashboard sends you to sign in', await b.wait_path('/caregiver/login'))

            # 4. A new caregiver registers, adds a patient with consent.
            email = f'e2e{uuid.uuid4().hex[:8]}@example.com'
            await b.goto('/caregiver/register')
            await b.wait_text('Create an account')
            await b.fill('Your name', 'Test Carer')
            await b.fill('Email', email)
            await b.fill('Password', 'short')
            await b.click('Create account')
            await asyncio.sleep(0.2)
            check('a weak password is refused (in the browser)', (await b.path()) == '/caregiver/register')
            await b.fill('Password', 'password123')
            # minLength passes at 11 chars, so the server's own rule is what answers.
            await b.click('Create account')
            check('a common password gets the server\'s sentence', await b.wait_text('too common'))
            await b.fill('Password', PW)
            await b.click('Create account')
            check('registering signs her in', await b.wait_path('/caregiver/dashboard'))
            check('no patients yet: she is invited to add one', await b.wait_text('You have not added anyone yet'))
            await b.shot('empty_dashboard')
            await b.click('Add the person you care for')
            await b.wait_text('Who do you care for?')
            await b.fill('Her name', 'Test Patient')
            disabled = await b.js("[...document.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('Add her')).disabled")
            check('"Add her" is disabled until consent is given', disabled is True)
            await b.js("document.querySelector('input[type=checkbox]').click()")
            await b.fill('Your name, as her guardian', 'Test Carer')
            await b.click('Add her')
            check('she is added and her dashboard opens', await b.wait_path('/caregiver/dashboard/'))
            check('the new dashboard loads for her', await b.wait_text('Test Patient'))
            patient_path = await b.path()

            # 5. Share her with the demo doctor.
            await b.wait_text('Who can see her')
            await b.fill('Doctor', 'meera.das@example.com')
            await b.click('Share')
            check('sharing with a doctor works', await b.wait_text('Meera Das'))
            await b.fill('Doctor', 'nobody@example.com')
            await b.click('Share')
            check('sharing with a stranger says so', await b.wait_text('no approved doctor'))
            await b.shot('shared')
            await b.sign_out()

            # 6. The doctor sees the shared patient, read-only.
            await b.sign_in('meera.das@example.com', 'smaran')
            check('a doctor lands on the doctor home', await b.wait_path('/doctor'))
            check('and sees the patient shared with her', await b.wait_text('Test Patient'))
            await b.click('Open')
            check('opening a patient shows her dashboard', await b.wait_path('/doctor/patient/'))
            check('it names the patient', await b.wait_text('Test Patient'))
            t = await b.text()
            check('it says it is read-only and until when', 'Read-only' in t and 'Shared with you until' in t, t[:300])
            check('no pairing or sharing controls for a doctor', 'Her tablet' not in t and 'Who can see her' not in t)
            check('no Setup link for a doctor', not await b.has_control('Setup'))
            check('the PDF is offered', await b.has_control('PDF for the doctor'))
            await b.shot('doctor_view')

            await b.goto('/caregiver/dashboard')
            check('a doctor is turned away from the caregiver area', await b.wait_path('/doctor'))
            await b.goto('/admin')
            check('a doctor is turned away from admin', await b.wait_path('/doctor'))
            await b.sign_out()

            # 7. The family stops sharing; the doctor loses her at once.
            await b.sign_in(email)
            await b.wait_path('/caregiver/dashboard')
            await b.goto(patient_path)
            await b.wait_text('Who can see her')
            await b.wait_text('Meera Das')
            await b.click('Stop sharing')
            check('stopping sharing is reflected', await b.wait_text('No doctor can see her right now'))
            check('and the trail shows who looked', await b.wait_text('Who has looked'))
            await b.shot('revoked')
            await b.sign_out()
            await b.sign_in('meera.das@example.com', 'smaran')
            await b.wait_path('/doctor')
            await b.goto(patient_path.replace('/caregiver/dashboard/', '/doctor/patient/'))
            check('after revoking, the doctor is told she is not available',
                  await b.wait_text('no longer have access'))
            await b.sign_out()

            # 8. A new doctor registers, waits, and is approved by an admin.
            demail = f'doc{uuid.uuid4().hex[:8]}@example.com'
            await b.goto('/caregiver/register')
            await b.wait_text('Create an account')
            await b.click('Doctor')
            await b.fill('Your name', 'Dr Newcomer')
            await b.fill('Email', demail)
            await b.fill('Password', PW)
            await b.click('Create account')
            check('a doctor is told to wait for approval', await b.wait_text('administrator will approve'))
            await b.sign_in(demail)
            check('and cannot sign in yet', await b.wait_text('waiting for an administrator'))

            await b.sign_in('admin@example.com', 'smaran')
            check('an admin lands on administration', await b.wait_path('/admin'))
            check('and sees the waiting doctor', await b.wait_text('Dr Newcomer'))
            await b.click('Approve')
            await asyncio.sleep(1.0)
            await b.goto('/admin')
            await b.wait_text('Administration')
            check('approved doctors leave the waiting list', 'Doctors waiting' in await b.text() and 'No one is waiting' in await b.text())
            await b.shot('admin')
            await b.sign_out()
            await b.sign_in(demail)
            check('the approved doctor can now sign in', await b.wait_path('/doctor'))

            check('no uncaught errors in the page', not b.errors, b.errors[:3])
    finally:
        proc.terminate()
    print(f'\n{len(fails)} failure(s)')


asyncio.run(main())
