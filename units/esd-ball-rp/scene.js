/* C&I Simulator — сцена «Отсечной клапан ПАЗ» (UI). Физика — в sim-esd (CISimESD). */
(function () {
  'use strict';
  const C = window.CISim, E = window.CISimESD;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;
  const svg = $('sc'), stage = $('stage');
  const VBW = 360, VBH = 480;

  let sim = null;
  const ui = { unit: 'bar', speed: 1, paused: false, labels: true, fault: '', pSup: 4.5, bypass: 0.35, fs: false };

  // ---------- справка ----------
  const HELP = {
    general: [
      'Отсечной клапан ПАЗ (тег XZV): шаровой кран 6″ с реечным пневмоприводом одностороннего действия. Воздух открывает, пружины закрывают. Безопасное положение — ЗАКРЫТ: пропал воздух, ток позиционера или напряжение на любом соленоиде — кран закрывается сам.',
      'Открыть может только РСУ и только когда ПАЗ в норме. Закрыть могут оба, независимо друг от друга: РСУ — через SOV-РСУ и позиционер (4 мА), ПАЗ — через SOV-ПАЗ.',
      'Путь воздуха: ФР → тройник → (1) питание позиционера, (2) питание бустера. Выход позиционера → SOV-РСУ → SOV-ПАЗ → сигнальный вход бустера. Бустер повторяет сигнал большим расходом в привод.',
      'Положение контролирует БКВ на трёх индуктивных датчиках: ЗАКР, ОТКР и третий (вероятно, PST — сверить). Сигналы идут в РСУ. Нет нужного концевика дольше времени контроля — авария рассогласования.',
      'Позиционер на отсечном нужен для частичного хода (PST) и диагностики: так проверяют, что кран не прикипел, не останавливая процесс. Полный ход по ПАЗ при испытаниях всё равно нужен.'
    ],
    fr: {
      t: 'Фильтр-регулятор (ФР)',
      what: 'Готовит воздух КИП: задерживает частицы и конденсат, снижает давление сети до рабочего и держит его постоянным. На объекте после ФР около 4.5 бар (манометры в бар).',
      how: 'Сверху ручка настройки давления, внутри фильтрующий элемент и мембранный редуктор, снизу стакан с дренажом конденсата. Манометр показывает давление после регулятора — то, что идёт на тройник.',
      chk: ['Давление по манометру в норме и не «плавает» при ходе крана.', 'Конденсат в стакане сливать через дренаж (периодичность — по регламенту).', 'Забит или закрыт — нет воздуха на позиционере и бустере, кран закрыт и не откроется.', 'Занижено давление — воздуху не хватает усилия против пружин, кран не доходит до ОТКР.']
    },
    tee: {
      t: 'Тройник',
      what: 'Делит воздух после ФР на две линии.',
      how: 'Малая линия — на питание позиционера (вход SUP). Большая — на питание бустера: именно отсюда бустер берёт расход для привода.',
      chk: ['Перекрыт или пережат отвод на позиционер — позиционер без воздуха, сигнала на бустер нет, кран не откроется.', 'Утечки на фитингах — проверка мыльным раствором.']
    },
    pos: {
      t: 'Позиционер (интеллектуальный)',
      what: 'Вход 4–20 мА от РСУ, он же питание электроники. 20 мА — открыть, 4 мА — закрыть. Выход OUT — управляющее давление, идёт через оба соленоида на сигнальный вход бустера. Питание воздухом 1.4–7 бар, исполнение Ex ia.',
      how: 'Угол вала получает через рычажную связь от муфты на валу. Сравнивает угол с заданием, I/P-преобразователь и пневмореле подают воздух на выход или сбрасывают его. На 20 мА и 4 мА работает отсечками: полный выход или полный сброс. По команде делает PST: уводит кран с ОТКР на 10 % и возвращает.',
      chk: ['Ток на клеммах: 20 мА при команде ОТКРЫТЬ, 4 мА при ЗАКРЫТЬ.', 'Манометры: SUP — давление питания, OUT — выход на бустер.', 'Обрыв токовой петли — позиционер сбрасывает выход, кран закрывается.', 'PST не пройден — смотреть, двигался ли кран и как сбрасывается воздух.']
    },
    sovR: {
      t: 'SOV-РСУ (соленоид 3/2)',
      what: 'Электромагнитный клапан 3/2, нормально закрытый, катушка в оболочке Ex d. Управляет РСУ. Стоит первым после выхода позиционера.',
      how: 'Под напряжением: проход P→A, сигнал позиционера идёт к SOV-ПАЗ. Обесточен: вход P перекрыт, выход A соединён со сбросом R, сигнал бустера стравливается. Команда ЗАКРЫТЬ снимает напряжение.',
      chk: ['Напряжение на клеммах катушки при команде ОТКРЫТЬ — номинальное (типовое 24 В DC, сверить по шильду).', 'Напряжения нет — цепь РСУ: клеммы, кабель, выход DO.', 'Напряжение есть, а SOV не переключается — катушка или якорь.', 'Залип — РСУ всё равно закроет через позиционер (4 мА), ПАЗ — через свой SOV.']
    },
    sovP: {
      t: 'SOV-ПАЗ (соленоид 3/2)',
      what: 'Такой же клапан 3/2, управляется системой ПАЗ. Стоит последним перед бустером, поэтому перекрывает сигнал независимо от РСУ и позиционера.',
      how: 'Пока ПАЗ в норме, катушка под напряжением, проход P→A. Срабатывание ПАЗ снимает напряжение: SOV сбрасывает сигнал бустера через R, бустер стравливает привод, пружины закрывают кран.',
      chk: ['Напряжение на клеммах при ПАЗ в норме — номинальное.', 'Пропало напряжение — ложное срабатывание: кран закрыт при норме ПАЗ.', 'Залип (не сбрасывает) — опасный скрытый отказ: при срабатывании ПАЗ кран не закроется. Выявляется только испытанием.']
    },
    booster: {
      t: 'Бустер (усилитель расхода)',
      what: 'Повторитель давления 1:1 с большим расходом. Принимает малый сигнал от позиционера через соленоиды и подаёт в привод большой расход из своей линии питания.',
      how: 'Сигнал выше давления в приводе — мембрана открывает клапан подачи из питания. Сигнал ниже — открывает выхлоп, воздух из привода уходит в атмосферу через сетку. Игла байпаса пропускает малые изменения сигнала мимо бустера: так PST идёт плавно. Главное назначение на отсечном — быстрое закрытие.',
      chk: ['Время хода закрытия в норме — выхлоп чистый.', 'Забита сетка или выхлоп — закрытие медленное, PST может не пройти.', 'Игла закрыта полностью — рывки при малых изменениях; открыта сильно — бустер срабатывает позже.']
    },
    act: {
      t: 'Привод реечный, пружинный возврат',
      what: 'Шестерня-рейка, одностороннего действия. Типоразмер «250». На торцевых крышках надпись «CAUTION · COMPRESSED SPRINGS» — внутри сжатые пружины.',
      how: 'Разрез сбоку: передняя рейка идёт от левого поршня, задняя — от правого, между ними шестерня на вертикальном валу. Воздух в центральной камере разводит поршни к крышкам, рейки поворачивают шестерню и вал на 90° — кран открывается, пружины сжимаются. Воздух сброшен — пружины сводят поршни, кран закрывается. Пружинные камеры дышат через крышки.',
      chk: ['Крышки с пружинами не снимать без процедуры по РЭ: опасность травмы.', 'Утечка из центральной камеры — бустер постоянно подкачивает, давление в приводе ниже питания.', 'Сломаны пружины — при сбросе воздуха кран не закрывается.']
    },
    shaft: {
      t: 'Вал, муфта, кронштейн',
      what: 'Одна сквозная ось: шестерня привода → вал → муфта → шток крана → шар. Сверху тот же вал выходит через кронштейн NAMUR к кулачку БКВ и рычагу позиционера.',
      how: 'Рейки поворачивают шестерню на 90°, вал передаёт крутящий момент через муфту и кронштейн-переходник на шток, шар поворачивается вокруг вертикальной оси: отверстие из положения «поперёк потока» встаёт «вдоль потока». Кронштейн держит привод соосно с краном.',
      chk: ['БКВ и позиционер видят угол вала привода, а не самого шара: люфт в муфте или переходнике даёт «открыт» по концевику при неполном повороте шара.', 'Перекос привода относительно крана при монтаже — заедание и рост момента.']
    },
    valve: {
      t: 'Кран шаровой 6″',
      what: 'XZV-700: среда этан, 6″, ANSI 300, корпус LCC, затвор SS316, уплотнение графит, утечка ГОСТ класс B, ход 90°, On/Off, при отказе питания — ЗАКРЫТ.',
      how: '0° — отверстие шара поперёк потока, кран закрыт. 90° — отверстие вдоль потока, проход полный. Работает только в крайних положениях.',
      chk: ['«Прикипел» шар — привод не может его сдвинуть: PST не пройден, по ПАЗ не закрывается.', 'Дросселировать шаровой On/Off нельзя — износ сёдел (сверить с РЭ крана).']
    },
    bkv: {
      t: 'БКВ (блок концевых выключателей)',
      what: 'На кронштейне NAMUR над приводом. Внутри на валу кулачок с флажками и 3 индуктивных датчика NAMUR (8.2 В, срабатывание 4 мм). Корпус Ex d, вводы M20×1.5. Сверху купол — местный указатель ЗАКР/ОТКР.',
      how: 'Флажок перед датчиком — ток ≤1.2 мА, флажка нет — ≥2.1 мА. Изолятор в шкафу превращает ток в дискретный сигнал и контролирует линию: обрыв <0.15 мА, КЗ >6.5 мА (типовые). Датчики: ЗАКР, ОТКР и третий — вероятно, контроль отхода при PST (сверить).',
      chk: ['ЗАКР и ОТКР не горят одновременно; в крайних положениях горит ровно один.', 'Сбит кулачок — кран в положении, а концевика нет: рассогласование.', 'Обрыв линии датчика — ток 0, авария линии на изоляторе.']
    }
  };

  // Неисправности: признаки, причины, поиск, устранение, место. Типовые действия; конкретика — по РЭ и регламентам.
  const FI = {
    noAir: { n: 'Нет воздуха питания', where: ['fr'],
      sym: ['Манометр ФР и оба манометра позиционера на нуле.', 'Кран закрыт, команда ОТКРЫТЬ не исполняется → рассогласование «нет ОТКР».'],
      cause: ['Закрыт вентиль перед ФР.', 'Нет давления в коллекторе воздуха КИП.', 'Забит фильтроэлемент ФР.', 'Замёрз конденсат в ФР или импульсной трубке (зима).', 'Сорвана или отсоединена трубка.'],
      chk: ['Манометр ФР; давление в коллекторе КИП (манометр на коллекторе).', 'Положение вентиля перед ФР.', 'Стакан ФР: лёд, вода, состояние элемента.', 'Обход трассы трубки от коллектора до ФР.'],
      fix: ['Открыть вентиль, восстановить подачу.', 'Заменить фильтроэлемент (по РЭ ФР).', 'Слить конденсат, отогреть разрешённым способом, проверить обогрев/осушку.', 'Восстановить трубку и фитинги, проверить ход крана.'] },
    lowSupply: { n: 'Низкое давление после ФР', where: ['fr'],
      sym: ['P питания ниже нормы (здесь 2.9 бар вместо 4.5).', 'Кран не доходит до ОТКР, время хода растёт → рассогласование.'],
      cause: ['Сбита настройка ФР.', 'Частично забит фильтроэлемент — давление «проседает» при расходе.', 'Просадка коллектора КИП.', 'Утечки после ФР.'],
      chk: ['Манометр ФР в покое и во время хода: падает при расходе — фильтр или вход.', 'Давление в коллекторе.', 'Мыльный раствор на фитингах после ФР.'],
      fix: ['Выставить давление ручкой ФР по норме (≈4.5 бар; не выше допустимого по шильдам позиционера и привода).', 'Заменить фильтроэлемент.', 'Устранить утечки.'] },
    posSupBlocked: { n: 'Нет питания позиционера (отвод тройника)', where: ['tee', 'pos'],
      sym: ['Манометр SUP позиционера 0 при нормальном давлении ФР.', 'OUT 0, сигнала на бустер нет, кран не открывается.'],
      cause: ['Пережата или перекрыта трубка от тройника.', 'Засор фитинга или входного фильтра позиционера.', 'Повреждение трубки.'],
      chk: ['Сравнить манометр ФР и манометр SUP позиционера.', 'Осмотр трубки от тройника до позиционера.', 'Входной фильтр позиционера (по РЭ).'],
      fix: ['Восстановить или заменить трубку.', 'Прочистить фитинг, входной фильтр позиционера.'] },
    loopBreak: { n: 'Обрыв 4–20 мА позиционера', where: ['pos'],
      sym: ['Ток 0 мА, дисплей позиционера погас.', 'Выход позиционера сброшен — кран закрыт.'],
      cause: ['Обрыв кабеля или ослабленная клемма (коробка, позиционер, шкаф).', 'Перегорел предохранитель, неисправен барьер/изолятор.', 'Неисправен выход AO РСУ.'],
      chk: ['Ток на выходе AO в шкафу и на клеммах позиционера (мультиметр, токовые клещи).', 'Напряжение на клеммах позиционера.', 'Прозвонка жил при снятом питании.'],
      fix: ['Подтянуть или заменить клемму, восстановить кабель.', 'Заменить предохранитель, барьер/изолятор.', 'Работы в Ex-зоне — по наряду-допуску.'] },
    sovRNoPower: { n: 'Нет напряжения на катушке SOV-РСУ', where: ['sovR'],
      sym: ['При команде ОТКРЫТЬ на клеммах SOV-РСУ 0 В.', 'Позиционер выдаёт давление (OUT в норме), за SOV-РСУ давления нет, кран закрыт.'],
      cause: ['Обрыв кабеля, клемма.', 'Не срабатывает выход DO / реле РСУ, предохранитель.', 'Блокировка в логике РСУ.'],
      chk: ['Напряжение по цепочке: клеммы SOV → клеммная коробка → выход DO в шкафу.', 'Состояние выхода в РСУ и условия блокировок.'],
      fix: ['Восстановить цепь, заменить предохранитель или реле.', 'Устранить причину блокировки.'] },
    sovRCoilBurnt: { n: 'Катушка SOV-РСУ неисправна', where: ['sovR'],
      sym: ['На клеммах номинальное напряжение есть, а SOV не переключается.', 'За SOV-РСУ давления нет, кран закрыт.'],
      cause: ['Обрыв или межвитковое замыкание катушки.', 'Заклинил якорь, загрязнение седла.'],
      chk: ['Сопротивление катушки при снятом питании — сравнить с паспортным.', 'Ручной дублёр SOV (если есть) — проходит ли воздух.'],
      fix: ['Замена катушки или SOV целиком (по РЭ, с сохранением взрывозащиты Ex d: вводы, уплотнения, крышка).'] },
    sovPNoPower: { n: 'Нет напряжения на SOV-ПАЗ (ложное срабатывание)', where: ['sovP'],
      sym: ['ПАЗ в норме, а кран закрыт.', 'На клеммах SOV-ПАЗ 0 В; за SOV-РСУ давление есть, сигнал бустера 0.'],
      cause: ['Обрыв цепи, клемма, предохранитель.', 'Выход системы ПАЗ снят (срабатывание по другой причине, блокировка).'],
      chk: ['Напряжение: клеммы SOV-ПАЗ → коробка → выход системы ПАЗ.', 'Журнал событий ПАЗ.'],
      fix: ['Восстановить цепь.', 'Работы на цепях ПАЗ — по процедуре вывода/шунтирования, согласованной с технологом.'] },
    sovPStuck: { n: 'SOV-ПАЗ не сбрасывает (залип)', where: ['sovP'],
      sym: ['При срабатывании ПАЗ напряжение снято (0 В), а кран остаётся открытым.', 'Сигнал бустера не падает → рассогласование «нет ЗАКР».', 'Опасный скрытый отказ — виден только при испытании.'],
      cause: ['Загрязнение или износ уплотнения якоря.', 'Засор выхлопа R (грязь, насекомые, лёд в глушителе).', 'Механическое заедание якоря.'],
      chk: ['Снять напряжение и проверить, есть ли выхлоп из порта R.', 'Осмотр глушителя R.', 'Давление на выходе A после снятия напряжения.'],
      fix: ['Очистить или заменить глушитель.', 'Ремкомплект или замена SOV; затем функциональная проверка по ПАЗ.', 'До устранения — компенсирующие меры по регламенту.'] },
    sovRStuck: { n: 'SOV-РСУ залип', where: ['sovR'],
      sym: ['Явных признаков нет: кран закрывается через позиционер (4 мА) и по ПАЗ.', 'Выявляется проверкой: снять напряжение с SOV-РСУ при 20 мА — кран не закрывается.'],
      cause: ['Те же, что у SOV-ПАЗ: уплотнение якоря, засор выхлопа R, заедание.'],
      chk: ['Проверка SOV отдельно от позиционера (по программе испытаний).'],
      fix: ['Ремкомплект или замена SOV.'] },
    boosterExhClogged: { n: 'Забит выхлоп бустера', where: ['booster'],
      sym: ['Время закрытия заметно выше нормы.', 'PST проходит медленно или не проходит.', 'При сбросе сигнала давление в приводе падает медленно, выхлоп слабый.'],
      cause: ['Засорена сетка или глушитель выхлопа.', 'Обледенение.', 'Износ или загрязнение выхлопного седла.'],
      chk: ['Сравнить время хода с паспортным и прошлыми замерами.', 'Осмотр сетки выхлопа.', 'Слышен ли выхлоп при закрытии.'],
      fix: ['Очистить или заменить сетку-глушитель.', 'Ремонт бустера (ремкомплект по РЭ).'] },
    ballStuck: { n: 'Шар «прикипел»', where: ['valve', 'shaft'],
      sym: ['PST не пройден: угол не меняется.', 'При сброшенном воздухе кран не закрывается; давление в приводе 0.'],
      cause: ['Отложения или полимер в полости крана.', 'Долгий простой в одном положении.', 'Повреждение сёдел, перетянутый сальник штока.'],
      chk: ['Журнал и результаты PST.', 'Осмотр узла штока и сальника.', 'Ручной поворот (если предусмотрен, по РЭ).'],
      fix: ['Решение с технологом: промывка, прогрев.', 'Ремонт крана (сёдла, уплотнения) с выводом из работы — по РЭ крана.'] },
    springBroken: { n: 'Сломаны пружины привода', where: ['act'],
      sym: ['При сбросе воздуха кран не закрывается или закрывается не до конца.', 'PST не проходит — нет возвратного момента.'],
      cause: ['Усталостное разрушение, коррозия.', 'Неправильная сборка (число или тип пружин).'],
      chk: ['Поведение крана при сбросе воздуха.', 'Разборка привода — только по РЭ: пружины сжаты!'],
      fix: ['Замена пружинного комплекта или привода по РЭ, с процедурой сборки/разборки картриджей.'] },
    actLeak: { n: 'Утечка в приводе', where: ['act'],
      sym: ['Давление в приводе ниже питания при открытом кране.', 'Бустер постоянно подкачивает, слышен выход воздуха.'],
      cause: ['Износ уплотнений поршней, повреждение колец.', 'Негерметичный штуцер порта A.'],
      chk: ['Мыльный раствор на штуцеры.', 'Воздух из дыхательных отверстий крышек — утечка через поршень.'],
      fix: ['Подтянуть или заменить фитинг.', 'Замена уплотнений поршней (ремкомплект привода, по РЭ).'] },
    camShift: { n: 'Сбит кулачок БКВ', where: ['bkv'],
      sym: ['Кран открыт полностью (90°, купол и шток показывают «открыт»), а сигнала ОТКР нет → рассогласование.'],
      cause: ['Ослаб винт кулачка.', 'Сдвиг при монтаже или обслуживании, неверная настройка.'],
      chk: ['Вскрыть БКВ (Ex d — при отсутствии взрывоопасной среды, по допуску) и проверить положение флажка относительно датчика.', 'Индикация датчика, ток на изоляторе.'],
      fix: ['Выставить кулачок в крайних положениях, затянуть.', 'Проверить сигналы ЗАКР/ОТКР в РСУ.'] },
    namurOpenBreak: { n: 'Обрыв линии датчика ОТКР', where: ['bkv'],
      sym: ['Ток датчика 0 мА, изолятор показывает аварию линии.', 'Сигнала ОТКР нет при открытом кране.'],
      cause: ['Обрыв жилы, ослабленная клемма.', 'Неисправен датчик, влага в коробке.'],
      chk: ['Ток и сопротивление линии на изоляторе.', 'Напряжение на датчике (около 8 В без нагрузки).', 'Замена датчика заведомо исправным.'],
      fix: ['Восстановить линию или клемму.', 'Заменить датчик (по РЭ БКВ).'] }
  };
  const FAULT_RU = {};
  for (const k of Object.keys(FI)) FAULT_RU[k] = [FI[k].n, FI[k].sym[0]];
  const ALARM_RU = {
    LOW_SUPPLY: ['al', 'Низкое P питания'], POS_NO_POWER: ['al', 'Позиционер без тока'],
    PAZ_TRIP: ['wn', 'ПАЗ сработала'], DI_BOTH: ['al', 'ЗАКР и ОТКР одновременно'],
    MIS_OPEN: ['al', 'Рассогласование: нет ОТКР'], MIS_CLOSE: ['al', 'Рассогласование: нет ЗАКР'],
    PST_FAIL: ['al', 'PST не пройден'],
    NAMUR_0_BREAK: ['al', 'Обрыв линии ЗАКР'], NAMUR_1_BREAK: ['al', 'Обрыв линии ОТКР'], NAMUR_2_BREAK: ['al', 'Обрыв линии №3']
  };
  const BOX = {
    pos: [228, 36, 112, 76], bkv: [146, 28, 68, 76], act: [16, 112, 328, 96], fr: [2, 222, 44, 96], tee: [40, 250, 30, 34],
    shaft: [148, 200, 64, 186], booster: [66, 226, 80, 90], sovP: [190, 224, 58, 80], sovR: [250, 224, 58, 80], valve: [104, 356, 152, 118]
  };

  // ---------- хранилище ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cis.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cis.' + k, JSON.stringify(v)); } catch (e) { /* нет хранилища */ } }
  };
  const fmtP = (p) => C.fmtP(p, ui.unit);
  const txtCache = new Map();
  function setText(id, v) { if (txtCache.get(id) === v) return; txtCache.set(id, v); $(id).textContent = v; }
  const pOp = (p) => Math.sqrt(Math.max(0, Math.min(1, p / 6)));
  function mk(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- SOV ----------
  const sovEl = {};
  function buildSov(id, x0, name) {
    const g = $(id);
    mk('rect', { class: 'dev', x: x0 + 8, y: 228, width: 32, height: 16, rx: 3 }, g);
    const coil = mk('rect', { x: x0 + 12, y: 231, width: 24, height: 10, rx: 2, fill: 'none', stroke: 'var(--wire)', 'stroke-width': 1.4 }, g);
    mk('rect', { class: 'metal', x: x0, y: 244, width: 48, height: 38, rx: 3 }, g);
    mk('rect', { class: 'cut', x: x0 + 4, y: 250, width: 40, height: 28, rx: 2 }, g);
    const pa = mk('path', { d: `M${x0 + 4},262 H${x0 + 44}`, fill: 'none', stroke: 'var(--tube)', 'stroke-width': 3 }, g);
    const ar = mk('path', { d: `M${x0 + 4},262 H${x0 + 24} V282`, fill: 'none', stroke: 'var(--tube)', 'stroke-width': 3 }, g);
    const plg = mk('rect', { class: 'metal-d', x: x0 + 27, y: 257, width: 8, height: 10, rx: 1 }, g);
    const t = mk('text', { class: 'zv', x: x0 + 13, y: 238.5 }, g); t.textContent = '0 В';
    const lb = mk('text', { class: 'lbs', x: x0 - 2, y: 296 }, g); lb.textContent = name;
    mk('text', { class: 'z', x: x0 + 40, y: 259 }, g).textContent = 'P';
    mk('text', { class: 'z', x: x0 + 5, y: 259 }, g).textContent = 'A';
    mk('text', { class: 'z', x: x0 + 26, y: 289 }, g).textContent = 'R';
    mk('text', { class: 'z', x: x0 + 7, y: 226 }, g).textContent = 'катушка Ex d';
    const st = mk('text', { class: 'zv', x: x0 + 6, y: 276 }, g); st.textContent = '';
    const puff = mk('path', { class: 'puff', d: `M${x0 + 24},284 V300`, opacity: 0 }, g);
    sovEl[id] = { coil, pa, ar, plg, t, st, puff, x0, off: 0 };
  }

  // ---------- трубки ----------
  const TUBES = {
    supIn: 'M0,270 H8', frOut: 'M40,270 H56', teeBoost: 'M56,270 H70',
    teePos: 'M56,270 V322 H352 V62 H336', posOut: 'M336,86 H344 V262 H304',
    mid: 'M256,262 H244', sig: 'M196,262 H186 V228 H128 V238', bout: 'M100,238 V214 H156 V204'
  };
  const tubes = {};
  function buildTubes() {
    const g = $('tubes');
    for (const id of Object.keys(TUBES)) {
      mk('path', { d: TUBES[id], class: 'tube' }, g);
      const pr = mk('path', { d: TUBES[id], class: 'tube-p', opacity: 0 }, g);
      const fl = mk('path', { d: TUBES[id], class: 'tube-f', opacity: 0 }, g);
      tubes[id] = { pr, fl, off: 0 };
    }
    const lbl = [['SUP', 340, 58], ['OUT', 340, 96], ['к SOV-РСУ', 312, 258], ['сигнал', 132, 234], ['в привод', 104, 222]];
    for (const l of lbl) mk('text', { class: 'z', x: l[1], y: l[2] }, g).textContent = l[0];
  }
  function setTube(id, p, q, dt) {
    const t = tubes[id];
    t.pr.setAttribute('opacity', (0.08 + 0.92 * pOp(p)).toFixed(3));
    const v = Math.abs(q) < 0.004 ? 0 : Math.sign(q) * (12 + 22 * Math.sqrt(Math.abs(q)));
    t.off -= v * dt;
    t.fl.setAttribute('stroke-dashoffset', t.off.toFixed(1));
    t.fl.setAttribute('opacity', v ? '0.95' : '0');
  }
  const anim = {};
  function puff(el, key, mag, dt) {
    const m = Math.min(1, Math.abs(mag));
    anim[key] = (anim[key] || 0) - (m > 0.01 ? 10 + 30 * m : 0) * dt;
    el.setAttribute('stroke-dashoffset', anim[key].toFixed(1));
    el.setAttribute('opacity', m > 0.01 ? (0.35 + 0.65 * m).toFixed(2) : '0');
  }
  function dash(id, key, on, speed, dt) {
    const el = $(id);
    anim[key] = (anim[key] || 0) - (on ? speed : 0) * dt;
    el.setAttribute('stroke-dashoffset', anim[key].toFixed(1));
    el.setAttribute('opacity', on ? '1' : '0');
  }

  // ---------- привод ----------
  function springPts(x1, x2, y, amp, n) {
    const pts = [x1 + ',' + y];
    const step = (x2 - x1) / (n * 2);
    for (let k = 1; k < n * 2; k++) pts.push((x1 + k * step).toFixed(1) + ',' + (y + (k % 2 ? -amp : amp)));
    pts.push(x2.toFixed(1) + ',' + y);
    return pts.join(' ');
  }
  // вращающийся цилиндр в виде сбоку: линии на поверхности x = cx + r·sin(α), видны только спереди
  const cyls = [];
  function cyl(id, cx, r, y1, y2, n, w, color) {
    const g = $(id), lines = [];
    for (let k = 0; k < n; k++) lines.push(mk('line', { x1: cx, y1, x2: cx, y2, stroke: color, 'stroke-width': w }, g));
    cyls.push({ cx, r, n, lines });
  }
  function buildCyl() {
    cyl('shAct', 180, 6, 100, 196, 6, 1.4, 'var(--metal-ink)');
    cyl('shLow', 180, 6, 206, 356, 6, 1.4, 'var(--metal-ink)');
    cyl('shCpl', 180, 13, 328, 348, 8, 1.1, 'var(--metal-ink)');
    cyl('shStem', 180, 5, 356, 382, 6, 1.2, 'var(--metal-ink)');
    cyl('pinT', 180, 19, 140, 188, 14, 2.4, 'var(--metal-ink)');
    const pitch = 2 * Math.PI * 19 / 14;
    for (const [id, x0, y1, y2] of [['rackUT', 140, 168, 176], ['rackDT', 150, 149, 156]]) {
      for (let x = x0 + 3; x < x0 + 70; x += pitch) mk('line', { x1: x.toFixed(2), y1, x2: x.toFixed(2), y2, stroke: 'var(--metal-ink)', 'stroke-width': 1.6 }, $(id));
    }
  }
  let lastTheta = null;
  function spin(theta) {
    if (lastTheta !== null && Math.abs(theta - lastTheta) < 1e-4) return;
    lastTheta = theta;
    for (const c of cyls) {
      c.lines.forEach((ln, k) => {
        const a = -theta + k * 2 * Math.PI / c.n;
        const front = Math.cos(a);
        if (front <= 0.05) { ln.setAttribute('opacity', '0'); return; }
        const x = (c.cx + c.r * Math.sin(a)).toFixed(2);
        ln.setAttribute('x1', x); ln.setAttribute('x2', x);
        ln.setAttribute('opacity', (0.25 + 0.75 * front).toFixed(2));
      });
    }
  }
  function needle(id, cx, cy, r, p) {
    const a = (-135 + Math.min(1, Math.max(0, p / 10)) * 270) * Math.PI / 180;
    const el = $(id);
    el.setAttribute('x2', (cx + r * Math.sin(a)).toFixed(2));
    el.setAttribute('y2', (cy - r * Math.cos(a)).toFixed(2));
  }

  // ---------- отрисовка ----------
  let lastA = -1, lastBrk = null, ballInit = false;
  function render(o, dt) {
    const a = o.a, deg = o.deg;
    // привод
    const geo = Math.abs(a - lastA) > 1e-5 || sim.cfg.act.springBroken !== lastBrk;
    lastA = a; lastBrk = sim.cfg.act.springBroken;
    const Lf = 140 - 30 * a, Rf = 220 + 30 * a;
    $('airC').setAttribute('opacity', (0.08 + 0.8 * pOp(o.pAct)).toFixed(3));
    if (geo) {
    $('pisL').setAttribute('x', (Lf - 10).toFixed(2));
    $('pisR').setAttribute('x', Rf.toFixed(2));
    $('airC').setAttribute('x', Lf.toFixed(2));
    $('airC').setAttribute('width', (Rf - Lf).toFixed(2));
    $('rackU').setAttribute('transform', `translate(${(Lf - 140).toFixed(2)},0)`);
    $('rackD').setAttribute('transform', `translate(${(Rf - 220).toFixed(2)},0)`);
    const brk = sim.cfg.act.springBroken;
    $('spL1').setAttribute('points', springPts(28, Lf - 10, 148, 7, brk ? 3 : 6));
    $('spL2').setAttribute('points', springPts(28, Lf - 10, 180, 7, 6));
    $('spR1').setAttribute('points', springPts(Rf + 10, 332, 148, 7, 6));
    $('spR2').setAttribute('points', springPts(Rf + 10, 332, 180, 7, brk ? 3 : 6));
    }
    spin(deg * Math.PI / 180);
    const moving = Math.abs(o.v) > 0.002;
    $('rotArrow').setAttribute('opacity', moving ? '1' : '0');
    $('rotArrow').setAttribute('transform', o.v < 0 ? 'translate(360,0) scale(-1,1)' : '');
    setText('tRot', moving ? (o.v > 0 ? 'вал ↻ открытие' : 'вал ↺ закрытие') : 'вал');
    puff($('puffCapL'), 'capL', o.v > 0 ? o.v * 0.8 : 0, dt);
    puff($('puffCapR'), 'capR', o.v > 0 ? o.v * 0.8 : 0, dt);
    // муфта, связь
    const pa = (-90 + deg) * Math.PI / 180;
    const px = 180 + 6 * Math.cos(pa), py = 112 + 6 * Math.sin(pa);
    $('cplPin').setAttribute('cx', px.toFixed(2)); $('cplPin').setAttribute('cy', py.toFixed(2));
    $('link').setAttribute('x1', px.toFixed(2)); $('link').setAttribute('y1', py.toFixed(2));
    // БКВ
    $('cam').setAttribute('transform', `rotate(${deg.toFixed(2)} 180 72)`);
    o.sensors.forEach((s, k) => {
      $('s' + k).setAttribute('fill', s.fault ? 'var(--alarm)' : s.damped ? 'var(--ok)' : 'var(--steel)');
      $('s' + k).setAttribute('stroke', 'var(--metal-ink)');
      $('tS' + k).textContent = s.i.toFixed(1) + ' мА';
    });
    const dome = $('dome'), domeT = $('domeT');
    if (deg <= 3) { dome.setAttribute('fill', 'var(--alarm)'); domeT.textContent = 'ЗАКР'; domeT.setAttribute('x', '174.2'); }
    else if (deg >= 87) { dome.setAttribute('fill', 'var(--ok)'); domeT.textContent = 'ОТКР'; domeT.setAttribute('x', '174.4'); }
    else { dome.setAttribute('fill', 'var(--warn)'); domeT.textContent = Math.round(deg) + '°'; domeT.setAttribute('x', '176'); }
    // кран
    if (geo || !ballInit) {
    ballInit = true;
    const b3 = window.CIBall3d(180, 408, 31, 11, deg);
    $('bTun').setAttribute('d', b3.tun); $('tunClip').setAttribute('d', b3.tun);
    $('bRim').setAttribute('cx', b3.xf.toFixed(2)); $('bRim').setAttribute('rx', b3.rx.toFixed(2)); $('bRim').setAttribute('fill-opacity', b3.rimOp.toFixed(2));
    b3.mer.forEach((m, k) => { merEl[k].setAttribute('d', m.d); merEl[k].setAttribute('opacity', m.op.toFixed(2)); });
    }
    setText('tBore', deg <= 3 ? 'отверстие шара поперёк потока' : deg >= 87 ? 'отверстие шара вдоль потока' : 'шар поворачивается на штоке');
    const fl = o.flowRel;
    dash('flowL', 'fl', fl > 0, 12 + 60 * fl, dt); dash('flowR', 'fr', fl > 0, 12 + 60 * fl, dt); dash('flowBall', 'fb', fl > 0, 12 + 60 * fl, dt);
    setText('tFlow', 'Q ' + Math.round(fl * 100) + ' %');
    // позиционер
    setText('lcd1', o.powered ? (a * 100).toFixed(1) + ' %' : '');
    setText('lcd2', o.powered ? ({ auto: 'AUTO', pst: 'PST ' + (o.pst ? o.pst.phase : ''), off: '' }[o.posMode] || '') + '  ' + o.i.toFixed(1) + 'mA' : '');
    setText('tPosI', o.i.toFixed(1) + ' мА');
    needle('gSupN', 314, 56, 5.5, o.pSupPos);
    needle('gOutN', 314, 80, 5.5, o.pPos);
    needle('gFrN', 24, 254, 6.5, o.pSup);
    const ia = Math.max(-1, Math.min(1, o.u)) * 60 * Math.PI / 180;
    $('ipInd').setAttribute('x2', (251 + 3 * Math.sin(ia)).toFixed(2));
    $('ipInd').setAttribute('y2', (81 - 3 * Math.cos(ia)).toFixed(2));
    puff($('puffPos'), 'pos', o.qRelay < 0 ? -o.qRelay * 2 : 0, dt);
    // бустер
    $('bSig').setAttribute('opacity', (0.08 + 0.85 * pOp(o.pSig)).toFixed(3));
    $('bOut').setAttribute('opacity', (0.08 + 0.85 * pOp(o.pAct)).toFixed(3));
    $('bSup').setAttribute('opacity', (0.08 + 0.85 * pOp(o.pSup)).toFixed(3));
    const dpb = o.pSig - o.pAct;
    $('bDia').setAttribute('transform', `translate(0,${Math.max(-2.5, Math.min(2.5, dpb * 12)).toFixed(2)})`);
    $('bPop').setAttribute('transform', `translate(0,${o.qB > 0.01 ? 3 : 0})`);
    puff($('puffB'), 'b', o.qB < 0 ? -o.qB / 3 : 0, dt);
    // SOV
    sovView('gSovP', o.sovP, o.ex2, dt);
    sovView('gSovR', o.sovR, o.ex1, dt);
    // трубки
    setTube('supIn', o.pSup, Math.max(0, o.qB) + Math.max(0, o.qRelay), dt);
    setTube('frOut', o.pSup, Math.max(0, o.qB) + Math.max(0, o.qRelay), dt);
    setTube('teeBoost', o.pSup, Math.max(0, o.qB), dt);
    setTube('teePos', o.pSupPos, Math.max(0, o.qRelay), dt);
    setTube('posOut', o.pPos, o.qRelay > 0 ? o.qRelay : o.q1, dt);
    setTube('mid', o.pMid, o.q1 !== 0 ? o.q1 : -o.ex1, dt);
    setTube('sig', o.pSig, o.q2 !== 0 ? o.q2 : -o.ex2, dt);
    setTube('bout', o.pAct, o.qB + o.qBy, dt);

    // показания
    setText('vA', deg.toFixed(1) + '°');
    if (ui.fs) setText('hint', deg.toFixed(0) + '° · P ' + fmtP(o.pAct) + ' · ' + (ui.paused ? 'пауза' : '×' + ui.speed));
    setText('vP', fmtP(o.pAct));
    setText('vS', fmtP(o.pSig));
    setText('vI', o.i.toFixed(1) + ' мА');
    $('chI').classList.toggle('bad', !o.powered);
    setText('vSup', fmtP(o.pSup));
    $('chSup').classList.toggle('bad', o.alarms.includes('LOW_SUPPLY'));
    setText('vT', o.stroke ? (o.stroke.dir === 'open' ? '↑ ' : '↓ ') + o.stroke.t.toFixed(1) + ' с' : o.lastStroke ? (o.lastStroke.dir === 'open' ? '↑ ' : '↓ ') + o.lastStroke.time.toFixed(1) + ' с' : '—');
    $('chA').classList.toggle('bad', o.alarms.some((x) => x.startsWith('MIS')));
    $('lC').classList.toggle('on', o.diClosed);
    $('lO').classList.toggle('on', o.diOpen);
    $('l3').classList.toggle('on', o.diPst);
    $('bOpen').setAttribute('aria-pressed', o.cmdOpen);
    $('bClose').setAttribute('aria-pressed', !o.cmdOpen);
    $('bPaz').setAttribute('aria-pressed', o.pazTrip);
    setText('bPazS', o.pazTrip ? 'СРАБОТКА' : 'норма');
    setText('diNote', o.pst ? 'PST идёт…' : '');
    renderAlarms(o);
    if (cardNode) cardKv(o);
  }
  function sovView(id, st, ex, dt) {
    const e = sovEl[id];
    e.coil.setAttribute('stroke', st.u > 0 ? 'var(--wire)' : 'var(--steel)');
    e.coil.setAttribute('fill', st.energized ? 'var(--wire)' : 'none');
    e.coil.setAttribute('fill-opacity', '0.25');
    e.t.textContent = st.u.toFixed(0) + ' В';
    e.pa.setAttribute('stroke', st.pass ? 'var(--air)' : 'var(--tube)');
    e.ar.setAttribute('stroke', st.pass ? 'var(--tube)' : 'var(--air)');
    e.plg.setAttribute('y', st.pass ? 248 : 257);
    e.st.textContent = st.pass ? 'P→A' : 'A→R';
    puff(e.puff, id, ex > 0.003 ? ex * 3 : 0, dt);
  }

  let lastAl = '';
  function renderAlarms(o) {
    const tags = [];
    for (const a of o.alarms) if (ALARM_RU[a]) tags.push(ALARM_RU[a]);
    if (o.pst) tags.push(['wn', 'PST: ' + o.pst.phase]);
    else if (o.pstResult) {
      if (o.pstResult.ok) tags.push(['okk', 'PST пройден: ' + (o.pstResult.minA * 90).toFixed(1) + '°, ' + o.pstResult.tTotal.toFixed(1) + ' с']);
      else if (o.pstResult.error === 'NOT_READY') tags.push(['wn', 'PST: кран не открыт или SOV обесточен']);
    }
    if (!tags.length) tags.push(['okk', 'Норма']);
    const key = tags.map((t) => t.join(':')).join('|');
    if (key === lastAl) return;
    lastAl = key;
    $('alarms').innerHTML = tags.map((t) => `<span class="tag ${t[0]}">${t[1]}</span>`).join('');
  }

  // ---------- карточка ----------
  let cardNode = null, view = 'scheme';
  const DV = window.CIDetails.createViewer($('dsvg'), $('dcap'), $('dTitle'), { fmtP: (p) => fmtP(p), cfg: () => sim.cfg });
  function showDetail(n, range) {
    if (!DV.open(n)) return;
    view = 'detail';
    $('vScheme').hidden = true; $('vDetail').hidden = false;
    highlight(n);
    if (range) DV.play(range[0], range[1]);
    else $('dcap').textContent = 'Живое состояние узла. ▶ — показать, как он срабатывает.';
  }
  function showScheme() {
    view = 'scheme'; DV.close();
    $('vDetail').hidden = true; $('vScheme').hidden = false;
  }
  function openCard(n) {
    const h = HELP[n];
    if (!h) return;
    cardNode = n;
    $('cTitle').textContent = h.t;
    $('cWhat').textContent = h.what;
    $('cHow').textContent = h.how;
    $('cChk').innerHTML = h.chk.map((x) => `<li>${x}</li>`).join('');
    $('card').hidden = false;
    showDetail(n);
    cardKv(sim.state);
  }
  function closeCard() { cardNode = null; $('card').hidden = true; if (!seq) { highlight(null); showScheme(); } }
  function kv(pairs) { $('cKv').innerHTML = pairs.map((p) => `<div><span>${p[0]}</span><b>${p[1]}</b></div>`).join(''); }
  function cardKv(o) {
    const st = (x) => (x.pass ? 'P→A' : 'A→R');
    switch (cardNode) {
      case 'fr': kv([['P после ФР', fmtP(o.pSup)], ['Уставка', fmtP(ui.pSup)]]); break;
      case 'tee': kv([['P', fmtP(o.pSup)], ['→ бустер', Math.max(0, o.qB).toFixed(2) + ' нл/с'], ['→ позиционер', Math.max(0, o.qRelay).toFixed(2) + ' нл/с'], ['SUP позиц.', fmtP(o.pSupPos)]]); break;
      case 'pos': kv([['Ток', o.i.toFixed(2) + ' мА'], ['Режим', o.powered ? o.posMode.toUpperCase() : 'нет питания'], ['Задание', (o.sp * 100).toFixed(1) + ' %'], ['Угол', (o.a * 100).toFixed(1) + ' %'], ['SUP', fmtP(o.pSupPos)], ['OUT', fmtP(o.pPos)]]); break;
      case 'sovR': kv([['Клеммы', o.sovR.u.toFixed(1) + ' В'], ['Путь', st(o.sovR)], ['Вход P', fmtP(o.pPos)], ['Выход A', fmtP(o.pMid)], ['Команда РСУ', o.cmdOpen ? 'ОТКРЫТЬ' : 'ЗАКРЫТЬ']]); break;
      case 'sovP': kv([['Клеммы', o.sovP.u.toFixed(1) + ' В'], ['Путь', st(o.sovP)], ['Вход P', fmtP(o.pMid)], ['Выход A', fmtP(o.pSig)], ['ПАЗ', o.pazTrip ? 'СРАБОТКА' : 'норма']]); break;
      case 'booster': kv([['Сигнал', fmtP(o.pSig)], ['Выход (привод)', fmtP(o.pAct)], ['Питание', fmtP(o.pSup)], ['Подача / выхлоп', o.qB.toFixed(2) + ' нл/с'], ['Байпас', o.qBy.toFixed(2) + ' нл/с'], ['Игла байпаса', Math.round(sim.cfg.booster.bypass * 100) + ' %']]); break;
      case 'act': kv([['P в центр. камере', fmtP(o.pAct)], ['Угол вала', o.deg.toFixed(1) + '°'], ['Пружины, экв.', fmtP((sim.cfg.act.ps0 + (sim.cfg.act.ps90 - sim.cfg.act.ps0) * o.a) * (sim.cfg.act.springBroken ? 0.05 : 1))], ['Положение', o.deg <= 3 ? 'закрыт' : o.deg >= 87 ? 'открыт' : 'в ходе']]); break;
      case 'shaft': kv([['Угол вала', o.deg.toFixed(1) + '°'], ['Скорость', (o.v * 90).toFixed(0) + ' °/с'], ['Вращение', Math.abs(o.v) > 0.002 ? (o.v > 0 ? 'открытие' : 'закрытие') : 'стоит'], ['Шар', o.deg <= 3 ? 'поперёк потока' : o.deg >= 87 ? 'вдоль потока' : 'в ходе']]); break;
      case 'valve': kv([['Угол', o.deg.toFixed(1) + '°'], ['Расход', Math.round(o.flowRel * 100) + ' %'], ['Fail', 'CLOSE'], ['Ход', '90°']]); break;
      case 'bkv': kv(o.sensors.map((s, k) => [['ЗАКР', 'ОТКР', '№3'][k], s.fault ? 'ОБРЫВ 0 мА' : s.i.toFixed(1) + ' мА · ' + (s.di ? '1' : '0')]).concat([['Кулачок', o.deg.toFixed(1) + '°']])); break;
      default: break;
    }
  }

  // ---------- зум ----------
  const vb = { x: 0, y: 0, w: VBW };
  let tween = null;
  function vbH(w) { return w * VBH / VBW; }
  function clampVb(v) {
    v.w = Math.max(64, Math.min(VBW, v.w));
    const h = vbH(v.w);
    v.x = Math.max(0, Math.min(VBW - v.w, v.x));
    v.y = Math.max(0, Math.min(VBH - h, v.y));
    return v;
  }
  function applyVb() {
    clampVb(vb);
    svg.setAttribute('viewBox', `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vbH(vb.w).toFixed(2)}`);
    const z = VBW / vb.w;
    stage.classList.toggle('zoomed', z > 1.01);
    svg.classList.toggle('zoom2', z >= 1.9);
    setText('hint', (ui.paused ? 'пауза · ' : '×' + ui.speed + ' · ') + 'зум ' + z.toFixed(1));
  }
  function tweenTo(t, ms) {
    const from = { x: vb.x, y: vb.y, w: vb.w };
    const to = clampVb({ x: t.x, y: t.y, w: t.w });
    const t0 = performance.now();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 0 : (ms || 450);
    tween = { from, to, t0, dur };
  }
  function stepTween(now) {
    if (!tween) return;
    const k = tween.dur ? Math.min(1, (now - tween.t0) / tween.dur) : 1;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    vb.x = tween.from.x + (tween.to.x - tween.from.x) * e;
    vb.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    vb.w = tween.from.w + (tween.to.w - tween.from.w) * e;
    applyVb();
    if (k >= 1) tween = null;
  }
  function focusNode(n) {
    const b = BOX[n];
    if (!b) return;
    const pad = 10;
    const w = Math.max(b[2] + 2 * pad, (b[3] + 2 * pad) * VBW / VBH, 130);
    const h = vbH(w);
    tweenTo({ x: b[0] + b[2] / 2 - w / 2, y: b[1] + b[3] / 2 - h / 2, w });
  }
  function zoomAll() { tweenTo({ x: 0, y: 0, w: VBW }); }
  function zoomBy(f, cx, cy) {
    const h = vbH(vb.w);
    if (cx == null) { cx = vb.x + vb.w / 2; cy = vb.y + h / 2; }
    const nw = Math.max(64, Math.min(VBW, vb.w / f));
    const k = nw / vb.w;
    tween = null;
    vb.x = cx - (cx - vb.x) * k; vb.y = cy - (cy - vb.y) * k; vb.w = nw;
    applyVb();
  }
  function highlight(n) {
    const hl = $('hl');
    if (!n || !BOX[n]) { hl.setAttribute('display', 'none'); return; }
    const b = BOX[n];
    hl.setAttribute('x', b[0]); hl.setAttribute('y', b[1]); hl.setAttribute('width', b[2]); hl.setAttribute('height', b[3]);
    hl.setAttribute('display', 'inline');
  }
  // жесты
  const ptr = new Map();
  let gest = null;
  function svgPt(cx, cy) {
    const r = svg.getBoundingClientRect();
    return { x: vb.x + (cx - r.left) / r.width * vb.w, y: vb.y + (cy - r.top) / r.height * vbH(vb.w) };
  }
  svg.addEventListener('pointerdown', (e) => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 1) gest = { t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: 0, node: e.target.closest && e.target.closest('[data-node]'), multi: false };
    else if (gest) gest.multi = true;
    if (ptr.size === 2) {
      const [p1, p2] = [...ptr.values()];
      gest.d0 = Math.hypot(p1.x - p2.x, p1.y - p2.y); gest.w0 = vb.w;
      gest.c0 = svgPt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    try { svg.setPointerCapture(e.pointerId); } catch (er) { /* нет захвата */ }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId) || !gest) return;
    const prev = ptr.get(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gest.moved = Math.max(gest.moved, Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0));
    if (ptr.size === 2) {
      const [p1, p2] = [...ptr.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (gest.d0 > 10) {
        tween = null;
        const nw = Math.max(64, Math.min(VBW, gest.w0 * gest.d0 / d));
        const r = svg.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        vb.w = nw;
        vb.x = gest.c0.x - (mx - r.left) / r.width * nw;
        vb.y = gest.c0.y - (my - r.top) / r.height * vbH(nw);
        applyVb();
      }
    } else if (ptr.size === 1 && vb.w < VBW - 0.5) {
      tween = null;
      const r = svg.getBoundingClientRect();
      vb.x -= (e.clientX - prev.x) / r.width * vb.w;
      vb.y -= (e.clientY - prev.y) / r.height * vbH(vb.w);
      applyVb();
    }
  });
  function endPtr(e) {
    if (!ptr.has(e.pointerId)) return;
    ptr.delete(e.pointerId);
    if (ptr.size === 0 && gest) {
      if (!gest.multi && gest.moved < 8 && performance.now() - gest.t0 < 500 && gest.node) {
        const n = gest.node.dataset.node;
        if (cardNode === n) closeCard(); else openCard(n);
      }
      gest = null;
    }
  }
  svg.addEventListener('pointerup', endPtr);
  svg.addEventListener('pointercancel', endPtr);
  svg.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || vb.w < VBW - 0.5)) return;
    e.preventDefault();
    const p = svgPt(e.clientX, e.clientY);
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => { const p = svgPt(e.clientX, e.clientY); zoomBy(2, p.x, p.y); });

  // ---------- последовательности ----------
  const ensureOpen = () => { sim.paz(false); sim.cmd(true); if (!sim.state.diOpen) sim.run(12); };
  const ensureClosed = () => { sim.paz(false); sim.cmd(false); if (!sim.state.diClosed) sim.run(12); };
  const SEQS = [
    { name: 'Открытие по команде РСУ', pre: ensureClosed, steps: [
      { f: 'fr', d: [0, 0.5], t: 'ФР подаёт чистый осушенный воздух, около 4.5 бар.' },
      { f: 'tee', d: [0.8, 1], t: 'Тройник: малая линия — на питание позиционера (SUP), большая — на питание бустера.' },
      { f: 'sovP', d: [0, 0.5], t: 'ПАЗ в норме: на катушке SOV-ПАЗ напряжение, проход P→A открыт.', a: () => sim.paz(false) },
      { f: 'sovR', d: [0.1, 0.5], t: 'Команда ОТКРЫТЬ: РСУ подаёт напряжение на SOV-РСУ и 20 мА на позиционер.', a: () => sim.cmd(true) },
      { f: 'pos', d: [0, 0.5], t: 'Позиционер: 20 мА — открыть. На выход OUT идёт полное давление.' },
      { f: 'sovR', d: [0.25, 0.5], t: 'Сигнал проходит SOV-РСУ (P→A)…' },
      { f: 'sovP', d: [0.25, 0.5], t: '…затем SOV-ПАЗ (P→A) и приходит на сигнальный вход бустера.' },
      { f: 'booster', d: [0, 0.5], t: 'Бустер открывает подачу: большой расход из своего питания идёт в привод.' },
      { f: 'act', d: [0, 0.5], t: 'Воздух в центральной камере разводит поршни, рейки крутят шестерню, пружины в крышках сжимаются.' },
      { f: 'shaft', d: [0, 0.5], t: 'Шестерня, вал, муфта и шток — одна ось: вал поворачивается на 90°. Сверху этот же вал крутит кулачок БКВ и рычаг позиционера.' },
      { f: 'valve', d: [0.1, 0.5], t: 'Шток поворачивает шар вокруг вертикальной оси: отверстие встаёт вдоль потока, проход открыт.' },
      { f: 'bkv', d: [0, 0.5], t: 'Флажок дошёл до датчика ОТКР: в РСУ сигнал «Открыт», время хода зафиксировано.' }
    ] },
    { name: 'Закрытие по ПАЗ', pre: ensureOpen, steps: [
      { f: 'sovP', d: [0.5, 0.64], t: 'ПАЗ срабатывает и снимает напряжение с SOV-ПАЗ.', a: () => sim.paz(true) },
      { f: 'sovP', d: [0.62, 1], t: 'SOV-ПАЗ перекрывает вход P и соединяет сигнальную линию бустера со сбросом R.' },
      { f: 'booster', d: [0.5, 1], t: 'Сигнал стал ниже давления в приводе: бустер открывает выхлоп, воздух уходит через сетку.' },
      { f: 'act', d: [0.5, 1], t: 'Пружины сводят поршни к центру, рейки поворачивают шестерню обратно.' },
      { f: 'shaft', d: [0.5, 1], t: 'Вал вращается обратно и через муфту поворачивает шток.' },
      { f: 'valve', d: [0.5, 1], t: 'Отверстие шара встаёт поперёк потока: кран закрыт.' },
      { f: 'bkv', d: [0.5, 1], t: 'Флажок у датчика ЗАКР: в РСУ сигнал «Закрыт».' },
      { f: 'pos', t: 'Позиционер всё ещё выдаёт давление, но его путь отрезан SOV-ПАЗ: ПАЗ не зависит от РСУ и позиционера.' }
    ] },
    { name: 'Закрытие по РСУ', pre: ensureOpen, steps: [
      { f: 'sovR', d: [0.5, 1], t: 'Команда ЗАКРЫТЬ: РСУ снимает напряжение с SOV-РСУ и даёт 4 мА на позиционер.', a: () => sim.cmd(false) },
      { f: 'pos', d: [0.5, 1], t: 'На 4 мА позиционер тоже сбрасывает выход: у РСУ два пути сброса.' },
      { f: 'booster', d: [0.5, 1], t: 'Сигнал бустера сброшен: выхлоп открыт, привод стравливается.' },
      { f: 'act', d: [0.5, 1], t: 'Пружины закрывают кран.' },
      { f: 'bkv', d: [0.5, 1], t: 'Датчик ЗАКР: сигнал в РСУ, время хода зафиксировано.' }
    ] },
    { name: 'Частичный ход (PST)', pre: ensureOpen, steps: [
      { f: 'pos', t: 'Кран открыт. Позиционер запускает частичный ход на 10 %.', a: () => sim.startPst() },
      { f: 'booster', t: 'Позиционер понемногу снижает сигнал: бустер и игла байпаса стравливают привод плавно.' },
      { f: 'act', t: 'Пружины доворачивают вал примерно на 9°, кран остаётся почти открытым.' },
      { f: 'bkv', t: 'ОТКР гаснет, срабатывает датчик №3 — вероятно, для подтверждения отхода при PST (сверить).' },
      { f: 'pos', t: 'Позиционер возвращает кран в ОТКР и выдаёт результат: прошёл или нет.' }
    ] }
  ];
  let seq = null, seqI = 0, seqSpeed = 1;
  function startSeq(k) {
    closeCard();
    seq = SEQS[k]; seqI = 0;
    seqSpeed = ui.speed;
    if (seq.pre) seq.pre();
    setSpeed(0.5);
    $('cap').hidden = false;
    $('capTitle').textContent = seq.name;
    showStep(true);
  }
  function showStep(apply) {
    const st = seq.steps[seqI];
    if (apply && st.a) st.a();
    $('capN').textContent = (seqI + 1) + '/' + seq.steps.length;
    $('capT').textContent = st.t;
    $('capNext').textContent = seqI === seq.steps.length - 1 ? 'Готово' : 'Далее ›';
    $('capPrev').disabled = seqI === 0;
    $('card').hidden = true; cardNode = null;
    showDetail(st.f, apply ? st.d : null);
  }
  function stopSeq() {
    seq = null; $('cap').hidden = true; highlight(null); showScheme(); setSpeed(seqSpeed); zoomAll();
  }

  // ---------- тренд ----------
  const buf = [];
  let trT = -1;
  const cv = $('trend'), cx = cv.getContext('2d');
  const col = {};
  function readColors() {
    const cs = getComputedStyle(root);
    for (const k of ['ink', 'muted', 'line', 'air']) col[k] = cs.getPropertyValue('--' + k).trim();
  }
  function trend(o) {
    if (o.t - trT >= 0.1 || trT < 0) { trT = o.t; buf.push([o.t, o.a, o.pAct, o.pSig]); while (buf.length && buf[0][0] < o.t - 30.5) buf.shift(); }
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    const L = 32, R = W - 40, T = 6, B = H - 18, pMax = Math.max(1, Math.ceil(ui.pSup || 1));
    const X = (t) => L + (t - (o.t - 30)) / 30 * (R - L), Y = (v) => B - v * (B - T);
    cx.font = '10px ' + getComputedStyle(document.body).fontFamily; cx.lineWidth = 1;
    cx.strokeStyle = col.line; cx.fillStyle = col.muted;
    for (const v of [0, 0.5, 1]) {
      cx.beginPath(); cx.moveTo(L, Y(v)); cx.lineTo(R, Y(v)); cx.stroke();
      cx.textAlign = 'right'; cx.fillText(Math.round(v * 90) + '°', L - 4, Y(v) + 3);
      cx.textAlign = 'left'; cx.fillText(C.fmtP(v * pMax, ui.unit).split(' ')[0], R + 4, Y(v) + 3);
    }
    cx.textAlign = 'left'; cx.fillText('−30 с', L, H - 4); cx.textAlign = 'right'; cx.fillText('сейчас', R, H - 4);
    const line = (i, c, sc, dash, w) => {
      cx.strokeStyle = c; cx.lineWidth = w; cx.setLineDash(dash); cx.beginPath();
      buf.forEach((s, k) => { const x = X(s[0]), y = Y(Math.max(0, Math.min(1.02, s[i] / sc))); if (k) cx.lineTo(x, y); else cx.moveTo(x, y); });
      cx.stroke(); cx.setLineDash([]);
    };
    line(3, col.muted, pMax, [4, 3], 1.3); line(2, col.air, pMax, [], 1.6); line(1, col.ink, 1, [], 2);
  }

  // ---------- управление ----------
  function setSpeed(v) {
    ui.speed = v;
    $('spd1').setAttribute('aria-pressed', v === 1); $('spd025').setAttribute('aria-pressed', v === 0.25);
    applyVb();
  }
  function cfgPatch() {
    const p = { supply: { p: ui.pSup }, booster: { bypass: ui.bypass } };
    return p;
  }
  function newSim() {
    sim = E.createEsd(cfgPatch());
    if (ui.fault) sim.applyFault(ui.fault);
    sim.run(1);
    buf.length = 0; trT = -1;
  }
  function setFault(k) {
    // сброс прежней неисправности без сброса состояния: пересоздаём модель с сохранением команд
    const st = sim.state;
    ui.fault = k;
    const s2 = E.createEsd(cfgPatch());
    s2.cmd(st.cmdOpen); s2.paz(st.pazTrip);
    // привести к тому же положению быстро, затем ввести неисправность
    s2.run(12);
    if (k) s2.applyFault(k);
    sim = s2;
    $('selFault').value = k;
    $('faultNote').textContent = k ? 'Введено: ' + FI[k].n + '.' : 'Нет неисправностей. Выберите — на схеме отметится место, ниже признаки, причины, поиск и устранение.';
    $('fInfo').hidden = !k;
    const li = (a) => a.map((x) => `<li>${x}</li>`).join('');
    document.querySelectorAll('#sc .flt').forEach((e) => e.remove());
    if (k) {
      const f = FI[k];
      $('fSym').innerHTML = li(f.sym); $('fCause').innerHTML = li(f.cause); $('fChk').innerHTML = li(f.chk); $('fFix').innerHTML = li(f.fix);
      $('fWhere').innerHTML = f.where.map((n) => `<button class="btn" data-part="${n}">${HELP[n].t.replace(/ \(.*\)/, '')}</button>`).join('');
      for (const n of f.where) { const b = BOX[n]; mk('rect', { class: 'flt', x: b[0] + 2, y: b[1] + 2, width: b[2] - 4, height: b[3] - 4, rx: 6 }, svg); }
    }
  }
  function measureDock() { root.style.setProperty('--dockH', document.querySelector('.dock').offsetHeight + 'px'); }
  function setFs(on) {
    ui.fs = on;
    document.body.classList.toggle('fs', on);
    document.querySelectorAll('[data-fs]').forEach((b) => { b.textContent = on ? '✕' : '⛶'; b.setAttribute('aria-label', on ? 'Выйти из полноэкранного режима' : 'На весь экран'); });
    measureDock();
    if (!on) applyVb();
    try {
      if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (e) { /* полноэкранный API недоступен — остаётся режим страницы */ }
  }
  function bind() {
    $('bOpen').addEventListener('click', () => sim.cmd(true));
    $('bClose').addEventListener('click', () => sim.cmd(false));
    $('bPaz').addEventListener('click', () => sim.paz(!sim.state.pazTrip));
    $('bPst').addEventListener('click', () => sim.startPst());
    document.querySelectorAll('[data-fs]').forEach((b) => b.addEventListener('click', () => setFs(!ui.fs)));
    $('dPlay').addEventListener('click', () => DV.play(0, 1));
    $('dBack').addEventListener('click', () => { showScheme(); if (!seq && !cardNode) highlight(null); });
    $('fWhere').addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (b) { openCard(b.dataset.part); stage.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
    window.addEventListener('resize', measureDock);
    $('zAll').addEventListener('click', zoomAll);
    $('cClose').addEventListener('click', closeCard);
    $('capNext').addEventListener('click', () => { if (seqI >= seq.steps.length - 1) stopSeq(); else { seqI++; showStep(true); } });
    $('capPrev').addEventListener('click', () => { if (seqI > 0) { seqI--; showStep(false); } });
    $('capStop').addEventListener('click', stopSeq);
    $('seqs').innerHTML = SEQS.map((s, k) => `<button class="btn" data-seq="${k}">${s.name}</button>`).join('');
    $('seqs').addEventListener('click', (e) => { const b = e.target.closest('[data-seq]'); if (b) { startSeq(+b.dataset.seq); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
    // справка
    const parts = ['fr', 'tee', 'pos', 'sovR', 'sovP', 'booster', 'act', 'shaft', 'valve', 'bkv'];
    $('help').innerHTML = HELP.general.map((p) => `<p>${p}</p>`).join('') +
      '<p style="color:var(--muted);font-size:.86em">Детали — тап откроет карточку и наведёт схему:</p><div class="parts">' +
      parts.map((n) => `<button class="btn" data-part="${n}">${HELP[n].t.replace(/ \(.*\)/, '')}</button>`).join('') + '</div>';
    $('help').addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (b) { openCard(b.dataset.part); stage.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
    // неисправности
    $('selFault').innerHTML = '<option value="">нет</option>' + Object.keys(E.FAULTS).map((k) => `<option value="${k}">${FAULT_RU[k][0]}</option>`).join('');
    $('selFault').addEventListener('change', (e) => setFault(e.target.value));
    // воздух
    $('inSup').addEventListener('input', (e) => { ui.pSup = +e.target.value; $('vSupS').textContent = fmtP(ui.pSup); sim.set({ supply: { p: ui.pSup } }); });
    $('selUnit').addEventListener('change', (e) => { ui.unit = e.target.value; store.set('unit', ui.unit); $('vSupS').textContent = fmtP(ui.pSup); });
    // вид
    $('tgLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; svg.classList.toggle('nolabels', !ui.labels); });
    $('spd1').addEventListener('click', () => setSpeed(1));
    $('spd025').addEventListener('click', () => setSpeed(0.25));
    $('btnPause').addEventListener('click', () => { ui.paused = !ui.paused; $('btnPause').setAttribute('aria-pressed', ui.paused); applyVb(); });
    $('btnReset').addEventListener('click', () => {
      ui.pSup = 4.5; $('inSup').value = 4.5; $('vSupS').textContent = fmtP(4.5);
      if (seq) stopSeq(); closeCard(); setFault(''); newSim(); zoomAll(); setSpeed(1);
    });
    $('selSkin').addEventListener('change', (e) => setSkin(e.target.value));
    $('btnFsUp').addEventListener('click', () => setScale(1));
    $('btnFsDown').addEventListener('click', () => setScale(-1));
  }
  const SCALES = [0.9, 1, 1.15, 1.3];
  let scaleIdx = 1;
  function setScale(d) { scaleIdx = Math.max(0, Math.min(3, scaleIdx + d)); root.style.setProperty('--scale', SCALES[scaleIdx]); store.set('scale', scaleIdx); }
  function setSkin(v) { if (v) root.setAttribute('data-skin', v); else root.removeAttribute('data-skin'); $('selSkin').value = v; store.set('skin', v); readColors(); }

  // ---------- цикл ----------
  let last = 0, frameN = 0;
  function frame(now) {
    const dtR = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const dt = ui.paused ? 0 : dtR * ui.speed;
    if (dt > 0) sim.step(dt);
    stepTween(now);
    const o = sim.state;
    render(o, dt);
    if (view === 'detail') DV.tick(o, DV.playing ? dtR : dt);
    if (++frameN % 3 === 0) trend(o);
    requestAnimationFrame(frame);
  }

  // ---------- старт ----------
  buildTubes(); buildCyl();
  const merEl = [0, 1, 2, 3].map(() => mk('path', {}, $('ballMer')));
  buildSov('gSovP', 196, 'SOV ПАЗ'); buildSov('gSovR', 256, 'SOV РСУ');
  ui.unit = store.get('unit', 'bar'); $('selUnit').value = ui.unit; $('vSupS').textContent = fmtP(ui.pSup);
  scaleIdx = store.get('scale', 1); setScale(0);
  setSkin(store.get('skin', ''));
  bind(); newSim(); applyVb(); readColors(); measureDock();
  if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', readColors); }
  new MutationObserver(readColors).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });
  $('ver').textContent = 'sim-core ' + C.VERSION + ' · sim-esd ' + E.VERSION + ' · сцена F2.2a v0.3';
  requestAnimationFrame(frame);
  window.__ci = { get sim() { return sim; }, get view() { return view; }, DV, setFs, showScheme, openCard, startSeq, stopSeq, focusNode, zoomAll, setSkin, setFault, vb: () => Object.assign({}, vb), next: () => $('capNext').click() };
})();
