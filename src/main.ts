import './style.css';

import { TileMap } from './sim/TileMap';
import { World } from './sim/World';
import { Player } from './sim/Player';
import { Npc } from './sim/Npc';
import { Tile, chebyshev, tilesEqual } from './sim/coords';
import {
  Command,
  moveCommand,
  attackCommand,
  pickupCommand,
  gatherCommand,
  useItemCommand,
  dropItemCommand,
  equipItemCommand,
  unequipItemCommand,
} from './sim/commands';
import { GameLoop } from './engine/GameLoop';
import { TICKS_PER_SECOND } from './engine/constants';
import { Renderer } from './render/Renderer';
import { Terrain } from './render/Terrain';
import { TileGridView } from './render/TileGridView';
import { SceneryView } from './render/SceneryView';
import { WaterView } from './render/WaterView';
import { EntityView } from './render/EntityView';
import { GroundItemView } from './render/GroundItemView';
import { FireView } from './render/FireView';
import { FishingSpotView } from './render/FishingSpotView';
import { InputController } from './input/InputController';
import { xpForLevel } from './sim/Skills';
import { ItemStack, itemDef } from './sim/items';
import { Hud } from './ui/Hud';
import { Compass } from './ui/Compass';
import { MiniMap } from './ui/MiniMap';
import { InventoryPanel } from './ui/InventoryPanel';
import { SidePanel } from './ui/SidePanel';
import { SkillGuidePanel } from './ui/SkillGuidePanel';
import { buildSettingsPane, buildMusicPane, buildLogoutPane, buildPlaceholderPane } from './ui/miscTabs';
import { BankPanel } from './ui/BankPanel';
import { MessageLog } from './ui/MessageLog';
import { Orbs } from './ui/Orbs';
import { XpDrops } from './ui/XpDrops';
import { ContextMenu, MenuOption } from './ui/ContextMenu';
import { Sfx } from './audio/Sfx';
import { Music } from './audio/Music';
import { SKILL_META } from './ui/skillMeta';
import { buildStartingWorld } from './world/startingWorld';
import { hasWebGL, showFatal, installErrorHandlers } from './diagnostics';

const MAP_W = 52;
const MAP_H = 52;

installErrorHandlers();
start();

function start(): void {
  if (!hasWebGL()) {
    showFatal(
      'WebGL is not available in this browser',
      'Aeloria renders with WebGL, which this browser/tab could not initialize.\n\n' +
        'Things to try:\n' +
        '• Chrome / Edge: Settings → System → enable "Use graphics acceleration when\n' +
        '  available", then fully restart the browser. Visit chrome://gpu — the "WebGL"\n' +
        '  and "WebGL2" rows should read "Hardware accelerated".\n' +
        '• Brave: lower Shields for this site — fingerprint protection can block WebGL.\n' +
        '• Safari: Develop menu → make sure WebGL is not disabled.\n' +
        '• Try a different browser to confirm it is environment-specific.',
    );
    return;
  }

  try {
    runGame();
  } catch (err) {
    showFatal(
      'Aeloria failed to start',
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    throw err;
  }
}

function runGame(): void {
  // --- Simulation ----------------------------------------------------------
  const map = new TileMap(MAP_W, MAP_H);
  const { props, spawn, moat, fishingSpotGroups, terrain: terrainSpec } = buildStartingWorld(map);

  const world = new World(map);
  const player = world.spawnPlayer(spawn, 'You');
  giveStarterKit(player);

  // Every tree and rock prop is also a gatherable resource node in the sim,
  // and the courtyard furniture becomes usable world objects.
  for (const prop of props) {
    if (prop.kind === 'tree' || prop.kind === 'rock') {
      world.addResourceNode(prop.kind, prop.tile);
    } else if (prop.kind === 'bank-booth') {
      world.addInteractable('bank', prop.tile);
    } else if (prop.kind === 'altar') {
      world.addInteractable('altar', prop.tile);
    }
  }
  for (const group of fishingSpotGroups) world.addFishingSpotGroup(group);

  populateNpcs(world, map);

  // --- Input → command queue -----------------------------------------------
  // Clicks become commands that are drained into the sim on the next tick. This
  // queue is the stand-in for "messages sent to the server".
  const commandQueue: Command[] = [];

  // --- Rendering -----------------------------------------------------------
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const terrain = new Terrain(map, props, terrainSpec);
  renderer.scene.add(terrain.mesh);
  renderer.frameShadows(MAP_W / 2, MAP_H / 2, 36);
  const tileView = new TileGridView(renderer.scene, terrain);
  const scenery = new SceneryView(renderer.scene, props, terrain);
  const water = new WaterView(renderer.scene, moat);
  const entityView = new EntityView(renderer.scene, world, terrain);
  const groundView = new GroundItemView(renderer.scene, world, terrain);
  const fireView = new FireView(renderer.scene, world, terrain);
  const spotView = new FishingSpotView(renderer.scene, world);
  const hud = new Hud();
  const compass = new Compass(renderer.camera);
  const log = new MessageLog();
  const xpDrops = new XpDrops();
  const menu = new ContextMenu();
  const sfx = new Sfx();
  const music = new Music();
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
      log.add(music.toggle() ? 'Music: on.' : 'Music: off.');
    }
  });

  const orbs = new Orbs((on) => {
    commandQueue.push({ type: 'setRun', entityId: player.id, on });
  });

  const bankPanel = new BankPanel(player, {
    onWithdraw: (itemId, qty) =>
      commandQueue.push({ type: 'bankWithdraw', entityId: player.id, itemId, qty }),
    onStackMenu: (itemId, x, y) => {
      const def = itemDef(itemId);
      const withdraw = (qty: number): MenuOption => ({
        verb: qty < 0 ? 'Withdraw-All' : `Withdraw-${qty}`,
        target: def.name,
        onSelect: () =>
          commandQueue.push({ type: 'bankWithdraw', entityId: player.id, itemId, qty }),
      });
      menu.open(x, y, [
        withdraw(1),
        withdraw(5),
        withdraw(-1),
        { verb: 'Examine', target: def.name, onSelect: () => log.add(def.examine) },
        { verb: 'Cancel' },
      ]);
    },
    onDepositAll: () => commandQueue.push({ type: 'bankDepositAll', entityId: player.id }),
  });

  const sidePanel = new SidePanel();
  const skillGuide = new SkillGuidePanel();
  const panel = new InventoryPanel(world, player, sidePanel, {
    onSkillClick: (skill) => skillGuide.open(skill, player.skills.levelOf(skill)),
    onItemMenu: (index, item, x, y) => menu.open(x, y, itemMenuOptions(index, item)),
    onItemQuick: (index, item) => {
      if (bankPanel.isOpen) {
        commandQueue.push({ type: 'bankDeposit', entityId: player.id, slot: index, qty: 1 });
        return;
      }
      const def = itemDef(item.id);
      if (def.heals !== undefined || def.buryXp !== undefined) {
        commandQueue.push(useItemCommand(player.id, index));
      } else if (def.equip) {
        commandQueue.push(equipItemCommand(player.id, index));
      }
    },
    onEquip: (index) => commandQueue.push(equipItemCommand(player.id, index)),
    onUnequip: (slot) => commandQueue.push(unequipItemCommand(player.id, slot)),
    onSetStyle: (index) => commandQueue.push({ type: 'setStyle', entityId: player.id, index }),
    onSetAutoRetaliate: (on) =>
      commandQueue.push({ type: 'setAutoRetaliate', entityId: player.id, on }),
    onTogglePrayer: (prayerId) =>
      commandQueue.push({ type: 'togglePrayer', entityId: player.id, prayerId }),
  });

  // The rest of the interface strip: settings, music, logout, and the social
  // tabs a single-player world has no use for yet.
  const musicCb = {
    onToggleMusic: () => {
      const on = music.toggle();
      log.add(on ? 'Music: on.' : 'Music: off.');
      return on;
    },
    musicOn: () => music.isOn,
  };
  sidePanel.register('settings', buildSettingsPane(musicCb));
  sidePanel.register('music', buildMusicPane(musicCb));
  sidePanel.register('logout', buildLogoutPane());
  sidePanel.register('quests', buildPlaceholderPane('Quest List', 'No quests are available yet.'));
  sidePanel.register('magic', buildPlaceholderPane('Magic', 'You have not learned any spells yet.'));
  sidePanel.register('clan', buildPlaceholderPane('Clan Chat', 'Aeloria is single-player for now.'));
  sidePanel.register('friends', buildPlaceholderPane('Friends List', 'Aeloria is single-player for now.'));
  sidePanel.register('account', buildPlaceholderPane('Account Management', 'Nothing to manage yet.'));
  sidePanel.register('emotes', buildPlaceholderPane('Emotes', 'No emotes yet.'));
  sidePanel.select('inventory');

  const minimap = new MiniMap(map, world, player.id, renderer.camera, props, (target) => {
    commandQueue.push(moveCommand(player.id, target));
    tileView.showClickMarker(target);
  });
  log.add('Welcome to Aeloria.');

  // Start the camera already framing the player instead of flying in from origin.
  renderer.camera.focus.set(player.position.x, terrain.tileHeight(player.position), player.position.y);

  /** Right-click options for a backpack item, OSRS verb-first. */
  function itemMenuOptions(index: number, item: ItemStack): MenuOption[] {
    const def = itemDef(item.id);
    const options: MenuOption[] = [];

    if (bankPanel.isOpen) {
      const deposit = (qty: number): MenuOption => ({
        verb: qty < 0 ? 'Deposit-All' : `Deposit-${qty}`,
        target: def.name,
        onSelect: () =>
          commandQueue.push({ type: 'bankDeposit', entityId: player.id, slot: index, qty }),
      });
      return [
        deposit(1),
        deposit(5),
        deposit(-1),
        { verb: 'Examine', target: def.name, onSelect: () => log.add(def.examine) },
        { verb: 'Cancel' },
      ];
    }

    if (def.heals !== undefined) {
      options.push({
        verb: 'Eat',
        target: def.name,
        onSelect: () => commandQueue.push(useItemCommand(player.id, index)),
      });
    }
    if (def.buryXp !== undefined) {
      options.push({
        verb: 'Bury',
        target: def.name,
        onSelect: () => commandQueue.push(useItemCommand(player.id, index)),
      });
    }
    if (def.firemakingXp !== undefined) {
      options.push({
        verb: 'Light',
        target: def.name,
        onSelect: () => commandQueue.push({ type: 'lightFire', entityId: player.id, slot: index }),
      });
    }
    if (def.equip) {
      options.push({
        verb: def.equip === 'weapon' ? 'Wield' : 'Wear',
        target: def.name,
        onSelect: () => commandQueue.push(equipItemCommand(player.id, index)),
      });
    }
    options.push({
      verb: 'Drop',
      target: def.name,
      onSelect: () => commandQueue.push(dropItemCommand(player.id, index)),
    });
    options.push({ verb: 'Examine', target: def.name, onSelect: () => log.add(def.examine) });
    options.push({ verb: 'Cancel' });
    return options;
  }

  /** OSRS tints an NPC's "(level-X)" by how it compares to yours. */
  function levelColor(npcLevel: number): string {
    const diff = npcLevel - world.combatLevelOf(player);
    if (diff < -9) return '#00ff00';
    if (diff < -3) return '#8fe83a';
    if (diff <= 3) return '#ffff00';
    if (diff <= 9) return '#ff9040';
    return '#ff0000';
  }

  const input = new InputController(
    canvas,
    renderer.camera,
    terrain,
    (target) => {
      // Left click = the default action: attack NPC > take item > gather >
      // use object > walk. (The same priority order the context menu lists.)
      if (menu.isOpen) return;
      const npc = npcAt(world, target);
      const ground = world.groundItemAt(target);
      const node = world.resourceNodeAt(target);
      const object = world.interactableAt(target);
      if (npc) {
        commandQueue.push(attackCommand(player.id, npc.id));
        tileView.showClickMarker(target, 'interact');
      } else if (ground) {
        commandQueue.push(pickupCommand(player.id, ground.id));
        tileView.showClickMarker(target, 'interact');
      } else if (node && node.regrowTimer <= 0) {
        commandQueue.push(gatherCommand(player.id, node.id));
        tileView.showClickMarker(target, 'interact');
      } else if (object) {
        commandQueue.push({ type: 'interact', entityId: player.id, kind: object.kind, target });
        tileView.showClickMarker(target, 'interact');
      } else {
        commandQueue.push(moveCommand(player.id, target));
        tileView.showClickMarker(target);
      }
    },
    (clientX, clientY, target) => {
      menu.open(clientX, clientY, menuOptionsFor(target));
    },
  );

  /** Everything you could do on a tile, in OSRS priority order. */
  function menuOptionsFor(target: Tile): MenuOption[] {
    const options: MenuOption[] = [];
    const npc = npcAt(world, target);
    const ground = world.groundItemAt(target);
    const node = world.resourceNodeAt(target);
    const fire = world.fireAt(target);
    const object = world.interactableAt(target);

    if (npc) {
      const level = npc.combatLevel;
      options.push({
        verb: 'Attack',
        target: `${npc.name} (level-${level})`,
        targetColor: levelColor(level),
        onSelect: () => commandQueue.push(attackCommand(player.id, npc.id)),
      });
    }
    if (ground) {
      options.push({
        verb: 'Take',
        target: itemDef(ground.item.id).name,
        onSelect: () => commandQueue.push(pickupCommand(player.id, ground.id)),
      });
    }
    if (node && node.regrowTimer <= 0) {
      const verbs: Record<string, [string, string]> = {
        tree: ['Chop down', 'Tree'],
        rock: ['Mine', 'Rock'],
        fishing_spot: ['Net', 'Fishing spot'],
      };
      const [verb, name] = verbs[node.kind];
      options.push({
        verb,
        target: name,
        onSelect: () => commandQueue.push(gatherCommand(player.id, node.id)),
      });
    }
    if (fire) {
      // One Cook row per distinct raw food in the backpack.
      const seen = new Set<string>();
      for (const s of player.inventory.slots) {
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        const def = itemDef(s.id);
        if (!def.cooking) continue;
        options.push({
          verb: 'Cook',
          target: def.name,
          onSelect: () =>
            commandQueue.push({ type: 'cook', entityId: player.id, fireId: fire.id, itemId: s.id }),
        });
      }
    }
    if (object) {
      options.push({
        verb: object.kind === 'bank' ? 'Bank' : 'Pray-at',
        target: object.kind === 'bank' ? 'Bank booth' : 'Altar',
        onSelect: () =>
          commandQueue.push({ type: 'interact', entityId: player.id, kind: object.kind, target }),
      });
    }

    options.push({
      verb: 'Walk here',
      onSelect: () => {
        commandQueue.push(moveCommand(player.id, target));
        tileView.showClickMarker(target);
      },
    });

    for (const [name, text] of examinables(npc, ground, node, fire, object)) {
      options.push({ verb: 'Examine', target: name, onSelect: () => log.add(text) });
    }

    options.push({ verb: 'Cancel' });
    return options;
  }

  // --- Game loop -----------------------------------------------------------
  // Turn sim announcements into UI: XP drops, level-up banners, log lines.
  const drainEvents = (): void => {
    for (const ev of world.eventQueue.splice(0)) {
      switch (ev.type) {
        case 'xp':
          if (ev.entityId === player.id) xpDrops.drop(ev.skill, ev.amount);
          break;
        case 'levelup':
          if (ev.entityId === player.id) {
            const label = SKILL_META[ev.skill].label;
            const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
            xpDrops.levelUp(ev.skill, ev.level);
            sfx.levelUp();
            log.add(
              `Congratulations, you just advanced ${article} ${label} level. ` +
                `Your ${label} level is now ${ev.level}.`,
              'levelup',
            );
          }
          break;
        case 'kill':
          if (ev.killerId === player.id) {
            log.add(`You have defeated the ${ev.victimName}.`);
            sfx.death();
          }
          break;
        case 'died':
          if (ev.entityId === player.id) {
            log.add('Oh dear, you are dead!', 'danger');
            sfx.death();
            bankPanel.close();
          }
          break;
        case 'hit':
          if (ev.damage > 0) sfx.hit();
          else sfx.block();
          break;
        case 'swing':
          if (ev.kind === 'chop') sfx.chop();
          else if (ev.kind === 'mine') sfx.mine();
          else sfx.splash();
          break;
        case 'pickup':
          sfx.pickup();
          break;
        case 'ate':
          sfx.eat();
          break;
        case 'sfx':
          sfx[ev.name]();
          break;
        case 'openBank':
          if (ev.entityId === player.id) bankPanel.open();
          break;
        case 'message':
          log.add(ev.text);
          break;
      }
    }
  };

  /** The bank screen closes once you wander off, like OSRS. */
  const closeBankIfFar = (): void => {
    if (!bankPanel.isOpen) return;
    const near = world.interactables.some(
      (i) => i.kind === 'bank' && chebyshev(player.position, i.tile) <= 2,
    );
    if (!near) bankPanel.close();
  };

  const loop = new GameLoop({
    onTick: () => {
      world.tick(commandQueue.splice(0));
      drainEvents();
      closeBankIfFar();
      panel.refresh(); // reflect XP/level/inventory changes from this tick
      bankPanel.refresh();
      skillGuide.refresh((skill) => player.skills.levelOf(skill));
    },
    onRender: (alpha, dt) => {
      water.update(dt);
      entityView.sync(alpha, dt);
      groundView.sync(dt);
      fireView.sync(dt);
      spotView.sync(dt);
      scenery.sync(world);

      const followTarget = entityView.positionOf(player.id);
      if (followTarget) renderer.camera.follow(followTarget);
      renderer.camera.update(dt);

      tileView.update(input.hoverTile, dt);
      renderer.render();
      hud.update(world, player, dt);
      compass.update();
      minimap.update();
      orbs.update(player);
    },
  });
  loop.start();

  // Expose a read/drive handle for automated smoke tests and console debugging.
  // Commands pushed here go through the exact same queue as real input.
  (window as unknown as Record<string, unknown>).__aeloria = {
    world,
    player,
    xpForLevel,
    itemDef,
    push: (cmd: Command) => commandQueue.push(cmd),
    attack: (npcName: string) => {
      // Whatever is already on us wins (single-way combat lets us fight only
      // that one), otherwise the nearest living NPC of that name.
      let best: Npc | null = null;
      let bestDist = Infinity;
      for (const e of world.entities.values()) {
        if (!(e instanceof Npc) || !e.isAlive || e.name !== npcName) continue;
        const dist = e.targetId === player.id ? -1 : chebyshev(e.position, player.position);
        if (dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
      if (!best) return null;
      commandQueue.push(attackCommand(player.id, best.id));
      return best.id;
    },
    moveTo: (x: number, y: number) => commandQueue.push(moveCommand(player.id, { x, y })),
    hoverTile: () => input.hoverTile,
    sfx,
    stats: () => renderer.stats,
    gather: (x: number, y: number) => {
      const node = world.resourceNodeAt({ x, y });
      if (node) commandQueue.push(gatherCommand(player.id, node.id));
      return node?.id ?? null;
    },
    give: (id: string, qty = 1) => player.inventory.add(id, qty),
    fish: () => {
      for (const node of world.resourceNodes.values()) {
        if (node.kind === 'fishing_spot') {
          commandQueue.push(gatherCommand(player.id, node.id));
          return node.id;
        }
      }
      return null;
    },
    bankIsOpen: () => bankPanel.isOpen,
  };
}

/** The starting cast: a goblin camp, giant rats by the treeline, gate guards. */
function populateNpcs(world: World, map: TileMap): void {
  const respawn = Math.round(15 * TICKS_PER_SECOND);

  // A camp of goblins on the grass south-east of the approach. Aggressive,
  // like the low-level pests they are — but only toward adventurers near their
  // level — and sited so their wander-plus-aggro reach never covers the spawn
  // tile: a fresh (re)spawn is safe, like Lumbridge's goblins across the river.
  const goblin = {
    name: 'Goblin',
    kind: 'goblin' as const,
    attack: 1,
    strength: 1,
    defense: 1,
    maxHitpoints: 5,
    attackSpeed: 4,
    respawnTicks: respawn,
    aggroRange: 2,
    wanderRadius: 3,
    drops: [
      { itemId: 'bones', chance: 1 },
      { itemId: 'coins', chance: 0.5, min: 5, max: 24 },
      { itemId: 'bronze_scimitar', chance: 1 / 16 },
      { itemId: 'bronze_med_helm', chance: 1 / 12 },
    ],
  };
  for (const tile of [{ x: 30, y: 21 }, { x: 28, y: 19 }, { x: 32, y: 22 }, { x: 27, y: 17 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, goblin);
  }

  // Giant rats scurrying along the southern treeline. Weak but bitey, and a
  // steady source of meat for the cooking fire.
  const rat = {
    name: 'Giant rat',
    kind: 'rat' as const,
    attack: 2,
    strength: 3,
    defense: 2,
    maxHitpoints: 5,
    attackSpeed: 4,
    respawnTicks: respawn,
    aggroRange: 2,
    wanderRadius: 4,
    drops: [
      { itemId: 'bones', chance: 1 },
      { itemId: 'raw_rat_meat', chance: 1 },
    ],
  };
  for (const tile of [{ x: 18, y: 12 }, { x: 27, y: 10 }, { x: 31, y: 13 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, rat);
  }

  // Two guards flanking the bridge approach. Passive, but they hit back hard —
  // and their pockets hold the first real gear upgrades.
  const guard = {
    name: 'Guard',
    kind: 'guard' as const,
    attack: 15,
    strength: 15,
    defense: 15,
    maxHitpoints: 22,
    attackSpeed: 5,
    respawnTicks: respawn * 2,
    aggroRange: 0,
    wanderRadius: 2,
    drops: [
      { itemId: 'bones', chance: 1 },
      { itemId: 'coins', chance: 0.9, min: 4, max: 36 },
      { itemId: 'iron_scimitar', chance: 0.08 },
      { itemId: 'steel_scimitar', chance: 0.03 },
      { itemId: 'iron_pickaxe', chance: 0.04 },
      { itemId: 'steel_axe', chance: 0.04 },
      { itemId: 'bread', chance: 0.1 },
      { itemId: 'holy_symbol', chance: 0.02 },
    ],
  };
  for (const tile of [{ x: 22, y: 31 }, { x: 26, y: 31 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, guard);
  }
}

/**
 * A fresh adventurer's kit, straight off the boat: a bronze blade and the
 * tools for every starting skill. Levels begin at 1 — the OSRS way.
 */
function giveStarterKit(player: Player): void {
  const inv = player.inventory;
  inv.add('bronze_scimitar');
  inv.add('wooden_shield');
  inv.add('bronze_axe');
  inv.add('bronze_pickaxe');
  inv.add('tinderbox');
  inv.add('small_fishing_net');
  inv.add('bread');
  inv.add('coins', 25);
}

/** Flavor text for whatever is examinable on a tile. */
function examinables(
  npc: Npc | null,
  ground: { item: ItemStack } | null,
  node: { kind: 'tree' | 'rock' | 'fishing_spot'; regrowTimer: number } | null,
  fire: unknown | null,
  object: { kind: 'bank' | 'altar' } | null,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (npc) out.push([npc.name, EXAMINE_NPC[npc.kind] ?? 'A creature.']);
  if (ground) out.push([itemDef(ground.item.id).name, itemDef(ground.item.id).examine]);
  if (node && node.regrowTimer <= 0) {
    const texts: Record<string, [string, string]> = {
      tree: ['Tree', 'A leafy tree, good for logs.'],
      rock: ['Rock', 'A rocky outcrop with a seam of copper.'],
      fishing_spot: ['Fishing spot', 'Something is stirring beneath the surface.'],
    };
    out.push(texts[node.kind]);
  }
  if (fire) out.push(['Fire', 'A warm crackling fire, good for cooking.']);
  if (object) {
    out.push(
      object.kind === 'bank'
        ? ['Bank booth', 'Your valuables, kept safe for a modest smile.']
        : ['Altar', 'An altar to the gods of Aeloria.'],
    );
  }
  return out;
}

const EXAMINE_NPC: Record<string, string> = {
  goblin: 'An ugly green creature.',
  rat: 'Overgrown vermin.',
  guard: 'He looks bored, but capable.',
};

/** The living NPC standing on a tile, if any — used to turn a click into an attack. */
function npcAt(world: World, tile: Tile): Npc | null {
  for (const entity of world.entities.values()) {
    if (entity instanceof Npc && entity.isAlive && tilesEqual(entity.position, tile)) {
      return entity;
    }
  }
  return null;
}
