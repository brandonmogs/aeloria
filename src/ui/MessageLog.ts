/**
 * The OSRS-style chatbox in the bottom-left corner: a parchment-dark panel with
 * a scrollback of game messages ("You get some logs.", "Congratulations…").
 * Other systems call {@link add}; the box keeps a generous history, pins itself
 * to the newest line, and lets the player scroll back through the rest.
 */
export class MessageLog {
  private readonly root = document.createElement('div');
  private readonly lines = document.createElement('div');
  private static readonly MAX_LINES = 100;

  constructor() {
    this.root.id = 'message-log';
    this.lines.className = 'log-lines';
    this.root.appendChild(this.lines);
    document.body.appendChild(this.root);
  }

  add(text: string, kind: 'info' | 'xp' | 'levelup' | 'danger' = 'info'): void {
    const line = document.createElement('div');
    line.className = `log-line log-${kind}`;
    line.textContent = text;
    this.lines.appendChild(line);
    while (this.lines.children.length > MessageLog.MAX_LINES) {
      this.lines.firstChild?.remove();
    }
    this.lines.scrollTop = this.lines.scrollHeight;
  }
}
