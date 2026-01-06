import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

/**
 * --- SHADERS (GLSL) ---
 * Used for both the Galaxy background and the planets for advanced visual effects.
 */

// Galaxy Vertex Shader (Sphere Background)
const galaxyVertexShader = `
    uniform float uTime;
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
        float angleOffset = (1.0 / distanceToCenter) * uTime * 0.05; // Slower for background
        
        // Apply rotation
        angle += angleOffset;
        modelPosition.x = cos(angle) * distanceToCenter;
        modelPosition.z = sin(angle) * distanceToCenter;

        // Wave effect (breathing)
        modelPosition.y += sin(uTime * 0.5 + distanceToCenter) * 0.1; // Slower for background

        // Explosion Effect (subtle on background)
        vec3 explosionDirection = normalize(modelPosition.xyz);
        modelPosition.xyz += explosionDirection * uExplosion * aRandomness.x * 2.0;

        vec4 viewPosition = viewMatrix * modelPosition;
        vec4 projectedPosition = projectionMatrix * viewPosition;
        gl_Position = projectedPosition;

        gl_PointSize = 4.0 * aScale; // Larger points for background
        gl_PointSize *= (1.0 / -viewPosition.z);

        vColor = color;
    }
`;

// Planet Vertex Shader (Simple for now, can be expanded for complex effects)
const planetVertexShader = `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

// Planet Fragment Shader (Glow / Core effect)
const planetFragmentShader = `
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uFresnelBias;
    uniform float uFresnelScale;
    uniform float uFresnelPower;
    
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        float fresnel = uFresnelBias + uFresnelScale * pow(1.0 + dot(viewDir, normal), uFresnelPower);
        
        // Basic light
        vec3 lightDirection = normalize(vec3(1.0, 1.0, 1.0));
        float diffuse = max(dot(normal, lightDirection), 0.0);
        
        // Subtle core glow
        vec3 finalColor = uColor * (diffuse + 0.3); // Mix diffuse with ambient
        finalColor += uColor * (sin(uTime * 2.0) * 0.1 + 0.1); // Pulsing glow
        
        gl_FragColor = vec4(finalColor + fresnel, 1.0);
    }
`;

// Standard Fragment Shader (for both galaxy background and asteroids)
const fragmentShader = `
    varying vec3 vColor;
    void main() {
        float strength = distance(gl_PointCoord, vec2(0.5));
        strength = 1.0 - strength;
        strength = pow(strength, 10.0);
        vec3 finalColor = mix(vec3(0.0), vColor, strength);
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// --- SETUP ---
const loading = document.getElementById('loading');
const planetInfoPanel = document.getElementById('planetInfo');
const planetNameElem = document.getElementById('planetName');
const planetTypeElem = document.getElementById('planetType');
const planetMassElem = document.getElementById('planetMass');
const planetRadiusElem = document.getElementById('planetRadius');
const planetDistanceElem = document.getElementById('planetDistance');
const closePlanetInfoBtn = document.getElementById('closePlanetInfo');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 20); // Starting position looking at the solar system

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ReinhardToneMapping;
document.body.appendChild(renderer.domElement);

// Controls (Touch Friendly)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.autoRotate = false; // We want to control rotation manually unless focusing
controls.target.set(0, 0, 0); // Initially look at the center of the solar system

// Raycaster for object interaction
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let lastTapTime = 0;
const DOUBLE_TAP_THRESHOLD = 300; // ms

// --- GALAXY BACKGROUND (Using the particle system) ---
const galaxyParameters = {
    count: 50000,
    size: 5,
    radius: 300, // Much larger radius to act as a background sphere
    branches: 4,
    spin: 1.5,
    randomness: 0.8,
    randomnessPower: 3,
    insideColor: '#f7d3ff', // Pinker colors for a celestial feel
    outsideColor: '#a1e4ff', // Bluish
    explosionTrigger: 0
};

let galaxyGeometry = null;
let galaxyMaterial = null;
let galaxyParticles = null;

const generateGalaxyBackground = () => {
    if (galaxyParticles !== null) {
        galaxyGeometry.dispose();
        galaxyMaterial.dispose();
        scene.remove(galaxyParticles);
    }

    galaxyGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(galaxyParameters.count * 3);
    const colors = new Float32Array(galaxyParameters.count * 3);
    const scales = new Float32Array(galaxyParameters.count * 1);
    const randomnessAttr = new Float32Array(galaxyParameters.count * 3);

    const colorInside = new THREE.Color(galaxyParameters.insideColor);
    const colorOutside = new THREE.Color(galaxyParameters.outsideColor);

    for (let i = 0; i < galaxyParameters.count; i++) {
        const i3 = i * 3;

        const radius = Math.random() * galaxyParameters.radius;
        const spinAngle = radius * galaxyParameters.spin;
        const branchAngle = (i % galaxyParameters.branches) / galaxyParameters.branches * Math.PI * 2;

        const randomX = Math.pow(Math.random(), galaxyParameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * galaxyParameters.randomness * radius;
        const randomY = Math.pow(Math.random(), galaxyParameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * galaxyParameters.randomness * radius;
        const randomZ = Math.pow(Math.random(), galaxyParameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * galaxyParameters.randomness * radius;

        positions[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
        positions[i3 + 1] = randomY;
        positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

        randomnessAttr[i3] = Math.random();
        randomnessAttr[i3+1] = Math.random();
        randomnessAttr[i3+2] = Math.random();

        const mixedColor = colorInside.clone();
        mixedColor.lerp(colorOutside, radius / galaxyParameters.radius);

        colors[i3] = mixedColor.r;
        colors[i3 + 1] = mixedColor.g;
        colors[i3 + 2] = mixedColor.b;

        scales[i] = Math.random();
    }

    galaxyGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    galaxyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    galaxyGeometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    galaxyGeometry.setAttribute('aRandomness', new THREE.BufferAttribute(randomnessAttr, 3));

    galaxyMaterial = new THREE.ShaderMaterial({
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: galaxyVertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uSize: { value: galaxyParameters.size * renderer.getPixelRatio() },
            uExplosion: { value: 0 }
        }
    });

    galaxyParticles = new THREE.Points(galaxyGeometry, galaxyMaterial);
    scene.add(galaxyParticles);
};

generateGalaxyBackground();

// --- SOLAR SYSTEM GENERATOR ---
const solarSystemGroup = new THREE.Group();
scene.add(solarSystemGroup);
let interactableObjects = []; // Stores planets and asteroids for raycasting
let currentFocusedObject = null;

const createPlanetMaterial = (color, params) => {
    return new THREE.ShaderMaterial({
        vertexShader: planetVertexShader,
        fragmentShader: planetFragmentShader,
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTime: { value: 0 },
            uFresnelBias: { value: params.fresnelBias || 0.1 },
            uFresnelScale: { value: params.fresnelScale || 1.0 },
            uFresnelPower: { value: params.fresnelPower || 2.0 }
        }
    });
};

const generateSolarSystem = () => {
    // Clear existing solar system
    solarSystemGroup.clear();
    interactableObjects = [];

    // The Sun (at the center)
    const sunMaterial = createPlanetMaterial('#FFD700', { fresnelBias: 0.1, fresnelScale: 1.5, fresnelPower: 3.0 });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2, 64, 64), sunMaterial);
    sun.name = 'Sun';
    sun.userData = {
        type: 'Star',
        mass: '1.989e30 kg',
        radius: '696,340 km',
        distance: '0 AU',
        isStar: true // Custom property for information
    };
    solarSystemGroup.add(sun);
    interactableObjects.push(sun);

    // Planets Array (name, size, color, orbitRadius, orbitSpeed, rotationSpeed, moons)
    const planetsData = [
        { name: 'Mercury', size: 0.3, color: '#b0adaf', orbitRadius: 5, orbitSpeed: 0.05, rotationSpeed: 0.02, moons: 0 },
        { name: 'Venus', size: 0.5, color: '#e69a4e', orbitRadius: 8, orbitSpeed: 0.03, rotationSpeed: 0.01, moons: 0 },
        { name: 'Earth', size: 0.6, color: '#4a8fe0', orbitRadius: 12, orbitSpeed: 0.02, rotationSpeed: 0.03, moons: 1, moonSize: 0.15, moonOrbitRadius: 1.5 },
        { name: 'Mars', size: 0.4, color: '#e06b2c', orbitRadius: 16, orbitSpeed: 0.015, rotationSpeed: 0.04, moons: 2, moonSize: 0.08, moonOrbitRadius: 0.8 },
        { name: 'Jupiter', size: 1.8, color: '#c9a184', orbitRadius: 25, orbitSpeed: 0.008, rotationSpeed: 0.05, moons: 4, moonSize: 0.3, moonOrbitRadius: 3 },
        { name: 'Saturn', size: 1.5, color: '#d2b99a', orbitRadius: 35, orbitSpeed: 0.006, rotationSpeed: 0.04, rings: true, moons: 3, moonSize: 0.2, moonOrbitRadius: 2.5 },
        { name: 'Uranus', size: 1.2, color: '#a0d2db', orbitRadius: 45, orbitSpeed: 0.004, rotationSpeed: 0.02, moons: 2, moonSize: 0.1, moonOrbitRadius: 1.8 },
        { name: 'Neptune', size: 1.1, color: '#5b8e7c', orbitRadius: 55, orbitSpeed: 0.003, rotationSpeed: 0.03, moons: 1, moonSize: 0.1, moonOrbitRadius: 1.5 }
    ];

    planetsData.forEach(pData => {
        // Create a group for the planet and its orbit
        const planetOrbitGroup = new THREE.Group();
        solarSystemGroup.add(planetOrbitGroup);

        const planetMaterial = createPlanetMaterial(pData.color, {});
        const planet = new THREE.Mesh(new THREE.SphereGeometry(pData.size, 32, 32), planetMaterial);
        planet.position.x = pData.orbitRadius; // Initial position on orbit
        planet.name = pData.name;
        planet.userData = {
            type: 'Planet',
            mass: `${(Math.random() * 10).toFixed(2)}e${Math.floor(Math.random() * 20) + 20} kg`,
            radius: `${(pData.size * 500).toFixed(0)} km`,
            distance: `${pData.orbitRadius} AU`,
            orbitSpeed: pData.orbitSpeed,
            rotationSpeed: pData.rotationSpeed,
            isPlanet: true
        };
        planetOrbitGroup.add(planet);
        interactableObjects.push(planet);

        // Add to orbit group for animation
        planetOrbitGroup.userData.orbitSpeed = pData.orbitSpeed;
        planet.userData.rotationSpeed = pData.rotationSpeed;

        // Moons
        if (pData.moons > 0) {
            for (let i = 0; i < pData.moons; i++) {
                const moonMaterial = createPlanetMaterial('#cccccc', { fresnelBias: 0.05, fresnelScale: 0.5, fresnelPower: 1.5 });
                const moon = new THREE.Mesh(new THREE.SphereGeometry(pData.moonSize, 16, 16), moonMaterial);
                const moonOrbitAngle = (Math.PI * 2 / pData.moons) * i;
                moon.position.set(
                    Math.cos(moonOrbitAngle) * pData.moonOrbitRadius,
                    Math.sin(moonOrbitAngle) * pData.moonOrbitRadius * 0.5, // Slight inclination
                    Math.sin(moonOrbitAngle) * pData.moonOrbitRadius
                );
                moon.name = `${pData.name} Moon ${i + 1}`;
                moon.userData = {
                    type: 'Moon',
                    mass: `${(Math.random() * 1).toFixed(2)}e${Math.floor(Math.random() * 5) + 20} kg`,
                    radius: `${(pData.moonSize * 100).toFixed(0)} km`,
                    distance: `${pData.moonOrbitRadius} km from ${pData.name}`,
                    orbitSpeed: pData.orbitSpeed * 3, // Faster moon orbit
                    rotationSpeed: pData.rotationSpeed * 2
                };
                planet.add(moon); // Moon orbits the planet
                interactableObjects.push(moon);
            }
        }

        // Saturn's Rings
        if (pData.rings) {
            const ringGeometry = new THREE.RingGeometry(pData.size * 1.2, pData.size * 2, 64);
            const ringMaterial = new THREE.MeshStandardMaterial({
                color: '#8c7d6b',
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6
            });
            const rings = new THREE.Mesh(ringGeometry, ringMaterial);
            rings.rotation.x = Math.PI / 2; // Lie flat
            planet.add(rings);
        }
    });

    // Asteroid Belt
    const asteroidCount = 1000;
    const asteroidMinRadius = 18;
    const asteroidMaxRadius = 22;
    const asteroidBeltGroup = new THREE.Group();
    solarSystemGroup.add(asteroidBeltGroup);

    for (let i = 0; i < asteroidCount; i++) {
        const asteroidGeometry = new THREE.SphereGeometry(Math.random() * 0.1 + 0.05, 8, 8);
        const asteroidMaterial = new THREE.PointsMaterial({
            size: 0.05,
            sizeAttenuation: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            color: new THREE.Color(0.8, 0.8, 0.8)
        });
        const asteroid = new THREE.Points(asteroidGeometry, asteroidMaterial);

        const radius = asteroidMinRadius + Math.random() * (asteroidMaxRadius - asteroidMinRadius);
        const angle = Math.random() * Math.PI * 2;
        const yOffset = (Math.random() - 0.5) * 2; // Spread along Y axis

        asteroid.position.set(
            Math.cos(angle) * radius,
            yOffset,
            Math.sin(angle) * radius
        );
        asteroid.name = `Asteroid ${i + 1}`;
        asteroid.userData = {
            type: 'Asteroid',
            mass: `${(Math.random() * 0.01).toFixed(2)}e15 kg`,
            radius: `${(asteroid.geometry.parameters.radius * 10).toFixed(0)} km`,
            distance: `${radius.toFixed(1)} AU`,
            orbitSpeed: 0.001 + Math.random() * 0.002 // Randomize speed
        };
        asteroidBeltGroup.add(asteroid);
        interactableObjects.push(asteroid);
    }
    asteroidBeltGroup.userData.orbitSpeed = 0.0005; // Belt rotates as a whole

    // Hide loading screen once generated
    loading.style.opacity = 0;
};

generateSolarSystem();

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
const gui = new GUI({ title: 'System Settings' });
gui.close(); // Closed by default on mobile

const galaxyFolder = gui.addFolder('Galaxy Background');
galaxyFolder.add(galaxyParameters, 'count').min(1000).max(200000).step(1000).onFinishChange(generateGalaxyBackground).name('Stars');
galaxyFolder.add(galaxyParameters, 'radius').min(100).max(500).step(1).onFinishChange(generateGalaxyBackground);
galaxyFolder.add(galaxyParameters, 'branches').min(2).max(10).step(1).onFinishChange(generateGalaxyBackground);
galaxyFolder.addColor(galaxyParameters, 'insideColor').onFinishChange(generateGalaxyBackground);
galaxyFolder.addColor(galaxyParameters, 'outsideColor').onFinishChange(generateGalaxyBackground);
galaxyFolder.add(bloomPass, 'strength').min(0).max(3).step(0.01).name('Bloom Strength');

const systemFolder = gui.addFolder('Solar System');
systemFolder.add({ regenerate: generateSolarSystem }, 'regenerate').name('Regenerate System');

// --- INTERACTION ---
let isExploding = false; // For galaxy background
let animationFrameId = null; // To manage the animation loop
let targetCameraPosition = new THREE.Vector3();
let targetControlsTarget = new THREE.Vector3();
let cameraFocusActive = false;
let cameraFocusSpeed = 0.05;

function focusCameraOn(object) {
    if (!object) return;

    currentFocusedObject = object;
    const objectWorldPosition = new THREE.Vector3();
    object.getWorldPosition(objectWorldPosition);

    targetControlsTarget.copy(objectWorldPosition);

    // Calculate a good distance to view the object
    let distance = 10;
    if (object.geometry && object.geometry.parameters && object.geometry.parameters.radius) {
        distance = object.geometry.parameters.radius * 3; // 3x the object's radius
        if(object.userData.isStar) distance = object.geometry.parameters.radius * 1.5; // Closer for star
    } else {
        // Default distance if no radius (e.g., asteroid points)
        distance = 3;
    }
    distance = Math.max(distance, 3); // Minimum distance

    // Calculate new camera position relative to the object
    // Keep current camera angle relative to target
    const currentOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const newOffset = currentOffset.normalize().multiplyScalar(distance + 5); // Add buffer for viewing

    targetCameraPosition.copy(objectWorldPosition).add(newOffset);
    
    // Ensure the camera doesn't go below the 'plane' of the solar system too much
    if (targetCameraPosition.y < -5) targetCameraPosition.y = -5;
    if (targetCameraPosition.y > 20) targetCameraPosition.y = 20;

    controls.autoRotate = false; // Disable auto-rotate when focusing
    cameraFocusActive = true;

    // Display info panel
    displayPlanetInfo(object.name, object.userData);
}

function resetCameraFocus() {
    currentFocusedObject = null;
    targetControlsTarget.set(0, 0, 0); // Back to sun
    targetCameraPosition.set(0, 10, 20); // Initial camera position
    cameraFocusActive = true; // Still activate smooth transition
    controls.autoRotate = true; // Re-enable auto-rotate
    hidePlanetInfo();
}

function displayPlanetInfo(name, data) {
    planetNameElem.textContent = name;
    planetTypeElem.textContent = data.type || 'Unknown';
    planetMassElem.textContent = data.mass || 'N/A';
    planetRadiusElem.textContent = data.radius || 'N/A';
    planetDistanceElem.textContent = data.distance || 'N/A';
    planetInfoPanel.style.display = 'block';
}

function hidePlanetInfo() {
    planetInfoPanel.style.display = 'none';
}

closePlanetInfoBtn.addEventListener('click', resetCameraFocus);

renderer.domElement.addEventListener('pointerdown', (event) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;

    // Update pointer coordinates for raycasting
    pointer.x = ( ( event.clientX || event.changedTouches[0].clientX ) / window.innerWidth ) * 2 - 1;
    pointer.y = - ( ( event.clientY || event.changedTouches[0].clientY ) / window.innerHeight ) * 2 + 1;

    if (tapLength < DOUBLE_TAP_THRESHOLD && tapLength > 0) {
        // Double Tap: Reset camera focus
        resetCameraFocus();
        event.preventDefault(); // Prevent accidental browser zoom on mobile
        lastTapTime = 0; // Reset
    } else {
        lastTapTime = currentTime;
    }
});

// Single tap to select object
renderer.domElement.addEventListener('pointerup', (event) => {
    // Check if it was a quick tap, not a drag
    const currentTime = new Date().getTime();
    if ((currentTime - lastTapTime) > DOUBLE_TAP_THRESHOLD || (currentTime - lastTapTime) < 50) { // If it was a long press or very short, ignore as it might be a drag end or invalid tap
        return;
    }

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(interactableObjects, true);

    if (intersects.length > 0) {
        // Get the parent object that is a planet/asteroid, not a moon of a moon or internal mesh
        let selectedObject = intersects[0].object;
        while(selectedObject && !selectedObject.userData.isPlanet && !selectedObject.userData.isStar && selectedObject.parent !== solarSystemGroup && selectedObject.parent !== scene) {
            selectedObject = selectedObject.parent;
        }

        if (selectedObject && (selectedObject.userData.isPlanet || selectedObject.userData.isStar || selectedObject.userData.type === 'Asteroid' || selectedObject.userData.type === 'Moon')) {
            focusCameraOn(selectedObject);
        }
    }
});


// --- ANIMATION LOOP ---
const clock = new THREE.Clock();

const tick = () => {
    const elapsedTime = clock.getElapsedTime();

    // Update Galaxy Background Shaders
    if(galaxyMaterial) {
        galaxyMaterial.uniforms.uTime.value = elapsedTime;
        // Keep explosion uniform as 0 for background unless you want a galaxy "boom"
        // galaxyMaterial.uniforms.uExplosion.value = THREE.MathUtils.lerp(galaxyMaterial.uniforms.uExplosion.value, 0, 0.05);
    }

    // Update Solar System
