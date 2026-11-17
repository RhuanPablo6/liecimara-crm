// Tema claro/escuro escolhido por cada usuário (fica salvo neste aparelho/navegador).
export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_KEY = 'crm.theme';

/** Páginas que a paciente abre (link de confirmação, orçamento, assinatura) ficam sempre claras. */
export const isPatientPage = (path: string) => /^\/(c|o|f)\//.test(path);

export function readTheme(): ThemeMode {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(mode: ThemeMode) {
  const dark =
    !isPatientPage(window.location.pathname) && (mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a1222' : '#0D1F3A');
}

export function saveTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {}
  applyTheme(mode);
}

/** Roda antes da página aparecer (sem "piscar" claro → escuro). */
export const THEME_BOOT = `(function(){try{var m=localStorage.getItem('${THEME_KEY}');var p=location.pathname;if(/^\\/(c|o|f)\\//.test(p))return;var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;
