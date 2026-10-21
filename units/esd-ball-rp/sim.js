/* C&I Simulator — sim-esd v0.1: отсечной клапан ПАЗ (шаровой, реечный привод с пружинным возвратом)
 * Схема (сверено с user по объекту, 20.10.2026):
 *   ФР → тройник ─┬─→ позиционер SUP
 *                 └─→ бустер: питание → выход → привод (центральная камера, против пружин)
 *   позиционер OUT → SOV-РСУ (3/2) → SOV-ПАЗ (3/2) → сигнальный вход бустера
 *   Любой SOV обесточен → сигнал бустера сброшен → бустер сбрасывает привод → пружины закрывают кран.
 * БКВ: 3 индуктивных NAMUR-датчика (ЗАКР, ОТКР, 3-й — «сошёл с ОТКР», вероятно PST — сверить).
 * Детерминированно, шаг 1 мс. Давление — бар изб. Числа типовые, сверяет эксперт. Не заменяет РЭ производителя.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../core/sim-core.js'));
  else root.CISimESD = factory(root.CISim);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const VERSION = '0.1.0';
  const DT = C.DT, PATM = C.PATM;
  const PILOT_MIN = 0.5;
  const orifice = C.orifice;
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function merge(d, s) {
    if (!isObj(s)) return d;
    for (const k of Object.keys(s)) {
      if (isObj(s[k]) && isObj(d[k])) merge(d[k], s[k]);
      else d[k] = s[k];
    }
    return d;
  }

  const DEFAULTS = {
    supply: { p: 4.5 },                 // бар, после ФР (по манометрам объекта — бар)
    fr: { blocked: false },             // ФР забит / закрыт
    loop: { broken: false },            // обрыв 4–20 мА РСУ → позиционер
    posit: {
      kp: 3, kd: 0.4, db: 0.5,          // PD по углу; зона нечувствительности, %
      cutLo: 1, cutHi: 99,              // %, отсечки: полное закрытие / открытие
      relayK: 0.35, relayKex: 0.8,
      supBlocked: false,                // перекрыт отвод тройника на SUP позиционера
      pstSize: 10,                      // %, ход частичного теста (типовое 10–15 %)
      pstHold: 1.0,                     // с, выдержка в нижней точке
      pstTimeout: 10                    // с, не дошёл — тест не пройден
    },
    sovR: { k: 0.3, kex: 0.5, noPower: false, coilBurnt: false, stuck: false, uNom: 24 },
    sovP: { k: 0.3, kex: 0.5, noPower: false, coilBurnt: false, stuck: false, uNom: 24 },
    booster: { k: 2.2, kex: 2.6, db: 0.05, span: 0.15, bypass: 0.35, kBypass: 0.6, exhClogged: false },
    lines: { vPos: 0.04, vMid: 0.03, vSig: 0.05 },   // л
    act: {
      v0: 0.6, swept: 6.0,              // л: мёртвый объём центральной камеры, рабочий объём за 90°
      ps0: 2.0, ps90: 3.0,              // бар экв.: усилие пружин в закрытом / открытом (сжаты)
      c: 0.25,                          // демпфирование, бар·с
      leakK: 0, springBroken: false
    },
    valve: {
      fsSeat: 0.6, fsRun: 0.15, fd: 0.1, seatZone: 0.03,   // бар экв.: момент трогания у седла / в ходе
      stuck: false                      // «прикипел» шар
    },
    bkv: {
      camShiftDeg: 0,                   // сдвиг кулачка (неверная настройка), °
      broken: [false, false, false],    // обрыв линии датчика
      thClosed: 3, thOpen: 87, thPst: 83 // °: ЗАКР ≤3°, ОТКР ≥87°, 3-й ≤83° (сошёл с ОТКР)
    },
    logic: { tMis: 15 }                 // с, контроль рассогласования (типовое, сверить с проектом)
  };

  const FAULTS = {
    noAir:            { fr: { blocked: true } },
    lowSupply:        { supply: { p: 2.9 } },
    posSupBlocked:    { posit: { supBlocked: true } },
    loopBreak:        { loop: { broken: true } },
    sovRNoPower:      { sovR: { noPower: true } },
    sovRCoilBurnt:    { sovR: { coilBurnt: true } },
    sovPNoPower:      { sovP: { noPower: true } },
    sovPStuck:        { sovP: { stuck: true } },
    sovRStuck:        { sovR: { stuck: true } },
    boosterExhClogged:{ booster: { exhClogged: true } },
    ballStuck:        { valve: { stuck: true } },
    springBroken:     { act: { springBroken: true } },
    actLeak:          { act: { leakK: 0.15 } },
    camShift:         { bkv: { camShiftDeg: 8 } },
    namurOpenBreak:   { bkv: { broken: [false, true, false] } }
  };

  // NAMUR (EN 60947-5-6, типовые): датчик демпфирован (флажок перед ним) ≤1.2 мА, не демпфирован ≥2.1 мА;
  // обрыв линии < 0.15 мА, КЗ > 6.5 мА
  const NAMUR = { iDamped: 1.0, iFree: 3.0, iBreak: 0.15, iShort: 6.5 };

  function createEsd(userCfg) {
    const cfg = merge(clone(DEFAULTS), userCfg || {});
    const s = {
      t: 0, acc: 0,
      a: 0, v: 0, moving: 0,
      pPos: 0, pMid: 0, pSig: 0, pAct: 0,
      vEst: 0, aPrev: 0,
      cmdOpen: false, pazTrip: false, maOverride: null,
      pst: null, pstResult: null,
      desired: false, tChange: 0, stroke: null, lastStroke: null, misT: 0,
      out: {}
    };

    function sovState(sv, cmdEnergize) {
      const u = cmdEnergize && !sv.noPower ? sv.uNom : 0;
      const energized = u > sv.uNom * 0.5 && !sv.coilBurnt;
      const pass = sv.stuck ? true : energized;
      return { u, energized, pass };
    }

    function namur(i, damped) {
      if (cfg.bkv.broken[i]) return { i: 0, damped, di: false, fault: 'BREAK' };
      const cur = damped ? NAMUR.iDamped : NAMUR.iFree;
      return { i: cur, damped, di: damped, fault: null };
    }

    function positioner(i, powered, pSupPos, dt) {
      const p = cfg.posit;
      const vRaw = (s.a - s.aPrev) / dt;
      s.aPrev = s.a;
      s.vEst += (vRaw - s.vEst) * Math.min(1, dt / 0.05);
      const w = clamp((i - 4) / 16, 0, 1);
      const r = { w, sp: w, u: -1, mode: 'auto' };
      if (!powered) { r.mode = 'off'; s.pst = null; return r; }
      const noPilot = pSupPos < PILOT_MIN;
      // частичный ход
      if (s.pst) {
        const P = s.pst;
        P.t += dt;
        r.mode = 'pst';
        P.minA = Math.min(P.minA, s.a);
        if (w * 100 < p.cutHi) { endPst(false, 'ABORT'); }
        else if (P.phase === 'down') {
          r.sp = P.target;
          if (s.a <= P.target + 0.01) { P.phase = 'hold'; P.tHold = 0; P.tReach = P.t; }
          else if (P.t > p.pstTimeout) { P.phase = 'up'; P.fail = 'NOT_REACHED'; }
        } else if (P.phase === 'hold') {
          r.sp = P.target;
          P.tHold += dt;
          if (P.tHold >= p.pstHold) P.phase = 'up';
        } else if (P.phase === 'up') {
          r.sp = 1;
          r.u = noPilot ? -1 : 1;
          if (s.a >= 0.97) endPst(!P.fail, P.fail);
          return r;
        }
        if (s.pst) {
          const e = r.sp - s.a;
          r.u = Math.abs(e) * 100 < p.db ? 0 : clamp(p.kp * e - p.kd * s.vEst, -1, 1);
          if (noPilot) r.u = -1;
          return r;
        }
      }
      if (w * 100 <= p.cutLo) { r.u = -1; return r; }
      if (w * 100 >= p.cutHi) { r.u = noPilot ? -1 : 1; return r; }
      const e = w - s.a;
      r.u = Math.abs(e) * 100 < p.db ? 0 : clamp(p.kp * e - p.kd * s.vEst, -1, 1);
      if (noPilot) r.u = -1;
      return r;
    }
    function endPst(ok, err) {
      const P = s.pst;
      s.pstResult = {
        ok: !!ok, error: ok ? null : (err || 'FAIL'),
        target: P.target, minA: P.minA, tReach: P.tReach != null ? P.tReach : null, tTotal: P.t
      };
      s.pst = null;
    }

    function substep(dt) {
      const A = cfg.act, B = cfg.booster, V = cfg.valve, L = cfg.lines, P = cfg.posit;
      const pSup = cfg.fr.blocked ? 0 : Math.max(0, cfg.supply.p);
      const pSupPos = P.supBlocked ? 0 : pSup;
      let i = s.maOverride != null ? s.maOverride : (s.cmdOpen ? 20 : 4);
      if (cfg.loop.broken) i = 0;
      const powered = i >= 3.6;
      const pr = positioner(i, powered, pSupPos, dt);
      const u = pr.u;

      const sr = sovState(cfg.sovR, s.cmdOpen);
      const sp = sovState(cfg.sovP, !s.pazTrip);

      let qRelay = 0;
      if (u > 0) qRelay = P.relayK * u * orifice(pSupPos, s.pPos);
      else if (u < 0) qRelay = P.relayKex * u * orifice(s.pPos, 0);

      const q1 = sr.pass ? cfg.sovR.k * orifice(s.pPos, s.pMid) : 0;
      const ex1 = sr.pass ? 0 : cfg.sovR.kex * orifice(s.pMid, 0);
      const q2 = sp.pass ? cfg.sovP.k * orifice(s.pMid, s.pSig) : 0;
      const ex2 = sp.pass ? 0 : cfg.sovP.kex * orifice(s.pSig, 0);

      const dpb = s.pSig - s.pAct;
      const kex = B.kex * (B.exhClogged ? 0.15 : 1);
      let qB = 0;
      if (dpb > B.db) qB = B.k * clamp((dpb - B.db) / B.span, 0, 1) * orifice(pSup, s.pAct);
      else if (dpb < -B.db) qB = -kex * clamp((-dpb - B.db) / B.span, 0, 1) * orifice(s.pAct, 0);
      const qBy = B.kBypass * clamp(B.bypass, 0, 1) * orifice(s.pSig, s.pAct);
      const qLeak = A.leakK > 0 ? -A.leakK * orifice(s.pAct, 0) : 0;

      const pmax = (x) => Math.max(pSup, x);
      s.pPos = clamp(s.pPos + PATM * (qRelay - q1) * dt / L.vPos, 0, pmax(s.pPos));
      s.pMid = clamp(s.pMid + PATM * (q1 - q2 - ex1) * dt / L.vMid, 0, pmax(s.pMid));
      s.pSig = clamp(s.pSig + PATM * (q2 - qBy - ex2) * dt / L.vSig, 0, pmax(s.pSig));
      const vAct = A.v0 + A.swept * s.a;
      const dV = A.swept * s.v * dt;
      s.pAct = clamp(s.pAct + (PATM * (qB + qBy + qLeak) * dt - (s.pAct + PATM) * dV) / vAct, 0, pmax(s.pAct));

      // механика: воздух открывает, пружины закрывают; трение шара
      const kSpring = A.springBroken ? 0.05 : 1;
      const pSpring = (A.ps0 + (A.ps90 - A.ps0) * s.a) * kSpring;
      const fs = V.stuck ? 3.5 : (s.a < V.seatZone ? V.fsSeat : V.fsRun);
      const fd = V.stuck ? 3.0 : V.fd;
      const net = s.pAct - pSpring;
      if (s.moving === 0) {
        if (net > fs && s.a < 1) s.moving = 1;
        else if (net < -fs && s.a > 0) s.moving = -1;
      }
      if (s.moving !== 0) {
        const drive = net - s.moving * fd;
        if (Math.sign(drive) !== s.moving) { s.moving = 0; s.v = 0; }
        else {
          s.v = drive / A.c;
          s.a += s.v * dt;
          if (s.a <= 0) { s.a = 0; s.moving = 0; s.v = 0; }
          if (s.a >= 1) { s.a = 1; s.moving = 0; s.v = 0; }
        }
      } else s.v = 0;
      s.t += dt;

      // БКВ
      const deg = s.a * 90 - cfg.bkv.camShiftDeg;
      const K = cfg.bkv;
      const sens = [namur(0, deg <= K.thClosed), namur(1, deg >= K.thOpen), namur(2, deg <= K.thPst)];
      const diClosed = sens[0].di, diOpen = sens[1].di;

      // логика РСУ: желаемое положение, время хода, рассогласование
      const desired = s.cmdOpen && !s.pazTrip;
      if (desired !== s.desired) {
        s.desired = desired; s.tChange = s.t; s.misT = 0;
        s.stroke = { dir: desired ? 'open' : 'close', t0: s.t };
      }
      if (s.stroke && ((s.stroke.dir === 'open' && diOpen) || (s.stroke.dir === 'close' && diClosed))) {
        s.lastStroke = { dir: s.stroke.dir, time: s.t - s.stroke.t0 };
        s.stroke = null;
      }
      const atTarget = desired ? diOpen : diClosed;
      s.misT = atTarget ? 0 : s.misT + dt;

      s.out = {
        t: s.t, i, powered, w: pr.w, sp: pr.sp, u, posMode: pr.mode,
        pSup, pSupPos, pPos: s.pPos, pMid: s.pMid, pSig: s.pSig, pAct: s.pAct,
        a: s.a, deg: s.a * 90, v: s.v,
        flowRel: s.a < 0.03 ? 0 : clamp(s.a * s.a, 0, 1),
        qRelay, q1, q2, ex1, ex2, qB, qBy, qLeak,
        sovR: sr, sovP: sp,
        sensors: sens, diClosed, diOpen, diPst: sens[2].di,
        cmdOpen: s.cmdOpen, pazTrip: s.pazTrip, desired, misT: s.misT,
        stroke: s.stroke ? { dir: s.stroke.dir, t: s.t - s.stroke.t0 } : null,
        lastStroke: s.lastStroke,
        pst: s.pst ? { phase: s.pst.phase, t: s.pst.t, target: s.pst.target } : null,
        pstResult: s.pstResult
      };
    }

    function alarms() {
      const o = s.out, list = [];
      if (o.pSup < cfg.act.ps90 + 0.5) list.push('LOW_SUPPLY');
      if (!o.powered) list.push('POS_NO_POWER');
      if (o.pazTrip) list.push('PAZ_TRIP');
      o.sensors.forEach((x, k) => { if (x.fault) list.push('NAMUR_' + k + '_' + x.fault); });
      if (o.diClosed && o.diOpen) list.push('DI_BOTH');
      if (o.misT > cfg.logic.tMis) list.push(o.desired ? 'MIS_OPEN' : 'MIS_CLOSE');
      if (o.pstResult && !o.pstResult.ok) list.push('PST_FAIL');
      return list;
    }
    function snapshot() { return Object.assign({}, s.out, { alarms: alarms() }); }
    function step(dt) {
      s.acc += dt;
      while (s.acc >= DT - 1e-12) { substep(DT); s.acc -= DT; }
      return snapshot();
    }
    function run(seconds, onSample, every) {
      const n = Math.round(seconds / DT);
      const k = every ? Math.max(1, Math.round(every / DT)) : 0;
      for (let j = 0; j < n; j++) {
        substep(DT);
        if (k && onSample && (j + 1) % k === 0) onSample(snapshot());
      }
      return snapshot();
    }
    const api = {
      cfg,
      set(patch) { merge(cfg, patch); return api; },
      applyFault(name) { if (FAULTS[name]) merge(cfg, clone(FAULTS[name])); return api; },
      cmd(open) { s.cmdOpen = !!open; return api; },
      paz(trip) { s.pazTrip = !!trip; return api; },
      setMa(v) { s.maOverride = v == null ? null : clamp(+v, 0, 24); return api; },
      startPst() {
        const o = s.out, p = cfg.posit;
        const ready = o.powered && o.w * 100 >= p.cutHi && s.a >= 0.97 && o.sovR.pass && o.sovP.pass && !s.pst;
        if (!ready) { s.pstResult = { ok: false, error: 'NOT_READY' }; s.out.pstResult = s.pstResult; return false; }
        s.pstResult = null;
        s.pst = { phase: 'down', t: 0, target: 1 - p.pstSize / 100, minA: s.a, tReach: null, fail: null };
        return true;
      },
      step, run, snapshot,
      get state() { return snapshot(); }
    };
    substep(1e-9); s.t = 0; s.out.t = 0;
    return api;
  }

  return { VERSION, DEFAULTS, FAULTS, NAMUR, createEsd };
});
