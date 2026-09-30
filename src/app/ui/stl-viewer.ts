import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { num } from '../format';
import { h } from './dom';
import { openModal } from './modal';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Modèle STL en 3D dans une modale : rotation à la souris, dimensions affichées. */
export function openStlViewer(url: string, title: string): void {
  const canvas = h('canvas', { class: 'stl-canvas' });
  const info = h('div', { class: 'hint num' }, 'Chargement…');
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  scene.background = new Color(cssVar('--bg') || '#0a0a0b');
  const camera = new PerspectiveCamera(35, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, canvas);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  let frame = 0;
  const draw = () => {
    frame = 0;
    renderer.render(scene, camera);
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  controls.addEventListener('change', request);

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    request();
  };
  const ro = new ResizeObserver(resize);

  openModal({
    title,
    body: h('div', { class: 'stl-view' }, canvas, info),
    wide: true,
    onClose: () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  });
  ro.observe(canvas);

  new STLLoader().load(
    url,
    (geometry) => {
      geometry.rotateX(-Math.PI / 2);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new Box3();
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      geometry.translate(-center.x, -box.min.y, -center.z);
      const mesh = new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: cssVar('--brand') || '#ff2a3d',
          roughness: 0.55,
          metalness: 0.05,
        }),
      );
      scene.add(mesh);
      const span = Math.max(size.x, size.y, size.z, 10);
      const grid = new GridHelper(Math.max(256, span * 1.5), 16, 0x444444, 0x2a2a2a);
      scene.add(grid);
      camera.position.set(span * 1.4, span * 1.1, span * 1.6);
      controls.target.set(0, size.y / 2, 0);
      controls.update();
      info.textContent = `${num(size.x, 1)} x ${num(size.z, 1)} x ${num(size.y, 1)} mm · ${num(geometry.attributes.position.count / 3)} triangles`;
      resize();
    },
    undefined,
    () => {
      info.textContent = 'Lecture du STL impossible';
    },
  );
}
