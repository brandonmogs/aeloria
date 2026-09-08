import { Player } from '../sim/Player';
import { JournalContext, QUESTS, QuestDef, questDef, questStatus } from '../sim/quests';
import { SKILL_META } from './skillMeta';
import { SidePanel } from './SidePanel';

/**
 * The quest tab and everything that hangs off it: the quest list with OSRS's
 * red / yellow / green status colours under a "Quest Points" header, the
 * journal window that opens when you click a quest (finished steps struck
 * through), and the "Congratulations! Quest Complete!" scroll.
 */
export class QuestPanel {
  private readonly pane = document.createElement('div');
  private readonly points = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly rows = new Map<string, HTMLElement>();
  private readonly journal = document.createElement('div');
  private readonly journalTitle = document.createElement('div');
  private readonly journalBody = document.createElement('div');
  private readonly complete = document.createElement('div');
  private openQuest: string | null = null;

  constructor(
    private readonly player: Player,
    sidePanel: SidePanel,
  ) {
    this.pane.className = 'quest-pane';
    this.points.className = 'quest-points';
    this.list.className = 'quest-list';
    for (const q of QUESTS) {
      const row = document.createElement('div');
      row.className = 'quest-row';
      row.textContent = q.name;
      row.addEventListener('click', () => this.openJournal(q.id));
      this.rows.set(q.id, row);
      this.list.appendChild(row);
    }
    this.pane.append(this.points, this.list);
    sidePanel.register('quests', this.pane);

    this.buildJournal();
    this.buildComplete();
    this.refresh();
  }

  /** Repaint list colours, quest points, and the open journal. Call each tick. */
  refresh(): void {
    this.points.textContent = `Quest Points: ${this.player.questPoints}`;
    for (const q of QUESTS) {
      const row = this.rows.get(q.id)!;
      const status = questStatus(q, this.player.quests.get(q.id) ?? 0);
      row.classList.toggle('not-started', status === 'not_started');
      row.classList.toggle('in-progress', status === 'in_progress');
      row.classList.toggle('complete', status === 'complete');
    }
    if (this.openQuest) this.renderJournal(questDef(this.openQuest));
  }

  openJournal(questId: string): void {
    this.openQuest = questId;
    this.journal.hidden = false;
    this.renderJournal(questDef(questId));
  }

  closeJournal(): void {
    this.openQuest = null;
    this.journal.hidden = true;
  }

  /** The completion scroll: title, rewards, and the running quest-point total. */
  showComplete(questId: string): void {
    const def = questDef(questId);
    this.complete.textContent = '';
    const title = document.createElement('div');
    title.className = 'qc-title';
    title.textContent = 'Congratulations!';
    const sub = document.createElement('div');
    sub.className = 'qc-sub';
    sub.textContent = `Quest Complete: ${def.name}`;
    const awarded = document.createElement('div');
    awarded.className = 'qc-awarded';
    awarded.textContent = 'You are awarded:';
    this.complete.append(title, sub, awarded);
    for (const r of def.rewards) {
      const row = document.createElement('div');
      row.className = 'qc-reward';
      row.textContent = r;
      this.complete.appendChild(row);
    }
    const qp = document.createElement('div');
    qp.className = 'qc-points';
    qp.textContent = `Quest points: ${this.player.questPoints}`;
    const hint = document.createElement('div');
    hint.className = 'qc-hint';
    hint.textContent = 'Click to close';
    this.complete.append(qp, hint);
    this.complete.hidden = false;
  }

  private context(): JournalContext {
    return {
      questVar: (key) => this.player.questVars.get(key) ?? 0,
      killCount: (kind) => this.player.killCounts.get(kind) ?? 0,
      countItem: (id) => this.player.inventory.countOf(id),
    };
  }

  private renderJournal(def: QuestDef): void {
    const stage = this.player.quests.get(def.id) ?? 0;
    const status = questStatus(def, stage);
    this.journalTitle.textContent = def.name;
    this.journalBody.textContent = '';

    const meta = document.createElement('div');
    meta.className = 'journal-meta';
    meta.textContent = `${def.difficulty} · ${def.length} · ${def.questPoints} Quest point${def.questPoints === 1 ? '' : 's'}`;
    this.journalBody.appendChild(meta);

    if (def.requirements.length > 0) {
      const req = document.createElement('div');
      req.className = 'journal-req';
      req.textContent = 'To complete this quest I need:';
      this.journalBody.appendChild(req);
      for (const r of def.requirements) {
        const row = document.createElement('div');
        const met = this.player.skills.levelOf(r.skill) >= r.level;
        row.className = `journal-req-row ${met ? 'met' : 'unmet'}`;
        row.textContent = `Level ${r.level} ${SKILL_META[r.skill].label}`;
        this.journalBody.appendChild(row);
      }
    }

    for (const l of def.journal(stage, this.context())) {
      const row = document.createElement('div');
      row.className = `journal-line ${l.done ? 'done' : ''}`;
      row.textContent = l.text;
      this.journalBody.appendChild(row);
    }

    if (status === 'complete') {
      const done = document.createElement('div');
      done.className = 'journal-complete';
      done.textContent = 'QUEST COMPLETE!';
      this.journalBody.appendChild(done);
      const rewards = document.createElement('div');
      rewards.className = 'journal-rewards';
      rewards.textContent = `Reward: ${def.rewards.join(', ')}.`;
      this.journalBody.appendChild(rewards);
    }
  }

  private buildJournal(): void {
    this.journal.id = 'quest-journal';
    this.journal.hidden = true;
    const frame = document.createElement('div');
    frame.className = 'journal-frame';
    const header = document.createElement('div');
    header.className = 'guide-header';
    this.journalTitle.className = 'guide-title';
    const close = document.createElement('button');
    close.className = 'guide-close';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => this.closeJournal());
    header.append(this.journalTitle, close);
    this.journalBody.className = 'journal-body';
    frame.append(header, this.journalBody);
    this.journal.appendChild(frame);
    document.body.appendChild(this.journal);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.journal.hidden) this.closeJournal();
    });
  }

  private buildComplete(): void {
    this.complete.id = 'quest-complete';
    this.complete.hidden = true;
    this.complete.addEventListener('click', () => {
      this.complete.hidden = true;
    });
    document.body.appendChild(this.complete);
  }
}
