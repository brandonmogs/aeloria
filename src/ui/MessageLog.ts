/**
 * The OSRS chatbox in the bottom-left corner: a parchment panel with a
 * scrollback of game messages ("You get some logs.", "Congratulations…") and
 * the familiar row of chat-channel buttons underneath. Other systems call
 * {@link add}; the box keeps a generous history, pins itself to the newest
 * line, and lets the player scroll back through the rest.
 */
export class MessageLog {
  private readonly root = document.createElement('div');
  private readonly lines = document.createElement('div');
  private static readonly MAX_LINES = 100;

  constructor() {
    this.root.id = 'message-log';
    this.lines.className = 'log-lines';
    this.root.appendChild(this.lines);
    this.root.appendChild(this.buildChannelRow());
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

  /** The channel buttons under the chat; only "Game" carries traffic for now. */
  private buildChannelRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'chat-tabs';
    for (const name of ['All', 'Game', 'Public', 'Private', 'Channel', 'Clan', 'Trade']) {
      const btn = document.createElement('button');
      btn.className = 'chat-tab';
      btn.textContent = name;
      btn.classList.toggle('active', name === 'Game');
      btn.addEventListener('click', () => {
        for (const other of row.querySelectorAll('.chat-tab')) other.classList.remove('active');
        btn.classList.add('active');
      });
      row.appendChild(btn);
    }
    const report = document.createElement('button');
    report.className = 'chat-tab chat-report';
    report.textContent = 'Report';
    row.appendChild(report);
    return row;
  }
}
