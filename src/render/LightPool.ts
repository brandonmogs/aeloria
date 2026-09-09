import * as THREE from 'three';

/** One frame's request for a light: where, what colour, how bright, how far. */
interface LightRequest {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

/**
 * Dynamic lights the 117 HD way: fires, furnaces, and spells throw real light
 * on their surroundings. Forward rendering pays per light in every material's
 * shader, and changing the number of lights in the scene forces every shader
 * to recompile (a visible hitch), so the pool keeps a fixed set of point
 * lights alive at all times and hands them out each frame to the nearest
 * requests, parking the rest at zero intensity.
 */
export class LightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly requests: LightRequest[] = [];

  constructor(scene: THREE.Scene, count = 6) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      light.castShadow = false;
      scene.add(light);
      this.lights.push(light);
    }
  }

  /** Forget last frame's requests; views call {@link add} again each frame. */
  begin(): void {
    this.requests.length = 0;
  }

  add(x: number, y: number, z: number, color: number, intensity: number, distance: number): void {
    this.requests.push({ x, y, z, color, intensity, distance });
  }

  /** Assign the pool to the requests nearest `focus` (the camera's subject). */
  end(focus: THREE.Vector3): void {
    if (this.requests.length > this.lights.length) {
      const d2 = (r: LightRequest): number => (r.x - focus.x) ** 2 + (r.z - focus.z) ** 2;
      this.requests.sort((a, b) => d2(a) - d2(b));
    }
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const req = this.requests[i];
      if (!req) {
        light.intensity = 0;
        continue;
      }
      light.position.set(req.x, req.y, req.z);
      light.color.setHex(req.color);
      light.intensity = req.intensity;
      light.distance = req.distance;
    }
  }
}
