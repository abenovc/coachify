/* Контесты: сборка набора задач, объявление для учеников, таблица результатов по посылкам на Codeforces. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const curContest = () => Store.contest(route.arg);
const startMs = c => (c.start ? new Date(c.start).getTime() : 0);
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'время не назначено';
const hms = sec => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`; };
const localInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function contestPhase(c) {
  const s = startMs(c), now = Date.now();
  if (!s) return { id: 'draft', label: 'время не назначено', cls: '' };
  const end = s + c.duration * 60000;
  if (now < s) return { id: 'before', label: 'до начала ' + hms((s - now) / 1000), cls: 'st-learning' };
  if (now < end) return { id: 'running', label: 'идёт · осталось ' + hms((end - now) / 1000), cls: 'st-done' };
  return { id: 'over', label: 'завершён', cls: '' };
}

// Участники: все ученики выбранных групп и индивидуальные ученики.
function contestMembers(c) {
  const out = [], seen = new Set();
  for (const st of c.studentIds.map(Store.student).filter(Boolean)) {
    st.members.forEach((m, i) => {
      const handle = (m.handle || '').trim();
      if (isGroup(st) && !handle && !m.name) return;
      const key = handle.toLowerCase() || `m:${st.id}:${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, handle, name: isGroup(st) ? (m.name || handle) : (st.name || handle || 'Без имени') });
    });
  }
  return out;
}

function contestRows(list) {
  return `<div class="list">${list.map(c => {
    const ph = contestPhase(c);
    const names = c.studentIds.map(Store.student).filter(Boolean).map(s => s.name).join(', ');
    return `<a class="item" href="#/contest/${c.id}">
      <span class="date wide">${fmtDateTime(c.start)}</span>
      <span class="grow"><b>${esc(c.title)}</b><span class="muted"> · ${c.problems.length} задач${names ? ' · ' + esc(names) : ''}</span></span>
      <span class="chip ${ph.cls}">${ph.id === 'running' ? 'идёт' : ph.id === 'before' ? 'скоро' : ph.id === 'over' ? 'завершён' : 'черновик'}</span>
    </a>`;
  }).join('')}</div>`;
}

VIEWS.contests = () => {
  const list = Store.s.contests.slice().reverse();
  return `
    ${pageHead('Контесты', 'Тренировочные соревнования с автоматической таблицей результатов', '<a class="btn primary" href="#/newcontest">Новый контест</a>')}
    <div class="card">${list.length ? contestRows(list) : `<p class="muted">Контестов пока нет. Соберите контест из задач Codeforces —
      или откройте <a href="#/olympiads">Олимпиады</a> и превратите в контест любой тур прошлых лет.</p>`}</div>`;
};

// ───────────────────────── новый контест
VIEWS.newcontest = () => {
  const { students } = Store.s;
  const pre = route.q.get('student');
  const avg = students.length ? Math.round(students.reduce((a, s) => a + (s.rating || 1000), 0) / students.length / 100) * 100 : 1200;
  const next = new Date(); next.setMinutes(0, 0, 0); next.setHours(next.getHours() + 1);
  return `
    ${pageHead('Новый контест')}
    <form class="card" id="contest-form" onsubmit="return false">
      <div class="fields">
        <label class="wide">Название <input name="title" value="Тренировочный контест"></label>
        <label>Начало <span class="hint">можно назначить позже</span><input type="datetime-local" name="start" value="${localInput(next.getTime())}"></label>
        <label>Длительность, мин <input type="number" name="duration" value="120" min="10" max="600" step="5"></label>
      </div>
      <h3>Участники</h3>
      ${students.length ? `<div class="chips">${students.map(s => `<label class="chip pick"><input type="checkbox" name="st" value="${s.id}" ${pre ? (pre === s.id ? 'checked' : '') : 'checked'}> ${esc(s.name || 'Без имени')} ${ratingChip(s.rating)}</label>`).join('')}</div>`
        : '<p class="muted">Учеников пока нет — контест можно собрать и без участников.</p>'}
      <h3>Задачи с Codeforces</h3>
      <div class="fields">
        <label>Сколько задач <input type="number" name="count" value="5" min="0" max="26"></label>
        <label>Рейтинг первой <input type="number" name="lo" value="${Math.max(800, avg - 200)}" min="800" max="3500" step="100"></label>
        <label>Рейтинг последней <input type="number" name="hi" value="${avg + 400}" min="800" max="3500" step="100"></label>
        <label class="wide">Темы <select name="topics">
          ${opt('passed', 'Пройденные участниками темы', 'passed')}${opt('any', 'Любые темы', 'passed')}${topicOptions('', null)}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="skipSolved" checked> Не брать задачи, которые кто-то из участников уже решил или получал на уроках</label>
      <p class="hint">Сложность растёт от первой задачи к последней. Чтобы собрать контест из олимпиадных задач, поставьте «0» — и добавьте задачи со страницы «Олимпиады».</p>
      <div class="row"><button class="btn primary" data-act="build-contest">Собрать контест</button></div>
    </form>`;
};

function contestExclude(studentIds, skipSolved) {
  const set = new Set();
  for (const st of studentIds.map(Store.student).filter(Boolean)) excludeSet(st, skipSolved).forEach(id => set.add(id));
  for (const c of Store.s.contests) if (c.studentIds.some(id => studentIds.includes(id))) c.problems.forEach(p => set.add(p.id));
  return set;
}
const contestProb = (p, topicId) => ({ src: 'cf', id: p.id, name: p.n, rating: p.r, tags: p.t, url: CF.url(p), topicId: topicId || '' });

ACT['build-contest'] = async el => {
  const f = new FormData($('#contest-form'));
  const studentIds = f.getAll('st');
  const count = Math.min(26, Math.max(0, parseInt(f.get('count'), 10) || 0));
  const lo = Math.max(800, parseInt(f.get('lo'), 10) || 800), hi = Math.max(lo, parseInt(f.get('hi'), 10) || lo);
  const mode = f.get('topics');
  const contest = { id: uid(), title: f.get('title').trim() || 'Контест', start: f.get('start') || '', duration: Math.max(10, parseInt(f.get('duration'), 10) || 120),
    studentIds, problems: [], results: {}, manual: {}, notes: '', mode, skipSolved: !!f.get('skipSolved') };

  let warn = '';
  if (count) {
    el.disabled = true; el.textContent = 'Подбираю задачи…';
    try {
      await CF.loadProblems();
      const handles = studentIds.map(Store.student).filter(Boolean).flatMap(handlesOf);
      await Promise.all(handles.map(h => CF.loadUser(h).catch(() => null)));
    } catch (e) { warn = 'Codeforces недоступен — контест создан без задач.'; }
    if (CF.ready) {
      const exclude = contestExclude(studentIds, contest.skipSolved);
      const pool = contestTopicPool(contest);
      for (let i = 0; i < count; i++) {
        const r = Math.round((lo + (count > 1 ? (hi - lo) * i / (count - 1) : 0)) / 100) * 100;
        const t = pool[Math.floor(Math.random() * pool.length)];
        pickFor(t, { lo: r, hi: r }, 1, exclude).forEach(p => contest.problems.push(contestProb(p, t.id)));
      }
      contest.problems.sort((a, b) => a.rating - b.rating);
      if (contest.problems.length < count) warn = `Нашлось только ${contest.problems.length} из ${count} задач.`;
    }
  }
  Store.s.contests.push(contest);
  Store.save();
  go('#/contest/' + contest.id);
  if (warn) toast(warn, 'err');
};

// Темы, из которых набираются задачи: выбранная, пройденные участниками или любые ({} = без ограничения по тегам).
function contestTopicPool(c) {
  if (c.mode && c.mode !== 'passed' && c.mode !== 'any') { const t = Store.topic(c.mode); if (t) return [t]; }
  if (c.mode !== 'any') {
    const ids = new Set(c.studentIds.map(Store.student).filter(Boolean).flatMap(st => doneTopics(st).map(t => t.id)));
    if (ids.size) return [...ids].map(Store.topic);
  }
  return [{}];
}

// ───────────────────────── страница контеста
VIEWS.contest = () => {
  const c = curContest();
  if (!c) return notFound('Контест не найден');
  const ph = contestPhase(c);
  const members = contestMembers(c);
  const hasCf = c.problems.some(p => p.src === 'cf');

  return `
    <a class="back no-print" href="#/contests">← Контесты</a>
    <div class="head">
      <input class="title" data-in="ct-f" data-f="title" value="${esc(c.title)}" aria-label="Название контеста">
      <span class="chip big ${ph.cls}" id="ctimer">${ph.label}</span>
    </div>
    <div class="meta">
      <label>Начало <input type="datetime-local" data-in="ct-f" data-f="start" value="${esc(c.start)}"></label>
      <label>Длительность <input type="number" class="narrow" data-in="ct-f" data-f="duration" value="${c.duration}" min="10" max="600" step="5"> мин</label>
    </div>
    <div class="row toolbar no-print">
      ${ph.id !== 'running' ? '<button class="btn primary" data-act="ct-start">Начать сейчас</button>' : ''}
      <button class="btn" data-act="ct-copy">Объявление для учеников</button>
      ${hasCf ? '<button class="btn" data-act="ct-mashup" title="Список номеров задач для создания мэшапа на Codeforces">Номера для мэшапа</button>' : ''}
      <button class="btn" data-act="print">Печать</button>
      <button class="btn ghost danger" data-act="ct-del">Удалить</button>
    </div>

    <div class="card"><h2>Участники</h2>
      ${Store.s.students.length ? `<div class="chips">${Store.s.students.map(s => `<label class="chip pick"><input type="checkbox" data-in="ct-st" value="${s.id}" ${c.studentIds.includes(s.id) ? 'checked' : ''}> ${esc(s.name || 'Без имени')}</label>`).join('')}</div>`
        : '<p class="muted">Добавьте учеников на главной странице.</p>'}
    </div>

    <div class="card"><div class="head"><h2>Задачи</h2>
      <button class="btn ghost small no-print" data-act="ct-more">＋ подобрать ещё с Codeforces</button></div>
      ${c.problems.map((p, i) => `
        <div class="prob">
          <span class="letter">${LETTERS[i] || i + 1}</span>
          <div class="grow">
            ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${p.src === 'cf' ? esc(p.id) + '. ' : ''}${esc(p.name)}</a>` : esc(p.name)}
            ${p.rating ? ratingChip(p.rating) : ''}
            <div class="tags">${esc((p.tags || []).join(' · '))}</div>
          </div>
          <button class="btn ghost icon no-print" data-act="ct-up" data-i="${i}" title="Поднять выше" ${i ? '' : 'disabled'}>↑</button>
          ${p.src === 'cf' ? `<button class="btn ghost icon no-print" data-act="ct-reroll" data-i="${i}" title="Заменить другой задачей">↻</button>` : ''}
          <button class="btn ghost icon no-print" data-act="ct-rm" data-i="${i}" title="Убрать">✕</button>
        </div>`).join('') || '<p class="muted">Задач пока нет. Подберите с Codeforces, добавьте по ссылке или возьмите на странице <a href="#/olympiads">Олимпиады</a>.</p>'}
      <div class="row no-print addrow">
        <input id="ct-ref" class="grow" placeholder="Ссылка или номер на Codeforces, например 1520D" autocapitalize="off" spellcheck="false">
        <input id="ct-name" placeholder="Название (если не Codeforces)">
        <button class="btn" data-act="ct-add">Добавить</button>
      </div>
    </div>

    <div class="card"><div class="head"><h2>Результаты</h2>
      ${hasCf && members.some(m => m.handle) ? '<button class="btn no-print" data-act="ct-check">Обновить с Codeforces</button>' : ''}</div>
      ${standings(c, members)}
    </div>

    <div class="card"><h2>Разбор и заметки</h2>
      <textarea data-in="ct-f" data-f="notes" rows="3" placeholder="Идеи решений, кто на чём застрял, что дорешать">${esc(c.notes)}</textarea>
    </div>`;
};

const isAuto = (p, m) => p.src === 'cf' && !!m.handle;
function cellScore(c, p, m) {
  if (isAuto(p, m)) { const r = (c.results[m.key] || {})[p.id]; return r && r.ok ? 100 : 0; }
  return +((c.manual[m.key] || {})[p.id]) || 0;
}
function standings(c, members) {
  if (!members.length) return '<p class="muted">Отметьте участников — здесь появится таблица.</p>';
  if (!c.problems.length) return '<p class="muted">Добавьте задачи.</p>';
  const rows = members.map(m => {
    let score = 0, penalty = 0;
    for (const p of c.problems) {
      score += cellScore(c, p, m);
      const r = isAuto(p, m) ? (c.results[m.key] || {})[p.id] : null;
      if (r && r.ok) penalty += r.min + 20 * r.tries;
    }
    return { m, score, penalty };
  }).sort((a, b) => b.score - a.score || a.penalty - b.penalty);
  const anyAuto = members.some(m => c.problems.some(p => isAuto(p, m)));

  const cell = (p, m) => {
    if (!isAuto(p, m)) return `<td><input type="number" class="pts" min="0" max="100" step="1" data-in="ct-pts" data-m="${esc(m.key)}" data-p="${esc(p.id)}" value="${esc((c.manual[m.key] || {})[p.id] ?? '')}" placeholder="—" aria-label="Баллы"></td>`;
    const r = (c.results[m.key] || {})[p.id];
    if (!r) return '<td class="muted">·</td>';
    if (r.ok) return `<td class="ok"><b>+${r.tries || ''}</b><small>${Math.floor(r.min / 60)}:${pad(r.min % 60)}</small></td>`;
    if (r.up) return `<td class="up" title="Решил после окончания"><b>✓</b><small>дорешал</small></td>`;
    if (r.pre) return `<td class="muted" title="Решал эту задачу раньше"><small>решал раньше</small></td>`;
    if (r.tries) return `<td class="bad"><b>−${r.tries}</b></td>`;
    return '<td class="muted">·</td>';
  };
  return `
    <div class="scroll"><table class="standings">
      <thead><tr><th>#</th><th class="left">Участник</th><th>Баллы</th>${anyAuto ? '<th title="Минуты до решения + 20 за каждую неудачную попытку">Штраф</th>' : ''}
        ${c.problems.map((p, i) => `<th title="${esc(p.name)}">${LETTERS[i] || i + 1}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="left"><b>${esc(r.m.name)}</b>${r.m.handle && r.m.handle !== r.m.name ? `<small>${esc(r.m.handle)}</small>` : ''}</td>
        <td><b>${r.score}</b></td>${anyAuto ? `<td class="muted">${r.penalty}</td>` : ''}${c.problems.map(p => cell(p, r.m)).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="hint">Задача Codeforces, решённая во время контеста, — 100 баллов. Для остальных задач и участников без хэндла баллы вводятся вручную.
      ${c.checkedAt ? `Данные Codeforces обновлены ${new Date(c.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>`;
}

IN['ct-f'] = el => {
  const c = curContest(), f = el.dataset.f;
  c[f] = f === 'duration' ? Math.max(1, parseInt(el.value, 10) || 0) : el.value;
  Store.saveSoon();
  if (f !== 'title' && f !== 'notes') tickContest();
};
IN['ct-st'] = el => {
  const c = curContest();
  c.studentIds = el.checked ? c.studentIds.concat(el.value) : c.studentIds.filter(id => id !== el.value);
  rerender();
};
IN['ct-pts'] = el => {
  const c = curContest(), m = el.dataset.m;
  c.manual[m] = c.manual[m] || {};
  if (el.value === '') delete c.manual[m][el.dataset.p]; else c.manual[m][el.dataset.p] = Math.max(0, Math.min(100, +el.value || 0));
  Store.saveSoon();
};
// Пересортировываем таблицу, когда тренер закончил вводить баллы.
document.addEventListener('focusout', e => { if (e.target.matches && e.target.matches('.pts') && route.name === 'contest') setTimeout(() => { if (!document.activeElement.matches('.pts')) rerender(); }, 0); });

ACT['ct-start'] = () => { const c = curContest(); c.start = localInput(Date.now()); rerender(); toast('Контест начался'); };
ACT['ct-del'] = () => {
  const c = curContest();
  if (!confirm(`Удалить контест «${c.title}»?`)) return;
  Store.s.contests = Store.s.contests.filter(x => x.id !== c.id);
  Store.save(); go('#/contests');
};
ACT['ct-rm'] = el => { curContest().problems.splice(+el.dataset.i, 1); rerender(); };
ACT['ct-up'] = el => { const ps = curContest().problems, i = +el.dataset.i; if (i > 0) { [ps[i - 1], ps[i]] = [ps[i], ps[i - 1]]; rerender(); } };
ACT['ct-reroll'] = async el => {
  const c = curContest(), i = +el.dataset.i, old = c.problems[i];
  if (!await needProblems()) return;
  const topic = Store.topic(old.topicId) || {};
  const exclude = contestExclude(c.studentIds, c.skipSolved !== false);
  c.problems.forEach(p => exclude.add(p.id));
  const [p] = pickFor(topic, { lo: old.rating || 1200, hi: old.rating || 1200 }, 1, exclude);
  if (!p) return toast('Других подходящих задач не нашлось', 'err');
  c.problems[i] = contestProb(p, old.topicId);
  rerender();
};
ACT['ct-more'] = async () => {
  const c = curContest();
  if (!await needProblems()) return;
  const cf = c.problems.filter(p => p.src === 'cf' && p.rating);
  const r = cf.length ? Math.min(3500, Math.max(...cf.map(p => p.rating)) + 100) : 1200;
  const pool = contestTopicPool(c), t = pool[Math.floor(Math.random() * pool.length)];
  const exclude = contestExclude(c.studentIds, c.skipSolved !== false);
  c.problems.forEach(p => exclude.add(p.id));
  const [p] = pickFor(t, { lo: r, hi: r }, 1, exclude);
  if (!p) return toast('Подходящих задач не нашлось', 'err');
  c.problems.push(contestProb(p, t.id));
  rerender();
};
ACT['ct-add'] = async () => {
  const c = curContest();
  const ref = $('#ct-ref').value.trim(), name = $('#ct-name').value.trim();
  if (!ref && !name) return toast('Укажите ссылку, номер или название', 'err');
  const m = /codeforces\.com\/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)/.exec(ref) || /^(\d{1,4})\s*([A-Za-z]\d?)$/.exec(ref);
  if (m) {
    const id = m[1] + m[2].toUpperCase();
    await needProblems();
    const p = CF.find(id);
    c.problems.push(p ? contestProb(p) : { src: 'cf', id, name: name || 'Задача ' + id, rating: 0, tags: [], url: `https://codeforces.com/problemset/problem/${m[1]}/${m[2].toUpperCase()}` });
  } else {
    const isUrl = /^https?:\/\//.test(ref);
    c.problems.push({ src: 'custom', id: 'x' + uid(), name: name || ref, rating: 0, tags: [], url: isUrl ? ref : '' });
  }
  rerender();
};

function contestAnnouncement(c) {
  let text = `${c.title}\n${c.start ? 'Начало: ' + fmtDateTime(c.start) + '. ' : ''}Длительность: ${c.duration} мин.\n\n`;
  text += c.problems.map((p, i) => `${LETTERS[i] || i + 1}. ${p.name}${p.url ? '\n' + p.url : ''}`).join('\n');
  text += '\n\nРешайте самостоятельно, без подсказок и разборов. Удачи!';
  return text;
}
ACT['ct-copy'] = () => copyText(contestAnnouncement(curContest()), 'Объявление скопировано');
ACT['ct-mashup'] = () => copyText(curContest().problems.filter(p => p.src === 'cf').map(p => p.id).join('\n'),
  'Номера скопированы. Создайте мэшап: codeforces.com/mashup/new');

/* Таблица результатов. По каждой задаче Codeforces смотрим посылки участника:
   до начала — «решал раньше», во время контеста — попытки и время первого OK, после — «дорешал».
   Посылки в мэшапе (у них другой номер контеста) сопоставляются по названию задачи. */
ACT['ct-check'] = async el => {
  const c = curContest();
  if (!startMs(c)) return toast('Сначала укажите время начала контеста', 'err');
  el.disabled = true; el.textContent = 'Загружаю посылки…';
  const start = startMs(c) / 1000, end = start + c.duration * 60;
  let failed = 0;
  for (const m of contestMembers(c)) {
    if (!m.handle) continue;
    let subs;
    try { subs = await CF.loadSubs(m.handle); } catch (e) { failed++; continue; }
    const res = {};
    for (const p of c.problems) {
      if (p.src !== 'cf') continue;
      const r = { ok: false, min: 0, tries: 0, up: false, pre: false };
      for (const s of subs) {
        if (!(s.id === p.id || (s.gym && s.name === p.name))) continue;
        if (s.t < start) { if (s.ok) r.pre = true; continue; }
        if (s.t <= end) {
          if (r.ok) continue;
          if (s.ok) { r.ok = true; r.min = Math.floor((s.t - start) / 60); } else r.tries++;
        } else if (s.ok && !r.ok) r.up = true;
      }
      res[p.id] = r;
    }
    c.results[m.key] = res;
  }
  c.checkedAt = Date.now();
  rerender();
  toast(failed ? `Не удалось загрузить посылки: ${failed}` : 'Результаты обновлены', failed ? 'err' : '');
};

// Таймер на странице контеста.
function tickContest() {
  const el = $('#ctimer');
  if (!el || route.name !== 'contest') return;
  const c = curContest();
  if (!c) return;
  const ph = contestPhase(c);
  if (el.dataset.phase && el.dataset.phase !== ph.id && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return rerender();
  el.dataset.phase = ph.id;
  el.textContent = ph.label;
  el.className = 'chip big ' + ph.cls;
}
setInterval(tickContest, 1000);
