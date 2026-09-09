import * as THREE from 'three';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { LightPool } from './LightPool';

/** The colour of each standard spell family's bolt of energy. */
const SPELL_COLORS: Record<string, number> = {
  wind: 0xd8f0ff,
  water: 0x4aa8ff,
  earth: 0xa07a3a,
  fire: 0xff7a1a,
};

/**
 * Flies arrows and spells from attacker to target. The sim records a
 * projectile with its launch and landing ticks; each frame we place it along
 * a shallow arc between the two entities' current positions (so it tracks a
 * moving target, as OSRS projectiles do) and remove it once it has landed.
 * Spells are a hot core that blooms inside a soft halo and carry one of the
 * pooled point lights, so the ground and the target glow as the bolt passes.
 */
export class ProjectileView {
  private readonly live = new Map<number, { obj: THREE.Object3D; light: number | null }>();
  private readonly arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5);
  private readonly arrowMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 });
  private readonly headMat = new THREE.MeshStandardMaterial({ color: 0xb4b8bf, roughness: 0.4, metalness: 0.8 });
  private readonly fletchMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9, side: THREE.DoubleSide });
  private readonly coreGeo = new THREE.SphereGeometry(0.11, 10, 8);
  private readonly haloGeo = new THREE.SphereGeometry(0.26, 12, 10);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
  ) {
    this.arrowGeo.rotateX(Math.PI / 2); // point along +z
  }

  /** `tickAlpha` is the loop's interpolation factor within the current tick. */
  sync(tickAlpha: number, lights: LightPool): void {
    const now = this.world.tickCount + tickAlpha;
    for (const p of this.world.projectiles.values()) {
      let entry = this.live.get(p.id);
      if (!entry) {
        entry = p.kind === 'arrow' ? { obj: this.makeArrow(), light: null } : this.makeSpell(p.itemId);
        this.live.set(p.id, entry);
        this.scene.add(entry.obj);
      }
      const obj = entry.obj;
      const target = this.world.entities.get(p.targetId);
      const to = target ? target.position : p.from;
      const span = Math.max(0.001, p.landsAtTick - p.launchedAtTick);
      const t = Math.min(1, Math.max(0, (now - p.launchedAtTick) / span));
      const x = p.from.x + (to.x - p.from.x) * t;
      const z = p.from.y + (to.y - p.from.y) * t;
      const ground = this.terrain.heightAt(x, z);
      const arc = Math.sin(t * Math.PI) * (p.kind === 'arrow' ? 0.9 : 0.35);
      obj.position.set(x, ground + 1.1 + arc, z);
      if (p.kind === 'arrow') {
        const dx = to.x - p.from.x;
        const dz = to.y - p.from.y;
        obj.rotation.set(-Math.cos(t * Math.PI) * 0.5, Math.atan2(dx, dz), 0, 'YXZ');
      } else {
        obj.rotation.y += 0.2;
        obj.rotation.x += 0.13;
        if (entry.light !== null) lights.add(x, ground + 1.1 + arc, z, entry.light, 6, 5);
      }
    }
    for (const [id, entry] of this.live) {
      if (!this.world.projectiles.has(id)) {
        this.scene.remove(entry.obj);
        this.live.delete(id);
      }
    }
  }

  private makeArrow(): THREE.Object3D {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    shaft.castShadow = true;
    g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 5), this.headMat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.38;
    g.add(head);
    for (const rot of [0, Math.PI / 2]) {
      const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), this.fletchMat);
      fletch.rotation.z = rot;
      fletch.position.z = -0.28;
      g.add(fletch);
    }
    return g;
  }

  private makeSpell(spellId: string): { obj: THREE.Object3D; light: number } {
    const family = spellId.split('_')[0];
    const color = SPELL_COLORS[family] ?? 0xd0c0ff;
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      this.coreGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3.5) }),
    );
    g.add(core);
    const halo = new THREE.Mesh(
      this.haloGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(halo);
    g.userData.noAO = true;
    return { obj: g, light: color };
  }
}
