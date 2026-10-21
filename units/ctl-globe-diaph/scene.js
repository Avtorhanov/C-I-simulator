/* C&I Simulator — стенд F2 (UI). Вся физика — в sim-core (CISim). */
(function () {
  'use strict';
  const C = window.CISim;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;

  // ---------- состояние UI ----------
  const UI0 = {
    iSet: 12, pSup: 4.5, unit: 'bar',
    boost: false, bypass: 0.4, sov: false, sovE: true,
    dir: 'inc', char: 'lin', sr: '4-20', pAct: 'ATO',
    act: 'ATO', mark: 30, barrier: false, rWire: 50,
    fault: '', labels: true, speed: 1, paused: false
  };
  let ui = JSON.parse(JSON.stringify(UI0));
  let sim = null;
  let selNode = null;

  const FAULT_RU = {
    noAir: ['Нет воздуха питания', 'Позиционер запитан от петли, но реле нечем наполнять привод: клапан уходит в положение безопасности.'],
    lowSupply: ['Низкое давление питания (0.8 бар)', 'Питание ниже конца bench set (1.0 бар): клапан не доходит до верхних положений, растёт отклонение.'],
    diaphragmRupture: ['Разрыв мембраны', 'Воздух уходит через дыхательное отверстие крышки, давление в камере не растёт.'],
    signalLeak: ['Утечка в импульсной линии', 'Позиционер всё время подкачивает воздух, чтобы удержать ход. Ход держится с небольшим отклонением.'],
    packingTight: ['Перетянут сальник', 'Трение покоя велико: шток трогается рывком. Меняйте ток плавно и смотрите тренд.'],
    wrongLeverMark: ['Палец рычага не на той метке', 'Измеренный ход не совпадает с фактическим. Запустите AUTO-инициализацию: она покажет ошибку угла.'],
    feedbackBacklash: ['Люфт обратной связи', 'Позиционер видит ход с запаздыванием: появляется ошибка и гистерезис.'],
    polarity: ['Перепутана полярность мА', 'Тока нет (защитный диод), позиционер обесточен, клапан в положении безопасности.'],
    loopBreak: ['Обрыв петли', 'Ток 0 мА, NE43 «низ», клапан в положении безопасности.'],
    lowVoltage: ['Мало U на позиционере (линия 900 Ом)', 'На больших токах AO не хватает напряжения: ток не растёт, клапан не доходит.'],
    springBroken: ['Сломана пружина', 'Нет возвратного усилия: при сбросе воздуха клапан не уходит в положение безопасности.'],
    actuatorFlipped: ['Привод собран наоборот (НО вместо НЗ)', 'Рост тока закрывает клапан, при потере воздуха он открывается. Fail-safe не тот.'],
    boosterBypassClosed: ['Байпас бустера закрыт', 'Бустер срабатывает на каждый шаг: перерегулирование и рысканье хода.'],
    sovStuck: ['SOV не срабатывает', 'Снимите напряжение с SOV: клапан остаётся в рабочем положении.']
  };
  const ALARM_RU = {
    NE43_LO: ['al', 'NE43: ток < 3.6 мА'], NE43_HI: ['al', 'NE43: ток > 21 мА'],
    LOOP_BREAK: ['al', 'Обрыв петли'], NO_POWER: ['al', 'Позиционер обесточен'],
    LOW_U: ['al', 'Мало U: AO не выдаёт ток'], LOW_SUPPLY: ['al', 'Низкое P питания'],
    NOT_CAL: ['wn', 'Нет калибровки'],
    INIT_NO_MOVE: ['al', 'Init: нет хода'], INIT_ANGLE_SMALL: ['al', 'Init: малый угол рычага'],
    INIT_ANGLE_RANGE: ['al', 'Init: угол вне диапазона'], INIT_NO_POWER: ['al', 'Init: нет питания']
  };
  const LCD_ERR = { NO_MOVE: 'E1 MOVE', ANGLE_SMALL: 'E2 ANG<', ANGLE_RANGE: 'E3 ANG>', NO_POWER: 'E0 PWR' };

  // ---------- хранилище (по желанию) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cis.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cis.' + k, JSON.stringify(v)); } catch (e) { /* нет хранилища */ } }
  };

  // ---------- конфигурация из UI ----------
  function cfgFromUI() {
    const sr = ui.sr.split('-').map(Number);
    const cfg = {
      supply: { p: ui.pSup },
      loop: { barrier: ui.barrier, rWire: ui.rWire, broken: false, polarity: false },
      posit: { dir: ui.dir, char: ui.char, srLo: sr[0], srHi: sr[1], act: ui.pAct },
      lever: { markMm: ui.mark, backlash: 0 },
      booster: { present: ui.boost, bypass: ui.bypass },
      sov: { present: ui.sov, energized: ui.sovE, stuck: false },
      act: { type: ui.act, leakK: 0, fs: C.DEFAULTS.act.fs, fd: C.DEFAULTS.act.fd, springBroken: false }
    };
    if (ui.fault && C.FAULTS[ui.fault]) deepMerge(cfg, JSON.parse(JSON.stringify(C.FAULTS[ui.fault])));
    return cfg;
  }
  function deepMerge(d, s) {
    for (const k of Object.keys(s)) {
      if (s[k] && typeof s[k] === 'object' && d[k] && typeof d[k] === 'object') deepMerge(d[k], s[k]);
      else d[k] = s[k];
    }
    return d;
  }
  function applyCfg() { sim.set(cfgFromUI()); buildTubes(); }

  function newSim() {
    sim = C.createSim(cfgFromUI());
    sim.setCurrent(ui.iSet);
    sim.run(6);
    trendBuf.length = 0; trendT = 0;
    buildTubes();
  }

  // ---------- трубки ----------
  const tubesG = $('tubes');
  let tubes = {};
  let topoKey = '';
  function routes(c) {
    const yp = c.act.type === 'ATO' ? 200 : 140;
    const b = c.booster.present, s = c.sov.present;
    const r = { supIn: 'M0,349 H14', supPos: 'M54,349 H120 V318' };
    if (b) {
      r.supBoost = 'M34,336 V330 H6 V212 H18';
      r.sig = 'M160,252 V238 H52 V226';
      r.bout = s ? 'M52,178 V158' : `M52,178 V170 H120 V${yp} H153`;
    } else {
      r.sig = s ? 'M160,252 V238 H52 V158' : `M160,252 V238 H120 V${yp} H153`;
    }
    if (s) r.sovout = `M82,134 H120 V${yp} H153`;
    return r;
  }
  function buildTubes() {
    const c = sim.cfg;
    const key = [c.act.type, c.booster.present, c.sov.present].join('|');
    if (key === topoKey) return;
    topoKey = key;
    tubesG.textContent = '';
    tubes = {};
    const r = routes(c);
    for (const id of Object.keys(r)) {
      const g = document.createElementNS(SVGNS, 'g');
      const base = mk('path', { d: r[id], class: 'tube' });
      const pr = mk('path', { d: r[id], class: 'tube-p', opacity: 0 });
      const fl = mk('path', { d: r[id], class: 'tube-f', opacity: 0 });
      g.append(base, pr, fl);
      tubesG.append(g);
      tubes[id] = { pr, fl, off: 0 };
    }
  }
  function mk(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  const pOp = (p) => Math.sqrt(Math.max(0, Math.min(1, p / 6)));
  const flowSpeed = (q) => (Math.abs(q) < 0.004 ? 0 : Math.sign(q) * (14 + 26 * Math.sqrt(Math.abs(q))));

  function setTube(id, p, q, dt) {
    const t = tubes[id];
    if (!t) return;
    t.pr.setAttribute('opacity', (0.08 + 0.92 * pOp(p)).toFixed(3));
    const v = flowSpeed(q);
    t.off -= v * dt;
    t.fl.setAttribute('stroke-dashoffset', t.off.toFixed(1));
    t.fl.setAttribute('opacity', v ? '0.95' : '0');
  }
  const anim = { wire: 0, flow: 0, puffP: 0, puffB: 0, puffS: 0, puffA: 0 };
  function puff(id, mag, dt) {
    const el = $(id);
    const m = Math.min(1, Math.abs(mag));
    anim[id] -= (m > 0.01 ? 10 + 30 * m : 0) * dt;
    el.setAttribute('stroke-dashoffset', anim[id].toFixed(1));
    el.setAttribute('opacity', m > 0.01 ? (0.4 + 0.6 * m).toFixed(2) : '0');
  }

  // ---------- отрисовка разреза ----------
  function springPts(x, y1, y2, w, n) {
    const pts = [];
    const step = (y2 - y1) / (n * 2);
    pts.push(x + ',' + y1.toFixed(1));
    for (let k = 1; k < n * 2; k++) pts.push((x + (k % 2 ? w : -w) / 2).toFixed(1) + ',' + (y1 + k * step).toFixed(1));
    pts.push(x + ',' + y2.toFixed(1));
    return pts.join(' ');
  }
  function fmtP(p) { return C.fmtP(p, ui.unit); }

  let devT = 0;
  function render(o, dt) {
    const c = sim.cfg;
    const h = o.h;
    const ato = c.act.type === 'ATO';
    const plateY = 195 - 30 * h;
    // привод
    $('plate').setAttribute('y', plateY.toFixed(2));
    const air = $('airCh');
    if (ato) { air.setAttribute('y', (plateY + 3).toFixed(2)); air.setAttribute('height', (236 - plateY - 3).toFixed(2)); }
    else { air.setAttribute('y', '118'); air.setAttribute('height', Math.max(0, plateY + 3 - 118).toFixed(2)); }
    air.setAttribute('opacity', (0.1 + 0.75 * pOp(o.pAct)).toFixed(3));
    const yd = plateY + 3;
    $('diaL').setAttribute('d', `M150,170 Q158,${yd.toFixed(1)} 168,${yd.toFixed(1)}`);
    $('diaR').setAttribute('d', `M310,170 Q302,${yd.toFixed(1)} 292,${yd.toFixed(1)}`);
    const brokenSpring = c.act.springBroken;
    const sp1 = $('spring1'), sp2 = $('spring2');
    if (ato) {
      sp1.setAttribute('points', springPts(200, 126, plateY, 16, brokenSpring ? 3 : 6));
      sp2.setAttribute('points', springPts(260, 126, plateY, 16, 6));
    } else {
      sp1.setAttribute('points', springPts(200, plateY + 6, 232, 16, brokenSpring ? 3 : 6));
      sp2.setAttribute('points', springPts(260, plateY + 6, 232, 16, 6));
    }
    $('tSpringLbl').setAttribute('y', ato ? 140 : 226);
    $('tAirLbl').setAttribute('y', ato ? 226 : 140);
    $('tCaption').textContent = ato ? 'Привод мембранный · НЗ (ВО)' : 'Привод мембранный · НО (ВЗ)';
    // шток, плунжер, рычаг
    const plugB = 404 - 30 * h;
    $('plug').setAttribute('transform', `translate(0,${(plugB - 14).toFixed(2)})`);
    const stem = $('stem');
    stem.setAttribute('y1', (plateY + 6).toFixed(2));
    stem.setAttribute('y2', (plugB - 14).toFixed(2));
    const clampY = 300 - 30 * h;
    $('clamp').setAttribute('transform', `translate(0,${clampY.toFixed(2)})`);
    $('lever').setAttribute('y2', clampY.toFixed(2));
    $('leverPin').setAttribute('cy', clampY.toFixed(2));
    // поток среды
    anim.flow -= (o.flowRel > 0 ? 12 + 70 * o.flowRel : 0) * dt;
    for (const id of ['flowL', 'flowIn', 'flowR']) {
      const el = $(id);
      el.setAttribute('stroke-dashoffset', anim.flow.toFixed(1));
      el.setAttribute('opacity', o.flowRel > 0 ? (0.35 + 0.65 * o.flowRel).toFixed(2) : '0');
    }
    $('tFlow').textContent = 'Q ' + Math.round(o.flowRel * 100) + ' %';
    // петля
    $('tAO').textContent = o.i.toFixed(2);
    anim.wire -= (o.i > 0.05 ? 8 + o.i * 3 : 0) * dt;
    for (const id of ['wPf', 'wNf']) {
      const el = $(id);
      el.setAttribute('stroke-dashoffset', anim.wire.toFixed(1));
      el.setAttribute('opacity', o.i > 0.05 ? '1' : '0');
    }
    $('gBarrier').setAttribute('display', c.loop.barrier ? 'inline' : 'none');
    // воздух
    const b = c.booster.present, s = c.sov.present;
    $('gBooster').setAttribute('display', b ? 'inline' : 'none');
    $('gSov').setAttribute('display', s ? 'inline' : 'none');
    setTube('supIn', o.pSup, Math.max(0, o.qRelay) + Math.max(0, o.qBoost), dt);
    setTube('supPos', o.pSup, Math.max(0, o.qRelay), dt);
    setTube('supBoost', o.pSup, Math.max(0, o.qBoost), dt);
    const pSigLine = b ? o.pSig : (s ? o.pUp : o.pAct);
    setTube('sig', pSigLine, o.qRelay, dt);
    const downQ = b ? (o.sovVent ? 0 : o.qBoost + o.qBypass) : o.qRelay;
    setTube('bout', s ? o.pUp : o.pAct, b && !o.sovVent ? o.qBoost + o.qBypass : 0, dt);
    setTube('sovout', o.pAct, o.sovVent ? o.qSov : downQ, dt);
    puff('puffP', o.qRelay < 0 ? -o.qRelay / 1.5 : 0, dt);
    puff('puffB', b && o.qBoost < 0 ? -o.qBoost / 4 : 0, dt);
    puff('puffS', s && o.sovVent ? -o.qSov / 4 : 0, dt);
    puff('puffA', Math.max(Math.abs(o.v) * 0.6, o.qLeak < 0 ? -o.qLeak / 2 : 0), dt);
    if (b) {
      $('bSigFill').setAttribute('opacity', (0.1 + 0.8 * pOp(o.pSig)).toFixed(3));
      $('bOutFill').setAttribute('opacity', (0.1 + 0.8 * pOp(o.pAct)).toFixed(3));
      const dpb = o.pSig - o.pAct;
      const dy = Math.max(-2.5, Math.min(2.5, dpb * 15));
      $('bDia').setAttribute('transform', `translate(0,${dy.toFixed(2)})`);
      const n = $('bNeedle');
      const ang = (c.booster.bypass * 270 - 135) * Math.PI / 180;
      n.setAttribute('x2', (76 + 3 * Math.cos(ang)).toFixed(2));
      n.setAttribute('y2', (221 + 3 * Math.sin(ang)).toFixed(2));
    }
    if (s) {
      $('sovCoil').setAttribute('stroke', c.sov.energized ? 'var(--wire)' : 'var(--steel)');
      $('tSov').textContent = o.sovVent ? 'A→R сброс' : (!c.sov.energized && c.sov.stuck ? 'P→A залип' : 'P→A');
    }
    // манометр ФР
    const ga = (-135 + Math.min(1, o.pSup / 7) * 270) * Math.PI / 180;
    $('gaugeSup').setAttribute('x2', (44 + 5 * Math.sin(ga)).toFixed(2));
    $('gaugeSup').setAttribute('y2', (349 - 5 * Math.cos(ga)).toFixed(2));
    // позиционер: I/P индикатор и ЖКИ
    const ia = Math.max(-1, Math.min(1, o.u)) * 70 * Math.PI / 180;
    $('posIP').setAttribute('x2', (173 + 4 * Math.sin(ia)).toFixed(2));
    $('posIP').setAttribute('y2', (296 - 4 * Math.cos(ia)).toFixed(2));
    $('tLcd').textContent = lcdText(o);

    // показания
    $('vI').textContent = o.i.toFixed(2) + ' мА';
    $('chI').classList.toggle('bad', o.ne43 === 'fail_lo' || o.ne43 === 'fail_hi');
    $('vSp').textContent = o.powered ? (o.sp * 100).toFixed(1) + ' %' : '—';
    $('vH').textContent = (h * 100).toFixed(1) + ' %';
    $('vU').textContent = o.uAvail.toFixed(1) + ' В';
    $('chU').classList.toggle('bad', o.lowU || (!o.powered && o.i > 0));
    $('vP').textContent = fmtP(o.pAct);
    $('vS').textContent = fmtP(o.pSup);
    $('chS').classList.toggle('bad', o.pSup < 1.4);
    $('vIdock').firstChild.nodeValue = ui.iSet.toFixed(2);

    // отклонение хода
    if (o.mode === 'auto' && o.powered && Math.abs(o.sp - h) > 0.05 && !o.cut) devT += dt; else devT = 0;
    renderAlarms(o);
    if (selNode) updateDetail(o);
    initStatus(o);
  }

  function lcdText(o) {
    if (!o.powered) return '';
    if (o.mode === 'init' && o.init) return 'INIT ' + ({ down0: '1/3 ▼', up: '2/3 ▲', down: '3/3 ▼' }[o.init.phase] || '');
    if (o.mode === 'nocal') return o.initResult && o.initResult.error ? (LCD_ERR[o.initResult.error] || 'ERR') : 'NO CAL';
    if (o.mode === 'man') return 'MAN ' + (o.hm * 100).toFixed(1);
    return 'AUTO ' + (Math.max(-9.9, o.hm * 100)).toFixed(1);
  }

  let lastAlarmKey = '';
  function renderAlarms(o) {
    const tags = [];
    for (const a of o.alarms) if (ALARM_RU[a]) tags.push(ALARM_RU[a]);
    if (o.ne43 === 'sat_lo' || o.ne43 === 'sat_hi') tags.push(['wn', 'NE43: зона насыщения']);
    if (o.sovVent) tags.push(['wn', 'SOV обесточен: сброс']);
    if (devT > 5) tags.push(['al', 'Отклонение хода > 5 %']);
    if (o.mode === 'init') tags.push(['wn', 'Идёт инициализация']);
    if (!tags.length) tags.push(['okk', 'Норма']);
    const key = tags.map((t) => t.join(':')).join('|');
    if (key === lastAlarmKey) return;
    lastAlarmKey = key;
    $('alarms').innerHTML = tags.map((t) => `<span class="tag ${t[0]}">${t[1]}</span>`).join('');
  }

  let lastInitKey = '';
  function initStatus(o) {
    const el = $('initStatus');
    let cls = '', txt;
    if (o.mode === 'init' && o.init) {
      txt = { down0: 'Шаг 1/3: сброс воздуха, поиск нижнего упора…', up: 'Шаг 2/3: наполнение, поиск верхнего упора и времени хода…', down: 'Шаг 3/3: сброс, время хода на закрытие…' }[o.init.phase];
    } else if (o.initResult) {
      const r = o.initResult;
      if (r.ok) {
        cls = 'ok';
        txt = `Готово. Угол рычага за ход ${r.sweepDeg.toFixed(1)}°. Время хода: наполнение ${r.tUp.toFixed(1)} с, сброс ${r.tDown.toFixed(1)} с.`;
      } else {
        cls = 'err';
        const lv = sim.cfg.lever;
        txt = {
          ANGLE_SMALL: `Ошибка E2: угол рычага за ход ${r.sweepDeg !== null ? r.sweepDeg.toFixed(1) : '—'}° меньше ${lv.minSweepDeg}°. Палец стоит на метке большего хода. Переставьте палец на метку хода клапана (${sim.cfg.act.strokeMm} мм) и повторите.`,
          ANGLE_RANGE: `Ошибка E3: рычаг выходит за рабочий диапазон датчика ±${lv.sensorMaxDeg}°. Палец на метке меньшего хода или рычаг не горизонтален при 50 % хода.`,
          NO_MOVE: 'Ошибка E1: шток не сдвинулся. Проверьте воздух питания, трубку к приводу и SOV.',
          NO_POWER: 'Ошибка E0: позиционер не запитан. Ток петли ниже 3.6 мА или не хватает напряжения.'
        }[r.error] || ('Ошибка ' + r.error);
      }
    } else {
      txt = 'Калибровка выполнена (исходная). После перестановки пальца рычага или замены привода повторите инициализацию.';
    }
    const key = cls + txt;
    if (key === lastInitKey) return;
    lastInitKey = key;
    el.className = 'status' + (cls ? ' ' + cls : '');
    el.textContent = txt;
    $('btnInit').disabled = o.mode === 'init';
  }

  // ---------- деталь узла ----------
  const SEL_BOX = {
    loop: [4, 4, 108, 110], sov: [18, 114, 68, 48], booster: [14, 174, 76, 56], supply: [4, 330, 56, 48],
    pos: [100, 248, 90, 74], act: [146, 114, 168, 126], valve: [176, 340, 110, 100]
  };
  const NODES = {
    pos: {
      title: 'Позиционер: что внутри',
      svg: `
        <rect x="6" y="14" width="88" height="70" rx="6" class="dev"/>
        <text class="lbl-strong" x="12" y="28">Микропроцессор</text>
        <text class="lbl mono" x="12" y="44" id="dW">w</text>
        <text class="lbl mono" x="12" y="57" id="dX">x</text>
        <text class="lbl mono" x="12" y="70" id="dE">e</text>
        <text class="lbl" x="8" y="100">4–20 мА: питание</text>
        <text class="lbl" x="8" y="110">и уставка</text>
        <line x1="94" y1="49" x2="112" y2="49" stroke="var(--wire)" stroke-width="1.6"/>
        <rect x="112" y="30" width="22" height="38" rx="3" fill="none" stroke="var(--wire)" stroke-width="1.6"/>
        <text class="lbl" x="110" y="24">I/P</text>
        <line id="dFlap" x1="146" y1="28" x2="146" y2="72" stroke="var(--ink)" stroke-width="2"/>
        <path d="M160,46 h8 v6 h-8 l-4,-3 Z" fill="var(--steel)"/>
        <text class="lbl" x="140" y="84">заслонка–сопло</text>
        <rect x="196" y="14" width="114" height="94" rx="6" class="dev"/>
        <text class="lbl-strong" x="202" y="28">Пневмореле</text>
        <text class="lbl" x="200" y="124">ПИТ</text>
        <text class="lbl" x="284" y="124">СБРОС</text>
        <text class="lbl" x="296" y="56">ВЫХ</text>
        <line x1="168" y1="49" x2="196" y2="49" stroke="var(--air)" stroke-width="2"/>
        <rect id="dSup" x="212" y="70" width="26" height="10" fill="var(--air)"/>
        <rect id="dExh" x="268" y="70" width="26" height="10" fill="var(--steel)"/>
        <line x1="225" y1="80" x2="225" y2="114" stroke="var(--tube)" stroke-width="4"/>
        <line x1="281" y1="80" x2="281" y2="114" stroke="var(--tube)" stroke-width="4"/>
        <line x1="225" y1="54" x2="310" y2="54" stroke="var(--tube)" stroke-width="4"/>
        <path id="dSupF" class="tube-f" d="M225,114 V70 H262 V54 H310" stroke="var(--air)"/>
        <path id="dExhF" class="tube-f" d="M310,54 H262 V70 H281 V114" stroke="var(--air)"/>
        <circle cx="50" cy="140" r="16" fill="var(--panel)" stroke="var(--metal-ink)"/>
        <line id="dPot" x1="50" y1="140" x2="50" y2="126" stroke="var(--alarm)" stroke-width="2"/>
        <text class="lbl" x="72" y="138">датчик ОС (угол рычага)</text>
        <text class="lbl mono" x="72" y="150" id="dTh">θ</text>
        <line x1="50" y1="124" x2="50" y2="86" stroke="var(--metal-ink)" stroke-dasharray="2 2"/>`,
      text: 'Микропроцессор сравнивает уставку w (из тока 4–20 мА) с фактическим ходом x от датчика угла рычага. По ошибке e преобразователь I/P смещает заслонку у сопла, и пневмореле либо открывает подачу воздуха питания в привод, либо сбрасывает воздух из привода в атмосферу. В зоне нечувствительности оба клапана реле закрыты, давление в приводе держится.',
      note: 'Без тока петли или без воздуха питания реле уходит на сброс: привод отрабатывает пружиной в положение безопасности. Внутренняя схема обобщённая, у конкретных моделей отличается.'
    },
    booster: {
      title: 'Объёмный бустер',
      svg: `
        <rect x="96" y="8" width="128" height="150" rx="8" class="dev"/>
        <rect id="dbSig" x="106" y="18" width="108" height="30" rx="3" fill="var(--air)"/>
        <line id="dbDia" x1="104" y1="54" x2="216" y2="54" stroke="var(--ink)" stroke-width="3"/>
        <rect id="dbOut" x="106" y="60" width="108" height="38" rx="3" fill="var(--air)"/>
        <rect id="dbSup" x="106" y="112" width="108" height="36" rx="3" fill="var(--air)"/>
        <rect x="104" y="102" width="112" height="6" fill="var(--steel)"/>
        <rect id="dbPop" x="150" y="100" width="20" height="10" rx="2" fill="var(--metal-ink)"/>
        <line x1="160" y1="54" x2="160" y2="100" stroke="var(--metal-ink)" stroke-width="3"/>
        <text class="lbl-strong" x="112" y="36">сигнал</text>
        <text class="lbl-strong" x="112" y="82">выход</text>
        <text class="lbl-strong" x="112" y="134">питание</text>
        <line x1="20" y1="33" x2="106" y2="33" class="tube"/>
        <text class="lbl" x="6" y="26">от позиционера</text>
        <line x1="214" y1="79" x2="304" y2="79" class="tube"/>
        <text class="lbl" x="248" y="72">к приводу</text>
        <line x1="20" y1="130" x2="106" y2="130" class="tube"/>
        <text class="lbl" x="6" y="124">питание</text>
        <line x1="214" y1="22" x2="304" y2="22" class="tube"/>
        <text class="lbl" x="250" y="16">сброс</text>
        <path d="M100,40 V72" stroke="var(--tube)" stroke-width="4" fill="none"/>
        <circle id="dbNeedle" cx="100" cy="56" r="4" fill="var(--metal-ink)"/>
        <text class="lbl" x="34" y="62">байпас</text>
        <path id="dbF" class="tube-f" d="M304,79 H214" stroke="var(--air)"/>
        <path id="dbSupF" class="tube-f" d="M20,130 H160 V79 H304" stroke="var(--air)"/>
        <path id="dbExhF" class="tube-f" d="M214,79 H160 V22 H304" stroke="var(--air)"/>`,
      text: 'Бустер повторяет давление сигнала от позиционера, но с большим расходом из своей линии питания. Если сигнал выше выхода больше порога, открывается клапан питания; если ниже, воздух уходит через сброс. Малые изменения идут через байпасную иглу без срабатывания бустера.',
      note: 'Игла закрыта: бустер срабатывает на каждый шаг, клапан перерегулирует и рыщет. Игла открыта сильно: на малых шагах бустер не включается, ход медленнее. Порядок настройки иглы на объекте сверить с РЭ бустера.'
    },
    sov: {
      title: 'Соленоид 3/2 (SOV)',
      svg: `
        <rect x="110" y="40" width="100" height="90" rx="6" class="dev"/>
        <rect x="128" y="8" width="64" height="30" rx="4" fill="none" stroke="var(--wire)" stroke-width="2" id="dsCoil"/>
        <text class="lbl-strong" x="140" y="27">катушка</text>
        <rect id="dsPl" x="152" y="40" width="16" height="44" fill="var(--steel)" stroke="var(--metal-ink)"/>
        <line x1="160" y1="130" x2="160" y2="160" class="tube"/><text class="lbl" x="168" y="156">P (вход)</text>
        <line x1="210" y1="96" x2="300" y2="96" class="tube"/><text class="lbl" x="260" y="90">A (к приводу)</text>
        <line x1="110" y1="60" x2="30" y2="60" class="tube"/><text class="lbl" x="30" y="52">R (сброс)</text>
        <path id="dsPA" class="tube-f" d="M160,160 V96 H300" stroke="var(--air)"/>
        <path id="dsAR" class="tube-f" d="M300,96 H160 V60 H30" stroke="var(--air)"/>`,
      text: 'Под напряжением катушка держит якорь, и воздух идёт со входа P на привод A. Обесточен: вход P перекрыт, привод A сообщается со сбросом R. Клапан уходит в положение безопасности независимо от позиционера.',
      note: 'По вашим данным SOV стоят на отсечных клапанах, частичный ход (PST) делается через них. Здесь SOV можно добавить в цепочку для наглядности.'
    },
    act: {
      title: 'Мембранный привод: баланс сил',
      svg: `
        <line x1="40" y1="140" x2="300" y2="140" stroke="var(--line)"/>
        <line x1="40" y1="20" x2="40" y2="140" stroke="var(--line)"/>
        <text class="lbl" x="250" y="156">P, бар →</text>
        <text class="lbl" x="4" y="16">ход ↑</text>
        <g id="daTicks"></g>
        <path id="daBand" fill="var(--air)" opacity=".12"/>
        <line id="daBench" stroke="var(--ink)" stroke-width="1.6"/>
        <circle id="daPt" r="5" fill="var(--alarm)"/>
        <text class="lbl" x="48" y="30" id="daTxt">bench set</text>`,
      text: 'Воздух под мембраной создаёт усилие P·A против пружины. Шток трогается при давлении начала настройки пружины (bench set) и проходит полный ход к её концу. Линия на графике — равновесие пружины, полоса вокруг — трение: внутри неё шток стоит.',
      note: 'Перетянутый сальник расширяет полосу трения: шток стоит, пока давление не выйдет за неё, и затем прыгает. Это видно на сигнатуре ход–давление (этап F4).'
    },
    loop: {
      title: 'Петля 4–20 мА: бюджет напряжения',
      svg: `
        <rect x="10" y="40" width="300" height="26" fill="none" stroke="var(--line)"/>
        <rect id="dlLine" x="10" y="40" height="26" fill="var(--wire)" opacity=".75"/>
        <rect id="dlBar" y="40" height="26" fill="var(--warn)" opacity=".75"/>
        <rect id="dlPos" y="40" height="26" fill="var(--air)" opacity=".75"/>
        <text class="lbl" x="10" y="30">0 В</text><text class="lbl" x="286" y="30" id="dlMax">24 В</text>
        <text class="lbl" x="10" y="84">■ линия</text><text class="lbl" x="70" y="84">■ барьер Ex i</text><text class="lbl" x="150" y="84">■ мин. позиционеру</text><text class="lbl" x="250" y="84">□ запас</text>
        <text class="lbl-strong" x="10" y="112" id="dlTxt"></text>`,
      text: 'Выход AO выдаёт ток, но его напряжения должно хватить на всю петлю: падение на линии и барьере плюс минимальное напряжение на клеммах позиционера (типовое около 9.7 В). Не хватает — ток не растёт, клапан не доходит. Ниже 3.6 мА позиционер не запитан.',
      note: 'NE43: 3.8–20.5 мА — рабочий диапазон, 3.6–3.8 и 20.5–21 — насыщение, ниже 3.6 и выше 21 — сигнал отказа.'
    },
    supply: {
      title: 'Воздух питания',
      svg: `
        <circle cx="90" cy="84" r="60" fill="var(--panel)" stroke="var(--metal-ink)" stroke-width="2"/>
        <g id="dgTicks"></g>
        <line id="dgNeedle" x1="90" y1="84" x2="90" y2="34" stroke="var(--alarm)" stroke-width="2.5"/>
        <circle cx="90" cy="84" r="4" fill="var(--metal-ink)"/>
        <text class="lbl-strong mono" x="64" y="124" id="dgVal"></text>
        <text class="lbl" x="170" y="50">Фильтр-регулятор</text>
        <text class="lbl" x="170" y="64">держит давление питания</text>
        <text class="lbl" x="170" y="78">позиционера и бустера.</text>`,
      text: 'Давление питания должно быть выше конца bench set привода с запасом, иначе позиционер не доведёт клапан до крайнего положения. На вашем объекте норма около 4.5: по смыслу это бар или кгс/см² (они почти равны).',
      note: 'Ниже ~1.4 бар (типовое) позиционер работает ненадёжно, ниже ~0.5 бар у I/P нет давления сопла и реле уходит на сброс.'
    },
    valve: {
      title: 'Затвор: характеристика',
      svg: `
        <line x1="40" y1="140" x2="300" y2="140" stroke="var(--line)"/>
        <line x1="40" y1="16" x2="40" y2="140" stroke="var(--line)"/>
        <text class="lbl" x="242" y="156">ход, % →</text>
        <text class="lbl" x="4" y="12">Q, %</text>
        <path id="dvLin" fill="none" stroke="var(--muted)" stroke-dasharray="3 3"/>
        <path id="dvEqp" fill="none" stroke="var(--muted)" stroke-dasharray="1 3"/>
        <path id="dvCur" fill="none" stroke="var(--fluid)" stroke-width="2"/>
        <circle id="dvPt" r="5" fill="var(--fluid)"/>`,
      text: 'Расход через седло зависит от подъёма плунжера и профиля затвора: линейный, равнопроцентный или быстрого открытия. Стенд использует линейный затвор; характеристику позиционера можно менять в настройках.',
      note: 'Расход показан относительный, при постоянном перепаде на клапане.'
    }
  };

  function openNode(n) {
    if (!NODES[n]) return;
    selNode = n;
    const d = NODES[n];
    $('dTitle').textContent = d.title;
    $('dSvg').innerHTML = d.svg;
    $('dText').textContent = d.text;
    $('dNote').textContent = d.note;
    $('detail').hidden = false;
    const bx = SEL_BOX[n];
    const sel = $('sel');
    sel.setAttribute('x', bx[0]); sel.setAttribute('y', bx[1]); sel.setAttribute('width', bx[2]); sel.setAttribute('height', bx[3]);
    sel.setAttribute('display', 'inline');
    staticDetail(n);
    updateDetail(sim.state);
  }
  function closeNode() {
    selNode = null;
    $('detail').hidden = true;
    $('sel').setAttribute('display', 'none');
  }
  function staticDetail(n) {
    const c = sim.cfg;
    if (n === 'act') {
      const X = (p) => 40 + p / 1.4 * 260, Y = (a) => 140 - a * 116;
      let t = '';
      for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4]) t += `<line x1="${X(p)}" y1="140" x2="${X(p)}" y2="144" stroke="var(--line)"/><text class="lbl mono" x="${X(p) - 6}" y="152" font-size="7">${p.toFixed(1)}</text>`;
      $('daTicks').innerHTML = t;
    }
    if (n === 'supply') {
      let t = '';
      for (let p = 0; p <= 7; p++) {
        const a = (-135 + p / 7 * 270) * Math.PI / 180;
        t += `<line x1="${90 + 50 * Math.sin(a)}" y1="${84 - 50 * Math.cos(a)}" x2="${90 + 58 * Math.sin(a)}" y2="${84 - 58 * Math.cos(a)}" stroke="var(--metal-ink)"/><text class="lbl mono" x="${86 + 40 * Math.sin(a)}" y="${87 - 40 * Math.cos(a)}" font-size="8">${p}</text>`;
      }
      $('dgTicks').innerHTML = t + '<text class="lbl" x="80" y="104">бар</text>';
    }
    if (n === 'valve') {
      const X = (h) => 40 + h * 260, Y = (q) => 140 - q * 124;
      const curve = (k) => { let d = ''; for (let i = 0; i <= 40; i++) { const h = i / 40; d += (i ? 'L' : 'M') + X(h).toFixed(1) + ',' + Y(C.charFn(k, h, 50)).toFixed(1); } return d; };
      $('dvLin').setAttribute('d', curve('lin'));
      $('dvEqp').setAttribute('d', curve('eqp'));
      $('dvCur').setAttribute('d', curve(c.valve.char));
    }
  }
  function kv(pairs) {
    $('dKv').innerHTML = pairs.map((p) => `<div><span>${p[0]}</span><b>${p[1]}</b></div>`).join('');
  }
  const detAnim = { a: 0, b: 0, c: 0 };
  function flowAttr(id, on, dt, key) {
    const el = $(id);
    if (!el) return;
    detAnim[key] -= on ? 30 * dt : 0;
    el.setAttribute('stroke-dashoffset', detAnim[key].toFixed(1));
    el.setAttribute('opacity', on ? '1' : '0');
  }
  let lastDetT = 0;
  function updateDetail(o) {
    const c = sim.cfg;
    const dt = Math.max(0, Math.min(0.1, o.t - lastDetT));
    lastDetT = o.t;
    if (selNode === 'pos') {
      $('dW').textContent = 'w = ' + (o.sp * 100).toFixed(1) + ' %';
      $('dX').textContent = 'x = ' + (o.hm * 100).toFixed(1) + ' %';
      $('dE').textContent = 'e = ' + ((o.sp - o.hm) * 100).toFixed(1) + ' %';
      const u = o.u;
      $('dFlap').setAttribute('transform', `rotate(${(u * 8).toFixed(2)} 146 28)`);
      $('dSup').setAttribute('opacity', u > 0 ? (0.3 + 0.7 * u).toFixed(2) : '0.12');
      $('dExh').setAttribute('opacity', u < 0 ? (0.3 + 0.7 * -u).toFixed(2) : '0.12');
      flowAttr('dSupF', u > 0.02 && o.pSup > 0.3, dt, 'a');
      flowAttr('dExhF', u < -0.02 && o.pSig > 0.01, dt, 'b');
      const th = o.angle * Math.PI / 180;
      $('dPot').setAttribute('x2', (50 + 14 * Math.sin(th)).toFixed(2));
      $('dPot').setAttribute('y2', (140 - 14 * Math.cos(th)).toFixed(2));
      $('dTh').textContent = 'θ = ' + o.angle.toFixed(1) + '°';
      kv([['Режим', o.powered ? o.mode.toUpperCase() : 'нет питания'], ['Реле u', (u * 100).toFixed(0) + ' %'],
        ['Зона нечувств.', c.posit.db + ' %'], ['Метка пальца', c.lever.markMm + ' мм']]);
    } else if (selNode === 'booster') {
      $('dbSig').setAttribute('opacity', (0.1 + 0.8 * pOp(o.pSig)).toFixed(2));
      $('dbOut').setAttribute('opacity', (0.1 + 0.8 * pOp(o.pAct)).toFixed(2));
      $('dbSup').setAttribute('opacity', (0.1 + 0.8 * pOp(o.pSup)).toFixed(2));
      const dpb = o.pSig - o.pAct;
      $('dbDia').setAttribute('transform', `translate(0,${Math.max(-4, Math.min(4, dpb * 25)).toFixed(2)})`);
      $('dbPop').setAttribute('transform', `translate(0,${o.qBoost > 0.01 ? 5 : 0})`);
      $('dbNeedle').setAttribute('cy', (56 + (c.booster.bypass - 0.5) * 20).toFixed(1));
      flowAttr('dbSupF', o.qBoost > 0.01, dt, 'a');
      flowAttr('dbExhF', o.qBoost < -0.01, dt, 'b');
      flowAttr('dbF', false, dt, 'c');
      kv([['P сигнала', fmtP(o.pSig)], ['P выхода', fmtP(o.pAct)], ['Δ сиг.−вых.', (dpb).toFixed(3) + ' бар'],
        ['Порог', c.booster.db + ' бар'], ['Q бустера', o.qBoost.toFixed(2) + ' нл/с'], ['Q байпаса', o.qBypass.toFixed(2) + ' нл/с'],
        ['Игла байпаса', Math.round(c.booster.bypass * 100) + ' %'], ['Есть в цепи', c.booster.present ? 'да' : 'нет']]);
    } else if (selNode === 'sov') {
      const pass = !o.sovVent;
      $('dsPl').setAttribute('transform', `translate(0,${pass ? -8 : 0})`);
      $('dsCoil').setAttribute('stroke', c.sov.energized ? 'var(--wire)' : 'var(--steel)');
      flowAttr('dsPA', pass && c.sov.present, dt, 'a');
      flowAttr('dsAR', o.sovVent && o.pAct > 0.01, dt, 'b');
      kv([['Катушка', c.sov.energized ? 'под напряжением' : 'обесточена'], ['Путь', pass ? 'P → A' : 'A → R'],
        ['P привода', fmtP(o.pAct)], ['Есть в цепи', c.sov.present ? 'да' : 'нет']]);
    } else if (selNode === 'act') {
      const X = (p) => 40 + Math.min(1.4, p) / 1.4 * 260, Y = (a) => 140 - a * 116;
      const A = c.act, fs = A.fs;
      const p0 = A.springBroken ? 0 : A.pb0, p1 = A.springBroken ? 0 : A.pb1;
      $('daBench').setAttribute('x1', X(p0)); $('daBench').setAttribute('y1', Y(0));
      $('daBench').setAttribute('x2', X(p1)); $('daBench').setAttribute('y2', Y(1));
      $('daBand').setAttribute('d', `M${X(p0 - fs)},${Y(0)} L${X(p1 - fs)},${Y(1)} L${X(p1 + fs)},${Y(1)} L${X(p0 + fs)},${Y(0)} Z`);
      $('daPt').setAttribute('cx', X(o.pAct).toFixed(1)); $('daPt').setAttribute('cy', Y(o.a).toFixed(1));
      $('daTxt').textContent = `bench set ${A.pb0}–${A.pb1} бар`;
      const areaM2 = A.areaCm2 / 1e4;
      const fAir = o.pAct * 1e5 * areaM2, fSpr = A.springBroken ? 0 : (A.pb0 + o.a * (A.pb1 - A.pb0)) * 1e5 * areaM2;
      kv([['P в камере', fmtP(o.pAct)], ['Площадь A', A.areaCm2 + ' см²'], ['Усилие P·A', (fAir / 1000).toFixed(2) + ' кН'],
        ['Пружина', (fSpr / 1000).toFixed(2) + ' кН'], ['Ход штока', (o.a * A.strokeMm).toFixed(1) + ' мм'], ['Исполнение', A.type === 'ATO' ? 'ВО · НЗ' : 'ВЗ · НО']]);
    } else if (selNode === 'loop') {
      const L = c.loop, W = 300 / L.uSup;
      const uLine = o.i * L.rWire / 1000, uBar = L.barrier ? o.i * L.rBarrier / 1000 + L.uBarrier : 0;
      $('dlLine').setAttribute('width', (uLine * W).toFixed(1));
      $('dlBar').setAttribute('x', (10 + uLine * W).toFixed(1)); $('dlBar').setAttribute('width', (uBar * W).toFixed(1));
      $('dlPos').setAttribute('x', (10 + (uLine + uBar) * W).toFixed(1)); $('dlPos').setAttribute('width', (L.uMinPos * W).toFixed(1));
      const margin = L.uSup - uLine - uBar - L.uMinPos;
      $('dlTxt').textContent = margin >= 0 ? `Запас ${margin.toFixed(1)} В` : `Не хватает ${(-margin).toFixed(1)} В`;
      $('dlTxt').setAttribute('fill', margin >= 0 ? 'var(--ok)' : 'var(--alarm)');
      kv([['Ток', o.i.toFixed(2) + ' мА'], ['NE43', { ok: 'норма', sat_lo: 'насыщ. низ', sat_hi: 'насыщ. верх', fail_lo: 'ОТКАЗ низ', fail_hi: 'ОТКАЗ верх' }[o.ne43]],
        ['R линии', L.rWire + ' Ом'], ['Барьер Ex i', L.barrier ? L.rBarrier + ' Ом' : 'нет'], ['U на клеммах', o.uAvail.toFixed(1) + ' В'], ['Мин. позиционеру', L.uMinPos + ' В']]);
    } else if (selNode === 'supply') {
      const a = (-135 + Math.min(1, o.pSup / 7) * 270) * Math.PI / 180;
      $('dgNeedle').setAttribute('x2', (90 + 48 * Math.sin(a)).toFixed(1));
      $('dgNeedle').setAttribute('y2', (84 - 48 * Math.cos(a)).toFixed(1));
      $('dgVal').textContent = fmtP(o.pSup);
      kv([['P питания', fmtP(o.pSup)], ['в бар', o.pSup.toFixed(2)], ['в кгс/см²', (o.pSup * 1.019716).toFixed(2)], ['в МПа', (o.pSup / 10).toFixed(3)]]);
    } else if (selNode === 'valve') {
      const X = (h) => 40 + h * 260, Y = (q) => 140 - q * 124;
      $('dvPt').setAttribute('cx', X(o.h).toFixed(1)); $('dvPt').setAttribute('cy', Y(o.flowRel).toFixed(1));
      kv([['Ход', (o.h * 100).toFixed(1) + ' %'], ['Расход', (o.flowRel * 100).toFixed(1) + ' %'], ['Kv ном.', c.valve.kv], ['Затвор', { lin: 'линейный', eqp: 'равнопроц.', qo: 'быстр. откр.' }[c.valve.char]]]);
    }
  }

  // ---------- тренд ----------
  const trendBuf = [];
  let trendT = 0;
  const cv = $('trend');
  const cx = cv.getContext('2d');
  let colors = {};
  function readColors() {
    const cs = getComputedStyle(root);
    for (const k of ['ink', 'muted', 'line', 'air', 'panel']) colors[k] = cs.getPropertyValue('--' + k).trim();
  }
  function sampleTrend(o) {
    if (o.t - trendT >= 0.1 || !trendBuf.length) {
      trendT = o.t;
      trendBuf.push([o.t, o.powered ? o.sp : NaN, o.h, o.pAct]);
      while (trendBuf.length && trendBuf[0][0] < o.t - 30.5) trendBuf.shift();
    }
  }
  function drawTrend(o) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    const L = 30, R = W - 40, T = 6, B = H - 18;
    const pMax = Math.max(1.2, Math.ceil(sim.cfg.supply.p || 1));
    const t1 = o.t, t0 = t1 - 30;
    const X = (t) => L + (t - t0) / 30 * (R - L);
    const Yp = (v) => B - v * (B - T);
    cx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    cx.lineWidth = 1;
    cx.strokeStyle = colors.line; cx.fillStyle = colors.muted;
    for (const v of [0, 0.5, 1]) {
      cx.beginPath(); cx.moveTo(L, Yp(v)); cx.lineTo(R, Yp(v)); cx.stroke();
      cx.textAlign = 'right'; cx.fillText(Math.round(v * 100) + '%', L - 4, Yp(v) + 3);
      cx.textAlign = 'left'; cx.fillText(C.fmtP(v * pMax, ui.unit).split(' ')[0], R + 4, Yp(v) + 3);
    }
    cx.textAlign = 'left'; cx.fillText('−30 с', L, H - 4);
    cx.textAlign = 'right'; cx.fillText('сейчас', R, H - 4);
    const line = (idx, color, scale, dash, width) => {
      cx.strokeStyle = color; cx.lineWidth = width; cx.setLineDash(dash);
      cx.beginPath();
      let pen = false;
      for (const s of trendBuf) {
        const v = s[idx];
        if (!isFinite(v)) { pen = false; continue; }
        const x = X(s[0]), y = Yp(Math.max(0, Math.min(1.02, v / scale)));
        if (pen) cx.lineTo(x, y); else { cx.moveTo(x, y); pen = true; }
      }
      cx.stroke(); cx.setLineDash([]);
    };
    line(3, colors.air, pMax, [], 1.6);
    line(1, colors.muted, 1, [4, 3], 1.4);
    line(2, colors.ink, 1, [], 2);
  }

  // ---------- управление ----------
  function setI(v) {
    ui.iSet = Math.round(Math.max(0, Math.min(24, v)) * 100) / 100;
    $('inI').value = ui.iSet;
    sim.setCurrent(ui.iSet);
  }
  function bind() {
    $('inI').addEventListener('input', (e) => setI(+e.target.value));
    $('mDown').addEventListener('click', () => setI(ui.iSet - 0.1));
    $('mUp').addEventListener('click', () => setI(ui.iSet + 0.1));
    const pre = [3.5, 4, 8, 12, 16, 20, 21.5];
    $('presets').innerHTML = pre.map((v) => `<button class="btn" data-ma="${v}">${v}</button>`).join('');
    $('presets').addEventListener('click', (e) => { const b = e.target.closest('[data-ma]'); if (b) setI(+b.dataset.ma); });

    $('inSup').addEventListener('input', (e) => { ui.pSup = +e.target.value; $('vSup').textContent = fmtP(ui.pSup); applyCfg(); });
    $('selUnit').addEventListener('change', (e) => { ui.unit = e.target.value; store.set('unit', ui.unit); $('vSup').textContent = fmtP(ui.pSup); });
    $('tgBoost').addEventListener('change', (e) => { ui.boost = e.target.checked; $('boostOpts').hidden = !ui.boost; applyCfg(); });
    $('inBypass').addEventListener('input', (e) => { ui.bypass = +e.target.value / 100; $('vBypass').textContent = e.target.value + ' %'; applyCfg(); });
    $('tgSov').addEventListener('change', (e) => { ui.sov = e.target.checked; $('sovEWrap').hidden = !ui.sov; applyCfg(); });
    $('tgSovE').addEventListener('change', (e) => { ui.sovE = e.target.checked; applyCfg(); });

    $('btnInit').addEventListener('click', () => { sim.startInit(); });
    $('selDir').addEventListener('change', (e) => { ui.dir = e.target.value; applyCfg(); });
    $('selChar').addEventListener('change', (e) => { ui.char = e.target.value; applyCfg(); });
    $('selSr').addEventListener('change', (e) => { ui.sr = e.target.value; applyCfg(); });
    $('selPAct').addEventListener('change', (e) => { ui.pAct = e.target.value; applyCfg(); });
    $('selAct').addEventListener('change', (e) => { ui.act = e.target.value; applyCfg(); });
    $('selMark').addEventListener('change', (e) => { ui.mark = +e.target.value; applyCfg(); });
    $('tgBarrier').addEventListener('change', (e) => { ui.barrier = e.target.checked; applyCfg(); });
    $('selRw').addEventListener('change', (e) => { ui.rWire = +e.target.value; applyCfg(); });

    const fs = $('selFault');
    fs.innerHTML = '<option value="">нет</option>' + Object.keys(C.FAULTS).map((k) => `<option value="${k}">${FAULT_RU[k] ? FAULT_RU[k][0] : k}</option>`).join('');
    fs.addEventListener('change', (e) => setFault(e.target.value));

    $('tgLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; $('stage').classList.toggle('nolabels', !ui.labels); });
    $('spd1').addEventListener('click', () => setSpeed(1));
    $('spd025').addEventListener('click', () => setSpeed(0.25));
    $('btnPause').addEventListener('click', () => { ui.paused = !ui.paused; $('btnPause').setAttribute('aria-pressed', ui.paused); hint(); });
    $('btnReset').addEventListener('click', resetAll);
    $('selSkin').addEventListener('change', (e) => setSkin(e.target.value));
    $('btnFsUp').addEventListener('click', () => setScale(+1));
    $('btnFsDown').addEventListener('click', () => setScale(-1));

    $('cut').addEventListener('click', (e) => {
      const n = e.target.closest('[data-node]');
      if (!n) return;
      if (selNode === n.dataset.node) closeNode(); else openNode(n.dataset.node);
    });
    $('dClose').addEventListener('click', closeNode);
  }
  function setFault(k) {
    ui.fault = k;
    if (k === 'boosterBypassClosed') { ui.boost = true; $('tgBoost').checked = true; $('boostOpts').hidden = false; }
    if (k === 'sovStuck') { ui.sov = true; $('tgSov').checked = true; $('sovEWrap').hidden = false; }
    $('selFault').value = k;
    $('faultNote').textContent = k ? 'Введено: ' + FAULT_RU[k][0] + '. ' + FAULT_RU[k][1] : 'Нет неисправностей. Выберите одну и посмотрите, как меняется поведение клапана.';
    applyCfg();
  }
  function setSpeed(v) {
    ui.speed = v;
    $('spd1').setAttribute('aria-pressed', v === 1);
    $('spd025').setAttribute('aria-pressed', v === 0.25);
    hint();
  }
  function hint() { $('hint').textContent = ui.paused ? 'пауза' : '×' + ui.speed; }
  const SCALES = [0.9, 1, 1.15, 1.3];
  let scaleIdx = 1;
  function setScale(d) {
    scaleIdx = Math.max(0, Math.min(SCALES.length - 1, scaleIdx + d));
    root.style.setProperty('--scale', SCALES[scaleIdx]);
    store.set('scale', scaleIdx);
  }
  function setSkin(v) {
    if (v) root.setAttribute('data-skin', v); else root.removeAttribute('data-skin');
    $('selSkin').value = v;
    store.set('skin', v);
    readColors();
  }
  function syncControls() {
    $('inI').value = ui.iSet; $('inSup').value = ui.pSup; $('vSup').textContent = fmtP(ui.pSup);
    $('selUnit').value = ui.unit;
    $('tgBoost').checked = ui.boost; $('boostOpts').hidden = !ui.boost;
    $('inBypass').value = Math.round(ui.bypass * 100); $('vBypass').textContent = Math.round(ui.bypass * 100) + ' %';
    $('tgSov').checked = ui.sov; $('sovEWrap').hidden = !ui.sov; $('tgSovE').checked = ui.sovE;
    $('selDir').value = ui.dir; $('selChar').value = ui.char; $('selSr').value = ui.sr; $('selPAct').value = ui.pAct;
    $('selAct').value = ui.act; $('selMark').value = String(ui.mark); $('tgBarrier').checked = ui.barrier; $('selRw').value = String(ui.rWire);
    $('selFault').value = ui.fault; $('tgLabels').checked = ui.labels; $('stage').classList.toggle('nolabels', !ui.labels);
  }
  function resetAll() {
    const unit = ui.unit;
    ui = JSON.parse(JSON.stringify(UI0));
    ui.unit = unit;
    topoKey = '';
    syncControls();
    setFault('');
    newSim();
    lastInitKey = '';
    closeNode();
    setSpeed(1);
  }

  // ---------- цикл ----------
  let lastNow = 0;
  function frame(now) {
    const dtReal = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    const dt = ui.paused ? 0 : dtReal * ui.speed;
    if (dt > 0) sim.step(dt);
    const o = sim.state;
    render(o, dt);
    sampleTrend(o);
    drawTrend(o);
    requestAnimationFrame(frame);
  }

  // ---------- старт ----------
  ui.unit = store.get('unit', 'bar');
  scaleIdx = store.get('scale', 1); setScale(0);
  setSkin(store.get('skin', ''));
  syncControls();
  bind();
  newSim();
  $('sel').setAttribute('display', 'none');
  $('ver').textContent = 'sim-core ' + C.VERSION + ' · стенд F2';
  readColors();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', readColors);
  }
  new MutationObserver(readColors).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });
  requestAnimationFrame(frame);

  // хук для автотестов
  window.__ci = { get sim() { return sim; }, setI, setFault, openNode, setSkin, ui: () => ui };
})();
