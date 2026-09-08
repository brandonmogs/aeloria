import * as THREE from 'three';
import { World } from '../sim/World';
import { Terrain } from './Terrain';

/** The colour of each standard spell family's bolt of energy. */
const SPELL_COLORS: Record<string, number> = {
  wind: 0xd8f0ff,
  water: 0x4aa8ff,
  earth: 0x8a6a2a,
  fire: 0xff7a1a,
};

/**
 * Flies arrows and spells from attacker to target. The sim records a
 * projectile with its launch and landing ticks; each frame we place it along
 * a shallow arc between the two entities' current positions (so it tracks a
 * moving target, as OSRS projectiles do) and remove it once it has landed.
 */
export class ProjectileView {
  private readonly live = new Map<number, THREE.Object3D>();
  private readonly arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4);
  private readonly arrowMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
  private readonly headMat = new THREE.MeshLambertMaterial({ color: 0xb4b8bf });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
  ) {
    this.arrowGeo.rotateX(Math.PI / 2); // point along +z
  }

  /** `tickAlpha` is the loop's interpolation factor within the current tick. */
  sync(tickAlpha: number): void {
    const now = this.world.tickCount + tickAlpha;
    for (const p of this.world.projectiles.values()) {
      let obj = this.live.get(p.id);
      if (!obj) {
        obj = p.kind === 'arrow' ? this.makeArrow() : this.makeSpell(p.itemId);
        this.live.set(p.id, obj);
        this.scene.add(obj);
      }
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
      }
    }
    for (const [id, obj] of this.live) {
      if (!this.world.projectiles.has(id)) {
        this.scene.remove(obj);
        this.live.delete(id);
      }
    }
  }

  private makeArrow(): THREE.Object3D {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), this.headMat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.38;
    g.add(head);
    return g;
  }

  private makeSpell(spellId: string): THREE.Object3D {
    const family = spellId.split('_')[0];
    const color = SPELL_COLORS[family] ?? 0xd0c0ff;
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    g.add(core);
    const halo = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
    );
    halo.rotation.z = Math.PI / 4;
    g.add(halo);
    return g;
  }
}
