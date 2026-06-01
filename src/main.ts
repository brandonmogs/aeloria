import './style.css';

import { TileMap } from './sim/TileMap';
import { World } from './sim/World';
import { Command, moveCommand } from './sim/commands';
import { GameLoop } from './engine/GameLoop';
import { Renderer } from './render/Renderer';
import { TileGridView } from './render/TileGridView';
import { EntityView } from './render/EntityView';
import { InputController } from './input/InputController';
import { Hud } from './ui/Hud';
import { tileToWorld } from './render/coords3d';
import { hasWebGL, showFatal, installErrorHandlers } from './diagnostics';

const MAP_W = 48;
const MAP_H = 48;

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
  buildDemoWorld(map);

  const world = new World(map);
  const player = world.spawnPlayer({ x: MAP_W >> 1, y: MAP_H >> 1 }, 'You');

  // --- Rendering -----------------------------------------------------------
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const tileView = new TileGridView(renderer.scene, map);
  const entityView = new EntityView(renderer.scene, world);
  const hud = new Hud();

  // Start the camera already framing the player instead of flying in from origin.
  renderer.camera.focus.copy(tileToWorld(player.position));

  // --- Input → command queue -----------------------------------------------
  // Clicks become commands that are drained into the sim on the next tick. This
  // queue is the stand-in for "messages sent to the server".
  const commandQueue: Command[] = [];
  const input = new InputController(canvas, renderer.camera, (target) => {
    commandQueue.push(moveCommand(player.id, target));
    tileView.showClickMarker(target);
  });

  // --- Game loop -----------------------------------------------------------
  const loop = new GameLoop({
    onTick: () => {
      world.tick(commandQueue.splice(0));
    },
    onRender: (alpha, dt) => {
      entityView.sync(alpha);

      const followTarget = entityView.positionOf(player.id);
      if (followTarget) renderer.camera.follow(followTarget);
      renderer.camera.update(dt);

      tileView.update(input.hoverTile, dt);
      renderer.render();
      hud.update(world, player, dt);
    },
  });
  loop.start();
}

/**
 * Seeds the demo map: a walled border, plus a few clusters of rocks to show off
 * pathfinding and the diagonal corner-cutting rule. Swap this out for real map
 * data once we have a content pipeline.
 */
function buildDemoWorld(map: TileMap): void {
  const rocks: ReadonlyArray<readonly [number, number]> = [
    [18, 20], [19, 20], [20, 20], [20, 21], [20, 22],
    [28, 28], [29, 28], [30, 28], [28, 29], [28, 30],
    [14, 30], [15, 30], [16, 30], [16, 29],
    [33, 16], [33, 17], [33, 18], [34, 18], [35, 18],
  ];
  for (const [x, y] of rocks) map.setBlocked(x, y);

  for (let x = 0; x < map.width; x++) {
    map.setBlocked(x, 0);
    map.setBlocked(x, map.height - 1);
  }
  for (let y = 0; y < map.height; y++) {
    map.setBlocked(0, y);
    map.setBlocked(map.width - 1, y);
  }
}
