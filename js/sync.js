/* Аккаунт и синхронизация: вход через Google (Firebase Auth), данные тренера — в Cloud Firestore.
   Без входа приложение работает как раньше, на localStorage. Локальная копия остаётся основной:
   облако хранит её целиком (users/{uid}/data/meta + куски c0, c1, … — документ Firestore ограничен 1 МБ). */
const Sync = (() => {
  const CONFIG = {
    apiKey: 'AIzaSyBxfTpEtR3HYdTdUbQNn2ALtneoMbFsIGY',
    authDomain: 'coaching-a9532.firebaseapp.com',
    projectId: 'coaching-a9532',
    storageBucket: 'coaching-a9532.firebasestorage.app',
    messagingSenderId: '106829882648',
    appId: '1:106829882648:web:ccd1dbb5b04c6011816a6d',
  };
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-';
  const SITE = 'https://abenovc.github.io/coachify/';
  const META = 'coach.sync';
  const CHUNK = 250000; // символов в одном документе: даже по 3 байта на символ это меньше 1 МБ
  const DEV = Math.random().toString(36).slice(2); // эта вкладка; чужие записи отличаем по этому id
  const CONFLICT = new Error('conflict');
  const fileMode = !/^https?:$/.test(location.protocol);

  let meta = { uid: '', rev: 0, dirty: false };
  try { meta = Object.assign(meta, JSON.parse(localStorage.getItem(META)) || {}); } catch (e) { /* ещё не входили */ }
  const saveMeta = () => { try { localStorage.setItem(META, JSON.stringify(meta)); } catch (e) { /* не критично */ } };

  let user = null, db = null, auth = null;
  let ready = fileMode, sdkFailed = false;
  let status = 'off', errText = '';
  let lastJson = null, busy = false, queued = false, applying = false;
  let pushTimer = null, retryTimer = null, unsub = null, pendingCloud = null;

  const LABEL = { off: '', loading: 'Загружаю…', saving: 'Сохраняю…', saved: 'Сохранено', error: 'Не сохранено', conflict: 'Выберите версию' };
  const isEmpty = () => { const s = Store.s; return !(s.students.length + s.lessons.length + s.contests.length + s.customTopics.length + s.myOly.length + Object.keys(s.topicNotes).length + Object.keys(s.oly).length); };
  const signedIn = () => !!user || (!ready && !!meta.uid);
  const base = () => db.collection('users').doc(user.uid).collection('data');
  const metaRef = () => base().doc('meta');
  const chunkRef = i => base().doc('c' + i);

  function human(e) {
    const code = (e && e.code) || '';
    if (code === 'permission-denied') return 'Нет доступа к базе: проверьте правила в Firebase (Firestore → Rules).';
    if (code === 'unavailable' || code === 'failed-precondition' || !navigator.onLine) return 'Нет связи с сервером — сохраню, когда появится интернет.';
    return (e && e.message) || 'Неизвестная ошибка';
  }
  function setStatus(s, text) { status = s; errText = text || ''; paint(); }
  function paint() {
    const name = document.getElementById('acct-name'), st = document.getElementById('acct-status');
    if (name) name.textContent = user ? (user.displayName || user.email || 'Аккаунт') : 'Войти';
    if (st) { st.textContent = user ? LABEL[status] : ''; st.className = 'st ' + status; }
    if (typeof route !== 'undefined' && route.name === 'settings') renderKeepFocus();
  }
  function redraw() { const y = window.scrollY; renderKeepFocus(); window.scrollTo(0, y); }

  // ───────── облако
  function split(json) {
    const parts = [];
    for (let i = 0; i < json.length;) {
      let end = Math.min(json.length, i + CHUNK);
      const c = json.charCodeAt(end - 1);
      if (end < json.length && c >= 0xD800 && c <= 0xDBFF) end--; // не разрывать суррогатную пару
      parts.push(json.slice(i, end)); i = end;
    }
    return parts.length ? parts : [''];
  }
  async function readCloud() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const m = await metaRef().get();
      if (!m.exists) return null;
      const info = m.data();
      const parts = await Promise.all(Array.from({ length: info.n }, (_, i) => chunkRef(i).get()));
      // Если между чтениями кто-то записал новую версию, куски будут от разных ревизий — читаем заново.
      if (parts.every(p => p.exists && p.data().rev === info.rev)) return { info, state: JSON.parse(parts.map(p => p.data().s).join('')) };
    }
    throw new Error('Не удалось прочитать данные из аккаунта, попробуйте ещё раз.');
  }
  async function pull() {
    setStatus('loading');
    const c = await readCloud();
    if (!c) return;
    applying = true;
    try { Store.replace(c.state); } finally { applying = false; }
    lastJson = JSON.stringify(Store.s);
    meta = { uid: user.uid, rev: c.info.rev, dirty: false }; saveMeta();
    setStatus('saved');
    redraw();
  }
  async function push(force) {
    if (!user || !db) return;
    if (busy) { queued = true; return; }
    clearTimeout(pushTimer);
    const json = JSON.stringify(Store.s);
    if (!force && json === lastJson) { meta.dirty = false; saveMeta(); if (status !== 'conflict') setStatus('saved'); return; }
    const parts = split(json), s = Store.s;
    busy = true; queued = false;
    setStatus('saving');
    try {
      const rev = await db.runTransaction(async tx => {
        const m = await tx.get(metaRef());
        const cur = m.exists ? m.data() : null;
        if (cur && !force && cur.rev !== meta.rev) { pendingCloud = cur; throw CONFLICT; }
        const next = (cur ? cur.rev : 0) + 1;
        parts.forEach((part, i) => tx.set(chunkRef(i), { rev: next, s: part }));
        for (let i = parts.length; i < (cur ? cur.n : 0); i++) tx.delete(chunkRef(i));
        tx.set(metaRef(), { rev: next, n: parts.length, at: Date.now(), dev: DEV, students: s.students.length, lessons: s.lessons.length });
        return next;
      });
      lastJson = json;
      meta = { uid: user.uid, rev, dirty: queued }; saveMeta();
      setStatus('saved');
    } catch (e) {
      if (e === CONFLICT) showConflict(pendingCloud);
      else { setStatus('error', human(e)); retryLater(); }
    } finally {
      busy = false;
      if (queued) { queued = false; schedule(); }
    }
  }
  function schedule() { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 2000); }
  function retryLater() { clearTimeout(retryTimer); retryTimer = setTimeout(resync, 30000); }

  // Сверка локальных данных с аккаунтом: при входе, при возврате связи и после ошибок.
  async function resync() {
    if (!user || status === 'conflict') return;
    clearTimeout(retryTimer);
    try {
      setStatus('loading');
      const m = await metaRef().get();
      const cloud = m.exists ? m.data() : null;
      const mine = meta.uid === user.uid;
      if (!cloud) {
        if (meta.uid && !mine && !isEmpty() && !confirm('На этом устройстве остались данные другого аккаунта. Скопировать их в этот аккаунт?')) { await auth.signOut(); return; }
        meta.rev = 0; await push(true);
      } else if (mine && cloud.rev === meta.rev) {
        if (meta.dirty) await push();
        else { lastJson = JSON.stringify(Store.s); setStatus('saved'); }
      } else if ((mine && !meta.dirty) || isEmpty()) await pull();
      else showConflict(cloud);
      listen();
    } catch (e) { setStatus('error', human(e)); retryLater(); }
  }
  function listen() {
    if (unsub || !user) return;
    unsub = metaRef().onSnapshot(snap => {
      if (!snap.exists || status === 'conflict' || busy) return;
      const d = snap.data();
      if (d.dev === DEV || d.rev === meta.rev) return;
      if (meta.dirty) showConflict(d);
      else pull().then(() => toast('Данные обновлены с другого устройства')).catch(e => { setStatus('error', human(e)); retryLater(); });
    }, () => { /* связь пропала — повторим в resync */ });
  }
  function stopListen() { if (unsub) { unsub(); unsub = null; } }

  // ───────── выбор версии, когда данные в аккаунте и на устройстве разошлись
  function showConflict(cloud) {
    pendingCloud = cloud;
    setStatus('conflict');
    let d = document.getElementById('sync-dialog');
    if (!d) { d = document.createElement('dialog'); d.id = 'sync-dialog'; d.className = 'modal'; document.body.appendChild(d); }
    const s = Store.s;
    d.innerHTML = `
      <h2>Какие данные оставить?</h2>
      <p>В аккаунте и на этом устройстве сохранены разные версии.</p>
      <ul>
        <li><b>В аккаунте:</b> учеников и групп — ${cloud.students || 0}, уроков — ${cloud.lessons || 0}${cloud.at ? ', сохранено ' + new Date(cloud.at).toLocaleString('ru-RU') : ''}.</li>
        <li><b>На этом устройстве:</b> учеников и групп — ${s.students.length}, уроков — ${s.lessons.length}.</li>
      </ul>
      <div class="col">
        <button class="btn primary" data-act="sync-take">Взять из аккаунта</button>
        <p class="hint">Данные этого устройства перед заменой скачаются файлом копии.</p>
        <button class="btn" data-act="sync-keep">Оставить данные этого устройства</button>
        <p class="hint">Они заменят то, что сейчас в аккаунте.</p>
        <button class="btn ghost" data-act="sync-later">Решить позже</button>
      </div>`;
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function closeConflict() { const d = document.getElementById('sync-dialog'); if (d && d.open) d.close(); }
  function downloadLocal() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.s, null, 1)], { type: 'application/json' }));
    a.download = `coachify-до-синхронизации-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  ACT['sync-take'] = async () => {
    closeConflict();
    if (!isEmpty()) downloadLocal();
    status = 'loading';
    try { await pull(); toast('Загружены данные из аккаунта'); listen(); } catch (e) { setStatus('error', human(e)); retryLater(); }
  };
  ACT['sync-keep'] = async () => { closeConflict(); status = 'saving'; await push(true); listen(); };
  ACT['sync-later'] = () => closeConflict();

  // ───────── вход и выход
  ACT['acct'] = () => {
    if (status === 'conflict' && pendingCloud) return showConflict(pendingCloud);
    if (!user && auth) return ACT['sync-in']();
    go('#/settings');
  };
  ACT['sync-in'] = async () => {
    if (!auth) return toast('Не удалось связаться с сервером аккаунтов. Проверьте интернет и обновите страницу.', 'err');
    try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
    catch (e) {
      const code = e.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      if (code === 'auth/popup-blocked') toast('Браузер заблокировал окно входа — разрешите всплывающие окна для этого сайта.', 'err');
      else if (code === 'auth/unauthorized-domain') toast(`Домен ${location.hostname} не разрешён в Firebase: Authentication → Settings → Authorized domains.`, 'err');
      else if (code === 'auth/operation-not-allowed') toast('В Firebase не включён вход через Google: Authentication → Sign-in method.', 'err');
      else toast('Не получилось войти: ' + (e.message || code), 'err');
    }
  };
  ACT['sync-out'] = async () => {
    if (meta.dirty && status !== 'conflict') await push();
    if (meta.dirty && !confirm('Последние изменения не сохранились в аккаунт. Всё равно выйти? На этом устройстве они останутся.')) return;
    await auth.signOut();
    toast('Вы вышли. Данные остались на этом устройстве.');
  };
  ACT['sync-retry'] = () => { if (user) resync(); else start(); };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('sdk'));
      document.head.appendChild(el);
    });
  }
  async function start() {
    if (fileMode || auth) return;
    try {
      if (typeof firebase === 'undefined') for (const part of ['app', 'auth', 'firestore']) await loadScript(`${SDK}${part}-compat.js`);
      if (!firebase.apps.length) firebase.initializeApp(CONFIG);
      auth = firebase.auth(); db = firebase.firestore();
      sdkFailed = false;
      auth.onAuthStateChanged(u => {
        user = u; ready = true;
        if (u) resync();
        else { stopListen(); clearTimeout(pushTimer); clearTimeout(retryTimer); closeConflict(); status = 'off'; errText = ''; paint(); }
        if (typeof route !== 'undefined' && route.name === 'home') redraw();
      });
    } catch (e) { sdkFailed = true; ready = true; paint(); }
  }

  // Любое сохранение в Store помечает данные как несохранённые в аккаунте и планирует отправку.
  Store.onChange = () => {
    if (applying || (!user && !meta.uid)) return;
    if (!meta.dirty) { meta.dirty = true; saveMeta(); }
    if (!user || status === 'conflict') return;
    if (busy) queued = true; else schedule();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && user && meta.dirty && status !== 'conflict') push(); });
  window.addEventListener('online', () => { if (!auth) start(); else if (user && (meta.dirty || status === 'error')) resync(); });

  function card() {
    let body;
    if (fileMode) body = `<p>Вход в аккаунт работает на сайте <a href="${SITE}">${SITE.replace('https://', '')}</a>. Приложение, открытое из файла, хранит данные только в этом браузере.</p>`;
    else if (!ready) body = '<p class="muted">Проверяю вход…</p>';
    else if (sdkFailed) body = `<p>Не удалось связаться с сервером аккаунтов. Пока данные хранятся только в этом браузере.</p>
      <button class="btn" data-act="sync-retry">Попробовать ещё раз</button>`;
    else if (!user) body = `<p>Войдите, чтобы данные хранились в вашем аккаунте: они не пропадут при очистке браузера и будут доступны на любом устройстве.
        То, что уже есть на этом устройстве, перенесётся в аккаунт при первом входе.</p>
      <button class="btn primary" data-act="sync-in">Войти через Google</button>`;
    else body = `<p>Вы вошли как <b>${esc(user.displayName || 'без имени')}</b>${user.email ? ` (${esc(user.email)})` : ''}. Изменения сохраняются в аккаунт автоматически.</p>
      <p class="sync-line ${status}">${esc({ saved: 'Все изменения сохранены в аккаунте.', saving: 'Сохраняю изменения…', loading: 'Сверяю данные с аккаунтом…', conflict: 'В аккаунте и на этом устройстве разные данные — нужно выбрать версию.', error: errText, off: '' }[status])}</p>
      <div class="row">
        ${status === 'conflict' ? '<button class="btn primary" data-act="acct">Выбрать версию</button>' : ''}
        ${status === 'error' ? '<button class="btn" data-act="sync-retry">Повторить</button>' : ''}
        <button class="btn" data-act="sync-out">Выйти</button>
      </div>`;
    return `<div class="card"><h2>Аккаунт</h2>${body}</div>`;
  }

  start();
  return { card, signedIn, paint };
})();
