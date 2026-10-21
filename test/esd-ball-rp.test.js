// C&I Simulator — юнит-тесты модели отсечного клапана ПАЗ (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../units/esd-ball-rp/sim.js');

function opened(cfg) { const s = E.createEsd(cfg); s.cmd(true); s.run(20); return s; }
function timeTo(s, pred, T = 40) {
  const t0 = s.state.t; let t = null;
  s.run(T, (o) => { if (t === null && pred(o)) t = o.t - t0; }, 0.01);
  return t;
}

test('исходно: команды нет → закрыт, ЗАКР=1, ОТКР=0', () => {
  const o = E.createEsd().run(5);
  assert.equal(o.diClosed, true); assert.equal(o.diOpen, false); assert.equal(o.deg, 0);
});

test('ОТКРЫТЬ (РСУ): 20 мА + SOV-РСУ → открыт 90°, ОТКР=1, время хода 1–10 с', () => {
  const s = E.createEsd(); s.cmd(true);
  const t = timeTo(s, (o) => o.diOpen, 20);
  assert.ok(t > 1 && t < 10, `время ${t}`);
  const o = s.state;
  assert.equal(o.deg, 90); assert.equal(o.diClosed, false);
  assert.equal(o.lastStroke.dir, 'open');
  assert.ok(o.sovR.energized && o.sovP.energized);
  assert.ok(o.pSig > 4 && o.pAct > 4, 'сигнал и привод под давлением');
});

test('ПАЗ: обесточен SOV-ПАЗ → закрыт, позиционер при этом ещё выдаёт давление', () => {
  const s = opened(); s.paz(true);
  const t = timeTo(s, (o) => o.diClosed);
  assert.ok(t > 0.5 && t < 10, `время ${t}`);
  const o = s.state;
  assert.equal(o.sovP.pass, false); assert.ok(o.pPos > 4, 'выход позиционера не сброшен');
  assert.ok(o.pSig < 0.05, 'сигнал бустера сброшен');
});

test('ЗАКРЫТЬ (РСУ): закрыт; оба пути сброса — SOV-РСУ и позиционер (4 мА)', () => {
  const s = opened(); s.cmd(false);
  assert.ok(timeTo(s, (o) => o.diClosed) < 10);
  const o = s.state;
  assert.equal(o.i, 4); assert.equal(o.sovR.pass, false); assert.ok(o.pPos < 0.05);
});

test('1oo2: SOV-РСУ залип — ПАЗ всё равно закрывает', () => {
  const s = opened({ sovR: { stuck: true } }); s.paz(true);
  assert.ok(timeTo(s, (o) => o.diClosed) < 10);
});

test('опасный отказ: SOV-ПАЗ залип — ПАЗ не закрывает, рассогласование', () => {
  const s = opened({ sovP: { stuck: true } }); s.paz(true); s.run(20);
  const o = s.state;
  assert.equal(o.deg, 90); assert.ok(o.alarms.includes('MIS_CLOSE'));
});

test('нет воздуха: закрыт при любой команде', () => {
  const s = opened(); s.applyFault('noAir'); s.run(20);
  assert.equal(s.state.deg, 0); assert.ok(s.state.alarms.includes('LOW_SUPPLY'));
});

test('низкое питание: не доходит до ОТКР → рассогласование после 15 с', () => {
  const s = E.createEsd({ supply: { p: 2.9 } }); s.cmd(true); s.run(20);
  const o = s.state;
  assert.ok(o.deg > 30 && o.deg < 87, `угол ${o.deg}`);
  assert.equal(o.diOpen, false); assert.ok(o.alarms.includes('MIS_OPEN'));
});

test('обрыв 4–20 мА позиционера → позиционер сбрасывает → закрыт', () => {
  const s = opened(); s.applyFault('loopBreak'); s.run(20);
  assert.equal(s.state.deg, 0); assert.ok(s.state.alarms.includes('POS_NO_POWER'));
});

test('нет питания катушки SOV-РСУ: 0 В на клеммах, клапан не открывается', () => {
  const s = E.createEsd({ sovR: { noPower: true } }); s.cmd(true); s.run(20);
  const o = s.state;
  assert.equal(o.sovR.u, 0); assert.equal(o.deg, 0); assert.ok(o.alarms.includes('MIS_OPEN'));
});

test('катушка SOV-РСУ сгорела: 24 В есть, но SOV не переключается', () => {
  const s = E.createEsd({ sovR: { coilBurnt: true } }); s.cmd(true); s.run(20);
  const o = s.state;
  assert.equal(o.sovR.u, 24); assert.equal(o.sovR.pass, false); assert.equal(o.deg, 0);
});

test('PST 10 %: отходит к ~81° и возвращается, тест пройден, 3-й датчик сработал', () => {
  const s = opened();
  assert.ok(s.startPst());
  let min = 90, pst3 = false;
  s.run(15, (o) => { min = Math.min(min, o.deg); if (o.diPst) pst3 = true; }, 0.01);
  const r = s.state.pstResult;
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(min < 82 && min > 75, `мин. угол ${min}`);
  assert.ok(pst3); assert.equal(s.state.deg, 90); assert.equal(s.state.diOpen, true);
});

test('PST: не готов, если клапан закрыт', () => {
  const s = E.createEsd(); s.run(2);
  assert.equal(s.startPst(), false); assert.equal(s.state.pstResult.error, 'NOT_READY');
});

test('PST ловит «прикипевший» шар: тест не пройден, и ПАЗ не закрывает', () => {
  const s = opened(); s.applyFault('ballStuck'); s.startPst(); s.run(15);
  assert.equal(s.state.pstResult.error, 'NOT_REACHED');
  s.paz(true); s.run(15);
  assert.equal(s.state.deg, 90);
});

test('сломана пружина: при ПАЗ не закрывается', () => {
  const s = opened({ act: { springBroken: true } }); s.paz(true); s.run(15);
  assert.equal(s.state.deg, 90);
});

test('забит выхлоп бустера: закрытие заметно медленнее', () => {
  const a = opened(); a.paz(true); const t1 = timeTo(a, (o) => o.diClosed);
  const b = opened({ booster: { exhClogged: true } }); b.paz(true); const t2 = timeTo(b, (o) => o.diClosed, 60);
  assert.ok(t2 > 2 * t1, `${t2} vs ${t1}`);
});

test('БКВ: обрыв линии датчика ОТКР → ток 0, авария линии', () => {
  const s = opened({ bkv: { broken: [false, true, false] } });
  const o = s.state;
  assert.equal(o.sensors[1].i, 0); assert.ok(o.alarms.includes('NAMUR_1_BREAK'));
});

test('БКВ: NAMUR токи — демпфирован ≤1.2 мА, свободен ≥2.1 мА', () => {
  const o = opened().state;
  assert.ok(o.sensors[1].i <= 1.2 && o.sensors[0].i >= 2.1);
});

test('сдвинут кулачок → ОТКР не приходит, рассогласование', () => {
  const s = opened({ bkv: { camShiftDeg: 8 } }); s.run(10);
  assert.equal(s.state.deg, 90); assert.equal(s.state.diOpen, false);
  assert.ok(s.state.alarms.includes('MIS_OPEN'));
});

test('детерминизм', () => {
  const tr = () => { const s = E.createEsd(); const a = []; s.cmd(true); s.run(5, (o) => a.push(o.deg, o.pAct), 0.05); s.startPst(); s.run(5, (o) => a.push(o.deg), 0.05); s.paz(true); s.run(5, (o) => a.push(o.deg), 0.05); return JSON.stringify(a); };
  assert.equal(tr(), tr());
});
