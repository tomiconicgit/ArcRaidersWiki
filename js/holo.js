import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class Hologram {
  constructor(panelEl, canvasEl, metaEl) {
    this.panelEl = panelEl;
    this.canvasEl = canvasEl;
    this.metaEl = metaEl;

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // allows snapshots to include it
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
    this.camera.position.set(0, 0.0, 2.2);

    // Lights (cool, clean)
    const key = new THREE.DirectionalLight(0x88ffff, 1.2);
    key.position.set(2, 2, 2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-2, -1, 2);
    this.scene.add(fill);

    // Group for rotation
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Slab geometry
    const geom = new THREE.BoxGeometry(1.25, 0.8, 0.08);

    // Placeholder texture
    const placeholder = new THREE.CanvasTexture(document.createElement("canvas"));
    placeholder.needsUpdate = true;

    this.matFront = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: placeholder,
      transparent: true,
      opacity: 0.98,
      roughness: 0.35,
      metalness: 0.05
    });

    // Cyan “holo glass” sides
    this.matSide = new THREE.MeshStandardMaterial({
      color: 0x00ffd6,
      transparent: true,
      opacity: 0.18,
      roughness: 0.2,
      metalness: 0.1
    });

    // Create a box with different materials
    const mats = [
      this.matSide, this.matSide, this.matSide, this.matSide, this.matFront, this.matSide
    ];

    this.mesh = new THREE.Mesh(geom, mats);
    this.group.add(this.mesh);

    // Outline edges
    const edges = new THREE.EdgesGeometry(geom);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x00ffd6, transparent: true, opacity: 0.55 })
    );
    this.group.add(line);

    this.visible = false;
    this._raf = 0;
    this._t0 = performance.now();

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize, { passive: true });
    this._resize();
    this._render = this._render.bind(this);
    this._raf = requestAnimationFrame(this._render);
  }

  destroy() {
    window.removeEventListener("resize", this._resize);
    cancelAnimationFrame(this._raf);
    this.renderer.dispose();
  }

  _resize() {
    const rect = this.canvasEl.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setVisible(on) {
    this.visible = !!on;
    this.panelEl.classList.toggle("on", this.visible);
    this.panelEl.setAttribute("aria-hidden", this.visible ? "false" : "true");
  }

  getCanvas() {
    return this.canvasEl;
  }

  async showFromCrop({ cropCanvas, label, score }) {
    // Make a texture from the crop canvas
    const tex = new THREE.CanvasTexture(cropCanvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    this.matFront.map = tex;
    this.matFront.needsUpdate = true;

    const pct = Math.round((score || 0) * 100);
    this.metaEl.textContent = `${label} • ${pct}% • tap Snapshot to save`;

    this.setVisible(true);

    // Small “present” animation
    this.group.rotation.set(0.22, -0.25, 0);
  }

  hide() {
    this.setVisible(false);
  }

  _render(now) {
    this._raf = requestAnimationFrame(this._render);

    // Render even if hidden (keeps snapshot stable), but you can skip if you want
    const t = (now - this._t0) / 1000;

    // Slow, premium rotation when visible
    if (this.visible) {
      this.group.rotation.y += 0.012;
      this.group.rotation.x = 0.18 + Math.sin(t * 0.7) * 0.03;
    }

    // Transparent background
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
  }
}