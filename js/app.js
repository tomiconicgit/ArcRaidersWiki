import { ThreeScene } from './ThreeScene.js';
import { Ticker } from './Ticker.js';
import { Recorder } from './Recorder.js';
import GUI from 'lil-gui';

// Initialize Modules
const container = document.getElementById('canvas-container');
const sceneManager = new ThreeScene(container);
const ticker = new Ticker();
const recorder = new Recorder(sceneManager.renderer.domElement);

// Connect Ticker to Scene
sceneManager.addTicker(ticker);

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    ticker.update(); // Update text position
    sceneManager.update(); // Render 3D scene
}
animate();

// --- Setup Controls (GUI) ---
const gui = new GUI({ title: 'Editor Settings' });

// 1. Ticker Settings
const folderText = gui.addFolder('News Ticker');
folderText.add(ticker, 'text').name('Headline Text');
folderText.add(ticker, 'speed', 0, 10).name('Scroll Speed');
folderText.addColor(ticker, 'bgColor').name('Bar Color');
folderText.addColor(ticker, 'textColor').name('Text Color');

// 2. Position Settings
const folderPos = gui.addFolder('Overlay Position');
folderPos.add(sceneManager.tickerMesh.position, 'y', -5, 5).name('Vertical Pos');
folderPos.add(sceneManager.tickerMesh.rotation, 'x', -1, 1).name('Tilt X');
folderPos.add(sceneManager.tickerMesh.rotation, 'y', -1, 1).name('Tilt Y');

// 3. Green Screen Settings
const folderGlobal = gui.addFolder('Global');
const params = { background: '#00ff00' };
folderGlobal.addColor(params, 'background').name('Chroma Key').onChange(val => {
    sceneManager.scene.background.set(val);
});

// --- Recording Logic ---
const recordBtn = document.getElementById('record-btn');

recordBtn.addEventListener('click', async () => {
    if (!recorder.isRecording) {
        recorder.start();
        recordBtn.innerText = "■ STOP";
        recordBtn.classList.add('recording');
        gui.hide(); // Hide controls during recording
    } else {
        await recorder.stop();
        recordBtn.innerText = "● REC";
        recordBtn.classList.remove('recording');
        gui.show(); // Show controls again
    }
});
