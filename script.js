import * as THREE from 'three';

// --- CONFIGURATION ---
const PARTICLE_COUNT = 15000;
const GALAXY_RADIUS = 30;
const BRANCHES = 3;
const SPIN_CURVE = 1;
const RANDOMNESS = 0.5;
const RANDOMNESS_POWER = 3;

// --- STATE ---
const mouse = new THREE.Vector2();
const targetRotation = new THREE.Vector2();
let warpActive = false;
let time = 0;

// --- SCENE SETUP ---
const scene = new THREE.Scene();
// Add a subtle fog for depth
scene.fog = new THREE.FogExp2(0x000000, 0.03);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 8;
camera.position.y = 4;
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- GEOMETRY GENERATION ---
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);
const colors = new Float32Array(PARTICLE_COUNT * 3);
const originalPositions = new Float32Array(PARTICLE_COUNT * 3); // To remember structure during warp

const colorInside = new THREE.Color('#ff6030');
const colorOutside = new THREE.Color('#1b3984');

for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;

    // Position along the radius
    const radius = Math.random() * GALAXY_RADIUS;
    
    // Angle for the spiral arms
    const spinAngle = radius * SPIN_CURVE;
    const branchAngle = (i % BRANCHES) / BRANCHES * Math.PI * 2;
    
    // Randomness for scattering
    const randomX = Math.pow(Math.random(), RANDOMNESS_POWER) * (Math.random() < 0.5 ? 1 : -1) * RANDOMNESS * radius;
    const randomY = Math.pow(Math.random(), RANDOMNESS_POWER) * (Math.random() < 0.5 ? 1 : -1) * RANDOMNESS * radius;
    const randomZ = Math.pow(Math.random(), RANDOMNESS_POWER) * (Math.random() < 0.5 ? 1 : -1) * RANDOMNESS * radius;

    // Final positions
    positions[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
    positions[i3 + 1] = randomY; // Flattened disk on Y axis
    positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

    // Store original for warp effect math
    originalPositions[i3] = positions[i3];
    originalPositions[i3+1] = positions[i3+1];
    originalPositions[i3+2] = positions[i3+2];

    // Color mixing
    const mixedColor = colorInside.clone();
    mixedColor.lerp(colorOutside, radius / GALAXY_RADIUS);

    colors[i3] = mixedColor.r;
    colors[i3 + 1] = mixedColor.g;
    colors[i3 + 2] = mixedColor.b;
}

geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

// --- MATERIAL ---
// We use additive blending to make overlapping particles glow
const material = new THREE.PointsMaterial({
    size: 0.05,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

// --- INTERACTION LISTENERS ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('mousemove', (event) => {
    // Normalize mouse from -1 to 1
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('click', () => {
    warpActive = !warpActive;
});

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();

function tick() {
    const elapsedTime = clock.getElapsedTime();
    const deltaTime = clock.getDelta();

    // 1. ROTATION PHYSICS
    // Base rotation + Mouse X influence
    const rotationSpeed = 0.05 + (mouse.x * 0.1); 
    particles.rotation.y = elapsedTime * rotationSpeed;

    // 2. COLOR SHIFT
    // Mouse Y influences the particle size slightly to create a "pulsing" effect
    material.size = 0.05 + (Math.abs(mouse.y) * 0.05);

    // 3. WARP DRIVE EFFECT
    const positionAttribute = geometry.attributes.position;
    
    for(let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const x = originalPositions[i3];
        const y = originalPositions[i3 + 1];
        const z = originalPositions[i3 + 2];

        if (warpActive) {
            // Stretch particles along the Z axis based on their distance from center
            // This creates a "Star Wars" hyperspace look
            positionAttribute.array[i3 + 1] = y + Math.sin(elapsedTime * 10 + x) * 0.5; // Jitter Y
            positionAttribute.array[i3 + 2] = z + (x * 20); // Stretch Z
            
            // Camera shake
            camera.position.x += (Math.random() - 0.5) * 0.02;
            camera.position.y += (Math.random() - 0.5) * 0.02;
        } else {
            // Return to normal shape smoothly
            // Linear interpolation (Lerp) back to original
            positionAttribute.array[i3] = x;
            positionAttribute.array[i3 + 1] = THREE.MathUtils.lerp(positionAttribute.array[i3 + 1], y, 0.1);
            positionAttribute.array[i3 + 2] = THREE.MathUtils.lerp(positionAttribute.array[i3 + 2], z, 0.1);
        }
    }
    positionAttribute.needsUpdate = true;

    // 4. CAMERA MOVEMENT
    if (warpActive) {
        // Zoom out drastically
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, 2, 0.02);
        camera.fov = THREE.MathUtils.lerp(camera.fov, 100, 0.02);
    } else {
        // Normal Floating
        camera.position.x = Math.sin(elapsedTime * 0.2) * 3;
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, 8, 0.05);
        camera.fov = THREE.MathUtils.lerp(camera.fov, 75, 0.05);
        camera.lookAt(0, 0, 0);
    }
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    window.requestAnimationFrame(tick);
}

tick();
