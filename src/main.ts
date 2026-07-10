import './style.css';

import { TileMap } from './sim/TileMap';
import { World } from './sim/World';
import { Player } from './sim/Player';
import { Npc } from './sim/Npc';
import { Tile, tilesEqual } from './sim/coords';
import { Command, moveCommand, attackCommand, pickupCommand, gatherCommand } from './sim/commands';
import { GameLoop } from './engine/GameLoop';
import { TICKS_PER_SECOND } from './engine/constants';
import { Renderer } from './render/Renderer';
import { TileGridView } from './render/TileGridView';
import { SceneryView } from './render/SceneryView';
import { WaterView } from './render/WaterView';
import { EntityView } from './render/EntityView';
import { GroundItemView } from './render/GroundItemView';
import { InputController } from './input/InputController';
import { xpForLevel } from './sim/Skills';
import { Hud } from './ui/Hud';
import { Compass } from './ui/Compass';
import { MiniMap } from './ui/MiniMap';
import { InventoryPanel } from './ui/InventoryPanel';
import { MessageLog } from './ui/MessageLog';
import { XpDrops } from './ui/XpDrops';
import { ContextMenu, MenuOption } from './ui/ContextMenu';
import { SKILL_META } from './ui/skillMeta';
import { combatLevel } from './sim/combat';
import { tileToWorld } from './render/coords3d';
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
  const { props, spawn, moat } = buildStartingWorld(map);

  const world = new World(map);
  const player = world.spawnPlayer(spawn, 'You');
  giveStarterKit(player);

  // Every tree and rock prop is also a gatherable resource node in the sim.
  for (const prop of props) {
    if (prop.kind === 'tree' || prop.kind === 'rock') {
      world.addResourceNode(prop.kind, prop.tile);
    }
  }

  populateNpcs(world, map);

  // --- Rendering -----------------------------------------------------------
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const tileView = new TileGridView(renderer.scene, map);
  const scenery = new SceneryView(renderer.scene, props);
  const water = new WaterView(renderer.scene, moat, renderer.sunDirection);
  const entityView = new EntityView(renderer.scene, world);
  const groundView = new GroundItemView(renderer.scene, world);
  const hud = new Hud();
  const compass = new Compass(renderer.camera);
  const minimap = new MiniMap(map, world, player.id, renderer.camera, props);
  const panel = new InventoryPanel(player.inventory, player.skills);
  const log = new MessageLog();
  const xpDrops = new XpDrops();
  const menu = new ContextMenu();
  log.add('Welcome to Aeloria.');

  // Start the camera already framing the player instead of flying in from origin.
  renderer.camera.focus.copy(tileToWorld(player.position));

  // --- Input → command queue -----------------------------------------------
  // Clicks become commands that are drained into the sim on the next tick. This
  // queue is the stand-in for "messages sent to the server".
  const commandQueue: Command[] = [];
  const input = new InputController(
    canvas,
    renderer.camera,
    (target) => {
      // Left click = the default action: attack NPC > take item > gather >
      // walk. (The same priority order the context menu lists.)
      if (menu.isOpen) return;
      const npc = npcAt(world, target);
      const ground = world.groundItemAt(target);
      const node = world.resourceNodeAt(target);
      if (npc) {
        commandQueue.push(attackCommand(player.id, npc.id));
      } else if (ground) {
        commandQueue.push(pickupCommand(player.id, ground.id));
      } else if (node && node.regrowTimer <= 0) {
        commandQueue.push(gatherCommand(player.id, node.id));
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

    if (npc) {
      const level = combatLevel(npc.attack, npc.strength, npc.defense, npc.maxHitpoints);
      options.push({
        verb: 'Attack',
        target: `${npc.name} (level-${level})`,
        onSelect: () => commandQueue.push(attackCommand(player.id, npc.id)),
      });
    }
    if (ground) {
      options.push({
        verb: 'Take',
        target: ground.item.name,
        onSelect: () => commandQueue.push(pickupCommand(player.id, ground.id)),
      });
    }
    if (node && node.regrowTimer <= 0) {
      options.push({
        verb: node.kind === 'tree' ? 'Chop down' : 'Mine',
        target: node.kind === 'tree' ? 'Tree' : 'Rock',
        onSelect: () => commandQueue.push(gatherCommand(player.id, node.id)),
      });
    }

    options.push({
      verb: 'Walk here',
      onSelect: () => {
        commandQueue.push(moveCommand(player.id, target));
        tileView.showClickMarker(target);
      },
    });

    for (const [name, text] of examinables(npc, ground, node)) {
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
            xpDrops.levelUp(ev.skill, ev.level);
            log.add(
              `Congratulations! Your ${SKILL_META[ev.skill].label} level is now ${ev.level}.`,
              'levelup',
            );
          }
          break;
        case 'kill':
          if (ev.killerId === player.id) log.add(`You have defeated the ${ev.victimName}.`);
          break;
        case 'died':
          if (ev.entityId === player.id) log.add('Oh dear, you are dead!', 'danger');
          break;
        case 'message':
          log.add(ev.text);
          break;
      }
    }
  };

  const loop = new GameLoop({
    onTick: () => {
      world.tick(commandQueue.splice(0));
      drainEvents();
      panel.refresh(); // reflect XP/level changes from combat this tick
    },
    onRender: (alpha, dt) => {
      water.update(dt);
      entityView.sync(alpha, dt);
      groundView.sync(dt);
      scenery.sync(world);

      const followTarget = entityView.positionOf(player.id);
      if (followTarget) renderer.camera.follow(followTarget);
      renderer.camera.update(dt);

      tileView.update(input.hoverTile, dt);
      renderer.render();
      hud.update(world, player, dt);
      compass.update();
      minimap.update();
    },
  });
  loop.start();

  // Expose a read/drive handle for automated smoke tests and console debugging.
  // Commands pushed here go through the exact same queue as real input.
  (window as unknown as Record<string, unknown>).__aeloria = {
    world,
    player,
    xpForLevel,
    push: (cmd: Command) => commandQueue.push(cmd),
    attack: (npcName: string) => {
      for (const e of world.entities.values()) {
        if (e instanceof Npc && e.isAlive && e.name === npcName) {
          commandQueue.push(attackCommand(player.id, e.id));
          return e.id;
        }
      }
      return null;
    },
    moveTo: (x: number, y: number) => commandQueue.push(moveCommand(player.id, { x, y })),
    hoverTile: () => input.hoverTile,
    gather: (x: number, y: number) => {
      const node = world.resourceNodeAt({ x, y });
      if (node) commandQueue.push(gatherCommand(player.id, node.id));
      return node?.id ?? null;
    },
  };
}

/** The starting cast: a goblin camp, sewer rats by the treeline, gate guards. */
function populateNpcs(world: World, map: TileMap): void {
  const bones = { id: 'bones', name: 'Bones', icon: '🦴' };
  const coins = { id: 'coins', name: 'Coins', icon: '🪙' };
  const respawn = Math.round(15 * TICKS_PER_SECOND);

  // A camp of goblins on the grass south of the moat. Aggressive, like the
  // low-level pests they are.
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
      { item: bones, chance: 1 },
      { item: coins, chance: 0.5 },
    ],
  };
  for (const tile of [{ x: 22, y: 26 }, { x: 20, y: 24 }, { x: 24, y: 23 }, { x: 30, y: 27 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, goblin);
  }

  // Giant rats scurrying along the southern treeline. Weak but bitey.
  const rat = {
    name: 'Giant rat',
    kind: 'rat' as const,
    attack: 1,
    strength: 1,
    defense: 1,
    maxHitpoints: 3,
    attackSpeed: 4,
    respawnTicks: respawn,
    aggroRange: 2,
    wanderRadius: 4,
    drops: [{ item: bones, chance: 1 }],
  };
  for (const tile of [{ x: 18, y: 12 }, { x: 27, y: 10 }, { x: 31, y: 13 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, rat);
  }

  // Two guards flanking the bridge approach. Passive, but they hit back hard —
  // a first "don't poke that yet" enemy.
  const guard = {
    name: 'Guard',
    kind: 'guard' as const,
    attack: 15,
    strength: 14,
    defense: 12,
    maxHitpoints: 22,
    attackSpeed: 5,
    respawnTicks: respawn * 2,
    aggroRange: 0,
    wanderRadius: 2,
    drops: [
      { item: bones, chance: 1 },
      { item: coins, chance: 1 },
    ],
  };
  for (const tile of [{ x: 22, y: 31 }, { x: 26, y: 31 }]) {
    if (!map.isBlocked(tile.x, tile.y)) world.spawnNpc(tile, guard);
  }
}

/**
 * Seeds the player with a few items so the inventory screen has something to
 * drag and equip, and grants the max cape so its animation is visible. This is
 * placeholder content — real drops and a skills-driven cape come later.
 */
function giveStarterKit(player: Player): void {
  // A fresh adventurer, not a newborn: level 10 melee stats so early fights
  // resolve in a handful of hits instead of a war of 1s.
  player.skills.addXp('attack', xpForLevel(10));
  player.skills.addXp('strength', xpForLevel(10));
  player.skills.addXp('defense', xpForLevel(10));

  const inv = player.inventory;
  inv.slots[0] = { id: 'bronze_helm', name: 'Bronze Helmet', icon: '⛑️', equip: 'helmet' };
  inv.slots[1] = { id: 'iron_platebody', name: 'Iron Platebody', icon: '🦺', equip: 'chestplate' };
  inv.slots[2] = { id: 'steel_platelegs', name: 'Steel Platelegs', icon: '👖', equip: 'legs' };
  inv.slots[3] = { id: 'leather_boots', name: 'Leather Boots', icon: '🥾', equip: 'boots' };
  inv.slots[4] = {
    id: 'iron_sword',
    name: 'Iron Sword',
    icon: '🗡️',
    equip: 'weapon',
    attackBonus: 12,
    strengthBonus: 14,
  };
  inv.slots[5] = { id: 'wooden_shield', name: 'Wooden Shield', icon: '🛡️', equip: 'shield' };
  inv.slots[6] = { id: 'leather_gloves', name: 'Leather Gloves', icon: '🧤', equip: 'gloves' };
  inv.slots[7] = { id: 'gold_ring', name: 'Gold Ring', icon: '💍', equip: 'ring' };
  inv.slots[8] = { id: 'coins', name: '100 Coins', icon: '🪙' };
  inv.slots[9] = { id: 'logs', name: 'Logs', icon: '🪵' };
  inv.slots[10] = { id: 'bread', name: 'Bread', icon: '🍞' };

  inv.equipment.cape = { id: 'max_cape', name: 'Max Cape', icon: '🧥', equip: 'cape' };

  // Until the skills system exists, grant the cape directly so it renders.
  player.maxCape = true;
}

/** Flavor text for whatever is examinable on a tile. */
function examinables(
  npc: Npc | null,
  ground: { item: { name: string; id: string } } | null,
  node: { kind: 'tree' | 'rock'; regrowTimer: number } | null,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (npc) out.push([npc.name, EXAMINE_NPC[npc.kind] ?? 'A creature.']);
  if (ground) out.push([ground.item.name, EXAMINE_ITEM[ground.item.id] ?? 'A useful item.']);
  if (node && node.regrowTimer <= 0) {
    out.push(
      node.kind === 'tree'
        ? ['Tree', 'A leafy tree, good for logs.']
        : ['Rock', 'A rocky outcrop with a seam of copper.'],
    );
  }
  return out;
}

const EXAMINE_NPC: Record<string, string> = {
  goblin: 'An ugly green creature.',
  rat: 'Overgrown vermin.',
  guard: 'He looks bored, but capable.',
};

const EXAMINE_ITEM: Record<string, string> = {
  bones: 'Bad to the bone.',
  coins: 'Lovely money!',
  logs: 'A number of wooden logs.',
  copper_ore: 'This ore contains copper.',
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
