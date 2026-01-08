export class Ticker {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Configurable properties
        this.text = "BREAKING NEWS: PODCAST OVERLAY SYSTEM ONLINE • FOLLOW FOR MORE UPDATES • ";
        this.bgColor = "#cc0000";
        this.textColor = "#ffffff";
        this.font = "bold 60px Arial";
        this.speed = 2.0;
        
        // Internal state
        this.offset = 0;
        this.canvas.width = 2048; // High res texture
        this.canvas.height = 100;
        this.needsUpdate = true;
    }

    update() {
        // Move the text
        this.offset -= this.speed;
        
        // Clear background
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Text
        this.ctx.fillStyle = this.textColor;
        this.ctx.font = this.font;
        this.ctx.textBaseline = 'middle';
        
        // Measure text to loop it perfectly
        const textWidth = this.ctx.measureText(this.text).width;
        
        // Reset offset if we've scrolled past one full loop
        if (this.offset < -textWidth) {
            this.offset = 0;
        }

        // Draw the text twice to create a seamless loop effect
        this.ctx.fillText(this.text, this.offset, this.canvas.height / 2);
        this.ctx.fillText(this.text, this.offset + textWidth, this.canvas.height / 2);
        
        // If the screen is very wide, draw a third time just in case
        if (this.offset + textWidth < this.canvas.width) {
             this.ctx.fillText(this.text, this.offset + (textWidth * 2), this.canvas.height / 2);
        }
        
        this.needsUpdate = true;
    }
}
