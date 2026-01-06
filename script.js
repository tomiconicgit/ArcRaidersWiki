import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

/**
 * --- SHADERS (GLSL) ---
 * We write these as strings to avoid loading external files.
 * This runs on the Graphics Card (GPU) for maximum performance.
 */

const vertexShader = `
    uniform float uTime;
    uniform float uSize;
    uniform float uExplosion;
    attribute float aScale;
    attribute vec3 aRandomness;
    
    varying vec3 vColor;

    void main() {
        // Base Position
        vec4 modelPosition = modelMatrix * vec4(position, 1.0);
        
        // Spin Effect based on distance from center
        float angle = atan(modelPosition.x, modelPosition.z);
        float distanceToCenter = length(modelPosition.xz);
        float angleOffset = (1.0 / distanceToCenter) * uTime * 0.2;
        
        // Apply rotation
        angle += angleOffset;
        modelPosition.x = cos(angle) * distanceToCenter;
        modelPosition.z = sin(angle) * distanceToCenter;

        // Wave effect (breathing)
        modelPosition.y += sin(uTime + distanceToCenter) * 0.2;

        // Explosion Effect (User Interaction)
        vec3 explosionDirection = normalize(modelPosition.xyz);
        modelPosition.xyz += explosionDirection * uExplosion * aRandomness.x * 5.0;

        vec4 viewPosition = viewMatrix * modelPosition;
        vec4 projectedPosition = projectionMatrix * viewPosition;
        gl_Position = projectedPosition;

        // Size attenuation (particles get smaller when far away)
        gl_PointSize = uSize * aScale;
        gl_PointSize *= (1.0 / -viewPosition.z);

        // Send color to fragment shader
        vColor = color;
    }
`;

const fragmentShader = `
    varying vec3 vColor;

    void main() {
        // Make the particle circular
        float strength = distance(gl_PointCoord, vec2(0.5));
        strength = 1.0 - strength;
        strength = pow(strength, 10.0);

        // Final color mix
        vec3 finalColor = mix(vec3(0.0), vColor, strength);
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// --- SETUP ---
const canvas = document.querySelector('canvas');
const loading = document.getElementById('loading');

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 6, 8);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false }); // Antialias off for performance with post-processing
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ReinhardToneMapping;
document.body.appendChild(renderer.domElement);

// Controls (Touch Friendly)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// --- GALAXY GENERATOR ---
const parameters = {
    count: 30000,          // High particle count for "Advanced" feel
    size: 30,
    radius: 7,
    branches: 3,
    spin: 1,
    randomness: 0.2,
    randomnessPower: 3,
    insideColor: '#ff6030',
    outsideColor: '#1b3984',
    explosionTrigger: 0 // Used for animation
};

let geometry = null;
let material = null;
let points = null;

const generateGalaxy = () => {
    if (points !== null) {
        geometry.dispose();
        material.dispose();
        scene.remove(points);
    }

    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(parameters.count * 3);
    const colors = new Float32Array(parameters.count * 3);
    const scales = new Float32Array(parameters.count * 1);
    const randomnessAttr = new Float32Array(parameters.count * 3);

    const colorInside = new THREE.Color(parameters.insideColor);
    const colorOutside = new THREE.Color(parameters.outsideColor);

    for (let i = 0; i < parameters.count; i++) {
        const i3 = i * 3;

        // Radius
        const radius = Math.random() * parameters.radius;

        // Branches
        const spinAngle = radius * parameters.spin;
        const branchAngle = (i % parameters.branches) / parameters.branches * Math.PI * 2;

        const randomX = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;
        const randomY = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;
        const randomZ = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;

        positions[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
        positions[i3 + 1] = randomY;
        positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

        // Randomness (stored for explosion effect)
        randomnessAttr[i3] = Math.random();
        randomnessAttr[i3+1] = Math.random();
        randomnessAttr[i3+2] = Math.random();

        // Color
        const mixedColor = colorInside.clone();
        mixedColor.lerp(colorOutside, radius / parameters.radius);

        colors[i3] = mixedColor.r;
        colors[i3 + 1] = mixedColor.g;
        colors[i3 + 2] = mixedColor.b;

        // Scale (randomize size)
        scales[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aRandomness', new THREE.BufferAttribute(randomnessAttr, 3));

    // Shader Material
    material = new THREE.ShaderMaterial({
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uSize: { value: parameters.size * renderer.getPixelRatio() },
            uExplosion: { value: 0 }
        }
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);
    
    // Hide loading screen once generated
    loading.style.opacity = 0;
};

generateGalaxy();

// --- POST PROCESSING (BLOOM) ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0;
bloomPass.strength = 1.2; // Intensity of the glow
bloomPass.radius = 0;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- GUI CONTROL PANEL ---
const gui = new GUI({ title: 'Control Panel' });
gui.close(); // Closed by default on mobile
gui.add(parameters, 'count').min(1000).max(100000).step(100).onFinishChange(generateGalaxy).name('Particle Count');
gui.add(parameters, 'radius').min(0.01).max(20).step(0.01).onFinishChange(generateGalaxy);
gui.add(parameters, 'branches').min(2).max(20).step(1).onFinishChange(generateGalaxy);
gui.add(parameters, 'spin').min(-5).max(5).step(0.001).onFinishChange(generateGalaxy);
gui.addColor(parameters, 'insideColor').onFinishChange(generateGalaxy);
gui.addColor(parameters, 'outsideColor').onFinishChange(generateGalaxy);
gui.add(bloomPass, 'strength').min(0).max(3).step(0.01).name('Glow Strength');

// --- INTERACTION ---
let isExploding = false;

// Raycaster for advanced touch interaction
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerMove( event ) {
    // Handle both mouse and touch
    let x, y;
    if(event.changedTouches) {
        x = event.changedTouches[0].clientX;
        y = event.changedTouches[0].clientY;
    } else {
        x = event.clientX;
        y = event.clientY;
    }
    
	pointer.x = ( x / window.innerWidth ) * 2 - 1;
	pointer.y = - ( y / window.innerHeight ) * 2 + 1;
}

// Double tap/click to explode
window.addEventListener('dblclick', () => { isExploding = true; });

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();

const tick = () => {
    const elapsedTime = clock.getElapsedTime();

    // Update Shader Uniforms
    if(material) {
        material.uniforms.uTime.value = elapsedTime;
        
        // Handle Explosion Logic
        if(isExploding) {
            material.uniforms.uExplosion.value += 0.05; // Expand
            if(material.uniforms.uExplosion.value > 2.0) isExploding = false; // Reset trigger
        } else {
            // Smoothly return to 0
            material.uniforms.uExplosion.value = THREE.MathUtils.lerp(material.uniforms.uExplosion.value, 0, 0.05);
        }
    }

    // Update Controls
    controls.update();

    // Render using Composer (for Bloom) instead of standard renderer
    composer.render();

    window.requestAnimationFrame(tick);
};

tick();

// --- RESIZE HANDLER ---
window.addEventListener('resize', () => {
    // Update sizes
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    composer.setSize(width, height);
});
