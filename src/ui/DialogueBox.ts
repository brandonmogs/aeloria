import { DialogueView } from '../sim/dialogue';

export interface DialogueCallbacks {
  onContinue: () => void;
  onChoose: (index: number) => void;
}

/**
 * NPC conversation, drawn over the chatbox exactly where OSRS puts it: the
 * speaker's name in bold across the top, their words centred beneath, and
 * "Click here to continue" at the bottom — or a "Select an option" list.
 * Space advances, the number keys pick options. The box only ever displays a
 * {@link DialogueView} snapshot the sim sent; every click goes back as a
 * command.
 */
export class DialogueBox {
  private readonly root = document.createElement('div');
  private view: DialogueView | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: DialogueCallbacks,
  ) {
    this.root.id = 'dialogue';
    this.root.hidden = true;
    host.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.view) return;
      if (this.view.kind === 'options') {
        const n = Number(e.key);
        if (n >= 1 && n <= this.view.options.length) {
          e.preventDefault();
          this.cb.onChoose(n - 1);
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.cb.onContinue();
      }
    });
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  show(view: DialogueView): void {
    this.view = view;
    this.root.hidden = false;
    this.root.textContent = '';

    if (view.kind === 'options') {
      const title = document.createElement('div');
      title.className = 'dlg-title';
      title.textContent = view.title;
      this.root.appendChild(title);
      view.options.forEach((text, i) => {
        const row = document.createElement('div');
        row.className = 'dlg-option';
        row.textContent = text;
        row.addEventListener('click', () => this.cb.onChoose(i));
        this.root.appendChild(row);
      });
      return;
    }

    if (view.kind !== 'message') {
      const name = document.createElement('div');
      name.className = 'dlg-name';
      name.textContent = view.speaker;
      this.root.appendChild(name);
    }
    const text = document.createElement('div');
    text.className = 'dlg-text';
    text.textContent = view.text;
    const next = document.createElement('div');
    next.className = 'dlg-continue';
    next.textContent = 'Click here to continue';
    this.root.append(text, next);
    this.root.onclick = () => this.cb.onContinue();
  }

  hide(): void {
    this.view = null;
    this.root.hidden = true;
    this.root.onclick = null;
  }
}
