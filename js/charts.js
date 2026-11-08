// The dashboard's charts, drawn as SVG at the width of their card.

import { h, svgEl, fmt, fmtShort } from './ui.js';

const label = (attrs, value) => { const t = svgEl('text', attrs); t.textContent = value; return t; };
const paint = (el, color) => { el.style.fill = color; return el; };

/** Rounded at the far end only, so bars sit flat on their baseline. */
function barPath(x, from, to, w, radius = 4) {
  const dir = to < from ? -1 : 1;
  const r = Math.min(radius, w / 2, Math.abs(from - to));
  return `M${x},${from}V${to - dir * r}Q${x},${to} ${x + r},${to}H${x + w - r}Q${x + w},${to} ${x + w},${to - dir * r}V${from}Z`;
}

function niceScale(peak) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(peak, 100)));
  const step = [0.5, 1, 2, 2.5, 5, 10].map(m => m * pow).find(s => peak / s <= 4);
  return { step, top: Math.ceil(peak / step) * step || step };
}

/** Redraws at the card's real width, including after a phone rotates. */
function plot(height, draw) {
  const box = h('div', { class: 'chart-plot' });
  box.style.minHeight = `${height}px`;
  let last = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width && width !== last) { last = width; box.replaceChildren(); draw(box, width); }
  }).observe(box);
  return box;
}

function tooltip(box) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  box.append(tip);
  return {
    show(x, y, lines) {
      tip.replaceChildren(...lines);
      tip.hidden = false;
      tip.style.left = `${Math.max(2, Math.min(x + 12, box.clientWidth - tip.offsetWidth - 2))}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

const pointerIn = (svg, e) => {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

export const legend = items => h('div', { class: 'legend' }, items.map(item => {
  const swatch = h('i', { class: item.dashed ? 'swatch dashed' : 'swatch' });
  swatch.style.setProperty('--swatch', item.color);
  return h('span', {}, swatch, item.name);
}));

/** The shared frame for month-by-month columns: axis, month labels, selection and hover. */
function columnPlot({ labels, full, selected, onPick, peak, height = 230, drawColumn, tipLines, scale = niceScale, tickText = fmtShort }) {
  return plot(height, (box, W) => {
    const left = 44, top = 12, bottom = 26, H = height, baseline = H - bottom;
    const { step, top: ceil } = scale(Math.max(1, peak));
    const y = v => baseline - (Math.max(0, v) / ceil) * (baseline - top);
    const band = (W - left) / labels.length;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    if (selected >= 0) svg.append(svgEl('rect', { x: left + band * selected, y: top - 6, width: band, height: baseline - top + 6, rx: 4, class: 'band' }));
    for (let v = 0; v <= ceil; v += step) {
      svg.append(svgEl('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(label({ x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, tickText(v)));
    }
    box.append(svg);
    const tip = tooltip(box);
    labels.forEach((name, i) => {
      const cx = left + band * i + band / 2;
      drawColumn(svg, i, cx, band, y, baseline);
      svg.append(label({ x: cx, y: H - 8, 'text-anchor': 'middle', class: `tick${i === selected ? ' strong-tick' : ''}` }, W < 460 ? name[0] : name));
      const hit = svgEl('rect', { x: left + band * i, y: 0, width: band, height: H, fill: 'transparent', class: onPick ? 'pickable' : '' });
      hit.addEventListener('pointermove', e => { const p = pointerIn(svg, e); tip.show(p.x, p.y, [h('strong', {}, full[i]), ...tipLines(i)]); });
      hit.addEventListener('pointerleave', tip.hide);
      if (onPick) hit.addEventListener('click', () => onPick(i));
      svg.append(hit);
    });
  });
}

/** A series can carry `onTop`, a second amount drawn as a segment above its own column. */
export function groupedBars({ labels, full, series, selected = -1, onPick, footer, height }) {
  const positive = v => Math.max(0, v);
  const peak = Math.max(1, ...series.flatMap(s => s.values.map((v, i) => positive(v) + positive(s.onTop?.values[i] ?? 0))));
  const named = series.flatMap(s => (s.onTop ? [s, s.onTop] : [s]));
  const chart = columnPlot({
    labels, full, selected, onPick, peak, height,
    drawColumn(svg, i, cx, band, y, baseline) {
      const w = Math.min(24, (band - 6) / series.length - 1);
      series.forEach((s, n) => {
        const v = positive(s.values[i]);
        const extra = positive(s.onTop?.values[i] ?? 0);
        const x = cx - (series.length * (w + 2)) / 2 + n * (w + 2) + 1;
        if (v > 0) {
          const d = extra > 0 ? `M${x},${baseline}V${y(v)}H${x + w}V${baseline}Z` : barPath(x, baseline, y(v), w);
          svg.append(paint(svgEl('path', { d }), s.color));
        }
        if (extra > 0) {
          const from = v > 0 ? y(v) - 2 : baseline;
          svg.append(paint(svgEl('path', { d: barPath(x, from, Math.min(y(v + extra), from - 0.5), w) }), s.onTop.color));
        }
      });
    },
    tipLines: i => [...named.map(s => h('div', {}, `${s.name} ${fmt(s.values[i])}`)), ...(footer ? [h('div', {}, footer(i))] : [])],
  });
  return h('div', { class: 'chart' }, named.length > 1 && legend(named), chart);
}

function drawStack(svg, i, cx, band, y, series, labelOf) {
  const w = Math.min(48, band - 8);
  const shown = series.filter(s => s.values[i] > 0);
  let sum = 0;
  shown.forEach((s, n) => {
    const from = y(sum);
    sum += s.values[i];
    const gap = n ? 1 : 0;
    const to = Math.min(y(sum), from - gap - 0.5);
    const d = n === shown.length - 1 ? barPath(cx - w / 2, from - gap, to, w) : `M${cx - w / 2},${from - gap}V${to + 1}H${cx + w / 2}V${from - gap}Z`;
    svg.append(paint(svgEl('path', { d }), s.color));
    // A segment too short to hold its number leaves it to the tooltip.
    if (labelOf && from - gap - to >= 14 && w >= 12) {
      svg.append(label({ x: cx, y: (from - gap + to) / 2 + 4, 'text-anchor': 'middle', class: `seg-label${s.neutral ? ' neutral' : ''}${w < 24 ? ' tiny' : ''}` }, labelOf(s, i, w)));
    }
  });
}

/**
 * Each column is one month's income as 100%. The axis grows past 100% only for a month
 * that went over, so an overspent month is visibly taller instead of being squashed to fit.
 */
export function shareBars({ labels, full, series, incomes, selected = -1, onPick, height = 200 }) {
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const chart = columnPlot({
    labels, full, selected, onPick, height,
    peak: Math.max(100, ...totals),
    scale: peak => ({ step: 25, top: Math.ceil(peak / 25) * 25 }),
    tickText: v => `${v}%`,
    drawColumn(svg, i, cx, band, y) {
      drawStack(svg, i, cx, band, y, series, (s, n, w) => `${Math.round(s.values[n])}${w >= 30 ? '%' : ''}`);
    },
    tipLines: i => (incomes[i] > 0
      ? [h('div', {}, `Income ${fmt(incomes[i])}`), ...series.filter(s => s.cents[i] > 0).map(s => h('div', {}, `${s.name} ${Math.round(s.values[i])}% · ${fmt(s.cents[i])}`))]
      : [h('div', {}, 'No income this month')]),
  });
  return h('div', { class: 'chart' }, legend(series), chart);
}

/** Segments keep a fixed order and color, so a category looks the same in every month. */
export function stackedBars({ labels, full, series, selected = -1, onPick }) {
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i]), 0));
  const chart = columnPlot({
    labels, full, selected, onPick, peak: Math.max(1, ...totals),
    drawColumn(svg, i, cx, band, y) { drawStack(svg, i, cx, band, y, series); },
    tipLines: i => [
      h('div', {}, `Total ${fmt(totals[i])}`),
      ...[...series].filter(s => s.values[i] > 0).sort((a, b) => b.values[i] - a.values[i]).map(s => h('div', {}, `${s.name} ${fmt(s.values[i])}`)),
    ],
  });
  return h('div', { class: 'chart' }, legend(series), chart);
}

/** Above the line is money saved, below is money overspent. */
export function divergingBars({ labels, full, values, selected = -1, onPick, height = 210 }) {
  const up = 'var(--series-income)';
  const down = 'var(--series-expense)';
  const chart = plot(height, (box, W) => {
    const left = 44, top = 10, bottom = 26, H = height, floor = H - bottom;
    const high = Math.max(0, ...values);
    const low = Math.min(0, ...values);
    const { step } = niceScale(Math.max(1, high, -low));
    const max = Math.ceil(high / step) * step;
    const min = Math.floor(low / step) * step;
    const span = max - min || step;
    const y = v => top + ((max - v) / span) * (floor - top);
    const band = (W - left) / labels.length;
    const w = Math.min(48, band - 8);
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    if (selected >= 0) svg.append(svgEl('rect', { x: left + band * selected, y: top - 6, width: band, height: floor - top + 6, rx: 4, class: 'band' }));
    for (let v = min; v <= max; v += step) {
      svg.append(svgEl('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: v === 0 ? 'zero-line' : 'grid' }));
      svg.append(label({ x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, fmtShort(v)));
    }
    box.append(svg);
    const tip = tooltip(box);
    labels.forEach((name, i) => {
      const cx = left + band * i + band / 2;
      if (values[i]) svg.append(paint(svgEl('path', { d: barPath(cx - w / 2, y(0), y(values[i]), w) }), values[i] > 0 ? up : down));
      svg.append(label({ x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, W < 460 ? name[0] : name));
      const hit = svgEl('rect', { x: left + band * i, y: 0, width: band, height: H, fill: 'transparent', class: onPick ? 'pickable' : '' });
      hit.addEventListener('pointermove', e => {
        const p = pointerIn(svg, e);
        tip.show(p.x, p.y, [h('strong', {}, full[i]), h('div', {}, `${values[i] < 0 ? 'Overspent' : 'Saved'} ${fmt(Math.abs(values[i]))}`)]);
      });
      hit.addEventListener('pointerleave', tip.hide);
      if (onPick) hit.addEventListener('click', () => onPick(i));
      svg.append(hit);
    });
  });
  return h('div', { class: 'chart' }, legend([{ name: 'Saved', color: up }, { name: 'Overspent', color: down }]), chart);
}

/** Running total of spending through the month. Earlier series are context, so they stay gray. */
export function paceLine({ days, series, height = 220 }) {
  const chart = plot(height, (box, W) => {
    const left = 44, right = 46, top = 14, bottom = 26, H = height, floor = H - bottom;
    const peak = Math.max(1, ...series.flatMap(s => s.values));
    const { step, top: ceil } = niceScale(peak);
    const x = day => left + ((day - 1) / Math.max(1, days - 1)) * (W - left - right);
    const y = v => floor - (Math.max(0, v) / ceil) * (floor - top);
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    for (let v = 0; v <= ceil; v += step) {
      svg.append(svgEl('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), class: 'grid' }));
      svg.append(label({ x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, fmtShort(v)));
    }
    for (const day of [1, 8, 15, 22, 29].filter(d => d <= days)) {
      svg.append(label({ x: x(day), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, String(day)));
    }
    const ends = [];
    for (const s of [...series].reverse()) {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const line = svgEl('path', { d, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      line.style.stroke = s.color;
      if (s.dashed) line.setAttribute('stroke-dasharray', '5 4');
      svg.append(line);
      const lastDay = s.values.length;
      const dot = svgEl('circle', { cx: x(lastDay), cy: y(s.values[lastDay - 1]), r: 4, class: 'dot' });
      dot.style.fill = s.color;
      svg.append(dot);
      ends.push({ s, px: x(lastDay), py: y(s.values[lastDay - 1]) });
    }
    if (ends.length === 2 && Math.abs(ends[0].py - ends[1].py) < 14) {
      const [upper, lower] = ends[0].py < ends[1].py ? ends : [ends[1], ends[0]];
      upper.py -= 7; lower.py += 7;
    }
    for (const e of ends) svg.append(label({ x: e.px + 8, y: e.py + 4, class: 'tick end-label' }, e.s.name.slice(0, 3)));

    const cross = svgEl('line', { y1: top, y2: floor, class: 'crosshair', visibility: 'hidden' });
    svg.append(cross);
    box.append(svg);
    const tip = tooltip(box);
    const hit = svgEl('rect', { x: left, y: 0, width: W - left - right + 1, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', e => {
      const p = pointerIn(svg, e);
      const day = Math.max(1, Math.min(days, Math.round(1 + ((p.x - left) / (W - left - right)) * (days - 1))));
      cross.setAttribute('x1', x(day)); cross.setAttribute('x2', x(day));
      cross.setAttribute('visibility', 'visible');
      tip.show(p.x, p.y, [h('strong', {}, `By day ${day}`), ...series.filter(s => day <= s.values.length).map(s => h('div', {}, `${s.name} ${fmt(s.values[day - 1])}`))]);
    });
    hit.addEventListener('pointerleave', () => { tip.hide(); cross.setAttribute('visibility', 'hidden'); });
    svg.append(hit);
  });
  return h('div', { class: 'chart' }, legend(series), chart);
}

/** One ranked row. Length is the only encoding, so every bar stays one color. */
export function rankRow({ name, cents, max, note, onClick, expanded, budget = 0 }) {
  const pct = value => `${Math.max(0, (value / Math.max(1, max)) * 100)}%`;
  const over = budget > 0 && cents > budget;
  const fill = h('span', { class: 'bar-fill' });
  fill.style.width = pct(over ? budget : cents);
  const track = h('span', { class: 'bar-track' }, fill);
  if (over) {
    const extra = h('span', { class: 'bar-over' });
    extra.style.left = pct(budget);
    extra.style.width = pct(cents - budget);
    track.append(extra);
  }
  if (budget > 0) {
    const target = h('span', { class: 'bar-target' });
    target.style.left = pct(budget);
    track.append(target);
  }
  const parts = [
    h('span', { class: 'bar-label' }, name),
    h('span', { class: 'bar-value' }, fmt(cents), note ? h('span', { class: 'muted bar-pct' }, note) : false),
    track,
    budget > 0 && h('span', { class: `bar-note${over ? ' over' : ''}` },
      over ? `⚑ ${fmt(cents - budget)} over ${fmt(budget)} budget` : `${fmt(budget - cents)} left of ${fmt(budget)}`),
  ];
  return onClick
    ? h('button', { class: 'bar-row', 'aria-expanded': String(Boolean(expanded)), onclick: onClick }, parts)
    : h('div', { class: 'bar-row static' }, parts);
}
