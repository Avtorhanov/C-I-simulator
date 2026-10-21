# Playwright e2e стенда F2: профиль телефона, CPU×6
import sys, json, pathlib, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = (ROOT / 'units' / 'ctl-globe-diaph' / 'index.html').as_uri()
SHOTS = ROOT / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 1

def run_once(p, n, shots):
    res = {}
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True, locale='ru-RU')
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
    pg.goto(URL); pg.wait_for_timeout(1500)
    J = pg.evaluate
    def st(): return J('(() => { const s = __ci.sim.state; return {h:s.h, sp:s.sp, ne43:s.ne43, alarms:s.alarms, mode:s.mode, ir:s.initResult, pAct:s.pAct}; })()')
    def chip(id): return pg.inner_text('#' + id)
    def setI(v): J(f'__ci.setI({v})')

    for v, exp in [(4, 0), (12, 50), (20, 100)]:
        setI(v); pg.wait_for_timeout(3000)
        h = float(chip('vH').split()[0])
        res[f'{v}mA→{exp}%'] = abs(h - exp) <= 1.0, h
    setI(3.5); pg.wait_for_timeout(7000)
    s = st(); tags = pg.inner_text('#alarms')
    res['3.5mA закрыт+NE43'] = (s['h'] < 0.005 and 'NE43' in tags), (round(s['h'], 4), tags)
    setI(20); pg.wait_for_timeout(2500)
    pg.fill('#inSup', '0'); pg.dispatch_event('#inSup', 'input'); pg.wait_for_timeout(6000)
    s = st(); res['Pпит=0 → fail'] = s['h'] < 0.005, round(s['h'], 4)
    pg.fill('#inSup', '4.5'); pg.dispatch_event('#inSup', 'input')
    setI(12); pg.wait_for_timeout(2500)
    # init с ошибкой рычага
    pg.click('summary:has-text("Монтаж и петля")')
    pg.select_option('#selMark', '120')
    pg.click('#btnInit')
    pg.wait_for_function('__ci.sim.state.mode !== "init"', timeout=60000)
    txt = pg.inner_text('#initStatus'); lcd = J('document.getElementById("tLcd").textContent')
    res['init: ошибка рычага E2'] = ('E2' in txt and 'E2' in lcd), (lcd, txt[:60])
    pg.select_option('#selMark', '30')
    pg.click('#btnInit')
    pg.wait_for_function('__ci.sim.state.mode !== "init"', timeout=60000)
    s = st(); res['init: успех после исправления'] = bool(s['ir'] and s['ir']['ok']), s['ir'] and round(s['ir']['sweepDeg'], 1)
    pg.wait_for_timeout(2500)
    # синхронность разреза с моделью
    d = J('''(() => { const s = __ci.sim.state; const y = +document.getElementById('plate').getAttribute('y');
            const c = +document.getElementById('leverPin').getAttribute('cy'); return {h:s.h, y, c}; })()''')
    res['разрез = модель'] = (abs(d['y'] - (195 - 30 * d['h'])) < 0.6 and abs(d['c'] - (300 - 30 * d['h'])) < 0.6), d
    # FPS при CPU×6
    fps = J('''new Promise(r => { let n = 0; const t0 = performance.now(); function f(){ n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); } requestAnimationFrame(f); })''')
    res['FPS при CPU×6 ≥ 30'] = fps >= 30, round(fps, 1)
    # ширины
    for w in (360, 390, 412, 430):
        pg.set_viewport_size({'width': w, 'height': 780}); pg.wait_for_timeout(200)
        ov = J('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        res[f'нет гориз. прокрутки {w}px'] = ov <= 0, ov
    pg.set_viewport_size({'width': 360, 'height': 780})
    # узлы
    for node in ('pos', 'booster', 'sov', 'act', 'loop', 'supply', 'valve'):
        J(f'__ci.openNode("{node}")'); pg.wait_for_timeout(150)
    res['узлы открываются без ошибок'] = len(errs) == 0, errs[:3]
    if shots:
        J('__ci.setI(13.2)'); pg.click('#tgBoost'); pg.wait_for_timeout(1500)
        J('__ci.openNode("booster")')
        for skin in ('light', 'dark', 'navy', 'contrast'):
            J(f'__ci.setSkin("{skin}")'); J('window.scrollTo(0,0)'); pg.wait_for_timeout(400)
            pg.screenshot(path=str(SHOTS / f'ctl-{skin}-top.png'))
            J('document.getElementById("detail").scrollIntoView()'); pg.wait_for_timeout(300)
            pg.screenshot(path=str(SHOTS / f'ctl-{skin}-detail.png'))
        J('__ci.setSkin("light")'); J('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(400)
        pg.screenshot(path=str(SHOTS / 'ctl-light-bottom.png'))
    res['консоль чистая'] = len(errs) == 0, errs[:3]
    b.close()
    return res

with sync_playwright() as p:
    passed = 0
    for n in range(RUNS):
        r = run_once(p, n, shots=(n == 0))
        ok = all(v[0] for v in r.values())
        passed += ok
        print(f'--- прогон {n+1}: {"OK" if ok else "FAIL"}')
        for k, v in r.items():
            print(('  ✓ ' if v[0] else '  ✗ ') + k, v[1])
    print(f'ИТОГ {passed}/{RUNS}')
