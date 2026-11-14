import React, { useEffect, useState } from 'react';
import { Play, Download, RotateCcw } from 'lucide-react';
import type {
  ForestModel,
  ThermosConfig,
  StepRecord,
  SimulationState,
  PresetKey,
} from '../simulation/types';
import * as E from '../simulation/engine';
import modelMetrics from '../data/model_metrics.json';
import legacyBenchmark from '../data/verified_benchmark.json';

interface EvidenceLabPageProps {
  model: ForestModel;
  currentConfig: ThermosConfig;
  currentRecord: StepRecord | null;
  state: SimulationState;
  allStates: {
    thermos: SimulationState;
    reactive: SimulationState;
    physics: SimulationState;
    none?: SimulationState;
  };
}

interface SuiteRunItem {
  scenario: PresetKey;
  label: string;
  waterBudget: number;
  limitC: number;
  results: {
    thermos: ReturnType<typeof E.summary>;
    none: ReturnType<typeof E.summary>;
    reactive: ReturnType<typeof E.summary>;
    physics: ReturnType<typeof E.summary>;
  };
}

// Module-level deterministic v3.0 cache so opening Evidence Suite a second time is instant
let cachedDeterministicSuite: SuiteRunItem[] | null = null;

export const EvidenceLabPage: React.FC<EvidenceLabPageProps> = ({
  model,
  currentConfig,
  allStates,
}) => {
  const presetKeys = Object.keys(E.presets) as PresetKey[];
  const totalEpisodes = presetKeys.length * 4;

  const [suiteRuns, setSuiteRuns] = useState<SuiteRunItem[]>(cachedDeterministicSuite || []);
  const [isRunningSuite, setIsRunningSuite] = useState<boolean>(false);
  const [suiteStatusText, setSuiteStatusText] = useState<string>('');
  const [runSource, setRunSource] = useState<'baseline' | 'live'>('baseline');

  // Populate deterministic v3.0 24-episode baseline non-blockingly on first visit
  useEffect(() => {
    if (cachedDeterministicSuite && cachedDeterministicSuite.length === presetKeys.length) {
      return;
    }

    let cancelled = false;
    const computeInitialSuite = async () => {
      setIsRunningSuite(true);
      const computed: SuiteRunItem[] = [];

      for (let i = 0; i < presetKeys.length; i++) {
        if (cancelled) return;
        const key = presetKeys[i];
        const preset = E.presets[key];
        const conf = E.config(preset);

        setSuiteStatusText(`Computing v${E.VERSION} scenario ${i + 1}/${presetKeys.length}: ${preset.label}…`);
        await new Promise((resolve) => setTimeout(resolve, 12));
        if (cancelled) return;

        const runThermos = E.run(conf, 'thermos', model);
        const runNone = E.run(conf, 'none', model);
        const runReactive = E.run(conf, 'reactive', model);
        const runPhysics = E.run(conf, 'physics', model);

        computed.push({
          scenario: key,
          label: preset.label,
          waterBudget: conf.water,
          limitC: conf.limit,
          results: {
            thermos: E.summary(runThermos, conf),
            none: E.summary(runNone, conf),
            reactive: E.summary(runReactive, conf),
            physics: E.summary(runPhysics, conf),
          },
        });

        setSuiteRuns([...computed]);
      }

      if (!cancelled) {
        cachedDeterministicSuite = computed;
        setIsRunningSuite(false);
        setSuiteStatusText('');
      }
    };

    computeInitialSuite();
    return () => {
      cancelled = true;
    };
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerDownload = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Re-verify all 24 runs (6 scenarios x 4 controllers) live step-by-step
  const handleRunSuite = async () => {
    if (isRunningSuite) return;
    setIsRunningSuite(true);
    setRunSource('live');
    setSuiteRuns([]);

    const suite: SuiteRunItem[] = [];

    for (let i = 0; i < presetKeys.length; i++) {
      const key = presetKeys[i];
      const preset = E.presets[key];
      const conf = E.config(preset);

      setSuiteStatusText(`Verifying ${i + 1}/${presetKeys.length}: ${preset.label} (4 controllers)…`);
      await new Promise((resolve) => setTimeout(resolve, 25));

      const runThermos = E.run(conf, 'thermos', model);
      const runNone = E.run(conf, 'none', model);
      const runReactive = E.run(conf, 'reactive', model);
      const runPhysics = E.run(conf, 'physics', model);

      const item: SuiteRunItem = {
        scenario: key,
        label: preset.label,
        waterBudget: conf.water,
        limitC: conf.limit,
        results: {
          thermos: E.summary(runThermos, conf),
          none: E.summary(runNone, conf),
          reactive: E.summary(runReactive, conf),
          physics: E.summary(runPhysics, conf),
        },
      };

      suite.push(item);
      setSuiteRuns([...suite]);
    }

    cachedDeterministicSuite = suite;
    setIsRunningSuite(false);
    setSuiteStatusText(`Verified ${totalEpisodes} deterministic episodes across ${presetKeys.length} scenarios.`);
  };

  const handleExportCurrent = () => {
    const payload = {
      application: 'THERMOS',
      version: E.VERSION,
      data: 'SIMULATED',
      config: currentConfig,
      model_metadata: model.metadata,
      results: {
        thermos: {
          summary: E.summary(allStates.thermos, currentConfig),
          trace: allStates.thermos.trace,
          logs: allStates.thermos.logs,
        },
        ...(allStates.none
          ? {
              none: {
                summary: E.summary(allStates.none, currentConfig),
                trace: allStates.none.trace,
                logs: allStates.none.logs,
              },
            }
          : {}),
        reactive: {
          summary: E.summary(allStates.reactive, currentConfig),
          trace: allStates.reactive.trace,
          logs: allStates.reactive.logs,
        },
        physics: {
          summary: E.summary(allStates.physics, currentConfig),
          trace: allStates.physics.trace,
          logs: allStates.physics.logs,
        },
      },
    };
    triggerDownload('THERMOS-current-simulation.json', JSON.stringify(payload, null, 2));
  };

  const handleExportSuite = () => {
    const payload = {
      version: E.VERSION,
      data: 'SIMULATED',
      source:
        runSource === 'live'
          ? 'LIVE_IN_BROWSER_VERIFICATION'
          : 'DETERMINISTIC_V3_BENCHMARK',
      episode_count: suiteRuns.length * 4,
      v3_0_0_model_metrics: modelMetrics,
      legacy_embedded_model_metadata: model.metadata.metrics,
      runs: suiteRuns,
    };
    triggerDownload('THERMOS-24-run-evidence-suite.json', JSON.stringify(payload, null, 2));
  };

  const handleReset = () => {
    if (cachedDeterministicSuite) {
      setSuiteRuns(cachedDeterministicSuite);
    }
    setRunSource('baseline');
    setSuiteStatusText('');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-[#DCDED8]">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-[#18181B] tracking-tight">
            Evidence & Verification Suite
          </h2>
          <p className="text-xs text-[#52565E] mt-1 max-w-2xl leading-relaxed">
            Reproducible evaluation across all {presetKeys.length} operational scenarios and 4 control strategies ({totalEpisodes} full 6-hour simulation episodes) on Engine v{E.VERSION}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRunSuite}
            disabled={isRunningSuite}
            className="py-2 px-3.5 min-h-9 rounded-md bg-[#18181B] hover:bg-[#27272A] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>{isRunningSuite ? 'Running 24 Episodes…' : `Re-Verify ${totalEpisodes} Runs`}</span>
          </button>

          <button
            type="button"
            onClick={handleExportSuite}
            disabled={suiteRuns.length === 0}
            className="py-2 px-3 min-h-9 rounded-md bg-white hover:bg-[#F1F2EE] text-[#18181B] text-xs font-medium flex items-center gap-1.5 border border-[#DCDED8] cursor-pointer transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#52565E]" />
            <span>Suite JSON</span>
          </button>

          <button
            type="button"
            onClick={handleExportCurrent}
            className="py-2 px-3 min-h-9 rounded-md bg-white hover:bg-[#F1F2EE] text-[#18181B] text-xs font-medium flex items-center gap-1.5 border border-[#DCDED8] cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#52565E]" />
            <span>Active Sim JSON</span>
          </button>

          {runSource === 'live' && !isRunningSuite && (
            <button
              type="button"
              onClick={handleReset}
              className="w-9 h-9 rounded-md bg-white hover:bg-[#F1F2EE] text-[#646872] hover:text-[#18181B] border border-[#DCDED8] flex items-center justify-center cursor-pointer transition-colors"
              title="Reset verification status"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Clean Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#646872]">
        <span>
          {runSource === 'live'
            ? 'Live In-Browser Re-Verification'
            : `Deterministic Engine v${E.VERSION} Baseline`}
        </span>
        <span className="tabular-nums text-[#18181B]">
          {isRunningSuite
            ? suiteStatusText
            : suiteStatusText || `${suiteRuns.length * 4} / ${totalEpisodes} Episodes Evaluated`}
        </span>
      </div>

      {/* Benchmark Reconciliation & Version Traceability */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 pb-2.5 border-b border-[#ECEEE9]">
          <div>
            <h3 className="font-semibold text-sm text-[#18181B]">
              Benchmark Reconciliation & Version Traceability
            </h3>
            <p className="text-[11px] text-[#646872] mt-0.5">
              Source-attributed Engine v{E.VERSION} evaluation metrics separated from the preserved legacy v{legacyBenchmark.version} archive.
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#646872] shrink-0">
            Simulated Evaluation · Not Real-World Guarantee
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Active v3.0.0 Predictive Model Metrics */}
          <div className="p-3 rounded-md bg-[#0066FF]/[0.03] border border-[#0066FF]/20 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#18181B]">
                Active Hybrid Predictor (v{E.VERSION})
              </span>
              <span className="font-mono text-[10px] text-[#0066FF]">
                model_metrics.json
              </span>
            </div>
            <p className="text-[11px] text-[#52565E] leading-relaxed">
              {modelMetrics.trees}-tree Random Forest ({Math.round(modelMetrics.blend_weights.random_forest_residual * 100)}% RF + {Math.round(modelMetrics.blend_weights.physics_lumped_ode * 100)}% physics), {modelMetrics.features.length} features, {modelMetrics.horizon_minutes}-min lookahead.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] pt-1 text-[#18181B] tabular-nums">
              <span>Test MAE: {modelMetrics.metrics.hybrid_mae_c.toFixed(3)}°C</span>
              <span>Test R²: {modelMetrics.metrics.hybrid_r2.toFixed(3)}</span>
              <span>95% Coverage: {modelMetrics.metrics.test_95_interval_coverage_pct.toFixed(1)}%</span>
              <span>Conformal Q95: ±{modelMetrics.calibration_q95.toFixed(4)}°C</span>
            </div>
            <p className="text-[10px] text-[#646872] leading-snug pt-0.5">
              Evaluated on {modelMetrics.metrics.test_episodes} synthetic held-out episodes ({modelMetrics.metrics.test_samples.toLocaleString()} samples) vs {modelMetrics.metrics.persistence_mae_c.toFixed(2)}°C persistence MAE.
            </p>
          </div>

          {/* Preserved Legacy v1.0.0 Archive */}
          <div className="p-3 rounded-md bg-[#F9FAF7] border border-[#DCDED8] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#18181B]">
                Legacy Archive (v{legacyBenchmark.version})
              </span>
              <span className="font-mono text-[10px] text-[#646872]">
                verified_benchmark.json
              </span>
            </div>
            <p className="text-[11px] text-[#52565E] leading-relaxed">
              Retained untouched for historical traceability from an earlier plant calibration and workload profile. Never blended with v{E.VERSION} claims.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] pt-1 text-[#52565E] tabular-nums">
              <span>Legacy MAE: {legacyBenchmark.model_metrics.mae_c.toFixed(3)}°C</span>
              <span>Legacy R²: {legacyBenchmark.model_metrics.r2_temperature.toFixed(3)}</span>
              <span>95% Coverage: {(legacyBenchmark.model_metrics.test_95_interval_coverage * 100).toFixed(1)}%</span>
              <span>Legacy Sensor Reactive: 220m / 98.8L</span>
            </div>
            <p className="text-[10px] text-[#646872] leading-snug pt-0.5">
              Engine v{E.VERSION} under Sensor Failure gives 0 vs 390 rack-min over limit (not the older 220 rack-min figure).
            </p>
          </div>
        </div>

        {/* Live v3.0.0 Headline Comparisons */}
        {suiteRuns.length > 0 && (() => {
          const compound = suiteRuns.find((r) => r.scenario === 'compound');
          const sensor = suiteRuns.find((r) => r.scenario === 'sensor');
          const water = suiteRuns.find((r) => r.scenario === 'water');
          const headlines = [
            compound && {
              scenario: 'Compound Stress (compound)',
              comparison: 'THERMOS AI vs No-Intervention / Reactive',
              value: `${compound.results.thermos.over_limit_rack_minutes} vs ${compound.results.none.over_limit_rack_minutes} / ${compound.results.reactive.over_limit_rack_minutes} rack-min >30°C · ${compound.results.thermos.water_l.toFixed(2)} vs ${compound.results.reactive.water_l.toFixed(2)} L · ${compound.results.thermos.grid_kwh.toFixed(2)} vs ${compound.results.reactive.grid_kwh.toFixed(2)} kWh (+${(((compound.results.thermos.grid_kwh - compound.results.reactive.grid_kwh) / compound.results.reactive.grid_kwh) * 100).toFixed(1)}% fan/compute balance)`,
            },
            sensor && {
              scenario: 'Sensor Failure (sensor, R07 @ 11:00)',
              comparison: 'THERMOS AI vs Reactive Thermostat',
              value: `${sensor.results.thermos.over_limit_rack_minutes} vs ${sensor.results.reactive.over_limit_rack_minutes} rack-min >30°C · ${sensor.results.thermos.water_l.toFixed(2)} vs ${sensor.results.reactive.water_l.toFixed(2)} L · ${sensor.results.thermos.peak_inlet_c.toFixed(2)} vs ${sensor.results.reactive.peak_inlet_c.toFixed(2)}°C peak`,
            },
            water && {
              scenario: 'Severe Drought Cap (water, 20 L budget)',
              comparison: 'THERMOS AI vs Reactive Thermostat',
              value: `${water.results.thermos.over_limit_rack_minutes} vs ${water.results.reactive.over_limit_rack_minutes} rack-min >30°C · ${water.results.thermos.water_l.toFixed(2)} vs ${water.results.reactive.water_l.toFixed(2)} L · ${water.results.thermos.grid_kwh.toFixed(2)} vs ${water.results.reactive.grid_kwh.toFixed(2)} kWh`,
            },
          ].filter(Boolean) as Array<{ scenario: string; comparison: string; value: string }>;

          if (headlines.length === 0) return null;
          return (
            <div className="pt-2 border-t border-[#ECEEE9] space-y-1.5">
              <span className="text-[11px] font-semibold text-[#18181B] block">
                Verified Engine v{E.VERSION} Headline Comparisons (Source: {runSource === 'live' ? 'Live Browser Run' : 'Deterministic Engine v3.0.0'})
              </span>
              <div className="space-y-1 text-[11px]">
                {headlines.map((h) => (
                  <div
                    key={h.scenario}
                    className="flex flex-col lg:flex-row lg:items-baseline justify-between gap-1 py-1 px-2.5 rounded bg-[#FAFAF7] border border-[#ECEEE9]"
                  >
                    <span className="font-medium text-[#18181B]">
                      {h.scenario} <span className="text-[#646872] font-normal">({h.comparison})</span>
                    </span>
                    <span className="font-mono text-[#18181B] tabular-nums">{h.value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

      {/* 6 Scenarios x 4 Controllers Results Cards */}
      <div className="space-y-4">
        {suiteRuns.map((suiteItem, sIdx) => {
          const t = suiteItem.results.thermos;
          const n = suiteItem.results.none;
          const r = suiteItem.results.reactive;
          const p = suiteItem.results.physics;

          const thermosSafe = t.over_limit_rack_minutes === 0 && !t.water_budget_exceeded;

          const rows = [
            { key: 'thermos', name: 'THERMOS (AI)', data: t, highlight: true },
            { key: 'none', name: 'No-Intervention Baseline', data: n, highlight: false },
            { key: 'reactive', name: 'Reactive Thermostat', data: r, highlight: false },
            { key: 'physics', name: 'Engineering Model', data: p, highlight: false },
          ];

          return (
            <section
              key={suiteItem.scenario}
              className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 pb-2.5 border-b border-[#ECEEE9]">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs text-[#646872]">
                    0{sIdx + 1}.
                  </span>
                  <h3 className="font-semibold text-sm sm:text-base text-[#18181B]">
                    {suiteItem.label}
                  </h3>
                  <span className="text-xs font-mono text-[#8A8F99]">
                    · {suiteItem.scenario} · Limit {suiteItem.limitC}°C · Water {suiteItem.waterBudget}L
                  </span>
                </div>

                <div className="text-xs font-mono shrink-0">
                  {thermosSafe ? (
                    <span className="text-[#047857] font-medium">
                      THERMOS within thermal & water bounds
                    </span>
                  ) : (
                    <span className="text-[#B45309] font-medium">
                      Constraint stress logged ({t.over_limit_rack_minutes} rack-min &gt; {suiteItem.limitC}°C)
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[680px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCDED8] text-[#646872] font-medium">
                      <th className="py-2 pr-3 font-medium">Control Strategy</th>
                      <th className="py-2 px-2.5 font-medium">Grid (kWh)</th>
                      <th className="py-2 px-2.5 font-medium">Water (L)</th>
                      <th className="py-2 px-2.5 font-medium">Peak (°C)</th>
                      <th className="py-2 px-2.5 font-medium">Over-limit</th>
                      <th className="py-2 px-2.5 font-medium">Batch (min)</th>
                      <th className="py-2 px-2.5 font-medium">Missed</th>
                      <th className="py-2 px-2.5 font-medium">Path A (kWh_th)</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Path B Aux TEG (Wh)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECEEE9] font-mono tabular-nums">
                    {rows.map((row) => {
                      const d = row.data;
                      const overTemp = d.peak_inlet_c > suiteItem.limitC;
                      const overMinutes = d.over_limit_rack_minutes > 0;
                      return (
                        <tr
                          key={row.key}
                          className={
                            row.highlight
                              ? 'bg-[#0066FF]/[0.04] font-semibold text-[#18181B]'
                              : 'hover:bg-[#F9FAF7] text-[#52565E]'
                          }
                        >
                          <td className="py-2.5 pr-3 font-sans whitespace-nowrap">
                            <span className={row.highlight ? 'text-[#0066FF] font-semibold' : 'text-[#18181B]'}>
                              {row.name}
                            </span>
                          </td>
                          <td className="py-2.5 px-2.5">{d.grid_kwh.toFixed(1)}</td>
                          <td
                            className={`py-2.5 px-2.5 ${
                              d.water_budget_exceeded ? 'text-[#B45309] font-semibold' : ''
                            }`}
                          >
                            {d.water_l.toFixed(1)}
                          </td>
                          <td
                            className={`py-2.5 px-2.5 ${
                              overTemp ? 'text-[#DC2626] font-semibold' : ''
                            }`}
                          >
                            {d.peak_inlet_c.toFixed(1)}°C
                          </td>
                          <td
                            className={`py-2.5 px-2.5 ${
                              overMinutes ? 'text-[#DC2626] font-semibold' : 'text-[#047857]'
                            }`}
                          >
                            {d.over_limit_rack_minutes}m
                          </td>
                          <td className="py-2.5 px-2.5">
                            {d.batch_completed_rack_minutes.toFixed(0)}
                          </td>
                          <td
                            className={`py-2.5 px-2.5 ${
                              d.missed_deadlines > 0 ? 'text-[#DC2626] font-semibold' : ''
                            }`}
                          >
                            {d.missed_deadlines}
                          </td>
                          <td className="py-2.5 px-2.5">{d.useful_heat_kwh_th.toFixed(1)}</td>
                          <td className="py-2.5 pl-2.5 text-right">
                            {(d.recovered_electricity_kwh * 1000).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {/* Scientific Validity Footnote */}
      <section className="p-4 rounded-lg bg-[#F1F2EE] border border-[#DCDED8] text-xs text-[#52565E] leading-relaxed">
        <span className="font-semibold text-[#18181B] block mb-1">
          Reproducibility & Deterministic Parity
        </span>
        All {totalEpisodes} episodes execute from identical initial rack temperatures, identical incoming computational demand curves, and deterministic ambient weather profiles. The No-Intervention Baseline locks cooling setpoints and leaves hotspots unmigrated to quantify raw physical exposure, while the Engineering Model uses zero-error plant lookahead as an upper reference bound.
      </section>
    </div>
  );
};
