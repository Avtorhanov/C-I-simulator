/* C&I Simulator — разрезы деталей отсечного узла: механизм в работе (живой режим) + ▶ демо срабатывания.
 * Каждая деталь: svg-разметка (id с префиксом x-), live(o) → состояние, demo(t∈0..1) → состояние, draw().
 * Демо делится на половины: 0–0.5 «включение / открытие», 0.5–1 «отключение / закрытие».
 * Схемы обобщённые (типовые), без копии конструкции конкретного производителя.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const pOp = (p) => Math.sqrt(clamp(p / 6, 0, 1));
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

  function zigV(x, y1, y2, n, amp) {
    const pts = [x + ',' + y1.toFixed(1)], st = (y2 - y1) / (n * 2);
    for (let k = 1; k < n * 2; k++) pts.push((x + (k % 2 ? amp : -amp)) + ',' + (y1 + k * st).toFixed(1));
    pts.push(x + ',' + y2.toFixed(1));
    return pts.join(' ');
  }
  function zigH(x1, x2, y, n, amp) {
    const pts = [x1.toFixed(1) + ',' + y], st = (x2 - x1) / (n * 2);
    for (let k = 1; k < n * 2; k++) pts.push((x1 + k * st).toFixed(1) + ',' + (y + (k % 2 ? -amp : amp)));
    pts.push(x2.toFixed(1) + ',' + y);
    return pts.join(' ');
  }
  function flow(el, A, key, on, speed, dt) {
    if (!el) return;
    A[key] = (A[key] || 0) - (on ? speed : 0) * dt;
    el.setAttribute('stroke-dashoffset', A[key].toFixed(1));
    el.setAttribute('opacity', on ? '1' : '0');
  }
  function needle(el, cx, cy, r, p) {
    const a = (-135 + clamp(p / 10, 0, 1) * 270) * Math.PI / 180;
    el.setAttribute('x2', (cx + r * Math.sin(a)).toFixed(2));
    el.setAttribute('y2', (cy - r * Math.cos(a)).toFixed(2));
  }
  // Шар с отверстием в «прозрачном» корпусе: вращение вокруг вертикального штока.
  // Ось отверстия при θ=0 смотрит на зрителя (кран закрыт), при θ=90° — вдоль трубы (открыт).
  function ball3d(cx, cy, R, rb, deg) {
    const th = deg * Math.PI / 180, s = Math.sin(th), c = Math.cos(th);
    const xf = cx - R * s, xb = cx + R * s, rx = Math.max(0.01, rb * c);
    const tun = `M${xf.toFixed(2)},${cy - rb} L${xb.toFixed(2)},${cy - rb} A${rx.toFixed(2)},${rb} 0 0 1 ${xb.toFixed(2)},${cy + rb} L${xf.toFixed(2)},${cy + rb} A${rx.toFixed(2)},${rb} 0 0 1 ${xf.toFixed(2)},${cy - rb} Z`;
    const mer = [];
    for (let k = 0; k < 4; k++) {
      const a = th + (k * 45 + 22.5) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      if (ca <= 0.02) { mer.push({ d: '', op: 0 }); continue; }
      const mrx = Math.max(0.01, R * Math.abs(sa));
      mer.push({ d: `M${cx},${cy - R} A${mrx.toFixed(2)},${R} 0 0 ${sa > 0 ? 0 : 1} ${cx},${cy + R}`, op: 0.12 + 0.45 * ca });
    }
    return { tun, xf, rx, rimOp: 0.55 * c, mer };
  }
  window.CIBall3d = ball3d;

  const D = {};

  // ---------------- SOV 3/2 ----------------
  D.sov = {
    title: (c) => (c.which === 'P' ? 'SOV-ПАЗ · клапан 3/2' : 'SOV-РСУ · клапан 3/2'),
    dur: 9,
    phases: [
      [0, 0.1, 'Катушка обесточена: пружина прижимает якорь к седлу P. Вход закрыт, выход A соединён со сбросом R.'],
      [0.1, 0.25, 'Подано напряжение: ток в катушке создаёт магнитное поле, якорь втягивается к сердечнику.'],
      [0.25, 0.5, 'Якорь наверху: седло P открыто, верхнее седло R закрыто — воздух идёт P → A.'],
      [0.5, 0.62, 'Напряжение снято: поля нет, пружина возвращает якорь на седло P.'],
      [0.62, 1, 'Вход P закрыт, воздух из выхода A уходит через канал сердечника в сброс R.']
    ],
    svg: `
      <rect class="metal" x="30" y="128" width="260" height="56" rx="6"/>
      <path class="dch" d="M160,136 V164 H290"/><path id="x-chP" class="dchp" d="M160,136 V164 H290"/>
      <path class="dch" d="M138,140 H30"/><path id="x-chA" class="dchp" d="M138,140 H30"/>
      <rect class="dev" x="96" y="8" width="128" height="124" rx="10"/>
      <rect id="x-coilL" x="104" y="26" width="30" height="86" rx="3" stroke="var(--metal-ink)" stroke-width=".8"/>
      <rect id="x-coilR" x="186" y="26" width="30" height="86" rx="3" stroke="var(--metal-ink)" stroke-width=".8"/>
      <g id="x-wind" stroke="var(--metal-ink)" stroke-width=".5" opacity=".45"></g>
      <path id="x-flux" d="M119,24 C119,0 201,0 201,24 M119,114 C119,138 201,138 201,114" fill="none" stroke="var(--wire)" stroke-width="1.5" stroke-dasharray="3 3" opacity="0"/>
      <rect class="cut" x="138" y="20" width="44" height="124"/>
      <rect class="metal-d" x="141" y="22" width="38" height="44"/>
      <rect x="157" y="0" width="6" height="66" fill="var(--panel)"/>
      <path id="x-chR" class="dchp" d="M160,66 V0" style="stroke-width:5"/>
      <polyline id="x-spr" class="dspr" points=""/>
      <g id="x-plg"><rect class="metal" x="143" y="0" width="34" height="46" rx="2"/><rect x="154" y="0" width="12" height="3" fill="var(--ink)"/><rect x="151" y="43" width="18" height="3" fill="var(--ink)"/><rect x="156" y="3" width="8" height="17" fill="var(--panel)"/></g>
      <rect class="metal-d" x="140" y="136" width="17" height="4"/><rect class="metal-d" x="163" y="136" width="17" height="4"/>
      <path id="x-fPA" class="dfl" d="M290,164 H160 V140 H30"/>
      <path id="x-fAR" class="dfl" d="M30,140 H160 V2"/>
      <text class="dv" id="x-u" x="10" y="22">0 В</text><text class="dl" x="10" y="32">на клеммах</text>
      <text class="dv" id="x-st" x="10" y="56">A→R</text><text class="dl" x="10" y="66">путь воздуха</text>
      <text class="dl" id="x-lP" x="196" y="158">P · вход</text><text class="dv" id="x-pP" x="226" y="180">0.00</text>
      <text class="dl" id="x-lA" x="34" y="134">A · выход</text><text class="dv" id="x-pA" x="34" y="180">0.00</text>
      <text class="dl" x="166" y="7">R · сброс</text>
      <text class="dl" x="228" y="40">сердечник</text><text class="dl" x="228" y="80">пружина</text>
      <text class="dl" x="228" y="104">якорь</text><text class="dl" x="228" y="122">катушка</text><text class="dl" x="182" y="150">седло P</text>`,
    init(q) {
      const g = q('x-wind');
      for (let y = 30; y <= 108; y += 5) {
        for (const x of [104, 186]) { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x); l.setAttribute('x2', x + 30); l.setAttribute('y1', y); l.setAttribute('y2', y); g.appendChild(l); }
      }
    },
    demo(t) {
      const u = t >= 0.1 && t < 0.5 ? 24 : 0;
      const pos = t < 0.1 ? 0 : t < 0.2 ? ramp(t, 0.1, 0.2) : t < 0.5 ? 1 : t < 0.56 ? 1 - ramp(t, 0.5, 0.56) : 0;
      const pout = t < 0.25 ? 0 : t < 0.5 ? 4.5 * ramp(t, 0.25, 0.42) : t < 0.62 ? 4.5 : 4.5 * (1 - ramp(t, 0.62, 0.85));
      return { u, energized: u > 0, pos, pin: 4.5, pout, fPA: t >= 0.25 && t < 0.45, fAR: t >= 0.62 && t < 0.88 };
    },
    live(o, c) {
      const P = c.which === 'P', s = P ? o.sovP : o.sovR;
      return { u: s.u, energized: s.energized, posT: s.pass ? 1 : 0, pin: P ? o.pMid : o.pPos, pout: P ? o.pSig : o.pMid,
        fPA: (P ? o.q2 : o.q1) > 0.004, fAR: (P ? o.ex2 : o.ex1) > 0.003, stuck: s.pass && !s.energized };
    },
    draw(q, st, dt, A, c) {
      let pos = st.pos;
      if (pos == null) { A.pos = A.pos == null ? st.posT : A.pos + (st.posT - A.pos) * Math.min(1, dt / 0.06); pos = A.pos; }
      const Y = 90 - 24 * pos;
      q('x-plg').setAttribute('transform', `translate(0,${Y.toFixed(2)})`);
      q('x-spr').setAttribute('points', zigV(160, 66, Y + 19, 5, 3));
      const coil = st.energized ? 'var(--wire)' : 'var(--steel)';
      for (const id of ['x-coilL', 'x-coilR']) { q(id).setAttribute('fill', coil); q(id).setAttribute('fill-opacity', st.energized ? '.55' : st.u > 0 ? '.25' : '.2'); }
      q('x-flux').setAttribute('opacity', st.energized ? '1' : '0');
      flow(q('x-flux'), A, 'flux', st.energized, 10, dt);
      q('x-chP').setAttribute('opacity', (0.08 + 0.9 * pOp(st.pin)).toFixed(2));
      q('x-chA').setAttribute('opacity', (0.08 + 0.9 * pOp(st.pout)).toFixed(2));
      q('x-chR').setAttribute('opacity', st.fAR ? '.6' : '0');
      flow(q('x-fPA'), A, 'pa', st.fPA, 26, dt);
      flow(q('x-fAR'), A, 'ar', st.fAR, 26, dt);
      q('x-u').textContent = st.u.toFixed(0) + ' В';
      q('x-st').textContent = (pos > 0.5 ? 'P→A' : 'A→R') + (st.stuck ? ' (залип)' : '');
      q('x-pP').textContent = c.fmtP(st.pin); q('x-pA').textContent = c.fmtP(st.pout);
      q('x-lP').textContent = c.which === 'P' ? 'P · от SOV-РСУ' : 'P · от позиционера';
      q('x-lA').textContent = c.which === 'P' ? 'A · сигнал бустера' : 'A · к SOV-ПАЗ';
    }
  };

  // ---------------- Бустер ----------------
  D.booster = {
    title: () => 'Бустер 1:1',
    dur: 9,
    phases: [
      [0, 0.1, 'Равновесие: давление сигнала равно давлению на выходе, оба клапана закрыты.'],
      [0.1, 0.38, 'Сигнал вырос: мембраны давят вниз, шток отжимает тарелку — большой расход из питания идёт в привод.'],
      [0.38, 0.5, 'Выход догнал сигнал: пружина прижимает тарелку, подача закрыта.'],
      [0.5, 0.82, 'Сигнал сброшен (SOV): мембраны поднимаются, полый шток отходит от тарелки — воздух из привода уходит через шток в выхлоп с сеткой.'],
      [0.82, 1, 'Привод стравлен: снова равновесие.']
    ],
    svg: `
      <path class="dch" d="M160,0 V22"/><path id="x-chS" class="dchp" d="M160,0 V22"/>
      <path class="dch" d="M0,156 H70"/><path id="x-chI" class="dchp" d="M0,156 H70"/>
      <path class="dch" d="M250,106 H320"/><path id="x-chO" class="dchp" d="M250,106 H320"/>
      <path class="dch" d="M250,68 H300"/>
      <rect class="metal" x="60" y="12" width="200" height="176" rx="10"/>
      <rect class="cut" x="78" y="20" width="164" height="28"/><rect id="x-sigA" x="78" y="20" width="164" height="28" fill="var(--air)"/>
      <rect class="cut" x="78" y="54" width="164" height="28"/>
      <rect class="cut" x="78" y="90" width="164" height="34"/><rect id="x-outA" x="78" y="90" width="164" height="34" fill="var(--air)"/>
      <rect class="cut" x="78" y="129" width="164" height="52"/><rect id="x-supA" x="78" y="129" width="164" height="52" fill="var(--air)"/>
      <rect x="284" y="58" width="8" height="20" fill="none" stroke="var(--metal-ink)" stroke-dasharray="1.5 1.5"/>
      <path class="dch" d="M78,32 H66 V106 H78" style="stroke-width:4"/><circle id="x-ndl" cx="66" cy="70" r="5" class="metal-d"/>
      <rect class="metal-d" x="78" y="124" width="72" height="5"/><rect class="metal-d" x="170" y="124" width="72" height="5"/>
      <g id="x-pop"><rect class="metal" x="144" y="129" width="32" height="9" rx="2"/></g>
      <polyline id="x-pspr" class="dspr" points=""/>
      <g id="x-dia">
        <line x1="70" y1="50" x2="250" y2="50" stroke="var(--ink)" stroke-width="2.6"/>
        <line x1="70" y1="86" x2="250" y2="86" stroke="var(--ink)" stroke-width="2.6"/>
        <rect x="148" y="46" width="24" height="8" class="metal-d"/><rect x="148" y="82" width="24" height="8" class="metal-d"/>
        <rect x="154" y="50" width="12" height="77" class="metal-d"/><rect x="158" y="58" width="4" height="69" fill="var(--panel)"/>
        <rect x="153" y="62" width="6" height="4" fill="var(--panel)"/>
      </g>
      <path id="x-fSig" class="dfl" d="M160,0 V36"/>
      <path id="x-fSup" class="dfl" d="M0,156 H160 V128 V106 H320"/>
      <path id="x-fExh" class="dfl" d="M320,106 H160 V64 H300"/>
      <path id="x-fByp" class="dfl" d="M78,32 H66 V106 H78"/>
      <text class="dl" x="166" y="10">сигнал (через SOV)</text><text class="dv" id="x-tS" x="84" y="40">0.00</text>
      <text class="dl" x="84" y="66">выхлоп →</text><text class="dl" x="262" y="56">сетка</text>
      <text class="dl" x="250" y="100">→ привод</text><text class="dv" id="x-tO" x="84" y="116">0.00</text>
      <text class="dl" x="4" y="150">питание</text><text class="dv" id="x-tI" x="84" y="176">0.00</text>
      <text class="dl" x="178" y="44">мембраны</text><text class="dl" x="178" y="78">полый шток</text>
      <text class="dl" x="182" y="142">тарелка питания</text><text class="dl" x="2" y="82">игла</text><text class="dl" x="2" y="90">байпаса</text>`,
    demo(t) {
      const sig = t < 0.1 ? 0 : t < 0.5 ? 4.5 * ramp(t, 0.1, 0.16) : t < 0.56 ? 4.5 * (1 - ramp(t, 0.5, 0.56)) : 0;
      const out = t < 0.12 ? 0 : t < 0.5 ? 4.5 * ramp(t, 0.13, 0.38) : t < 0.56 ? 4.5 : 4.5 * (1 - ramp(t, 0.56, 0.82));
      const d = clamp((sig - out) / 0.3, -1, 1);
      return { sig, out, sup: 4.5, d, qB: d > 0.3 ? 1 : d < -0.3 ? -1 : 0, qBy: 0, fSig: (t > 0.1 && t < 0.16) || (t > 0.5 && t < 0.56) };
    },
    live(o) {
      return { sig: o.pSig, out: o.pAct, sup: o.pSup, d: clamp((o.pSig - o.pAct) / 0.3, -1, 1), qB: o.qB, qBy: o.qBy, fSig: Math.abs(o.q2 - o.ex2) > 0.004 };
    },
    draw(q, st, dt, A, c) {
      A.d = A.d == null ? st.d : A.d + (st.d - A.d) * Math.min(1, dt / 0.05);
      const d = A.d, dy = 4 * d;
      q('x-dia').setAttribute('transform', `translate(0,${dy.toFixed(2)})`);
      const py = d > 0.25 ? 3 + 5 * (d - 0.25) / 0.75 : 0;
      q('x-pop').setAttribute('transform', `translate(0,${py.toFixed(2)})`);
      q('x-pspr').setAttribute('points', zigV(160, 138 + py, 182, 4, 5));
      q('x-sigA').setAttribute('opacity', (0.06 + 0.8 * pOp(st.sig)).toFixed(2));
      q('x-outA').setAttribute('opacity', (0.06 + 0.8 * pOp(st.out)).toFixed(2));
      q('x-supA').setAttribute('opacity', (0.06 + 0.8 * pOp(st.sup)).toFixed(2));
      q('x-chS').setAttribute('opacity', (0.08 + 0.9 * pOp(st.sig)).toFixed(2));
      q('x-chI').setAttribute('opacity', (0.08 + 0.9 * pOp(st.sup)).toFixed(2));
      q('x-chO').setAttribute('opacity', (0.08 + 0.9 * pOp(st.out)).toFixed(2));
      flow(q('x-fSup'), A, 'sup', st.qB > 0.01, 30, dt);
      flow(q('x-fExh'), A, 'exh', st.qB < -0.01, 30, dt);
      flow(q('x-fSig'), A, 'sig', st.fSig, 22, dt);
      flow(q('x-fByp'), A, 'byp', Math.abs(st.qBy) > 0.01, 14 * Math.sign(st.qBy || 1), dt);
      q('x-tS').textContent = 'сигнал ' + c.fmtP(st.sig);
      q('x-tO').textContent = 'выход ' + c.fmtP(st.out);
      q('x-tI').textContent = 'питание ' + c.fmtP(st.sup);
    }
  };

  // ---------------- Позиционер ----------------
  D.pos = {
    title: () => 'Позиционер',
    dur: 10,
    phases: [
      [0, 0.08, '4 мА: задание 0 %, кран закрыт, выход OUT сброшен.'],
      [0.08, 0.18, 'РСУ даёт 20 мА: процессор видит рассогласование «задание − положение».'],
      [0.18, 0.36, 'I/P прижимает заслонку к соплу: растёт управляющее давление, реле открывает подачу — давление OUT растёт.'],
      [0.36, 0.5, 'Кран поворачивается, датчик угла сообщает положение. 100 % — реле держит полное давление (отсечка).'],
      [0.5, 0.6, 'РСУ даёт 4 мА: заслонка отходит от сопла, управляющее давление падает.'],
      [0.6, 0.9, 'Реле открывает выхлоп: OUT сбрасывается, кран закрывается, датчик угла идёт к 0 %.'],
      [0.9, 1, 'Закрыто: задание и положение совпали.']
    ],
    svg: `
      <rect class="dev" x="4" y="6" width="312" height="190" rx="10"/>
      <rect class="metal" x="12" y="16" width="52" height="38" rx="3"/>
      <circle cx="26" cy="30" r="5" fill="var(--panel)" stroke="var(--metal-ink)"/><circle cx="50" cy="30" r="5" fill="var(--panel)" stroke="var(--metal-ink)"/>
      <text class="dl" x="23" y="47">+</text><text class="dl" x="47" y="47">−</text>
      <text class="dv" id="x-ma" x="12" y="68">4.0 мА</text><text class="dl" x="12" y="78">вход от РСУ</text>
      <path id="x-w1" d="M64,34 H78" stroke="var(--wire)" stroke-width="2" fill="none"/>
      <rect x="78" y="16" width="88" height="62" rx="4" fill="var(--ok)" fill-opacity=".1" stroke="var(--ok)"/>
      <text class="dl" x="84" y="27">процессор</text>
      <text class="dv" id="x-w" x="84" y="42">зад. 0.0 %</text><text class="dv" id="x-x" x="84" y="56">пол. 0.0 %</text><text class="dv" id="x-e" x="84" y="70">Δ 0.0 %</text>
      <path id="x-w2" d="M166,34 H182" stroke="var(--wire)" stroke-width="2" fill="none"/>
      <rect x="182" y="16" width="54" height="62" rx="4" fill="none" stroke="var(--metal-ink)"/>
      <rect id="x-ipc" x="188" y="22" width="14" height="22" rx="2" fill="none" stroke="var(--wire)" stroke-width="1.6"/>
      <line id="x-flap" x1="194" y1="52" x2="230" y2="52" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="194" cy="52" r="2.4" fill="var(--metal-ink)"/>
      <rect class="metal-d" x="219" y="58" width="8" height="12"/>
      <text class="dl" x="182" y="88">I/P: заслонка–сопло</text>
      <path class="dch" d="M223,70 V100 H246" style="stroke-width:4"/><path id="x-chPil" class="dchp" d="M223,70 V100 H246" style="stroke-width:4"/>
      <path class="dch" d="M300,196 V186 H240 V64 H227" style="stroke-width:2"/>
      <rect class="metal" x="246" y="88" width="62" height="96" rx="4"/>
      <rect class="cut" x="252" y="94" width="50" height="12"/><rect id="x-pilA" x="252" y="94" width="50" height="12" fill="var(--air)"/>
      <line id="x-rdia" x1="250" y1="109" x2="304" y2="109" stroke="var(--ink)" stroke-width="2.2"/>
      <rect class="cut" x="252" y="112" width="50" height="30"/><rect id="x-outA" x="252" y="112" width="50" height="30" fill="var(--air)"/>
      <rect class="cut" x="252" y="150" width="50" height="28"/><rect id="x-supA" x="252" y="150" width="50" height="28" fill="var(--air)"/>
      <rect class="metal-d" x="252" y="143" width="20" height="4"/><rect class="metal-d" x="282" y="143" width="20" height="4"/>
      <rect id="x-rsup" class="metal" x="268" y="146" width="18" height="6" rx="1"/>
      <rect id="x-rexh" class="metal-d" x="274" y="108" width="6" height="28"/>
      <path class="dch" d="M308,124 H320"/><path id="x-chO" class="dchp" d="M308,124 H320"/>
      <path class="dch" d="M277,196 V178"/>
      <path id="x-fSup" class="dfl" d="M277,196 V146 V124 H320"/>
      <path id="x-fExh" class="dfl" d="M320,124 H277 V100 H240"/>
      <path id="x-pExh" class="puff" d="M240,100 H226"/>
      <text class="dl" x="282" y="84">реле</text><text class="dl" x="286" y="120">OUT</text><text class="dl" x="282" y="194">SUP</text>
      <circle cx="62" cy="146" r="32" class="metal"/>
      <line id="x-fb" x1="62" y1="146" x2="62" y2="118" stroke="var(--alarm)" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="62" cy="146" r="4" fill="var(--metal-ink)"/>
      <text class="dl" x="12" y="190">датчик угла (обратная связь)</text>
      <text class="dv" id="x-ang" x="100" y="150">0°</text>
      <path id="x-w3" d="M62,114 V96 H110 V78" stroke="var(--wire)" stroke-width="1.6" fill="none"/>
      <circle cx="152" cy="148" r="18" fill="var(--panel)" stroke="var(--metal-ink)"/><line id="x-gS" x1="152" y1="148" x2="152" y2="134" stroke="var(--alarm)" stroke-width="1.6"/>
      <circle cx="200" cy="148" r="18" fill="var(--panel)" stroke="var(--metal-ink)"/><line id="x-gO" x1="200" y1="148" x2="200" y2="134" stroke="var(--alarm)" stroke-width="1.6"/>
      <text class="dl" x="141" y="178">SUP</text><text class="dl" x="189" y="178">OUT</text>
      <text class="dv" id="x-tS" x="132" y="124">0.0</text><text class="dv" id="x-tO" x="184" y="124">0.0</text>`,
    demo(t) {
      const ma = t < 0.08 ? 4 : t < 0.5 ? 20 : t < 0.52 ? 20 - 16 * ramp(t, 0.5, 0.52) : 4;
      const x = t < 0.3 ? 0 : t < 0.5 ? ramp(t, 0.3, 0.46) : t < 0.62 ? 1 : 1 - ramp(t, 0.62, 0.88);
      const u = t < 0.08 ? -1 : t < 0.18 ? 0.2 : t < 0.5 ? 1 : -1;
      const out = t < 0.2 ? 0 : t < 0.5 ? 4.5 * ramp(t, 0.2, 0.32) : 4.5 * (1 - ramp(t, 0.52, 0.66));
      return { ma, w: (ma - 4) / 16, x, u, out, sup: 4.5, qOn: t > 0.2 && t < 0.34, qEx: t > 0.52 && t < 0.68, powered: true };
    },
    live(o) {
      return { ma: o.i, w: o.sp, x: o.a, u: o.u, out: o.pPos, sup: o.pSupPos, qOn: o.qRelay > 0.005, qEx: o.qRelay < -0.005, powered: o.powered };
    },
    draw(q, st, dt, A, c) {
      A.u = A.u == null ? st.u : A.u + (st.u - A.u) * Math.min(1, dt / 0.08);
      const u = A.u;
      q('x-ma').textContent = f1(st.ma) + ' мА';
      q('x-w').textContent = 'зад. ' + f1(st.w * 100) + ' %';
      q('x-x').textContent = 'пол. ' + f1(st.x * 100) + ' %';
      q('x-e').textContent = 'Δ ' + f1((st.w - st.x) * 100) + ' %';
      const live = st.powered ? 'var(--wire)' : 'var(--steel)';
      for (const id of ['x-w1', 'x-w2', 'x-w3']) q(id).setAttribute('stroke', live);
      q('x-ipc').setAttribute('stroke', live);
      q('x-flap').setAttribute('transform', `rotate(${(u * 7).toFixed(2)} 194 52)`);
      const pil = (u + 1) / 2;
      q('x-pilA').setAttribute('opacity', (0.08 + 0.8 * pil).toFixed(2));
      q('x-chPil').setAttribute('opacity', (0.08 + 0.8 * pil).toFixed(2));
      q('x-rdia').setAttribute('transform', `translate(0,${(u * 3).toFixed(2)})`);
      q('x-rsup').setAttribute('transform', `translate(0,${u > 0.05 ? 4 : 0})`);
      q('x-rexh').setAttribute('transform', `translate(0,${(u * 3 + (u < -0.05 ? -5 : 0)).toFixed(2)})`);
      q('x-outA').setAttribute('opacity', (0.06 + 0.8 * pOp(st.out)).toFixed(2));
      q('x-supA').setAttribute('opacity', (0.06 + 0.8 * pOp(st.sup)).toFixed(2));
      q('x-chO').setAttribute('opacity', (0.08 + 0.9 * pOp(st.out)).toFixed(2));
      flow(q('x-fSup'), A, 'sup', st.qOn, 26, dt);
      flow(q('x-fExh'), A, 'exh', st.qEx, 26, dt);
      flow(q('x-pExh'), A, 'pex', st.qEx, 30, dt);
      const a = (-90 + st.x * 90) * Math.PI / 180;
      q('x-fb').setAttribute('x2', (62 + 28 * Math.cos(a)).toFixed(2)); q('x-fb').setAttribute('y2', (146 + 28 * Math.sin(a)).toFixed(2));
      q('x-ang').textContent = Math.round(st.x * 90) + '°';
      needle(q('x-gS'), 152, 148, 14, st.sup); needle(q('x-gO'), 200, 148, 14, st.out);
      q('x-tS').textContent = c.fmtP(st.sup).split(' ')[0]; q('x-tO').textContent = c.fmtP(st.out).split(' ')[0];
    }
  };

  // ---------------- Привод: вид сверху ----------------
  D.act = {
    title: () => 'Привод · вид сверху',
    dur: 9,
    phases: [
      [0, 0.1, 'Воздуха нет: пружины держат поршни у центра, кран закрыт.'],
      [0.1, 0.42, 'Воздух через порт A входит в центральную камеру и разводит поршни к крышкам. Пружины сжимаются.'],
      [0.42, 0.5, 'Рейки повернули шестерню и вал на 90° (по часовой) — кран открыт.'],
      [0.5, 0.85, 'Воздух сброшен: пружины сводят поршни к центру, рейки крутят шестерню обратно.'],
      [0.85, 1, 'Кран закрыт.']
    ],
    svg: `
      <path class="dch" d="M160,200 V142"/><path id="x-chA" class="dchp" d="M160,200 V142"/>
      <path class="actc" d="M60,44 H26 Q8,44 8,62 V138 Q8,156 26,156 H60 Z"/>
      <path class="actc" d="M260,44 H294 Q312,44 312,62 V138 Q312,156 294,156 H260 Z"/>
      <rect class="metal" x="60" y="42" width="200" height="116" rx="4"/>
      <rect class="cut" x="16" y="58" width="288" height="84"/>
      <rect id="x-air" x="136" y="59" width="48" height="82" fill="var(--air)" opacity=".2"/>
      <polyline id="x-sL1" class="dspr" points=""/><polyline id="x-sL2" class="dspr" points=""/>
      <polyline id="x-sR1" class="dspr" points=""/><polyline id="x-sR2" class="dspr" points=""/>
      <rect id="x-pL" class="metal-d" x="124" y="59" width="12" height="82"/>
      <rect id="x-pR" class="metal-d" x="184" y="59" width="12" height="82"/>
      <g id="x-rL"><rect class="metal-d" x="136" y="114" width="60" height="8"/><g id="x-rLt"></g></g>
      <g id="x-rR"><rect class="metal-d" x="124" y="78" width="60" height="8"/><g id="x-rRt"></g></g>
      <g id="x-pin"><circle cx="160" cy="100" r="13" class="metal"/><g id="x-pinT"></g><rect x="155" y="95" width="10" height="10" class="metal-d"/><line x1="160" y1="100" x2="160" y2="88" stroke="var(--alarm)" stroke-width="2"/></g>
      <path id="x-fA" class="dfl" d="M160,200 V128"/>
      <g id="x-arr" stroke-width="2.2" fill="none"></g>
      <path id="x-bL" class="puff" d="M8,100 H0"/><path id="x-bR" class="puff" d="M312,100 H320"/>
      <text class="dl" x="12" y="36">пружины</text><text class="dl" x="250" y="36">пружины</text>
      <text class="dl" x="166" y="190">порт A ← бустер</text>
      <text class="dl" x="112" y="54">поршень</text><text class="dl" x="186" y="54">поршень</text>
      <text class="dl" x="138" y="137">шестерня на валу</text><text class="dl" x="60" y="198">синие стрелки — усилие воздуха, чёрные — пружин</text>
      <text class="dv" id="x-ang" x="226" y="176">0°</text><text class="dv" id="x-p" x="12" y="176">0.00</text>
      <text class="dl" x="12" y="186">в центр. камере</text><text class="dl" x="226" y="186">угол вала</text>`,
    init(q) {
      const pitch = 2 * Math.PI * 14 / 12;
      for (const [id, x0, y1, y2] of [['x-rLt', 136, 112, 114], ['x-rRt', 124, 86, 88]]) {
        for (let x = x0 + 3; x < x0 + 60; x += pitch) { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', (x - 2).toFixed(2)); r.setAttribute('y', y1); r.setAttribute('width', 4); r.setAttribute('height', 2.5); r.setAttribute('class', 'metal-d'); q(id).appendChild(r); }
      }
      for (let k = 0; k < 12; k++) { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', 158); r.setAttribute('y', 84.5); r.setAttribute('width', 4); r.setAttribute('height', 3.5); r.setAttribute('class', 'metal'); r.setAttribute('transform', `rotate(${k * 30} 160 100)`); q('x-pinT').appendChild(r); }
    },
    demo(t) {
      const a = t < 0.12 ? 0 : t < 0.42 ? ramp(t, 0.12, 0.42) : t < 0.55 ? 1 : t < 0.85 ? 1 - ramp(t, 0.55, 0.85) : 0;
      const p = t < 0.1 ? 0 : t < 0.42 ? 2.1 + a * 1.1 : t < 0.5 ? 3.2 + 1.3 * ramp(t, 0.42, 0.47) : t < 0.55 ? 4.5 - 1.6 * ramp(t, 0.5, 0.55) : t < 0.85 ? 1.9 + a * 1.0 : 1.9 * (1 - ramp(t, 0.85, 0.92));
      const v = t > 0.12 && t < 0.42 ? 1 : t > 0.55 && t < 0.85 ? -1 : 0;
      return { a, p, v, ps0: 2.0, ps90: 3.0, fA: (t > 0.1 && t < 0.47) ? 1 : (t > 0.5 && t < 0.9) ? -1 : 0 };
    },
    live(o, c) {
      const A = c.cfg.act, k = A.springBroken ? 0.05 : 1;
      return { a: o.a, p: o.pAct, v: o.v, ps0: A.ps0 * k, ps90: A.ps90 * k, fA: Math.abs(o.qB + o.qBy) > 0.01 ? Math.sign(o.qB + o.qBy) : 0 };
    },
    draw(q, st, dt, A, c) {
      const a = st.a, Lf = 136 - 22 * a, Rf = 184 + 22 * a;
      q('x-pL').setAttribute('x', (Lf - 12).toFixed(2)); q('x-pR').setAttribute('x', Rf.toFixed(2));
      q('x-air').setAttribute('x', Lf.toFixed(2)); q('x-air').setAttribute('width', (Rf - Lf).toFixed(2));
      q('x-air').setAttribute('opacity', (0.06 + 0.8 * pOp(st.p)).toFixed(2));
      q('x-chA').setAttribute('opacity', (0.08 + 0.9 * pOp(st.p)).toFixed(2));
      q('x-rL').setAttribute('transform', `translate(${(Lf - 136).toFixed(2)},0)`);
      q('x-rR').setAttribute('transform', `translate(${(Rf - 184).toFixed(2)},0)`);
      q('x-pin').setAttribute('transform', `rotate(${(a * 90).toFixed(2)} 160 100)`);
      q('x-sL1').setAttribute('points', zigH(18, Lf - 12, 76, 6, 8)); q('x-sL2').setAttribute('points', zigH(18, Lf - 12, 124, 6, 8));
      q('x-sR1').setAttribute('points', zigH(Rf + 12, 302, 76, 6, 8)); q('x-sR2').setAttribute('points', zigH(Rf + 12, 302, 124, 6, 8));
      flow(q('x-fA'), A, 'fa', st.fA !== 0, 24 * (st.fA || 1), dt);
      flow(q('x-bL'), A, 'bl', st.v > 0.002, 20, dt); flow(q('x-bR'), A, 'br', st.v > 0.002, 20, dt);
      // стрелки сил: воздух (наружу) и пружины (к центру)
      const pS = st.ps0 + (st.ps90 - st.ps0) * a;
      const la = 4 + 16 * clamp(st.p / 5, 0, 1), ls = 4 + 16 * clamp(pS / 5, 0, 1);
      const g = q('x-arr');
      g.innerHTML = '';
      const arrow = (x1, x2, y, col) => { if (Math.abs(x2 - x1) < 3) return; const dir = Math.sign(x2 - x1); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', `M${x1},${y} H${x2} M${x2 - dir * 4},${y - 3} L${x2},${y} L${x2 - dir * 4},${y + 3}`); p.setAttribute('stroke', col); g.appendChild(p); };
      if (st.p > 0.05) { arrow(Lf - 2, Lf - 2 - la, 66, 'var(--air)'); arrow(Rf + 2, Rf + 2 + la, 66, 'var(--air)'); }
      arrow(Lf - 14 - ls, Lf - 14, 134, 'var(--ink)'); arrow(Rf + 14 + ls, Rf + 14, 134, 'var(--ink)');
      q('x-ang').textContent = (a * 90).toFixed(1) + '°';
      q('x-p').textContent = c.fmtP(st.p);
    }
  };

  // ---------------- Кран: шар ----------------
  D.valve = {
    title: () => 'Вал и кран',
    dur: 9,
    phases: [
      [0, 0.1, 'Закрыто: отверстие шара смотрит на вас — поперёк трубы, поток перекрыт сёдлами.'],
      [0.1, 0.45, 'Вал привода через муфту поворачивает шток, шар вращается вокруг вертикальной оси.'],
      [0.45, 0.5, 'Открыто (90°): отверстие вдоль трубы, проход полный.'],
      [0.5, 0.85, 'Закрытие: пружины привода поворачивают вал обратно, отверстие уходит поперёк потока.'],
      [0.85, 1, 'Закрыто: шар прижат к седлу.']
    ],
    svg: `
      <defs><radialGradient id="x-gb" cx="38%" cy="32%" r="70%"><stop offset="0" style="stop-color:var(--chip)"/><stop offset=".55" style="stop-color:var(--steel2)"/><stop offset="1" style="stop-color:var(--steel)"/></radialGradient>
      <clipPath id="x-tc"><path id="x-tcp" d=""/></clipPath><clipPath id="x-bc"><circle cx="160" cy="140" r="44"/></clipPath></defs>
      <rect x="0" y="112" width="320" height="56" fill="var(--fluid)" opacity=".12"/>
      <line x1="0" y1="112" x2="70" y2="112" stroke="var(--metal-ink)"/><line x1="250" y1="112" x2="320" y2="112" stroke="var(--metal-ink)"/>
      <line x1="0" y1="168" x2="70" y2="168" stroke="var(--metal-ink)"/><line x1="250" y1="168" x2="320" y2="168" stroke="var(--metal-ink)"/>
      <rect class="metal" x="64" y="96" width="10" height="88" rx="2"/><rect class="metal" x="246" y="96" width="10" height="88" rx="2"/>
      <ellipse cx="160" cy="140" rx="86" ry="52" fill="var(--panel)" fill-opacity=".55" stroke="var(--metal-ink)" stroke-dasharray="4 3"/>
      <rect class="metal-d" x="104" y="116" width="8" height="48" rx="2"/><rect class="metal-d" x="208" y="116" width="8" height="48" rx="2"/>
      <path id="x-fL" class="fluid-f" d="M0,140 H104"/><path id="x-fR" class="fluid-f" d="M216,140 H320"/>
      <rect class="metal" x="148" y="22" width="24" height="16" rx="3"/>
      <rect class="metal" x="154" y="38" width="12" height="60"/><g id="x-stem"></g>
      <circle cx="160" cy="140" r="44" fill="url(#x-gb)" stroke="var(--metal-ink)"/>
      <g id="x-mer" fill="none" stroke="var(--metal-ink)" stroke-width=".8"></g>
      <g clip-path="url(#x-bc)">
      <path id="x-tun" d="" fill="var(--hole)" fill-opacity=".55"/>
      <g clip-path="url(#x-tc)"><path id="x-fB" class="fluid-f" d="M100,140 H220"/></g>
      <ellipse id="x-rim" cx="160" cy="140" rx="18" ry="18" fill="var(--hole)" fill-opacity=".3" stroke="var(--chip)" stroke-width="1.4"/>
      </g>
      <rect x="156" y="94" width="8" height="5" fill="var(--metal-ink)"/>
      <circle cx="276" cy="44" r="30" class="dev"/><line x1="246" y1="44" x2="306" y2="44" stroke="var(--fluid)" stroke-width="6" opacity=".25"/>
      <circle cx="276" cy="44" r="17" class="metal"/><rect id="x-top" x="260" y="39" width="32" height="10" rx="3" fill="var(--panel)" stroke="var(--metal-ink)"/>
      <text class="dl" x="250" y="88">вид сверху</text><text class="dl" x="196" y="199">корпус условно прозрачный</text><text class="dl" x="300" y="48">→</text>
      <text class="dl" x="176" y="32">муфта</text><text class="dl" x="170" y="64">шток</text><text class="dl" x="96" y="110">седло</text><text class="dl" x="200" y="110">седло</text>
      <text class="dl" x="4" y="104">поток →</text><text class="dv" id="x-ang" x="10" y="30">0°</text><text class="dv" id="x-q" x="10" y="46">Q 0 %</text>
      <text class="dl" id="x-txt" x="4" y="199">отверстие поперёк потока</text>`,
    init(q, c) {
      const g = q('x-stem');
      const lines = [];
      for (let k = 0; k < 6; k++) { const l = document.createElementNS(NS, 'line'); l.setAttribute('y1', 38); l.setAttribute('y2', 98); l.setAttribute('stroke', 'var(--metal-ink)'); l.setAttribute('stroke-width', 1.2); g.appendChild(l); lines.push(l); }
      const mer = [];
      for (let k = 0; k < 4; k++) { const p = document.createElementNS(NS, 'path'); q('x-mer').appendChild(p); mer.push(p); }
      c.store.stem = lines; c.store.mer = mer;
    },
    demo(t) {
      const deg = 90 * (t < 0.1 ? 0 : t < 0.45 ? ramp(t, 0.1, 0.45) : t < 0.55 ? 1 : t < 0.85 ? 1 - ramp(t, 0.55, 0.85) : 0);
      return { deg, flow: deg < 3 ? 0 : Math.pow(deg / 90, 2) };
    },
    live(o) { return { deg: o.deg, flow: o.flowRel }; },
    draw(q, st, dt, A, c) {
      const b = ball3d(160, 140, 44, 18, st.deg);
      q('x-tun').setAttribute('d', b.tun); q('x-tcp').setAttribute('d', b.tun);
      q('x-rim').setAttribute('cx', b.xf.toFixed(2)); q('x-rim').setAttribute('rx', b.rx.toFixed(2));
      q('x-rim').setAttribute('fill-opacity', b.rimOp.toFixed(2));
      b.mer.forEach((m, k) => { c.store.mer[k].setAttribute('d', m.d); c.store.mer[k].setAttribute('opacity', m.op.toFixed(2)); });
      const th = st.deg * Math.PI / 180;
      c.store.stem.forEach((l, k) => { const a = -th + k * Math.PI / 3, f = Math.cos(a); if (f <= 0.05) { l.setAttribute('opacity', 0); return; } const x = (160 + 6 * Math.sin(a)).toFixed(2); l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('opacity', (0.25 + 0.75 * f).toFixed(2)); });
      q('x-top').setAttribute('transform', `rotate(${(st.deg - 90).toFixed(2)} 276 44)`);
      const on = st.flow > 0;
      flow(q('x-fL'), A, 'l', on, 12 + 60 * st.flow, dt); flow(q('x-fR'), A, 'r', on, 12 + 60 * st.flow, dt); flow(q('x-fB'), A, 'b', on, 12 + 60 * st.flow, dt);
      q('x-ang').textContent = st.deg.toFixed(1) + '°';
      q('x-q').textContent = 'Q ' + Math.round(st.flow * 100) + ' %';
      q('x-txt').textContent = st.deg <= 3 ? 'отверстие поперёк потока — закрыто' : st.deg >= 87 ? 'отверстие вдоль потока — открыто' : 'шар поворачивается вместе со штоком';
    }
  };

  // ---------------- БКВ ----------------
  const BKV_TH = { c: 3, o: 87, p: 83 };
  D.bkv = {
    title: () => 'БКВ · вид сверху',
    dur: 9,
    phases: [
      [0, 0.1, 'Закрыто: флажок кулачка у датчика ЗАКР — ток ≤1.2 мА, в РСУ «Закрыт».'],
      [0.1, 0.45, 'Вал поворачивается: флажок уходит от ЗАКР (ток растёт до ≥2.1 мА), нижний сектор проходит датчик №3.'],
      [0.45, 0.5, 'Открыто: второй флажок у датчика ОТКР — в РСУ «Открыт».'],
      [0.5, 0.85, 'Обратный поворот: ОТКР гаснет, срабатывает №3, затем ЗАКР.'],
      [0.85, 1, 'Закрыто.']
    ],
    svg: `
      <rect class="dev" x="8" y="20" width="196" height="168" rx="18"/>
      <g id="x-cam">
        <path id="x-sec" d="" fill="var(--warn)" fill-opacity=".35" stroke="var(--warn)"/>
        <circle cx="106" cy="104" r="30" class="metal"/>
        <rect x="62" y="98" width="16" height="12" rx="2" class="metal-d"/>
        <rect x="100" y="60" width="12" height="16" rx="2" class="metal-d"/>
        <rect x="100" y="98" width="12" height="12" class="metal-d"/>
      </g>
      <rect id="x-s0" x="18" y="94" width="26" height="20" rx="4" class="metal-d"/>
      <rect id="x-s1" x="168" y="94" width="26" height="20" rx="4" class="metal-d"/>
      <rect id="x-s2" x="66" y="146" width="20" height="26" rx="4" class="metal-d"/>
      <rect id="x-z0" x="44" y="96" width="5" height="16" fill="var(--ok)" opacity="0"/>
      <rect id="x-z1" x="163" y="96" width="5" height="16" fill="var(--ok)" opacity="0"/>
      <rect id="x-z2" x="68" y="141" width="16" height="5" fill="var(--ok)" opacity="0"/>
      <text class="dl" x="16" y="88">ЗАКР</text><text class="dl" x="166" y="88">ОТКР</text><text class="dl" x="90" y="170">№3</text>
      <text class="dl" x="14" y="14">кулачок с флажками на валу, 3 датчика NAMUR</text>
      <path d="M31,114 V194 H214" fill="none" stroke="var(--wire)" stroke-width="1.2"/>
      <path d="M181,94 V24 H214" fill="none" stroke="var(--wire)" stroke-width="1.2"/>
      <path d="M76,172 V186 H214" fill="none" stroke="var(--wire)" stroke-width="1.2"/>
      <rect class="dev" x="214" y="14" width="102" height="180" rx="8"/>
      <text class="dl" x="220" y="26">изолятор NAMUR (шкаф)</text>
      <g id="x-iso"></g>`,
    init(q, c) {
      const g = q('x-iso'); c.store.iso = [];
      ['ЗАКР', 'ОТКР', '№3'].forEach((n, k) => {
        const y = 48 + k * 50;
        const mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const a in at) e.setAttribute(a, at[a]); g.appendChild(e); return e; };
        mk('text', { class: 'dl', x: 222, y }).textContent = n;
        const cur = mk('text', { class: 'dv', x: 222, y: y + 14 });
        const lamp = mk('circle', { cx: 300, cy: y + 4, r: 7, stroke: 'var(--metal-ink)', fill: 'none' });
        const st = mk('text', { class: 'dl', x: 222, y: y + 26 });
        c.store.iso.push({ cur, lamp, st });
      });
    },
    demo(t) {
      const deg = 90 * (t < 0.1 ? 0 : t < 0.45 ? ramp(t, 0.1, 0.45) : t < 0.55 ? 1 : t < 0.85 ? 1 - ramp(t, 0.55, 0.85) : 0);
      const dm = [deg <= BKV_TH.c, deg >= BKV_TH.o, deg <= BKV_TH.p];
      return { deg, sensors: dm.map((d) => ({ damped: d, i: d ? 1.0 : 3.0, di: d, fault: null })) };
    },
    live(o) { return { deg: o.deg, sensors: o.sensors }; },
    draw(q, st, dt, A, c) {
      q('x-cam').setAttribute('transform', `rotate(${st.deg.toFixed(2)} 106 104)`);
      // нижний сектор для №3: виден датчику при угле ≤ 83° (сверить назначение)
      if (!A.sec) {
        const r1 = 36, r2 = 48, a1 = 32 * Math.PI / 180, a2 = 127 * Math.PI / 180;
        const P = (r, a) => `${(106 + r * Math.cos(a)).toFixed(1)},${(104 + r * Math.sin(a)).toFixed(1)}`;
        q('x-sec').setAttribute('d', `M${P(r1, a1)} A${r1},${r1} 0 0 1 ${P(r1, a2)} L${P(r2, a2)} A${r2},${r2} 0 0 0 ${P(r2, a1)} Z`);
        A.sec = true;
      }
      st.sensors.forEach((s, k) => {
        q('x-s' + k).setAttribute('fill', s.fault ? 'var(--alarm)' : s.damped ? 'var(--ok)' : 'var(--steel)');
        q('x-z' + k).setAttribute('opacity', s.damped && !s.fault ? '.8' : '0');
        const r = c.store.iso[k];
        r.cur.textContent = s.fault ? '0.0 мА' : s.i.toFixed(1) + ' мА';
        r.lamp.setAttribute('fill', s.fault ? 'var(--alarm)' : s.di ? 'var(--ok)' : 'none');
        r.st.textContent = s.fault ? 'обрыв линии' : s.damped ? 'флажок у датчика · 1' : 'нет флажка · 0';
      });
    }
  };

  // ---------------- ФР и тройник ----------------
  D.fr = {
    title: () => 'ФР и тройник',
    dur: 10,
    phases: [
      [0, 0.25, 'Воздух из коллектора КИП через отражатель закручивается в стакане: капли и крупные частицы отбрасываются на стенки и стекают вниз. Дальше воздух проходит фильтроэлемент снаружи внутрь.'],
      [0.25, 0.5, 'Очищенный воздух идёт вверх к седлу. Пружина настройки давит на мембрану, шток держит клапан приоткрытым — после ФР давление по настройке.'],
      [0.5, 0.8, 'Расход вырос (кран открывается): давление под мембраной падает, пружина опускает мембрану — клапан открывается шире, давление восстанавливается.'],
      [0.8, 1, 'Тройник делит воздух: малая линия — на питание позиционера, большая — на питание бустера. Конденсат сливается через дренаж внизу стакана.']
    ],
    svg: `
      <defs><clipPath id="x-bowlc"><path d="M98,100 H182 V148 Q182,174 140,174 Q98,174 98,148 Z"/></clipPath></defs>
      <path class="dch" d="M0,59 H72"/><path id="x-chI" class="dchp" d="M0,59 H72"/>
      <rect class="metal" x="70" y="38" width="140" height="64" rx="8"/>
      <rect class="metal" x="112" y="6" width="56" height="34" rx="6"/>
      <rect x="124" y="0" width="32" height="7" rx="2" fill="var(--ink)"/>
      <rect class="metal-d" x="137" y="4" width="6" height="12"/>
      <rect class="cut" x="118" y="12" width="44" height="28"/>
      <rect class="cut" x="70" y="52" width="36" height="14"/>
      <rect class="cut" x="92" y="52" width="14" height="50"/>
      <rect class="cut" x="118" y="40" width="80" height="18"/>
      <rect class="cut" x="196" y="47" width="14" height="10"/>
      <rect class="cut" x="130" y="62" width="20" height="40"/>
      <rect id="x-pO" x="118" y="40" width="80" height="18" fill="var(--air)" opacity=".2"/>
      <rect class="metal-d" x="118" y="58" width="13" height="5"/><rect class="metal-d" x="149" y="58" width="13" height="5"/>
      <polyline id="x-rs" class="dspr" points=""/>
      <rect id="x-sp" class="metal-d" x="126" y="26" width="28" height="4" rx="1"/>
      <path id="x-dia" d="M116,36 Q140,36 164,36" fill="none" stroke="var(--ink)" stroke-width="2.6"/>
      <line id="x-stem" x1="140" y1="36" x2="140" y2="63" stroke="var(--metal-ink)" stroke-width="3"/>
      <g id="x-vp"><path d="M131,63 H149 L146,70 H134 Z" class="metal"/></g>
      <polyline id="x-vs" class="dspr" points=""/>
      <path d="M98,100 H182 V148 Q182,174 140,174 Q98,174 98,148 Z" fill="var(--panel)" stroke="var(--metal-ink)" stroke-width="1.2"/>
      <g clip-path="url(#x-bowlc)"><rect id="x-water" x="96" y="160" width="90" height="20" fill="var(--air)" opacity=".35"/></g>
      <path d="M100,104 L112,110 M100,110 L112,116" stroke="var(--metal-ink)" stroke-width="1.6"/>
      <rect x="116" y="106" width="48" height="40" rx="4" fill="var(--chip)" stroke="var(--metal-ink)" stroke-dasharray="1.5 2" stroke-width="1.4"/>
      <rect x="134" y="102" width="12" height="44" fill="var(--panel)" stroke="var(--metal-ink)" stroke-width=".8"/>
      <rect class="metal-d" x="108" y="150" width="64" height="3"/>
      <rect class="metal-d" x="134" y="174" width="12" height="8"/><rect x="130" y="182" width="20" height="5" rx="2" fill="var(--ink)"/>
      <path class="dch" d="M210,52 H232"/><path id="x-chO" class="dchp" d="M210,52 H232"/>
      <circle cx="226" cy="20" r="14" fill="var(--panel)" stroke="var(--metal-ink)"/><line x1="226" y1="34" x2="226" y2="52" stroke="var(--metal-ink)" stroke-width="2"/>
      <line id="x-gN" x1="226" y1="20" x2="226" y2="9" stroke="var(--alarm)" stroke-width="1.6"/>
      <circle cx="232" cy="52" r="4" fill="var(--metal-ink)"/>
      <path class="dch" d="M232,52 H320" style="stroke-width:9"/><path id="x-chB" class="dchp" d="M232,52 H320" style="stroke-width:9"/>
      <path class="dch" d="M232,52 V130 H320" style="stroke-width:4"/><path id="x-chPs" class="dchp" d="M232,52 V130 H320" style="stroke-width:4"/>
      <path id="x-fIn" class="dfl" d="M0,59 H99 V116 H128 V128 H140 V50 H232"/>
      <path id="x-fB" class="dfl" d="M232,52 H320"/><path id="x-fP" class="dfl" d="M232,52 V130 H320"/>
      <circle id="x-d1" r="2" cx="104" cy="120" fill="var(--air)"/><circle id="x-d2" r="2" cx="176" cy="120" fill="var(--air)"/>
      <text class="dl" x="2" y="52">из коллектора</text>
      <text class="dl" x="170" y="10">винт настройки</text><text class="dl" x="170" y="22">пружина</text>
      <text class="dl" x="170" y="36">мембрана</text><text class="dl" x="160" y="74">клапан, седло</text>
      <text class="dl" x="4" y="112">отражатель</text><text class="dl" x="168" y="128">фильтро-</text><text class="dl" x="168" y="136">элемент</text>
      <text class="dl" x="40" y="170">конденсат</text><text class="dl" x="154" y="190">дренаж</text>
      <text class="dv" id="x-p" x="244" y="24">0.00</text>
      <text class="dl" x="240" y="44">→ питание бустера</text><text class="dl" x="240" y="122">→ SUP позиционера</text>
      <text class="dl" x="238" y="66">тройник</text>`,
    demo(t) {
      const dip = t > 0.5 && t < 0.72 ? 0.35 * Math.sin((t - 0.5) / 0.22 * Math.PI) : 0;
      const fl = t < 0.5 ? 0.3 : t < 0.8 ? 0.3 + 1.2 * ramp(t, 0.5, 0.58) : 0.8;
      return { p: 4.5 - dip, flow: fl, qB: fl * 0.85, qP: 0.15, drops: t < 0.3 || t > 0.85 };
    },
    live(o) {
      const qB = Math.max(0, o.qB), qP = Math.max(0, o.qRelay);
      return { p: o.pSup, flow: qB + qP, qB, qP, drops: qB + qP > 0.05 };
    },
    draw(q, st, dt, A, c) {
      const open = clamp(st.flow / 2, 0, 1);
      A.o = A.o == null ? open : A.o + (open - A.o) * Math.min(1, dt / 0.1);
      const o = A.o, bow = 1 + 5 * o;
      q('x-dia').setAttribute('d', `M116,36 Q140,${(36 + 2 * bow).toFixed(1)} 164,36`);
      q('x-sp').setAttribute('y', (26 + bow).toFixed(1));
      q('x-rs').setAttribute('points', zigV(140, 16, 26 + bow, 4, 9));
      q('x-stem').setAttribute('y1', (36 + bow).toFixed(1));
      q('x-stem').setAttribute('y2', (63 + 6 * o).toFixed(1));
      q('x-vp').setAttribute('transform', `translate(0,${(6 * o).toFixed(2)})`);
      q('x-vs').setAttribute('points', zigV(140, 70 + 6 * o, 100, 3, 5));
      needle(q('x-gN'), 226, 20, 11, st.p);
      q('x-p').textContent = c.fmtP(st.p);
      q('x-pO').setAttribute('opacity', (0.08 + 0.8 * pOp(st.p)).toFixed(2));
      for (const id of ['x-chO', 'x-chB', 'x-chPs', 'x-chI']) q(id).setAttribute('opacity', (0.08 + 0.9 * pOp(id === 'x-chI' ? 6 : st.p)).toFixed(2));
      flow(q('x-fIn'), A, 'in', st.flow > 0.02, 14 + 24 * st.flow, dt);
      flow(q('x-fB'), A, 'b', st.qB > 0.02, 14 + 24 * st.qB, dt);
      flow(q('x-fP'), A, 'p', st.qP > 0.004, 16, dt);
      A.dr = ((A.dr || 0) + (st.drops ? dt * 22 : 0)) % 40;
      for (const [id, k] of [['x-d1', 0], ['x-d2', 20]]) {
        const y = 112 + ((A.dr + k) % 40);
        q(id).setAttribute('cy', y.toFixed(1));
        q(id).setAttribute('opacity', st.drops && y < 158 ? '1' : '0');
      }
    }
  };

  // узел схемы → разрез
  const MAP = { fr: ['fr'], tee: ['fr'], pos: ['pos'], sovR: ['sov', { which: 'R' }], sovP: ['sov', { which: 'P' }], booster: ['booster'], act: ['act'], shaft: ['valve'], valve: ['valve'], bkv: ['bkv'] };

  function createViewer(svgEl, capEl, titleEl, env) {
    let cur = null, ctx = null, A = {}, demo = null, idx = {};
    const q = (id) => idx[id];
    function open(node) {
      const m = MAP[node];
      if (!m) return false;
      const d = D[m[0]];
      ctx = Object.assign({ store: {}, fmtP: env.fmtP, cfg: env.cfg() }, m[1] || {});
      cur = d; A = {}; demo = null;
      svgEl.innerHTML = d.svg;
      idx = {};
      svgEl.querySelectorAll('[id]').forEach((e) => { idx[e.id] = e; });
      if (d.init) d.init(q, ctx);
      titleEl.textContent = d.title(ctx);
      capEl.textContent = '';
      return true;
    }
    function play(from, to) {
      if (!cur) return;
      demo = { t: from == null ? 0 : from, to: to == null ? 1 : to };
    }
    function phaseText(t) {
      for (const p of cur.phases) if (t >= p[0] && t < p[1]) return p[2];
      return cur.phases[cur.phases.length - 1][2];
    }
    function tick(o, dt) {
      if (!cur) return;
      ctx.cfg = env.cfg();
      let st;
      if (demo) {
        demo.t += dt / cur.dur;
        if (demo.t >= demo.to) { demo = null; capEl.textContent = 'Срабатывание показано. Сейчас — живое состояние узла.'; st = cur.live(o, ctx); }
        else { st = cur.demo(demo.t); capEl.textContent = '▶ ' + phaseText(demo.t); }
      } else st = cur.live(o, ctx);
      cur.draw(q, st, dt, A, ctx);
    }
    return { open, play, tick, get playing() { return !!demo; }, get active() { return !!cur; }, close() { cur = null; demo = null; } };
  }

  window.CIDetails = { D, MAP, createViewer };
})();
