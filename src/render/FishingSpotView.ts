import * as THREE from 'three';
import { World } from '../sim/World';
import { WATER_LEVEL } from './Terrain';

/**
 * Renders fishing spots as expanding rings of disturbed water — the OSRS tell
 * that something is splashing under the surface. Each spot cycles three rings
 * out of phase; the group simply follows the node's tile when the spot moves.
 */
export class FishingSpotView {
  private readonly groups = new Map<number, THREE.Group>();
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 8);
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  sync(dt: number): void {
    this.clock += dt;

    for (const node of this.world.resourceNodes.values()) {
      if (node.kind !== 'fishing_spot') continue;
      let group = this.groups.get(node.id);
      if (!group) {
        group = this.createGroup();
        this.groups.set(node.id, group);
        this.scene.add(group);
      }
      // Float just above the water and follow the spot.
      group.position.set(node.tile.x, WATER_LEVEL + 0.02, node.tile.y);

      group.children.forEach((ring, i) => {
        const t = (this.clock * 0.55 + i / group!.children.length) % 1;
        const s = 0.12 + t * 0.4;
        ring.scale.set(s, 1, s);
        ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.55;
      });
    }

    for (const [id, group] of this.groups) {
      const node = this.world.resourceNodes.get(id);
      if (!node || node.kind !== 'fishing_spot') {
        this.scene.remove(group);
        this.groups.delete(id);
      }
    }
  }

  private createGroup(): THREE.Group {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe4f2ff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.ringGeo, mat);
      ring.renderOrder = 2;
      group.add(ring);
    }
    return group;
  }
}
