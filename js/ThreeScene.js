import * as THREE from 'three';

export class ThreeScene {
    constructor(container) {
        this.container = container;
        
        // 1. Setup Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x00ff00); // GREEN SCREEN DEFAULT

        // 2. Setup Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 5;

        // 3. Setup Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // 4. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 1);
        this.scene.add(ambientLight);

        // 5. Handle Resize
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    addTicker(ticker) {
        // Create a texture from the 2D canvas
        this.tickerTexture = new THREE.CanvasTexture(ticker.canvas);
        this.tickerTexture.minFilter = THREE.LinearFilter; // Smooth scaling
        
        // Create a plane for the ticker
        // Aspect ratio based on the canvas dimensions
        const aspect = ticker.canvas.width / ticker.canvas.height;
        const height = 1.5; 
        const width = height * aspect;

        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({ 
            map: this.tickerTexture,
            transparent: true
        });
        
        this.tickerMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.tickerMesh);
        
        // Position it at the bottom
        this.tickerMesh.position.y = -2.5;
    }

    update() {
        if (this.tickerTexture) {
            this.tickerTexture.needsUpdate = true;
        }
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
