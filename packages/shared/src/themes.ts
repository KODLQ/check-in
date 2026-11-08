export interface EventTheme {
  id: string;
  /** Two-stop gradient used as the cover when no image is uploaded. */
  colors: [string, string];
  textColor: string;
}

export const EVENT_THEMES: EventTheme[] = [
  { id: 'sunset', colors: ['#FF5F6D', '#FFC371'], textColor: '#1A1A1A' },
  { id: 'night', colors: ['#141E30', '#6A3093'], textColor: '#FFFFFF' },
  { id: 'lagoon', colors: ['#00C9A7', '#0081CF'], textColor: '#FFFFFF' },
  { id: 'disco', colors: ['#F72585', '#7209B7'], textColor: '#FFFFFF' },
  { id: 'meadow', colors: ['#A8E063', '#56AB2F'], textColor: '#1A1A1A' },
  { id: 'mono', colors: ['#F2F2F2', '#BDBDBD'], textColor: '#1A1A1A' },
];

export const DEFAULT_THEME_ID = 'sunset';

export function getTheme(id: string | null | undefined): EventTheme {
  return EVENT_THEMES.find((t) => t.id === id) ?? (EVENT_THEMES[0] as EventTheme);
}
