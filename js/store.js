/* Хранилище: все данные тренера лежат в localStorage браузера (ключ coach.v1);
   после входа в аккаунт их копию ведёт js/sync.js.
   Большие кэши Codeforces (архив задач, посылки учеников) — в IndexedDB. */
const Store = (() => {
  const KEY = 'coach.v1';
  const blank = () => ({ students: [], lessons: [], contests: [], customTopics: [], topicNotes: {}, oly: {}, myOly: [], lastBackup: null });
  let state = blank();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.students)) state = Object.assign(blank(), raw);
  } catch (e) { /* первый запуск или хранилище недоступно */ }

  let timer = null;
  let failed = false;
  function flush() {
    clearTimeout(timer); timer = null;
    try { localStorage.setItem(KEY, JSON.stringify(state)); failed = false; }
    catch (e) { if (!failed) { failed = true; alert('Не удалось сохранить данные в браузере. Сделайте резервную копию в «Настройках».'); } }
    if (api.onChange) api.onChange();
  }
  window.addEventListener('beforeunload', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (timer && document.hidden) flush(); });

  const api = {
    onChange: null, // сюда подключается синхронизация с аккаунтом (js/sync.js)
    get s() { return state; },
    save() { flush(); },
    saveSoon() { clearTimeout(timer); timer = setTimeout(flush, 400); },
    replace(next) { state = Object.assign(blank(), next); flush(); },
    student: id => state.students.find(s => s.id === id),
    lesson: id => state.lessons.find(l => l.id === id),
    contest: id => state.contests.find(c => c.id === id),
    topics: () => BUILTIN_TOPICS.concat(state.customTopics),
    topic: id => BUILTIN_TOPICS.find(t => t.id === id) || state.customTopics.find(t => t.id === id),
  };
  return api;
})();

const Cache = (() => {
  let dbp = null;
  const mem = new Map();
  function db() {
    if (!dbp) dbp = new Promise(resolve => {
      try {
        const rq = indexedDB.open('coach-cache', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  return {
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      const d = await db();
      if (!d) return undefined;
      return new Promise(resolve => {
        try {
          const rq = d.transaction('kv').objectStore('kv').get(key);
          rq.onsuccess = () => { if (rq.result !== undefined) mem.set(key, rq.result); resolve(rq.result); };
          rq.onerror = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
      });
    },
    async set(key, value) {
      mem.set(key, value);
      const d = await db();
      if (!d) return;
      try { d.transaction('kv', 'readwrite').objectStore('kv').put(value, key); } catch (e) { /* кэш останется в памяти */ }
    },
    peek: key => mem.get(key),
  };
})();
