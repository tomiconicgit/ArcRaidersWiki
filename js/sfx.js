let audioCtx = null;

function ensure() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export async function clickSound() {
  const ctx = ensure();
  if (ctx.state === "suspended") await ctx.resume();

  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 880;

  g.gain.value = 0.0001;
  o.connect(g).connect(ctx.destination);

  const t = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

  o.start(t);
  o.stop(t + 0.07);
}

export async function pingSound() {
  const ctx = ensure();
  if (ctx.state === "suspended") await ctx.resume();

  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(540, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.12);

  g.gain.value = 0.0001;
  o.connect(g).connect(ctx.destination);

  const t = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

  o.start(t);
  o.stop(t + 0.2);
}