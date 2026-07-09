/**
 * The OSRS-style game message box in the bottom-left corner: a short scrollback
 * of things that happened ("You gain 12 Attack XP.", "Congratulations…"). Other
 * systems call {@link add}; the log keeps only the last few lines and fades
 * older ones so it never demands attention.
 */
export class MessageLog {
  private readonly root = document.createElement('div');
  private static readonly MAX_LINES = 7;

  constructor() {
    this.root.id = 'message-log';
    document.body.appendChild(this.root);
  }

  add(text: string, kind: 'info' | 'xp' | 'levelup' | 'danger' = 'info'): void {
    const line = document.createElement('div');
    line.className = `log-line log-${kind}`;
    line.textContent = text;
    this.root.appendChild(line);
    while (this.root.children.length > MessageLog.MAX_LINES) {
      this.root.firstChild?.remove();
    }
  }
}
