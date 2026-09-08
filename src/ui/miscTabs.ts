/**
 * The small side-panel tabs that don't warrant a class of their own: the
 * settings sheet, the music player, the logout button, and the placeholder
 * panes for the social tabs a single-player world has no use for yet.
 */

export interface SettingsCallbacks {
  onToggleMusic: () => boolean;
  musicOn: () => boolean;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'pane-heading';
  h.textContent = text;
  return h;
}

function note(text: string): HTMLElement {
  const p = document.createElement('div');
  p.className = 'pane-note';
  p.textContent = text;
  return p;
}

/** A stone toggle button that repaints its label from `read()`. */
function toggle(label: string, read: () => boolean, flip: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'pane-btn';
  const paint = (): void => {
    const on = read();
    btn.textContent = `${label}: ${on ? 'On' : 'Off'}`;
    btn.classList.toggle('active', on);
  };
  btn.addEventListener('click', () => {
    flip();
    paint();
  });
  paint();
  return btn;
}

export function buildSettingsPane(cb: SettingsCallbacks): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'misc-pane';
  pane.append(
    heading('Settings'),
    toggle('Music', cb.musicOn, cb.onToggleMusic),
    note('Camera: middle-drag or the arrow keys rotate, the scroll wheel zooms, and clicking the compass faces north.'),
    note('Interface: F1–F7 switch tabs, Escape closes windows, F12 shows the debug readout.'),
  );
  return pane;
}

export function buildMusicPane(cb: SettingsCallbacks): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'misc-pane';
  const track = document.createElement('div');
  track.className = 'music-track';
  track.textContent = 'Now playing: Aeloria Approach';
  pane.append(heading('Music Player'), track, toggle('Playing', cb.musicOn, cb.onToggleMusic), note('One original track for now, synthesized live. More to come.'));
  return pane;
}

export function buildLogoutPane(): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'misc-pane';
  const btn = document.createElement('button');
  btn.className = 'pane-btn logout-btn';
  btn.textContent = 'Click here to logout';
  btn.addEventListener('click', () => window.location.reload());
  pane.append(heading('Logout'), note('Aeloria does not save progress yet, so logging out starts a fresh adventurer.'), btn);
  return pane;
}

export function buildPlaceholderPane(title: string, text: string): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'misc-pane';
  pane.append(heading(title), note(text));
  return pane;
}
