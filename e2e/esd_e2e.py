# Playwright e2e сцены «Отсечной» v0.3: телефон, CPU×6
import sys, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = (ROOT / 'units' / 'esd-ball-rp' / 'index.html').as_uri()
SHOTS = ROOT / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 1
NODES = ['fr', 'pos', 'sovR', 'sovP', 'booster', 'act', 'valve', 'bkv']

def run_once(p, shots):
    res = {}
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True, locale='ru-RU')
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': 6})
    pg.goto(URL); pg.wait_for_timeout(1200)
    J = pg.evaluate
    st = lambda: J('(() => { const s = __ci.sim.state; return {deg:s.deg, dc:s.diClosed, do:s.diOpen, al:s.alarms, pst:s.pstResult, lt:s.lastStroke}; })()')
    res['исходно закрыт, ЗАКР'] = (st()['dc'] and st()['deg'] == 0), st()['deg']
    pg.click('#bOpen'); pg.wait_for_timeout(6000)
    s = st(); res['ОТКРЫТЬ → 90°, ОТКР'] = (s['do'] and s['deg'] == 90), (s['deg'], s['lt'])
    pg.click('#bPst'); pg.wait_for_timeout(6000)
    s = st(); res['PST пройден'] = bool(s['pst'] and s['pst']['ok']), s['pst'] and s['pst']['ok']
    pg.click('#bPaz'); pg.wait_for_timeout(7000)
    s = st(); res['ПАЗ → закрыт'] = (s['dc'] and s['deg'] == 0), s['deg']
    pg.click('#bPaz'); pg.wait_for_timeout(300)
    box = pg.locator('[data-node="booster"]').bounding_box()
    pg.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.wait_for_timeout(600)
    res['тап по бустеру → разрез + карточка'] = (J('__ci.view') == 'detail' and 'Бустер' in pg.inner_text('#dTitle') and pg.is_visible('#card')), pg.inner_text('#dTitle')
    pg.click('#dPlay'); pg.wait_for_timeout(1500)
    playing = J('__ci.DV.playing'); cap = pg.inner_text('#dcap')
    res['▶ Импульс идёт, фаза подписана'] = (playing and cap.startswith('▶')), cap[:50]
    pg.click('#dBack'); pg.wait_for_timeout(300)
    res['назад к схеме'] = J('__ci.view') == 'scheme', J('__ci.view')
    for n in NODES:
        J(f'__ci.openCard("{n}")'); pg.wait_for_timeout(250)
        J('__ci.DV.play(0,1)'); pg.wait_for_timeout(700)
    res['все разрезы открываются и играют без ошибок'] = len(errs) == 0, errs[:2]
    J('__ci.showScheme()')
    J('__ci.startSeq(0)'); pg.wait_for_timeout(800)
    res['шаг 1 «Открытие»: разрез ФР + демо'] = (J('__ci.view') == 'detail' and J('__ci.DV.playing')), pg.inner_text('#dTitle')
    for _ in range(14):
        if pg.is_hidden('#cap'): break
        J('__ci.next()'); pg.wait_for_timeout(1100)
    s = st(); res['шаги прошли, кран открыт, вернулись к схеме'] = (s['do'] and pg.is_hidden('#cap') and J('__ci.view') == 'scheme'), s['deg']
    pg.click('#vScheme [data-fs]'); pg.wait_for_timeout(500)
    bb = pg.locator('#stage').bounding_box(); dock = pg.locator('.dock').bounding_box()
    res['⛶ схема на весь экран, панель внизу'] = (J('document.body.classList.contains("fs")') and bb['y'] <= 1 and abs(bb['y'] + bb['height'] - dock['y']) < 3 and dock['y'] + dock['height'] <= 781), (round(bb['height']), round(dock['y']))
    if shots:
        pg.screenshot(path=str(SHOTS / 'v3-fs.png'))
        J('__ci.openCard("act")'); J('__ci.DV.play(0.25,0.5)'); pg.wait_for_timeout(1500); pg.screenshot(path=str(SHOTS / 'v3-fs-act.png'))
        J('__ci.showScheme()')
    pg.click('#vScheme [data-fs]') if J('__ci.view') == 'scheme' else pg.click('#vDetail [data-fs]'); pg.wait_for_timeout(300)
    res['выход из полноэкранного'] = not J('document.body.classList.contains("fs")'), True
    pg.click('summary:has-text("Неисправность")'); pg.select_option('#selFault', 'sovPStuck'); pg.wait_for_timeout(500)
    res['неисправность: признаки/причины/поиск/устранение + место на схеме'] = (pg.is_visible('#fInfo') and J('document.querySelectorAll("#sc .flt").length') == 1 and J('document.querySelectorAll("#fCause li").length') >= 2), J('document.querySelectorAll("#sc .flt").length')
    pg.click('#bPaz'); pg.wait_for_timeout(5000)
    res['SOV-ПАЗ залип → кран открыт'] = st()['deg'] == 90, st()['deg']
    pg.click('#bPaz')
    fps = J('''new Promise(r => { let n = 0; const t0 = performance.now(); function f(){ n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); } requestAnimationFrame(f); })''')
    res['FPS схема при CPU×6 ≥ 30'] = fps >= 30, round(fps, 1)
    J('__ci.openCard("valve")'); pg.wait_for_timeout(300)
    fps = J('''new Promise(r => { let n = 0; const t0 = performance.now(); function f(){ n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); } requestAnimationFrame(f); })''')
    res['FPS разрез при CPU×6 ≥ 30'] = fps >= 30, round(fps, 1)
    for w in (360, 390, 412, 430):
        pg.set_viewport_size({'width': w, 'height': 780}); pg.wait_for_timeout(200)
        ov = J('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        res[f'нет гориз. прокрутки {w}px'] = ov <= 0, ov
    pg.set_viewport_size({'width': 360, 'height': 780})
    if shots:
        J('__ci.setFault("")'); J('__ci.sim.paz(false)'); J('__ci.sim.cmd(true)')
        for n in NODES:
            J(f'__ci.openCard("{n}")'); J('__ci.DV.play(0.3,0.5)'); J('document.getElementById("stage").scrollIntoView()'); pg.wait_for_timeout(1400)
            pg.locator('#stage').screenshot(path=str(SHOTS / f'v3-d-{n}.png'))
        J('__ci.showScheme()'); J('__ci.sim.cmd(false)'); pg.wait_for_timeout(1800)
        pg.locator('#stage').screenshot(path=str(SHOTS / 'v3-scheme-mid.png'))
        J('__ci.setSkin("dark")'); J('__ci.openCard("valve")'); J('__ci.DV.play(0.2,0.5)'); pg.wait_for_timeout(1300)
        pg.locator('#stage').screenshot(path=str(SHOTS / 'v3-d-valve-dark.png'))
        J('__ci.setSkin("light")')
    res['консоль чистая'] = len(errs) == 0, errs[:3]
    b.close(); return res

with sync_playwright() as p:
    ok_n = 0
    for n in range(RUNS):
        r = run_once(p, n == 0); ok = all(v[0] for v in r.values()); ok_n += ok
        print(f'--- прогон {n+1}: {"OK" if ok else "FAIL"}')
        for k, v in r.items(): print(('  ✓ ' if v[0] else '  ✗ ') + k, v[1])
    print(f'ИТОГ {ok_n}/{RUNS}')
