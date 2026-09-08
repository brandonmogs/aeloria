import { SkillId, MAX_LEVEL } from '../sim/Skills';
import { SKILL_GUIDES } from '../sim/skillGuides/data';
import { SKILL_META } from './skillMeta';

/**
 * The skill guide: the window OSRS opens when you click a skill on the stats
 * tab. A column of category tabs down the left, and on the right every unlock
 * for that category listed by level — "Level 15: Chop oak logs". Unlocks the
 * player has already reached are bright; the rest are dimmed, and members-only
 * content on the real game carries a small tag. Data comes straight from the
 * OSRS Wiki's level-up tables (see scripts/build-skill-guides.mjs).
 */
export class SkillGuidePanel {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private readonly list = document.createElement('div');
  private skill: SkillId | null = null;
  private category = '';
  private level = 1;

  constructor() {
    this.root.id = 'skill-guide';
    this.root.hidden = true;

    const frame = document.createElement('div');
    frame.className = 'guide-frame';

    const header = document.createElement('div');
    header.className = 'guide-header';
    this.title.className = 'guide-title';
    const close = document.createElement('button');
    close.className = 'guide-close';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(this.title, close);

    const body = document.createElement('div');
    body.className = 'guide-body';
    this.tabs.className = 'guide-tabs';
    this.list.className = 'guide-list';
    body.append(this.tabs, this.list);

    frame.append(header, body);
    this.root.appendChild(frame);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(skill: SkillId, level: number): void {
    const guide = SKILL_GUIDES[skill];
    this.skill = skill;
    this.level = level;
    this.category = guide.categories[0] ?? '';
    this.title.textContent = `${SKILL_META[skill].icon} ${SKILL_META[skill].label} Guide`;
    this.root.hidden = false;
    this.renderTabs();
    this.renderList();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Keep the reached/unreached shading current as the player levels. */
  refresh(levelOf: (skill: SkillId) => number): void {
    if (this.root.hidden || !this.skill) return;
    const level = levelOf(this.skill);
    if (level === this.level) return;
    this.level = level;
    this.renderList();
  }

  private renderTabs(): void {
    if (!this.skill) return;
    const guide = SKILL_GUIDES[this.skill];
    this.tabs.textContent = '';
    for (const category of guide.categories) {
      const btn = document.createElement('button');
      btn.className = 'guide-tab';
      btn.textContent = category;
      btn.classList.toggle('active', category === this.category);
      btn.addEventListener('click', () => {
        this.category = category;
        this.renderTabs();
        this.renderList();
      });
      this.tabs.appendChild(btn);
    }
  }

  private renderList(): void {
    if (!this.skill) return;
    const guide = SKILL_GUIDES[this.skill];
    this.list.textContent = '';
    const entries = guide.entries.filter((e) => e.category === this.category);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'guide-empty';
      empty.textContent = 'Nothing to unlock here yet.';
      this.list.appendChild(empty);
      return;
    }
    let firstLocked: HTMLElement | null = null;
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'guide-row';
      const reached = this.level >= entry.level;
      row.classList.toggle('locked', !reached);
      if (!reached && !firstLocked) firstLocked = row;

      const lvl = document.createElement('span');
      lvl.className = 'guide-level';
      lvl.textContent = String(entry.level);

      const text = document.createElement('span');
      text.className = 'guide-text';
      text.textContent = entry.text;

      row.append(lvl, text);
      if (entry.members) {
        const tag = document.createElement('span');
        tag.className = 'guide-members';
        tag.textContent = 'M';
        tag.title = 'Members-only on Old School RuneScape';
        row.appendChild(tag);
      }
      this.list.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'guide-foot';
    foot.textContent =
      this.level >= MAX_LEVEL
        ? `Skill mastery — level ${MAX_LEVEL}.`
        : `Your ${SKILL_META[this.skill].label} level is ${this.level}.`;
    this.list.appendChild(foot);
    // Scroll so the next thing to unlock is in view.
    if (firstLocked) {
      this.list.scrollTop = Math.max(0, firstLocked.offsetTop - this.list.clientHeight / 3);
    } else {
      this.list.scrollTop = 0;
    }
  }
}
