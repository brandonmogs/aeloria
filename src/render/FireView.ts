import * as THREE from 'three';
import { World } from '../sim/World';

/** The live meshes for one fire, plus a phase so flames flicker out of sync. */
interface FireVisual {
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  phase: number;
}

/**
 * Renders player-lit fires: a pair of crossed logs under two nested flame
 * cones that flicker by scaling against a per-fire phase. Unlit basic
 * materials keep the flames bright regardless of scene lighting (and let the
 * bloom pass pick them up). Visuals are created and torn down as fires come
 * and go in the sim.
 */
export class FireView {
  private readonly visuals = new Map<number, FireVisual>();
  private readonly logGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.55, 8);
  private readonly outerGeo = new THREE.ConeGeometry(0.26, 0.62, 10);
  private readonly innerGeo = new THREE.ConeGeometry(0.14, 0.4, 8);
  private readonly logMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.95 });
  private readonly outerMat = new THREE.MeshBasicMaterial({
    color: 0xff7818,
    transparent: true,
    opacity: 0.85,
  });
  private readonly innerMat = new THREE.MeshBasicMaterial({
    color: 0xffd23a,
    transparent: true,
    opacity: 0.9,
  });
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
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
      const flicker = 1 + Math.sin(this.clock * 13 + visual.phase) * 0.13;
      const gutter = 1 + Math.sin(this.clock * 7.3 + visual.phase * 2.1) * 0.08;
      visual.outer.scale.set(gutter, flicker, gutter);
      visual.inner.scale.set(flicker, gutter, flicker);
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
    group.position.set(x, 0, y);

    for (const angle of [0.5, -0.7]) {
      const log = new THREE.Mesh(this.logGeo, this.logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = angle;
      log.position.y = 0.06;
      log.castShadow = true;
      group.add(log);
    }

    const outer = new THREE.Mesh(this.outerGeo, this.outerMat);
    outer.position.y = 0.36;
    group.add(outer);
    const inner = new THREE.Mesh(this.innerGeo, this.innerMat);
    inner.position.y = 0.28;
    group.add(inner);

    return { group, outer, inner, phase: id * 2.4 };
  }
}
