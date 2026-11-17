/* Запуск приложения и переключатель темы оформления. */
const THEMES = { dark: 'Тема: тёмная', light: 'Тема: светлая' };
function currentTheme() { try { return localStorage.getItem('coach.theme') === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else document.documentElement.removeAttribute('data-theme');
  $('#theme-label').textContent = THEMES[t];
}
ACT['theme'] = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('coach.theme', next); } catch (e) { /* тема просто не запомнится */ }
  applyTheme(next);
};
applyTheme(currentTheme());

// Архив задач подтягиваем из кэша сразу, чтобы списки тегов и подбор были готовы без ожидания.
Cache.get('problems').then(c => { if (c) CF.loadProblems().then(() => { if (['settings', 'problems', 'topic'].includes(route.name)) renderKeepFocus(); }).catch(() => {}); });
render();
