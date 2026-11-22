import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { fmt, fmtShort } from '../../domain/format';
import { MONTH_NAMES } from '../../domain/report';
import { barPath, niceScale } from '../../kit/chart-kit';

export interface ChartTipState {
  xPct: number;
  yPx: number;
  title: string;
  lines: string[];
}

export interface ShareItem {
  income: number;
  expense: number;
  savings: number;
  left: number;
  expensePct: number;
  savingsPct: number;
  leftPct: number;
}

const CAT_COLORS = [
  'var(--mm-c1)',
  'var(--mm-c2)',
  'var(--mm-c3)',
  'var(--mm-c4)',
  'var(--mm-c5)',
  'var(--mm-c6)',
];

function shortMonth(ym: string): string {
  const m = +ym.slice(5, 7) - 1;
  return MONTH_NAMES[m]?.slice(0, 3) ?? ym;
}

function fullMonthYear(ym: string): string {
  const m = +ym.slice(5, 7) - 1;
  return `${MONTH_NAMES[m] ?? ''} ${ym.slice(0, 4)}`;
}

function ticksFor(top: number, step: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= top + step * 0.01; v += step) out.push(Math.round(v));
  return out;
}

/* ============================================================
 * 1. Grouped Income vs Expense (+ Savings legend) Bars
 * ============================================================ */
@Component({
  selector: 'mm-grouped-bars-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><i class="swatch" style="--swatch: var(--mm-income)"></i>Income</span>
      <span><i class="swatch" style="--swatch: var(--mm-expense)"></i>Expense</span>
      <span><i class="swatch" style="--swatch: var(--mm-savings)"></i>Savings</span>
    </div>
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Income and expense by month"
        (pointerleave)="tip.set(null)"
      >
        @for (t of yTicks(); track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" class="stroke-base-300" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ fmtShort(t) }}</text>
        }
        @for (b of bars(); track b.ym) {
          @if (b.incomePath) {
            <path [attr.d]="b.incomePath" style="fill: var(--mm-income)" />
          }
          @if (b.expensePath) {
            <path [attr.d]="b.expensePath" style="fill: var(--mm-expense)" />
          }
          @if (b.savingsPath) {
            <path [attr.d]="b.savingsPath" style="fill: var(--mm-savings)" />
          }
          <text
            [attr.x]="b.cx"
            [attr.y]="H - 8"
            text-anchor="middle"
            class="tick"
            [class.strong-tick]="b.ym === activeMonth()"
          >
            {{ b.label }}
          </text>
          <rect
            fill="transparent"
            class="pickable"
            [attr.x]="b.slotX"
            [attr.y]="padT"
            [attr.width]="b.slotW"
            [attr.height]="plotH"
            (pointerenter)="showTip(b)"
            (pointerdown)="showTip(b)"
            (click)="pickMonth.emit(b.ym)"
          />
        }
      </svg>
      <div
        class="chart-tip absolute z-20 pointer-events-none bg-neutral text-neutral-content text-xs rounded-md px-2.5 py-1.5 shadow-md whitespace-nowrap"
        [hidden]="!tip()"
        [style.left.%]="tip()?.xPct ?? 50"
        [style.top.px]="tip()?.yPx ?? 0"
        style="transform: translate(-50%, -110%)"
      >
        <div class="font-semibold">{{ tip()?.title }}</div>
        @for (line of tip()?.lines || []; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
})
export class GroupedBarsChartComponent {
  readonly months = input.required<string[]>();
  readonly income = input.required<number[]>();
  readonly expense = input.required<number[]>();
  readonly savings = input<number[]>([]);
  readonly activeMonth = input<string | null>(null);
  readonly pickMonth = output<string>();

  readonly W = 640;
  readonly H = 220;
  readonly padL = 52;
  readonly padR = 12;
  readonly padT = 16;
  readonly padB = 26;
  readonly plotH = this.H - this.padT - this.padB;

  readonly fmtShort = fmtShort;
  readonly tip = signal<ChartTipState | null>(null);

  private readonly scale = computed(() => {
    const peak = Math.max(1000, ...this.income(), ...this.expense(), ...this.savings());
    return niceScale(peak);
  });

  readonly yTicks = computed(() => ticksFor(this.scale().top, this.scale().step));

  yOf(val: number): number {
    const base = this.padT + this.plotH;
    return base - (Math.max(0, val) / this.scale().top) * this.plotH;
  }

  readonly bars = computed(() => {
    const list = this.months();
    const inc = this.income();
    const exp = this.expense();
    const sav = this.savings();
    const n = Math.max(1, list.length);
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const bw = Math.min(15, Math.max(5, (slotW - 10) / 3));
    const base = this.padT + this.plotH;
    return list.map((ym, i) => {
      const slotX = this.padL + i * slotW;
      const cx = slotX + slotW / 2;
      const incVal = inc[i] || 0;
      const expVal = exp[i] || 0;
      const savVal = sav[i] || 0;
      return {
        ym,
        label: shortMonth(ym),
        slotX,
        slotW,
        cx,
        inc: incVal,
        exp: expVal,
        sav: savVal,
        incomePath: incVal > 0 ? barPath(cx - bw * 1.5 - 2, base, this.yOf(incVal), bw) : '',
        expensePath: expVal > 0 ? barPath(cx - bw * 0.5, base, this.yOf(expVal), bw) : '',
        savingsPath: savVal > 0 ? barPath(cx + bw * 0.5 + 2, base, this.yOf(savVal), bw) : '',
      };
    });
  });

  showTip(b: { ym: string; cx: number; inc: number; exp: number; sav: number }): void {
    this.tip.set({
      xPct: (b.cx / this.W) * 100,
      yPx: Math.min(this.yOf(b.inc), this.yOf(b.exp)),
      title: fullMonthYear(b.ym),
      lines: [
        `Income ${fmt(b.inc)} · Expense ${fmt(b.exp)}`,
        `Saved ${fmt(b.inc - b.exp)}${b.sav > 0 ? ` · Set aside ${fmt(b.sav)}` : ''}`,
      ],
    });
  }
}

/* ============================================================
 * 2. Share of Income (100% Share Bars)
 * ============================================================ */
@Component({
  selector: 'mm-share-bars-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><i class="swatch" style="--swatch: var(--mm-expense)"></i>Expense</span>
      <span><i class="swatch" style="--swatch: var(--mm-savings)"></i>Savings</span>
      <span><i class="swatch" style="--swatch: var(--color-base-300)"></i>Left over</span>
    </div>
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Share of monthly income spent, saved, or left over"
        (pointerleave)="tip.set(null)"
      >
        @for (t of [0, 25, 50, 75, 100]; track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" class="stroke-base-300" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ t }}%</text>
        }
        @for (col of cols(); track col.ym) {
          @for (seg of col.segments; track seg.key) {
            <rect
              [attr.x]="col.x"
              [attr.y]="seg.y"
              [attr.width]="col.bw"
              [attr.height]="seg.h"
              [style.fill]="seg.fill"
              rx="2"
            />
            @if (seg.h >= 16) {
              <text
                [attr.x]="col.cx"
                [attr.y]="seg.y + seg.h / 2 + 4"
                text-anchor="middle"
                class="seg-label"
                [class.tiny]="col.bw < 28"
                [class.neutral]="seg.key === 'left'"
              >{{ Math.round(seg.pct) }}%</text>
            }
          }
          <text
            [attr.x]="col.cx"
            [attr.y]="H - 8"
            text-anchor="middle"
            class="tick"
            [class.strong-tick]="col.ym === activeMonth()"
          >
            {{ col.label }}
          </text>
          <rect
            fill="transparent"
            class="pickable"
            [attr.x]="col.slotX"
            [attr.y]="padT"
            [attr.width]="col.slotW"
            [attr.height]="plotH"
            (pointerenter)="showTip(col)"
            (pointerdown)="showTip(col)"
            (click)="pickMonth.emit(col.ym)"
          />
        }
      </svg>
      <div
        class="chart-tip absolute z-20 pointer-events-none bg-neutral text-neutral-content text-xs rounded-md px-2.5 py-1.5 shadow-md whitespace-nowrap"
        [hidden]="!tip()"
        [style.left.%]="tip()?.xPct ?? 50"
        [style.top.px]="tip()?.yPx ?? 0"
        style="transform: translate(-50%, -110%)"
      >
        <div class="font-semibold">{{ tip()?.title }}</div>
        @for (line of tip()?.lines || []; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
})
export class ShareBarsChartComponent {
  readonly months = input.required<string[]>();
  readonly items = input.required<ShareItem[]>();
  readonly activeMonth = input<string | null>(null);
  readonly pickMonth = output<string>();

  readonly W = 640;
  readonly H = 220;
  readonly padL = 44;
  readonly padR = 12;
  readonly padT = 14;
  readonly padB = 26;
  readonly plotH = this.H - this.padT - this.padB;
  readonly Math = Math;

  readonly tip = signal<ChartTipState | null>(null);

  yOf(pct: number): number {
    return this.padT + this.plotH * (1 - Math.min(100, Math.max(0, pct)) / 100);
  }

  readonly cols = computed(() => {
    const list = this.months();
    const shares = this.items();
    const n = Math.max(1, list.length);
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const bw = Math.min(34, Math.max(14, slotW - 10));
    return list.map((ym, i) => {
      const s = shares[i] || { income: 0, expense: 0, savings: 0, left: 0, expensePct: 0, savingsPct: 0, leftPct: 0 };
      const slotX = this.padL + i * slotW;
      const cx = slotX + slotW / 2;
      const x = cx - bw / 2;
      const totalPct = s.expensePct + s.savingsPct + s.leftPct;
      const scale = totalPct > 100 ? 100 / totalPct : 1;
      const parts = [
        { key: 'expense', pct: s.expensePct * scale, fill: 'var(--mm-expense)' },
        { key: 'savings', pct: s.savingsPct * scale, fill: 'var(--mm-savings)' },
        { key: 'left', pct: s.leftPct * scale, fill: 'var(--color-base-300)' },
      ];
      let cursor = this.padT + this.plotH;
      const segments = parts
        .filter(p => p.pct > 0.5)
        .map(p => {
          const h = (p.pct / 100) * this.plotH;
          cursor -= h;
          return { key: p.key, pct: p.pct, y: cursor, h, fill: p.fill };
        });
      return { ym, label: shortMonth(ym), slotX, slotW, cx, x, bw, share: s, segments };
    });
  });

  showTip(col: { ym: string; cx: number; share: ShareItem }): void {
    const s = col.share;
    this.tip.set({
      xPct: (col.cx / this.W) * 100,
      yPx: this.padT + 10,
      title: fullMonthYear(col.ym),
      lines: [
        `Expense: ${fmt(s.expense)} (${Math.round(s.expensePct)}%)`,
        `Savings: ${fmt(s.savings)} (${Math.round(s.savingsPct)}%)`,
        `Left over: ${fmt(s.left)}`,
      ],
    });
  }
}

/* ============================================================
 * 3. Top Categories Stacked Over Months
 * ============================================================ */
@Component({
  selector: 'mm-stacked-bars-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      @for (s of seriesLegend(); track s.name) {
        <span><i class="swatch" [style.--swatch]="s.color"></i>{{ s.name }}</span>
      }
    </div>
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Spending by category across months"
        (pointerleave)="tip.set(null)"
      >
        @for (t of yTicks(); track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" class="stroke-base-300" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ fmtShort(t) }}</text>
        }
        @for (col of cols(); track col.ym) {
          @for (seg of col.segments; track seg.name) {
            <rect [attr.x]="col.x" [attr.y]="seg.y" [attr.width]="col.bw" [attr.height]="seg.h" [style.fill]="seg.color" />
          }
          <text
            [attr.x]="col.cx"
            [attr.y]="H - 8"
            text-anchor="middle"
            class="tick"
            [class.strong-tick]="col.ym === activeMonth()"
          >
            {{ col.label }}
          </text>
          <rect
            fill="transparent"
            class="pickable"
            [attr.x]="col.slotX"
            [attr.y]="padT"
            [attr.width]="col.slotW"
            [attr.height]="plotH"
            (pointerenter)="showTip(col)"
            (pointerdown)="showTip(col)"
            (click)="pickMonth.emit(col.ym)"
          />
        }
      </svg>
      <div
        class="chart-tip absolute z-20 pointer-events-none bg-neutral text-neutral-content text-xs rounded-md px-2.5 py-1.5 shadow-md whitespace-nowrap"
        [hidden]="!tip()"
        [style.left.%]="tip()?.xPct ?? 50"
        [style.top.px]="tip()?.yPx ?? 0"
        style="transform: translate(-50%, -110%)"
      >
        <div class="font-semibold">{{ tip()?.title }}</div>
        @for (line of tip()?.lines || []; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
})
export class StackedBarsChartComponent {
  readonly months = input.required<string[]>();
  readonly names = input.required<string[]>();
  readonly values = input.required<number[][]>();
  readonly other = input.required<number[]>();
  readonly activeMonth = input<string | null>(null);
  readonly pickMonth = output<string>();

  readonly W = 640;
  readonly H = 220;
  readonly padL = 52;
  readonly padR = 12;
  readonly padT = 14;
  readonly padB = 26;
  readonly plotH = this.H - this.padT - this.padB;

  readonly fmtShort = fmtShort;
  readonly tip = signal<ChartTipState | null>(null);

  readonly seriesLegend = computed(() => {
    const items = this.names().map((name, idx) => ({ name, color: CAT_COLORS[idx % CAT_COLORS.length] }));
    if (this.other().some(v => v > 0)) items.push({ name: 'Other', color: 'var(--mm-c-other)' });
    return items;
  });

  private readonly scale = computed(() => {
    const list = this.months();
    const vals = this.values();
    const oth = this.other();
    const totals = list.map((_, i) => vals.reduce((s, row) => s + (row[i] || 0), 0) + (oth[i] || 0));
    return niceScale(Math.max(1000, ...totals));
  });

  readonly yTicks = computed(() => ticksFor(this.scale().top, this.scale().step));

  yOf(v: number): number {
    return this.padT + this.plotH * (1 - Math.max(0, v) / this.scale().top);
  }

  readonly cols = computed(() => {
    const list = this.months();
    const ns = this.names();
    const vals = this.values();
    const oth = this.other();
    const n = Math.max(1, list.length);
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const bw = Math.min(32, Math.max(12, slotW - 10));

    return list.map((ym, i) => {
      const slotX = this.padL + i * slotW;
      const cx = slotX + slotW / 2;
      const x = cx - bw / 2;
      let cursor = this.padT + this.plotH;
      const entries = ns.map((name, idx) => ({
        name,
        cents: vals[idx]?.[i] || 0,
        color: CAT_COLORS[idx % CAT_COLORS.length],
      }));
      if ((oth[i] || 0) > 0) entries.push({ name: 'Other', cents: oth[i], color: 'var(--mm-c-other)' });
      const segments = entries
        .filter(e => e.cents > 0)
        .map(e => {
          const h = (e.cents / this.scale().top) * this.plotH;
          cursor -= h;
          return { ...e, y: cursor, h };
        });
      const total = entries.reduce((s, e) => s + e.cents, 0);
      return { ym, label: shortMonth(ym), slotX, slotW, cx, x, bw, topY: cursor, total, entries, segments };
    });
  });

  showTip(col: { ym: string; cx: number; topY: number; total: number; entries: Array<{ name: string; cents: number }> }): void {
    const lines = col.entries.filter(e => e.cents > 0).slice(0, 4).map(e => `${e.name}: ${fmt(e.cents)}`);
    lines.push(`Total: ${fmt(col.total)}`);
    this.tip.set({
      xPct: (col.cx / this.W) * 100,
      yPx: Math.max(this.padT + 10, col.topY),
      title: fullMonthYear(col.ym),
      lines,
    });
  }
}

/* ============================================================
 * 4. Saved Each Month (Diverging Bars)
 * ============================================================ */
@Component({
  selector: 'mm-diverging-bars-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><i class="swatch" style="--swatch: var(--mm-savings)"></i>Left over</span>
      <span><i class="swatch" style="--swatch: var(--mm-expense)"></i>Overspent</span>
    </div>
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Monthly surplus or deficit"
        (pointerleave)="tip.set(null)"
      >
        @for (t of yTicks(); track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" [class]="t === 0 ? 'zero-line' : 'stroke-base-300'" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ fmtShort(t) }}</text>
        }
        @for (b of bars(); track b.ym) {
          @if (b.path) {
            <path [attr.d]="b.path" [style.fill]="b.net >= 0 ? 'var(--mm-savings)' : 'var(--mm-expense)'" />
          }
          <text
            [attr.x]="b.cx"
            [attr.y]="H - 8"
            text-anchor="middle"
            class="tick"
            [class.strong-tick]="b.ym === activeMonth()"
          >
            {{ b.label }}
          </text>
          <rect
            fill="transparent"
            class="pickable"
            [attr.x]="b.slotX"
            [attr.y]="padT"
            [attr.width]="b.slotW"
            [attr.height]="plotH"
            (pointerenter)="showTip(b)"
            (pointerdown)="showTip(b)"
            (click)="pickMonth.emit(b.ym)"
          />
        }
      </svg>
      <div
        class="chart-tip absolute z-20 pointer-events-none bg-neutral text-neutral-content text-xs rounded-md px-2.5 py-1.5 shadow-md whitespace-nowrap"
        [hidden]="!tip()"
        [style.left.%]="tip()?.xPct ?? 50"
        [style.top.px]="tip()?.yPx ?? 0"
        style="transform: translate(-50%, -110%)"
      >
        <div class="font-semibold">{{ tip()?.title }}</div>
        @for (line of tip()?.lines || []; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
})
export class DivergingBarsChartComponent {
  readonly months = input.required<string[]>();
  readonly nets = input.required<number[]>();
  readonly activeMonth = input<string | null>(null);
  readonly pickMonth = output<string>();

  readonly W = 640;
  readonly H = 220;
  readonly padL = 54;
  readonly padR = 12;
  readonly padT = 14;
  readonly padB = 26;
  readonly plotH = this.H - this.padT - this.padB;

  readonly fmtShort = fmtShort;
  readonly tip = signal<ChartTipState | null>(null);

  private readonly peak = computed(() =>
    niceScale(Math.max(1000, ...this.nets().map(v => Math.abs(v)))).top,
  );

  readonly yTicks = computed(() => {
    const p = this.peak();
    return [-p, -p / 2, 0, p / 2, p].map(v => Math.round(v));
  });

  yOf(v: number): number {
    const p = this.peak();
    const mid = this.padT + this.plotH / 2;
    return mid - (v / p) * (this.plotH / 2);
  }

  readonly bars = computed(() => {
    const list = this.months();
    const ns = this.nets();
    const n = Math.max(1, list.length);
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const bw = Math.min(30, Math.max(10, slotW - 10));
    const zeroY = this.yOf(0);

    return list.map((ym, i) => {
      const slotX = this.padL + i * slotW;
      const cx = slotX + slotW / 2;
      const net = ns[i] || 0;
      const toY = this.yOf(net);
      return {
        ym,
        label: shortMonth(ym),
        slotX,
        slotW,
        cx,
        net,
        toY,
        path: net !== 0 ? barPath(cx - bw / 2, zeroY, toY, bw) : '',
      };
    });
  });

  showTip(b: { ym: string; cx: number; net: number; toY: number }): void {
    this.tip.set({
      xPct: (b.cx / this.W) * 100,
      yPx: Math.min(b.toY, this.yOf(0)),
      title: fullMonthYear(b.ym),
      lines: [b.net >= 0 ? `Saved: ${fmt(b.net)}` : `Overspent: ${fmt(-b.net)}`],
    });
  }
}

/* ============================================================
 * 5. Spending Pace Through the Month (Line Chart)
 * ============================================================ */
@Component({
  selector: 'mm-pace-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend">
      <span><i class="swatch" style="--swatch: var(--mm-expense)"></i>{{ currentLabel() }}</span>
      @if (prevPoints().length) {
        <span><i class="swatch dashed" style="--swatch: color-mix(in oklab, var(--color-base-content) 45%, transparent)"></i>{{ prevLabel() }}</span>
      }
      @if (budgetCents() > 0) {
        <span><i class="swatch dashed" style="--swatch: var(--mm-income)"></i>Monthly budget</span>
      }
    </div>
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Cumulative spending pace through the month"
        (pointerleave)="tip.set(null)"
      >
        @for (t of yTicks(); track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" class="stroke-base-300" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ fmtShort(t) }}</text>
        }
        @if (budgetCents() > 0) {
          <line
            [attr.x1]="padL"
            [attr.x2]="W - padR"
            [attr.y1]="yOf(budgetCents())"
            [attr.y2]="yOf(budgetCents())"
            stroke="var(--mm-income)"
            stroke-dasharray="5 4"
            stroke-width="1.5"
          />
        }
        @if (prevPolyline()) {
          <polyline
            fill="none"
            stroke="color-mix(in oklab, var(--color-base-content) 45%, transparent)"
            stroke-width="2"
            stroke-dasharray="4 4"
            [attr.points]="prevPolyline()"
          />
        }
        @if (curPolyline()) {
          <polyline
            fill="none"
            stroke="var(--mm-expense)"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            [attr.points]="curPolyline()"
          />
          @if (lastPoint(); as lp) {
            <circle [attr.cx]="lp.x" [attr.cy]="lp.y" r="4.5" fill="var(--mm-expense)" class="dot" />
          }
        }
        @for (d of daySlots(); track d.day) {
          <rect
            fill="transparent"
            [attr.x]="d.slotX"
            [attr.y]="padT"
            [attr.width]="d.slotW"
            [attr.height]="plotH"
            (pointerenter)="showDayTip(d)"
            (pointerdown)="showDayTip(d)"
          />
        }
        @for (dayTick of [1, 8, 15, 22, 29]; track dayTick) {
          <text [attr.x]="xOfDay(dayTick)" [attr.y]="H - 8" text-anchor="middle" class="tick">Day {{ dayTick }}</text>
        }
      </svg>
      <div
        class="chart-tip absolute z-20 pointer-events-none bg-neutral text-neutral-content text-xs rounded-md px-2.5 py-1.5 shadow-md whitespace-nowrap"
        [hidden]="!tip()"
        [style.left.%]="tip()?.xPct ?? 50"
        [style.top.px]="tip()?.yPx ?? 0"
        style="transform: translate(-50%, -110%)"
      >
        <div class="font-semibold">{{ tip()?.title }}</div>
        @for (line of tip()?.lines || []; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
})
export class PaceLineChartComponent {
  readonly current = input.required<number[]>();
  readonly previous = input.required<number[]>();
  readonly currentLabel = input<string>('Selected month');
  readonly prevLabel = input<string>('Previous month');
  readonly budgetCents = input(0);

  readonly W = 640;
  readonly H = 220;
  readonly padL = 52;
  readonly padR = 16;
  readonly padT = 14;
  readonly padB = 26;
  readonly plotH = this.H - this.padT - this.padB;

  readonly fmtShort = fmtShort;
  readonly tip = signal<ChartTipState | null>(null);

  private readonly scale = computed(() => {
    const peak = Math.max(1000, this.budgetCents(), ...this.current(), ...this.previous());
    return niceScale(peak);
  });

  readonly yTicks = computed(() => ticksFor(this.scale().top, this.scale().step));

  yOf(v: number): number {
    return this.padT + this.plotH * (1 - Math.max(0, v) / this.scale().top);
  }

  private readonly maxDays = computed(() => Math.max(28, this.current().length, this.previous().length));

  xOfDay(day: number): number {
    const plotW = this.W - this.padL - this.padR;
    return this.padL + ((day - 1) / Math.max(1, this.maxDays() - 1)) * plotW;
  }

  readonly curPoints = computed(() => this.current().map((v, i) => ({ day: i + 1, x: this.xOfDay(i + 1), y: this.yOf(v), val: v })));
  readonly prevPoints = computed(() => this.previous().map((v, i) => ({ day: i + 1, x: this.xOfDay(i + 1), y: this.yOf(v), val: v })));

  readonly curPolyline = computed(() => this.curPoints().map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  readonly prevPolyline = computed(() => this.prevPoints().map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  readonly lastPoint = computed(() => this.curPoints()[this.curPoints().length - 1] ?? null);

  readonly daySlots = computed(() => {
    const n = this.maxDays();
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const cur = this.current();
    const prev = this.previous();
    return Array.from({ length: n }, (_, i) => ({
      day: i + 1,
      x: this.xOfDay(i + 1),
      slotX: this.padL + i * slotW,
      slotW,
      curVal: cur[i] ?? null,
      prevVal: prev[i] ?? null,
    }));
  });

  showDayTip(d: { day: number; x: number; curVal: number | null; prevVal: number | null }): void {
    const lines: string[] = [];
    if (d.curVal !== null) lines.push(`${this.currentLabel()}: ${fmt(d.curVal)}`);
    if (d.prevVal !== null) lines.push(`${this.prevLabel()}: ${fmt(d.prevVal)}`);
    if (!lines.length) return;
    this.tip.set({
      xPct: (d.x / this.W) * 100,
      yPx: this.yOf(d.curVal ?? d.prevVal ?? 0),
      title: `Day ${d.day}`,
      lines,
    });
  }
}

/* ============================================================
 * 6. Compact Savings Bars (for .savings-card, no .legend)
 * ============================================================ */
@Component({
  selector: 'mm-savings-bars-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart-plot relative">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="w-full h-auto block select-none"
        role="img"
        aria-label="Savings set aside by month"
      >
        @for (t of yTicks(); track t) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" class="stroke-base-300" stroke-width="1" />
          <text [attr.x]="padL - 8" [attr.y]="yOf(t) + 4" text-anchor="end" class="tick">{{ fmtShort(t) }}</text>
        }
        @for (b of bars(); track b.ym) {
          @if (b.path) {
            <path [attr.d]="b.path" style="fill: var(--mm-savings)" />
          }
          <text
            [attr.x]="b.cx"
            [attr.y]="H - 6"
            text-anchor="middle"
            class="tick"
            [class.strong-tick]="b.ym === activeMonth()"
          >
            {{ b.label }}
          </text>
        }
      </svg>
    </div>
  `,
})
export class SavingsBarsChartComponent {
  readonly months = input.required<string[]>();
  readonly values = input.required<number[]>();
  readonly activeMonth = input<string | null>(null);

  readonly W = 640;
  readonly H = 130;
  readonly padL = 48;
  readonly padR = 12;
  readonly padT = 10;
  readonly padB = 22;
  readonly plotH = this.H - this.padT - this.padB;

  readonly fmtShort = fmtShort;

  private readonly scale = computed(() => niceScale(Math.max(1000, ...this.values())));
  readonly yTicks = computed(() => ticksFor(this.scale().top, this.scale().step));

  yOf(v: number): number {
    return this.padT + this.plotH * (1 - Math.max(0, v) / this.scale().top);
  }

  readonly bars = computed(() => {
    const list = this.months();
    const vals = this.values();
    const n = Math.max(1, list.length);
    const plotW = this.W - this.padL - this.padR;
    const slotW = plotW / n;
    const bw = Math.min(28, Math.max(8, slotW - 10));
    const base = this.padT + this.plotH;
    return list.map((ym, i) => {
      const slotX = this.padL + i * slotW;
      const cx = slotX + slotW / 2;
      const val = vals[i] || 0;
      return {
        ym,
        label: shortMonth(ym),
        cx,
        path: val > 0 ? barPath(cx - bw / 2, base, this.yOf(val), bw) : '',
      };
    });
  });
}
