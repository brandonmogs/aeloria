import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { MoatLayout, WorldRect } from '../world/startingWorld';

/**
 * The castle moat: a clean planar reflection dressed up to read as real water,
 * plus a timber bridge across the south gap.
 *
 * We use a {@link Reflector} (a true mirror render of the scene) rather than
 * three's `Water`, whose refractive distortion shimmers badly on a moat this
 * small. The custom shader keeps that reflection sharp, then layers on the cues
 * that sell water: Fresnel (deep colour looking straight down, mirror at grazing
 * angles), a sharp sun-aligned specular glint, foam crests, and a band of
 * shoreline foam hugging the walls and the outer bank. Call {@link update} each
 * frame to animate it.
 */
export class WaterView {
  private readonly reflector: Reflector;

  constructor(scene: THREE.Scene, moat: MoatLayout, sunDirection: THREE.Vector3) {
    this.reflector = new Reflector(buildRingGeometry(moat), {
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.0025,
      color: 0xffffff,
      shader: WATER_SHADER,
    });
    // Geometry is authored in the XY plane (like PlaneGeometry) so the mirror
    // plane resolves to horizontal once laid flat; float it just above the grass.
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = 0.05;
    scene.add(this.reflector);

    // The water fades to transparent at its edges (see the shader), so it must
    // blend over the ground rather than write depth and occlude it.
    const mat = this.reflector.material as THREE.ShaderMaterial;
    mat.transparent = true;
    mat.depthWrite = false;

    // Hand the shader the sun and the ring's world bounds (for the shoreline).
    const u = mat.uniforms;
    u.sunDirection.value = sunDirection.clone().normalize();
    u.outerMin.value = new THREE.Vector2(moat.outer.x0, moat.outer.z0);
    u.outerMax.value = new THREE.Vector2(moat.outer.x1, moat.outer.z1);
    u.innerMin.value = new THREE.Vector2(moat.inner.x0, moat.inner.z0);
    u.innerMax.value = new THREE.Vector2(moat.inner.x1, moat.inner.z1);

    scene.add(buildBridge(moat.bridge));
  }

  update(dt: number): void {
    const u = (this.reflector.material as THREE.ShaderMaterial).uniforms;
    u.time.value += dt;
  }
}

const WATER_SHADER = {
  name: 'MoatWaterShader',
  uniforms: {
    color: { value: null }, // set by Reflector
    tDiffuse: { value: null }, // set by Reflector (the mirror texture)
    textureMatrix: { value: null }, // set by Reflector
    time: { value: 0 },
    waterColor: { value: new THREE.Color(0x33473a) },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    outerMin: { value: new THREE.Vector2() },
    outerMax: { value: new THREE.Vector2() },
    innerMin: { value: new THREE.Vector2() },
    innerMax: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorldPosition;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vWorldPosition = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 waterColor;
    uniform vec3 sunDirection;
    uniform float time;
    uniform vec2 outerMin;
    uniform vec2 outerMax;
    uniform vec2 innerMin;
    uniform vec2 innerMax;
    varying vec4 vUv;
    varying vec3 vWorldPosition;

    #include <logdepthbuf_pars_fragment>

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
    }

    float vnoise( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      float a = hash( i );
      float b = hash( i + vec2( 1.0, 0.0 ) );
      float c = hash( i + vec2( 0.0, 1.0 ) );
      float d = hash( i + vec2( 1.0, 1.0 ) );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
    }

    // A small ripple height field; sampled three times to build a normal.
    float waveH( vec2 q ) {
      return vnoise( q * 1.3 + vec2( time * 0.20, time * 0.13 ) )
           + vnoise( q * 2.1 + vec2( -time * 0.16, time * 0.24 ) ) * 0.5;
    }

    void main() {
      #include <logdepthbuf_fragment>

      vec2 p = vWorldPosition.xz;

      // Ripple normal from the height field's gradient.
      float e = 0.12;
      float h0 = waveH( p );
      vec3 nrm = normalize( vec3( h0 - waveH( p + vec2( e, 0.0 ) ),
                                  e * 6.0,
                                  h0 - waveH( p + vec2( 0.0, e ) ) ) );

      // Reflection, nudged by the ripple normal so it wavers subtly.
      vec2 uv = vUv.xy / vUv.w + nrm.xz * 0.04;
      vec3 reflection = texture2D( tDiffuse, uv ).rgb;

      // Murky water: mostly its own muddy colour, with the reflection only
      // creeping in at grazing angles (Fresnel). A moat isn't a clean mirror.
      vec3 viewDir = normalize( cameraPosition - vWorldPosition );
      float fres = pow( clamp( 1.0 - dot( viewDir, nrm ), 0.0, 1.0 ), 3.0 );
      vec3 col = mix( waterColor, reflection, mix( 0.08, 0.45, fres ) );

      // Sun glint: a tight specular highlight where ripples face the sun.
      vec3 halfV = normalize( viewDir + sunDirection );
      col += vec3( pow( max( dot( nrm, halfV ), 0.0 ), 150.0 ) ) * 1.2;

      // Organic shoreline: distance into the water from the nearest bank, then
      // pulled inward by noise so the waterline wanders. The hard rectangular
      // geometry edge always lands at alpha 0, so it's never visible — the water
      // simply fades into the bank along an irregular line.
      // p is (world x, world z); the rect uniforms store (x, z) in (.x, .y).
      float dOuter = min( min( p.x - outerMin.x, outerMax.x - p.x ),
                          min( p.y - outerMin.y, outerMax.y - p.y ) );
      vec2 dIn = max( max( innerMin - p, p - innerMax ), vec2( 0.0 ) );
      float edge = min( dOuter, length( dIn ) );

      float bank = vnoise( p * 0.6 ) * 0.7 + vnoise( p * 1.9 ) * 0.3; // 0..1
      float shoreDist = edge - bank * 0.55;
      float alpha = smoothstep( 0.0, 0.4, shoreDist );

      // Foam riding the wet edge, broken up so it isn't a clean outline.
      float foam = smoothstep( 0.4, 0.05, shoreDist ) * alpha
                 * ( 0.45 + 0.55 * vnoise( p * 3.0 + time * 0.5 ) );
      col += vec3( foam ) * 0.35;

      gl_FragColor = vec4( col, alpha );

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** A flat rectangular ring (outer rect with the inner rect punched out). */
function buildRingGeometry(moat: MoatLayout): THREE.ShapeGeometry {
  const shape = rectPath(moat.outer);
  shape.holes.push(rectPath(moat.inner));
  return new THREE.ShapeGeometry(shape);
}

/**
 * A rectangle in shape space. Shape Y maps to world -Z after the mesh's -90° X
 * rotation, so negate Z here to keep world orientation correct.
 */
function rectPath(r: WorldRect): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(r.x0, -r.z0);
  s.lineTo(r.x1, -r.z0);
  s.lineTo(r.x1, -r.z1);
  s.lineTo(r.x0, -r.z1);
  s.closePath();
  return s;
}

/** A timber deck with rails and corner posts spanning the bridge gap. */
function buildBridge(b: WorldRect): THREE.Group {
  const g = new THREE.Group();
  const plank = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.86, envMapIntensity: 0.4 });
  const beam = new THREE.MeshStandardMaterial({ color: 0x47301d, roughness: 0.86, envMapIntensity: 0.4 });
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0 + 0.5; // overhang onto the banks

  // Deck top sits ~0.08 above the ground so the player (feet at y=0) reads as
  // walking on it, and it covers the water strip running underneath.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), plank);
  deck.position.set(cx, 0.0, cz);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);

  for (const sx of [b.x0 + 0.08, b.x1 - 0.08]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, d), beam);
    rail.position.set(sx, 0.27, cz);
    rail.castShadow = true;
    g.add(rail);
    for (const sz of [cz - d / 2 + 0.1, cz + d / 2 - 0.1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), beam);
      post.position.set(sx, 0.15, sz);
      post.castShadow = true;
      g.add(post);
    }
  }
  return g;
}
