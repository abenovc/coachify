/* Работа с бесплатным публичным API Codeforces (ключ не нужен). */
const CF = (() => {
  const API = 'https://codeforces.com/api/';
  const DAY = 24 * 3600 * 1000;
  let queue = Promise.resolve();
  let problems = null;       // [{id, c, i, n, r, t, s}]
  let byId = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = 'cfcb' + Date.now() + Math.floor(Math.random() * 1e6);
      const el = document.createElement('script');
      const done = () => { delete window[cb]; el.remove(); clearTimeout(t); };
      const t = setTimeout(() => { done(); reject(new Error('Codeforces не отвечает')); }, 30000);
      window[cb] = data => { done(); resolve(data); };
      el.onerror = () => { done(); reject(new Error('Нет связи с Codeforces')); };
      el.src = url + '&jsonp=' + cb;
      document.head.appendChild(el);
    });
  }

  async function raw(method, params) {
    const url = API + method + '?' + new URLSearchParams(params).toString();
    let data;
    try {
      const res = await fetch(url);
      data = await res.json();
    } catch (e) {
      data = await jsonp(url);
    }
    if (!data || data.status !== 'OK') {
      const err = new Error(explain((data && data.comment) || 'Ошибка Codeforces'));
      err.limit = /limit/i.test((data && data.comment) || '');
      throw err;
    }
    return data.result;
  }

  function explain(comment) {
    if (/not found/i.test(comment)) return 'Хэндл не найден на Codeforces';
    if (/limit/i.test(comment)) return 'Слишком частые запросы к Codeforces, попробуйте через пару секунд';
    return comment;
  }

  // Запросы идут строго по очереди с паузой — у API есть ограничение частоты.
  function call(method, params = {}) {
    const run = async () => {
      try { return await raw(method, params); }
      catch (e) {
        if (!e.limit) throw e;
        await sleep(2500);
        return raw(method, params);
      } finally { await sleep(350); }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  function index(list) {
    problems = list;
    byId = new Map(list.map(p => [p.id, p]));
  }

  async function loadProblems(force) {
    if (problems && !force) return problems;
    const cached = await Cache.get('problems');
    if (cached && !force && Date.now() - cached.at < 3 * DAY) { index(cached.list); return problems; }
    try {
      const res = await call('problemset.problems');
      const solved = new Map(res.problemStatistics.map(s => [s.contestId + s.index, s.solvedCount]));
      const list = res.problems
        .filter(p => p.contestId && !p.tags.includes('*special'))
        .map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating || 0, t: p.tags, s: solved.get(p.contestId + p.index) || 0 }));
      index(list);
      await Cache.set('problems', { at: Date.now(), list });
    } catch (e) {
      if (cached) index(cached.list); else throw e;   // офлайн — работаем со старым кэшем
    }
    return problems;
  }

  async function loadUser(handle, force) {
    const key = 'user:' + handle.toLowerCase();
    const cached = await Cache.get(key);
    if (cached && !force && Date.now() - cached.at < 3600 * 1000) return cached;
    let info, subs;
    try {
      [info] = await call('user.info', { handles: handle });
      subs = await call('user.status', { handle });
    } catch (e) {
      if (cached && !force) return cached;   // офлайн — показываем прошлые данные
      throw e;
    }
    const solved = new Set(), tried = new Set();
    for (const s of subs) {
      if (!s.problem.contestId) continue;
      const id = s.problem.contestId + s.problem.index;
      if (s.verdict === 'OK') solved.add(id); else tried.add(id);
    }
    const tagSolved = {}, tagFailed = {}, recent = [];
    const seen = new Set();
    for (const s of subs) {            // посылки идут от новых к старым
      if (!s.problem.contestId) continue;
      const id = s.problem.contestId + s.problem.index;
      if (seen.has(id)) continue;
      seen.add(id);
      const ok = solved.has(id);
      for (const t of s.problem.tags) (ok ? tagSolved : tagFailed)[t] = ((ok ? tagSolved : tagFailed)[t] || 0) + 1;
      if (ok && s.problem.rating && recent.length < 30) recent.push(s.problem.rating);
    }
    const data = {
      at: Date.now(), handle: info.handle, rating: info.rating || 0, maxRating: info.maxRating || 0, rank: info.rank || '',
      solved: [...solved], unsolved: [...tried].filter(id => !solved.has(id)), tagSolved, tagFailed,
      recentAvg: recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length / 100) * 100 : 0,
    };
    await Cache.set(key, data);
    return data;
  }

  /* Все посылки пользователя — для таблицы результатов контеста. Не кэшируется: нужны свежие данные. */
  async function loadSubs(handle) {
    const subs = await call('user.status', { handle });
    return subs.filter(s => s.problem.contestId && s.verdict && s.verdict !== 'TESTING' && s.verdict !== 'COMPILATION_ERROR')
      .map(s => ({ id: s.problem.contestId + s.problem.index, name: s.problem.name, gym: s.problem.contestId >= 100000, t: s.creationTimeSeconds, ok: s.verdict === 'OK' }))
      .sort((x, y) => x.t - y.t);
  }

  const matches = (p, tags, any) =>
    (!tags || tags.every(t => p.t.includes(t))) && (!any || !any.length || any.some(t => p.t.includes(t)));

  /* Подбор задач: рейтинг в [lo, hi], теги темы, не из exclude.
     Предпочитаем задачи, которые решило много людей (обычно это качественные задачи без подвохов),
     и штрафуем за лишние теги сверх темы (чем их меньше, тем задача чище по теме). Внутри лучших — случайный выбор. */
  function pick({ tags, any, lo, hi, count, exclude }) {
    if (!problems || count <= 0) return [];
    let pool = [];
    for (let widen = 0; widen <= 4 && pool.length < count; widen++) {
      const a = lo - widen * 100, b = hi + widen * 100;
      pool = problems.filter(p => p.r >= a && p.r <= b && !exclude.has(p.id) && matches(p, tags, any));
    }
    const need = (tags ? tags.length : 0) + (any && any.length ? 1 : 0);
    pool.forEach(p => { p._w = p.s / (1 + 0.35 * Math.max(0, p.t.length - need - 1)); });
    pool.sort((x, y) => y._w - x._w);
    const top = pool.slice(0, Math.max(count * 6, Math.min(40, pool.length)));
    const out = [];
    while (out.length < count && top.length) out.push(top.splice(Math.floor(Math.random() * top.length), 1)[0]);
    return out.sort((x, y) => x.r - y.r);
  }

  return {
    loadProblems, loadUser, loadSubs, pick, matches,
    get ready() { return !!problems; },
    get all() { return problems || []; },
    find: id => (byId ? byId.get(String(id).toUpperCase()) : undefined),
    url: p => `https://codeforces.com/problemset/problem/${p.c}/${p.i}`,
    tagList: () => [...new Set((problems || []).flatMap(p => p.t))].sort(),
  };
})();
