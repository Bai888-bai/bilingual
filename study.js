// 3D 书房：坐在书桌前的椅子上，拖动转头看四周。书库里的书是真立体的书块，
// 竖着插在两侧书架上；点一本 → 飞到桌上摊开；点摊开的书 → 进阅读页。
// 桌子右边那摞是最近读过的，点一下换到中间。窗外云在飘、草和灌木随风摆。
// 模型/贴图来自 Poly Haven（CC0），放在 models/ 下。单位：米，y 朝上，
// 坐着时面朝 -z（窗户那面墙）。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const DESK_KEY = "studyDeskBookId";
const PILE_SIZE = 3;
const EYE = new THREE.Vector3(0, 1.18, 0.02);
const DESK_TOP = 0.8;
const BACK_WALL_Z = -1.15;
const WIN = { x0: -0.85, x1: 0.85, y0: 0.95, y1: 2.3 };
const ROOM = { x0: -1.75, x1: 1.75, z1: 1.6, h: 2.7 };

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd6e4ee, 30, 260);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 600);
camera.position.copy(EYE);
camera.rotation.order = "YXZ";
const look = { yaw: 0, pitch: -0.2 };

// 风：所有会摆动的东西（草、灌木、树冠、窗帘）共用一个时间 uniform，
// 在顶点着色器里按高度和位置偏移。偶尔来一阵风靠两个慢正弦相乘做出"阵风"。
const wind = { value: 0 };
function addWind(material, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 wPos = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        float gust = 0.55 + 0.45 * sin(uTime * 0.23) * sin(uTime * 0.11 + 1.3);
        float w = sin(uTime * 1.6 + wPos.x * 0.7 + wPos.z * 0.45) * 0.7 + sin(uTime * 3.3 + wPos.x * 2.1) * 0.3;
        float h = max(position.y, 0.0);
        transformed.x += w * gust * ${strength.toFixed(3)} * h * h;
        transformed.z += w * gust * ${(strength * 0.4).toFixed(3)} * h * h;`
      );
  };
  return material;
}

// ---------- 贴图 ----------
const texLoader = new THREE.TextureLoader();
function pbr(name, repeatX, repeatY, tint) {
  const load = (suffix, srgb) => {
    const t = texLoader.load(`models/tex/${name}_${suffix}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    map: load("diff", true),
    normalMap: load("nor"),
    roughnessMap: load("rough"),
    color: tint || 0xffffff,
  });
}

// ---------- 房间 ----------
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
}

function buildRoom() {
  const floorMat = pbr("old_wooden_floor_02", 2, 1.6, 0xf4ece0);
  const wallMat = pbr("painted_plaster_wall", 1.6, 1.2, 0xfbf7ef);
  // 墙裙用浅奶油色的漆面，不用深色木纹——深木色一进阴影就发闷发暗
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.7 });

  const W = ROOM.x1 - ROOM.x0;
  const D = ROOM.z1 - BACK_WALL_Z;
  const cz = (ROOM.z1 + BACK_WALL_Z) / 2;
  box(W, 0.02, D, floorMat, 0, -0.01, cz);
  box(W, 0.02, D, white, 0, ROOM.h + 0.01, cz);
  box(0.1, ROOM.h, D, wallMat, ROOM.x0 - 0.05, ROOM.h / 2, cz);
  box(0.1, ROOM.h, D, wallMat, ROOM.x1 + 0.05, ROOM.h / 2, cz);
  box(W, ROOM.h, 0.1, wallMat, 0, ROOM.h / 2, ROOM.z1 + 0.05);

  // 后墙挖一个窗洞：洞的上下左右四块墙
  const t = 0.25;
  const wz = BACK_WALL_Z - t / 2;
  box(WIN.x0 - ROOM.x0, ROOM.h, t, wallMat, (ROOM.x0 + WIN.x0) / 2, ROOM.h / 2, wz);
  box(ROOM.x1 - WIN.x1, ROOM.h, t, wallMat, (ROOM.x1 + WIN.x1) / 2, ROOM.h / 2, wz);
  box(WIN.x1 - WIN.x0, WIN.y0, t, wallMat, 0, WIN.y0 / 2, wz);
  box(WIN.x1 - WIN.x0, ROOM.h - WIN.y1, t, wallMat, 0, (ROOM.h + WIN.y1) / 2, wz);

  // 墙裙（下半截木护墙板），三面墙都有，窗下那段是窗台下的墙
  const wh = 0.9;
  box(WIN.x0 - ROOM.x0, wh, 0.02, woodMat, (ROOM.x0 + WIN.x0) / 2, wh / 2, BACK_WALL_Z + 0.01);
  box(ROOM.x1 - WIN.x1, wh, 0.02, woodMat, (ROOM.x1 + WIN.x1) / 2, wh / 2, BACK_WALL_Z + 0.01);
  box(WIN.x1 - WIN.x0, wh, 0.02, woodMat, 0, wh / 2, BACK_WALL_Z + 0.01);
  box(0.02, wh, D, woodMat, ROOM.x0 + 0.01, wh / 2, cz);
  box(0.02, wh, D, woodMat, ROOM.x1 - 0.01, wh / 2, cz);
  box(W, 0.04, 0.03, woodMat, 0, wh + 0.02, BACK_WALL_Z + 0.02);

  // 窗台、窗框
  box(WIN.x1 - WIN.x0 + 0.2, 0.04, 0.26, white, 0, WIN.y0 - 0.02, BACK_WALL_Z - 0.02);
  const fz = BACK_WALL_Z - t + 0.04;
  box(0.06, WIN.y1 - WIN.y0, 0.08, white, WIN.x0 + 0.03, (WIN.y0 + WIN.y1) / 2, fz);
  box(0.06, WIN.y1 - WIN.y0, 0.08, white, WIN.x1 - 0.03, (WIN.y0 + WIN.y1) / 2, fz);
  box(WIN.x1 - WIN.x0, 0.06, 0.08, white, 0, WIN.y1 - 0.03, fz);
  box(WIN.x1 - WIN.x0, 0.05, 0.08, white, 0, WIN.y0 + 0.025, fz);

  // 两扇往外推开的窗扇：外框 + 2×4 格子 + 一点点玻璃反光
  const glass = new THREE.MeshStandardMaterial({ color: 0xdfeaf2, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2 });
  const sashW = (WIN.x1 - WIN.x0) / 2;
  const sashH = WIN.y1 - WIN.y0 - 0.1;
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side < 0 ? WIN.x0 + 0.06 : WIN.x1 - 0.06, WIN.y0 + 0.05, fz - 0.04);
    hinge.rotation.y = side * -1.25;
    scene.add(hinge);
    const sx = side < 0 ? sashW / 2 : -sashW / 2;
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.035), white);
      m.position.set(x, y, 0);
      m.castShadow = true;
      hinge.add(m);
    };
    bar(0.045, sashH, sx - sashW / 2 + 0.02, sashH / 2);
    bar(0.045, sashH, sx + sashW / 2 - 0.02, sashH / 2);
    bar(sashW, 0.045, sx, 0.02);
    bar(sashW, 0.045, sx, sashH - 0.02);
    bar(0.025, sashH, sx, sashH / 2);
    for (let i = 1; i < 4; i++) bar(sashW, 0.025, sx, (sashH * i) / 4);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(sashW - 0.04, sashH - 0.04), glass);
    g.position.set(sx, sashH / 2, 0);
    hinge.add(g);
  }

  // 窗帘：一块竖着褶皱的半透明布，下摆随风轻轻摆
  const curtainMat = addWind(
    new THREE.MeshStandardMaterial({ color: 0xfbf8f1, transparent: true, opacity: 0.88, side: THREE.DoubleSide, roughness: 0.95 }),
    0.04
  );
  for (const side of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.42, 1.75, 24, 8);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 38) * 0.025);
    // 局部 y = 离窗帘杆的距离（0 在杆上），整块再绕 x 翻 180° 垂下来——风按 y² 吹，只有下摆会动
    geo.translate(0, 0.875, 0);
    geo.computeVertexNormals();
    const c = new THREE.Mesh(geo, curtainMat);
    c.position.set(side * (WIN.x1 + 0.08), WIN.y1 + 0.2, BACK_WALL_Z + 0.06);
    c.rotation.x = Math.PI;
    scene.add(c);
  }
  box(WIN.x1 - WIN.x0 + 0.5, 0.025, 0.025, woodMat, 0, WIN.y1 + 0.22, BACK_WALL_Z + 0.06);
}

// ---------- 窗外 ----------
function buildOutside() {
  // 天空：渐变 + 两层缓慢漂移的分形噪声云
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: wind },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
        void main(){
          float h = max(vDir.y, 0.0);
          vec3 col = mix(vec3(0.80,0.89,0.96), vec3(0.33,0.58,0.90), pow(h, 0.5));
          vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = smoothstep(0.52, 0.78, fbm(uv)) * smoothstep(0.0, 0.18, h);
          col = mix(col, vec3(1.0), c * 0.9);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  scene.add(sky);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ color: 0x8fae6a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -400);
  ground.receiveShadow = true;
  scene.add(ground);

  // 远处几道缓坡和一排树：压扁的球，雾会把它们淡进天色里
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x86a866, roughness: 1 });
  [[-60, -140, 70, 9], [40, -170, 90, 12], [120, -120, 60, 7], [-150, -110, 80, 10]].forEach(([x, z, r, h]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), hillMat);
    m.scale.set(r, h, r * 0.6);
    m.position.set(x, -1, z);
    scene.add(m);
  });

  const leafMat = addWind(new THREE.MeshStandardMaterial({ color: 0x7aa05c, roughness: 0.95 }), 0.002);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d5a45, roughness: 1 });
  const rand = mulberry(7);
  for (let i = 0; i < 16; i++) {
    const x = (rand() - 0.5) * 90;
    const z = -14 - rand() * 50;
    if (Math.abs(x) < 4 && z > -20) continue;
    const s = 2.5 + rand() * 3;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, s * 1.2, 7), trunkMat);
    trunk.position.y = s * 0.6;
    tree.add(trunk);
    for (let k = 0; k < 4; k++) {
      const geo = new THREE.IcosahedronGeometry(s * (0.55 + rand() * 0.3), 3);
      geo.translate((rand() - 0.5) * s * 0.7, s * (1.3 + rand() * 0.6), (rand() - 0.5) * s * 0.5);
      tree.add(new THREE.Mesh(geo, leafMat));
    }
    tree.position.set(x, 0, z);
    tree.traverse((o) => (o.castShadow = true));
    scene.add(tree);
  }

  // 近处的草：几千根细叶片一次画完（InstancedMesh），顶点着色器里随风摆
  const blade = new THREE.PlaneGeometry(0.035, 1, 1, 4);
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 0.5;
    p.setX(i, p.getX(i) * (1 - y));
    p.setY(i, y);
  }
  const grassMat = addWind(new THREE.MeshStandardMaterial({ color: 0x86ad5c, side: THREE.DoubleSide, roughness: 1 }), 0.22);
  const N = 6000;
  const grass = new THREE.InstancedMesh(blade, grassMat, N);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  // 坐着从窗台上方往外看，大约 3 米以外的地面才看得到，近处不用种
  for (let i = 0; i < N; i++) {
    const x = (rand() - 0.5) * 10;
    const z = BACK_WALL_Z - 2 - rand() * 12;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    const h = 0.25 + rand() * 0.45;
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, h, 1));
    grass.setMatrixAt(i, m4);
    grass.setColorAt(i, color.setHSL(0.22 + rand() * 0.05, 0.4, 0.38 + rand() * 0.12));
  }
  scene.add(grass);
}

// 固定种子的伪随机：每次打开书房，窗外的树和草长得都一样
function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLights() {
  // 光偏中性白：暖黄的光会把木头全染成橙红，正是"油腻"感的来源
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0xbdb4a4, 1.35));
  const sun = new THREE.DirectionalLight(0xfffaf0, 2.4);
  sun.position.set(2.5, 6, -8);
  sun.target.position.set(0, 0.8, -0.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
}

// ---------- 模型 ----------
const gltfLoader = new GLTFLoader();
function loadModel(name) {
  return new Promise((resolve, reject) =>
    gltfLoader.load(`models/${name}/${name}.gltf`, (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        // 压低环境反射：亮漆一样的高光是"油腻"的另一个来源
        o.material.envMapIntensity = 0.35;
      });
      resolve(g.scene);
    }, undefined, reject)
  );
}

// 模型自带的是深红棕色的亮漆木：把贴图去掉一部分饱和度、提亮，再换成统一的哑光，
// 变成画里那种浅色原木。直接改像素，不用 ctx.filter（iPad 上的 Safari 不一定支持）。
function softenWood(model, saturation, brightness) {
  model.traverse((o) => {
    if (!o.isMesh || !o.material.map) return;
    const mat = o.material;
    const img = mat.map.image;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const grey = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
      for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, (grey + (px[i + k] - grey) * saturation) * brightness);
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = mat.map.flipY;
    tex.anisotropy = 4;
    mat.map = tex;
    mat.roughnessMap = null;
    mat.roughness = 0.82;
  });
}

// 书架每一层的高度不手量：从上往下打射线，打到朝上的面就是一层隔板，
// 再往上打一根看头顶有没有挡板（没有就是书架顶面，不能放书），
// 往左右打看两侧板在哪。换书架模型也不用改坐标。
function measureShelves(shelf) {
  shelf.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const box3 = new THREE.Box3().setFromObject(shelf);
  const front = box3.max.z - 0.12;
  const rows = [];
  let y = box3.max.y + 0.05;
  while (y > box3.min.y + 0.02) {
    ray.set(new THREE.Vector3(shelf.position.x, y, front), down);
    const hit = ray.intersectObject(shelf, true)[0];
    if (!hit) break;
    const surface = hit.point.y;
    ray.set(new THREE.Vector3(shelf.position.x, surface + 0.01, front), up);
    const ceil = ray.intersectObject(shelf, true)[0];
    if (ceil && ceil.point.y - surface > 0.12) {
      const mid = surface + 0.06;
      const side = (dir) => {
        ray.set(new THREE.Vector3(shelf.position.x, mid, front), new THREE.Vector3(dir, 0, 0));
        const h = ray.intersectObject(shelf, true)[0];
        return h ? h.point.x : shelf.position.x + dir * 0.6;
      };
      rows.push({ y: surface, height: ceil.point.y - surface, x0: side(-1) + 0.015, x1: side(1) - 0.015, z: front });
    }
    y = surface - 0.03;
  }
  rows.forEach((row, i) => (row.deco = rows.length > 2 && (i === 0 || i === rows.length - 1)));
  return rows;
}

// ---------- 书 ----------
const spineTexCache = new Map();
function mutedColor(title) {
  const hue = Number(/hsl\((\d+)/.exec(colorForTitle(title))[1]);
  return `hsl(${hue}, 18%, 52%)`;
}

function spineTexture(key, title, color) {
  if (spineTexCache.has(key)) return spineTexCache.get(key);
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 512);
  const shade = ctx.createLinearGradient(0, 0, 64, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.25)");
  shade.addColorStop(0.3, "rgba(255,255,255,0.08)");
  shade.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 64, 512);
  ctx.fillStyle = "rgba(225,200,140,0.75)";
  ctx.fillRect(0, 34, 64, 3);
  ctx.fillRect(0, 475, 64, 3);
  if (title) {
    ctx.save();
    ctx.translate(32, 256);
    ctx.rotate(Math.PI / 2); // 英文书脊的惯例：字从上往下读
    ctx.fillStyle = "rgba(250,243,225,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 26;
    ctx.font = `${size}px Georgia, "Songti SC", serif`;
    while (ctx.measureText(title).width > 400 && size > 14) ctx.font = `${--size}px Georgia, "Songti SC", serif`;
    let text = title;
    while (ctx.measureText(text).width > 400 && text.length > 2) text = text.slice(0, -2) + "…";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  spineTexCache.set(key, tex);
  return tex;
}

let pagesMat = null;
function pageEdgeMaterial() {
  if (pagesMat) return pagesMat;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f1e8d4";
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 2) {
    ctx.fillStyle = `rgba(120,100,70,${0.05 + Math.random() * 0.08})`;
    ctx.fillRect(i, 0, 1, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  pagesMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  return pagesMat;
}

// 书块：x = 厚度，y = 高度，z = 深度；+z 面是书脊（朝外），±x 是封面封底，其余是纸页边
function makeBook(dims, title, color, key) {
  const cover = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const spine = new THREE.MeshStandardMaterial({ map: spineTexture(key, title, color), roughness: 0.7 });
  const pages = pageEdgeMaterial();
  const m = new THREE.Mesh(new THREE.BoxGeometry(dims.t, dims.h, dims.d), [cover, cover, pages, pages, spine, pages]);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function bookDims(id) {
  return { t: 0.024 + ((id * 7) % 11) * 0.0022, h: 0.2 + ((id * 13) % 17) * 0.0035, d: 0.15 + ((id * 5) % 7) * 0.006 };
}

// 摊开在桌上的书：左右两半，各是一块硬封面 + 一叠纸页，中间微微拱起
function makeOpenBook(b) {
  const g = new THREE.Group();
  const color = mutedColor(b.title);
  const coverMat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fbf6ea";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(120,100,70,0.16)";
  for (let y = 120; y < 470; y += 22) ctx.fillRect(50, y, 412, 2);
  ctx.fillStyle = "#5a4a35";
  ctx.font = '34px Georgia, "Songti SC", serif';
  ctx.textAlign = "center";
  let text = b.title;
  while (ctx.measureText(text).width > 420 && text.length > 2) text = text.slice(0, -2) + "…";
  ctx.fillText(text, 256, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const leftTop = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const rightTop = new THREE.MeshStandardMaterial({ color: 0xfbf6ea, roughness: 0.95 });
  const edge = pageEdgeMaterial();
  const W = 0.15, D = 0.22;
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(W + 0.006, 0.004, D + 0.01), coverMat);
    board.position.set(side * (W / 2 + 0.003), 0.002, 0);
    const top = side < 0 ? leftTop : rightTop;
    const block = new THREE.Mesh(new THREE.BoxGeometry(W, 0.014, D), [edge, edge, top, edge, edge, edge]);
    block.position.set(side * W / 2, 0.011, 0);
    board.castShadow = block.castShadow = true;
    board.receiveShadow = block.receiveShadow = true;
    half.add(board, block);
    half.rotation.z = side * -0.06;
    g.add(half);
  }
  return g;
}

// ---------- 场景里的书：书架 + 桌面，书库变了就整体重摆 ----------
const bookLayer = new THREE.Group();
scene.add(bookLayer);
let shelfRows = [];
let books = [];
const clickable = [];

function deskBooks() {
  const saved = Number(localStorage.getItem(DESK_KEY));
  const recent = books.filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const center = books.find((b) => b.id === saved) || recent[0] || null;
  const pile = recent.filter((b) => b !== center).slice(0, PILE_SIZE);
  return { center, pile };
}

function layoutBooks() {
  bookLayer.clear();
  for (const s of new Set(shelfRows.map((row) => row.shelf))) s.userData.bookGroup.clear();
  clickable.length = 0;
  const { center, pile } = deskBooks();
  const onDesk = new Set([center, ...pile]);

  // 用户的书从视线高度附近的格子开始放；每个书架最上、最下一层只摆装饰书，书架不会显得空
  const rows = shelfRows;
  const userRows = rows.filter((row) => !row.deco).sort((a, b) => Math.abs(a.y - 1.1) - Math.abs(b.y - 1.1));
  let r = 0;
  let x = userRows.length ? userRows[0].x0 : 0;
  const used = new Map(userRows.map((row) => [row, row.x0]));
  for (const b of books) {
    if (onDesk.has(b) || !userRows.length) continue;
    const d = bookDims(b.id);
    if (x + d.t > userRows[r].x1) {
      used.set(userRows[r], x);
      r++;
      // shortcut: 书架放满（几百本）后多出来的书不显示；真到这个量再加第三个书架
      if (r >= userRows.length) break;
      x = userRows[r].x0;
    }
    const row = userRows[r];
    const color = mutedColor(b.title);
    const m = makeBook(d, b.title, color, `u${b.id}`);
    m.position.set(x + d.t / 2, row.y + Math.min(d.h, row.height - 0.02) / 2, row.z - d.d / 2 + 0.06);
    m.scale.y = Math.min(1, (row.height - 0.02) / d.h);
    m.userData = { book: b, action: "shelf", home: m.position.clone() };
    row.shelf.userData.bookGroup.add(m);
    clickable.push(m);
    x += d.t + 0.002;
    used.set(row, x);
  }

  // 装饰书：每层剩下的空位填一部分，留一点空隙，看起来像真有人在用的书架
  const rand = mulberry(11);
  const palette = [0x7d8a72, 0x8b6e5a, 0x6f7f8c, 0xb5a58a, 0x8c5f55, 0x9aa28a, 0xc2b49a];
  for (const row of rows) {
    let dx = used.get(row) ?? row.x0;
    const stop = row.x1 - (row.x1 - dx) * (0.25 + rand() * 0.3);
    if (used.has(row) && dx > row.x0) dx += 0.04;
    while (dx < stop) {
      const d = { t: 0.022 + rand() * 0.03, h: Math.min(0.19 + rand() * 0.08, row.height - 0.02), d: 0.15 + rand() * 0.05 };
      if (dx + d.t > row.x1) break;
      const col = new THREE.Color(palette[Math.floor(rand() * palette.length)]).getStyle();
      const m = makeBook(d, "", col, `deco${col}`);
      m.position.set(dx + d.t / 2, row.y + d.h / 2, row.z - d.d / 2 + 0.06);
      row.shelf.userData.bookGroup.add(m);
      dx += d.t + 0.002;
    }
  }

  if (center) {
    const open = makeOpenBook(center);
    open.position.set(-0.08, DESK_TOP, -0.62);
    open.rotation.y = 0.05;
    open.traverse((o) => (o.userData = { book: center, action: "open" }));
    open.userData.isOpenBook = true;
    bookLayer.add(open);
    clickable.push(open);
  }
  // 最近读过的一摞：平躺着叠起来，书脊朝着人
  let py = DESK_TOP;
  pile.forEach((b, i) => {
    const d = bookDims(b.id);
    const m = makeBook(d, b.title, mutedColor(b.title), `u${b.id}`);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = (i - 1) * 0.08;
    m.position.set(0.36, py + d.t / 2, -0.66);
    py += d.t;
    m.userData = { book: b, action: "pile" };
    bookLayer.add(m);
    clickable.push(m);
  });
}

// ---------- 动画：选书、翻开 ----------
const tweens = [];
function tween(ms, fn) {
  return new Promise((resolve) => tweens.push({ start: performance.now(), ms, fn, resolve }));
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let busy = false;

async function pickFromShelf(mesh) {
  busy = true;
  mesh.userData.flying = true;
  // 书原本挂在书架下面（书架坐标系），先换挂到场景上、保持世界位置不变，再按世界坐标飞
  const out = new THREE.Vector3(0, 0, 1).transformDirection(mesh.parent.matrixWorld).multiplyScalar(0.18);
  scene.attach(mesh);
  const from = mesh.position.clone();
  const qFrom = mesh.quaternion.clone();
  const lifted = from.clone().add(out);
  const to = new THREE.Vector3(-0.08, DESK_TOP + 0.03, -0.62);
  // 落地姿势：平躺（厚度朝上），书脊朝左、书的长边沿着桌子纵深，跟摊开那本的朝向一致
  const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, Math.PI / 2));
  await tween(260, (t) => mesh.position.lerpVectors(from, lifted, ease(t)));
  await tween(750, (t) => {
    const e = ease(t);
    mesh.position.lerpVectors(lifted, to, e);
    mesh.position.y += Math.sin(e * Math.PI) * 0.25;
    mesh.quaternion.slerpQuaternions(qFrom, qTo, e);
  });
  localStorage.setItem(DESK_KEY, String(mesh.userData.book.id));
  mesh.removeFromParent(); // 它已经不在书架的子物体里了，layoutBooks 清不到它
  layoutBooks();
  busy = false;
}

async function openBook(book) {
  busy = true;
  document.getElementById("fadeOverlay").classList.add("show");
  const from = camera.position.clone();
  const to = new THREE.Vector3(-0.08, DESK_TOP + 0.32, -0.42);
  const yaw0 = look.yaw, pitch0 = look.pitch;
  await tween(900, (t) => {
    const e = ease(t);
    camera.position.lerpVectors(from, to, e);
    look.yaw = yaw0 * (1 - e);
    look.pitch = pitch0 + (-1.15 - pitch0) * e;
  });
  location.href = `reader.html?id=${book.id}&from=study`;
}

// ---------- 交互：拖动转头 + 点书 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;
let hovered = null;

function hit(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const h = raycaster.intersectObjects(clickable, true)[0];
  if (!h) return null;
  let o = h.object;
  while (o && !clickable.includes(o)) o = o.parent;
  return o;
}

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId); // 拖出画布外也继续跟手
  } catch {}
  drag ={ x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, moved: false };
});
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    canvas.classList.add("dragging");
    document.getElementById("hint").classList.add("hide");
    const k = 2.2 / innerHeight; // 拖满一屏高大约转 125°
    look.yaw = THREE.MathUtils.clamp(drag.yaw + dx * k, -1.75, 1.75);
    look.pitch = THREE.MathUtils.clamp(drag.pitch + dy * k, -0.75, 0.45);
    return;
  }
  if (e.pointerType === "mouse") {
    hovered = busy ? null : hit(e);
    canvas.classList.toggle("overBook", !!hovered);
  }
});
canvas.addEventListener("pointerup", (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  canvas.classList.remove("dragging");
  if (wasDrag || busy) return;
  const o = hit(e);
  if (!o) return;
  const { action, book } = o.userData;
  if (action === "shelf") pickFromShelf(o);
  else if (action === "pile") {
    localStorage.setItem(DESK_KEY, String(book.id));
    layoutBooks();
  } else if (action === "open") openBook(book);
});
canvas.addEventListener("pointercancel", () => (drag = null));

// ---------- 主循环 ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // 竖屏时视野自动放宽一点，不然只看得到书桌中间一小块
  camera.fov = camera.aspect < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

const clock = new THREE.Clock();
function frame() {
  const now = performance.now();
  wind.value = clock.getElapsedTime();
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = Math.min(1, (now - tw.start) / tw.ms);
    tw.fn(t);
    if (t >= 1) {
      tweens.splice(i, 1);
      tw.resolve();
    }
  }
  // 鼠标指着书架上的书，书往外抽出一点
  for (const m of clickable) {
    if (m.userData.action !== "shelf" || m.userData.flying) continue;
    const target = m === hovered ? 0.05 : 0;
    m.position.z += (m.userData.home.z + target - m.position.z) * 0.2;
  }
  camera.rotation.set(look.pitch, look.yaw, 0);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

async function init() {
  resize();
  buildRoom();
  buildOutside();
  buildLights();
  const [shelfModel, deskModel, plantModel, shrubModel] = await Promise.all(
    ["wooden_bookshelf_worn", "wooden_table_02", "potted_plant_04", "shrub_04"].map(loadModel)
  );

  softenWood(deskModel, 0.45, 1.35);
  softenWood(shelfModel, 0.6, 1.3);
  deskModel.position.set(0, 0, BACK_WALL_Z + 0.4);
  deskModel.scale.setScalar(DESK_TOP / 0.7994);
  scene.add(deskModel);

  // 书架贴着左右两面侧墙、正面朝屋里，转头就是正对着。格子在模型还在原点、
  // 没旋转的时候量一次（书架自己的坐标系），书作为书架的子物体挂上去，跟着一起转
  const localRows = measureShelves(shelfModel);
  shelfRows = [];
  for (const side of [-1, 1]) {
    const s = side < 0 ? shelfModel : shelfModel.clone();
    s.position.set(side * (ROOM.x1 - 0.3), 0, -0.3);
    s.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    s.userData.bookGroup = new THREE.Group();
    s.add(s.userData.bookGroup);
    scene.add(s);
    shelfRows.push(...localRows.map((row) => ({ ...row, shelf: s })));
  }

  [-0.45, -0.15, 0.4].forEach((x, i) => {
    const p = i === 0 ? plantModel : plantModel.clone();
    p.position.set(x, WIN.y0, BACK_WALL_Z - 0.06);
    p.rotation.y = i * 1.7;
    p.scale.setScalar(0.9 + i * 0.15);
    scene.add(p);
  });

  shrubModel.traverse((o) => {
    if (o.isMesh) o.material = addWind(o.material.clone(), 0.6);
  });
  [[-1.2, -2.2, 3.5, 0.4], [1.4, -2.6, 4, 2.1], [-3.5, -4.5, 5, 1], [3, -5, 5.5, 2.8], [0.2, -6, 4.5, 0.2]].forEach(([x, z, s, ry], i) => {
    const sh = i === 0 ? shrubModel : shrubModel.clone();
    sh.position.set(x, 0, z);
    sh.scale.setScalar(s);
    sh.rotation.y = ry;
    scene.add(sh);
  });

  books = (await listBooksLocal()).sort((a, b) => (a.shelfOrder ?? 1e9) - (b.shelfOrder ?? 1e9));
  layoutBooks();
  document.getElementById("loading").classList.add("done");
}

// 从阅读页按返回回来时浏览器可能直接复用这一页的缓存快照：撤掉遮罩、把镜头放回椅子上
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  document.getElementById("fadeOverlay").classList.remove("show");
  camera.position.copy(EYE);
  look.pitch = -0.2;
  busy = false;
});

init().catch((err) => {
  document.getElementById("loading").textContent = `书房加载失败：${err.message}`;
  console.error(err);
});

window.__study = { scene, camera, renderer, look, frame, layoutBooks, shelfRows: () => shelfRows };
