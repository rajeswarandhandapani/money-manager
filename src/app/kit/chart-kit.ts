// Shared SVG chart math and pointer helpers (no DOM builders needed with Angular SVG templates).

/** Rounded at the far end only so bars sit flush on their baseline. */
export function barPath(x: number, from: number, to: number, w: number, radius = 4): string {
  const dir = to < from ? -1 : 1;
  const r = Math.min(radius, w / 2, Math.abs(from - to));
  return `M${x},${from}V${to - dir * r}Q${x},${to} ${x + r},${to}H${x + w - r}Q${x + w},${to} ${x + w},${to - dir * r}V${from}Z`;
}

export function niceScale(peak: number): { step: number; top: number } {
  const pow = 10 ** Math.floor(Math.log10(Math.max(peak, 10)));
  const step = [0.5, 1, 2, 2.5, 5, 10].map(m => m * pow).find(s => peak / s <= 4) || pow * 10;
  return { step, top: Math.ceil(peak / step) * step || step };
}

export function pointerIn(svg: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
