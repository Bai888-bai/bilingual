// 书房：把那张田园书房插画（study-room.jpg）按 AI 估出来的深度图（study-depth.png）
// "推"成立体浮雕——从座位上看过去跟原画一模一样，转头/探头时近处的桌椅和远处的窗外
// 会错开（视差），才有 3D 感。画沿书架和窗户之间的墙折成三联屏：中间是窗和书桌，
// 两侧书架往人这边折过来，转头就正对着书架。
// 书库里的书是真 3D 书块，放进画里书架的空格子和桌面上：点书架上的书 → 飞到桌上摊开；
// 点摊开的书 → 进阅读页；桌子右边那摞是最近读过的。窗外的云、树、草和窗帘在着色器里动。
import * as THREE from "three";

const DESK_KEY = "studyDeskBookId";
const PILE_SIZE = 3;

// ---- 画的坐标系：像素 (u, v)，原图 1774×887 ----
const IMG_W = 1774;
const IMG_H = 887;
const PX = 0.00296; // 每像素多少米（按画里书架约 2 米高定的）
const PANEL_DIST = 2.6; // 平铺状态下画离眼睛多远
const FOLD = 0.95; // 两侧书架往里折的角度（弧度，约 55°）
const SEAM_L = 490; // 左书架和窗户之间那段墙的位置，从这里折
const SEAM_R = 1290;
const EYE = new THREE.Vector3(0, (IMG_H - 470) * PX, 0);
// 画里书架的空格子：x 范围 + 格子底（隔板顶面）的 v。是对着原图逐行扫亮度量出来的
const SHELF_ROWS = [
  { side: -1, u0: 136, u1: 426, v: 342 },
  { side: -1, u0: 136, u1: 426, v: 454 },
  { side: -1, u0: 136, u1: 426, v: 566 },
  { side: 1, u0: 1344, u1: 1640, v: 342 },
  { side: 1, u0: 1344, u1: 1640, v: 454 },
  { side: 1, u0: 1344, u1: 1640, v: 566 },
];
const DESK_CENTER = { u: 860, v: 612 }; // 摊开的书放在画里桌面上的位置
const DESK_PILE = { u: 1150, v: 606 };

// 深度图的值越大越近（窗外 ≈0，椅子 ≈1）。换算成离眼睛的距离：1/(a·d+b)，
// 让窗外约 8 米、桌面约 1.4 米、书架约 2 米——桌面按真实书桌大小算出来的距离
const depthToDist = (d) => 1 / (0.77 * d + 0.125);

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xe9e2d3);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
camera.rotation.order = "YXZ";
const look = { yaw: 0, pitch: 0 };
const time = { value: 0 };

// ---------- 三联屏的几何：平铺/折叠后的位置（还没按深度推远拉近） ----------
const panels = [
  { u0: 0, u1: SEAM_L, pivotU: SEAM_L, rot: FOLD },
  { u0: SEAM_L, u1: SEAM_R, pivotU: 887, rot: 0, center: true },
  { u0: SEAM_R, u1: IMG_W, pivotU: SEAM_R, rot: -FOLD },
];
for (const p of panels) {
  p.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
  // 中间那块的原点在画面正中；两侧的原点在折痕上（中间那块左右边缘的位置）
  p.origin = new THREE.Vector3(p.center ? 0 : (p.pivotU - 887) * PX, 0, -PANEL_DIST);
  p.normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
}
const panelFor = (u) => (u < SEAM_L ? panels[0] : u > SEAM_R ? panels[2] : panels[1]);

// 深度图在 JS 里也要读一份：放书时要知道画里那个点被推到了多远
let depthData = null;
function depthAt(u, v) {
  const x = Math.min(depthData.width - 1, Math.max(0, Math.round((u / IMG_W) * depthData.width)));
  const y = Math.min(depthData.height - 1, Math.max(0, Math.round((v / IMG_H) * depthData.height)));
  return depthData.data[(y * depthData.width + x) * 4] / 255;
}

// 画上 (u, v) 那个点在世界里的位置：先放到三联屏上，再沿着"眼睛→这个点"的视线
// 按深度推远或拉近——视线方向不变，所以从座位上看过去画面一点不变形
function paintPoint(u, v, depth = depthAt(u, v)) {
  const p = panelFor(u);
  const local = new THREE.Vector3((u - p.pivotU) * PX, (IMG_H - v) * PX, 0).applyQuaternion(p.quat).add(p.origin);
  const dir = local.sub(EYE);
  return EYE.clone().add(dir.multiplyScalar(depthToDist(depth) / PANEL_DIST));
}

function buildPainting(roomTex, depthTex) {
  const material = new THREE.ShaderMaterial({
    transparent: false,
    uniforms: {
      uMap: { value: roomTex },
      uDepth: { value: depthTex },
      uEye: { value: EYE },
      uTime: time,
      uPanelDist: { value: PANEL_DIST },
    },
    vertexShader: `
      uniform sampler2D uDepth; uniform vec3 uEye; uniform float uPanelDist;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        float d = texture2D(uDepth, uv).r;
        float dist = 1.0 / (0.77 * d + 0.125);
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 p = uEye + (world - uEye) * (dist / uPanelDist);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uTime; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
      float inRect(vec2 px, vec4 r){ return step(r.x, px.x) * step(px.x, r.z) * step(r.y, px.y) * step(px.y, r.w); }
      void main() {
        vec2 px = vec2(vUv.x * ${IMG_W}.0, (1.0 - vUv.y) * ${IMG_H}.0);
        vec2 uv = vUv;
        // 阵风：两个慢正弦相乘，大部分时候微风，偶尔来一阵
        float gust = 0.5 + 0.5 * sin(uTime * 0.31) * sin(uTime * 0.13 + 1.7);
        vec3 base = texture2D(uMap, uv).rgb;
        // 窗外的树和草（窗洞里偏绿的像素）：按位置错开相位轻轻摆
        float win = inRect(px, vec4(605.0, 45.0, 1170.0, 495.0));
        float green = smoothstep(0.02, 0.08, base.g - max(base.r, base.b) * 0.92);
        float sway = sin(uTime * 1.8 + px.y * 0.09 + px.x * 0.02) * 0.7 + sin(uTime * 3.4 + px.x * 0.15) * 0.3;
        uv.x += win * green * sway * (0.6 + gust) * 1.6 / ${IMG_W}.0;
        // 窗帘下摆：越往下摆得越多
        float curtain = inRect(px, vec4(498.0, 0.0, 605.0, 560.0)) + inRect(px, vec4(1172.0, 0.0, 1282.0, 560.0));
        uv.x += curtain * smoothstep(150.0, 560.0, px.y) * sin(uTime * 1.1 + px.y * 0.012) * (0.4 + gust) * 2.5 / ${IMG_W}.0;
        vec3 col = texture2D(uMap, uv).rgb;
        // 窗外天空（窗洞上半部分里偏蓝或很亮的像素）：叠一层会飘的薄云
        float skyish = max(smoothstep(0.03, 0.1, col.b - col.r), smoothstep(0.86, 0.93, dot(col, vec3(0.3, 0.59, 0.11))));
        float sky = win * (1.0 - smoothstep(230.0, 300.0, px.y)) * skyish * (1.0 - green);
        vec2 cuv = vec2(px.x / 260.0, px.y / 90.0);
        float c = smoothstep(0.5, 0.75, fbm(cuv + vec2(uTime * 0.05, 0.0)) * 0.7 + fbm(cuv * 2.3 - vec2(uTime * 0.03, 0.0)) * 0.3);
        col = mix(col, vec3(1.0), sky * c * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // 贴图本身已经是 sRGB 的颜色，直接输出、不再做色调映射，画面颜色跟原画一致
  roomTex.colorSpace = THREE.SRGBColorSpace;

  for (const p of panels) {
    const wPx = p.u1 - p.u0;
    const geo = new THREE.PlaneGeometry(1, 1, Math.ceil(wPx / 4), Math.ceil(IMG_H / 4));
    const pos = geo.attributes.position;
    const uvs = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = p.u0 + uvs.getX(i) * wPx;
      const v = (1 - uvs.getY(i)) * IMG_H;
      pos.setXYZ(i, (u - p.pivotU) * PX, (IMG_H - v) * PX, 0);
      uvs.setXY(i, u / IMG_W, 1 - v / IMG_H);
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(p.origin);
    mesh.quaternion.copy(p.quat);
    mesh.frustumCulled = false; // 顶点在着色器里被推远拉近了，包围盒不准
    scene.add(mesh);
  }
}

function buildLights() {
  // 光大致从窗户那边来，跟画里的光向一致；书是唯一受光照的东西
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb0, 1.5));
  const sun = new THREE.DirectionalLight(0xfffaf0, 1.4);
  sun.position.set(0.6, 3, -3);
  scene.add(sun);
}

// ---------- 书 ----------
const texLoader = new THREE.TextureLoader();
const spineTexCache = new Map();
function mutedColor(title) {
  const hue = Number(/hsl\((\d+)/.exec(colorForTitle(title))[1]);
  return `hsl(${hue}, 18%, 52%)`;
}

// 书脊：有自定义封面就跟书架首页一样用封面图（取中间一条），没有就用书名哈希出来的颜色
function spineTexture(key, title, color, coverData) {
  if (spineTexCache.has(key)) return spineTexCache.get(key);
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 512;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  spineTexCache.set(key, tex);
  paintSpine(c.getContext("2d"), title, color, null);
  if (coverData) {
    const img = new Image();
    img.onload = () => {
      paintSpine(c.getContext("2d"), title, color, img);
      tex.needsUpdate = true;
    };
    img.src = coverData;
  }
  return tex;
}

function paintSpine(ctx, title, color, img) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 512);
  if (img) {
    const s = Math.max(64 / img.width, 512 / img.height);
    ctx.drawImage(img, (64 - img.width * s) / 2, (512 - img.height * s) / 2, img.width * s, img.height * s);
  }
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
    if (img) {
      // 封面图上字的底色不确定，垫一条半透明深色带，书名才看得清
      ctx.fillStyle = "rgba(30,24,16,0.45)";
      ctx.fillRect(-Math.min(ctx.measureText(text).width / 2 + 14, 240), -20, Math.min(ctx.measureText(text).width + 28, 480), 40);
      ctx.fillStyle = "rgba(250,243,225,0.95)";
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

const coverTexCache = new Map();
function coverTexture(key, coverData) {
  if (!coverTexCache.has(key)) {
    const t = texLoader.load(coverData);
    t.colorSpace = THREE.SRGBColorSpace;
    coverTexCache.set(key, t);
  }
  return coverTexCache.get(key);
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

// 书块：x = 厚度，y = 高度，z = 深度；+z 面是书脊（朝外），+x 是封面（书脊朝自己、
// 字从上往下读时封面在右手边），-x 是封底，其余是纸页边
function makeBook(dims, b, key) {
  const color = mutedColor(b.title);
  const back = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const front = b.coverData ? new THREE.MeshStandardMaterial({ map: coverTexture(key, b.coverData), roughness: 0.7 }) : back;
  const spine = new THREE.MeshStandardMaterial({ map: spineTexture(key, b.title, color, b.coverData), roughness: 0.7 });
  const pages = pageEdgeMaterial();
  return new THREE.Mesh(new THREE.BoxGeometry(dims.t, dims.h, dims.d), [front, back, pages, pages, spine, pages]);
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
    half.add(board, block);
    half.rotation.z = side * -0.06;
    g.add(half);
  }
  return g;
}

// 画是平面贴图，接不住真实的影子——在桌上的书底下垫一块柔和的暗斑，书才"落"在桌面上
let blobTex = null;
function contactShadow(w, d) {
  if (!blobTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, "rgba(60,40,20,0.45)");
    g.addColorStop(1, "rgba(60,40,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// ---------- 场景里的书：书架 + 桌面，书库变了就整体重摆 ----------
const bookLayer = new THREE.Group();
scene.add(bookLayer);
let books = [];
const clickable = [];

function deskBooks() {
  const saved = Number(localStorage.getItem(DESK_KEY));
  const recent = books.filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const center = books.find((b) => b.id === saved) || recent[0] || null;
  const pile = recent.filter((b) => b !== center).slice(0, PILE_SIZE);
  return { center, pile };
}

// 桌上的书放在画里桌面那个点被推到的位置，平躺（不跟着三联屏转）
function deskPose(spot) {
  return paintPoint(spot.u, spot.v);
}

function layoutBooks() {
  bookLayer.clear();
  clickable.length = 0;
  const { center, pile } = deskBooks();
  const onDesk = new Set([center, ...pile]);

  // 书架上只放书库里真实的书（跟书架首页同一份数据、同样的顺序和封面），
  // 从视线高度附近的格子开始、左右两个书架轮流放
  const rows = SHELF_ROWS.slice().sort((a, b) => Math.abs(a.v - 454) - Math.abs(b.v - 454) || a.side - b.side);
  // 书立在格子最里面：深度取隔板线往上一点（格子背板）的值，而不是隔板前沿——
  // 不然书会从隔板外沿往外伸、悬在半空
  const backDepth = (row, u) => depthAt(u, row.v - 40);
  const metersPerPx = (row) => paintPoint(row.u0, row.v, backDepth(row, row.u0)).distanceTo(paintPoint(row.u1, row.v, backDepth(row, row.u0))) / (row.u1 - row.u0);
  let r = 0;
  let u = rows[0].u0;
  let k = metersPerPx(rows[0]);
  for (const b of books) {
    if (onDesk.has(b)) continue;
    const d = bookDims(b.id);
    if (u + d.t / k > rows[r].u1) {
      r++;
      // shortcut: 6 个格子大约放 120 本，再多的不显示；书真多到这个量再加翻页
      if (r >= rows.length) break;
      u = rows[r].u0;
      k = metersPerPx(rows[r]);
    }
    const row = rows[r];
    const p = panelFor(row.u0);
    const h = Math.min(d.h, 104 * k * 0.9); // 格子大约 104 像素高
    const m = makeBook(d, b, `u${b.id}`);
    m.scale.y = h / d.h;
    m.quaternion.copy(p.quat);
    const cu = u + d.t / k / 2;
    const foot = paintPoint(cu, row.v, backDepth(row, cu));
    m.position.copy(foot).addScaledVector(p.normal, d.d / 2).add(new THREE.Vector3(0, h / 2, 0));
    m.userData = { book: b, action: "shelf", home: m.position.clone(), normal: p.normal };
    bookLayer.add(m);
    clickable.push(m);
    u += (d.t + 0.002) / k;
  }

  if (center) {
    const pos = deskPose(DESK_CENTER);
    const open = makeOpenBook(center);
    open.position.copy(pos);
    // 画里的视线只比桌面高一点，书平放几乎是贴着边看——远端翘起来一些（像靠在书立上），书页才看得见
    open.rotation.set(0.32, 0.05, 0);
    open.scale.setScalar(1.25);
    open.traverse((o) => (o.userData = { book: center, action: "open" }));
    open.userData.isOpenBook = true;
    bookLayer.add(open);
    clickable.push(open);
    const sh = contactShadow(0.42, 0.32);
    sh.position.copy(pos).add(new THREE.Vector3(0, 0.002, 0));
    bookLayer.add(sh);
  }
  // 最近读过的一摞：平躺着叠起来，书脊朝着人，封面（+x）朝上
  const pilePos = deskPose(DESK_PILE);
  let py = pilePos.y;
  pile.forEach((b, i) => {
    const d = bookDims(b.id);
    const m = makeBook(d, b, `u${b.id}`);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = (i - 1) * 0.08;
    m.position.set(pilePos.x, py + d.t / 2, pilePos.z);
    py += d.t;
    m.userData = { book: b, action: "pile" };
    bookLayer.add(m);
    clickable.push(m);
  });
  if (pile.length) {
    const sh = contactShadow(0.36, 0.3);
    sh.position.copy(pilePos).add(new THREE.Vector3(0, 0.002, 0));
    bookLayer.add(sh);
  }
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
  const from = mesh.position.clone();
  const qFrom = mesh.quaternion.clone();
  const lifted = from.clone().addScaledVector(mesh.userData.normal, 0.18);
  const to = deskPose(DESK_CENTER).add(new THREE.Vector3(0, 0.03, 0));
  // 落地姿势：平躺（厚度朝上），书脊朝左、书的长边沿着桌子纵深，跟摊开那本的朝向一致
  const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, Math.PI / 2));
  await tween(260, (t) => mesh.position.lerpVectors(from, lifted, ease(t)));
  await tween(800, (t) => {
    const e = ease(t);
    mesh.position.lerpVectors(lifted, to, e);
    mesh.position.y += Math.sin(e * Math.PI) * 0.25;
    mesh.quaternion.slerpQuaternions(qFrom, qTo, e);
  });
  localStorage.setItem(DESK_KEY, String(mesh.userData.book.id));
  layoutBooks();
  busy = false;
}

async function openBook(book) {
  busy = true;
  document.getElementById("fadeOverlay").classList.add("show");
  const target = deskPose(DESK_CENTER);
  const from = camera.position.clone();
  const to = target.clone().add(new THREE.Vector3(0, 0.38, 0.22));
  const yaw0 = look.yaw, pitch0 = look.pitch;
  const yawTo = Math.atan2(-(target.x - to.x), -(target.z - to.z));
  await tween(900, (t) => {
    const e = ease(t);
    camera.position.lerpVectors(from, to, e);
    look.yaw = yaw0 + (yawTo - yaw0) * e;
    look.pitch = pitch0 + (-1.05 - pitch0) * e;
  });
  location.href = `reader.html?id=${book.id}&from=study`;
}

// ---------- 交互：拖动转头 + 鼠标位置带一点探头视差 + 点书 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const lean = new THREE.Vector2(); // -1..1，鼠标在屏幕上的位置 → 头往那边探一点
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
  drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, moved: false };
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") lean.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    canvas.classList.add("dragging");
    document.getElementById("hint").classList.add("hide");
    const k = 1.6 / innerHeight;
    look.yaw = THREE.MathUtils.clamp(drag.yaw + dx * k, -yawRange.max, yawRange.max);
    look.pitch = THREE.MathUtils.clamp(drag.pitch + dy * k, pitchRange.min, pitchRange.max);
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
// 画在眼睛上下各覆盖多少度：超出去就是画的边，后面什么都没有。视野和低头抬头的
// 范围都按这个收住，保证任何时候都看不到画的边缘
const PAINT_DOWN = Math.atan(EYE.y / PANEL_DIST);
const PAINT_UP = Math.atan((IMG_H * PX - EYE.y) / PANEL_DIST);
const pitchRange = { min: 0, max: 0 };
const yawRange = { max: FOLD };
// 左右能转多少：画最左/最右那一列（按深度推过之后）刚好碰到屏幕边就停
function updateYawRange() {
  if (!depthData) return;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const edge = (u) => {
    const p = paintPoint(u, 443).sub(EYE);
    return Math.abs(Math.atan2(-p.x, -p.z));
  };
  yawRange.max = Math.max(0, Math.min(edge(2), edge(IMG_W - 2)) - hfov / 2 - 0.04);
  look.yaw = THREE.MathUtils.clamp(look.yaw, -yawRange.max, yawRange.max);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  const vfov = Math.min(46, THREE.MathUtils.radToDeg(PAINT_DOWN + PAINT_UP) - 4);
  camera.fov = vfov;
  camera.updateProjectionMatrix();
  const half = THREE.MathUtils.degToRad(vfov / 2);
  pitchRange.min = -(PAINT_DOWN - half - 0.02);
  pitchRange.max = PAINT_UP - half - 0.02;
  look.pitch = THREE.MathUtils.clamp(look.pitch, pitchRange.min, pitchRange.max);
  updateYawRange();
}
addEventListener("resize", resize);

const clock = new THREE.Clock();
const leanNow = new THREE.Vector2();
function frame() {
  const now = performance.now();
  time.value = clock.getElapsedTime();
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
    m.userData.pull = (m.userData.pull || 0) + ((m === hovered ? 0.05 : 0) - (m.userData.pull || 0)) * 0.2;
    m.position.copy(m.userData.home).addScaledVector(m.userData.normal, m.userData.pull);
  }
  if (!busy) {
    // 探头：鼠标位置（触屏时用转头角度代替）+ 很慢的呼吸起伏。幅度小，深度图边缘才不会被扯开
    leanNow.lerp(drag || !lean.lengthSq() ? new THREE.Vector2(-look.yaw * 0.4, 0) : lean, 0.06);
    camera.position.set(EYE.x + leanNow.x * 0.07, EYE.y - leanNow.y * 0.035 + Math.sin(time.value * 0.8) * 0.004, EYE.z);
  }
  camera.rotation.set(look.pitch, look.yaw, 0);
  renderer.render(scene, camera);
}

function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => reject(new Error(`加载失败：${url}`));
    img.src = url;
  });
}

async function init() {
  resize();
  const [roomTex, depthTex, data] = await Promise.all([
    texLoader.loadAsync("study-room.jpg"),
    texLoader.loadAsync("study-depth.png"),
    loadImageData("study-depth.png"),
  ]);
  depthData = data;
  updateYawRange();
  roomTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  buildPainting(roomTex, depthTex);
  buildLights();
  books = (await listBooksLocal()).sort((a, b) => (a.shelfOrder ?? 1e9) - (b.shelfOrder ?? 1e9));
  layoutBooks();
  renderer.setAnimationLoop(frame);
  document.getElementById("loading").classList.add("done");
}

// 从阅读页按返回回来时浏览器可能直接复用这一页的缓存快照：撤掉遮罩、把镜头放回座位上
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  document.getElementById("fadeOverlay").classList.remove("show");
  look.yaw = 0;
  look.pitch = 0;
  busy = false;
});

init().catch((err) => {
  document.getElementById("loading").textContent = `书房加载失败：${err.message}`;
  console.error(err);
});

window.__study = { scene, camera, renderer, look, frame, paintPoint, lean };
