export class Recorder {
    constructor(canvas) {
        this.canvas = canvas;
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;
    }

    start() {
        const stream = this.canvas.captureStream(30); // 30 FPS
        
        // iOS Safari prefers specific mimeTypes. 
        // We try to find the best supported one.
        const mimeTypes = [
            "video/mp4; codecs=hvc1", // High efficiency for Apple
            "video/webm; codecs=vp9",
            "video/webm"
        ];
        
        let options = { mimeType: "" };
        for (let type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                options.mimeType = type;
                console.log(`Using mimeType: ${type}`);
                break;
            }
        }

        try {
            this.mediaRecorder = new MediaRecorder(stream, options.mimeType ? options : undefined);
        } catch (e) {
            alert("MediaRecorder not supported on this browser version.");
            return;
        }

        this.chunks = [];
        this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
        this.mediaRecorder.start();
        this.isRecording = true;
        console.log("Recording started");
    }

    async stop() {
        return new Promise((resolve) => {
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: 'video/mp4' });
                const url = URL.createObjectURL(blob);
                
                // Trigger download
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `overlay-export-${Date.now()}.mp4`;
                document.body.appendChild(a);
                a.click();
                
                // Cleanup
                setTimeout(() => {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                }, 100);
                
                this.isRecording = false;
                resolve();
            };
            this.mediaRecorder.stop();
        });
    }
}
