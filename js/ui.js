let zTop = 40;

export function createPanel({ title, x = 12, y = 120, w = 340, h = 260, bodyHTML = "" }) {
  const el = document.createElement("div");
  el.className = "panel";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.zIndex = String(zTop++);

  el.innerHTML = `
    <div class="panelHeader">
      <div class="panelTitle">${escapeHtml(title)}</div>
      <div class="panelBtns">
        <button class="panelBtn" data-act="min" aria-label="Minimize">—</button>
        <button class="panelBtn" data-act="close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="panelBody">${bodyHTML}</div>
  `;

  const header = el.querySelector(".panelHeader");
  const body = el.querySelector(".panelBody");

  // Bring to front on touch
  el.addEventListener("pointerdown", () => {
    el.style.zIndex = String(zTop++);
  });

  // Drag by header with finger (gesture pinch also supported separately)
  let dragging = false;
  let startX = 0, startY = 0;
  let originL = 0, originT = 0;

  header.addEventListener("pointerdown", (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    originL = parseFloat(el.style.left);
    originT = parseFloat(el.style.top);
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const nextL = clamp(originL + dx, 8, window.innerWidth - el.offsetWidth - 8);
    const nextT = clamp(originT + dy, 8, window.innerHeight - el.offsetHeight - 90);
    el.style.left = `${nextL}px`;
    el.style.top = `${nextT}px`;
  });

  header.addEventListener("pointerup", () => { dragging = false; });

  // Buttons
  el.querySelectorAll(".panelBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "close") el.remove();
      if (act === "min") {
        const isHidden = body.style.display === "none";
        body.style.display = isHidden ? "block" : "none";
      }
    });
  });

  return el;
}

export function setPanelBody(panelEl, html) {
  panelEl.querySelector(".panelBody").innerHTML = html;
}

export function getPanelBody(panelEl) {
  return panelEl.querySelector(".panelBody");
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}