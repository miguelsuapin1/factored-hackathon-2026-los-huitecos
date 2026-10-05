// Volcano-contour backdrop, adapted from src/components/QuetzalBackdrop.tsx (dark theme) for a fixed 2000 x 1125 slide.
(async function () {
  await document.fonts.ready;
  const PEAKS = [
    { x: 0.16, y: 0.8, s: 1.0, name: "AGUA · 3,760 m", seed: 1.3, hot: false },
    { x: 0.58, y: 0.46, s: 0.82, name: "FUEGO · 3,763 m", seed: 2.7, hot: true },
    { x: 0.8, y: 0.34, s: 0.9, name: "ACATENANGO · 3,976 m", seed: 4.1, hot: false },
  ];
  const canvas = document.querySelector(".backdrop canvas");
  const W = 2000, H = 1125, dpr = 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  const line = "120, 220, 190", minor = 0.04, major = 0.095;
  const unit = Math.min(W, H) * 1.25;
  for (const p of PEAKS) {
    const cx = p.x * W, cy = p.y * H;
    for (let k = 1; k <= 26; k++) {
      const base = k * unit * 0.024 * p.s;
      g.beginPath();
      for (let a = 0; a <= 360; a += 2) {
        const t = (a * Math.PI) / 180;
        const n = Math.sin(t * 3 + p.seed + k * 0.23) * 0.07 + Math.sin(t * 5 - p.seed * 1.7 + k * 0.11) * 0.045 + Math.cos(t * 2 + k * 0.31 + p.seed) * 0.06;
        const r = base * (1 + n * Math.min(1, k / 6));
        const x = cx + Math.cos(t) * r * 1.18, y = cy + Math.sin(t) * r * 0.86;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      const isMajor = k % 5 === 0;
      g.strokeStyle = `rgba(${line}, ${isMajor ? major : minor})`;
      g.lineWidth = isMajor ? 1.3 : 1;
      g.stroke();
    }
    if (p.hot) {
      g.fillStyle = `rgba(${line}, ${major * 2})`;
      g.font = '500 12px "Geist Mono", "Geist Mono Local", monospace';
      g.fillText(p.name, cx + 12, cy - 8);
    }
    g.beginPath();
    g.arc(cx, cy, 2.6, 0, Math.PI * 2);
    g.fillStyle = p.hot ? "rgba(255, 90, 82, 0.6)" : `rgba(${line}, ${major * 4})`;
    g.fill();
  }
})();
