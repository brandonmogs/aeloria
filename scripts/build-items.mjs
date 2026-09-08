// Regenerates src/sim/wikiItems.ts: exact OSRS item data (examine text, value,
// weight, equipment bonuses, attack speed, slot) pulled from each item's page
// on the OSRS Wiki via the MediaWiki API. Usage: node scripts/build-items.mjs
//
// Source: https://oldschool.runescape.wiki (CC BY-NC-SA 3.0). Only the numbers
// and examine lines are taken; what an item *does* in Aeloria (cooking, tools,
// level requirements) is defined by hand in src/sim/items.ts.
import { writeFileSync } from 'node:fs';

const METALS = ['Bronze', 'Iron', 'Steel', 'Black', 'Mithril', 'Adamant', 'Rune'];
const WEAPONS = ['dagger', 'sword', 'scimitar', 'longsword', 'mace', 'warhammer', 'battleaxe', '2h sword', 'axe', 'pickaxe'];
const ARMOUR = ['med helm', 'full helm', 'chainbody', 'platebody', 'platelegs', 'sq shield', 'kiteshield'];

/** [wiki page, our item id] */
const PAGES = [];
for (const metal of METALS) {
  for (const w of WEAPONS) PAGES.push([`${metal} ${w}`, `${metal.toLowerCase()}_${w.replace(/ /g, '_')}`]);
  for (const a of ARMOUR) PAGES.push([`${metal} ${a}`, `${metal.toLowerCase()}_${a.replace(/ /g, '_')}`]);
}
for (const [page, id] of [
  ['Wooden shield', 'wooden_shield'],
  ['Leather boots', 'leather_boots'],
  ['Leather gloves', 'leather_gloves'],
  ['Leather body', 'leather_body'],
  ['Leather chaps', 'leather_chaps'],
  ['Leather cowl', 'leather_cowl'],
  ['Gold ring', 'gold_ring'],
  ['Holy symbol', 'holy_symbol'],
  ['Amulet of power', 'amulet_of_power'],
  ['Tinderbox', 'tinderbox'],
  ['Small fishing net', 'small_fishing_net'],
  ['Fishing rod', 'fishing_rod'],
  ['Fishing bait', 'fishing_bait'],
  ['Hammer', 'hammer'],
  ['Knife', 'knife'],
  ['Bread', 'bread'],
  ['Raw shrimps', 'raw_shrimps'],
  ['Shrimps', 'shrimps'],
  ['Raw anchovies', 'raw_anchovies'],
  ['Anchovies', 'anchovies'],
  ['Raw sardine', 'raw_sardine'],
  ['Sardine', 'sardine'],
  ['Raw herring', 'raw_herring'],
  ['Herring', 'herring'],
  ['Raw trout', 'raw_trout'],
  ['Trout', 'trout'],
  ['Raw rat meat', 'raw_rat_meat'],
  ['Cooked meat', 'cooked_meat'],
  ['Burnt meat', 'burnt_meat'],
  ['Burnt fish', 'burnt_fish'],
  ['Burnt shrimp', 'burnt_shrimps'],
  ['Logs', 'logs'],
  ['Oak logs', 'oak_logs'],
  ['Willow logs', 'willow_logs'],
  ['Copper ore', 'copper_ore'],
  ['Tin ore', 'tin_ore'],
  ['Iron ore', 'iron_ore'],
  ['Coal', 'coal'],
  ['Bronze bar', 'bronze_bar'],
  ['Iron bar', 'iron_bar'],
  ['Steel bar', 'steel_bar'],
  ['Bones', 'bones'],
  ['Big bones', 'big_bones'],
  ['Ashes', 'ashes'],
  ['Coins', 'coins'],
  ['Max cape', 'max_cape'],
  ['Goblin mail', 'goblin_mail'],
  ['Bronze arrow', 'bronze_arrow'],
  ['Shortbow', 'shortbow'],
  ['Air rune', 'air_rune'],
  ['Mind rune', 'mind_rune'],
  ['Water rune', 'water_rune'],
  ['Earth rune', 'earth_rune'],
  ['Fire rune', 'fire_rune'],
  ['Body rune', 'body_rune'],
  ['Staff of air', 'staff_of_air'],
]) {
  PAGES.push([page, id]);
}

async function fetchWikitext(page) {
  const url =
    'https://oldschool.runescape.wiki/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=' +
    encodeURIComponent(page);
  const res = await fetch(url, { headers: { 'User-Agent': 'aeloria-item-import/1.0 (dev tool)' } });
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.parse?.wikitext) throw new Error(`${page}: ${JSON.stringify(json).slice(0, 160)}`);
  return json.parse.wikitext;
}

/** Pull the params of the first `{{Template ...}}` block, honouring nested braces. */
function infobox(wikitext, template) {
  const start = wikitext.search(new RegExp(`\\{\\{\\s*${template}\\b`, 'i'));
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++;
      i++;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = wikitext.slice(start + 2, end - 2);
  const params = {};
  // Split on top-level pipes only.
  let level = 0;
  let cur = '';
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') level++;
    if (two === '}}' || two === ']]') level--;
    if (body[i] === '|' && level === 0) {
      parts.push(cur);
      cur = '';
    } else cur += body[i];
  }
  parts.push(cur);
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

/** First defined of `key`, `key1`, `key2` (versioned infoboxes). */
function pick(params, key) {
  for (const k of [key, `${key}1`, `${key}2`]) if (params && params[k] !== undefined && params[k] !== '') return params[k];
  return undefined;
}

function num(v, fallback = 0) {
  if (v === undefined) return fallback;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : fallback;
}

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const out = {};
const failures = [];
for (const [page, id] of PAGES) {
  try {
    const wt = await fetchWikitext(page);
    const item = infobox(wt, 'Infobox Item');
    const bonus = infobox(wt, 'Infobox Bonuses');
    if (!item) throw new Error('no Infobox Item');
    const rec = {
      name: cleanText(pick(item, 'name')) || page,
      examine: cleanText(pick(item, 'examine')),
      value: num(pick(item, 'value'), 1),
      weightKg: num(pick(item, 'weight'), 0),
      stackable: /^yes/i.test(pick(item, 'stackable') ?? ''),
    };
    if (bonus) {
      rec.slot = cleanText(pick(bonus, 'slot')).toLowerCase();
      rec.speed = pick(bonus, 'speed') !== undefined ? num(pick(bonus, 'speed')) : undefined;
      rec.bonuses = {
        astab: num(pick(bonus, 'astab')),
        aslash: num(pick(bonus, 'aslash')),
        acrush: num(pick(bonus, 'acrush')),
        amagic: num(pick(bonus, 'amagic')),
        arange: num(pick(bonus, 'arange')),
        dstab: num(pick(bonus, 'dstab')),
        dslash: num(pick(bonus, 'dslash')),
        dcrush: num(pick(bonus, 'dcrush')),
        dmagic: num(pick(bonus, 'dmagic')),
        drange: num(pick(bonus, 'drange')),
        str: num(pick(bonus, 'str')),
        rstr: num(pick(bonus, 'rstr')),
        mdmg: num(pick(bonus, 'mdmg')),
        prayer: num(pick(bonus, 'prayer')),
      };
    }
    out[id] = rec;
    process.stdout.write('.');
  } catch (err) {
    failures.push(`${page}: ${err.message}`);
    process.stdout.write('x');
  }
}
console.log();
if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));

const q = (s) => JSON.stringify(s);
let ts = `// GENERATED by scripts/build-items.mjs — do not edit by hand.\n`;
ts += `// Source: OSRS Wiki item pages (CC BY-NC-SA 3.0), https://oldschool.runescape.wiki.\n// Generated ${new Date().toISOString().slice(0, 10)}.\n\n`;
ts += `/** Equipment bonuses exactly as the wiki lists them. */\nexport interface WikiBonuses {\n  readonly astab: number;\n  readonly aslash: number;\n  readonly acrush: number;\n  readonly amagic: number;\n  readonly arange: number;\n  readonly dstab: number;\n  readonly dslash: number;\n  readonly dcrush: number;\n  readonly dmagic: number;\n  readonly drange: number;\n  readonly str: number;\n  readonly rstr: number;\n  readonly mdmg: number;\n  readonly prayer: number;\n}\n\n`;
ts += `export interface WikiItem {\n  readonly name: string;\n  readonly examine: string;\n  readonly value: number;\n  readonly weightKg: number;\n  readonly stackable: boolean;\n  readonly slot?: string;\n  readonly speed?: number;\n  readonly bonuses?: WikiBonuses;\n}\n\n`;
ts += `export const WIKI_ITEMS: Record<string, WikiItem> = {\n`;
for (const [id, rec] of Object.entries(out)) {
  ts += `  ${id}: { name: ${q(rec.name)}, examine: ${q(rec.examine)}, value: ${rec.value}, weightKg: ${rec.weightKg}, stackable: ${rec.stackable}`;
  if (rec.slot) ts += `, slot: ${q(rec.slot)}`;
  if (rec.speed !== undefined) ts += `, speed: ${rec.speed}`;
  if (rec.bonuses) {
    const b = rec.bonuses;
    ts += `, bonuses: { astab: ${b.astab}, aslash: ${b.aslash}, acrush: ${b.acrush}, amagic: ${b.amagic}, arange: ${b.arange}, dstab: ${b.dstab}, dslash: ${b.dslash}, dcrush: ${b.dcrush}, dmagic: ${b.dmagic}, drange: ${b.drange}, str: ${b.str}, rstr: ${b.rstr}, mdmg: ${b.mdmg}, prayer: ${b.prayer} }`;
  }
  ts += ` },\n`;
}
ts += `};\n`;
writeFileSync(new URL('../src/sim/wikiItems.ts', import.meta.url), ts);
console.log(`wrote src/sim/wikiItems.ts (${Object.keys(out).length} items)`);
