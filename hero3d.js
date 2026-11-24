// EVALIU INK, Core hero: the "Dolly" shot.
// It opens on the classical view: a marble Venus centred under the wordmark in front three-quarter,
// the orchid tattoo on her back out of sight. Scrolling through the pinned stage turns her away
// from the viewer while the camera dollies in, slides and lowers, until the tattooed back fills
// the frame. The wordmark is part of the backdrop and rides up and out of frame with the push-in.
// Once the close-up has landed the line arrives beside it (fade and 12px rise) and the label
// above it is carried up to make room. The last stretch of the pin holds the finished close-up,
// so it has settled before the page scrolls on. One smoothed progress value drives every
// channel, so the turn, the camera and the type move as one shot.
// One self-contained ES module. three.js comes from a CDN (no import map needed).
// States on <section data-3d>: "loading" (set at once; tall pinned stage, the still drawing on
// the spot where the statue's torso will be), "ready" = canvas live, "static" = still drawing at normal height
// (no WebGL, or anything failed).

const THREE_URL = 'https://esm.sh/three@0.160.0';
const LOADER_URL = 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
const MODELS = { full: 'venus_de_milo_80k.glb', phone: 'venus_de_milo_55k.glb', lite: 'venus_de_milo_30k.glb' };
// Giving up on a slow connection (round 6). While the still drawing is on screen (the opening
// frame) nothing is missing, so the hero waits up to LOAD_PATIENCE; once the visitor has scrolled
// on into the shot (the drawing steps aside), it waits LOAD_TIMEOUT at most, then the still hero stays.
const LOAD_TIMEOUT = 8000; // ms
const LOAD_PATIENCE = 20000; // ms
const LOST_WAIT = 3000; // ms on screen for a lost WebGL context to come back before the still hero stays

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
// 0..1 over [a, b] of the scroll, eased at both ends: the moves are scrubbed, so they ease in and out.
const smoothstep = ([a, b], v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Model space (venus_de_milo_*.glb): Y up, feet at y = 0, height 1. The figure faces +Z, so her
// back faces -Z, turned about 12 degrees toward -X by the twist of the torso.
const BACK_YAW = 0.21; // radians about Y, from -Z to the direction the back faces
const PIVOT = { x: -0.035, z: -0.005 }; // vertical axis through the torso, so it turns in place
const BACK_ANGLE = Math.PI - BACK_YAW; // rotation.y that shows the back straight on
const INTRO = { angle: -0.3, tau: 0.4 }; // one-off turn-in while the canvas fades in
const EPS = 0.0004; // radians: below this the turn-in counts as settled
const MAX_PIXELS = 8e6; // drawing-buffer budget; only large high-density displays reach it
// Safety valve for weak graphics chips: while the shot moves, the last `frames` frame gaps are kept; if
// their median is over `slow` ms (under about 40 frames a second), the pixel ratio drops one `step`
// (never below 1), at most `steps` times per visit. A machine that keeps up never trips it.
// A steady cadence near 30 frames a second (`capped`, ms) is the browser's cap (Safari's Low Power Mode,
// a frame in the background), not a weak chip: when nearly all gaps (`steady`) sit in that band, only a
// median slower than the band counts (round 6, S2).
const VALVE = { frames: 30, slow: 24, step: 0.75, steps: 2, capped: [30, 37], steady: 0.8 };
const FOV = 24; // degrees, vertical

// Landmarks on the figure in model units (y unless noted). `top` is the head plus a little air,
// `bottom` a three-quarter crop through the upper drapery, `ink` the lowest stem of the tattoo
// (about hip height), `stem` how far left of the turning axis the stems reach, `sweep` the widest
// the turning figure gets.
const FIGURE = { top: 1.035, bottom: 0.54, ink: 0.6, stem: 0.05, sweep: 0.3 };

// The shot, on the smoothed scroll progress through the pinned stage (0..1).
const SHOT = {
  from: -0.7 * Math.PI, // radians from the back seen square: front three-quarter, the tattoo out of sight
  to: 0.08, // a touch past square, so the raking key light models the shoulder blades
  turn: [0, 0.7], // the half turn leads...
  dolly: [0.14, 0.86], // ...the camera move overlaps it and lands later...
  mark: [0.06, 0.56], // ...the wordmark leaves with the backdrop while the camera pushes in...
  reveal: 0.76, // ...and the line comes in as the close-up lands. From 0.86 on, the frame holds.
  response: 0.32, // seconds: critically damped follower on the scroll, so wheel steps glide
};

// Opening frame, centred under the wordmark. Desktop: the crown at the top of what is visible,
// cropped through the upper drapery at the bottom, narrow enough to turn in the width; where the
// copy reaches in under the figure (narrow windows) she shrinks, by a fifth at most, until her
// hips end `copyGap` px above it. Phones: crown `markGap` px under the wordmark, so it stays
// readable, hips clear of the label and its veil (the line is not there yet).
const OPEN = { sideFill: 0.94, copyGap: 64, markGap: 12, veil: 56, inkGap: 16 };
// Closing frame: the tattoo plus a little air, in model units around the turning axis. Desktop: it
// fills `fill` of the height, right of centre and clear of the copy. Phones: square on the tattoo
// in the band between `phoneTop` and the copy, as wide as the screen allows.
// "Phone" framing is for narrow screens held upright. A phone turned sideways (wide, short) is framed
// like a PC; an upright tablet or window keeps the PC opening but closes on the tattoo the upright way
// (square on it, above the copy), since the PC close-up beside the copy would run off a tall, narrow
// screen. hero-core.css uses the same query for its phone rules.
const PHONE_QUERY = '(max-width: 799px) and (orientation: portrait)';
const CLOSE = { top: 0.895, bottom: 0.585, halfWidth: 0.105, fill: 0.88, minShift: 0.12, minRoom: 0.25, copyGap: 56, edge: 16, phoneTop: 28, phoneCopyGap: 24, phoneMinBand: 0.4 };

// Tattoo projector. It looks at the back along BACK_YAW. "Across" is model units toward the
// viewer's right when looking at the back, measured from the model's Y axis; "up" is model y.
// Landmarks on the figure, in those units: nape 0.875 up, top of the drapery 0.56 up, shoulders
// from -0.07 to 0.15 across, spine from 0.02 across at the waist to 0.045 at the nape.
// Placed like the owner's reference photo: the orchid spans the back from shoulder to shoulder
// (0.24 wide along the surface) and from just under the nape (0.87) to the small of the back
// (0.61), both flowers right of the spine on the shoulder blade, the long stems ending on the spine.
//
// PLACEMENT, the one place to adjust it (a new design is fitted automatically; tune by eye only if
// it looks too big, too small or off-centre). `centre` and `height` describe the drawn area (the
// ink, white margins ignored), whatever its file. Height 0.258 = nape to small of the back; try
// 0.22 to 0.30. Across: + moves it toward her right shoulder as seen from behind (the viewer's
// right), - toward the left; 0.01 is about a finger's width on her. Up: + raises it; the nape is
// at 0.875, so keep centre[1] + height / 2 below about 0.88. Change one number, reload, scroll to
// the close-up, compare. A wide design is shrunk until it is no wider than `maxWidth` (shoulder to
// shoulder), so it never wraps round her sides; the orchid (0.231 wide) is not affected.
const TATTOO = {
  axis: 0.04, // across: the vertical line down the middle of the back that the design wraps around
  centre: [0.0072, 0.7416], // middle of the drawn area: [across from the axis, up]
  height: 0.2576, // of the drawn area on the figure; the width follows from the artwork...
  maxWidth: 0.24, // ...but never wider than this (shoulder to shoulder along the surface)
  roll: 0, // radians, clockwise as seen from behind
  wrap: 0.125, // radius of the cylinder the back is unrolled around (large = flat projection)
  facing: [0.18, 0.4], // cosine between surface and projector over which the ink fades in
  minDepth: -0.03, // only surfaces this far out of the back (from the Y axis) take ink
  strength: 0.88,
  gamma: 0.7, // below 1 lifts the pale pencil shading of the artwork toward ink
  color: [0.1, 0.11, 0.15], // blue-black, display space
  hold: 0.55, // how much of the darkest texel each mip level keeps, so hairlines survive minification
};

// The artwork file (data-tattoo). Nothing about the design is hard-coded: once it has loaded its
// drawn area is found by scanning for ink, with the same rule as site/tools/swap-artwork.py.
const ARTWORK = {
  ink: 224, // a pixel is ink when its darkest channel is below this (0..255)...
  minCount: 2, // ...and a row or column needs this many ink pixels to count (dust, JPEG noise)
  pad: 0.015, // white margin kept around the drawn area in the texture, of its longer side
  // swap-artwork.py sets the padded drawn area at this share of the file's height (the Core hero
  // CSS relies on it too). Only used for the still drawing's size until the pixels have arrived.
  frame: 1264 / 2000,
};

const MARBLE = { color: 0xf6f2ea, roughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.45 };

// Exact step of a critically damped spring (x'' = -w^2 (x - target) - 2 w x') over dt: frame-rate
// independent, never overshoots, and carries its velocity through every retarget.
function follow(x, v, target, dt, omega) {
  const d = x - target;
  const e = Math.exp(-omega * dt);
  const b = v + omega * d;
  return [target + (d + b * dt) * e, (b - omega * (d + b * dt)) * e];
}

// Decoder for the statue models (site/tools/pack_glb.mjs): meshopt vertex codec version 0 and index
// codec, no filters, which is all those files use. Plain JavaScript (no WebAssembly, no extra
// download), adapted from meshoptimizer's reference decoder (MIT, Arseny Kapoulkine, Jasper St. Pierre).
// GLTFLoader calls decodeGltfBuffer through setMeshoptDecoder.
const MESHOPT = {
  supported: true,
  ready: Promise.resolve(),
  decodeGltfBuffer(target, count, size, source, mode, filter) {
    if (filter && filter !== 'NONE') throw new Error('meshopt filter not supported: ' + filter);
    if (mode === 'ATTRIBUTES') decodeVertices(target, count, size, source);
    else if (mode === 'TRIANGLES') decodeTriangles(target, count, size, source);
    else throw new Error('meshopt mode not supported: ' + mode);
  },
};
const dezig = (v) => (v >>> 1) ^ -(v & 1);

function decodeVertices(target, count, stride, src) {
  if (src[0] !== 0xa0) throw new Error('meshopt vertex codec version not supported');
  const blockMax = Math.min((0x2000 / stride) & ~0x0f, 0x100);
  const deltas = new Uint8Array(blockMax * stride);
  const last = src.slice(src.length - stride); // what the first deltas are relative to
  let s = 1;
  for (let base = 0; base < count; base += blockMax) {
    const n = Math.min(count - base, blockMax);
    const groups = (n + 15) >>> 4;
    const headerBytes = (groups + 3) >>> 2;
    deltas.fill(0);
    for (let byte = 0; byte < stride; byte++) {
      const header = s;
      s += headerBytes;
      const row = byte * n;
      for (let g = 0; g < groups; g++) {
        const mode = (src[header + (g >>> 2)] >>> ((g & 3) << 1)) & 3;
        const at = row + (g << 4);
        if (mode === 0) continue; // all 16 deltas are 0
        if (mode === 3) { deltas.set(src.subarray(s, s + 16), at); s += 16; continue; } // stored as is
        const bits = mode === 1 ? 2 : 4; // 2-bit or 4-bit deltas, the top value escapes to a full byte
        const top = (1 << bits) - 1;
        const sel = s;
        s += bits * 2;
        for (let m = 0; m < 16; m++) {
          const shift = bits === 2 ? 6 - ((m & 3) << 1) : 4 - ((m & 1) << 2);
          let d = (src[sel + (bits === 2 ? m >>> 2 : m >>> 1)] >>> shift) & top;
          if (d === top) d = src[s++];
          deltas[at + m] = d;
        }
      }
    }
    for (let e = 0; e < n; e++) {
      const o = (base + e) * stride;
      for (let byte = 0; byte < stride; byte++) {
        const v = (last[byte] + dezig(deltas[byte * n + e])) & 0xff;
        target[o + byte] = last[byte] = v;
      }
    }
  }
  if (s !== src.length - Math.max(stride, 32)) throw new Error('meshopt vertex data is damaged');
}

function decodeTriangles(target, count, stride, src) {
  if (src[0] !== 0xe1 || count % 3) throw new Error('meshopt index codec not supported');
  const dst = stride === 2 ? new Uint16Array(target.buffer, target.byteOffset, count) : new Uint32Array(target.buffer, target.byteOffset, count);
  const edges = new Uint32Array(32);
  const verts = new Uint32Array(16);
  let eAt = 0, vAt = 0;
  const edge = (i) => edges[(eAt - 1 - i) & 31];
  const vert = (i) => verts[(vAt - 1 - i) & 15];
  const pushE = (a, b) => { edges[eAt] = a; edges[(eAt + 1) & 31] = b; eAt = (eAt + 2) & 31; };
  const pushV = (v) => { verts[vAt] = v; vAt = (vAt + 1) & 15; };
  let code = 1, data = 1 + count / 3, next = 0, last = 0;
  const aux = src.length - 16;
  const leb = () => { let n = 0; for (let i = 0; ; i += 7) { const b = src[data++]; n |= (b & 0x7f) << i; if (b < 0x80) return n; } };
  const delta = () => (last += dezig(leb()));
  for (let t = 0, o = 0; t < count / 3; t++) {
    const c0 = src[code++];
    const hi = c0 >>> 4, lo = c0 & 15;
    let a, b, c;
    if (hi < 15) {
      a = edge(hi * 2); b = edge(hi * 2 + 1);
      if (lo === 0) pushV(c = next++);
      else if (lo < 13) c = vert(lo);
      else if (lo === 13) pushV(c = --last);
      else if (lo === 14) pushV(c = ++last);
      else pushV(c = delta());
      pushE(b, c); pushE(c, a);
    } else {
      if (lo < 14) {
        const e = src[aux + lo];
        const z = e >>> 4, w = e & 15;
        a = next++;
        b = z === 0 ? next++ : vert(z - 1);
        c = w === 0 ? next++ : vert(w - 1);
        pushV(a); if (z === 0) pushV(b); if (w === 0) pushV(c);
      } else {
        const e = src[data++];
        if (e === 0) next = 0;
        const z = e >>> 4, w = e & 15;
        a = lo === 14 ? next++ : delta();
        b = z === 0 ? next++ : z === 15 ? delta() : vert(z - 1);
        c = w === 0 ? next++ : w === 15 ? delta() : vert(w - 1);
        pushV(a); if (z === 0 || z === 15) pushV(b); if (w === 0 || w === 15) pushV(c);
      }
      pushE(a, b); pushE(b, c); pushE(c, a);
    }
    dst[o++] = a; dst[o++] = b; dst[o++] = c;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed: ' + url));
    img.src = url;
  });
}

async function loadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('model failed: ' + res.status);
  return res.arrayBuffer();
}

// The drawn area of the artwork as a one-channel texture (255 = bare stone, 0 = full ink) with a
// hand-built mip chain. Plain averaging turns a one-pixel line into pale grey two levels down;
// blending each average toward the darkest of its four texels keeps the linework readable when
// the statue is small, without the shimmer a sharper sampling bias would cause.
// Reads the artwork's pixels and finds its drawn area: the box around every ink pixel (white
// margins trimmed), then `box` = that plus a thin white margin, which becomes the texture.
function readArtwork(image) {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // transparent parts of a png read as paper, not ink
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const rows = new Uint32Array(H);
  const cols = new Uint32Array(W);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      if (Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < ARTWORK.ink) { rows[y]++; cols[x]++; }
    }
  }
  const first = (a) => a.findIndex((n) => n >= ARTWORK.minCount);
  const last = (a) => a.length - 1 - [...a].reverse().findIndex((n) => n >= ARTWORK.minCount);
  const x0 = first(cols);
  const y0 = first(rows);
  if (x0 < 0 || y0 < 0) throw new Error('artwork has no drawing');
  const drawn = { x0, y0, x1: last(cols) + 1, y1: last(rows) + 1 };
  const p = Math.round(ARTWORK.pad * Math.max(drawn.x1 - drawn.x0, drawn.y1 - drawn.y0));
  const box = { x0: drawn.x0 - p, y0: drawn.y0 - p, x1: drawn.x1 + p, y1: drawn.y1 + p };
  return { rgba, W, H, drawn, box };
}

function makeInkTexture(THREE, art, maxAnisotropy) {
  const { rgba, W, H, box } = art;
  let w = box.x1 - box.x0;
  let h = box.y1 - box.y0;
  // One channel (green, as before) of the padded drawn area; the margin past the file's edge is paper.
  let data = new Uint8Array(w * h).fill(255);
  for (let y = Math.max(0, -box.y0); y < h && box.y0 + y < H; y++) {
    for (let x = Math.max(0, -box.x0); x < w && box.x0 + x < W; x++) {
      data[y * w + x] = rgba[((box.y0 + y) * W + box.x0 + x) * 4 + 1];
    }
  }

  const mipmaps = [{ data, width: w, height: h }];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const r0 = Math.min(y * 2, h - 1) * w;
      const r1 = Math.min(y * 2 + 1, h - 1) * w;
      for (let x = 0; x < nw; x++) {
        const c0 = Math.min(x * 2, w - 1);
        const c1 = Math.min(x * 2 + 1, w - 1);
        const p = data[r0 + c0], q = data[r0 + c1], r = data[r1 + c0], s = data[r1 + c1];
        const mean = (p + q + r + s) / 4;
        next[y * nw + x] = mean + (Math.min(p, q, r, s) - mean) * TATTOO.hold;
      }
    }
    data = next;
    w = nw;
    h = nh;
    mipmaps.push({ data, width: w, height: h });
  }

  const texture = new THREE.DataTexture(mipmaps[0].data, mipmaps[0].width, mipmaps[0].height, THREE.RedFormat);
  texture.mipmaps = mipmaps;
  texture.unpackAlignment = 1; // rows are not padded to four bytes
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.needsUpdate = true; // row 0 is the top of the artwork, so v runs downward
  return texture;
}

// Height of the drawn area on the figure for a design `aspect` (drawn width / height) wide.
function tattooHeight(aspect) {
  return aspect > 0 ? Math.min(TATTOO.height, TATTOO.maxWidth / aspect) : TATTOO.height;
}

// Model space -> projector space, plus projector space -> artwork uv.
//   proj * position = (across from the axis, up, how far out of the back), in model units
//   uv * (across, up, 1) = 0..1 over the drawn area, u toward the viewer's right, v downward
function projector(THREE, t, art) {
  const yAxis = new THREE.Vector3(0, 1, 0);
  const out = new THREE.Vector3(0, 0, -1).applyAxisAngle(yAxis, BACK_YAW); // toward the projector
  const right = new THREE.Vector3().crossVectors(out, yAxis).negate(); // viewer's right
  const proj = new THREE.Matrix4().set(
    right.x, 0, right.z, -t.axis,
    0, 1, 0, 0,
    out.x, 0, out.z, 0,
    0, 0, 0, 1,
  );
  // The texture is the padded box; its middle is the drawn area's middle (the margin is even).
  const { drawn, box } = art;
  const fit = tattooHeight((drawn.x1 - drawn.x0) / (drawn.y1 - drawn.y0));
  const h = (fit * (box.y1 - box.y0)) / (drawn.y1 - drawn.y0);
  const w = (h * (box.x1 - box.x0)) / (box.y1 - box.y0);
  const c = Math.cos(t.roll);
  const s = Math.sin(t.roll);
  const [cx, cy] = t.centre;
  // Rotate about the centre by roll, scale to the drawn area, flip v, move the centre to 0.5.
  const uv = new THREE.Matrix3().set(
    c / w, -s / w, 0.5 - (c * cx - s * cy) / w,
    -s / h, -c / h, 0.5 + (s * cx + c * cy) / h,
    0, 0, 1,
  );
  return { out, proj, uv };
}

function makeMarble(THREE, art, maxAnisotropy) {
  const ink = makeInkTexture(THREE, art, maxAnisotropy);
  const p = projector(THREE, TATTOO, art);
  const uniforms = {
    uInk: { value: ink },
    uInkProj: { value: p.proj },
    uInkUv: { value: p.uv },
    uInkOut: { value: p.out },
    uInkColor: { value: new THREE.Vector3().fromArray(TATTOO.color) },
    uInkMask: { value: new THREE.Vector4(TATTOO.facing[0], TATTOO.facing[1], TATTOO.minDepth, TATTOO.wrap) },
    uInkTone: { value: new THREE.Vector2(TATTOO.strength, TATTOO.gamma) },
  };

  const material = new THREE.MeshPhysicalMaterial({ metalness: 0, ...MARBLE });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePos;\nvarying vec3 vStoneNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStonePos = position;\nvStoneNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uInk;
uniform mat4 uInkProj;
uniform mat3 uInkUv;
uniform vec3 uInkOut;
uniform vec3 uInkColor;
uniform vec4 uInkMask;
uniform vec2 uInkTone;
varying vec3 vStonePos;
varying vec3 vStoneNormal;
float stoneHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float stoneNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(stoneHash(i), stoneHash(i + vec3(1, 0, 0)), f.x), mix(stoneHash(i + vec3(0, 1, 0)), stoneHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(stoneHash(i + vec3(0, 0, 1)), stoneHash(i + vec3(1, 0, 1)), f.x), mix(stoneHash(i + vec3(0, 1, 1)), stoneHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// Marble, from model-space position (the mesh has no UVs): a faint cloudiness in the stone and
// in its polish. No veins on purpose; thin grey lines would compete with the fine-line tattoo.
vec3 stoneP = vStonePos * 7.0;
float stoneCloud = stoneNoise(stoneP) * 0.6 + stoneNoise(stoneP * 2.3 + 3.7) * 0.4;
diffuseColor.rgb *= 0.965 + 0.07 * stoneCloud;

// Tattoo: the artwork is projected from behind onto the back and multiplied into the stone.
vec3 inkP = (uInkProj * vec4(vStonePos, 1.0)).xyz;
// The back curves away toward both shoulders. Unrolling it as a cylinder (arc length instead of
// flat distance from the axis) wraps the design around the form like a stencil, so the tendrils
// reach the shoulders at their drawn length instead of running off the silhouette.
float inkX = uInkMask.w * asin(clamp(inkP.x / uInkMask.w, -1.0, 1.0));
vec2 inkUv = (uInkUv * vec3(inkX, inkP.y, 1.0)).xy;
// Fade out where the surface turns away from the projector, in front of the back, and at the
// edge of the drawn area, so there is no seam and nothing lands on the front, hair or drapery.
float inkFacing = dot(normalize(vStoneNormal), uInkOut);
vec2 inkEdge = smoothstep(vec2(0.0), vec2(0.012), inkUv) * smoothstep(vec2(0.0), vec2(0.012), 1.0 - inkUv);
float inkMask = smoothstep(uInkMask.x, uInkMask.y, inkFacing) * smoothstep(0.0, 0.02, inkP.z - uInkMask.z) * inkEdge.x * inkEdge.y;
float inkLine = pow(1.0 - texture2D(uInk, clamp(inkUv, 0.0, 1.0)).r, uInkTone.y);
float inkAmount = inkLine * inkMask * uInkTone.x * (0.92 + 0.16 * stoneCloud); // the stone takes it a little unevenly
vec3 inkTint = mix(vec3(1.0), uInkColor, min(inkAmount, 1.0)); // mixed in display space, so 88% ink reads as 88%
diffuseColor.rgb *= inkTint * inkTint;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor *= 0.9 + 0.2 * stoneCloud;`);
  };
  material.userData.ink = ink;
  material.userData.uniforms = uniforms;
  return material;
}

// Where the still drawing goes in a framing (stage px): the middle of its drawn area on the
// turning axis at the height of the tattoo's middle, and the whole artwork file as tall as it
// would be drawn there for the tattoo to be its size on the figure. Plain maths, no three.js: it
// runs before the library has arrived. `share` = the drawn area's height / the file's height.
function inkOnStage(pose, env, share, fit) {
  return {
    x: env.w / 2 + pose.shiftX,
    y: env.h / 2 - (TATTOO.centre[1] - pose.centerY) * pose.scale,
    h: (fit * pose.scale) / share,
  };
}

async function init(section) {
  const stage = section.querySelector('.hero__stage');
  const canvas = section.querySelector('.hero__canvas');
  const mark = section.querySelector('.wordmark');
  const copy = section.querySelector('.hero__copy');
  const label = copy && copy.querySelector('.label');
  const line = copy && copy.querySelector('.hero__line');
  const modelBase = section.dataset.modelBase;
  const tattooUrl = section.dataset.tattoo;

  const stillImg = section.querySelector('.hero__fallback img');
  if (stillImg && section.__evlAlt == null) section.__evlAlt = stillImg.getAttribute('alt'); // kept for a restart (pageshow)
  const stillAlt = stillImg ? section.__evlAlt : null;
  let dead = false;
  let gl = null;
  let teardown = () => {};
  const goStatic = () => {
    if (dead) return;
    dead = true;
    teardown();
    // The section shrinks from its pinned height to one screen. Once the pin has released, keep
    // what the visitor is reading below it in place; while the stage is pinned, show the still
    // hero where the stage was.
    const y = window.scrollY;
    const top = section.getBoundingClientRect().top + y;
    const tall = section.offsetHeight;
    const released = top + tall - (stage ? stage.offsetHeight : 0);
    // Hand the GPU memory back now; the canvas is hidden from here on.
    if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (mark) mark.style.transform = '';
    copy?.removeAttribute('data-reveal');
    copy?.style.removeProperty('max-width'); // the close-up's narrow-screen hold (layout)
    section.removeAttribute('data-scrolled');
    section.setAttribute('data-3d', 'static');
    if (stillImg && stillAlt != null) stillImg.setAttribute('alt', stillAlt); // described again when the canvas is gone
    stillImg?.style.removeProperty('opacity'); // hidden while loading part-way through the pin (place below)
    stillImg?.style.removeProperty('transition');
    if (stillImg && !stillImg.getAttribute('style')) stillImg.removeAttribute('style');
    const shrink = tall - section.offsetHeight;
    if (!shrink) return;
    // A smooth-scroll glide (motion-core.js "Light", when it has loaded) is still heading for a spot
    // measured on the taller page and would carry the visitor far past it: stop it first, so the
    // jump below stands (R4-4 round 8). Without motion-core there is nothing to stop.
    const lenis = window.__evlLenis;
    if (lenis && typeof lenis.reset === 'function') { try { lenis.reset(); } catch { /* keep the jump */ } }
    if (y > released) window.scrollTo(0, Math.max(0, y - shrink));
    else if (y > top) window.scrollTo(0, top);
  };

  if (!stage || !canvas || !mark || !copy || !label || !line || !modelBase || !tattooUrl) return goStatic();

  // Ask for the context ourselves: three logs a console error when it cannot create one.
  // A software renderer counts as unavailable; the still image serves those visitors better.
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true,
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    gl = null;
  }
  if (!gl) return goStatic();

  // The owner chose to ignore the visitor's reduced-motion setting: the shot always plays.
  section.setAttribute('data-3d', 'loading');

  const listeners = new AbortController();
  const on = (target, type, fn, options) => target.addEventListener(type, fn, { ...options, signal: listeners.signal });
  // iOS Safari drops WebGL contexts under memory pressure (an app switch, the back/forward cache).
  // Ask for it back (preventDefault) and carry on when it is restored: three.js uploads everything
  // again on the next draw. Only if it does not come back within LOST_WAIT of the page being on
  // screen does the still hero take over (round 6, S1).
  let lost = 0; // timer while the context is lost
  const lostTimer = () => {
    clearTimeout(lost);
    lost = document.hidden ? -1 : setTimeout(() => { section.__evlLost = true; goStatic(); }, LOST_WAIT);
  };
  on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); section.__evlContextLost = true; lostTimer(); });
  on(document, 'visibilitychange', () => { if (lost && !document.hidden) lostTimer(); });
  on(canvas, 'webglcontextrestored', () => { clearTimeout(lost); lost = 0; section.__evlContextLost = false; restored(); });
  section.__evlStop = () => { if (!dead) { dead = true; teardown(); } }; // for a restart on a fresh canvas (pageshow)
  let restored = () => {}; // set once the scene exists

  // Layout: the two ends of the camera move, measured from the page. Runs now (before anything
  // has downloaded, for the label and the still drawing) and on every resize.
  const env = { w: 0, h: 0, phone: false };
  let open = { scale: 1, centerY: 0.8, shiftX: 0 };
  let close = { scale: 2, centerY: 0.74, shiftX: 0 };
  let markLift = 0;
  // Drawn area's height / the file's height: estimated from the swap tool's layout until the
  // artwork's pixels are read, then measured.
  let share = ARTWORK.frame / (1 + 2 * ARTWORK.pad);
  let fit = TATTOO.height; // the tattoo's height on the figure (tattooHeight), once the design is read
  const layout = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return false;
    env.w = w;
    env.h = h;
    env.phone = window.matchMedia(PHONE_QUERY).matches;
    const upright = Math.min(h, window.innerHeight) > w;
    // The close-up stands between the copy and the right edge. The label never wraps by itself (the
    // copy is as wide as it), so on a short, narrow screen turned sideways (480x270, iPhone SE at
    // 568x320) it left too little room and the back was pushed off the right edge (R5-6 H1). There
    // the copy is held to the line's width, so the label wraps onto a second line and the back fits.
    copy.style.removeProperty('max-width');
    if (!env.phone && !upright && w - CLOSE.edge - (copy.offsetLeft + copy.offsetWidth + CLOSE.copyGap) < w * CLOSE.minRoom) {
      copy.style.maxWidth = `${line.offsetWidth}px`;
    }
    // Until the close-up lands the label sits where the copy block ends, so the opening frame
    // has no empty slot under it: it is carried down by the line's height plus the gap.
    const drop = line.offsetTop + line.offsetHeight - (label.offsetTop + label.offsetHeight);
    copy.style.setProperty('--drop', `${drop}px`);

    // Height actually on screen at load: the stage starts under the site header, and on phones
    // it is as tall as the large viewport while the URL bar still covers part of it.
    const sectionTop = section.getBoundingClientRect().top + window.scrollY;
    const visible = Math.min(h, window.innerHeight) - (sectionTop < h * 0.3 ? sectionTop : 0);
    const span = FIGURE.top - FIGURE.bottom;
    let scale = Math.min(visible / span, (w * OPEN.sideFill) / FIGURE.sweep);
    if (env.phone || upright) {
      // Upright: the crown `markGap` px under the wordmark, so it stays readable (tablets too, R6-2 T1).
      const headroom = mark.offsetTop + mark.offsetHeight + OPEN.markGap;
      scale = Math.min(scale, (visible - headroom) / span);
      // Phones: the hips end above the label and the veil behind it; tablets: above the copy where it
      // reaches in under her. She shrinks by a fifth at most; on a very short phone she fades into the veil.
      const below = env.phone ? 40 + label.offsetHeight + OPEN.veil : copy.offsetHeight + OPEN.copyGap;
      if (env.phone || copy.offsetLeft + copy.offsetWidth > w / 2 - FIGURE.stem * scale) {
        scale = clamp((visible - below - headroom) / (FIGURE.top - FIGURE.ink), scale * 0.8, scale);
      }
      open = { scale, centerY: FIGURE.top + headroom / scale - h / (2 * scale), shiftX: 0 };
    } else {
      if (copy.offsetLeft + copy.offsetWidth > w / 2 - FIGURE.stem * scale) {
        const clear = (visible - copy.offsetHeight - OPEN.copyGap) / (FIGURE.top - FIGURE.ink);
        scale = clamp(clear, scale * 0.8, scale);
      }
      open = { scale, centerY: FIGURE.top - h / (2 * scale), shiftX: 0 };
    }

    const tight = CLOSE.top - CLOSE.bottom;
    if (env.phone || upright) {
      const screen = Math.min(h, window.innerHeight);
      // The band ends the measured copy height plus a gap above the bottom (long or translated
      // copy pushes it up), but keeps at least `phoneMinBand` of the screen for the tattoo.
      const below = 40 + copy.offsetHeight + CLOSE.phoneCopyGap;
      const band = Math.max(screen * CLOSE.phoneMinBand, screen - below - CLOSE.phoneTop);
      const s = Math.min(band / tight, (w / 2 - 4) / CLOSE.halfWidth);
      const mid = CLOSE.phoneTop + band / 2; // stage px where the middle of the tattoo sits
      close = { scale: s, centerY: (CLOSE.top + CLOSE.bottom) / 2 - (h / 2 - mid) / s, shiftX: 0 };
    } else {
      // As tall as `fill` allows, but the tattoo must also fit between the copy and the right edge
      // (a phone turned sideways is short and narrow, so the copy takes much of the width).
      const room = Math.min(w - CLOSE.edge - (copy.offsetLeft + copy.offsetWidth + CLOSE.copyGap), w * (1 - 2 * CLOSE.minShift) - 2 * CLOSE.edge);
      const s = Math.min((h * CLOSE.fill) / tight, Math.max(room, w * CLOSE.minRoom) / (2 * CLOSE.halfWidth));
      const clearCopy = copy.offsetLeft + copy.offsetWidth + CLOSE.copyGap + CLOSE.halfWidth * s - w / 2;
      // Never past the right edge: on a screen too small even for the wrapped copy the back keeps
      // its minimum size and comes in over the copy rather than leaving the screen.
      const onScreen = w / 2 - CLOSE.edge - CLOSE.halfWidth * s;
      close = { scale: s, centerY: (CLOSE.top + CLOSE.bottom) / 2, shiftX: Math.min(Math.max(w * CLOSE.minShift, clearCopy), Math.max(onScreen, 0)) };
    }
    markLift = mark.offsetTop + mark.offsetHeight + 24; // far enough to leave the frame

    // The still drawing, on her torso in the opening frame: centred on the turning axis, at the
    // height and size the tattoo has on her back. She faces the viewer there, so the marble
    // covers the drawing as the canvas fades in, and the design turns out to be on her back as
    // she turns away. On wide screens the wordmark (sized by the width) reaches down past her
    // nape; there the drawing starts `inkGap` px under it and ends where it would, a little
    // smaller (by half at most), so it is never drawn into the letters while it waits.
    const ink = inkOnStage(open, env, share, fit);
    const drawn = ink.h * share;
    let bottom = ink.y + drawn / 2;
    // Sideways phones (R6-2 P1): clear of the label, right of it, and on screen.
    if (!env.phone) {
      const across = ink.h * ((stillImg && stillImg.naturalWidth / stillImg.naturalHeight) || 0.707) * 0.78 / 2;
      const foot = Math.min(h, window.innerHeight - sectionTop) - 16; // screen bottom at the top of the page
      const labelTop = foot - 24 - copy.offsetHeight + label.offsetTop + drop;
      const labelRight = copy.offsetLeft + label.offsetLeft + label.offsetWidth;
      if (bottom > labelTop - OPEN.inkGap && ink.x - across < labelRight + OPEN.inkGap) {
        ink.x = Math.max(ink.x, Math.min(labelRight + OPEN.inkGap + across, w - CLOSE.edge - across));
        bottom = Math.min(bottom, foot);
      }
    }
    const top = clamp(mark.offsetTop + mark.offsetHeight + OPEN.inkGap, ink.y - drawn / 2, bottom - drawn / 2);
    ink.y = (top + bottom) / 2;
    ink.h *= (bottom - top) / drawn;
    section.style.setProperty('--ink-x', `${Math.round(ink.x)}px`);
    section.style.setProperty('--ink-y', `${Math.round(ink.y)}px`);
    section.style.setProperty('--ink-h', `${Math.round(ink.h)}px`);
    section.setAttribute('data-ink', '');
    return true;
  };
  layout();

  // The wordmark rides the backdrop up and out while the camera pushes in, and the line comes in
  // as the close-up lands: both at progress s through the pin. The frame loop calls this with its
  // smoothed progress; before the canvas is live it follows the scroll position directly.
  let lift = NaN;
  let revealed = null;
  const place = (s) => {
    const y = Math.round(-markLift * smoothstep(SHOT.mark, s) * 10) / 10;
    if (y !== lift) { lift = y; mark.style.transform = y ? `translate3d(0, ${y}px, 0)` : ''; }
    const show = s > SHOT.reveal;
    if (show !== revealed) { revealed = show; copy.toggleAttribute('data-reveal', show); }
  };
  // While loading: a page opened part-way through the pin (reload, Back with the scroll restored)
  // shows the wordmark where that point of the shot has it, and the still drawing, which sits on
  // her torso in the opening frame only, steps aside, so the canvas fades in over a frame that
  // already matches (R4-4 round 8). At the top of the page nothing changes.
  let live = false;
  let stillAway = false; // the visitor has scrolled on and the still drawing has stepped aside
  const early = () => {
    if (live || dead) return;
    const range = section.offsetHeight - stage.clientHeight;
    const p = range > 0 ? clamp(-section.getBoundingClientRect().top / range, 0, 1) : 0;
    place(p);
    const away = p > SHOT.mark[0];
    stillAway = away;
    if (!stillImg) return;
    if (away) stillImg.style.transition = 'opacity 200ms ease';
    if (away !== (stillImg.style.opacity === '0')) stillImg.style.opacity = away ? '0' : '';
  };
  early();
  on(window, 'scroll', early, { passive: true }); // a restored scroll position arrives after load

  // Until the canvas is live, resizes only move the label and the drawing; after that they also
  // resize the renderer (in the next frame).
  let resized = () => { layout(); early(); };
  const ro = new ResizeObserver(() => resized());
  ro.observe(stage);
  ro.observe(section);
  ro.observe(copy); // the copy changes height when the web font arrives or the text is edited
  teardown = () => { clearTimeout(lost); listeners.abort(); ro.disconnect(); };

  let THREE, gltf, image, art, giveUp;
  try {
    // The model: by memory, screen and, where the browser tells (not Safari), the connection. A phone
    // held sideways (wide but short) gets the phone model too. Data Saver or a very slow connection
    // gets the light one; on 3G a PC-sized screen gets the phone one.
    const memory = navigator.deviceMemory || 8;
    const net = navigator.connection || {};
    const crawl = net.saveData === true || /^(slow-2g|2g)$/.test(net.effectiveType || '');
    const small = window.innerWidth < 800 || window.innerHeight < 500 || net.effectiveType === '3g';
    const file = memory <= 2 || crawl ? MODELS.lite : small || memory <= 4 ? MODELS.phone : MODELS.full;
    const base = new URL(modelBase.replace(/\/?$/, '/'), document.baseURI);
    const modelUrl = new URL(file, base).href;
    let loaders, buffer;
    // Library, model and artwork download in parallel.
    [THREE, loaders, buffer, image] = await Promise.race([
      Promise.all([
        import(THREE_URL),
        import(LOADER_URL),
        loadBuffer(modelUrl),
        loadImage(new URL(tattooUrl, document.baseURI).href),
      ]),
      new Promise((_, reject) => {
        const start = performance.now();
        const check = () => {
          const t = performance.now() - start;
          if (dead || t >= LOAD_PATIENCE || (t >= LOAD_TIMEOUT && stillAway)) reject(new Error('timed out'));
          else giveUp = setTimeout(check, 250);
        };
        giveUp = setTimeout(check, LOAD_TIMEOUT);
      }),
    ]);
    clearTimeout(giveUp);
    const loader = new loaders.GLTFLoader();
    loader.setMeshoptDecoder(MESHOPT); // the models are meshopt-packed (tools/pack_glb.mjs)
    gltf = await loader.parseAsync(buffer, base.href);
    if (dead) return;
    art = readArtwork(image);
    share = (art.drawn.y1 - art.drawn.y0) / art.H;
    fit = tattooHeight((art.drawn.x1 - art.drawn.x0) / (art.drawn.y1 - art.drawn.y0));
    layout(); // the still drawing at its measured size
  } catch {
    clearTimeout(giveUp);
    return goStatic();
  }
  if (dead) return; // context lost while loading

  // Lost while loading: wait for it to come back (the timer above gives up if it does not).
  if (gl.isContextLost()) await new Promise((resolve) => { restored = resolve; });
  restored = () => {};
  if (dead) return;

  let renderer, material, geometry;
  const dispose = () => {
    if (geometry) geometry.dispose();
    if (material) { material.userData.ink.dispose(); material.dispose(); }
    if (renderer) renderer.dispose();
  };

  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10); // looks down -Z from wherever the pose puts it
    const tan = Math.tan((FOV * Math.PI) / 360);

    // Studio lighting. The camera only ever moves along its own axes (dolly, crane, lens shift),
    // so the light reads the same on the form at every point of the shot.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d3cc, 0.35);
    const key = new THREE.DirectionalLight(0xfff3e4, 3.0); // warm key raking across from the left, so the back models
    key.position.set(-2.6, 1.6, 0.4);
    const fill = new THREE.DirectionalLight(0xdbe6ff, 0.55); // cool fill, low right
    fill.position.set(2.2, 0.3, 1.2);
    const rim = new THREE.DirectionalLight(0xffffff, 3.0); // rim from behind
    rim.position.set(1.4, 1.4, -2.0);
    scene.add(hemi, key, fill, rim);

    gltf.scene.traverse((o) => { if (o.isMesh && !geometry) geometry = o.geometry; });
    if (!geometry) throw new Error('no mesh in model');
    material = makeMarble(THREE, art, renderer.capabilities.getMaxAnisotropy());
    const statue = new THREE.Mesh(geometry, material);
    statue.position.set(-PIVOT.x, 0, -PIVOT.z);
    const turntable = new THREE.Group();
    turntable.add(statue);
    scene.add(turntable);

    let range = 1; // scroll distance over which the stage stays pinned
    let ratioCap = Infinity; // lowered by the safety valve (VALVE) on a chip that cannot keep up
    const resize = () => {
      if (!layout()) return;
      range = section.offsetHeight - env.h;
      // Device pixel ratio, capped at 2 and by a pixel budget (a 5K display would otherwise
      // allocate half a gigabyte of multisampled buffers for a figure that fills a fifth of it).
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (env.w * env.h)), ratioCap));
      renderer.setSize(env.w, env.h, false);
    };

    // The shot at smoothed progress s.
    const pose = (s) => {
      const turn = smoothstep(SHOT.turn, s);
      const cam = smoothstep(SHOT.dolly, s);
      return {
        angle: BACK_ANGLE + lerp(SHOT.from, SHOT.to, turn),
        // Dolly in log space, so the push-in reads as one steady speed rather than a lurch at the end.
        scale: open.scale * Math.pow(close.scale / open.scale, cam),
        centerY: lerp(open.centerY, close.centerY, cam),
        shiftX: lerp(open.shiftX, close.shiftX, cam),
      };
    };
    const apply = (q) => {
      const distance = env.h / (2 * q.scale * tan);
      turntable.rotation.y = q.angle;
      camera.near = Math.max(0.05, distance - 1);
      camera.far = distance + 1;
      camera.position.set(0, q.centerY, distance);
      camera.setViewOffset(env.w, env.h, -q.shiftX, 0, env.w, env.h); // also updates the projection
    };

    // Fraction of the pinned scroll: (scrollY - sectionTop) / (sectionHeight - stageHeight).
    const progress = () => (range > 0 ? clamp(-section.getBoundingClientRect().top / range, 0, 1) : 0);

    let raf = 0;
    let last = 0;
    let onScreen = false;
    let needsResize = false;
    let snap = false;
    let s = progress(); // smoothed progress and its velocity
    let sv = 0;
    let intro = INTRO.angle;
    let drawn = '';

    // Safety valve (VALVE): the gaps between frames while the scroll moves the shot. A slow median
    // lowers the pixel ratio one step through resize() in the next frame. A resize's own cost shows in
    // the gaps around it, so those are left out.
    const gaps = [];
    let valveSteps = 0;
    let quiet = 0;
    const watch = (gap) => {
      if (quiet) { quiet--; return; }
      if (gap < 4) return; // two callbacks in one display frame: not a frame gap
      gaps.push(gap);
      if (gaps.length > VALVE.frames) gaps.shift();
      if (gaps.length < VALVE.frames) return;
      const median = [...gaps].sort((a, b) => a - b)[VALVE.frames >> 1];
      if (median <= VALVE.slow) return;
      const [lo, hi] = VALVE.capped;
      if (median <= hi && gaps.filter((g) => g >= lo && g <= hi).length >= gaps.length * VALVE.steady) return; // a 30 fps cap
      gaps.length = 0;
      const current = renderer.getPixelRatio();
      const next = Math.max(1, current * VALVE.step);
      if (next >= current) { valveSteps = VALVE.steps; return; } // already at 1: nothing left to lower
      ratioCap = next;
      valveSteps++;
      needsResize = true;
    };

    const frame = (now) => {
      raf = 0;
      if (dead || !onScreen || document.hidden || gl.isContextLost()) { last = 0; return; }
      const gap = last ? now - last : 0; // ms since the previous frame of this run (0 on the first)
      const dt = gap ? clamp(gap / 1000, 0, 0.05) : 1 / 60;
      last = now;
      if (needsResize) { resize(); needsResize = false; drawn = ''; gaps.length = 0; quiet = 2; }

      const p = progress();
      if (snap) { s = p; sv = 0; snap = false; }
      else [s, sv] = follow(s, sv, p, dt, TAU / SHOT.response);
      const still = Math.abs(s - p) < 1e-4 && Math.abs(sv) < 1e-3;
      if (still) { s = p; sv = 0; }
      // Only frames the scroll is moving count (the one-off turn-in plays while the page is still loading).
      else if (gap && valveSteps < VALVE.steps) watch(gap);
      intro *= Math.exp(-dt / INTRO.tau);
      if (Math.abs(intro) < EPS) intro = 0;

      const q = pose(s);
      q.angle += intro;
      // Past the end of the move (the held close-up) the frame does not change: skip the draw.
      const key = `${q.angle.toFixed(5)} ${q.scale.toFixed(2)} ${q.centerY.toFixed(5)} ${q.shiftX.toFixed(2)}`;
      if (key !== drawn) {
        drawn = key;
        apply(q);
        renderer.render(scene, camera);
      }

      place(s);
      section.toggleAttribute('data-scrolled', p > 0.02);

      if (!still || intro) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (dead || raf || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      // Coming back on screen (a jump to the footer and back, say): nobody saw the move in
      // between, so pick up at the scroll position instead of animating to catch up.
      if (visible && !onScreen) snap = true;
      onScreen = visible;
      wake();
    });
    restored = () => { drawn = ''; snap = true; wake(); }; // redraw at the scroll position
    teardown = () => {
      clearTimeout(lost);
      listeners.abort();
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      dispose();
    };

    // First frame before anything is shown, then cross-fade the canvas in over the drawing.
    resize();
    s = progress();
    apply({ ...pose(s), angle: pose(s).angle + intro });
    // Compile off the main thread where the browser can; elsewhere (Safari) compileAsync would
    // only log a warning about the missing extension, and the first render compiles anyway.
    if (renderer.compileAsync && gl.getExtension('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    if (dead) return;
    s = progress(); // the visitor may have scrolled while it compiled
    apply({ ...pose(s), angle: pose(s).angle + intro });
    renderer.render(scene, camera);
    // The page around the canvas matches this first frame before it fades in (the wordmark and the
    // line as the frame loop would place them), so nothing jumps a frame later.
    live = true;
    place(s);
    section.toggleAttribute('data-scrolled', s > 0.02);
    section.setAttribute('data-3d', 'ready');
    stillImg?.setAttribute('alt', ''); // the canvas (role=img) carries the description now; hear it once

    resized = () => { needsResize = true; wake(); };
    io.observe(section);
    on(window, 'scroll', wake, { passive: true }); // only wakes the loop; position is read in the frame
    on(document, 'visibilitychange', wake);
  } catch {
    dispose();
    goStatic();
  }
}

document.querySelectorAll('.hero--3d[data-model-base]').forEach((section) => { init(section); });

// Back from the back/forward cache after the context was lost for good: start again on a fresh
// canvas, keeping what the visitor sees in place (round 6, S1).
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  document.querySelectorAll('.hero--3d[data-model-base]').forEach((section) => {
    // Still waiting for a lost context (it went in the cache that way), or given up on it earlier.
    const waiting = section.__evlContextLost && section.getAttribute('data-3d') !== 'static';
    if (!waiting && !(section.__evlLost && section.getAttribute('data-3d') === 'static')) return;
    if (waiting) section.__evlStop?.(); // stops quietly: the tall stage stays, so nothing moves
    section.__evlLost = false;
    section.__evlContextLost = false;
    const old = section.querySelector('.hero__canvas');
    if (old) old.replaceWith(old.cloneNode(false)); // a new canvas gets a new context
    const y = window.scrollY;
    const top = section.getBoundingClientRect().top + y;
    const tall = section.offsetHeight;
    init(section); // sets data-3d="loading" (the tall stage) before its first wait
    const grow = section.offsetHeight - tall;
    // Scrolled into or past the one-screen still hero: the page below stays where it was, and the
    // stage shows the end of the shot (the reverse of goStatic's jump).
    if (grow > 0 && y > top) window.scrollTo(0, y + grow);
  });
});
