import './style.css';

import { TileMap } from './sim/TileMap';
import { World } from './sim/World';
import { Player } from './sim/Player';
import { Npc } from './sim/Npc';
import { Tile, tilesEqual } from './sim/coords';
import { Command, moveCommand, attackCommand } from './sim/commands';
import { GameLoop } from './engine/GameLoop';
import { TICKS_PER_SECOND } from './engine/constants';
import { Renderer } from './render/Renderer';
import { TileGridView } from './render/TileGridView';
import { SceneryView } from './render/SceneryView';
import { WaterView } from './render/WaterView';
import { EntityView } from './render/EntityView';
import { InputController } from './input/InputController';
import { xpForLevel } from './sim/Skills';
import { Hud } from './ui/Hud';
import { Compass } from './ui/Compass';
import { MiniMap } from './ui/MiniMap';
import { InventoryPanel } from './ui/InventoryPanel';
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

  // A test goblin on the grass south of the moat: 5 HP like OSRS, respawns
  // 10s after death.
  world.spawnNpc(
    { x: 22, y: 26 },
    {
      name: 'Goblin',
      kind: 'goblin',
      attack: 1,
      strength: 1,
      defense: 1,
      maxHitpoints: 5,
      attackSpeed: 4,
      respawnTicks: Math.round(10 * TICKS_PER_SECOND),
    },
  );

  // --- Rendering -----------------------------------------------------------
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const tileView = new TileGridView(renderer.scene, map);
  new SceneryView(renderer.scene, props);
  const water = new WaterView(renderer.scene, moat, renderer.sunDirection);
  const entityView = new EntityView(renderer.scene, world);
  const hud = new Hud();
  const compass = new Compass(renderer.camera);
  const minimap = new MiniMap(map, world, player.id, renderer.camera, props);
  const panel = new InventoryPanel(player.inventory, player.skills);

  // Start the camera already framing the player instead of flying in from origin.
  renderer.camera.focus.copy(tileToWorld(player.position));

  // --- Input → command queue -----------------------------------------------
  // Clicks become commands that are drained into the sim on the next tick. This
  // queue is the stand-in for "messages sent to the server".
  const commandQueue: Command[] = [];
  const input = new InputController(canvas, renderer.camera, (target) => {
    // Clicking a living NPC attacks it; clicking the ground walks there.
    const npc = npcAt(world, target);
    if (npc) {
      commandQueue.push(attackCommand(player.id, npc.id));
    } else {
      commandQueue.push(moveCommand(player.id, target));
      tileView.showClickMarker(target);
    }
  });

  // --- Game loop -----------------------------------------------------------
  const loop = new GameLoop({
    onTick: () => {
      world.tick(commandQueue.splice(0));
      panel.refresh(); // reflect XP/level changes from combat this tick
    },
    onRender: (alpha, dt) => {
      water.update(dt);
      entityView.sync(alpha, dt);

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
  };
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

/** The living NPC standing on a tile, if any — used to turn a click into an attack. */
function npcAt(world: World, tile: Tile): Npc | null {
  for (const entity of world.entities.values()) {
    if (entity instanceof Npc && entity.isAlive && tilesEqual(entity.position, tile)) {
      return entity;
    }
  }
  return null;
}
