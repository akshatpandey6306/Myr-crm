export const CRM_THEMES = [
  { id: 'default', name: 'Default', colors: ['#f5f4fb', '#6653d7', '#20213c'] },
  { id: 'ocean', name: 'Ocean', colors: ['#eef5ff', '#2563eb', '#172b4d'] },
  { id: 'forest', name: 'Forest', colors: ['#eff7f1', '#23805f', '#19372a'] },
  { id: 'sunset', name: 'Sunset', colors: ['#fff4ed', '#c65b32', '#40271f'] },
  { id: 'rose', name: 'Rose', colors: ['#fff1f5', '#be4d78', '#402331'] },
  { id: 'slate', name: 'Slate', colors: ['#f1f4f8', '#475569', '#202b3b'] },
  { id: 'amber', name: 'Amber', colors: ['#fff8e8', '#a16207', '#3c2d13'] },
  { id: 'teal', name: 'Teal', colors: ['#eaf7f6', '#0f766e', '#183431'] },
  { id: 'berry', name: 'Berry', colors: ['#f7f0fb', '#8b3fbf', '#30213a'] },
  { id: 'midnight', name: 'Midnight', colors: ['#eef0fb', '#4757d5', '#202544'] },
] as const;

export type CrmTheme = typeof CRM_THEMES[number]['id'];

const STORAGE_KEY = 'myr.crm.theme';
const THEME_CHANGE_EVENT = 'myr:theme-changed';

export function isCrmTheme(value: string | null): value is CrmTheme {
  return CRM_THEMES.some((theme) => theme.id === value);
}

export function setCrmTheme(theme: CrmTheme) {
  window.localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.crmTheme = theme;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function readCrmTheme(): CrmTheme {
  const savedTheme = window.localStorage.getItem(STORAGE_KEY);
  return isCrmTheme(savedTheme) ? savedTheme : 'default';
}

export { STORAGE_KEY as CRM_THEME_STORAGE_KEY, THEME_CHANGE_EVENT as CRM_THEME_CHANGE_EVENT };
