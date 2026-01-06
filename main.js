import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const container = document.getElementById('container');
const infoPanel = document.getElementById('info-panel');
const queryInput = document.getElementById('query-input');
const querySelect = document.getElementById('query-select');
const submitBtn = document.getElementById('submit-btn');

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x112233);
scene.fog = new THREE.Fog(0x112233, 10, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

// Post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
composer.addPass(bloomPass);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

// Ground (procedural terrain)
const groundGeometry = new THREE.PlaneGeometry(100, 100, 50, 50);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228822, roughness: 0.8 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Add some hills (sinusoidal displacement)
const position = groundGeometry.attributes.position;
for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, Math.sin(x * 0.1) * 2 + Math.cos(z * 0.1) * 2);
}
groundGeometry.computeVertexNormals();

// Locations data (fictional coordinates based on game maps)
const locations = {
    'Olive Grove': { pos: new THREE.Vector3(0, 0, 0), plants: ['lemon', 'apricot', 'olive'], desc: 'Fruit trees area in Blue Gate. Kick trees for more yield.' },
    'Library Gardens': { pos: new THREE.Vector3(15, 0, 5), plants: ['lemon'], desc: 'Green area in Buried City.' },
    'Town Hall Gardens': { pos: new THREE.Vector3(20, 0, -10), plants: ['apricot'], desc: 'Gardens in Buried City.' },
    'Hydroponic Dome': { pos: new THREE.Vector3(-10, 0, 20), plants: ['mushroom', 'moss', 'great mullein', 'torch ginger'], desc: 'Swampy herb spot in Dam Battlegrounds.' },
    'Red Lakes': { pos: new THREE.Vector3(-20, 0, 25), plants: ['prickly pear', 'agave', 'great mullein'], desc: 'Desert/swamp mix in Dam Battlegrounds.' },
    'Water Treatment Control': { pos: new THREE.Vector3(-5, 0, 30), plants: ['mushroom'], desc: 'Industrial swamp in Dam Battlegrounds.' },
    'Spaceport Shaded Areas': { pos: new THREE.Vector3(10, 0, -20), plants: ['mushroom', 'agave'], desc: 'South of Little Hangar in Spaceport.' },
    'Dam Battlegrounds': { pos: new THREE.Vector3(-15, 0, 10), plants: ['apricot', 'poisonous plant'], desc: 'Main battle area with various spawns.' },
    // Add more for items/ARC
    'Marano Park': { pos: new THREE.Vector3(25, 0, 15), plants: [], desc: 'Residential with fabric, bastion cells.' },
    'Industrial Zones': { pos: new THREE.Vector3(-25, 0, -15), plants: [], desc: 'Metal parts, plastic, hornet drivers.' }
};

// Markers (spheres with labels)
const markers = [];
const labels = [];
const loader = new THREE.FontLoader();
loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', (font) => {
    Object.keys(locations).forEach((name) => {
        const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x000000 });
        const marker = new THREE.Mesh(sphereGeo, sphereMat);
        marker.position.copy(locations[name].pos);
        marker.position.y += 1; // Above ground
        marker.castShadow = true;
        marker.userData = { name, desc: locations[name].desc };
        scene.add(marker);
        markers.push(marker);

        // 3D Text label
        const textGeo = new THREE.TextGeometry(name, { font, size: 1, height: 0.1 });
        const textMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const label = new THREE.Mesh(textGeo, textMat);
        label.position.copy(marker.position);
        label.position.y += 2;
        label.lookAt(camera.position);
        scene.add(label);
        labels.push(label);
    });
});

// Particles for highlights
const particleGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(500 * 3);
for (let i = 0; i < 500; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 2;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 2;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 2;
}
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMaterial = new THREE.PointsMaterial({ color: 0xffff00, size: 0.1, blending: THREE.AdditiveBlending });
const particles = new THREE.Points(particleGeometry, particleMaterial);
particles.visible = false;
scene.add(particles);

// Raycaster for clicks
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
container.addEventListener('click', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(markers);
    if (intersects.length > 0) {
        const data = intersects[0].object.userData;
        infoPanel.innerHTML = `<strong>${data.name}</strong>: ${data.desc}`;
        animateCameraTo(intersects[0].object.position);
    }
});

// Data for responses (based on game wiki data)
const plantData = {
    lemon: { locations: ['Olive Grove', 'Library Gardens'], uses: 'Restores stamina; used in Fruit Mix; Scrappy Level 3 upgrade.' },
    apricot: { locations: ['Olive Grove', 'Town Hall Gardens', 'Dam Battlegrounds'], uses: 'Stamina boost; used in Fruit Mix; Scrappy Level 3–4 upgrades.' },
    mushroom: { locations: ['Hydroponic Dome', 'Water Treatment Control', 'Spaceport Shaded Areas'], uses: 'Instant health healing; Scrappy Level 5 upgrade; advanced medical items.' },
    // Add more as needed
};
const itemData = {
    'fruit mix': { resources: 'Lemons + Apricots + Olives', desc: 'Crafted for stamina boosts.' },
    // Add more
};

// Query handler
function handleQuery(query) {
    query = query.toLowerCase().trim();
    let response = 'No info found. Try "where is [plant]" or "what is [plant] used for".';
    let highlightLocs = [];

    // Keyword matching
    if (query.includes('where is lemon')) {
        response = 'Lemons spawn at ' + plantData.lemon.locations.join(', ') + '. ' + plantData.lemon.uses;
        highlightLocs = plantData.lemon.locations;
    } else if (query.includes('where is apricot')) {
        response = 'Apricots spawn at ' + plantData.apricot.locations.join(', ') + '. ' + plantData.apricot.uses;
        highlightLocs = plantData.apricot.locations;
    } else if (query.includes('where is mushroom')) {
        response = 'Mushrooms spawn at ' + plantData.mushroom.locations.join(', ') + '. ' + plantData.mushroom.uses;
        highlightLocs = plantData.mushroom.locations;
    } else if (query.includes('what is lemon used for')) {
        response = plantData.lemon.uses;
        highlightLocs = plantData.lemon.locations;
    } else if (query.includes('what resources for fruit mix')) {
        response = 'Fruit Mix requires: ' + itemData['fruit mix'].resources + '. ' + itemData['fruit mix'].desc;
    } else if (query.includes('where is olive grove')) {
        response = locations['Olive Grove'].desc;
        highlightLocs = ['Olive Grove'];
    } else if (query.includes('where are arc enemies')) {
        response = 'ARC enemies like Bastions in Marano Park, Hornets in Industrial Zones.';
        highlightLocs = ['Marano Park', 'Industrial Zones'];
    }

    infoPanel.innerHTML = response;
    highlightLocations(highlightLocs);
    if (highlightLocs.length > 0) {
        const avgPos = new THREE.Vector3();
        highlightLocs.forEach(loc => avgPos.add(locations[loc].pos));
        avgPos.divideScalar(highlightLocs.length);
        animateCameraTo(avgPos);
    }
}

// Highlight
function highlightLocations(locs) {
    markers.forEach(marker => {
        marker.material.emissive.setHex(0x000000);
    });
    locs.forEach(loc => {
        const marker = markers.find(m => m.userData.name === loc);
        if (marker) marker.material.emissive.setHex(0xffff00);
    });
    particles.visible = locs.length > 0;
    if (locs.length > 0) particles.position.copy(locations[locs[0]].pos); // Simple, attach to first
}

// Animate camera
function animateCameraTo(targetPos) {
    const startPos = camera.position.clone();
    const endPos = targetPos.clone().add(new THREE.Vector3(0, 10, 15));
    let t = 0;
    const animate = () => {
        t += 0.01;
        if (t > 1) return;
        camera.position.lerpVectors(startPos, endPos, t);
        camera.lookAt(targetPos);
        requestAnimationFrame(animate);
    };
    animate();
}

// Event listeners
submitBtn.addEventListener('click', () => {
    const selected = querySelect.value;
    const typed = queryInput.value;
    handleQuery(selected || typed);
    queryInput.value = '';
    querySelect.value = '';
});
queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitBtn.click();
});
querySelect.addEventListener('change', () => {
    if (querySelect.value) submitBtn.click();
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Living animations
    markers.forEach((marker, i) => {
        marker.rotation.y += 0.01;
        labels[i].lookAt(camera.position);
    });

    // Particle animation
    if (particles.visible) {
        particles.rotation.y += 0.005;
    }

    composer.render();
}
animate();

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});