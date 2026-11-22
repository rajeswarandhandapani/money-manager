import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RankRowComponent } from '../../components/rank-row.component';
import { fmt } from '../../domain/format';
import {
  UNCATEGORIZED,
  budgetSummary,
  categoryStack,
  incomeSplit,
  missingCards,
  monthChoices,
  monthLabel,
  monthSeries,
  monthlySavings,
  monthsPresent,
  periodSummary,
  previousMonth,
  spendingPace,
  topBy,
  yearMatrix,
} from '../../domain/report';
import { MoneyModalsService } from '../../services/money-modals.service';
import { MoneyStateService } from '../../services/money-state.service';
import {
  DivergingBarsChartComponent,
  GroupedBarsChartComponent,
  PaceLineChartComponent,
  SavingsBarsChartComponent,
  ShareBarsChartComponent,
  StackedBarsChartComponent,
} from './dash-charts.component';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'mm-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RankRowComponent,
    GroupedBarsChartComponent,
    ShareBarsChartComponent,
    StackedBarsChartComponent,
    DivergingBarsChartComponent,
    PaceLineChartComponent,
    SavingsBarsChartComponent,
  ],
  template: `
    @if (!state.tx().length) {
      <div class="card bg-base-100 border border-base-300 max-w-xl mx-auto my-8">
        <div class="card-body items-center text-center gap-3">
          <h1 class="text-2xl font-bold">Welcome to Money Manager</h1>
          <p class="opacity-75">
            Drop a bank CSV or Excel export to see where your money goes. Everything stays locally in your browser.
          </p>
          <button type="button" class="btn btn-primary" (click)="router.navigateByUrl('/import')">
            Import a statement
          </button>
        </div>
      </div>
    } @else {
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold tracking-tight">{{ periodTitle() }}</h1>
          <div class="seg" role="group" aria-label="Period scope">
            <button
              type="button"
              data-scope="month"
              [attr.aria-pressed]="state.scope() === 'month'"
              (click)="setScope('month')"
            >
              Month
            </button>
            <button
              type="button"
              data-scope="year"
              [attr.aria-pressed]="state.scope() === 'year'"
              (click)="setScope('year')"
            >
              Year
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          @if (state.scope() === 'month') {
            <select
              id="month"
              class="select select-bordered select-sm min-h-10"
              aria-label="Month"
              (change)="pickMonth($any($event.target).value)"
            >
              @for (m of monthList(); track m) {
                <option [value]="m" [selected]="m === activeMonth()">{{ monthLabel(m) }}</option>
              }
            </select>
          } @else {
            <select
              id="year"
              class="select select-bordered select-sm min-h-10"
              aria-label="Year"
              (change)="pickYear($any($event.target).value)"
            >
              @for (y of yearList(); track y) {
                <option [value]="y" [selected]="y === activeYear()">{{ y }}</option>
              }
            </select>
          }
          <button id="edit-budgets" type="button" class="btn btn-outline btn-sm" (click)="modals.openBudgets()">
            {{ budgetInfo().budgeted > 0 ? 'Edit budgets' : 'Set budgets' }}
          </button>
        </div>
      </div>

      <!-- Review / Missing Card Notices -->
      @if (summary().review > 0 || missingCardNames().length) {
        <div class="flex flex-wrap gap-2 mb-4">
          @if (summary().review > 0) {
            <button
              type="button"
              class="btn btn-warning btn-sm"
              (click)="goToTx({ month: prefix(), show: 'review' })"
            >
              {{ summary().review }} transaction{{ summary().review === 1 ? '' : 's' }} need review →
            </button>
          }
          @if (missingCardNames().length) {
            <div class="alert alert-info py-2 px-3 text-sm w-auto">
              <span>
                You paid {{ missingCardNames().join(' and ') }} in this period — import that card's statement to see individual purchases.
              </span>
            </div>
          }
        </div>
      }

      <!-- KPI Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div id="kpi-spent" class="card bg-base-100 border border-base-300">
          <div class="card-body p-4 gap-1">
            <span class="text-xs uppercase tracking-wide opacity-65">Spent</span>
            <b class="text-2xl font-bold tabular-nums">{{ fmt(summary().spent) }}</b>
            <span class="text-xs opacity-70">{{ summary().count }} expense{{ summary().count === 1 ? '' : 's' }}</span>
          </div>
        </div>

        <div id="kpi-income" class="card bg-base-100 border border-base-300">
          <div class="card-body p-4 gap-1">
            <span class="text-xs uppercase tracking-wide opacity-65">Income</span>
            <b class="text-2xl font-bold tabular-nums text-info">{{ fmt(summary().earned) }}</b>
            <span class="text-xs opacity-70">{{ summary().transfers }} transfer{{ summary().transfers === 1 ? '' : 's' }} excluded</span>
          </div>
        </div>

        <div id="kpi-saved" class="card bg-base-100 border border-base-300">
          <div class="card-body p-4 gap-1">
            <span class="text-xs uppercase tracking-wide opacity-65">
              {{ summary().saved >= 0 ? 'Saved' : 'Overspent' }}
            </span>
            <b
              class="text-2xl font-bold tabular-nums"
              [class.text-success]="summary().saved >= 0"
              [class.text-warning]="summary().saved < 0"
            >{{ fmt(Math.abs(summary().saved)) }}</b>
            <span class="text-xs opacity-70">
              @if (summary().setAside > 0) {
                includes {{ fmt(summary().setAside) }} in Savings
              } @else {
                Income minus spending
              }
            </span>
          </div>
        </div>

        @if (budgetInfo().budgeted > 0) {
          <div id="kpi-budget" class="card bg-base-100 border border-base-300">
            <div class="card-body p-4 gap-1">
              <span class="text-xs uppercase tracking-wide opacity-65">{{ budgetInfo().left < 0 ? 'Over budget' : 'Left in budget' }}</span><b
                class="text-2xl font-bold tabular-nums"
                [class.text-success]="budgetInfo().left >= 0"
                [class.text-warning]="budgetInfo().left < 0"
              >{{ fmt(Math.abs(budgetInfo().left)) }}</b><span class="text-xs opacity-70">@if (state.scope() === 'month') {of {{ fmt(budgetInfo().budgeted) }} · {{ budgetInfo().overCount }} over} @else {of {{ fmt(budgetInfo().budgeted) }} for {{ monthsInPeriod() }} month{{ monthsInPeriod() === 1 ? '' : 's' }}}</span>
            </div>
          </div>
        }
      </div>

      <!-- Main Analytics Grid -->
      <div class="dash">
        <div class="dash-left">
          <section class="card bg-base-100 border border-base-300 chart o-1">
            <div class="card-body p-4">
              <h2 class="text-base font-bold mb-1">Income and expense, last 12 months</h2>
              <mm-grouped-bars-chart
                [months]="trendMonths()"
                [income]="trendSeries().income"
                [expense]="trendSeries().expense"
                [savings]="savingsSeries()"
                [activeMonth]="activeMonth()"
                (pickMonth)="jumpToMonth($event)"
              />
            </div>
          </section>

          <section class="card bg-base-100 border border-base-300 chart share-chart o-3">
            <div class="card-body p-4">
              <h2 class="text-base font-bold mb-1">Share of income, last 12 months</h2>
              <mm-share-bars-chart
                [months]="trendMonths()"
                [items]="shares()"
                [activeMonth]="activeMonth()"
                (pickMonth)="jumpToMonth($event)"
              />
            </div>
          </section>

          <section class="card bg-base-100 border border-base-300 chart o-5">
            <div class="card-body p-4">
              <h2 class="text-base font-bold mb-1">Where the money went over time</h2>
              <mm-stacked-bars-chart
                [months]="trendMonths()"
                [names]="stacked().names"
                [values]="stacked().values"
                [other]="stacked().other"
                [activeMonth]="activeMonth()"
                (pickMonth)="jumpToMonth($event)"
              />
            </div>
          </section>

          @if (state.scope() === 'year') {
            <section class="card bg-base-100 border border-base-300 chart o-6">
              <div class="card-body p-4">
                <h2 class="text-base font-bold mb-1">Saved each month</h2>
                <mm-diverging-bars-chart
                  [months]="trendMonths()"
                  [nets]="netSeries()"
                  [activeMonth]="activeMonth()"
                  (pickMonth)="jumpToMonth($event)"
                />
              </div>
            </section>
          }

          @if (state.scope() === 'month' && activeMonth()) {
            <section class="card bg-base-100 border border-base-300 chart o-6">
              <div class="card-body p-4">
                <h2 class="text-base font-bold mb-1">Spending pace through the month</h2>
                <mm-pace-line-chart
                  [current]="paceCur()"
                  [previous]="pacePrev()"
                  [currentLabel]="monthLabel(activeMonth()!)"
                  [prevLabel]="monthLabel(previousMonth(activeMonth()!))"
                  [budgetCents]="monthlyBudgetTotal()"
                />
              </div>
            </section>
          }

          <section class="card bg-base-100 border border-base-300 savings-card o-7">
            <div class="card-body p-4 gap-2">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-base font-bold">Savings</h2>
                @if (savingsCount() > 0) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    (click)="goToTx({ month: prefix(), show: 'savings' })"
                  >
                    {{ savingsCount() === 1 ? 'See this transaction' : 'See these transactions' }}
                  </button>
                }
              </div>
              <div class="savings-total text-base font-semibold tabular-nums text-success">
                {{ fmt(summary().setAside) }} set aside in {{ periodTitle() }}
              </div>
              <mm-savings-bars-chart
                [months]="trendMonths()"
                [values]="savingsSeries()"
                [activeMonth]="activeMonth()"
              />
              @if (savingsGoals().length) {
                <div class="flex flex-col gap-1 mt-1">
                  @for (g of savingsGoals(); track g.name) {
                    <div class="flex justify-between text-sm py-0.5"><span>{{ g.name }}</span><b class="tabular-nums">{{ fmt(g.cents) }}</b></div>
                  }
                </div>
              }
            </div>
          </section>
        </div>

        <div class="dash-right">
          <section class="card bg-base-100 border border-base-300 o-2">
            <div class="card-body p-4 gap-2">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-base font-bold">By category</h2>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  (click)="goToTx({ month: prefix(), show: 'expense' })"
                >
                  All expenses →
                </button>
              </div>
              @if (!summary().categories.length) {
                <p class="text-sm opacity-70">No categorized expenses in this period.</p>
              } @else {
                <div class="flex flex-col gap-1">
                  @for (c of categoryRows(); track c.name) {
                    <div>
                      <mm-rank-row
                        [label]="c.name"
                        [valText]="c.valText"
                        [fillPct]="c.fillPct"
                        [overPct]="c.overPct"
                        [targetPct]="c.targetPct"
                        [note]="c.note"
                        [over]="c.over"
                        [interactive]="true"
                        (picked)="toggleCategory(c.name)"
                      />
                      @if (state.openCat() === c.name) {
                        <div class="pl-4 pr-2 py-2 border-l-2 border-primary/40 ml-2 mb-2 flex flex-col gap-1 text-sm">
                          @for (s of c.subs; track s.name) {
                            <div class="flex justify-between gap-2 py-0.5">
                              <span class="opacity-85">{{ s.name }}</span>
                              <span class="tabular-nums font-medium">{{ fmt(s.cents) }}</span>
                            </div>
                          }
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs self-start mt-1"
                            (click)="goToTx({ month: prefix(), cat: c.name, show: 'expense' })"
                          >
                            See or change these →
                          </button>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </section>

          <section class="card bg-base-100 border border-base-300 o-4">
            <div class="card-body p-4 gap-2">
              <h2 class="text-base font-bold">By account</h2>
              @if (!summary().accounts.length) {
                <p class="text-sm opacity-70">No account spending in this period.</p>
              } @else {
                <div class="flex flex-col gap-1">
                  @for (a of summary().accounts; track a.name) {
                    <mm-rank-row
                      [label]="a.name"
                      [valText]="fmt(a.cents)"
                      [fillPct]="(a.cents / accountMax()) * 100"
                    />
                  }
                </div>
              }
            </div>
          </section>

          <section class="card bg-base-100 border border-base-300 o-4">
            <div class="card-body p-4 gap-2">
              <h2 class="text-base font-bold">Top merchants</h2>
              @if (!topMerchants().length) {
                <p class="text-sm opacity-70">No merchant spending in this period.</p>
              } @else {
                <div class="flex flex-col gap-1">
                  @for (m of topMerchants(); track m.name) {
                    <mm-rank-row
                      [label]="m.name"
                      [valText]="fmt(m.cents)"
                      [fillPct]="(m.cents / topMerchantMax()) * 100"
                      [interactive]="true"
                      (picked)="goToTx({ month: prefix(), q: m.name, show: 'expense' })"
                    />
                  }
                </div>
              }
            </div>
          </section>

          <section class="card bg-base-100 border border-base-300 o-4">
            <div class="card-body p-4 gap-2">
              <h2 class="text-base font-bold">Top subcategories</h2>
              @if (!topSubs().length) {
                <p class="text-sm opacity-70">No subcategories in this period.</p>
              } @else {
                <div class="flex flex-col gap-1">
                  @for (s of topSubs(); track s.name) {
                    <mm-rank-row
                      [label]="s.name"
                      [valText]="fmt(s.cents)"
                      [fillPct]="(s.cents / topSubMax()) * 100"
                    />
                  }
                </div>
              }
            </div>
          </section>
        </div>

        @if (state.scope() === 'year') {
          <section class="card bg-base-100 border border-base-300 dash-full">
            <div class="card-body p-4 gap-2">
              <h2 class="text-base font-bold">{{ activeYear() }} Month by Month</h2>
              <div class="overflow-x-auto">
                <table class="table table-xs matrix">
                  <thead>
                    <tr>
                      <th>Category</th>
                      @for (m of shortMonths; track m; let idx = $index) {
                        <th class="text-right">
                          <button
                            type="button"
                            class="link link-hover"
                            (click)="jumpToMonth((activeYear() || '') + '-' + String(idx + 1).padStart(2, '0'))"
                          >
                            {{ m }}
                          </button>
                        </th>
                      }
                      <th class="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of matrix().table; track row.name) {
                      @if (row.total > 0) {
                        <tr>
                          <th>{{ row.name }}</th>
                          @for (c of row.months; track $index) {
                            <td class="text-right tabular-nums">{{ c ? fmt(c) : '—' }}</td>
                          }
                          <td class="text-right font-semibold tabular-nums">{{ fmt(row.total) }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                  <tfoot>
                    <tr class="font-bold">
                      <th>Total spent</th>
                      @for (c of matrix().expense; track $index) {
                        <td class="text-right tabular-nums">{{ c ? fmt(c) : '—' }}</td>
                      }
                      <td class="text-right tabular-nums">{{ fmt(matrix().spent) }}</td>
                    </tr>
                    <tr>
                      <th>Income</th>
                      @for (c of matrix().income; track $index) {
                        <td class="text-right tabular-nums text-info">{{ c ? fmt(c) : '—' }}</td>
                      }
                      <td class="text-right font-semibold tabular-nums text-info">{{ fmt(matrix().earned) }}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        }
      </div>
    }
  `,
})
export class DashboardPageComponent {
  readonly state = inject(MoneyStateService);
  readonly modals = inject(MoneyModalsService);
  readonly router = inject(Router);

  readonly fmt = fmt;
  readonly monthLabel = monthLabel;
  readonly previousMonth = previousMonth;
  readonly Math = Math;
  readonly String = String;
  readonly shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  readonly monthsWithData = computed(() => monthsPresent(this.state.tx()));
  readonly monthList = computed(() => {
    const present = this.monthsWithData();
    const last = present[present.length - 1] || todayIso().slice(0, 7);
    const choices = monthChoices(this.state.tx(), `${last}-28`);
    return choices.length ? choices : present;
  });
  readonly yearList = computed(() =>
    [...new Set(this.monthsWithData().map(m => m.slice(0, 4)))].sort().reverse(),
  );

  readonly activeMonth = computed(() => this.state.month() || this.monthsWithData().at(-1) || null);
  readonly activeYear = computed(() => this.state.year() || this.activeMonth()?.slice(0, 4) || null);

  readonly prefix = computed(() =>
    this.state.scope() === 'month' ? this.activeMonth() || '' : this.activeYear() ? `${this.activeYear()}-` : '',
  );

  readonly periodTitle = computed(() => {
    if (this.state.scope() === 'year') return this.activeYear() || 'Year overview';
    return this.activeMonth() ? monthLabel(this.activeMonth()!) : 'Dashboard';
  });

  readonly summary = computed(() => periodSummary(this.state.tx(), this.prefix()));

  readonly missingCardNames = computed(() =>
    this.state.scope() === 'month' && this.activeMonth() ? missingCards(this.state.tx(), this.activeMonth()!) : [],
  );

  readonly monthsInPeriod = computed(() => {
    if (this.state.scope() === 'month') return 1;
    const yr = this.activeYear();
    return Math.max(1, this.monthsWithData().filter(m => m.startsWith(`${yr}-`)).length);
  });

  readonly budgetInfo = computed(() =>
    budgetSummary(this.summary().categories, this.state.budgets(), this.monthsInPeriod()),
  );

  readonly monthlyBudgetTotal = computed(() =>
    Object.values(this.state.budgets()).reduce((a, b) => a + (b > 0 ? b : 0), 0),
  );

  readonly trendMonths = computed(() => {
    if (this.state.scope() === 'year' && this.activeYear()) {
      const yr = this.activeYear()!;
      return Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
    }
    const end = this.activeMonth() || todayIso().slice(0, 7);
    const out: string[] = [];
    let cur = end;
    for (let i = 0; i < 12; i++) {
      out.unshift(cur);
      cur = previousMonth(cur);
    }
    return out;
  });

  readonly trendSeries = computed(() => monthSeries(this.state.tx(), this.trendMonths()));
  readonly savingsSeries = computed(() => monthlySavings(this.state.tx(), this.trendMonths()));
  readonly shares = computed(() => incomeSplit(this.state.tx(), this.trendMonths()));
  readonly stacked = computed(() => categoryStack(this.state.tx(), this.trendMonths(), 6));
  readonly netSeries = computed(() => {
    const s = this.trendSeries();
    return s.income.map((inc, i) => inc - s.expense[i]);
  });

  readonly paceCur = computed(() =>
    this.activeMonth() ? spendingPace(this.state.tx(), this.activeMonth()!, todayIso()) : [],
  );
  readonly pacePrev = computed(() =>
    this.activeMonth() ? spendingPace(this.state.tx(), previousMonth(this.activeMonth()!), todayIso()) : [],
  );

  readonly categoryRows = computed(() => {
    const cats = this.summary().categories;
    const budgets = this.state.budgets();
    const months = this.monthsInPeriod();
    const peak = Math.max(
      1,
      ...cats.map(c => Math.max(c.cents, (budgets[c.name] || 0) * months)),
    );
    return cats.map(c => {
      const target = (budgets[c.name] || 0) * months;
      const fillCents = target > 0 ? Math.min(c.cents, target) : c.cents;
      const overCents = target > 0 ? Math.max(0, c.cents - target) : 0;
      const over = target > 0 && c.cents > target;
      const note =
        target > 0
          ? over
            ? `${fmt(c.cents - target)} over ${fmt(target)} budget`
            : `${fmt(target - c.cents)} left of ${fmt(target)}`
          : '';
      return {
        name: c.name,
        subs: c.subs,
        valText: fmt(c.cents),
        fillPct: (fillCents / peak) * 100,
        overPct: (overCents / peak) * 100,
        targetPct: target > 0 ? (target / peak) * 100 : null,
        note,
        over,
      };
    });
  });

  readonly accountMax = computed(() => Math.max(1, this.summary().accounts[0]?.cents || 0));

  readonly topMerchants = computed(() =>
    topBy(this.state.tx(), this.prefix(), r => r.desc, 8, 'expense'),
  );
  readonly topMerchantMax = computed(() => Math.max(1, this.topMerchants()[0]?.cents || 0));

  readonly topSubs = computed(() =>
    topBy(this.state.tx(), this.prefix(), r => (r.sub ? `${r.sub}` : ''), 8, 'expense'),
  );
  readonly topSubMax = computed(() => Math.max(1, this.topSubs()[0]?.cents || 0));

  readonly savingsCount = computed(
    () => this.state.tx().filter(r => r.kind === 'savings' && r.date.startsWith(this.prefix())).length,
  );
  readonly savingsGoals = computed(() =>
    topBy(this.state.tx(), this.prefix(), r => r.sub || UNCATEGORIZED, 8, 'savings'),
  );

  readonly matrix = computed(() =>
    yearMatrix(this.state.tx(), this.activeYear() || todayIso().slice(0, 4), this.state.categories()),
  );

  setScope(s: 'month' | 'year'): void {
    this.state.scope.set(s);
    this.state.openCat.set(null);
  }

  pickMonth(ym: string): void {
    this.state.month.set(ym);
    this.state.year.set(ym.slice(0, 4));
    this.state.openCat.set(null);
  }

  pickYear(yr: string): void {
    this.state.year.set(yr);
    this.state.openCat.set(null);
  }

  jumpToMonth(ym: string): void {
    this.state.scope.set('month');
    this.pickMonth(ym);
  }

  toggleCategory(name: string): void {
    this.state.openCat.set(this.state.openCat() === name ? null : name);
  }

  goToTx(filter: { month?: string; cat?: string; show?: string; q?: string }): void {
    this.state.filter.set({ ...filter });
    void this.router.navigateByUrl('/tx');
  }
}
