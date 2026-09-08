// Regenerates src/sim/skillGuides/data.ts from the OSRS Wiki's per-skill
// "Level up table" pages — the same data the in-game skill guide shows when
// you click a skill on the stats tab. Usage: node scripts/build-skill-guides.mjs
//
// Source: https://oldschool.runescape.wiki (CC BY-NC-SA 3.0). The wikitext of
// each page is a {{Level up table}} template with |freeplayN= and |membersN=
// bullet lists; we flatten those into one entry per unlock.
import { writeFileSync } from 'node:fs';

/** Wiki page name → our SkillId. */
const SKILLS = [
  ['Attack', 'attack'],
  ['Hitpoints', 'hitpoints'],
  ['Mining', 'mining'],
  ['Strength', 'strength'],
  ['Agility', 'agility'],
  ['Smithing', 'smithing'],
  ['Defence', 'defense'],
  ['Herblore', 'herblore'],
  ['Fishing', 'fishing'],
  ['Ranged', 'range'],
  ['Thieving', 'thieving'],
  ['Cooking', 'cooking'],
  ['Prayer', 'prayer'],
  ['Crafting', 'crafting'],
  ['Firemaking', 'firemaking'],
  ['Magic', 'magic'],
  ['Fletching', 'fletching'],
  ['Woodcutting', 'woodcutting'],
  ['Runecraft', 'runecraft'],
  ['Slayer', 'slayer'],
  ['Farming', 'farming'],
  ['Construction', 'construction'],
  ['Hunter', 'hunter'],
];

/**
 * Sub-tab assignment, mirroring the in-game guide's categories where they
 * exist. First matching rule wins; anything else lands in the last category.
 */
const CATEGORIES = {
  attack: [['Weapons', /wield|weapon|sword|dagger|scimitar|mace|axe|whip|spear|halberd|claw|hasta|rapier|blade|hammer|maul|bludgeon|flail|staff|sceptre|lance|scythe|pickaxe|hatchet|machete|sickle|cutlass|katana/i]],
  strength: [['Weapons', /wield|weapon|sword|dagger|scimitar|mace|axe|whip|spear|halberd|claw|hasta|rapier|blade|hammer|maul|bludgeon|flail|staff|sceptre|lance|scythe|granite|obsidian|dinh|tzhaar/i]],
  defense: [['Armour', /wear|armour|armor|shield|helm|body|legs|boots|gloves|gauntlet|cape|ring|amulet|plate|chain|kite|defender|skirt|tassets|chaps|vambrace|coif|cloak|hood|mask|robe|d'hide|dragonhide|hide/i]],
  hitpoints: [['Hitpoints', /./]],
  range: [
    ['Weapons', /wield|bow|crossbow|dart|knife|javelin|thrownaxe|throwing|chinchompa|blowpipe|ballista|ammo|arrow|bolt|cannon|sling/i],
    ['Armour', /wear|armour|armor|leather|d'hide|dragonhide|chaps|vamb|coif|body|helm|cape|mask|hide|robe/i],
  ],
  prayer: [
    ['Prayers', /prayer|activate|protect|thick skin|burst|clarity|reflex|skin|strength|rapid|piety|chivalry|rigour|augury|retribution|redemption|smite|preserve|eagle|mystic|hawk|steel|ultimate|incredible|sharp|rock|superhuman|improved/i],
    ['Bones & offerings', /bur|bones|ashes|offer|scatter|altar|ectofuntus|gilded/i],
  ],
  magic: [
    ['Spells', /cast|spell|teleport|alch|enchant|strike|bolt|blast|wave|surge|charge|bind|snare|entangle|curse|confuse|weaken|vulnerability|stun|superheat|telekinetic|bones to|crumble|ancient|lunar|arceuus|barrage|burst|rush|blitz/i],
    ['Equipment', /wield|wear|staff|robe|wand|hat|book|tome|cape|amulet|ring|boots|gloves|shield|orb|sceptre|battlestaff|mystic|infinity|ahrim|kodai|trident|sang/i],
  ],
  woodcutting: [
    ['Axes', /axe/i],
    ['Canoes', /canoe/i],
    ['Trees', /chop|cut|log|tree|jungle|bark|mushroom|fungus|root/i],
  ],
  mining: [
    ['Pickaxes', /pickaxe/i],
    ['Rocks', /mine|rock|ore|essence|gem|clay|coal|granite|sandstone|salt|amethyst|stone|deposit|vein|blast/i],
  ],
  fishing: [
    ['Equipment', /net|rod|harpoon|cage|barbarian|karambwan vessel|use|wear|dragon harpoon|crystal harpoon|infernal harpoon|angler|fishing outfit|cape/i],
    ['Fish', /catch|fish|shrimp|sardine|herring|anchov|mackerel|trout|salmon|pike|tuna|lobster|swordfish|monkfish|shark|karambwan|eel|manta|sea turtle|dark crab|anglerfish|minnow|cod|bass|salt|leaping/i],
  ],
  cooking: [
    ['Food', /cook|make|brew|bake|prepare|boil|churn|squeeze|use|range|stew|pie|cake|pizza|bread|potato|wine|ale|kebab/i],
  ],
  firemaking: [
    ['Logs', /light|burn|log|pyre|fire|beacon|kindling|torch|lantern|candle|bruma|wintertodt|brazier/i],
  ],
  smithing: [
    ['Smelting', /smelt|bar|furnace|cannonball/i],
    ['Smithing', /smith|make|anvil|forge|repair|nail|bolt|dart|arrow|helm|sword|dagger|axe|mace|scimitar|longsword|warhammer|battleaxe|claws|2h|plate|chain|kite|sq shield|med helm|full helm|legs|skirt|body|knife|hammer/i],
  ],
  crafting: [['Items', /./]],
  fletching: [['Items', /./]],
  herblore: [
    ['Herbs', /clean|grimy|herb/i],
    ['Potions', /make|mix|brew|potion|dose|barbarian|tar|unfinished|combine/i],
  ],
  thieving: [
    ['Pickpocketing', /pickpocket|pick.?pocket/i],
    ['Stalls', /steal from|stall/i],
    ['Locks & chests', /open|pick|lock|chest|door|coffin|safe|loot/i],
  ],
  agility: [
    ['Courses', /course|agility arena|pyramid|rooftop|log balance|obstacle|training/i],
    ['Shortcuts', /shortcut|jump|climb|squeeze|cross|swing|balance|grapple|pass|leap|crawl|walk across|vine|rope|ledge|gap|stepping|pipe|wall/i],
  ],
  slayer: [['Monsters', /./]],
  farming: [['Crops', /./]],
  runecraft: [['Runes', /./]],
  construction: [['Furniture', /./]],
  hunter: [['Creatures', /./]],
};

/** Lines that aren't unlocks: quest/diary requirements and tutor chatter. */
const SKIP = [
  /^required (to|for)/i,
  /^new information is available/i,
  /^receive a maximum of/i,
  /^each level/i,
  /^contributes to/i,
  /^slightly increases/i,
  /^increases (the|your)/i,
  /^begin (to|the)/i,
  /^\s*$/,
];

async function fetchWikitext(page) {
  const url =
    'https://oldschool.runescape.wiki/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page=' +
    encodeURIComponent(`${page}/Level up table`);
  const res = await fetch(url, { headers: { 'User-Agent': 'aeloria-skill-guides/1.0 (dev tool)' } });
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.parse?.wikitext) throw new Error(`${page}: no wikitext (${JSON.stringify(json).slice(0, 200)})`);
  return json.parse.wikitext;
}

/** Strip wiki markup from one bullet into plain prose. */
function clean(raw) {
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  // Templates, innermost first so nesting resolves.
  for (let guard = 0; guard < 12 && /\{\{[^{}]*\}\}/.test(s); guard++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|').map((p) => p.trim());
      const name = parts[0].toLowerCase();
      const named = {};
      const positional = [];
      for (const p of parts.slice(1)) {
        const eq = p.indexOf('=');
        if (eq > 0) named[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
        else positional.push(p);
      }
      // Footnotes and maintenance tags carry no unlock text.
      if (name === 'efn' || name === 'note' || name === 'fact' || name === 'citation needed' || name === 'clarify') {
        return '';
      }
      // A leading space keeps a template's text from gluing onto the word
      // before it; the whitespace collapse below tidies up any doubles.
      if (name === 'plink' || name === 'plinkp' || name === 'plinkt' || name === 'ilink' || name === 'clink') {
        return ' ' + (named.txt ?? positional[0] ?? '');
      }
      if (name === 'scp' || name === 'skill clickpic' || name === 'skill') {
        // {{SCP|Cooking|35}} → "Cooking 35"; {{SCP|quest}} is just an icon.
        const skill = positional[0] ?? '';
        const lvl = positional[1];
        if (!lvl || /^(quest|diary|members|f2p)$/i.test(skill)) return '';
        return `${skill} ${lvl}`;
      }
      if (name === 'members' || name === 'f2p' || name === 'free-to-play' || name === 'external') return '';
      if (name === 'nowrap') return positional[0] ?? '';
      return positional.join(' ');
    });
  }
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, ' $2').replace(/\[\[([^\]]*)\]\]/g, ' $1');
  s = s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '');
  s = s.replace(/[{}]+/g, ''); // stray braces from unbalanced source markup
  s = s.replace(/'''?/g, '');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s*\)/g, '').trim();
  s = s.replace(/\s+\(with\s*\)$/, '').replace(/\(with\s+/g, '(with ');
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

function parseTable(wikitext) {
  const start = wikitext.indexOf('{{Level up table');
  if (start < 0) throw new Error('no Level up table template');
  const body = wikitext.slice(start);
  // Split on parameter boundaries: a newline followed by "|name =".
  const params = body.split(/\n(?=\|\s*\w+\s*=)/);
  const rows = [];
  for (const chunk of params) {
    const m = chunk.match(/^\|\s*(freeplay|members)(\d+|all)\s*=\s*([\s\S]*)$/);
    if (!m) continue;
    const members = m[1] === 'members';
    if (m[2] === 'all') continue;
    const level = Number(m[2]);
    const bullets = m[3]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('*'))
      .map((l) => l.replace(/^\*+\s*/, ''));
    for (const b of bullets) {
      const text = clean(b);
      if (!text || SKIP.some((re) => re.test(text))) continue;
      rows.push({ level, text, members });
    }
  }
  return rows;
}

function categorise(skill, text) {
  const rules = CATEGORIES[skill] ?? [];
  for (const [name, re] of rules) if (re.test(text)) return name;
  return rules.length === 1 ? rules[0][0] : 'Other';
}

const guides = {};
for (const [page, id] of SKILLS) {
  const wikitext = await fetchWikitext(page);
  const rows = parseTable(wikitext);
  const seen = new Set();
  const entries = [];
  for (const r of rows) {
    const key = `${r.level}|${r.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ ...r, category: categorise(id, r.text) });
  }
  entries.sort((a, b) => a.level - b.level);
  const order = (CATEGORIES[id] ?? []).map(([n]) => n);
  const categories = [...new Set([...order.filter((c) => entries.some((e) => e.category === c)), ...entries.map((e) => e.category)])];
  guides[id] = { skill: id, categories, entries };
  console.log(`${page.padEnd(13)} ${String(entries.length).padStart(4)} entries, ${categories.length} categories`);
}

const q = (s) => JSON.stringify(s);
let out = `// GENERATED by scripts/build-skill-guides.mjs — do not edit by hand.\n`;
out += `// Source: OSRS Wiki "Level up table" pages (CC BY-NC-SA 3.0),\n// https://oldschool.runescape.wiki. Generated ${new Date().toISOString().slice(0, 10)}.\n`;
out += `import type { SkillId } from '../Skills';\nimport type { SkillGuide } from './types';\n\n`;
out += `export const SKILL_GUIDES: Record<SkillId, SkillGuide> = {\n`;
for (const [, id] of SKILLS) {
  const g = guides[id];
  out += `  ${id}: {\n    skill: ${q(id)},\n    categories: [${g.categories.map(q).join(', ')}],\n    entries: [\n`;
  for (const e of g.entries) {
    out += `      { level: ${e.level}, text: ${q(e.text)}, category: ${q(e.category)}${e.members ? ', members: true' : ''} },\n`;
  }
  out += `    ],\n  },\n`;
}
out += `};\n`;
writeFileSync(new URL('../src/sim/skillGuides/data.ts', import.meta.url), out);
console.log('wrote src/sim/skillGuides/data.ts');
