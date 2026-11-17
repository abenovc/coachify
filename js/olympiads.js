/* База олимпиадных задач: просмотр по олимпиадам и годам, список «на потом», статусы учеников, заметки с разбором. */
const OSTAT = { '': 'не задана', todo: 'задана', solved: 'решена', done: 'разобрана' };
const OSTAT_CLS = { todo: 'st-learning', solved: 'st-done', done: 'st-done' };
const MY = { key: 'my', name: 'Мои', full: 'Задачи и туры, которые вы добавили сами', region: 'my' };
const OLY = (() => {
  const meta = Object.fromEntries(OLYMPIADS.concat(MY).map(o => [o.key, o]));
  const builtin = OLY_TASKS.map(([id, o, y, g, t, s, k, pdf, src, rating]) => {
    const base = { id, o, y, yn: parseInt(y, 10) || 0, g, t, s, k, pdf, src: src || '', rating: rating || 0, onOj: false, whole: false };
    if (src === 'gym') return { ...base, whole: true, url: 'https://codeforces.com/gym/' + id.slice(3) };
    if (src === 'esep') return { ...base, url: 'https://esep-old.cpfed.kz/problem/' + id.slice(5) };
    if (src === 'url') return { ...base, pdf: '', url: pdf };
    if (src === 'cf') { const m = /^(\d+)(.+)$/.exec(id); return { ...base, url: `https://codeforces.com/problemset/problem/${m[1]}/${m[2]}` }; }
    const onOj = !/^IOI\d\d_(p\d+|round)/.test(id);
    return { ...base, onOj, url: onOj ? 'https://oj.uz/problem/view/' + id : pdf };
  });
  const builtinById = new Map(builtin.map(t => [t.id, t]));
  const mine = () => Store.s.myOly.map(m => ({ id: m.id, o: 'my', y: m.y || '', yn: parseInt(m.y, 10) || 0, g: m.g || '', t: m.t, s: 0, k: [], pdf: '', src: 'my', rating: 0, onOj: false, whole: false, url: m.url || '' }));
  return {
    meta, builtinCount: builtin.length,
    get tasks() { return builtin.concat(mine()); },
    of: key => (key === 'my' ? mine() : builtin.filter(t => t.o === key)),
    count: key => (key === 'my' ? Store.s.myOly.length : builtin.reduce((a, t) => a + (t.o === key ? 1 : 0), 0)),
    byId: { get: id => builtinById.get(id) || mine().find(t => t.id === id) },
  };
})();
const OLY_COUNTS = Object.fromEntries(OLYMPIADS.map(o => [o.key, OLY.count(o.key)]));

const of = { o: 'ioi', student: '', filter: 'all', sort: 'year', open: '', init: false };
const olyState = id => Store.s.oly[id] || {};
function olyEdit(id, fn) {
  const x = Store.s.oly[id] || (Store.s.oly[id] = { star: false, note: '', st: {} });
  fn(x);
  if (!x.star && !x.note && !Object.keys(x.st).length) delete Store.s.oly[id];
}
const olyTitle = t => (t.whole ? `${t.t}${t.y ? ' (' + t.y + ')' : ''}` : `${t.o === 'my' ? t.g : OLY.meta[t.o].name} ${t.y} · ${t.t}`.trim().replace(/^· /, ''));
// Задачи из архива Codeforces добавляются как обычные задачи CF — тогда для них работает автопроверка.
const olyProb = t => (t.src === 'cf' ? { src: 'cf', id: t.id, name: t.t, rating: t.rating, tags: [], url: t.url, topicId: '' } : { src: 'oly', id: t.id, name: olyTitle(t), rating: 0, tags: t.k, url: t.url });
const olySource = t => (t.onOj ? `решили ${t.s} на oj.uz` : t.whole ? 'тур целиком · тренировки Codeforces, можно писать виртуально' : t.src === 'cf' ? 'архив Codeforces' : t.src === 'esep' ? 'esep.cpfed.kz · можно сдать решение' : t.src === 'url' ? 'условие — на странице контеста esep' : t.src === 'my' ? '' : 'только условие (PDF)');

VIEWS.olympiads = () => {
  if (!of.init) { of.init = true; of.student = route.q.get('student') || ''; }
  if (route.q.get('student')) of.student = route.q.get('student');
  const st = Store.student(of.student);
  if (!st) of.student = '';
  const all = of.o === '*' ? OLY.tasks : OLY.of(of.o);
  const sStat = t => (st ? (olyState(t.id).st || {})[st.id] || '' : '');
  const list = all.filter(t => {
    const x = olyState(t.id);
    if (of.filter === 'star') return x.star;
    if (of.filter === 'note') return !!x.note;
    if (of.filter === 'fresh') return st ? !sStat(t) : !Object.keys(x.st || {}).length;
    if (['todo', 'solved', 'done'].includes(of.filter)) return st ? sStat(t) === of.filter : Object.values(x.st || {}).includes(of.filter);
    return true;
  });
  const targetHtml = targetSelect();   // сначала: сбрасывает цель, если урок или контест уже завершён
  const target = addTarget, added = targetIds();
  const meta = OLY.meta[of.o];
  const solvedCount = st ? all.filter(t => ['solved', 'done'].includes(sStat(t))).length : 0;

  const row = (t, flat) => {
    const x = olyState(t.id), open = of.open === t.id;
    return `<div class="otask" data-name="${esc(t.t.toLowerCase())}">
      <div class="prob">
        <button class="star${x.star ? ' on' : ''}" data-act="oly-star" data-id="${esc(t.id)}" title="${x.star ? 'Убрать из отложенных' : 'Отложить на потом'}" aria-label="Отложить">★</button>
        <div class="grow">
          ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.t)}</a>` : `<b>${esc(t.t)}</b>`}
          ${t.rating ? ratingChip(t.rating) : ''}
          ${t.k.map(k => `<span class="chip tiny">${esc(k)}</span>`).join('')}
          ${st ? '' : Object.entries(x.st || {}).map(([sid, v]) => { const s = Store.student(sid); return s ? `<span class="chip tiny ${OSTAT_CLS[v] || ''}">${esc(s.name)}: ${OSTAT[v]}</span>` : ''; }).join('')}
          <div class="tags">${esc([flat ? `${OLY.meta[t.o].name} ${t.y}` : '', flat ? t.g : '', olySource(t)].filter(Boolean).join(' · '))}</div>
        </div>
        ${t.onOj && t.pdf ? `<a class="btn ghost small" href="${esc(t.pdf)}" target="_blank" rel="noopener" title="Официальное условие">PDF</a>` : ''}
        ${st ? `<select data-in="oly-st" data-id="${esc(t.id)}" class="${OSTAT_CLS[sStat(t)] || ''}" aria-label="Статус">${Object.entries(OSTAT).map(([k, v]) => opt(k, v, sStat(t))).join('')}</select>` : ''}
        <button class="btn ghost small${x.note ? ' has' : ''}" data-act="oly-note" data-id="${esc(t.id)}">${x.note ? 'разбор ●' : 'разбор'}</button>
        ${t.src === 'my' ? `<button class="btn ghost icon" data-act="my-del" data-id="${esc(t.id)}" title="Удалить">✕</button>` : ''}
        ${target ? (added.has(t.id) ? '<span class="chip st-done">добавлена</span>' : `<button class="btn small" data-act="oly-add" data-id="${esc(t.id)}">＋</button>`) : ''}
      </div>
      ${open ? `<textarea class="onote" data-in="oly-note" data-id="${esc(t.id)}" rows="3" placeholder="Идея решения, подзадачи, ссылка на разбор, кому из учеников подойдёт">${esc(x.note || '')}</textarea>` : ''}
    </div>`;
  };

  let body;
  if (!list.length) body = `<div class="card"><p class="muted">${of.o === 'my' && !all.length ? 'Здесь пока пусто — добавьте задачи формой выше.' : 'Под этот фильтр ничего не подходит.'}</p></div>`;
  else if (of.sort === 'solved' || of.o === '*') {
    const sorted = list.slice().sort((a, b) => (b.s - a.s) || ((a.rating || 9999) - (b.rating || 9999)) || (b.yn - a.yn));
    body = `<div class="card ygroup">${sorted.slice(0, 300).map(t => row(t, true)).join('')}</div>${sorted.length > 300 ? '<p class="hint">Показаны первые 300 — уточните фильтр.</p>' : ''}`;
  } else {
    const years = [...new Set(list.map(t => t.y))].sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0) || b.localeCompare(a));
    body = years.map(y => {
      const ts = list.filter(t => t.y === y);
      const groups = [...new Set(ts.map(t => t.g))];
      const info = of.o === 'ioi' ? IOI_YEARS[y] : null;
      return `<div class="card ygroup">
        <div class="head"><h2>${esc(of.o === 'my' ? '' : meta.name)} ${esc(y || 'Без года')}</h2>
          <div class="row">${info ? `<a class="chip link" href="${esc(info.page)}" target="_blank" rel="noopener">страница IOI ↗</a>${info.files.map(([n, u]) => `<a class="chip link" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('')}` : ''}</div>
        </div>
        ${groups.map(g => `<div class="ogroup">
          <div class="head"><h3>${esc(g || (ts.some(t => t.whole) ? 'Туры' : 'Задачи'))}</h3>
            ${ts.some(t => t.g === g && !t.whole) ? `<button class="btn ghost small" data-act="oly-contest" data-y="${esc(y)}" data-g="${esc(g)}">сделать контестом</button>` : ''}</div>
          ${ts.filter(t => t.g === g).map(t => row(t, false)).join('')}</div>`).join('')}
      </div>`;
    }).join('');
  }

  return `
    ${pageHead('Олимпиады', `${OLY.builtinCount} задач и туров прошлых лет: решать, разбирать, превращать в контесты`)}
    ${[['int', 'Международные и зарубежные'], ['cis', 'Казахстан и СНГ']].map(([region, label]) => `
    <div class="tabs"><span class="tabs-label">${label}</span>${OLYMPIADS.filter(o => o.region === region).map(o => `<button class="tab${of.o === o.key ? ' on' : ''}" data-act="oly-tab" data-o="${o.key}" title="${esc(o.full)}">${esc(o.name)} <small>${OLY_COUNTS[o.key]}</small></button>`).join('')}</div>`).join('')}
    <div class="tabs"><span class="tabs-label">Своё</span><button class="tab${of.o === 'my' ? ' on' : ''}" data-act="oly-tab" data-o="my">Мои <small>${Store.s.myOly.length}</small></button>
      <button class="tab${of.o === '*' ? ' on' : ''}" data-act="oly-tab" data-o="*">Все сразу <small>${OLY.builtinCount + Store.s.myOly.length}</small></button></div>
    ${of.o === 'my' ? myForm() : ''}
    <div class="card filters"><div class="fields">
      <label>Поиск по названию <input type="search" data-in="oly-search" placeholder="например, Wombats"></label>
      <label>Показать <select data-in="of" data-f="filter">
        ${opt('all', 'все задачи', of.filter)}${opt('star', '★ отложенные на потом', of.filter)}${opt('todo', 'заданные', of.filter)}${opt('solved', 'решённые', of.filter)}${opt('done', 'разобранные', of.filter)}${opt('fresh', 'ещё не тронутые', of.filter)}${opt('note', 'с моим разбором', of.filter)}</select></label>
      <label>Порядок <select data-in="of" data-f="sort">${opt('year', 'по годам и турам', of.sort)}${opt('solved', 'сначала те, что решило больше людей', of.sort)}</select></label>
      <label>Отметки ученика <select data-in="of" data-f="student">${studentOptions(of.student, opt('', '— все ученики —', of.student))}</select></label>
      <label>Добавлять в урок или контест ${targetHtml}</label>
    </div>
    <p class="hint">${meta ? `<b>${esc(meta.full)}.</b> ` : ''}${st ? `${esc(st.name)}: решено ${solvedCount} из ${all.length}. ` : ''}${olyHint()}</p></div>
    ${body}`;
};

function olyHint() {
  if (of.o === 'cpfed') return `Задачи с открытого архива <a href="https://esep-old.cpfed.kz" target="_blank" rel="noopener">esep-old.cpfed.kz</a>: условия читаются без входа, для сдачи решений нужен аккаунт CPFED. Более новые контесты — на <a href="https://cpfed.kz/ru/contests" target="_blank" rel="noopener">cpfed.kz</a>.`;
  if (of.o === 'kz') return `Соревнования Казахстана из тренировок Codeforces. Республиканская олимпиада, ЧРК и KBO — во вкладке «CPFED · esep».`;
  if (of.o === 'my') return 'Ваши собственные задачи и туры: с esep.cpfed.kz, из закрытых групп Codeforces, с acm.timus, e-olymp — откуда угодно.';
  const m = OLY.meta[of.o];
  if (m && m.region === 'cis') return 'Строка «тур целиком» ведёт в тренировку Codeforces: там условия всех задач тура и виртуальное участие. Задачи с рейтингом лежат в обычном архиве Codeforces — в уроках и контестах они проверяются автоматически.';
  return 'Название ведёт на oj.uz — там можно прочитать условие и бесплатно сдать решение. Чем больше людей решило задачу, тем она, как правило, проще.';
}

// ───────────────────────── свои задачи и туры
function myForm() {
  const groups = [...new Set(Store.s.myOly.map(m => m.g).filter(Boolean))];
  return `<form class="card" id="my-form" onsubmit="return false"><h2>Добавить свои задачи</h2>
    <div class="fields">
      <label>Олимпиада или тур <input name="g" list="my-groups" placeholder="Республиканская олимпиада, 1 тур"></label>
      <label>Год <input name="y" placeholder="2025" inputmode="numeric"></label>
      <label class="wide">Задачи <span class="hint">по одной в строке: название и ссылка. Можно без ссылки.</span>
        <textarea name="list" rows="4" placeholder="A. Сумма на отрезке https://esep.cpfed.kz/...\nB. Дороги https://codeforces.com/group/.../problem/B"></textarea></label>
    </div>
    <datalist id="my-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="row"><button class="btn primary" data-act="my-add">Добавить</button></div></form>`;
}
ACT['my-add'] = () => {
  const f = new FormData($('#my-form'));
  const g = f.get('g').trim(), y = f.get('y').trim();
  let n = 0;
  for (const line of lines(f.get('list'))) {
    const m = /(https?:\/\/\S+)/.exec(line);
    const title = line.replace(m ? m[1] : '', '').replace(/[\s—–|:-]+$/, '').trim() || (m ? m[1] : '');
    if (!title) continue;
    Store.s.myOly.push({ id: 'my' + uid() + n, g, y, t: title, url: m ? m[1] : '' });
    n++;
  }
  if (!n) return toast('Впишите хотя бы одну задачу', 'err');
  Store.save(); render(); toast(`Добавлено: ${n}`);
};
ACT['my-del'] = el => {
  Store.s.myOly = Store.s.myOly.filter(m => m.id !== el.dataset.id);
  delete Store.s.oly[el.dataset.id];
  keepScroll();
};

ACT['oly-tab'] = el => { of.o = el.dataset.o; of.open = ''; render(); window.scrollTo(0, 0); };
IN.of = el => { of[el.dataset.f] = el.value; if (el.dataset.f === 'student') history.replaceState(null, '', '#/olympiads'); render(); };
IN['oly-search'] = el => {
  const q = el.value.trim().toLowerCase();
  app.querySelectorAll('.ygroup').forEach(card => {
    let any = false;
    card.querySelectorAll('.ogroup').forEach(g => {
      let anyG = false;
      g.querySelectorAll('.otask').forEach(it => { const show = it.dataset.name.includes(q); it.hidden = !show; anyG = anyG || show; });
      g.hidden = !anyG; any = any || anyG;
    });
    if (!card.querySelector('.ogroup')) card.querySelectorAll('.otask').forEach(it => { const show = it.dataset.name.includes(q); it.hidden = !show; any = any || show; });
    card.hidden = !any;
  });
};
const keepScroll = () => { Store.save(); const y = window.scrollY, q = ($('[data-in="oly-search"]') || {}).value; render(); if (q) { const s = $('[data-in="oly-search"]'); s.value = q; IN['oly-search'](s); } window.scrollTo(0, y); };
ACT['oly-star'] = el => { olyEdit(el.dataset.id, x => { x.star = !x.star; }); keepScroll(); };
ACT['oly-note'] = el => { of.open = of.open === el.dataset.id ? '' : el.dataset.id; keepScroll(); const ta = $('.onote'); if (ta) ta.focus(); };
IN['oly-note'] = el => { olyEdit(el.dataset.id, x => { x.note = el.value; }); Store.saveSoon(); };
IN['oly-st'] = el => {
  const sid = of.student;
  olyEdit(el.dataset.id, x => { if (el.value) x.st[sid] = el.value; else delete x.st[sid]; });
  keepScroll();
};
ACT['oly-add'] = el => { const t = OLY.byId.get(el.dataset.id); if (t) { addToTarget(olyProb(t)); keepScroll(); } };
ACT['oly-contest'] = el => {
  const ts = OLY.of(of.o).filter(t => t.y === el.dataset.y && t.g === el.dataset.g && !t.whole);
  const c = { id: uid(), title: `${of.o === 'my' ? '' : OLY.meta[of.o].name + ' '}${el.dataset.y}${el.dataset.g ? ' · ' + el.dataset.g : ''}`.trim(), start: '', duration: 300,
    studentIds: of.student ? [of.student] : [], problems: ts.map(olyProb), results: {}, manual: {}, notes: '', mode: 'any', skipSolved: true };
  Store.s.contests.push(c); Store.save();
  go('#/contest/' + c.id);
  toast('Контест создан: отметьте участников и назначьте время');
};

// Карточка в профиле ученика.
function olyStudentCard(st) {
  const mine = Object.entries(Store.s.oly).map(([id, x]) => ({ t: OLY.byId.get(id), v: (x.st || {})[st.id] })).filter(e => e.t && e.v);
  const n = v => mine.filter(e => e.v === v).length;
  const todo = mine.filter(e => e.v === 'todo').slice(0, 8);
  return `<div class="card"><div class="head"><h2>Олимпиадные задачи</h2><a class="btn small" href="#/olympiads?student=${st.id}">Открыть базу</a></div>
    ${mine.length ? `<p><span class="chip st-learning">задано ${n('todo')}</span> <span class="chip st-done">решено ${n('solved')}</span> <span class="chip st-done">разобрано ${n('done')}</span></p>
      ${todo.length ? `<div class="list">${todo.map(e => `<div class="item"><a class="grow" href="${esc(e.t.url)}" target="_blank" rel="noopener">${esc(olyTitle(e.t))}</a><span class="muted small">${e.t.onOj ? 'решили ' + e.t.s : ''}</span></div>`).join('')}</div>` : ''}`
    : '<p class="muted">Пока ничего не задано. В базе — задачи IOI, APIO, IZhO и других олимпиад: отмечайте, что ученик решил и что разобрали.</p>'}
  </div>`;
}
