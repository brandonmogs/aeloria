/**
 * Turns a blank page into an informative one. A WebGL app that throws during
 * startup — most often because the browser can't create a WebGL context —
 * otherwise just shows an empty canvas with no hint as to why. These helpers
 * surface the actual reason on screen and in the console.
 */

/** Whether the browser can give us a WebGL context at all. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

/** Cover the screen with a readable error panel instead of failing silently. */
export function showFatal(title: string, detail?: string): void {
  let el = document.getElementById('fatal');
  const isNew = !el;
  if (!el) el = document.createElement('div');
  el.id = 'fatal';
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center;' +
    'background:#141a24;color:#cfe0ff;font:14px/1.6 ui-monospace,monospace;';
  el.innerHTML =
    `<div style="font-size:20px;color:#ffd34d">⚠ ${escapeHtml(title)}</div>` +
    (detail
      ? `<pre style="max-width:92ch;white-space:pre-wrap;text-align:left;` +
        `color:#9fb3d1;font-size:12px;margin:0">${escapeHtml(detail)}</pre>`
      : '') +
    `<div style="color:#7f95b8;font-size:12px">` +
    `Full stack is in the browser console (⌥⌘I → Console).</div>`;
  if (isNew) document.body.appendChild(el);
  console.error(`[aeloria] ${title}${detail ? `\n${detail}` : ''}`);
}

/** Catch errors that escape the synchronous startup path. */
export function installErrorHandlers(): void {
  window.addEventListener('error', (e) => showFatal('Uncaught error', e.message));
  window.addEventListener('unhandledrejection', (e) =>
    showFatal('Unhandled promise rejection', String(e.reason)),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
