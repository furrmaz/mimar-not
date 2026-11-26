import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { BuildingLayout } from "../geometry/layout";
import { buildModel, type ModelOptions } from "../geometry/model3d";
import type { Program } from "../shared/schema";
import { sitePool, zoningCheck } from "../geometry/zoning";
import { saveOutput } from "../store";
import { RenderDialog, type RenderCapture } from "./RenderDialog";
import { aspectValue, nearestAspect, type CameraInfo } from "../shared/render";
import { FACING_NAMES, MONTHS, facingFromText, sunAngles, sunVector, type Facing } from "../geometry/sun";
import { FURNITURE_CATALOG, furnishFloor, furnitureKey, furnitureLabel, newFurniture, roomSig, rotateFurniture, type Furniture, type FurnitureKind } from "../geometry/furniture";
import { INTERIOR_STYLES, effectiveInteriorStyle, interiorStyle } from "../geometry/interior";
import { InteriorPanel } from "./InteriorPanel";
import { freeNear, walkObstacles, walkSpawn, walkBlocked, type WalkWorld } from "../geometry/walk";

type Mode = "dis" | "duzen" | "gezi";

export function ThreeView({ layout, program, refImages = [], onSettings, viewer = false, onChange }: { layout: BuildingLayout; program: Program; refImages?: string[]; onSettings?: () => void; /** Müşteri görünümü: render ve dışa aktarma düğmeleri gizlenir */ viewer?: boolean; /** İç mekân düzenlemesini projeye yazar (yoksa düzenleme kapalı) */ onChange?: (p: Program) => void }) {
  const [rendering, setRendering] = useState(false);
  /** dis: dış görünüm (yörünge), duzen: iç mekân düzenleme (seçili kat, kesik), gezi: birinci şahıs gezinti */
  const [mode, setMode] = useState<Mode>("dis");
  const groundLevel = (layout.floors.find((f) => f.z >= 0) ?? layout.floors[0]).level;
  const [level, setLevel] = useState<number>(groundLevel);
  const floor = layout.floors.find((f) => f.level === level) ?? layout.floors[0];
  const [sel, setSel] = useState<string | null>(null);
  /** İç mekân denetim / aydınlatma paneli */
  const [panel, setPanel] = useState(true);
  const styleId = effectiveInteriorStyle(program);
  const items = useMemo(() => furnishFloor(floor), [floor]);
  const selItem = items.find((f) => f.id === sel) ?? null;
  const canEdit = !viewer && !!onChange;
  /** Gezinti durumu (her karede okunur) */
  const walk = useRef({ x: 0, z: 0, yaw: 0, pitch: 0, keys: new Set<string>(), joy: { x: 0, y: 0 }, last: 0, world: null as WalkWorld | null, floorZ: 0 });
  /** Olay dinleyicilerinin okuduğu güncel durum */
  const live = useRef({ mode, level, items, sel, lastClick: null as { x: number; y: number } | null, commit: (_: Furniture[]) => {}, select: (_: string | null) => {} });
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; model: THREE.Group | null;
    composer: EffectComposer; gtao: GTAOPass; sky: Sky; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; envReal: THREE.Texture; real: boolean;
    fill: THREE.AmbientLight; marker: THREE.BoxHelper | null;
  } | null>(null);
  const [opts, setOpts] = useState<ModelOptions>({ showRoof: true, maxLevel: null, cutaway: false, realistic: true });
  /** Güneş çalışması: ay ve saate göre gölge (kapalıyken sabit sunum ışığı) */
  const [sun, setSun] = useState<{ on: boolean; facing: Facing; month: number; hour: number }>(() => ({ on: false, facing: facingFromText(program.site?.orientation), month: 6, hour: 13 }));

  // Sahne kurulumu (bir kez)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f5);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8c4a0, 1.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-18, 30, -22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
    scene.add(sun);
    scene.add(sun.target);

    // Gökyüzü + ondan üretilen çevre yansıması (gerçekçi görünüm)
    const sky = new Sky();
    sky.scale.setScalar(1500);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    // güneş: ön cepheden (sokak, -z) ve hafif yandan, öğleden sonra
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));
    u.sunPosition.value.copy(sunDir);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1500);
    Object.assign(skyCopy.material.uniforms.sunPosition.value, sunDir);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"] as const) skyCopy.material.uniforms[k].value = u[k].value;
    skyScene.add(skyCopy);
    const envReal = pmrem.fromScene(skyScene, 0, 0.1, 2000).texture;
    sun.userData.dir = sunDir;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.2 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    // iç mekân dolgu ışığı (gezinti ve düzenlemede açılır)
    const fill = new THREE.AmbientLight(0xfff4e6, 0);
    scene.add(fill);
    ctx.current = { renderer, scene, camera, controls, model: null, composer, gtao, sky, sun, hemi, envReal, real: false, fill, marker: null };
    (window as unknown as { __mn3d?: unknown }).__mn3d = ctx.current; // test ve hata ayıklama için
    (window as unknown as { __mnwalk?: unknown }).__mnwalk = walk.current;

    // ---- işaretçi olayları: düzenlemede mobilya seç/sürükle, gezintide bakış
    const ray = new THREE.Raycaster();
    const ndc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const furnGroups = () => {
      const out: THREE.Object3D[] = [];
      ctx.current?.model?.traverse((o) => { if (o.name === "Mobilya" && o.userData.level === live.current.level) out.push(...o.children); });
      return out;
    };
    const planeHit = (e: PointerEvent, y: number) => {
      ray.setFromCamera(ndc(e), camera);
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
    };
    let drag: { g: THREE.Object3D; off: THREE.Vector3; y: number; moved: boolean; id: string } | null = null;
    let look: { id: number; x: number; y: number } | null = null;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const L = live.current;
      down = { x: e.clientX, y: e.clientY };
      if (L.mode === "gezi") {
        look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
      if (L.mode !== "duzen") return;
      ray.setFromCamera(ndc(e), camera);
      const hits = ray.intersectObjects(furnGroups(), true);
      if (!hits.length) return;
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o.userData.furnId == null) o = o.parent;
      if (!o) return;
      const id = o.userData.furnId as string;
      L.select(id);
      const y = o.position.y;
      const p = planeHit(e, y);
      if (!p) return;
      drag = { g: o, off: p.sub(o.position), y, moved: false, id };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (look && e.pointerId === look.id) {
        const w = walk.current;
        w.yaw -= (e.clientX - look.x) * 0.005;
        w.pitch = Math.max(-1.2, Math.min(1.2, w.pitch - (e.clientY - look.y) * 0.005));
        look.x = e.clientX; look.y = e.clientY;
        return;
      }
      if (!drag) return;
      const p = planeHit(e, drag.y);
      if (!p) return;
      p.sub(drag.off);
      drag.g.position.x = Math.round(p.x / 0.05) * 0.05;
      drag.g.position.z = Math.round(p.z / 0.05) * 0.05;
      drag.moved = true;
      if (ctx.current?.marker) ctx.current.marker.update();
    };
    const onUp = (e: PointerEvent) => {
      const L = live.current;
      if (look && e.pointerId === look.id) look = null;
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
      if (drag) {
        const d = drag;
        drag = null;
        controls.enabled = true;
        if (d.moved) {
          const next = L.items.map((f) => (f.id === d.id ? { ...f, x: +(d.g.position.x - f.w / 2).toFixed(3), y: +(d.g.position.z - f.h / 2).toFixed(3) } : f));
          L.commit(next);
        }
      } else if (click && L.mode === "duzen") {
        // boşa tıklama: seçimi kaldır; tıklanan nokta yeni parçanın yeri olur
        const fz = layoutRef.current.floors.find((f) => f.level === L.level)?.z ?? 0;
        const p = planeHit(e, fz);
        if (p) L.lastClick = { x: p.x, y: p.z };
        L.select(null);
      }
      down = null;
    };
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", onDown, { capture: true });
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.style.touchAction = "none";
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(t.tagName);
    const onKey = (e: KeyboardEvent) => {
      if (live.current.mode !== "gezi" || isField(e.target)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.type === "keydown") { walk.current.keys.add(k); if (k.startsWith("Arrow") || k === " ") e.preventDefault(); }
      else walk.current.keys.delete(k);
    };
    const clearKeys = () => walk.current.keys.clear();
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clearKeys);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = (t: number) => {
      const w = walk.current;
      if (live.current.mode === "gezi" && w.world) {
        const dt = Math.min(0.1, w.last ? (t - w.last) / 1000 : 0);
        w.last = t;
        const K = w.keys;
        const run = K.has("Shift") ? 2.4 : 1;
        let fwd = (K.has("w") || K.has("ArrowUp") ? 1 : 0) - (K.has("s") || K.has("ArrowDown") ? 1 : 0) - w.joy.y;
        let str = (K.has("d") ? 1 : 0) - (K.has("a") ? 1 : 0) + w.joy.x;
        const turn = (K.has("ArrowLeft") || K.has("q") ? 1 : 0) - (K.has("ArrowRight") || K.has("e") ? 1 : 0);
        w.yaw += turn * 1.8 * dt;
        const len = Math.hypot(fwd, str);
        if (len > 1) { fwd /= len; str /= len; }
        const sp = 1.5 * run * dt;
        const dx = (-Math.sin(w.yaw) * fwd + Math.cos(w.yaw) * str) * sp;
        const dz = (-Math.cos(w.yaw) * fwd - Math.sin(w.yaw) * str) * sp;
        if (dx || dz) {
          const stuck = walkBlocked(w.world, w.x, w.z);
          const ok = (x: number, z: number) => stuck || !walkBlocked(w.world!, x, z);
          if (ok(w.x + dx, w.z + dz)) { w.x += dx; w.z += dz; }
          else if (ok(w.x + dx, w.z)) w.x += dx;
          else if (ok(w.x, w.z + dz)) w.z += dz;
        }
        camera.position.set(w.x, w.floorZ + 1.6, w.z);
        camera.rotation.set(w.pitch, w.yaw, 0, "YXZ");
      } else {
        w.last = 0;
        controls.update();
      }
      if (ctx.current?.real) composer.render();
      else renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("pointerdown", onDown, { capture: true });
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", clearKeys);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /** Düzenlemeyi projeye yaz (items: o katın tam listesi; null = otomatik yerleşime dön) */
  const commit = (lv: number, next: Furniture[] | null) => {
    if (!onChange) return;
    const fl = layout.floors.find((f) => f.level === lv);
    if (!fl) return;
    const key = furnitureKey(program.blockIndex, lv);
    const all = { ...(program.design?.furniture ?? {}) };
    if (next) all[key] = { sig: roomSig(fl), items: next };
    else delete all[key];
    onChange({ ...program, design: { ...program.design, furniture: all } });
  };
  live.current.mode = mode;
  live.current.level = level;
  live.current.items = items;
  live.current.sel = sel;
  live.current.commit = (next) => commit(level, next);
  live.current.select = setSel;

  // Gezinti dünyası (kat ya da mobilya değişince)
  useEffect(() => {
    const w = walk.current;
    if (mode !== "gezi") { w.world = null; return; }
    const prev = w.world;
    w.world = walkObstacles(layout, floor, items);
    w.floorZ = floor.z;
    // ilk girişte ya da duvarın içinde kalınca başlangıç noktası
    if (!prev || walkBlocked(w.world, w.x, w.z)) {
      const s = walkSpawn(w.world, floor);
      w.x = s.x; w.z = s.y; w.yaw = s.yaw; w.pitch = -0.05;
    }
  }, [mode, floor, items, layout]);

  // Kamera: gezintide geniş açı, diğerlerinde yörünge
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.camera.fov = mode === "gezi" ? 70 : 40;
    c.camera.near = mode === "gezi" ? 0.05 : 0.1;
    c.camera.updateProjectionMatrix();
    c.controls.enabled = mode !== "gezi";
    if (mode === "duzen") {
      // seçili katın üstünden eğik bakış
      const W = layout.W, D = layout.D, r = Math.max(W, D);
      c.camera.position.set(W / 2 + r * 0.25, floor.z + r * 1.05, D / 2 + r * 0.75);
      c.controls.target.set(W / 2, floor.z, D / 2);
      c.camera.up.set(0, 1, 0);
    } else if (mode === "dis") placeOrbit();
    if (mode !== "duzen") setSel(null);
  }, [mode, level]);

  // Kamerayı binaya göre yerleştir (yerleşim değişince)
  useEffect(() => { if (mode === "dis") placeOrbit(); }, [layout.W, layout.D, layout.totalHeight, program.blockIndex, program.blocks?.length]);
  function placeOrbit() {
    const c = ctx.current;
    if (!c) return;
    let x0 = 0, y0 = 0, x1 = layout.W, y1 = layout.D;
    const z = program.blocks?.length ? zoningCheck(program, layout) : null;
    if (z?.blocks) {
      x0 = Math.min(...z.blocks.map((b) => b.x)) - z.building.x; x1 = Math.max(...z.blocks.map((b) => b.x + b.L.W)) - z.building.x;
      y0 = Math.min(...z.blocks.map((b) => b.y)) - z.building.y; y1 = Math.max(...z.blocks.map((b) => b.y + b.L.D)) - z.building.y;
    }
    const W = x1 - x0, D = y1 - y0;
    const H = layout.totalHeight + layout.roofHeight;
    const r = Math.max(W, D, H) * (z?.blocks ? 1.05 : 1.35);
    c.camera.position.set(x0 + W / 2 + r * 0.75, H * 0.9 + r * 0.45, y0 - r * 0.85);
    c.controls.target.set(x0 + W / 2, H * 0.35, y0 + D / 2);
  }

  /** Görünüm moduna göre model seçenekleri */
  const eff: ModelOptions =
    mode === "duzen" ? { ...opts, maxLevel: level, cutaway: true, showRoof: false, interiorStyle: styleId }
    : mode === "gezi" ? { ...opts, maxLevel: null, cutaway: false, showRoof: true, furniture: true, interiorStyle: styleId, lights: true }
    : { ...opts, interiorStyle: styleId };

  // Modeli yeniden kur
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.model) {
      c.scene.remove(c.model);
      c.model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const z = zoningCheck(program, layout);
    const ground = layout.floors.find((f) => f.z >= 0) ?? layout.floors[0];
    const ent = ground.openings.find((o) => o.kind === "entrance" && o.width < 2);
    const entranceX = ent ? (ent.orient === "h" ? ent.center : ent.line) : undefined;
    const others = (z.blocks ?? []).filter((b) => b.index !== (program.blockIndex ?? 0));
    const avoid = others.map((b) => ({ x: b.x - z.building.x, y: b.y - z.building.y, w: b.L.W, d: b.L.D }));
    const sp = sitePool(program, layout, z);
    const pool = sp ? { x: sp.x - z.building.x, y: sp.y - z.building.y, w: sp.w, h: sp.h } : null;
    const model = buildModel(layout, { ...eff, materials: program.materials, facade: program.facade, entranceX, avoid, pool }, { width: program.site.width, depth: program.site.depth, offsetX: z.building.x, offsetY: z.building.y });
    // çok bloklu: diğer bloklar da arsada
    for (const b of others) {
      const m = buildModel(b.L, { ...eff, furniture: false, materials: program.materials, facade: program.facade });
      m.name = b.name;
      m.position.set(b.x - z.building.x, 0, b.y - z.building.y);
      model.add(m);
    }
    c.scene.add(model);
    c.model = model;
    // görünüm modu
    const real = !!opts.realistic;
    c.real = real;
    c.renderer.toneMapping = real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    c.renderer.toneMappingExposure = real ? 0.68 : 1;
    c.scene.environmentIntensity = real ? 0.18 : 0.55;
    c.scene.environment = real ? c.envReal : null;
    c.scene.background = real ? null : new THREE.Color(0xeef2f5);
    if (real && !c.sky.parent) c.scene.add(c.sky);
    if (!real && c.sky.parent) c.scene.remove(c.sky);
    c.hemi.intensity = real ? 0.1 : 1.1;
    c.sun.intensity = real ? 5 : 2.0;
    const fixed = c.sun.userData.dir as THREE.Vector3;
    const dir = sun.on ? new THREE.Vector3(...sunVector(sun.month, sun.hour, sun.facing)) : real ? fixed : new THREE.Vector3(-0.45, 0.75, -0.55).normalize();
    const center = new THREE.Vector3(layout.W / 2, 0, layout.D / 2);
    c.sun.position.copy(center).addScaledVector(dir, 60);
    c.sun.target.position.copy(center);
    c.sky.material.uniforms.sunPosition.value.copy(sun.on ? dir : fixed);
    // iç mekânda dolgu ışığı: gölgedeki odalar kararmasın
    c.fill.intensity = mode === "gezi" ? (real ? 1.6 : 0.7) : mode === "duzen" ? (real ? 0.6 : 0.3) : 0;
    if (mode === "gezi") c.hemi.intensity = real ? 0.5 : 1.3;
  }, [layout, opts, program, sun, mode, level]);

  // Seçili mobilyanın çerçevesi
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.marker) { c.scene.remove(c.marker); c.marker.dispose(); c.marker = null; }
    if (mode !== "duzen" || !sel || !c.model) return;
    let g: THREE.Object3D | null = null;
    c.model.traverse((o) => { if (o.userData.furnId === sel && o.parent?.userData.level === level) g = o; });
    if (!g) return;
    c.marker = new THREE.BoxHelper(g, 0xf59e0b);
    c.scene.add(c.marker);
  });

  const editItems = (fn: (list: Furniture[]) => Furniture[]) => commit(level, fn(items));
  const rotateSel = () => selItem && editItems((l) => l.map((f) => (f.id === sel ? rotateFurniture(f) : f)));
  const deleteSel = () => { if (selItem) { editItems((l) => l.filter((f) => f.id !== sel)); setSel(null); } };
  const duplicateSel = () => {
    if (!selItem) return;
    const n = { ...selItem, id: newFurniture(selItem.kind, 0, 0).id, x: selItem.x + 0.3, y: selItem.y + 0.3 };
    editItems((l) => [...l, n]);
    setSel(n.id!);
  };
  const addKind = (kind: FurnitureKind) => {
    // son tıklanan nokta; yoksa kattaki en büyük odanın ortası
    let p = live.current.lastClick;
    if (!p || !floor.rooms.some((r) => p!.x > r.rect.x && p!.x < r.rect.x + r.rect.w && p!.y > r.rect.y && p!.y < r.rect.y + r.rect.h)) {
      const r = [...floor.rooms].filter((q) => !q.void && q.band !== "hall").sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
      p = r ? { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 } : { x: layout.W / 2, y: layout.D / 2 };
    }
    const n = newFurniture(kind, p.x, p.y);
    editItems((l) => [...l, n]);
    setSel(n.id!);
  };
  // Düzenleme kısayolları
  useEffect(() => {
    if (mode !== "duzen") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "r" || e.key === "R") rotateSel();
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Gezintide kat değiştir: aynı noktada kal, olmazsa o katın başlangıcı */
  const goLevel = (lv: number) => { setLevel(lv); };
  const goRoom = (id: string) => {
    const r = floor.rooms.find((q) => q.id === id);
    const w = walk.current;
    if (!r || !w.world) return;
    const p = freeNear(w.world, r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2);
    if (p) { w.x = p.x; w.z = p.y; }
  };

  const exportGLB = () => {
    const c = ctx.current;
    if (!c?.model) return;
    new GLTFExporter().parse(
      c.model,
      (res) => saveOutput(`${program.projectName}-3d`, "glb", res as ArrayBuffer),
      (err) => alert("GLB dışa aktarılamadı: " + String(err)),
      { binary: true },
    );
  };
  const exportPNG = () => {
    const c = ctx.current;
    if (!c) return;
    if (c.real) c.composer.render();
    else c.renderer.render(c.scene, c.camera);
    c.renderer.domElement.toBlob((b) => b && saveOutput(`${program.projectName}-3d`, "png", b));
  };

  /** Render için şu anki görünümün JPEG'i (en uzun kenar 2048 px) ve kamera bilgisi.
   *  aspect verilirse görünüm o orana ortadan kırpılır; "auto" görünüme en yakın orandır. */
  const capture = (aspect = "auto", modelId?: string): RenderCapture | null => {
    const c = ctx.current;
    if (!c) return null;
    if (c.real) c.composer.render();
    else c.renderer.render(c.scene, c.camera);
    const src = c.renderer.domElement;
    const a = aspect === "auto" ? nearestAspect(src.width, src.height, modelId) : aspect;
    const want = aspectValue(a);
    // ortadan kırp: kadraj oranı = istenen oran
    let sw = src.width, sh = src.height;
    if (sw / sh > want) sw = Math.round(sh * want); else sh = Math.round(sw / want);
    const sx = (src.width - sw) / 2, sy = (src.height - sh) / 2;
    const k = Math.min(1, 2048 / Math.max(sw, sh));
    const cv = document.createElement("canvas");
    cv.width = Math.round(sw * k);
    cv.height = Math.round(sh * k);
    cv.getContext("2d")!.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    // kırpılmış kadrajda NDC → 0..1 dönüşümü
    const fx = sw / src.width, fy = sh / src.height;
    const toFrame = (v: THREE.Vector3) => ({ x: (v.x / fx + 1) / 2, y: (1 - v.y / fy) / 2 });
    const cam = c.camera;
    const H = layout.totalHeight + layout.roofHeight;
    const box = c.model ? new THREE.Box3().setFromObject(c.model) : new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(layout.W, H, layout.D));
    // peyzaj/arsa yerine binanın kendisi: yerleşimin kutusu (çok blokta tüm bloklar modelde)
    const bx0 = 0, bx1 = layout.W, bz0 = 0, bz1 = layout.D;
    const corners: THREE.Vector3[] = [];
    for (const x of [bx0, bx1]) for (const y of [0, H]) for (const z of [bz0, bz1]) corners.push(new THREE.Vector3(x, y, z));
    const pts = corners.map((v) => toFrame(v.clone().project(cam)));
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const frame = { x0: clamp(Math.min(...pts.map((p) => p.x))), x1: clamp(Math.max(...pts.map((p) => p.x))), y0: clamp(Math.min(...pts.map((p) => p.y))), y1: clamp(Math.max(...pts.map((p) => p.y))) };
    // görünen cepheler: yüz merkezinden kameraya doğrultu yüz normaliyle aynı yöndeyse görünür. Ön cephe sokak tarafı (-z).
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, my = H / 2;
    const faces = [
      { n: new THREE.Vector3(0, 0, -1), p: new THREE.Vector3(cx, my, bz0), side: "front" },
      { n: new THREE.Vector3(0, 0, 1), p: new THREE.Vector3(cx, my, bz1), side: "rear" },
      { n: new THREE.Vector3(1, 0, 0), p: new THREE.Vector3(bx1, my, cz), side: "x1" },
      { n: new THREE.Vector3(-1, 0, 0), p: new THREE.Vector3(bx0, my, cz), side: "x0" },
    ];
    // önden bakan kişiye göre sol/sağ: kamera -z'den +z'ye bakarken sağ taraf -x'tir
    const sideName = (s: string): "front" | "rear" | "left" | "right" => (s === "x1" ? "left" : s === "x0" ? "right" : (s as "front" | "rear"));
    const facades = faces
      .map((f) => ({ f, dot: cam.position.clone().sub(f.p).normalize().dot(f.n) }))
      .filter((x) => x.dot > 0.12)
      .sort((a, b) => b.dot - a.dot)
      .map(({ f }) => {
        const x = toFrame(f.p.clone().project(cam)).x;
        return { name: sideName(f.side), where: (x < 0.4 ? "left" : x > 0.6 ? "right" : "centre") as "left" | "centre" | "right" };
      });
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const vfov = (cam.fov * Math.PI) / 180;
    const camera: CameraInfo = {
      height: Math.max(0, cam.position.y - Math.max(0, box.min.y)),
      distance: Math.hypot(cam.position.x - cx, cam.position.z - cz),
      pitch: (-Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI,
      // 35 mm eşdeğeri: kırpılmış kadrajın köşegen açısına göre (43,3 mm köşegen)
      focal: 43.27 / (2 * Math.tan(vfov / 2) * fy * Math.hypot(1, want)),
      buildingHeight: H,
      facades,
      frame,
    };
    if (mode === "gezi") {
      // içeriden görünüm: kameranın bulunduğu oda ve odadaki mobilyalar
      const w = walk.current;
      const room = floor.rooms.find((r) => !r.void && w.x >= r.rect.x && w.x <= r.rect.x + r.rect.w && w.z >= r.rect.y && w.z <= r.rect.y + r.rect.h);
      const inRoom = room ? items.filter((f) => { const cx = f.x + f.w / 2, cy = f.y + f.h / 2; return cx >= room.rect.x && cx <= room.rect.x + room.rect.w && cy >= room.rect.y && cy <= room.rect.y + room.rect.h; }) : [];
      const names = [...new Set(inRoom.map((f) => FURN_EN[f.kind] ?? f.kind))];
      camera.height = Math.max(0, cam.position.y - floor.z);
      camera.distance = 0;
      camera.facades = [];
      camera.interior = { room: room ? ROOM_EN[room.type] ?? "room" : "room", roomType: room?.type ?? "", style: interiorStyle(styleId).en, furniture: names, area: room ? room.rect.w * room.rect.h : undefined };
    }
    return { image: cv.toDataURL("image/jpeg", 0.92), camera, aspect: a };
  };

  const levels = layout.floors.map((f) => f.level);
  const groups = [...new Set(FURNITURE_CATALOG.map((c) => c.group))];
  const li = layout.floors.findIndex((f) => f.level === level);
  const MODES: [Mode, string, string][] = [
    ["dis", "Dış görünüm", "Binanın çevresinde döndür"],
    ...(canEdit ? [["duzen", "İç mekân", "Mobilyaları gör, ekle, taşı, döndür, sil"] as [Mode, string, string]] : []),
    ["gezi", "İçeride gez", "Birinci şahıs gezinti (W A S D / ok tuşları, dokunmatikte sol alttaki çubuk)"],
  ];
  return (
    <div className={`three-wrap mode-${mode}`}>
      <div className="toolbar">
        <div className="seg" role="tablist">
          {MODES.map(([m, label, title]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`seg-btn ${mode === m ? "on" : ""}`} title={title} onClick={() => setMode(m)}>{label}</button>
          ))}
        </div>
        {mode !== "dis" && layout.floors.length > 1 && (
          <label>Kat
            <select value={level} onChange={(e) => (mode === "gezi" ? goLevel(Number(e.target.value)) : setLevel(Number(e.target.value)))}>
              {layout.floors.map((f) => <option key={f.level} value={f.level}>{f.name}</option>)}
            </select>
          </label>
        )}
        {mode === "gezi" && (
          <>
            <label>Odaya git
              <select value="" onChange={(e) => goRoom(e.target.value)}>
                <option value="">Seç…</option>
                {floor.rooms.filter((r) => !r.void && r.type !== "merdiven").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {li > 0 && <button className="btn ghost small" onClick={() => goLevel(layout.floors[li - 1].level)}>▼ Alt kat</button>}
            {li < layout.floors.length - 1 && <button className="btn ghost small" onClick={() => goLevel(layout.floors[li + 1].level)}>▲ Üst kat</button>}
          </>
        )}
        {mode !== "dis" && (
          <label title="Mobilya, iç duvar ve döşeme renk / malzeme paleti">İç mekân üslubu
            <select value={styleId} disabled={!canEdit} onChange={(e) => onChange?.({ ...program, design: { ...program.design, interiorStyle: e.target.value } })}>
              {INTERIOR_STYLES.map((st) => <option key={st.id} value={st.id} title={st.hint}>{st.name}</option>)}
            </select>
          </label>
        )}
        {mode === "duzen" && !panel && <button className="btn ghost small" onClick={() => setPanel(true)}>Denetim ve aydınlatma</button>}
        {mode === "duzen" && (
          <>
            <label>Ekle
              <select value="" onChange={(e) => e.target.value && addKind(e.target.value as FurnitureKind)}>
                <option value="">Mobilya seç…</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {FURNITURE_CATALOG.filter((c) => c.group === g).map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {selItem ? (
              <>
                <span className="sel-name">{furnitureLabel(selItem.kind)} · {selItem.w.toFixed(2)}×{selItem.h.toFixed(2)} m</span>
                <button className="btn ghost small" onClick={rotateSel} title="R">⟳ Döndür</button>
                <button className="btn ghost small" onClick={duplicateSel}>Çoğalt</button>
                <button className="btn ghost small danger" onClick={deleteSel} title="Delete">Sil</button>
              </>
            ) : <span className="muted small">Bir mobilyaya dokunun: seçilir, sürükleyerek taşınır</span>}
            {floor.furniture && <button className="btn ghost small" onClick={() => { if (confirm("Bu kattaki elle yapılan mobilya düzenlemesi silinsin, otomatik yerleşime dönülsün mü?")) { setSel(null); commit(level, null); } }}>Otomatik yerleşime dön</button>}
          </>
        )}
        {mode === "dis" && <>
        <label>
          Görünen katlar
          <select
            value={opts.maxLevel ?? "all"}
            onChange={(e) => setOpts({ ...opts, maxLevel: e.target.value === "all" ? null : Number(e.target.value) })}
          >
            <option value="all">Tümü</option>
            {levels.map((l, i) => (
              <option key={l} value={l}>
                {layout.floors[i].name} ve altı
              </option>
            ))}
          </select>
        </label>
        <label className="check" title="Dokulu malzeme, gökyüzü, gölge ve peyzaj">
          <input type="checkbox" checked={!!opts.realistic} onChange={(e) => setOpts({ ...opts, realistic: e.target.checked })} /> Gerçekçi görünüm
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.showRoof} onChange={(e) => setOpts({ ...opts, showRoof: e.target.checked })} /> Çatı
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.cutaway} onChange={(e) => setOpts({ ...opts, cutaway: e.target.checked, showRoof: e.target.checked ? false : opts.showRoof })} /> Maket kesiti (içini göster)
        </label>
        <label className="check" title="Arsanın yönüne, aya ve saate göre gerçek güneş açısı ve gölgeler (39° enlem)">
          <input type="checkbox" checked={sun.on} onChange={(e) => setSun({ ...sun, on: e.target.checked })} /> Güneş çalışması
        </label>
        {sun.on && (
          <>
            <label>Bahçe cephesi
              <select value={sun.facing} onChange={(e) => setSun({ ...sun, facing: e.target.value as Facing })}>
                {(Object.keys(FACING_NAMES) as Facing[]).map((k) => <option key={k} value={k}>{FACING_NAMES[k]}</option>)}
              </select>
            </label>
            <label>Ay
              <select value={sun.month} onChange={(e) => setSun({ ...sun, month: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label>Saat {String(Math.floor(sun.hour)).padStart(2, "0")}:{sun.hour % 1 ? "30" : "00"}
              <input type="range" min={6} max={19} step={0.5} value={sun.hour} onChange={(e) => setSun({ ...sun, hour: Number(e.target.value) })} />
            </label>
            <span className="muted small">Güneş yüksekliği {Math.max(0, sunAngles(sun.month, sun.hour).altitude).toFixed(0)}°</span>
          </>
        )}
        </>}
        <span className="spacer" />
{!viewer && <>
        <button className="btn primary" onClick={() => { if (!opts.realistic) setOpts({ ...opts, realistic: true }); setTimeout(() => setRendering(true), 50); }} title="Bu açıdan Higgsfield ile fotoğraf gerçekliğinde görsel">✦ Gerçekçi render</button>
        <button className="btn ghost" onClick={exportPNG}>PNG</button>
        <button className="btn ghost" onClick={exportGLB}>GLB (3D model)</button>
        </>}
      </div>
      <div className="three-stage">
        <div ref={host} className="three-host" />
        {mode === "duzen" && panel && <InteriorPanel floor={floor} items={items} onPick={(id) => id && setSel(id)} onClose={() => setPanel(false)} />}
      </div>
      <div className="hint">
        {mode === "gezi" ? "Yürü: W A S D / ok tuşları (Shift: hızlı) · Bak: sürükle · Dokunmatik: sol alttaki çubukla yürü, ekranı sürükleyerek bak"
          : mode === "duzen" ? "Mobilyayı sürükle: taşı · R: döndür · Delete: sil · Boş yere dokunup Ekle: o noktaya koyar · Boş alanı sürükle: döndür"
          : "Sürükle: döndür · Tekerlek/iki parmak: yakınlaş · Sağ tık/iki parmak sürükle: kaydır"}
      </div>
      {mode === "gezi" && <Joystick onMove={(x, y) => { walk.current.joy = { x, y }; }} />}
      {rendering && <RenderDialog program={program} refImages={refImages} capture={capture} onClose={() => setRendering(false)} onSettings={() => { setRendering(false); onSettings?.(); }} />}
    </div>
  );
}

/** Render talimatı için oda ve mobilya adları (İngilizce) */
const ROOM_EN: Record<string, string> = {
  salon: "living room", yemek: "dining room", mutfak: "kitchen", ebeveyn: "master bedroom", yatak: "bedroom", cocuk: "child's bedroom", misafir: "guest bedroom",
  calisma: "study", ofis: "home office", banyo: "bathroom", wc: "guest toilet", camasir: "laundry room", giyinme: "walk-in wardrobe", hol: "hallway", koridor: "corridor",
  antre: "entrance hall", kiler: "pantry", depo: "storage room", garaj: "garage", merdiven: "stair hall",
};
const FURN_EN: Record<string, string> = {
  bed: "bed", nightstand: "bedside tables with lamps", wardrobe: "built-in wardrobe", sofa: "sofa", armchair: "armchair", coffeeTable: "coffee table", tvUnit: "low TV unit with TV",
  table: "dining table", chair: "chairs", counter: "kitchen worktop with base and wall cabinets", island: "kitchen island", fridge: "tall fridge", hob: "cooktop with hood", sink: "kitchen sink",
  wc: "wall-hung toilet", basin: "washbasin with mirror", shower: "walk-in shower with glass screen", bathtub: "bathtub", desk: "desk", washer: "washing machine", car: "car",
  shelf: "bookshelf", rug: "rug", plant: "potted plant", floorLamp: "floor lamp", dresser: "chest of drawers", bench: "bench",
};

/** Dokunmatik ekranlarda yürüme çubuğu (fareyle de sürüklenebilir) */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const R = 44;
  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(x, y);
    if (l > R) { x = (x / l) * R; y = (y / l) * R; }
    setKnob({ x, y });
    onMove(x / R, y / R);
  };
  const end = () => { setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div
      ref={base}
      className="joystick"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Yürüme çubuğu"
    >
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
