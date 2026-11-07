import { useEffect, useRef, useState } from "react";
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
import { zoningCheck } from "../geometry/zoning";
import { saveOutput } from "../store";

export function ThreeView({ layout, program }: { layout: BuildingLayout; program: Program }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; model: THREE.Group | null;
    composer: EffectComposer; gtao: GTAOPass; sky: Sky; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; envReal: THREE.Texture; real: boolean;
  } | null>(null);
  const [opts, setOpts] = useState<ModelOptions>({ showRoof: true, maxLevel: null, cutaway: false, realistic: true });

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
    ctx.current = { renderer, scene, camera, controls, model: null, composer, gtao, sky, sun, hemi, envReal, real: false };
    (window as unknown as { __mn3d?: unknown }).__mn3d = ctx.current; // test ve hata ayıklama için

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
    const loop = () => {
      controls.update();
      if (ctx.current?.real) composer.render();
      else renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // Kamerayı binaya göre yerleştir (yerleşim değişince)
  useEffect(() => {
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
  }, [layout.W, layout.D, layout.totalHeight, program.blockIndex, program.blocks?.length]);

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
    const model = buildModel(layout, { ...opts, materials: program.materials, entranceX, avoid }, { width: program.site.width, depth: program.site.depth, offsetX: z.building.x, offsetY: z.building.y });
    // çok bloklu: diğer bloklar da arsada
    for (const b of others) {
      const m = buildModel(b.L, { ...opts, materials: program.materials });
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
    const dir = c.sun.userData.dir as THREE.Vector3;
    const center = new THREE.Vector3(layout.W / 2, 0, layout.D / 2);
    c.sun.position.copy(center).addScaledVector(real ? dir : new THREE.Vector3(-0.45, 0.75, -0.55), 60);
    c.sun.target.position.copy(center);
  }, [layout, opts, program]);

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

  const levels = layout.floors.map((f) => f.level);
  return (
    <div className="three-wrap">
      <div className="toolbar">
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
        <span className="spacer" />
        <button className="btn ghost" onClick={exportPNG}>PNG</button>
        <button className="btn ghost" onClick={exportGLB}>GLB (3D model)</button>
      </div>
      <div ref={host} className="three-host" />
      <div className="hint">Sürükle: döndür · Tekerlek: yakınlaş · Sağ tık: kaydır</div>
    </div>
  );
}
