function generateOverlay() {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    const headline = document.getElementById('headline').value;
    const subtitle = document.getElementById('subtitle').value;
    const bgColor = document.getElementById('bg-color').value;
    const textColor = document.getElementById('text-color').value;
    const style = document.getElementById('style-preset').value;
    const iconClass = document.getElementById('icon').value;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Algorithm: Procedural generation based on style
    let gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    if (style === 'news') {
        gradient.addColorStop(0, bgColor);
        gradient.addColorStop(1, lightenColor(bgColor, 20)); // Subtle variation
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 120, canvas.width, 80); // Lower third bar
    } else if (style === 'twitch') {
        gradient.addColorStop(0, '#6441a5'); // Twitch purple vibe
        gradient.addColorStop(1, bgColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.shadowColor = 'rgba(255,255,255,0.5)';
        ctx.shadowBlur = 10; // Neon glow
    } else { // Modern
        ctx.fillStyle = bgColor;
        ctx.fillRect(50, 140, canvas.width - 100, 50);
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(50, 140, canvas.width - 100, 50);
    }

    // Draw text with auto-fit
    ctx.fillStyle = textColor;
    ctx.font = 'bold 40px Arial';
    ctx.fillText(headline, 60, 160);
    ctx.font = '24px Arial';
    ctx.fillText(subtitle, 60, 190);

    // Add icon if selected
    if (iconClass) {
        ctx.font = '40px FontAwesome';
        ctx.fillText(getIconUnicode(iconClass), 20, 160);
    }

    // Reset shadow
    ctx.shadowBlur = 0;
}

// Helper: Lighten color for gradient variation
function lightenColor(color, percent) {
    let num = parseInt(color.slice(1), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        G = (num >> 8 & 0x00FF) + amt,
        B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
}

// Icon mapping (add more as needed)
function getIconUnicode(className) {
    const icons = {
        'fa-newspaper': '\uf1ea',
        'fa-video': '\uf03d',
        'fa-star': '\uf005'
    };
    return icons[className] || '';
}

function exportPNG() {
    const canvas = document.getElementById('preview-canvas');
    const link = document.createElement('a');
    link.download = 'overlay.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function exportSVG() {
    // Simple SVG export (expand for full canvas mirroring)
    const headline = document.getElementById('headline').value;
    const subtitle = document.getElementById('subtitle').value;
    const bgColor = document.getElementById('bg-color').value;
    const textColor = document.getElementById('text-color').value;
    
    const svg = `<svg width="800" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="120" width="800" height="80" fill="${bgColor}"/>
        <text x="60" y="160" font-size="40" font-weight="bold" fill="${textColor}">${headline}</text>
        <text x="60" y="190" font-size="24" fill="${textColor}">${subtitle}</text>
    </svg>`;
    
    const blob = new Blob([svg], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'overlay.svg';
    link.href = url;
    link.click();
}