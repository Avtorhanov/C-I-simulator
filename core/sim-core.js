/* C&I Simulator — sim-core v0.1 (F1)
 * Детерминированная модель цепочки:
 *   петля 4–20 мА → позиционер (I/P + реле + ОС) → [бустер] → [SOV] → мембранный привод → клапан
 * Без UI. Без случайности. Шаг интегрирования фиксированный (DT).
 * Единицы: давление — бар изб., время — с, ток — мА, напряжение — В, ход — доли 0..1.
 * Все числа «типовые», подлежат сверке экспертом. Не заменяет РЭ производителя.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CISim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';
  const PATM = 1.01325;      // бар абс.
  const DT = 0.001;          // с, шаг интегрирования
  const LAMINAR = 0.01;      // бар, зона линеаризации расхода у нуля перепада
  const PILOT_MIN = 0.5;     // бар, ниже — у I/P нет давления сопла, реле уходит на сброс (типовое)

  // ---------- типовые параметры (сверить) ----------
  const DEFAULTS = {
    supply: { p: 4.5 },                       // Pпит, бар (на объекте ≈ 4.5)
    loop: {
      uSup: 24,          // В, питание выхода AO
      rWire: 50,         // Ом, линия
      barrier: false,    // барьер Ex i в петле
      rBarrier: 280,     // Ом, сопротивление барьера (типовое)
      uBarrier: 0.9,     // В, падение на диодах барьера (типовое)
      uMinPos: 9.7,      // В, мин. напряжение на клеммах позиционера (типовое 9–12)
      iMinPos: 3.6,      // мА, ниже — позиционер не запитан
      broken: false,     // обрыв
      polarity: false    // перепутана полярность (защитный диод → тока нет)
    },
    posit: {
      mode: 'auto',      // auto | man | init
      calibrated: true,  // стенд стартует с выполненной калибровкой
      srLo: 4, srHi: 20, // split range, мА
      dir: 'inc',        // inc — прямое, dec — обратное
      char: 'lin',       // lin | eqp | qo — характеристика позиционера
      cutLo: 1, cutHi: 99, // %, плотное закрытие / полное открытие
      db: 0.2,           // %, зона нечувствительности
      kp: 8, kd: 0.15,   // PD
      act: 'ATO',        // как настроен позиционер: ATO (ВО, НЗ) | ATC (ВЗ, НО)
      relayK: 0.4,       // пропускная способность реле на наполнение
      relayKex: 1.0      // … на сброс (выхлоп реле шире)
    },
    lever: {
      markMm: 30,        // метка пальца рычага (под какой ход установлен палец)
      offsetDeg: 0,      // перекос рычага при 50 % хода
      sensorMaxDeg: 50,  // рабочий диапазон датчика ±, °
      minSweepDeg: 20,   // минимальный угол поворота за ход, °
      backlash: 0        // люфт ОС, доли хода
    },
    booster: {
      present: false,
      k: 2,              // пропускная способность бустера
      db: 0.05,          // бар, порог срабатывания
      span: 0.1,         // бар, перепад полного открытия бустера
      bypass: 0.4,       // открытие байпасной иглы 0..1
      kBypass: 2,
      vSig: 0.05         // л, объём сигнальной линии позиционер→бустер
    },
    sov: {
      present: false,
      energized: true,   // под напряжением — воздух проходит
      k: 2.5,            // сброс через SOV
      stuck: false       // не срабатывает
    },
    act: {
      type: 'ATO',       // фактическое исполнение привода: ATO (НЗ) | ATC (НО)
      areaCm2: 560,      // эффективная площадь мембраны, см²
      strokeMm: 30,
      pb0: 0.2, pb1: 1.0, // bench set, бар
      fs: 0.03, fd: 0.02, // трение покоя/движения в эквиваленте давления, бар
      c: 0.05,           // демпфирование, бар·с
      v0: 0.5,           // л, мёртвый объём камеры
      vLine: 0.03,       // л, трубка к приводу
      leakK: 0,          // утечка камеры/импульса
      springBroken: false
    },
    valve: { char: 'lin', kv: 25, R: 50 },
    init: { timeout: 30, stableTime: 1.0, moveDeg: 2, stableDeg: 0.05 }
  };

  // Неисправности: патч к конфигурации. Тексты/признаки сверяет user.
  const FAULTS = {
    noAir:             { supply: { p: 0 } },
    lowSupply:         { supply: { p: 0.8 } },
    diaphragmRupture:  { act: { leakK: 3 } },
    signalLeak:        { act: { leakK: 0.08 } },
    packingTight:      { act: { fs: 0.25, fd: 0.15 } },
    wrongLeverMark:    { lever: { markMm: 120 } },
    feedbackBacklash:  { lever: { backlash: 0.03 } },
    polarity:          { loop: { polarity: true } },
    loopBreak:         { loop: { broken: true } },
    lowVoltage:        { loop: { rWire: 900 } },
    springBroken:      { act: { springBroken: true } },
    actuatorFlipped:   { act: { type: 'ATC' } },
    boosterBypassClosed: { booster: { present: true, bypass: 0 } },
    sovStuck:          { sov: { present: true, stuck: true } }
  };

  // ---------- утилиты ----------
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(dst, src) {
    if (!isObj(src)) return dst;
    for (const k of Object.keys(src)) {
      if (isObj(src[k]) && isObj(dst[k])) merge(dst[k], src[k]);
      else dst[k] = src[k];
    }
    return dst;
  }
  const RAD = Math.PI / 180;

  // Расход через дроссель, НЛ/с на ед. K; знак: + от Pu к Pd.
  function orifice(pu, pd) {
    let a = pu + PATM, b = pd + PATM, s = 1;
    if (b > a) { const t = a; a = b; b = t; s = -1; }
    const d = a - b;
    if (d < LAMINAR) {
      const qT = Math.sqrt(a * a - (a - LAMINAR) * (a - LAMINAR));
      return s * qT * d / LAMINAR;
    }
    if (b < 0.528 * a) return s * 0.849 * a;        // критический режим
    return s * Math.sqrt(a * a - b * b);
  }

  function ne43(i) {
    if (i < 3.6) return 'fail_lo';
    if (i < 3.8) return 'sat_lo';
    if (i > 21) return 'fail_hi';
    if (i > 20.5) return 'sat_hi';
    return 'ok';
  }

  // Характеристика (позиционера или затвора), x 0..1 → 0..1
  function charFn(kind, x, R) {
    x = clamp(x, 0, 1);
    R = R || 50;
    if (kind === 'eqp') return (Math.pow(R, x) - 1) / (R - 1);
    if (kind === 'qo') return Math.sqrt(x);
    return x;
  }
  function charInv(kind, y, R) {
    y = clamp(y, 0, 1);
    R = R || 50;
    if (kind === 'eqp') return Math.log(1 + y * (R - 1)) / Math.log(R);
    if (kind === 'qo') return y * y;
    return y;
  }

  // Перевод давления для отображения
  const UNITS = {
    bar: { k: 1, label: 'бар', dp: 2 },
    kgf: { k: 1.019716, label: 'кгс/см²', dp: 2 },
    kPa: { k: 100, label: 'кПа', dp: 0 },
    MPa: { k: 0.1, label: 'МПа', dp: 3 }
  };
  function fmtP(bar, unit) {
    const u = UNITS[unit] || UNITS.bar;
    return (bar * u.k).toFixed(u.dp) + ' ' + u.label;
  }

  // ---------- модель ----------
  function createSim(userCfg) {
    const cfg = merge(clone(DEFAULTS), userCfg || {});
    const s = {
      t: 0, acc: 0,
      a: 0,            // ход по воздуху (сжатие пружины) 0..1
      v: 0, moving: 0,
      pAct: 0, pSig: 0, pUp: 0,
      sens: 0,         // положение звена ОС с учётом люфта
      vEst: 0, amPrev: null,
      iSet: 4,
      man: 0,
      mode: cfg.posit.mode,
      cal: null,
      init: null,
      initResult: null,
      out: {}
    };
    s.sens = s.a;

    function angleOf(a) {
      const L = cfg.act.strokeMm, r = Math.max(1, cfg.lever.markMm);
      const arg = clamp((a - 0.5) * L / r, -1, 1);
      const th = cfg.lever.offsetDeg + Math.asin(arg) / RAD;
      const lim = cfg.lever.sensorMaxDeg + 15;     // механический упор датчика
      return clamp(th, -lim, lim);
    }
    function geomCal() {
      return { th0: angleOf(0), th1: angleOf(1), tUp: null, tDown: null, source: 'preset' };
    }
    if (cfg.posit.calibrated !== false) s.cal = geomCal();
    if (cfg.posit.calibrated === false && s.mode === 'auto') s.mode = 'nocal';

    // измеренный позиционером ход по воздуху (с синусной линеаризацией)
    function measured(th) {
      const c = s.cal;
      if (!c) return 0;
      const mid = (c.th0 + c.th1) / 2;
      const f = (x) => Math.sin((x - mid) * RAD);
      const d = f(c.th1) - f(c.th0);
      if (Math.abs(d) < 1e-9) return 0;
      return (f(th) - f(c.th0)) / d;
    }

    function loopCalc() {
      const L = cfg.loop;
      let i = s.iSet;
      if (L.broken || L.polarity) i = 0;
      const R = (L.rWire + (L.barrier ? L.rBarrier : 0)) / 1000;  // кОм → В/мА
      const uDrop = L.barrier ? L.uBarrier : 0;
      let lowU = false;
      if (i > 0 && L.uSup - uDrop - i * R < L.uMinPos) {
        lowU = true;
        i = clamp((L.uSup - uDrop - L.uMinPos) / Math.max(R, 1e-6), 0, i);
      }
      const uAvail = i > 0 ? L.uSup - uDrop - i * R : (L.broken ? 0 : L.uSup - uDrop);
      const powered = i >= L.iMinPos && !L.broken && !L.polarity;
      return { i, uAvail, lowU, powered, ne43: ne43(i) };
    }

    function signalFrac(i) {
      const p = cfg.posit;
      let w = clamp((i - p.srLo) / (p.srHi - p.srLo), 0, 1);
      if (p.dir === 'dec') w = 1 - w;
      return w;
    }

    function backlash(a) {
      const b = cfg.lever.backlash;
      if (b <= 0) { s.sens = a; return a; }
      if (a - s.sens > b / 2) s.sens = a - b / 2;
      else if (s.sens - a > b / 2) s.sens = a + b / 2;
      return s.sens;
    }

    // ---- AUTO-инициализация ----
    function startInit() {
      s.mode = 'init';
      s.initResult = null;
      s.init = { phase: 'down0', tPhase: 0, thRef: null, tStable: 0, tMove: null, th0: null, th1: null, tUp: null, tDown: null };
    }
    function initStep(th, powered, dt) {
      const I = s.init, ic = cfg.init;
      if (!powered) return finishInit('NO_POWER');
      I.tPhase += dt;
      // стабильность угла
      if (I.thRef === null || Math.abs(th - I.thRef) > ic.stableDeg) { I.thRef = th; I.tStable = 0; }
      else I.tStable += dt;
      const stable = I.tStable >= ic.stableTime;
      if (I.phase === 'down0') {
        // сброс в исходное: ждём, пока шток сойдёт и успокоится (или минимум 10 с покоя)
        if (I.thStart === undefined) I.thStart = th;
        if (Math.abs(th - I.thStart) > ic.moveDeg) I.moved0 = true;
        if ((stable && (I.moved0 || I.tPhase > 10)) || I.tPhase > ic.timeout) { I.th0 = th; next('up'); }
        return -1;
      }
      if (I.phase === 'up') {
        if (I.tMove === null && Math.abs(th - I.th0) > ic.moveDeg) I.tMove = I.tPhase;
        if (I.tMove === null && I.tPhase > ic.timeout) return finishInit('NO_MOVE');
        if (I.tMove !== null && stable) { I.th1 = th; I.tUp = I.tPhase - ic.stableTime; next('down'); return -1; }
        return 1;
      }
      if (I.phase === 'down') {
        if (I.tMove === null && Math.abs(th - I.th1) > ic.moveDeg) I.tMove = I.tPhase;
        if (I.tMove === null && I.tPhase > ic.timeout) return finishInit('NO_MOVE');
        if (I.tMove !== null && stable) {
          I.th0 = th; I.tDown = I.tPhase - ic.stableTime;
          return finishInit(checkAngles(I.th0, I.th1));
        }
        return -1;
      }
      return 0;
      function next(ph) { I.phase = ph; I.tPhase = 0; I.thRef = null; I.tStable = 0; I.tMove = null; }
    }
    function checkAngles(th0, th1) {
      const lv = cfg.lever;
      if (Math.abs(th0) > lv.sensorMaxDeg || Math.abs(th1) > lv.sensorMaxDeg) return 'ANGLE_RANGE';
      if (Math.abs(th1 - th0) < lv.minSweepDeg) return 'ANGLE_SMALL';
      return null;
    }
    function finishInit(err) {
      const I = s.init;
      const res = {
        ok: !err, error: err || null,
        th0: I.th0, th1: I.th1,
        sweepDeg: (I.th0 !== null && I.th1 !== null) ? Math.abs(I.th1 - I.th0) : null,
        tUp: I.tUp, tDown: I.tDown
      };
      s.initResult = res;
      if (!err) {
        s.cal = { th0: I.th0, th1: I.th1, tUp: I.tUp, tDown: I.tDown, source: 'init' };
        s.mode = 'auto';
      } else {
        s.mode = s.cal ? 'auto' : 'nocal';
        if (err !== 'NO_POWER' && err !== 'NO_MOVE') { s.cal = null; s.mode = 'nocal'; }
      }
      s.init = null;
      return -1;
    }

    // ---- позиционер: команда реле u ∈ [-1, 1] ----
    function positioner(lp, th, dt) {
      const p = cfg.posit;
      const am = measured(th);
      // оценка скорости
      if (s.amPrev === null) s.amPrev = am;
      const vRaw = (am - s.amPrev) / dt;
      s.amPrev = am;
      s.vEst += (vRaw - s.vEst) * Math.min(1, dt / 0.05);

      const w = signalFrac(lp.i);
      const sp = charFn(p.char, w, 50);
      const ato = p.act === 'ATO';
      const hm = ato ? am : 1 - am;
      const r = { w, sp, am, hm, u: -1, state: s.mode };

      if (s.mode === 'init') {
        r.u = initStep(th, lp.powered, dt);
        r.state = s.mode;
        if (cfg.supply.p < PILOT_MIN) r.u = -1;
        return r;
      }
      if (!lp.powered) { r.state = 'off'; r.u = -1; return r; }
      if (s.mode === 'man') { r.u = cfg.supply.p < PILOT_MIN ? -1 : clamp(s.man, -1, 1); return r; }
      if (s.mode === 'nocal' || !s.cal) { r.state = 'nocal'; r.u = -1; return r; }

      const wPct = w * 100;
      const noPilot = cfg.supply.p < PILOT_MIN;
      if (wPct <= p.cutLo) { r.u = noPilot ? -1 : (ato ? -1 : 1); r.cut = 'lo'; return r; }
      if (wPct >= p.cutHi) { r.u = noPilot ? -1 : (ato ? 1 : -1); r.cut = 'hi'; return r; }
      const spA = ato ? sp : 1 - sp;
      const e = spA - am;
      if (Math.abs(e) * 100 < p.db) { r.u = 0; return r; }
      r.u = clamp(p.kp * e - p.kd * s.vEst, -1, 1);
      if (cfg.supply.p < PILOT_MIN) r.u = -1;   // нет питания сопла I/P → реле на сброс
      return r;
    }

    function relayFlow(u, pSup, pOut) {
      const k = cfg.posit.relayK;
      if (u > 0) return k * u * orifice(pSup, pOut);
      if (u < 0) return cfg.posit.relayKex * u * orifice(pOut, 0); // u<0 → сброс
      return 0;
    }

    function pNeed(a) {
      const A = cfg.act;
      if (A.springBroken) return 0;
      return A.pb0 + a * (A.pb1 - A.pb0);
    }

    function substep(dt) {
      const A = cfg.act, B = cfg.booster, S = cfg.sov;
      const pSup = Math.max(0, cfg.supply.p);
      const lp = loopCalc();
      const th = angleOf(backlash(s.a));
      const pr = positioner(lp, th, dt);
      const u = pr.u;

      const swept = A.areaCm2 * A.strokeMm / 10000;   // л (см² · мм → см³/10 → л)
      const vAct = A.v0 + A.vLine + swept * s.a;
      const sovVent = S.present && !S.energized && !S.stuck;
      const boost = B.present;

      let qRelay = 0, qBoost = 0, qBypass = 0, qSov = 0, qLeak = 0, qAct = 0, qSig = 0;
      qLeak = A.leakK > 0 ? -A.leakK * orifice(s.pAct, 0) : 0;

      if (!boost) {
        if (!sovVent) {
          qRelay = relayFlow(u, pSup, s.pAct);
          qAct = qRelay + qLeak;
          s.pSig = s.pUp = s.pAct;
        } else {
          qRelay = relayFlow(u, pSup, s.pUp);
          s.pUp = integ(s.pUp, qRelay, A.vLine, 0, dt, pSup);
          s.pSig = s.pUp;
          qSov = -S.k * orifice(s.pAct, 0);
          qAct = qSov + qLeak;
        }
      } else {
        qRelay = relayFlow(u, pSup, s.pSig);
        const target = sovVent ? s.pSig : s.pAct;   // при сбросе SOV выход бустера тупиковый
        if (!sovVent) {
          qBypass = B.kBypass * clamp(B.bypass, 0, 1) * orifice(s.pSig, s.pAct);
          const dpb = s.pSig - s.pAct;
          if (dpb > B.db) qBoost = B.k * clamp((dpb - B.db) / B.span, 0, 1) * orifice(pSup, s.pAct);
          else if (dpb < -B.db) qBoost = -B.k * clamp((-dpb - B.db) / B.span, 0, 1) * orifice(s.pAct, 0);
          qAct = qBoost + qBypass + qLeak;
          s.pUp = s.pAct;
        } else {
          qSov = -S.k * orifice(s.pAct, 0);
          qAct = qSov + qLeak;
          s.pUp = target;
        }
        qSig = qRelay - qBypass;
        s.pSig = integ(s.pSig, qSig, B.vSig, 0, dt, pSup);
      }

      // давление в камере (с учётом изменения объёма)
      const dV = swept * s.v * dt;
      const pAbs = s.pAct + PATM;
      let pNew = s.pAct + (PATM * qAct * dt - pAbs * dV) / vAct;
      s.pAct = clamp(pNew, 0, Math.max(pSup, s.pAct, s.pSig));

      // механика штока со stick-slip
      const net = s.pAct - pNeed(s.a);
      if (s.moving === 0) {
        if (net > A.fs && s.a < 1) s.moving = 1;
        else if (net < -A.fs && s.a > 0) s.moving = -1;
      }
      if (s.moving !== 0) {
        const drive = net - s.moving * A.fd;
        if (Math.sign(drive) !== s.moving) { s.moving = 0; s.v = 0; }
        else {
          s.v = drive / A.c;
          s.a += s.v * dt;
          if (s.a <= 0) { s.a = 0; s.moving = 0; s.v = 0; }
          if (s.a >= 1) { s.a = 1; s.moving = 0; s.v = 0; }
        }
      } else s.v = 0;

      s.t += dt;

      // выход
      const h = A.type === 'ATO' ? s.a : 1 - s.a;
      const flowRel = h < 0.001 ? 0 : charFn(cfg.valve.char, h, cfg.valve.R);
      s.out = {
        t: s.t,
        iSet: s.iSet, i: lp.i, uAvail: lp.uAvail, lowU: lp.lowU, powered: lp.powered, ne43: lp.ne43,
        w: pr.w, sp: pr.sp, hm: pr.hm, u, cut: pr.cut || null, state: pr.state,
        angle: th,
        a: s.a, h, v: s.v,
        pSup, pAct: s.pAct, pSig: s.pSig, pUp: s.pUp,
        qRelay, qBoost, qBypass, qSov, qLeak,
        flowRel,
        sovVent, booster: boost, sov: S.present
      };
    }

    function integ(p, q, V, dV, dt, pMax) {
      const np = p + (PATM * q * dt) / Math.max(V, 1e-6);
      return clamp(np, 0, Math.max(pMax, p));
    }

    function step(dt) {
      s.acc += dt;
      while (s.acc >= DT - 1e-12) { substep(DT); s.acc -= DT; }
      return snapshot();
    }
    function run(seconds, onSample, sampleEvery) {
      const n = Math.round(seconds / DT);
      const every = sampleEvery ? Math.max(1, Math.round(sampleEvery / DT)) : 0;
      for (let k = 0; k < n; k++) {
        substep(DT);
        if (every && onSample && (k + 1) % every === 0) onSample(snapshot());
      }
      return snapshot();
    }
    function snapshot() {
      return Object.assign({}, s.out, {
        mode: s.mode,
        cal: s.cal ? Object.assign({}, s.cal) : null,
        init: s.init ? { phase: s.init.phase } : null,
        initResult: s.initResult ? Object.assign({}, s.initResult) : null,
        alarms: alarms()
      });
    }
    function alarms() {
      const o = s.out, list = [];
      if (!o.t && o.t !== 0) return list;
      if (o.ne43 === 'fail_lo') list.push('NE43_LO');
      if (o.ne43 === 'fail_hi') list.push('NE43_HI');
      if (cfg.loop.broken) list.push('LOOP_BREAK');
      if (!o.powered) list.push('NO_POWER');
      if (o.lowU) list.push('LOW_U');
      if (o.pSup < 1.4) list.push('LOW_SUPPLY');
      if (s.mode === 'nocal') list.push('NOT_CAL');
      if (s.initResult && s.initResult.error) list.push('INIT_' + s.initResult.error);
      return list;
    }

    // ---- API ----
    const api = {
      cfg,
      setCurrent(mA) { s.iSet = clamp(+mA || 0, 0, 25); },
      set(patch) { merge(cfg, patch); return api; },
      applyFault(name) { if (FAULTS[name]) merge(cfg, clone(FAULTS[name])); return api; },
      setMode(m) { if (m === 'auto' && !s.cal) m = 'nocal'; s.mode = m; s.init = null; return api; },
      setManual(u) { s.man = clamp(u, -1, 1); return api; },
      startInit,
      recalibrateFromGeometry() { s.cal = geomCal(); if (s.mode === 'nocal') s.mode = 'auto'; return api; },
      step, run, snapshot,
      get state() { return snapshot(); }
    };
    substep(0 + 1e-9); // начальный расчёт выходов (пренебрежимо малый шаг)
    s.t = 0;
    s.out.t = 0;
    return api;
  }

  return { VERSION, DT, PATM, DEFAULTS, FAULTS, UNITS, createSim, orifice, ne43, charFn, charInv, fmtP };
});
