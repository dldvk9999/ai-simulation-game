// 로우폴리 모델 조립 도우미: 여러 도형을 정점 색과 함께 하나의 지오메트리로 합친다.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface PartOpts {
  color: string | THREE.Color;
  leaf?: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

export function part(g: THREE.BufferGeometry, o: PartOpts) {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  geo.deleteAttribute("uv");
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0])));
  const s = typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : o.scale ?? [1, 1, 1];
  m.compose(new THREE.Vector3(...(o.pos ?? [0, 0, 0])), q, new THREE.Vector3(...(s as [number, number, number])));
  geo.applyMatrix4(m);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(o.color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aLeaf", new THREE.BufferAttribute(new Float32Array(n).fill(o.leaf ?? 0), 1));
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** 정점 색 + 잎 색조/눈 셰이더 패치가 들어간 재질 */
export function leafMaterial(opts: { roughness?: number; emissive?: string } = {}) {
  const uniforms = {
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTint2: { value: new THREE.Color(1, 1, 1) },
    uSnow: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: opts.roughness ?? 0.9,
    metalness: 0,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aLeaf;\nattribute float aVar;\nuniform vec3 uTint;\nuniform vec3 uTint2;\nuniform float uSnow;",
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        vec3 leafTint = mix(uTint, uTint2, aVar);
        vColor.rgb = mix(vColor.rgb, vColor.rgb * leafTint, aLeaf);
        vColor.rgb = mix(vColor.rgb, vec3(0.94, 0.96, 1.0), uSnow * aLeaf * 0.6 * smoothstep(-0.2, 0.6, normal.y));`,
      );
  };
  mat.customProgramCacheKey = () => "leaf";
  return { mat, uniforms };
}

/** 단색 플랫 셰이딩 재질 캐시 */
const cache = new Map<string, THREE.MeshStandardMaterial>();
export function flat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + JSON.stringify(extra);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });
    cache.set(key, m);
  }
  return m;
}

export const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });

// 자주 쓰는 기본 도형
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg),
  cone: (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg),
  ico: (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r: number) => new THREE.DodecahedronGeometry(r, 0),
  sphere: (r: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h),
};
