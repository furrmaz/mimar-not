import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { BuildingLayout } from "../geometry/layout";
import { buildModel, type ModelOptions } from "../geometry/model3d";
import type { Program } from "../shared/schema";
import { zoningCheck } from "../geometry/zoning";
import { saveOutput } from "../store";

export function ThreeView({ layout, program }: { layout: BuildingLayout; program: Program }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; model: THREE.Group | null } | null>(null);
  const [opts, setOpts] = useState<ModelOptions>({ showRoof: true, maxLevel: null, cutaway: false });

  // Sahne kurulumu (bir kez)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f5);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4a0, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-18, 30, -22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
    scene.add(sun);
    ctx.current = { renderer, scene, camera, controls, model: null };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
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
    const { W, D } = layout;
    const H = layout.totalHeight + layout.roofHeight;
    const r = Math.max(W, D, H) * 1.35;
    c.camera.position.set(W / 2 + r * 0.75, H * 0.9 + r * 0.45, -r * 0.85);
    c.controls.target.set(W / 2, H * 0.35, D / 2);
  }, [layout.W, layout.D, layout.totalHeight]);

  // Modeli yeniden kur
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.model) {
      c.scene.remove(c.model);
      c.model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const z = zoningCheck(program, layout);
    const model = buildModel(layout, opts, { width: program.site.width, depth: program.site.depth, offsetX: z.building.x, offsetY: z.building.y });
    c.scene.add(model);
    c.model = model;
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
    c.renderer.render(c.scene, c.camera);
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
