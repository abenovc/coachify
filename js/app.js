/* Интерфейс. Маршруты: #/ · #/student/ID · #/new · #/lessons · #/lesson/ID · #/topics · #/topic/ID · #/problems · #/settings */
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' }) : '—';
const opt = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
const lines = text => String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

const SECTIONS = [
  { id: 'warm', name: 'Разминка', d: [-300, -100] },
  { id: 'class', name: 'На уроке', d: [-100, 100] },
  { id: 'hard', name: 'Со звёздочкой', d: [200, 400] },
  { id: 'home', name: 'Домашнее задание', d: [-100, 200] },
];
const TYPES = {
  new: { name: 'Новая тема', counts: { warm: 1, class: 3, hard: 1, home: 4 } },
  practice: { name: 'Закрепление темы', counts: { warm: 1, class: 4, hard: 1, home: 4 } },
  contest: { name: 'Тренировочный контест', counts: { warm: 0, class: 5, hard: 0, home: 3 } },
};
const STATUS = { '': 'не начата', learning: 'в процессе', done: 'пройдена', review: 'повторить' };
const STATUS_ORDER = ['', 'learning', 'done', 'review'];
const STATUS_MARK = { '': '', learning: '◐ ', done: '✓ ', review: '↻ ' };

// ───────────────────────── общие помощники
function toast(text, kind) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 5000 : 2600);
}
async function copyText(text, okMessage) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast(okMessage || 'Скопировано');
}
const ratingClass = r => !r ? 'r-none' : r < 1200 ? 'r-gray' : r < 1400 ? 'r-green' : r < 1600 ? 'r-cyan' : r < 1900 ? 'r-blue' : r < 2100 ? 'r-violet' : r < 2400 ? 'r-orange' : 'r-red';
const ratingChip = r => `<span class="rating ${ratingClass(r)}">${r || '—'}</span>`;
const handlesOf = st => st.members.map(m => (m.handle || '').trim()).filter(Boolean);
const userData = handle => Cache.peek('user:' + handle.toLowerCase());
const statusOf = (st, topicId) => (st.topics[topicId] || '');
const lessonsOf = st => Store.s.lessons.filter(l => l.studentId === st.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const doneTopics = st => Store.topics().filter(t => ['done', 'review'].includes(statusOf(st, t.id)));
const isGroup = st => st.kind === 'group';

function recommended(st) {
  const all = Store.topics();
  const ok = id => ['done', 'review'].includes(statusOf(st, id));
  const inProgress = all.filter(t => statusOf(st, t.id) === 'learning');
  const open = all.filter(t => !statusOf(st, t.id) && (t.pre || []).every(ok))
    .sort((a, b) => a.lvl - b.lvl || (a.base || 0) - (b.base || 0));
  return inProgress.concat(open);
}

function hwStat(lesson, st) {
  const home = lesson.problems.filter(p => p.section === 'home');
  if (!home.length) return null;
  const hs = st ? handlesOf(st).map(h => h.toLowerCase()) : [];
  const per = Math.max(1, hs.length);
  let solved = 0;
  for (const p of home) solved += p.done ? per : hs.filter(h => (p.solvedBy || []).includes(h)).length;
  return { solved, total: home.length * per };
}
const hwBadge = (lesson, st) => {
  const s = hwStat(lesson, st);
  if (!s) return '';
  return `<span class="chip ${s.solved >= s.total ? 'st-done' : s.solved ? 'st-learning' : ''}">ДЗ ${s.solved}/${s.total}</span>`;
};

function topicOptions(selected, st, firstOption) {
  const all = Store.topics();
  return (firstOption || '') + TOPIC_SECTIONS.map(sec => {
    const list = all.filter(t => t.sec === sec);
    if (!list.length) return '';
    return `<optgroup label="${esc(sec)}">${list.map(t => opt(t.id, (st ? STATUS_MARK[statusOf(st, t.id)] : '') + t.name, selected)).join('')}</optgroup>`;
  }).join('');
}
const studentOptions = (selected, first) => (first || '') + Store.s.students.map(s => opt(s.id, s.name || 'Без имени', selected)).join('');

// ───────────────────────── маршрутизация
let route = { name: 'home', arg: '', q: new URLSearchParams() };
const VIEWS = {};
function render() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, arg] = path.split('/');
  route = { name: VIEWS[name] ? name : 'home', arg: arg || '', q: new URLSearchParams(qs || '') };
  app.innerHTML = VIEWS[route.name]();
  const navName = { student: 'home', new: 'lessons', lesson: 'lessons', topic: 'topics', contest: 'contests', newcontest: 'contests' }[route.name] || route.name;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === navName));
  app.querySelectorAll('textarea').forEach(fit);
}
function fit(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

const ACT = {}, IN = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
});
document.addEventListener('input', e => {
  if (e.target.tagName === 'TEXTAREA') fit(e.target);
  const el = e.target.closest('[data-in]');
  if (el && el.type !== 'file' && IN[el.dataset.in]) IN[el.dataset.in](el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[type=file][data-in]');
  if (el && IN[el.dataset.in]) IN[el.dataset.in](el, e);
});

// ───────────────────────── главная
const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = st => `<span class="avatar ${ratingClass(st.rating)}">${esc(initials(st.name))}</span>`;
const pageHead = (title, sub, actions) => `<div class="head page"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;

VIEWS.home = () => {
  const { students, lessons, contests } = Store.s;
  const addButtons = `<button class="btn primary" data-act="add-student" data-kind="solo">＋ Ученик</button>
        <button class="btn" data-act="add-student" data-kind="group">＋ Группа</button>`;
  if (!students.length) return `
    ${pageHead('Coachify', 'Планы уроков, задачи и контесты для ваших учеников')}
    <div class="card intro">
      <h2>С чего начать</h2>
      <ol class="steps">
        <li><b>Добавьте учеников и группу.</b> Укажите хэндлы Codeforces — тогда задачи будут подбираться с учётом уже решённых.</li>
        <li><b>Отметьте пройденные темы</b> на карте тем ученика — появятся рекомендации, что проходить дальше.</li>
        <li><b>Соберите урок или контест:</b> план по минутам и задачи под уровень ученика.</li>
        <li><b>Загляните в «Олимпиады»:</b> задачи IOI с 1989 года и ещё 18 олимпиад — откладывайте на потом, решайте, записывайте разборы.</li>
      </ol>
      <div class="row">${addButtons}</div>
    </div>`;

  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');
  const planned = lessons.filter(l => !l.done).sort(byDate);
  const toCheck = lessons.filter(l => l.done).sort((a, b) => byDate(b, a))
    .filter(l => { const s = hwStat(l, Store.student(l.studentId)); return s && s.solved < s.total; }).slice(0, 6);
  const stale = !Store.s.lastBackup || Date.now() - Store.s.lastBackup > 14 * 864e5;
  const upcoming = contests.filter(c => contestPhase(c).id !== 'over').slice(-5).reverse();
  const olySolved = Object.values(Store.s.oly).filter(x => Object.values(x.st || {}).some(v => v === 'solved' || v === 'done')).length;
  const stat = (n, label, href) => `<a class="stat" href="${href}"><b>${n}</b><span>${label}</span></a>`;

  return `
    ${pageHead('Coachify', new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }), addButtons)}
    <div class="stats">
      ${stat(lessons.filter(l => l.done).length, 'уроков проведено', '#/lessons')}
      ${stat(planned.length, 'уроков в планах', '#/lessons')}
      ${stat(lessons.reduce((a, l) => a + l.problems.length, 0), 'задач выдано', '#/lessons')}
      ${stat(contests.length, 'контестов', '#/contests')}
      ${stat(olySolved, 'олимпиадных задач решено', '#/olympiads')}
    </div>
    <div class="grid">${students.map(studentCard).join('')}</div>

    <div class="cols">
      <div class="card"><h2>Запланированные уроки</h2>
        ${planned.length ? lessonRows(planned) : '<p class="muted">Нет запланированных уроков. Нажмите «Новый урок» на карточке ученика.</p>'}
      </div>
      <div class="card"><h2>Домашки, которые ещё не дорешаны</h2>
        ${toCheck.length ? lessonRows(toCheck) : '<p class="muted">Все домашние задания закрыты — или ещё не выданы.</p>'}
      </div>
    </div>
    ${upcoming.length ? `<div class="card"><h2>Контесты</h2>${contestRows(upcoming)}</div>` : ''}
    ${stale && lessons.length ? `<p class="note">Данные хранятся только в этом браузере. Давно не было резервной копии — <a href="#/settings">сохраните файл</a>.</p>` : ''}`;
};

function studentCard(st) {
  const ls = lessonsOf(st);
  const last = ls.find(l => l.done);
  const next = recommended(st)[0];
  const total = Store.topics().length;
  const done = doneTopics(st).length;
  return `
    <div class="card student">
      <div class="who">
        ${avatar(st)}
        <div class="grow">
          <a class="name" href="#/student/${st.id}">${esc(st.name || 'Без имени')}</a>
          <div class="muted small">${isGroup(st) ? `Группа · ${st.members.length} уч.` : 'Индивидуально'}${st.schedule ? ' · ' + esc(st.schedule) : ''}</div>
        </div>
        ${ratingChip(st.rating)}
      </div>
      <div class="progress" title="Пройдено тем: ${done} из ${total}"><i style="width:${Math.round(done / total * 100)}%"></i></div>
      <dl>
        <dt>Пройдено тем</dt><dd>${done} из ${total}</dd>
        <dt>Прошлый урок</dt><dd>${last ? `<a href="#/lesson/${last.id}">${esc(last.title)}</a>` : '—'}</dd>
        <dt>Что дальше</dt><dd>${next ? `<a href="#/topic/${next.id}">${esc(next.name)}</a>` : '—'}</dd>
      </dl>
      <div class="row">
        <a class="btn primary" href="#/new?student=${st.id}${next ? '&topic=' + next.id : ''}">Новый урок</a>
        <a class="btn ghost" href="#/student/${st.id}">Профиль</a>
      </div>
    </div>`;
}

function lessonRows(list, hideStudent) {
  return `<div class="list">${list.map(l => {
    const st = Store.student(l.studentId);
    return `<a class="item" href="#/lesson/${l.id}">
      <span class="date">${fmtDate(l.date)}</span>
      <span class="grow"><b>${esc(l.title)}</b>${hideStudent || !st ? '' : `<span class="muted"> · ${esc(st.name)}</span>`}</span>
      ${l.done ? hwBadge(l, st) : '<span class="chip">план</span>'}
    </a>`;
  }).join('')}</div>`;
}

ACT['add-student'] = el => {
  const group = el.dataset.kind === 'group';
  const st = { id: uid(), kind: group ? 'group' : 'solo', name: group ? 'Группа' : '', rating: 1000, goal: '', schedule: '', notes: '',
    members: [{ name: '', handle: '' }], topics: {} };
  Store.s.students.push(st);
  Store.save();
  go('#/student/' + st.id);
};

// ───────────────────────── ученик
const userErr = new Map();
const userBusy = new Set();
function ensureUsers(st) {
  for (const h of handlesOf(st)) {
    const key = h.toLowerCase();
    if (userData(h) || userErr.has(key) || userBusy.has(key)) continue;
    userBusy.add(key);
    CF.loadUser(h).catch(e => { userErr.set(key, e.message); })
      .then(() => { userBusy.delete(key); if (route.name === 'student' && route.arg === st.id) renderKeepFocus(); });
  }
}
// Перерисовка по приходу данных из сети не должна сбивать набор текста.
function renderKeepFocus() {
  const a = document.activeElement;
  if (a && app.contains(a) && /INPUT|TEXTAREA/.test(a.tagName)) { renderKeepFocus.pending = true; return; }
  render();
}
document.addEventListener('focusout', () => {
  if (renderKeepFocus.pending) setTimeout(() => {
    const a = document.activeElement;
    if (!(a && app.contains(a) && /INPUT|TEXTAREA/.test(a.tagName))) { renderKeepFocus.pending = false; render(); }
  }, 50);
});

VIEWS.student = () => {
  const st = Store.student(route.arg);
  if (!st) return notFound('Ученик не найден');
  ensureUsers(st);
  const group = isGroup(st);
  const recs = recommended(st).slice(0, 5);
  const review = Store.topics().filter(t => statusOf(st, t.id) === 'review');
  const ls = lessonsOf(st);

  return `
    <a class="back" href="#/">← Все ученики</a>
    <div class="head">
      <input class="title" data-in="st" data-f="name" value="${esc(st.name)}" placeholder="${group ? 'Название группы' : 'Имя ученика'}" aria-label="Имя">
      <div class="row">
        <a class="btn primary" href="#/new?student=${st.id}">Новый урок</a>
        <button class="btn ghost danger" data-act="del-student">Удалить</button>
      </div>
    </div>

    <div class="cols">
      <div class="card"><h2>Профиль</h2>
        <div class="fields">
          <label>Рабочий рейтинг <span class="hint">сложность задач подбирается вокруг него</span>
            <input type="number" step="100" min="800" max="3500" data-in="st" data-f="rating" value="${st.rating}"></label>
          <label>Расписание <input data-in="st" data-f="schedule" value="${esc(st.schedule)}" placeholder="вт, пт 18:00"></label>
          <label class="wide">Цель <input data-in="st" data-f="goal" value="${esc(st.goal)}" placeholder="например: диплом на области, 1600 на Codeforces"></label>
          <label class="wide">Заметки <textarea data-in="st" data-f="notes" rows="2" placeholder="Сильные и слабые стороны, язык, как лучше объяснять">${esc(st.notes)}</textarea></label>
        </div>
        <h3>${group ? 'Участники и хэндлы Codeforces' : 'Хэндл Codeforces'}</h3>
        ${st.members.map((m, i) => `
          <div class="row member">
            ${group ? `<input data-in="member" data-i="${i}" data-f="name" value="${esc(m.name)}" placeholder="Имя">` : ''}
            <input data-in="member" data-i="${i}" data-f="handle" value="${esc(m.handle)}" placeholder="хэндл на Codeforces" autocapitalize="off" spellcheck="false">
            ${group ? `<button class="btn ghost icon" data-act="del-member" data-i="${i}" title="Убрать участника">✕</button>` : ''}
          </div>`).join('')}
        <div class="row">
          ${group ? '<button class="btn ghost" data-act="add-member">＋ Участник</button>' : ''}
          <button class="btn" data-act="refresh-cf">Обновить данные Codeforces</button>
        </div>
      </div>

      <div class="card"><h2>Что проходить дальше</h2>
        ${recs.length ? `<div class="list">${recs.map(t => `
          <div class="item">
            <span class="lvl l${t.lvl}">${t.lvl}</span>
            <a class="grow" href="#/topic/${t.id}">${esc(t.name)}${statusOf(st, t.id) === 'learning' ? ' <span class="chip st-learning">в процессе</span>' : ''}</a>
            <a class="btn small" href="#/new?student=${st.id}&topic=${t.id}">Урок</a>
          </div>`).join('')}</div>
          <p class="hint">Темы, для которых уже пройдены все пререквизиты, от простых к сложным.</p>`
        : '<p class="muted">Все доступные темы пройдены.</p>'}
        ${review.length ? `<h3>Повторить</h3><div class="list">${review.map(t => `
          <div class="item"><a class="grow" href="#/topic/${t.id}">${esc(t.name)}</a>
          <a class="btn small" href="#/new?student=${st.id}&topic=${t.id}&type=practice">Закрепление</a></div>`).join('')}</div>` : ''}
      </div>
    </div>

    ${cfCard(st)}

    <div class="card"><h2>Карта тем</h2>
      <p class="hint">Нажмите на тему, чтобы сменить статус:
        <span class="chip">не начата</span> → <span class="chip st-learning">в процессе</span> → <span class="chip st-done">пройдена</span> → <span class="chip st-review">повторить</span></p>
      ${TOPIC_SECTIONS.map(sec => {
        const list = Store.topics().filter(t => t.sec === sec);
        return list.length ? `<h3>${esc(sec)}</h3><div class="chips">${list.map(t =>
          `<button class="chip topic st-${statusOf(st, t.id)}" data-act="cycle-topic" data-id="${t.id}" title="${STATUS[statusOf(st, t.id)]}">${esc(t.name)}</button>`).join('')}</div>` : '';
      }).join('')}
    </div>

    ${olyStudentCard(st)}

    <div class="card"><h2>Уроки</h2>
      ${ls.length ? lessonRows(ls, true) : '<p class="muted">Уроков пока нет.</p>'}
    </div>`;
};

function cfCard(st) {
  const hs = handlesOf(st);
  if (!hs.length) return `<div class="card"><h2>Codeforces</h2><p class="muted">Укажите хэндл — приложение покажет рейтинг, сильные и слабые темы и перестанет предлагать уже решённые задачи.</p></div>`;
  const tagS = {}, tagF = {};
  const recent = [];
  const rows = hs.map(h => {
    const d = userData(h), err = userErr.get(h.toLowerCase());
    if (!d) return `<div class="item"><span class="grow">${esc(h)}</span><span class="muted">${err ? esc(err) : 'загрузка…'}</span></div>`;
    for (const [t, n] of Object.entries(d.tagSolved)) tagS[t] = (tagS[t] || 0) + n;
    for (const [t, n] of Object.entries(d.tagFailed)) tagF[t] = (tagF[t] || 0) + n;
    if (d.recentAvg) recent.push(d.recentAvg);
    return `<div class="item">
      <a class="grow" href="https://codeforces.com/profile/${encodeURIComponent(d.handle)}" target="_blank" rel="noopener">${esc(d.handle)}</a>
      <span>рейтинг ${ratingChip(d.rating)}</span><span class="muted">макс. ${d.maxRating || '—'}</span>
      <span class="muted">решено ${d.solved.length}</span>
      <span class="muted">недавние задачи ≈ ${d.recentAvg || '—'}</span>
    </div>`;
  }).join('');
  const tags = Object.keys({ ...tagS, ...tagF }).map(t => ({ t, s: tagS[t] || 0, f: tagF[t] || 0 }))
    .sort((a, b) => (b.s + b.f) - (a.s + a.f)).slice(0, 16);
  const max = Math.max(1, ...tags.map(x => x.s + x.f));
  const weak = tags.filter(x => x.s + x.f >= 4 && x.f / (x.s + x.f) >= 0.3).map(x => x.t);
  const suggest = recent.length ? Math.round(recent.sort((a, b) => a - b)[Math.floor(recent.length / 2)] / 100) * 100 : 0;
  return `
    <div class="card"><h2>Codeforces</h2>
      <div class="list">${rows}</div>
      ${suggest && suggest !== st.rating ? `<p class="note">Последние решённые задачи в среднем имеют рейтинг ${suggest}.
        <button class="btn small" data-act="set-rating" data-r="${suggest}">Поставить рабочий рейтинг ${suggest}</button></p>` : ''}
      ${tags.length ? `<h3>Темы задач</h3>
        <div class="bars">${tags.map(x => `
          <div class="bar"><span class="lbl">${esc(x.t)}</span>
            <span class="track"><i class="ok" style="width:${x.s / max * 100}%"></i><i class="bad" style="width:${x.f / max * 100}%"></i></span>
            <span class="num">${x.s}${x.f ? ` <span class="bad-t">+${x.f}</span>` : ''}</span></div>`).join('')}</div>
        <p class="hint"><span class="dot ok"></span> решено &nbsp; <span class="dot bad"></span> были попытки, но не решено.
        ${weak.length ? `Много недорешанного: <b>${weak.map(esc).join(', ')}</b>.` : ''}</p>` : ''}
    </div>`;
}

IN.st = el => {
  const st = Store.student(route.arg);
  st[el.dataset.f] = el.dataset.f === 'rating' ? (parseInt(el.value, 10) || 0) : el.value;
  Store.saveSoon();
};
IN.member = el => {
  const st = Store.student(route.arg);
  st.members[+el.dataset.i][el.dataset.f] = el.value.trim();
  Store.saveSoon();
};
ACT['add-member'] = () => { Store.student(route.arg).members.push({ name: '', handle: '' }); Store.save(); render(); };
ACT['del-member'] = el => {
  const st = Store.student(route.arg);
  st.members.splice(+el.dataset.i, 1);
  if (!st.members.length) st.members.push({ name: '', handle: '' });
  Store.save(); render();
};
ACT['set-rating'] = el => { Store.student(route.arg).rating = +el.dataset.r; Store.save(); render(); };
ACT['cycle-topic'] = el => {
  const st = Store.student(route.arg);
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(statusOf(st, el.dataset.id)) + 1) % STATUS_ORDER.length];
  if (next) st.topics[el.dataset.id] = next; else delete st.topics[el.dataset.id];
  Store.save();
  const y = window.scrollY; render(); window.scrollTo(0, y);
};
ACT['del-student'] = () => {
  const st = Store.student(route.arg);
  const n = lessonsOf(st).length;
  if (!confirm(`Удалить «${st.name || 'без имени'}»${n ? ` и уроки (${n})` : ''}? Это нельзя отменить.`)) return;
  Store.s.lessons = Store.s.lessons.filter(l => l.studentId !== st.id);
  Store.s.students = Store.s.students.filter(s => s.id !== st.id);
  Store.s.contests.forEach(c => { c.studentIds = c.studentIds.filter(id => id !== st.id); });
  Store.save(); go('#/');
};
ACT['refresh-cf'] = async el => {
  const st = Store.student(route.arg);
  Store.save();
  const hs = handlesOf(st);
  if (!hs.length) return toast('Сначала укажите хэндл', 'err');
  el.disabled = true; el.textContent = 'Загружаю…';
  let failed = 0;
  for (const h of hs) {
    try { await CF.loadUser(h, true); userErr.delete(h.toLowerCase()); }
    catch (e) { userErr.set(h.toLowerCase(), e.message); failed++; }
  }
  render();
  toast(failed ? `Не удалось загрузить: ${failed} из ${hs.length}` : 'Данные обновлены', failed ? 'err' : '');
};

// ───────────────────────── конструктор урока
VIEWS.new = () => {
  const { students } = Store.s;
  if (!students.length) return `<h1>Новый урок</h1><div class="card"><p>Сначала добавьте ученика на <a href="#/">главной</a>.</p></div>`;
  const st = Store.student(route.q.get('student')) || students[0];
  const type = TYPES[route.q.get('type')] ? route.q.get('type') : 'new';
  const topicId = route.q.get('topic') || (type === 'contest' ? '' : (recommended(st)[0] || {}).id || '');
  const c = TYPES[type].counts;
  return `
    ${pageHead('Новый урок', 'План по минутам и задачи под уровень ученика')}
    <form class="card" id="new-form" onsubmit="return false">
      <div class="fields">
        <label>Ученик / группа <select name="student" data-in="new-nav">${studentOptions(st.id)}</select></label>
        <label>Формат <select name="type" data-in="new-nav">${Object.entries(TYPES).map(([k, v]) => opt(k, v.name, type)).join('')}</select></label>
        <label class="wide">Тема <span class="hint">✓ пройдена · ◐ в процессе · ↻ повторить</span>
          <select name="topic">${topicOptions(topicId, st, type === 'contest' ? opt('', '— микс из всех пройденных тем —', topicId) : '')}</select></label>
        <label>Дата <input type="date" name="date" value="${today()}"></label>
        <label>Длительность, мин <input type="number" name="duration" value="90" min="20" max="300" step="5"></label>
        <label>Рабочий рейтинг <span class="hint">для этого урока</span>
          <input type="number" name="rating" value="${st.rating || 1000}" min="800" max="3500" step="100"></label>
      </div>
      <h3>Сколько задач подобрать</h3>
      <div class="fields four">
        ${SECTIONS.map(s => `<label>${s.name}<input type="number" name="n-${s.id}" value="${c[s.id]}" min="0" max="15"></label>`).join('')}
      </div>
      <label class="check"><input type="checkbox" name="skipSolved" checked> Не предлагать задачи, которые ученик уже решил на Codeforces</label>
      <p class="hint">Задачи из прошлых уроков этого ученика не повторяются. Всё, что получится, можно будет отредактировать.</p>
      <div class="row"><button class="btn primary" data-act="build-lesson">Собрать урок</button></div>
    </form>`;
};
IN['new-nav'] = () => {
  const f = new FormData($('#new-form'));
  go(`#/new?student=${f.get('student')}&type=${f.get('type')}&topic=${f.get('topic') || ''}`);
};

function excludeSet(st, skipSolved) {
  const set = new Set();
  for (const l of lessonsOf(st)) for (const p of l.problems) if (p.src === 'cf') set.add(p.id);
  if (skipSolved) for (const h of handlesOf(st)) { const d = userData(h); if (d) d.solved.forEach(id => set.add(id)); }
  return set;
}
function secRange(rating, topic, secId) {
  const sec = SECTIONS.find(s => s.id === secId);
  const r = Math.max(rating || 1000, (topic && topic.base) || 800);
  const lo = Math.max(800, r + sec.d[0]);
  return { lo, hi: Math.max(lo, r + sec.d[1]) };
}
const toProb = (p, section, topicId, note) => ({ src: 'cf', id: p.id, name: p.n, rating: p.r, tags: p.t, url: CF.url(p), section, topicId, note: note || '', done: false, solvedBy: [] });
function pickFor(topic, range, count, exclude) {
  const got = CF.pick({ tags: topic.tags, any: topic.any, lo: range.lo, hi: range.hi, count, exclude });
  got.forEach(p => exclude.add(p.id));
  return got;
}

function makeBlocks(type, topic, st, duration, warmTopic) {
  const group = isGroup(st);
  const notes = topic ? lines(Store.s.topicNotes[topic.id]) : [];
  const bullets = arr => arr.map(x => '• ' + x).join('\n');
  let plan;
  if (type === 'contest') plan = [
    ['Правила и настрой', 5, 'Формат: как на настоящем раунде, без подсказок. Напомнить про чтение всех задач и стресс-тест.'],
    ['Контест', 65, group ? 'Каждый решает сам. Тренер наблюдает: кто на чём застрял, кто как тестирует.' : 'Ученик решает сам. Тренер записывает, где ушло время и какие были неверные идеи.'],
    ['Разбор', 25, 'Сначала ученик рассказывает свои решения. Затем разбор нерешённых задач: идея → почему она верна → на что обратить внимание в коде.'],
    ['Итоги и ДЗ', 5, 'Дорешать всё, что не успели. Выдать домашние задачи.'],
  ];
  else if (type === 'practice') plan = [
    ['Проверка ДЗ', 15, 'Вопросы по домашним задачам. Разобрать одну, вызвавшую больше всего трудностей.'],
    ['Повторение ключевых идей', 10, (topic.theory.length ? 'Ученик сам вспоминает и формулирует:\n' + bullets(topic.theory) : 'Ученик сам формулирует главные идеи темы.') + (notes.length ? '\n\nМои заметки:\n' + bullets(notes) : '')],
    ['Решение задач', 55, (group ? 'Мини-контест: все решают задачи блока «На уроке», идеи обсуждаем после каждой задачи.' : 'Задачи блока «На уроке» по возрастанию сложности. Подсказки — по шагам: наводящий вопрос → идея → деталь реализации.') + '\nСильным — задача «со звёздочкой».'],
    ['Разбор и типичные ошибки', 15, topic.mistakes.length ? 'На что обратить внимание:\n' + bullets(topic.mistakes) : 'Разобрать ошибки, которые встретились на уроке.'],
    ['Итоги и ДЗ', 5, 'Что стало получаться лучше, что ещё нужно закрепить. Выдать ДЗ.'],
  ];
  else plan = [
    ['Проверка ДЗ и разминка', 15, 'Вопросы по домашке.' + (warmTopic ? ` Разминочная задача на пройденную тему «${warmTopic.name}».` : ' Разминочная задача.')],
    [`Теория: ${topic.name}`, 25, (topic.theory.length ? bullets(topic.theory) : 'Основные определения и идеи темы.') + (notes.length ? '\n\nМои заметки:\n' + bullets(notes) : '')],
    ['Разбор задачи вместе', 15, 'Первую задачу блока «На уроке» решаем вместе: идея → почему работает → оценка сложности → код.' + (topic.mistakes.length ? '\nТипичные ошибки:\n' + bullets(topic.mistakes) : '')],
    ['Самостоятельное решение', 35, group ? 'Группа решает остальные задачи блока «На уроке». Кто решил — объясняет идею соседу или берёт задачу «со звёздочкой».' : 'Ученик решает остальные задачи сам и проговаривает идею до кода. Подсказки — по шагам: наводящий вопрос → идея → деталь реализации.'],
    ['Итоги и ДЗ', 10, 'Ученик своими словами пересказывает главное из темы. Выдать ДЗ, договориться о сроке.'],
  ];
  let left = duration;
  return plan.map(([title, share, text], i) => {
    const minutes = i === plan.length - 1 ? Math.max(5, left) : Math.max(5, Math.round(duration * share / 100 / 5) * 5);
    left -= minutes;
    return { title, minutes, text };
  });
}

ACT['build-lesson'] = async el => {
  const f = new FormData($('#new-form'));
  const st = Store.student(f.get('student'));
  const type = f.get('type');
  const topic = Store.topic(f.get('topic'));
  const rating = Math.max(800, parseInt(f.get('rating'), 10) || 1000);
  const duration = Math.max(20, parseInt(f.get('duration'), 10) || 90);
  const counts = Object.fromEntries(SECTIONS.map(s => [s.id, Math.max(0, parseInt(f.get('n-' + s.id), 10) || 0)]));
  const passed = doneTopics(st);
  if (!topic && type !== 'contest') return toast('Выберите тему', 'err');
  if (!topic && !passed.length) return toast('Для микс-контеста отметьте пройденные темы в профиле ученика', 'err');

  el.disabled = true; el.textContent = 'Подбираю задачи…';
  let warn = '';
  try {
    await CF.loadProblems();
    await Promise.all(handlesOf(st).map(h => CF.loadUser(h).catch(() => null)));
  } catch (e) { warn = 'Codeforces недоступен — урок создан без подбора задач. Их можно добавить позже.'; }

  const exclude = excludeSet(st, f.get('skipSolved'));
  const problems = [];
  let warmTopic = null;
  if (CF.ready) {
    if (type === 'contest') {
      const pool = topic ? [topic] : passed;
      const rnd = () => pool[Math.floor(Math.random() * pool.length)];
      const n = counts.class + counts.warm + counts.hard;
      for (let i = 0; i < n; i++) {
        const t = rnd();
        const r = Math.round((rating - 200 + (n > 1 ? 500 * i / (n - 1) : 200)) / 100) * 100;
        const lo = Math.max(800, r);
        pickFor(t, { lo, hi: lo }, 1, exclude).forEach(p => problems.push(toProb(p, 'class', t.id)));
      }
      for (let i = 0; i < counts.home; i++) { const t = rnd(); pickFor(t, secRange(rating, t, 'home'), 1, exclude).forEach(p => problems.push(toProb(p, 'home', t.id))); }
      problems.sort((a, b) => (a.section === b.section ? a.rating - b.rating : a.section === 'class' ? -1 : 1));
    } else {
      const others = passed.filter(t => t.id !== topic.id);
      if (type === 'new' && others.length) warmTopic = others[Math.floor(Math.random() * others.length)];
      for (const s of SECTIONS) {
        const t = s.id === 'warm' && warmTopic ? warmTopic : topic;
        const note = t !== topic ? 'повторение: ' + t.name : '';
        pickFor(t, secRange(rating, t, s.id), counts[s.id], exclude).forEach(p => problems.push(toProb(p, s.id, t.id, note)));
      }
    }
    const want = Object.values(counts).reduce((a, b) => a + b, 0);
    if (problems.length < want) warn = `Нашлось только ${problems.length} из ${want} задач — на Codeforces мало подходящих под эту тему и рейтинг.`;
  }

  const lesson = {
    id: uid(), studentId: st.id, type, topicId: topic ? topic.id : '', date: f.get('date') || today(), duration, rating,
    title: topic ? (type === 'contest' ? 'Контест: ' : '') + topic.name : 'Контест по пройденным темам',
    blocks: makeBlocks(type, topic, st, duration, warmTopic), problems, notes: '', done: false,
  };
  Store.s.lessons.push(lesson);
  if (topic && !statusOf(st, topic.id)) st.topics[topic.id] = 'learning';
  Store.save();
  go('#/lesson/' + lesson.id);
  if (warn) toast(warn, 'err');
};

// ───────────────────────── урок
VIEWS.lesson = () => {
  const l = Store.lesson(route.arg);
  if (!l) return notFound('Урок не найден');
  const st = Store.student(l.studentId);
  const topic = Store.topic(l.topicId);
  const total = l.blocks.reduce((a, b) => a + (+b.minutes || 0), 0);
  const members = st ? st.members.filter(m => m.handle) : [];
  const inLesson = new Set(l.problems.map(p => p.url));
  const classics = topic ? (topic.cses || []).filter(([id]) => !inLesson.has(csesUrl(id))) : [];

  const probRow = (p, i) => `
    <div class="prob${p.done ? ' done' : ''}">
      <input type="checkbox" data-in="prob-done" data-i="${i}" ${p.done ? 'checked' : ''} title="Отметить решённой вручную" aria-label="Решена">
      <div class="grow">
        <a href="${esc(p.url)}" target="_blank" rel="noopener">${p.src === 'cf' ? esc(p.id) + '. ' : ''}${esc(p.name)}</a>
        ${p.rating ? ratingChip(p.rating) : ''}
        ${members.map(m => (p.solvedBy || []).includes(m.handle.toLowerCase()) ? `<span class="chip st-done" title="Решено на Codeforces">✓ ${esc(m.name || m.handle)}</span>` : '').join('')}
        <div class="tags">${esc([p.note, ...(p.tags || [])].filter(Boolean).join(' · '))}</div>
      </div>
      <select data-in="prob-sec" data-i="${i}" aria-label="Блок" class="no-print">${SECTIONS.map(s => opt(s.id, s.name, p.section)).join('')}</select>
      ${p.src === 'cf' ? `<button class="btn ghost icon no-print" data-act="reroll" data-i="${i}" title="Заменить другой задачей">↻</button>` : ''}
      <button class="btn ghost icon no-print" data-act="del-prob" data-i="${i}" title="Убрать">✕</button>
    </div>`;

  return `
    <a class="back no-print" href="${st ? '#/student/' + st.id : '#/lessons'}">← ${st ? esc(st.name) : 'Уроки'}</a>
    <div class="head">
      <input class="title" data-in="ls" data-f="title" value="${esc(l.title)}" aria-label="Название урока">
      <button class="btn ${l.done ? '' : 'primary'} no-print" data-act="toggle-done">${l.done ? '✓ Проведён' : 'Отметить проведённым'}</button>
    </div>
    <div class="meta">
      <input type="date" data-in="ls" data-f="date" value="${esc(l.date)}" aria-label="Дата">
      <span>${TYPES[l.type].name}</span>
      ${st ? `<span>${esc(st.name)}</span>` : ''}
      <span>рейтинг ${ratingChip(l.rating)}</span>
      ${topic ? `<a href="#/topic/${topic.id}">материалы темы</a>` : ''}
    </div>
    <div class="row toolbar no-print">
      <button class="btn" data-act="copy-plan">Копировать план</button>
      <button class="btn" data-act="copy-hw">Сообщение с ДЗ</button>
      <button class="btn" data-act="copy-prompt" title="Текст запроса для любого бесплатного чат-бота: подробный конспект и подсказки к задачам">Запрос для ИИ</button>
      <button class="btn" data-act="print">Печать</button>
      <button class="btn ghost danger" data-act="del-lesson">Удалить</button>
    </div>

    <div class="card"><div class="head"><h2>План урока</h2><span class="muted" id="mins">${minsLabel(total, l.duration)}</span></div>
      ${l.blocks.map((b, i) => `
        <div class="block">
          <div class="row">
            <input type="number" class="mins" data-in="block" data-i="${i}" data-f="minutes" value="${b.minutes}" min="0" step="5" aria-label="Минут"><span class="muted">мин</span>
            <input class="grow btitle" data-in="block" data-i="${i}" data-f="title" value="${esc(b.title)}" aria-label="Название блока">
            <button class="btn ghost icon no-print" data-act="del-block" data-i="${i}" title="Убрать блок">✕</button>
          </div>
          <textarea data-in="block" data-i="${i}" data-f="text" rows="2" aria-label="Содержание">${esc(b.text)}</textarea>
        </div>`).join('')}
      <button class="btn ghost no-print" data-act="add-block">＋ Блок</button>
    </div>

    <div class="card"><div class="head"><h2>Задачи</h2>
      ${members.length ? '<button class="btn no-print" data-act="check-hw">Проверить решения на Codeforces</button>' : ''}</div>
      ${SECTIONS.map(s => {
        const rows = l.problems.map((p, i) => p.section === s.id ? probRow(p, i) : '').join('');
        return `<div class="psec"><div class="head"><h3>${s.name}</h3>
          <button class="btn ghost small no-print" data-act="add-more" data-sec="${s.id}">＋ подобрать ещё</button></div>
          ${rows || '<p class="muted small">Пусто</p>'}</div>`;
      }).join('')}
      <p class="hint">Теги Codeforces широкие — просмотрите условие перед уроком и замените неподходящее кнопкой ↻.</p>

      ${classics.length ? `<h3 class="no-print">Классика по теме (CSES)</h3>
        <div class="chips no-print">${classics.map(([id, name]) => `<span class="chip"><a href="${csesUrl(id)}" target="_blank" rel="noopener">${esc(name)}</a>
          <button class="plus" data-act="add-cses" data-id="${id}" title="Добавить в урок">＋</button></span>`).join('')}</div>` : ''}

      <h3 class="no-print">Добавить свою задачу</h3>
      <div class="row no-print">
        <input id="add-ref" class="grow" placeholder="Ссылка или номер на Codeforces, например 1520D" autocapitalize="off" spellcheck="false">
        <input id="add-name" placeholder="Название (если не Codeforces)">
        <select id="add-sec" aria-label="Блок">${SECTIONS.map(s => opt(s.id, s.name, 'class')).join('')}</select>
        <button class="btn" data-act="add-prob">Добавить</button>
      </div>
    </div>

    <div class="card"><h2>Заметки после урока</h2>
      <textarea data-in="ls" data-f="notes" rows="3" placeholder="Что получилось, где были трудности, что повторить в следующий раз">${esc(l.notes)}</textarea>
    </div>`;
};
const csesUrl = id => `https://cses.fi/problemset/task/${id}`;
const minsLabel = (total, duration) => `${total} из ${duration} мин${total !== duration ? ' ⚠' : ''}`;
const curLesson = () => Store.lesson(route.arg);
const rerender = () => { Store.save(); const y = window.scrollY; render(); window.scrollTo(0, y); };

IN.ls = el => { curLesson()[el.dataset.f] = el.value; Store.saveSoon(); };
IN.block = el => {
  const l = curLesson(), b = l.blocks[+el.dataset.i];
  b[el.dataset.f] = el.dataset.f === 'minutes' ? (parseInt(el.value, 10) || 0) : el.value;
  if (el.dataset.f === 'minutes') $('#mins').textContent = minsLabel(l.blocks.reduce((a, x) => a + x.minutes, 0), l.duration);
  Store.saveSoon();
};
IN['prob-sec'] = el => { curLesson().problems[+el.dataset.i].section = el.value; rerender(); };
IN['prob-done'] = el => { curLesson().problems[+el.dataset.i].done = el.checked; rerender(); };
ACT['add-block'] = () => { curLesson().blocks.push({ title: 'Новый блок', minutes: 10, text: '' }); rerender(); };
ACT['del-block'] = el => { curLesson().blocks.splice(+el.dataset.i, 1); rerender(); };
ACT['del-prob'] = el => { curLesson().problems.splice(+el.dataset.i, 1); rerender(); };
ACT['print'] = () => window.print();
ACT['del-lesson'] = () => {
  const l = curLesson();
  if (!confirm(`Удалить урок «${l.title}»?`)) return;
  Store.s.lessons = Store.s.lessons.filter(x => x.id !== l.id);
  Store.save(); go(l.studentId ? '#/student/' + l.studentId : '#/lessons');
};
ACT['toggle-done'] = () => {
  const l = curLesson(), st = Store.student(l.studentId);
  l.done = !l.done;
  let msg = l.done ? 'Урок отмечен проведённым' : 'Урок снова в планах';
  if (l.done && st && l.topicId && l.type !== 'contest' && ['', 'learning'].includes(statusOf(st, l.topicId))) {
    st.topics[l.topicId] = 'done';
    msg += ' · тема отмечена пройденной';
  }
  rerender(); toast(msg);
};

async function needProblems() {
  if (CF.ready) return true;
  toast('Загружаю архив задач Codeforces…');
  try { await CF.loadProblems(); return true; }
  catch (e) { toast('Codeforces недоступен: ' + e.message, 'err'); return false; }
}
function lessonTopicFor(l, st, fallbackId) {
  const t = Store.topic(fallbackId) || Store.topic(l.topicId);
  if (t) return t;
  const pool = st ? doneTopics(st) : [];
  return pool[Math.floor(Math.random() * pool.length)];
}
ACT['reroll'] = async el => {
  const l = curLesson(), st = Store.student(l.studentId), i = +el.dataset.i, old = l.problems[i];
  if (!await needProblems()) return;
  const topic = lessonTopicFor(l, st, old.topicId);
  if (!topic) return toast('Не знаю, по какой теме искать замену', 'err');
  const exclude = st ? excludeSet(st, true) : new Set(l.problems.map(p => p.id));
  const range = old.rating ? { lo: Math.max(800, old.rating - 100), hi: old.rating + 100 } : secRange(l.rating, topic, old.section);
  const [p] = pickFor(topic, range, 1, exclude);
  if (!p) return toast('Других подходящих задач не нашлось', 'err');
  l.problems[i] = toProb(p, old.section, topic.id, old.note);
  rerender();
};
ACT['add-more'] = async el => {
  const l = curLesson(), st = Store.student(l.studentId);
  if (!await needProblems()) return;
  const topic = lessonTopicFor(l, st);
  if (!topic) return toast('У урока нет темы — добавьте задачу вручную', 'err');
  const exclude = st ? excludeSet(st, true) : new Set(l.problems.map(p => p.id));
  const [p] = pickFor(topic, secRange(l.rating, topic, el.dataset.sec), 1, exclude);
  if (!p) return toast('Подходящих задач не нашлось', 'err');
  l.problems.push(toProb(p, el.dataset.sec, topic.id));
  rerender();
};
ACT['add-cses'] = el => {
  const l = curLesson(), topic = Store.topic(l.topicId);
  const [id, name] = topic.cses.find(c => String(c[0]) === el.dataset.id);
  l.problems.push({ src: 'custom', id: 'cses' + id, name: 'CSES · ' + name, rating: 0, tags: [], url: csesUrl(id), section: 'class', note: '', done: false, solvedBy: [] });
  rerender();
};
ACT['add-prob'] = async () => {
  const l = curLesson();
  const ref = $('#add-ref').value.trim(), name = $('#add-name').value.trim(), section = $('#add-sec').value;
  if (!ref && !name) return toast('Укажите ссылку, номер или название', 'err');
  const m = /codeforces\.com\/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)/.exec(ref) || /^(\d{1,4})\s*([A-Za-z]\d?)$/.exec(ref);
  if (m) {
    const id = m[1] + m[2].toUpperCase();
    await needProblems();
    const p = CF.find(id);
    if (p) l.problems.push(toProb(p, section, ''));
    else l.problems.push({ src: 'cf', id, name: name || 'Задача ' + id, rating: 0, tags: [], url: `https://codeforces.com/problemset/problem/${m[1]}/${m[2].toUpperCase()}`, section, note: '', done: false, solvedBy: [] });
  } else {
    const isUrl = /^https?:\/\//.test(ref);
    l.problems.push({ src: 'custom', id: 'x' + uid(), name: name || ref, rating: 0, tags: [], url: isUrl ? ref : '', section, note: isUrl ? '' : (name ? ref : ''), done: false, solvedBy: [] });
  }
  rerender();
};
ACT['check-hw'] = async el => {
  const l = curLesson(), st = Store.student(l.studentId);
  el.disabled = true; el.textContent = 'Проверяю…';
  let failed = 0;
  const solved = {};
  for (const h of handlesOf(st)) {
    try { solved[h.toLowerCase()] = new Set((await CF.loadUser(h, true)).solved); } catch (e) { failed++; }
  }
  let n = 0;
  for (const p of l.problems) {
    if (p.src !== 'cf') continue;
    const keep = (p.solvedBy || []).filter(h => !solved[h]);
    p.solvedBy = keep.concat(Object.keys(solved).filter(h => solved[h].has(p.id)));
    n += p.solvedBy.length;
  }
  rerender();
  toast(failed ? 'Не все хэндлы удалось проверить' : `Проверено. Отметок о решении: ${n}`, failed ? 'err' : '');
};

function lessonMarkdown(l) {
  const st = Store.student(l.studentId);
  let out = `# ${l.title}\n${fmtDate(l.date)}${st ? ' · ' + st.name : ''} · ${l.duration} мин\n\n## План\n`;
  l.blocks.forEach((b, i) => { out += `${i + 1}. **${b.title}** — ${b.minutes} мин\n${lines(b.text).map(x => '   ' + x).join('\n')}\n`; });
  out += '\n## Задачи\n';
  for (const s of SECTIONS) {
    const ps = l.problems.filter(p => p.section === s.id);
    if (!ps.length) continue;
    out += `\n### ${s.name}\n` + ps.map(p => `- ${p.url ? `[${p.name}](${p.url})` : p.name}${p.rating ? ' — ' + p.rating : ''}`).join('\n') + '\n';
  }
  if (l.notes) out += `\n## Заметки\n${l.notes}\n`;
  return out;
}
ACT['copy-plan'] = () => copyText(lessonMarkdown(curLesson()), 'План скопирован (Markdown)');
ACT['copy-hw'] = () => {
  const l = curLesson();
  const home = l.problems.filter(p => p.section === 'home');
  if (!home.length) return toast('В блоке «Домашнее задание» нет задач', 'err');
  const star = l.problems.filter(p => p.section === 'hard' && !p.done);
  let text = `Домашнее задание — ${l.title}\n\n` + home.map((p, i) => `${i + 1}. ${p.name}${p.url ? '\n' + p.url : ''}`).join('\n');
  if (star.length) text += '\n\nПо желанию, посложнее:\n' + star.map(p => `★ ${p.name}${p.url ? '\n' + p.url : ''}`).join('\n');
  text += '\n\nЕсли задача не идёт дольше 30–40 минут — напиши, дам подсказку.';
  copyText(text, 'Сообщение с ДЗ скопировано');
};
ACT['copy-prompt'] = () => {
  const l = curLesson(), st = Store.student(l.studentId), topic = Store.topic(l.topicId);
  const passed = st ? doneTopics(st).map(t => t.name) : [];
  const text = `Ты — опытный тренер по олимпиадному программированию. Помоги подготовить урок.

Ученик: ${st && isGroup(st) ? `группа из ${st.members.length} человек` : 'один ученик'}, уровень примерно ${l.rating} на Codeforces.${st && st.goal ? ' Цель: ' + st.goal + '.' : ''}${st && st.notes ? ' Особенности: ' + st.notes : ''}
Уже пройдено: ${passed.length ? passed.join('; ') : 'только основы'}.
Тема урока: ${topic ? topic.name : l.title}. Формат: ${TYPES[l.type].name}, ${l.duration} минут.

Мой план:
${l.blocks.map((b, i) => `${i + 1}. ${b.title} (${b.minutes} мин)`).join('\n')}

Задачи урока:
${l.problems.map(p => `- ${p.name}${p.url ? ' ' + p.url : ''}`).join('\n') || '- пока не выбраны'}

Что нужно:
1. Подробный конспект теории на уровне ученика: мотивирующий пример, объяснение по шагам, короткий код на C++.
2. 5–7 наводящих вопросов, которые я могу задать, чтобы ученик сам дошёл до идеи.
3. Типичные ошибки и как их показать на маленьком тесте.
4. К каждой задаче — лестницу из трёх подсказок (от лёгкого намёка до идеи решения), без готового кода.`;
  copyText(text, 'Запрос скопирован — вставьте его в любой чат-бот');
};

// ───────────────────────── список уроков
VIEWS.lessons = () => {
  const sid = route.q.get('student') || '';
  const list = Store.s.lessons.filter(l => !sid || l.studentId === sid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return `
    ${pageHead('Уроки', 'Планы, задачи и домашние задания', `<a class="btn primary" href="#/new${sid ? '?student=' + sid : ''}">Новый урок</a>`)}
    <div class="row"><select data-in="lessons-filter" aria-label="Ученик">${studentOptions(sid, opt('', 'Все ученики', sid))}</select></div>
    <div class="card">${list.length ? lessonRows(list, !!sid) : '<p class="muted">Уроков пока нет.</p>'}</div>`;
};
IN['lessons-filter'] = el => go('#/lessons' + (el.value ? '?student=' + el.value : ''));

// ───────────────────────── темы
VIEWS.topics = () => {
  const st = Store.student(route.q.get('student'));
  const all = Store.topics();
  return `
    ${pageHead('Темы', `${all.length} тем от основ до продвинутых алгоритмов`, '<button class="btn" data-act="add-topic">＋ Своя тема</button>')}
    <div class="row">
      <input type="search" class="grow" data-in="topic-search" placeholder="Поиск по темам" aria-label="Поиск">
      <select data-in="topics-student" aria-label="Ученик">${studentOptions(st && st.id, opt('', 'Без отметок ученика', ''))}</select>
    </div>
    ${TOPIC_SECTIONS.map(sec => {
      const list = all.filter(t => t.sec === sec);
      return list.length ? `<div class="card tsec"><h2>${esc(sec)}</h2><div class="list">${list.map(t => `
        <a class="item" href="#/topic/${t.id}" data-name="${esc(t.name.toLowerCase())}">
          <span class="lvl l${t.lvl}" title="${LEVEL_NAMES[t.lvl]}">${t.lvl}</span>
          <span class="grow">${esc(t.name)}${t.custom ? ' <span class="chip">своя</span>' : ''}</span>
          ${st && statusOf(st, t.id) ? `<span class="chip st-${statusOf(st, t.id)}">${STATUS[statusOf(st, t.id)]}</span>` : ''}
          <span class="muted small">от ${t.base || 800}</span>
        </a>`).join('')}</div></div>` : '';
    }).join('')}
    <p class="hint">Цифра — уровень: ${Object.entries(LEVEL_NAMES).map(([k, v]) => `${k} — ${v.toLowerCase()}`).join(', ')}. «От N» — с какого рейтинга на Codeforces тема начинает встречаться.</p>`;
};
IN['topic-search'] = el => {
  const q = el.value.trim().toLowerCase();
  app.querySelectorAll('.tsec').forEach(sec => {
    let any = false;
    sec.querySelectorAll('.item').forEach(it => { const show = it.dataset.name.includes(q); it.hidden = !show; any = any || show; });
    sec.hidden = !any;
  });
};
IN['topics-student'] = el => go('#/topics' + (el.value ? '?student=' + el.value : ''));
ACT['add-topic'] = () => {
  const t = { id: 'c-' + uid(), custom: true, name: 'Новая тема', sec: TOPIC_SECTIONS[0], lvl: 2, base: 1200, tags: [], pre: [], theory: [], mistakes: [], cses: [] };
  Store.s.customTopics.push(t); Store.save(); go('#/topic/' + t.id);
};

VIEWS.topic = () => {
  const t = Store.topic(route.arg);
  if (!t) return notFound('Тема не найдена');
  const all = Store.topics();
  const tags = (t.tags || []).concat(t.any || []);
  const unlocks = all.filter(x => (x.pre || []).includes(t.id));
  const cfLink = 'https://codeforces.com/problemset?tags=' + encodeURIComponent([...(t.tags && t.tags.length ? t.tags : tags.slice(0, 1)), `${t.base || 800}-${(t.base || 800) + 400}`].join(','));
  const topicLinks = list => list.map(x => `<a class="chip" href="#/topic/${x.id}">${esc(x.name)}</a>`).join('');

  const body = t.custom ? `
    <div class="card"><h2>Описание темы</h2>
      <div class="fields">
        <label>Раздел <select data-in="ct" data-f="sec">${TOPIC_SECTIONS.map(s => opt(s, s, t.sec)).join('')}</select></label>
        <label>Уровень <select data-in="ct" data-f="lvl">${Object.entries(LEVEL_NAMES).map(([k, v]) => opt(k, `${k} — ${v}`, t.lvl)).join('')}</select></label>
        <label>Минимальный рейтинг задач <input type="number" step="100" min="800" max="3500" data-in="ct" data-f="base" value="${t.base}"></label>
        <label>Теги Codeforces <span class="hint">через запятую, на английском</span>
          <input data-in="ct" data-f="tags" value="${esc(t.tags.join(', '))}" placeholder="dp, trees" list="cf-tags" autocapitalize="off"></label>
        <label class="wide">Что рассказать <span class="hint">каждый пункт с новой строки</span>
          <textarea data-in="ct" data-f="theory" rows="4">${esc(t.theory.join('\n'))}</textarea></label>
        <label class="wide">Типичные ошибки <textarea data-in="ct" data-f="mistakes" rows="2">${esc(t.mistakes.join('\n'))}</textarea></label>
      </div>
      <datalist id="cf-tags">${CF.tagList().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <button class="btn ghost danger" data-act="del-topic">Удалить тему</button>
    </div>` : `
    <div class="cols">
      <div class="card"><h2>Что рассказать</h2><ul>${t.theory.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><h2>Типичные ошибки</h2><ul>${t.mistakes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${(t.pre || []).length ? `<h3>Нужно знать заранее</h3><div class="chips">${topicLinks(t.pre.map(Store.topic).filter(Boolean))}</div>` : ''}
        ${unlocks.length ? `<h3>Открывает темы</h3><div class="chips">${topicLinks(unlocks)}</div>` : ''}
      </div>
    </div>`;

  return `
    <a class="back" href="#/topics">← Все темы</a>
    <div class="head">
      ${t.custom ? `<input class="title" data-in="ct" data-f="name" value="${esc(t.name)}" aria-label="Название темы">` : `<h1>${esc(t.name)}</h1>`}
    </div>
    <div class="meta"><span>${esc(t.sec)}</span><span>уровень ${t.lvl} — ${LEVEL_NAMES[t.lvl]}</span><span>задачи от ${ratingChip(t.base || 800)}</span>
      ${tags.length ? `<span>теги: ${esc(tags.join(', '))}</span>` : ''}</div>
    ${body}
    <div class="card"><h2>Материалы и задачи</h2>
      <div class="chips">
        ${t.cp ? `<a class="chip link" href="https://cp-algorithms.com/${t.cp}" target="_blank" rel="noopener">Статья на cp-algorithms ↗</a>` : ''}
        ${tags.length ? `<a class="chip link" href="${cfLink}" target="_blank" rel="noopener">Задачи на Codeforces ↗</a>` : ''}
        <a class="chip link" href="https://ru.algorithmica.org/" target="_blank" rel="noopener">Алгоритмика (рус.) ↗</a>
        <a class="chip link" href="https://codeforces.com/edu/courses" target="_blank" rel="noopener">Codeforces EDU ↗</a>
      </div>
      ${(t.cses || []).length ? `<h3>Классические задачи (CSES)</h3><div class="chips">${t.cses.map(([id, name]) => `<a class="chip link" href="${csesUrl(id)}" target="_blank" rel="noopener">${esc(name)}</a>`).join('')}</div>` : ''}
      <h3>Мои заметки к теме</h3>
      <textarea data-in="topic-note" rows="3" placeholder="Свои примеры, удачные объяснения, любимые задачи. Каждая строка попадёт в план урока по этой теме.">${esc(Store.s.topicNotes[t.id] || '')}</textarea>
    </div>
    ${Store.s.students.length ? `<div class="card"><h2>Ученики</h2><div class="list">${Store.s.students.map(st => `
      <div class="item"><a class="grow" href="#/student/${st.id}">${esc(st.name || 'Без имени')}</a>
        <select data-in="topic-status" data-st="${st.id}" aria-label="Статус">${STATUS_ORDER.map(s => opt(s, STATUS[s], statusOf(st, t.id))).join('')}</select>
        <a class="btn small" href="#/new?student=${st.id}&topic=${t.id}${statusOf(st, t.id) === 'done' || statusOf(st, t.id) === 'review' ? '&type=practice' : ''}">Урок</a>
      </div>`).join('')}</div></div>` : ''}`;
};
IN['topic-note'] = el => { Store.s.topicNotes[route.arg] = el.value; Store.saveSoon(); };
IN['topic-status'] = el => {
  const st = Store.student(el.dataset.st);
  if (el.value) st.topics[route.arg] = el.value; else delete st.topics[route.arg];
  rerender();
};
IN.ct = el => {
  const t = Store.topic(route.arg), f = el.dataset.f;
  if (f === 'lvl' || f === 'base') t[f] = parseInt(el.value, 10) || (f === 'lvl' ? 2 : 800);
  else if (f === 'tags') t.tags = el.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  else if (f === 'theory' || f === 'mistakes') t[f] = lines(el.value);
  else t[f] = el.value;
  Store.saveSoon();
};
ACT['del-topic'] = () => {
  const t = Store.topic(route.arg);
  if (!confirm(`Удалить тему «${t.name}»?`)) return;
  Store.s.customTopics = Store.s.customTopics.filter(x => x.id !== t.id);
  Store.save(); go('#/topics');
};

// ───────────────────────── куда добавлять найденные задачи: запланированный урок или контест
let addTarget = '';
function addTargets() {
  const ls = Store.s.lessons.filter(l => !l.done).map(l => ({ v: 'l:' + l.id, label: `Урок · ${fmtDate(l.date)} · ${l.title}` }));
  const cs = Store.s.contests.filter(c => contestPhase(c).id !== 'over').map(c => ({ v: 'c:' + c.id, label: `Контест · ${c.title}` }));
  return ls.concat(cs);
}
function targetSelect() {
  const list = addTargets();
  if (!list.some(t => t.v === addTarget)) addTarget = '';
  return `<select data-in="add-target" aria-label="Куда добавлять">${opt('', '— не добавлять —', addTarget)}${list.map(t => opt(t.v, t.label, addTarget)).join('')}</select>`;
}
const targetList = () => { const o = addTarget[0] === 'l' ? Store.lesson(addTarget.slice(2)) : Store.contest(addTarget.slice(2)); return o ? o.problems : null; };
const targetIds = () => new Set((targetList() || []).map(p => p.id));
function addToTarget(prob) {
  const list = targetList();
  if (!list || list.some(p => p.id === prob.id)) return;
  list.push(addTarget[0] === 'l' ? { section: 'class', note: '', done: false, solvedBy: [], ...prob } : prob);
  rerender(); toast(addTarget[0] === 'l' ? 'Добавлено в урок, блок «На уроке»' : 'Добавлено в контест');
}
IN['add-target'] = el => { addTarget = el.value; render(); };

// ───────────────────────── подбор задач
const pf = { topic: '', tag: '', lo: 1000, hi: 1400, student: '', hideSolved: true, init: false };
VIEWS.problems = () => {
  if (!pf.init) {
    pf.init = true;
    const st = Store.s.students[0];
    if (st) { pf.student = st.id; pf.lo = Math.max(800, st.rating - 100); pf.hi = st.rating + 200; }
  }
  const st = Store.student(pf.student);
  if (!CF.ready) {
    CF.loadProblems().then(() => { if (route.name === 'problems') render(); }, e => { if (route.name === 'problems') $('#pf-state').textContent = 'Codeforces недоступен: ' + e.message; });
  } else if (st) ensureUsersThen(st, 'problems');
  const targetHtml = targetSelect();

  let results = '';
  if (CF.ready) {
    const topic = Store.topic(pf.topic);
    const tags = (topic ? topic.tags || [] : []).concat(pf.tag ? [pf.tag] : []);
    const exclude = st && pf.hideSolved ? excludeSet(st, true) : new Set();
    const target = addTarget, added = targetIds();
    const found = CF.all.filter(p => p.r >= pf.lo && p.r <= pf.hi && !exclude.has(p.id) && CF.matches(p, tags, topic && topic.any)).sort((a, b) => b.s - a.s);
    results = `<p class="muted">Найдено: ${found.length}${found.length > 60 ? ', показаны 60 самых решаемых' : ''}</p>
      <div class="card">${found.slice(0, 60).map(p => `
        <div class="prob">
          <div class="grow"><a href="${CF.url(p)}" target="_blank" rel="noopener">${p.id}. ${esc(p.n)}</a> ${ratingChip(p.r)}
            <div class="tags">${esc(p.t.join(' · '))}</div></div>
          <span class="muted small">решили ${p.s}</span>
          ${target ? (added.has(p.id) ? '<span class="chip st-done">добавлена</span>' : `<button class="btn small" data-act="pf-add" data-id="${p.id}">＋ добавить</button>`) : ''}
        </div>`).join('') || '<p class="muted">Ничего не найдено — расширьте диапазон рейтинга или уберите тег.</p>'}</div>`;
  }
  return `
    ${pageHead('Подбор задач', 'Поиск по архиву Codeforces: тема, тег, рейтинг')}
    <div class="card"><div class="fields">
      <label class="wide">Тема <select data-in="pf" data-f="topic">${topicOptions(pf.topic, st, opt('', 'Любая', pf.topic))}</select></label>
      <label>Дополнительный тег <select data-in="pf" data-f="tag">${opt('', '—', pf.tag)}${CF.tagList().map(t => opt(t, t, pf.tag)).join('')}</select></label>
      <label>Рейтинг от <input type="number" step="100" min="800" max="3500" data-in="pf" data-f="lo" value="${pf.lo}"></label>
      <label>до <input type="number" step="100" min="800" max="3500" data-in="pf" data-f="hi" value="${pf.hi}"></label>
      <label>Ученик <select data-in="pf" data-f="student">${studentOptions(pf.student, opt('', '—', pf.student))}</select></label>
      <label>Добавлять в урок или контест ${targetHtml}</label>
    </div>
    ${st ? `<label class="check"><input type="checkbox" data-in="pf" data-f="hideSolved" ${pf.hideSolved ? 'checked' : ''}> Скрыть решённые учеником и уже выданные на уроках</label>` : ''}
    </div>
    <p class="muted" id="pf-state">${CF.ready ? '' : 'Загружаю архив задач Codeforces…'}</p>
    ${results}`;
};
function ensureUsersThen(st, view) {
  for (const h of handlesOf(st)) {
    const key = h.toLowerCase();
    if (userData(h) || userErr.has(key) || userBusy.has(key)) continue;
    userBusy.add(key);
    CF.loadUser(h).catch(e => { userErr.set(key, e.message); }).then(() => { userBusy.delete(key); if (route.name === view) renderKeepFocus(); });
  }
}
IN.pf = el => {
  const f = el.dataset.f;
  if (f === 'hideSolved') pf[f] = el.checked;
  else if (f === 'lo' || f === 'hi') { pf[f] = parseInt(el.value, 10) || 0; clearTimeout(IN.pf.t); IN.pf.t = setTimeout(() => { if (route.name === 'problems') renderKeepFocusNow(el); }, 500); return; }
  else pf[f] = el.value;
  if (f === 'student') { const st = Store.student(pf.student); if (st) { pf.lo = Math.max(800, st.rating - 100); pf.hi = st.rating + 200; } }
  render();
};
function renderKeepFocusNow(el) {
  const f = el.dataset.f;
  render();
  const again = app.querySelector(`[data-in="pf"][data-f="${f}"]`);
  if (again) again.focus();
}
ACT['pf-add'] = el => { const p = CF.find(el.dataset.id); if (p) addToTarget(toProb(p, 'class', pf.topic)); };

// ───────────────────────── настройки
VIEWS.settings = () => {
  const s = Store.s;
  const cached = Cache.peek('problems');
  return `
    ${pageHead('Настройки')}
    <div class="card"><h2>Резервная копия</h2>
      <p>Все данные (ученики, уроки, заметки) хранятся только в этом браузере на этом компьютере. Ничего никуда не отправляется.
        Чтобы не потерять их при очистке браузера или перенести на другой компьютер — сохраняйте файл копии.</p>
      <p class="muted">Сейчас: учеников и групп — ${s.students.length}, уроков — ${s.lessons.length}, контестов — ${s.contests.length}.
        Последняя копия: ${s.lastBackup ? new Date(s.lastBackup).toLocaleString('ru-RU') : 'ещё не делалась'}.</p>
      <div class="row">
        <button class="btn primary" data-act="export">Сохранить копию в файл</button>
        <label class="btn">Загрузить из файла<input type="file" accept="application/json,.json" data-in="import" hidden></label>
      </div>
    </div>
    <div class="card"><h2>Архив задач Codeforces</h2>
      <p>Список задач скачивается с бесплатного публичного API Codeforces и хранится в браузере, обновляется раз в три дня.</p>
      <p class="muted">${cached ? `Задач в архиве: ${cached.list.length}, обновлён ${new Date(cached.at).toLocaleString('ru-RU')}.` : 'Архив ещё не загружен.'}</p>
      <button class="btn" data-act="reload-problems">Обновить сейчас</button>
    </div>
    <div class="card"><h2>Удаление данных</h2>
      <button class="btn ghost danger" data-act="wipe">Удалить всех учеников, уроки и контесты</button>
    </div>`;
};
ACT['export'] = () => {
  Store.s.lastBackup = Date.now(); Store.save();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.s, null, 1)], { type: 'application/json' }));
  a.download = `coachify-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  render();
};
IN['import'] = async el => {
  const file = el.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.students) || !Array.isArray(data.lessons)) throw new Error('bad');
    if (Store.s.students.length && !confirm(`Заменить текущие данные содержимым файла (учеников: ${data.students.length}, уроков: ${data.lessons.length})?`)) return;
    Store.replace(data); go('#/'); toast('Данные загружены');
  } catch (e) { toast('Это не файл резервной копии', 'err'); }
};
ACT['reload-problems'] = async el => {
  el.disabled = true; el.textContent = 'Загружаю…';
  try { await CF.loadProblems(true); toast('Архив обновлён'); } catch (e) { toast('Не получилось: ' + e.message, 'err'); }
  render();
};
ACT['wipe'] = () => {
  if (!confirm('Удалить всех учеников, уроки, контесты и заметки? Это нельзя отменить.')) return;
  Store.replace({}); go('#/');
};

const notFound = text => `<div class="card"><p>${text}. <a href="#/">На главную</a></p></div>`;

