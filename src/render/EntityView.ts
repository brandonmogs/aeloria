import * as THREE from 'three';
import { World } from '../sim/World';

/**
 * Renders entities and — crucially — makes their tile-by-tile movement look
 * smooth. The sim teleports an entity from one tile to the next on each tick;
 * here we interpolate between `previousPosition` and `position` using the
 * loop's `alpha`, so the player glides across the grid at 60fps while the
 * underlying logic stays a clean 1-tile-per-tick. Meshes are created and
 * destroyed lazily as entities appear and despawn.
 */
export class EntityView {
  private readonly meshes = new Map<number, THREE.Object3D>();
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {}

  sync(alpha: number): void {
    for (const entity of this.world.entities.values()) {
      let mesh = this.meshes.get(entity.id);
      if (!mesh) {
        mesh = this.createMesh();
        this.meshes.set(entity.id, mesh);
        this.scene.add(mesh);
      }

      this.prev.set(entity.previousPosition.x, 0, entity.previousPosition.y);
      this.curr.set(entity.position.x, 0, entity.position.y);
      mesh.position.lerpVectors(this.prev, this.curr, alpha);

      // Face the direction of travel.
      if (!this.prev.equals(this.curr)) {
        mesh.rotation.y = Math.atan2(this.curr.x - this.prev.x, this.curr.z - this.prev.z);
      }
    }

    // Drop meshes for entities that no longer exist.
    for (const [id, mesh] of this.meshes) {
      if (!this.world.entities.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  /** Live world-space position of an entity's mesh, or null if not yet built. */
  positionOf(id: number): THREE.Vector3 | null {
    return this.meshes.get(id)?.position ?? null;
  }

  private createMesh(): THREE.Object3D {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.7, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x4aa3df, roughness: 0.55, metalness: 0.1 }),
    );
    body.position.y = 0.65;
    body.castShadow = true;
    group.add(body);

    // A small nose so the facing direction is visible while walking.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.28, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.4 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.78, 0.34);
    group.add(nose);

    return group;
  }
}
