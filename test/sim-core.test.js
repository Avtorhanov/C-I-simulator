// C&I Simulator — юнит-тесты sim-core (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/sim-core.js');

function settle(cfg, mA, T = 20) {
  const s = C.createSim(cfg);
  s.setCurrent(mA);
  return { sim: s, o: s.run(T) };
}
const near = (x, y, tol, msg) => assert.ok(Math.abs(x - y) <= tol, `${msg || ''} ожидалось ${y}±${tol}, получено ${x}`);

// ---------- петля ----------
test('петля: 4/12/20 мА → 0/50/100 % хода (lin, НЗ)', () => {
  near(settle({}, 4).o.h * 100, 0, 0.1, '4 мА');
  near(settle({}, 12).o.h * 100, 50, 1, '12 мА');
  near(settle({}, 20).o.h * 100, 100, 0.1, '20 мА');
});

test('петля: 8/16 мА → 25/75 %', () => {
  near(settle({}, 8).o.h * 100, 25, 1);
  near(settle({}, 16).o.h * 100, 75, 1);
});

test('NE43: 3.5 мА → закрыт, позиционер обесточен, отказ «низ»', () => {
  const { o } = settle({}, 3.5);
  assert.equal(o.ne43, 'fail_lo');
  assert.equal(o.powered, false);
  assert.ok(o.alarms.includes('NE43_LO'));
  near(o.h, 0, 0.001);
  near(o.pAct, 0, 0.01);
});

test('NE43: зоны насыщения и отказа «верх»', () => {
  assert.equal(C.ne43(3.7), 'sat_lo');
  assert.equal(C.ne43(12), 'ok');
  assert.equal(C.ne43(20.7), 'sat_hi');
  assert.equal(C.ne43(21.5), 'fail_hi');
  const { o } = settle({}, 21.5);
  assert.ok(o.alarms.includes('NE43_HI'));
  near(o.h, 1, 0.001);
});

test('обрыв петли → I=0, fail-pos (НЗ закрыт)', () => {
  const { sim } = settle({}, 12);
  sim.applyFault('loopBreak');
  const o = sim.run(15);
  assert.equal(o.i, 0);
  assert.ok(o.alarms.includes('LOOP_BREAK'));
  near(o.h, 0, 0.001);
});

test('полярность перепутана → тока нет, закрыт', () => {
  const { o } = settle({ loop: { polarity: true } }, 12);
  assert.equal(o.i, 0);
  near(o.h, 0, 0.001);
});

test('мало U (длинная линия): AO не выдаёт ток, клапан не доходит', () => {
  const { o } = settle({ loop: { rWire: 900 } }, 20);
  assert.ok(o.lowU, 'флаг LOW_U');
  assert.ok(o.i < 20);
  assert.ok(o.h < 0.95, 'не дошёл до 100 %');
});

test('барьер Ex i съедает бюджет петли', () => {
  const ok = settle({ loop: { rWire: 400 } }, 20).o;
  const bar = settle({ loop: { rWire: 400, barrier: true } }, 20).o;
  assert.equal(ok.lowU, false);
  assert.equal(bar.lowU, true);
});

// ---------- позиционер ----------
test('split range 4–12: 8 мА → 50 %', () => {
  near(settle({ posit: { srLo: 4, srHi: 12 } }, 8).o.h * 100, 50, 1);
});

test('обратное действие: 4 мА → 100 %, 20 мА → 0 %', () => {
  near(settle({ posit: { dir: 'dec' } }, 4).o.h, 1, 0.001);
  near(settle({ posit: { dir: 'dec' } }, 20).o.h, 0, 0.001);
});

test('характеристика =%: 12 мА → уставка ≈12.4 %', () => {
  const { o } = settle({ posit: { char: 'eqp' } }, 12);
  near(o.sp * 100, 12.4, 0.1);
  near(o.h * 100, 12.4, 1);
});

test('отсечка 1 %: 4.1 мА → плотное закрытие, камера сброшена', () => {
  const { o } = settle({}, 4.1);
  assert.equal(o.cut, 'lo');
  near(o.pAct, 0, 0.01);
  near(o.h, 0, 0.001);
});

// ---------- привод / fail-safe ----------
test('Pпит = 0 → fail (НЗ закрыт) даже при 20 мА', () => {
  const { sim } = settle({}, 20);
  sim.applyFault('noAir');
  const o = sim.run(15);
  near(o.h, 0, 0.001);
  assert.ok(o.alarms.includes('LOW_SUPPLY'));
});

test('ВЗ (НО): 4 мА → закрыт, потеря воздуха → открыт', () => {
  const cfg = { posit: { act: 'ATC' }, act: { type: 'ATC' } };
  const { sim, o } = settle(cfg, 4);
  near(o.h, 0, 0.001);
  near(settle(cfg, 12).o.h * 100, 50, 1);
  sim.applyFault('noAir');
  near(sim.run(15).h, 1, 0.001);
});

test('привод перевёрнут (позиционер ATO, привод ATC) → инверсия и не тот fail-safe', () => {
  const { sim, o } = settle({ act: { type: 'ATC' } }, 20);
  near(o.h, 0, 0.001);
  sim.applyFault('noAir');
  near(sim.run(15).h, 1, 0.001, 'при потере воздуха открылся');
});

test('сломана пружина → при сбросе воздуха шток остаётся', () => {
  const { sim } = settle({}, 12);
  sim.applyFault('springBroken');
  sim.applyFault('noAir');
  const o = sim.run(15);
  assert.ok(o.h > 0.3, 'не вернулся в fail-pos');
});

test('разрыв мембраны → не держит, клапан не открывается', () => {
  const { o } = settle({ act: { leakK: 3 } }, 20);
  assert.ok(o.h < 0.5);
});

test('перетянут сальник: на рампе ход идёт рывками (stick-slip)', () => {
  function jumps(cfg) {
    const s = C.createSim(cfg);
    s.setCurrent(4); s.run(5);
    s.setMode('man');
    let prev = s.state.a, maxJump = 0, stuckSteps = 0;
    for (let k = 0; k < 600; k++) {
      s.setManual(0.03);
      const o = s.run(0.05);
      const d = o.a - prev;
      if (d < 1e-6) stuckSteps++;
      maxJump = Math.max(maxJump, d);
      prev = o.a;
      if (o.a >= 0.99) break;
    }
    return { maxJump, stuckSteps };
  }
  const n = jumps({}), t = jumps({ act: { fs: 0.25, fd: 0.15 } });
  assert.ok(t.maxJump > 3 * n.maxJump, `рывок ${t.maxJump} vs ${n.maxJump}`);
  assert.ok(t.stuckSteps > n.stuckSteps);
});

// ---------- AUTO-инициализация ----------
test('init AUTO: успех, угол и время хода определены', () => {
  const s = C.createSim({ posit: { calibrated: false } });
  s.setCurrent(12);
  assert.equal(s.state.mode, 'nocal');
  s.startInit();
  let o = s.run(60);
  assert.equal(o.mode, 'auto');
  assert.ok(o.initResult.ok, o.initResult.error);
  near(o.initResult.sweepDeg, 60, 1);
  assert.ok(o.initResult.tUp > 0.3 && o.initResult.tUp < 10);
  assert.ok(o.initResult.tDown > 0.3 && o.initResult.tDown < 10);
  o = s.run(20);
  near(o.h * 100, 50, 1, 'после init 12 мА → 50 %');
});

test('init AUTO: палец рычага не на той метке → малый угол', () => {
  const s = C.createSim({ posit: { calibrated: false }, lever: { markMm: 120 } });
  s.setCurrent(12); s.startInit();
  const o = s.run(60);
  assert.equal(o.initResult.ok, false);
  assert.equal(o.initResult.error, 'ANGLE_SMALL');
  assert.equal(o.mode, 'nocal');
});

test('init AUTO: палец на слишком малой метке → угол вне диапазона', () => {
  const s = C.createSim({ posit: { calibrated: false }, lever: { markMm: 10 } });
  s.setCurrent(12); s.startInit();
  assert.equal(s.run(60).initResult.error, 'ANGLE_RANGE');
});

test('init AUTO: нет воздуха → нет движения', () => {
  const s = C.createSim({ posit: { calibrated: false }, supply: { p: 0 } });
  s.setCurrent(12); s.startInit();
  assert.equal(s.run(80).initResult.error, 'NO_MOVE');
});

test('init AUTO: без тока петли не стартует', () => {
  const s = C.createSim({ posit: { calibrated: false } });
  s.setCurrent(3); s.startInit();
  assert.equal(s.run(1).initResult.error, 'NO_POWER');
});

// ---------- бустер ----------
function strokeT90(cfg) {
  const s = C.createSim(cfg);
  s.setCurrent(4); s.run(10); s.setCurrent(20);
  let t = null;
  s.run(20, (o) => { if (t === null && o.h > 0.9) t = o.t - 10; }, 0.01);
  return t;
}
function stepStats(cfg) {
  const s = C.createSim(cfg);
  s.setCurrent(10.4); s.run(15); s.setCurrent(13.6);
  const arr = [];
  s.run(20, (o) => arr.push(o.h), 0.01);
  const tail = arr.slice(-500);
  return { over: Math.max(...arr) - 0.6, ripple: Math.max(...tail) - Math.min(...tail) };
}

test('бустер: полный ход быстрее, чем без бустера', () => {
  const t0 = strokeT90({}), t1 = strokeT90({ booster: { present: true } });
  assert.ok(t1 < t0 / 2, `с бустером ${t1} c, без ${t0} c`);
});

test('бустер: байпас закрыт → рысканье, настроен → устойчиво', () => {
  const closed = stepStats({ booster: { present: true, bypass: 0 } });
  const tuned = stepStats({ booster: { present: true, bypass: 0.4 } });
  assert.ok(closed.ripple > 0.03, `рысканье ${closed.ripple}`);
  assert.ok(tuned.ripple < 0.005);
  assert.ok(closed.over > tuned.over);
});

// ---------- SOV ----------
test('SOV обесточен → сброс, клапан закрыт при 20 мА', () => {
  const { sim } = settle({ sov: { present: true } }, 20);
  near(sim.state.h, 1, 0.001);
  sim.set({ sov: { energized: false } });
  const o = sim.run(10);
  assert.ok(o.sovVent);
  near(o.h, 0, 0.001);
  sim.set({ sov: { energized: true } });
  near(sim.run(10).h, 1, 0.001, 'после подачи напряжения открылся');
});

test('SOV не срабатывает → клапан остаётся открытым', () => {
  const { sim } = settle({ sov: { present: true, stuck: true } }, 20);
  sim.set({ sov: { energized: false } });
  near(sim.run(10).h, 1, 0.001);
});

test('SOV + бустер: сброс работает', () => {
  const { sim } = settle({ sov: { present: true }, booster: { present: true } }, 20);
  sim.set({ sov: { energized: false } });
  near(sim.run(10).h, 0, 0.001);
});

// ---------- клапан, единицы, детерминизм ----------
test('затвор: lin 50 % → 0.5; =% 50 % → ≈0.124; закрыт → 0', () => {
  near(C.charFn('lin', 0.5), 0.5, 1e-9);
  near(C.charFn('eqp', 0.5, 50), 0.1237, 0.001);
  near(C.charInv('eqp', C.charFn('eqp', 0.3, 50), 50), 0.3, 1e-9);
  assert.equal(settle({}, 4).o.flowRel, 0);
});

test('единицы давления: 4.5 бар → кгс/см², кПа, МПа', () => {
  assert.equal(C.fmtP(4.5, 'bar'), '4.50 бар');
  assert.equal(C.fmtP(4.5, 'kgf'), '4.59 кгс/см²');
  assert.equal(C.fmtP(4.5, 'kPa'), '450 кПа');
  assert.equal(C.fmtP(4.5, 'MPa'), '0.450 МПа');
});

test('детерминизм: два прогона совпадают побитно', () => {
  function trace() {
    const s = C.createSim({ booster: { present: true, bypass: 0 }, lever: { backlash: 0.02 } });
    const out = [];
    s.setCurrent(4); s.run(3);
    s.setCurrent(17.3);
    s.run(8, (o) => out.push(o.h, o.pAct, o.pSig), 0.05);
    return JSON.stringify(out);
  }
  assert.equal(trace(), trace());
});

test('step(dt) с дробными кадрами = run() того же времени', () => {
  const a = C.createSim(), b = C.createSim();
  a.setCurrent(15); b.setCurrent(15);
  for (let k = 0; k < 300; k++) a.step(1 / 60);
  const ob = b.run(5);
  near(a.state.t, ob.t, 0.0011);
  near(a.state.h, ob.h, 0.002);
});
