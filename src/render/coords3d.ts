import * as THREE from 'three';
import { Tile } from '../sim/coords';

/**
 * Bridges the simulation's 2D tile space to Three.js world space. Tile (x, y)
 * maps to world (x, 0, y): the grid lies on the XZ plane and Y is up. This is
 * the single place that conversion happens, so the rest of the render code
 * speaks in world units and the sim never knows Three.js exists.
 */
export function tileToWorld(t: Tile, y = 0): THREE.Vector3 {
  return new THREE.Vector3(t.x, y, t.y);
}
