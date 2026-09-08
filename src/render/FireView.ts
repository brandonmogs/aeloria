import * as THREE from 'three';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { box, flat } from './lowpoly';

/** The live meshes for one fire, plus a phase so flames flicker out of sync. */
interface FireVisual {
  group: THREE.Group;
  flames: THREE.Mesh[];
  phase: number;
}

/**
 * Renders player-lit fires: a pair of crossed logs under a cluster of
 * four-sided flame prisms that flicker by scaling against a per-fire phase.
 * Unlit basic materials keep the flames bright regardless of scene lighting.
 */
export class FireView {
  private readonly visuals = new Map<number, FireVisual>();
  private readonly logGeo = box(0.12, 0.12, 0.6);
  private readonly flameGeo = new THREE.ConeGeometry(0.2, 0.62, 4);
  private readonly logMat = flat(0x4a3018);
  private readonly flameMats = [
    new THREE.MeshBasicMaterial({ color: 0xff6a12, transparent: true, opacity: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 0xffe36a, transparent: true, opacity: 0.95 }),
  ];
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
  ) {}

  sync(dt: number): void {
    this.clock += dt;

    for (const fire of this.world.fires.values()) {
      let visual = this.visuals.get(fire.id);
      if (!visual) {
        visual = this.createVisual(fire.tile.x, fire.tile.y, fire.id);
        this.visuals.set(fire.id, visual);
        this.scene.add(visual.group);
      }
      visual.flames.forEach((flame, i) => {
        const t = this.clock * (11 + i * 2) + visual!.phase + i;
        const lick = 1 + Math.sin(t) * 0.16 + Math.sin(t * 2.3) * 0.08;
        flame.scale.set(1 + Math.sin(t * 0.7) * 0.1, lick, 1 + Math.cos(t * 0.9) * 0.1);
        flame.rotation.y = Math.sin(t * 0.5) * 0.3 + i;
      });
    }

    for (const [id, visual] of this.visuals) {
      if (!this.world.fires.has(id)) {
        this.scene.remove(visual.group);
        this.visuals.delete(id);
      }
    }
  }

  private createVisual(x: number, y: number, id: number): FireVisual {
    const group = new THREE.Group();
    group.position.set(x, this.terrain.heightAt(x, y), y);

    for (const angle of [0.5, -0.7]) {
      const log = new THREE.Mesh(this.logGeo, this.logMat);
      log.rotation.y = angle;
      log.position.y = 0.06;
      log.castShadow = true;
      group.add(log);
    }

    const flames: THREE.Mesh[] = [];
    const spots: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0.38, 0, 1.1],
      [0.12, 0.3, 0.08, 0.8],
      [-0.1, 0.28, -0.1, 0.7],
    ];
    spots.forEach(([fx, fy, fz, s], i) => {
      const flame = new THREE.Mesh(this.flameGeo, this.flameMats[i]);
      flame.position.set(fx, fy, fz);
      flame.scale.setScalar(s);
      group.add(flame);
      flames.push(flame);
    });

    return { group, flames, phase: id * 2.4 };
  }
}
