import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Box,
  BarChart3,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  AlertTriangle,
  Check,
  X,
  Wind,
  Flame,
  Recycle,
  GitBranch,
  Cpu,
} from 'lucide-react';
import type {
  GlobalFacilityState,
  StepRecord,
  SimulationState,
  ThermosConfig,
  PresetKey,
  SystemMode,
} from '../simulation/types';
import * as E from '../simulation/engine';
import { buildContextualExplanation } from '../simulation/explanationEngine';
import {
  REGIONAL_GRID_PRESETS,
  calculateOperationalEmissionsKg,
} from '../simulation/carbon';
import type { PathwayPanelKind } from './ThermosCorePanel';
import type { ActiveDrawer } from './TechnicalDrawers';

export type PhoneTab = 'guide' | '3d' | 'impact';

interface MobilePhoneExperienceProps {
  activeTab: PhoneTab;
  onChangeTab: (tab: PhoneTab) => void;
  facility: GlobalFacilityState;
  currentRecord: StepRecord | null;
  states: {
    thermos: SimulationState;
    reactive: SimulationState;
    physics: SimulationState;
    none?: SimulationState;
  };
  config: ThermosConfig;
  thermosEnabled: boolean;
  onToggleThermos: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onReset: () => void;
  scenarioKey: PresetKey;
  onSelectScenario: (preset: PresetKey) => void;
  systemMode: SystemMode;
  onChangeSystemMode: (mode: SystemMode) => void;
  timeString: string;
  onInspectRackIn3D: (rackId: number) => void;
  onInspectPathwayIn3D: (kind: PathwayPanelKind) => void;
  onOpenFullDrawer: (drawer: Exclude<ActiveDrawer, 'none'>) => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  hideChrome?: boolean;
}

const SCENARIO_OPTIONS: Array<{
  key: PresetKey;
  label: string;
  summary: string;
}> = [
  {
    key: 'compound',
    label: 'Compound Stress',
    summary: '43.2°C heatwave, 82% load, 35L water cap, R07 airflow issue at 11:00',
  },
  {
    key: 'sensor',
    label: 'Sensor Failure',
    summary: 'Rack thermometer goes offline; THERMOS estimates heat virtually',
  },
  {
    key: 'water',
    label: 'Severe Drought Cap',
    summary: 'Strict 20L cooling water budget forces dry air & job shifting',
  },
  {
    key: 'normal',
    label: 'Normal Working Day',
    summary: 'Mild 32°C ambient with steady baseline server workload',
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    title: 'Predict heat 15 minutes early',
    body: 'Instead of waiting for a server rack to overheat, THERMOS forecasts inlet temperatures 3 steps (15 minutes) ahead using a lightweight Random Forest model trained on thermal physics.',
  },
  {
    num: '02',
    title: 'Virtual sensing when thermometers fail',
    body: 'If a rack sensor drops offline, THERMOS infers its true temperature from its power draw, neighbouring racks, and local airflow—staying within ±0.4°C without blind spots.',
  },
  {
    num: '03',
    title: 'Move flexible jobs away from hot spots',
    body: '45% of rack work stays pinned for latency, while flexible jobs and 3 batch jobs (360 rack-min) shift smoothly to cooler racks before temperatures breach the 30°C safe limit.',
  },
  {
    num: '04',
    title: 'Cut water waste & capture reusable heat',
    body: 'By cooling racks proactively with compute placement rather than water-heavy evaporative chillers, THERMOS preserves drought reserves and channels warm exhaust toward building heating.',
  },
];

export const MobilePhoneExperience: React.FC<MobilePhoneExperienceProps> = ({
  activeTab,
  onChangeTab,
  facility,
  currentRecord,
  states,
  config,
  thermosEnabled,
  onToggleThermos,
  isPlaying,
  onTogglePlay,
  onStepForward,
  onReset,
  scenarioKey,
  onSelectScenario,
  systemMode,
  onChangeSystemMode,
  timeString,
  onInspectRackIn3D,
  onInspectPathwayIn3D,
  onOpenFullDrawer,
  onApprovePlan,
  onRejectPlan,
  hideChrome = false,
}) => {
  const [expandedHowStep, setExpandedHowStep] = useState<string | null>('01');
  const [showAllRacks, setShowAllRacks] = useState<boolean>(false);

  const coreExplanation = useMemo(
    () => buildContextualExplanation({ type: 'core' }, facility, currentRecord, false),
    [facility, currentRecord]
  );

  const peakInletC = useMemo(
    () =>
      Math.max(
        ...facility.racks.map((r) => (r.sensorAvailable ? r.simulatedInletC : r.estimatedInletC))
      ),
    [facility.racks]
  );

  const warmestRack = useMemo(() => {
    return [...facility.racks].sort((a, b) => {
      const ta = a.sensorAvailable ? a.simulatedInletC : a.estimatedInletC;
      const tb = b.sensorAvailable ? b.simulatedInletC : b.estimatedInletC;
      return tb - ta;
    })[0];
  }, [facility.racks]);

  const sThermos = useMemo(() => E.summary(states.thermos, config), [states.thermos, config]);
  const sReactive = useMemo(() => E.summary(states.reactive, config), [states.reactive, config]);
  const sNone = useMemo(
    () => (states.none ? E.summary(states.none, config) : null),
    [states.none, config]
  );

  const gridPreset = REGIONAL_GRID_PRESETS[0];
  const thermosCo2 = calculateOperationalEmissionsKg(sThermos.grid_kwh, gridPreset.factorGPerKWh);
  const reactiveCo2 = calculateOperationalEmissionsKg(
    sReactive.grid_kwh,
    gridPreset.factorGPerKWh
  );

  const pendingPlan =
    thermosEnabled && facility.pendingPlan && systemMode === 'interactive'
      ? facility.pendingPlan
      : null;

  const visibleIncidents = facility.activeIncidents.filter((i) => i.severity !== 'ADVISORY');

  const subsystemGuides: Array<{
    kind: PathwayPanelKind;
    title: string;
    status: string;
    explanation: string;
    icon: React.ReactNode;
  }> = [
    {
      kind: 'compute',
      title: 'Job Routing',
      status: thermosEnabled
        ? `${facility.thermos.activeTransfers.length} active shifts`
        : 'Fixed placement',
      explanation:
        'Moves flexible computing tasks off warming racks toward cooler aisles, reducing heat generation at the source instead of cranking fans.',
      icon: <GitBranch className="w-4 h-4 text-[#0066FF]" />,
    },
    {
      kind: 'cooling',
      title: 'Smart Cooling',
      status: `${facility.coolingSupplyC}°C · ${
        facility.activeCoolingMode === 'wet' ? 'Evaporative' : 'Dry Air'
      }`,
      explanation:
        'Coordinates supply air temperature and fan speed only where needed, avoiding water-intensive evaporative cooling until strictly necessary.',
      icon: <Wind className="w-4 h-4 text-[#0284C7]" />,
    },
    {
      kind: 'heat',
      title: 'Heat Capture',
      status: `${facility.heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th`,
      explanation:
        'Hydronic coils behind warm server rows collect concentrated exhaust heat rather than venting it into the atmosphere.',
      icon: <Flame className="w-4 h-4 text-[#D97706]" />,
    },
    {
      kind: 'recovery',
      title: 'Heat Reuse + TEG',
      status: facility.heatRecovery.isExporting ? 'Exporting heat' : 'Standby',
      explanation:
        'Exports captured thermal energy for nearby building heating while a solid-state thermoelectric module recovers auxiliary sensor power.',
      icon: <Recycle className="w-4 h-4 text-[#059669]" />,
    },
  ];

  return (
    <>
      {/* Slim Phone Top Header (44px) — only rendered on Guide & Impact tabs (3D tab has its own slim header inside DataCentreScene) */}
      {activeTab !== '3d' && (
        <header className="fixed top-0 inset-x-0 z-20 safe-top bg-white/95 backdrop-blur-md border-b border-[#DCDED8]">
          <div className="h-11 px-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold tracking-tight text-[#18181B]">THERMOS</span>
              <span className="text-[#C4C7CE]" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] text-[#52565E] tabular-nums truncate">
                {timeString} · {peakInletC.toFixed(1)}°C
              </span>
            </div>

            <button
              type="button"
              onClick={onToggleThermos}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                thermosEnabled
                  ? 'bg-[#18181B] text-white'
                  : 'bg-[#F1F2EE] text-[#18181B] border border-[#DCDED8]'
              }`}
            >
              {thermosEnabled ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>AI Active</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 text-[#059669]" />
                  <span>AI Paused</span>
                </>
              )}
            </button>
          </div>
        </header>
      )}

      {/* Scrollable Explanation-First Body (Guide or Impact tab) */}
      {activeTab !== '3d' && (
        <div className="fixed inset-0 pt-[calc(44px+env(safe-area-inset-top,0px))] pb-[calc(60px+env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-contain bg-[#F7F7F2] text-[#18181B]">
          {activeTab === 'guide' && (
            <div className="px-4 py-5 space-y-6 max-w-lg mx-auto">
              {/* Plain-English Intro */}
              <section className="space-y-2">
                <div className="text-xs font-medium text-[#0066FF]">
                  {facility.scenarioLabel}
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-[#18181B] leading-tight text-balance">
                  Predictive cooling that moves compute before racks overheat.
                </h1>
                <p className="text-[14.5px] text-[#52565E] leading-relaxed">
                  THERMOS watches a 12-rack data centre 15 minutes into the future, shifts flexible
                  jobs away from hot cabinets, and saves cooling water and electricity.
                </p>
              </section>

              {/* Manual Plan Approval Card (when Ask Me mode proposes a plan) */}
              {pendingPlan && (
                <section className="rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0066FF]">
                      Proposed Plan Ready
                    </span>
                    <span className="font-mono text-[11px] text-[#1E40AF] tabular-nums">
                      {pendingPlan.predictedOutcomes.baselineProjectedPeakC.toFixed(1)}° →{' '}
                      {pendingPlan.predictedOutcomes.projectedPeakC.toFixed(1)}°C
                    </span>
                  </div>
                  <p className="text-xs text-[#1E3A8A] leading-relaxed">
                    {pendingPlan.rationale}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={onApprovePlan}
                      className="min-h-[44px] rounded-xl bg-[#0066FF] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Approve Plan</span>
                    </button>
                    <button
                      type="button"
                      onClick={onRejectPlan}
                      className="min-h-[44px] rounded-xl bg-white border border-[#BFDBFE] text-[#1E40AF] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Skip</span>
                    </button>
                  </div>
                </section>
              )}

              {/* Live Plain-English Facility Narrative */}
              <section className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#0066FF]" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-[#18181B]">
                      What is happening right now
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-[#646872] tabular-nums">
                    {timeString}
                  </span>
                </div>

                {coreExplanation && (
                  <>
                    <p className="text-[13.5px] font-medium text-[#18181B] leading-relaxed">
                      {coreExplanation.level1}
                    </p>

                    <div className="pt-2 border-t border-[#ECEEE9] space-y-1.5">
                      <div className="text-[11px] font-medium text-[#646872]">Why it matters</div>
                      <ul className="space-y-1.5 text-xs text-[#52565E] leading-relaxed">
                        {coreExplanation.level2.causes.map((cause, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-[#0066FF] font-bold">·</span>
                            <span>{cause}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-2 border-t border-[#ECEEE9] space-y-1.5">
                      <div className="text-[11px] font-medium text-[#646872]">What THERMOS does</div>
                      <p className="text-xs font-medium text-[#18181B]">
                        {coreExplanation.level3.summary}
                      </p>
                      {coreExplanation.level3.steps.length > 0 && (
                        <ul className="space-y-1 text-xs text-[#52565E] leading-relaxed">
                          {coreExplanation.level3.steps.map((step, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-[#059669] font-bold">·</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                {/* Live 3-number unboxed strip */}
                <div className="pt-3 border-t border-[#ECEEE9] grid grid-cols-3 divide-x divide-[#ECEEE9] text-center">
                  <div className="px-1">
                    <div className="text-[10.5px] text-[#646872]">Warmest Rack</div>
                    <div className="font-mono text-sm font-semibold text-[#18181B] tabular-nums mt-0.5">
                      {warmestRack?.label} · {peakInletC.toFixed(1)}°C
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10.5px] text-[#646872]">Water Left</div>
                    <div className="font-mono text-sm font-semibold text-[#18181B] tabular-nums mt-0.5">
                      {facility.waterRemainingL.toFixed(0)} L
                    </div>
                  </div>
                  <div className="px-1">
                    <div className="text-[10.5px] text-[#646872]">Heat Reused</div>
                    <div className="font-mono text-sm font-semibold text-[#059669] tabular-nums mt-0.5">
                      {facility.heatRecovery.extractedHeatKW.toFixed(1)} kW
                    </div>
                  </div>
                </div>
              </section>

              {/* Active Incidents Explained */}
              {visibleIncidents.length > 0 && (
                <section className="space-y-2.5">
                  <h2 className="text-xs font-semibold text-[#646872] px-0.5">
                    Active Faults &amp; Events Explained
                  </h2>
                  {visibleIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-2"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            inc.severity === 'CRITICAL' ? 'text-[#DC2626]' : 'text-[#D97706]'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[#18181B]">{inc.title}</div>
                          <p className="text-xs text-[#52565E] leading-relaxed mt-1">
                            {inc.observedEvidence}
                          </p>
                          <p className="text-xs text-[#18181B] font-medium leading-relaxed mt-1.5">
                            {thermosEnabled
                              ? inc.recommendedAction
                              : 'THERMOS is currently paused, so this fault is not being actively mitigated.'}
                          </p>
                        </div>
                      </div>
                      {inc.affectedRacks.length > 0 && inc.affectedRacks.length <= 6 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {inc.affectedRacks.map((rId) => (
                            <button
                              key={rId}
                              type="button"
                              onClick={() => onInspectRackIn3D(rId)}
                              className="min-h-[36px] px-3 rounded-lg bg-[#F7F7F2] border border-[#DCDED8] font-mono text-xs font-semibold text-[#18181B] flex items-center gap-1 cursor-pointer"
                            >
                              <span>Inspect R{String(rId + 1).padStart(2, '0')} in 3D</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {/* How THERMOS Works (4-Step Plain-English Walkthrough) */}
              <section className="space-y-2.5">
                <h2 className="text-xs font-semibold text-[#646872] px-0.5">
                  How THERMOS Works (4 Steps)
                </h2>
                <div className="rounded-2xl bg-white border border-[#DCDED8] divide-y divide-[#ECEEE9] overflow-hidden">
                  {HOW_IT_WORKS_STEPS.map((step) => {
                    const isOpen = expandedHowStep === step.num;
                    return (
                      <div key={step.num}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setExpandedHowStep((prev) => (prev === step.num ? null : step.num))
                          }
                          className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#FAFAF7] transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-xs font-semibold text-[#0066FF] shrink-0">
                              {step.num}.
                            </span>
                            <span className="text-[13.5px] font-semibold text-[#18181B] leading-snug">
                              {step.title}
                            </span>
                          </div>
                          {isOpen ? (
                            <ChevronUp className="w-4 h-4 text-[#646872] shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-[#646872] shrink-0" />
                          )}
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-3.5 pl-11 text-xs text-[#52565E] leading-relaxed">
                            {step.body}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Four Subsystems Explained */}
              <section className="space-y-2.5">
                <h2 className="text-xs font-semibold text-[#646872] px-0.5">
                  Facility Subsystems Explained
                </h2>
                <div className="space-y-2.5">
                  {subsystemGuides.map((item) => (
                    <div
                      key={item.kind}
                      className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {item.icon}
                          <h3 className="text-sm font-semibold text-[#18181B]">{item.title}</h3>
                        </div>
                        <span className="font-mono text-[11px] text-[#52565E] tabular-nums">
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-[#52565E] leading-relaxed">{item.explanation}</p>
                      <button
                        type="button"
                        onClick={() => onInspectPathwayIn3D(item.kind)}
                        className="min-h-[36px] text-xs font-semibold text-[#0066FF] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span>View {item.title} in 3D</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Quick Rack Overview (expandable) */}
              <section className="rounded-2xl bg-white border border-[#DCDED8] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAllRacks((v) => !v)}
                  className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between text-left cursor-pointer"
                >
                  <div>
                    <div className="text-sm font-semibold text-[#18181B]">
                      All 12 Server Racks Status
                    </div>
                    <div className="text-xs text-[#646872]">
                      Tap a rack to inspect its forecast in 3D
                    </div>
                  </div>
                  {showAllRacks ? (
                    <ChevronUp className="w-4 h-4 text-[#646872]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#646872]" />
                  )}
                </button>
                {showAllRacks && (
                  <div className="px-4 pb-4 grid grid-cols-4 gap-2 border-t border-[#ECEEE9] pt-3">
                    {facility.racks.map((rack) => {
                      const t = rack.sensorAvailable ? rack.simulatedInletC : rack.estimatedInletC;
                      const isCrit = rack.thermalRiskState === 'CRITICAL';
                      const isWarm = rack.thermalRiskState === 'WARMING';
                      return (
                        <button
                          key={rack.id}
                          type="button"
                          onClick={() => onInspectRackIn3D(rack.id)}
                          className={`min-h-[56px] p-2 rounded-xl border text-left flex flex-col justify-between cursor-pointer ${
                            isCrit
                              ? 'bg-[#FEF2F2] border-[#FCA5A5]'
                              : isWarm
                              ? 'bg-[#FFFBEB] border-[#FCD34D]'
                              : 'bg-[#F7F7F2] border-[#DCDED8]'
                          }`}
                        >
                          <span className="font-mono text-[11px] font-bold text-[#18181B]">
                            {rack.label}
                          </span>
                          <span className="font-mono text-xs font-semibold tabular-nums text-[#18181B]">
                            {t.toFixed(1)}°
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Simple Scenario & Clock Controls */}
              <section className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#18181B]">Try a Stress Scenario</h2>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onTogglePlay}
                      className="min-h-[36px] px-2.5 rounded-lg border border-[#DCDED8] bg-[#F7F7F2] text-xs font-medium text-[#18181B] cursor-pointer"
                    >
                      {isPlaying ? 'Freeze' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={onStepForward}
                      disabled={isPlaying}
                      aria-label="Advance 5 minutes"
                      className="min-h-[36px] px-2.5 rounded-lg border border-[#DCDED8] bg-[#F7F7F2] disabled:opacity-40 text-xs font-mono text-[#18181B] flex items-center gap-1 cursor-pointer"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                      <span>+5m</span>
                    </button>
                    <button
                      type="button"
                      onClick={onReset}
                      aria-label="Restart shift"
                      className="min-h-[36px] w-9 rounded-lg border border-[#DCDED8] bg-[#F7F7F2] text-[#52565E] flex items-center justify-center cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {SCENARIO_OPTIONS.map((opt) => {
                    const active = scenarioKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => onSelectScenario(opt.key)}
                        className={`w-full p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#18181B] border-[#18181B] text-white'
                            : 'bg-[#F7F7F2] border-[#E2E4DF] text-[#18181B]'
                        }`}
                      >
                        <div className="text-xs font-semibold">{opt.label}</div>
                        <div
                          className={`text-[11px] mt-0.5 leading-snug ${
                            active ? 'text-[#D4D4D8]' : 'text-[#646872]'
                          }`}
                        >
                          {opt.summary}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Auto vs Ask Me switch */}
                <div className="pt-2 border-t border-[#ECEEE9] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#18181B]">Approval Mode</div>
                    <div className="text-[11px] text-[#646872]">
                      {systemMode === 'demonstration'
                        ? 'Auto-runs best 5-minute plan'
                        : 'Asks you before shifting jobs'}
                    </div>
                  </div>
                  <div className="flex items-center p-0.5 rounded-lg bg-[#F1F2EE] border border-[#DCDED8] shrink-0">
                    <button
                      type="button"
                      onClick={() => onChangeSystemMode('demonstration')}
                      className={`min-h-[34px] px-3 rounded-md text-xs font-medium cursor-pointer ${
                        systemMode === 'demonstration'
                          ? 'bg-white text-[#18181B] font-semibold shadow-2xs'
                          : 'text-[#646872]'
                      }`}
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeSystemMode('interactive')}
                      className={`min-h-[34px] px-3 rounded-md text-xs font-medium cursor-pointer ${
                        systemMode === 'interactive'
                          ? 'bg-white text-[#18181B] font-semibold shadow-2xs'
                          : 'text-[#646872]'
                      }`}
                    >
                      Ask Me
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'impact' && (
            <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
              <section className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight text-[#18181B]">
                  Measured Impact &amp; Sustainability
                </h1>
                <p className="text-xs text-[#52565E] leading-relaxed">
                  Live side-by-side results comparing THERMOS against a conventional Fixed
                  Thermostat controller on the exact same workload.
                </p>
              </section>

              {/* Plain-English Comparison Cards */}
              <section className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl bg-white border border-[#DCDED8] p-3.5 space-y-1">
                  <div className="text-[11px] text-[#646872]">Peak Rack Temp</div>
                  <div className="font-mono text-lg font-bold text-[#18181B] tabular-nums">
                    {sThermos.peak_inlet_c.toFixed(1)}°C
                  </div>
                  <div className="text-[11px] text-[#059669] font-medium">
                    vs {sReactive.peak_inlet_c.toFixed(1)}°C fixed
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-[#DCDED8] p-3.5 space-y-1">
                  <div className="text-[11px] text-[#646872]">Overheating Time</div>
                  <div className="font-mono text-lg font-bold text-[#18181B] tabular-nums">
                    {sThermos.over_limit_rack_minutes} min
                  </div>
                  <div className="text-[11px] text-[#52565E]">
                    vs {sReactive.over_limit_rack_minutes} min fixed
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-[#DCDED8] p-3.5 space-y-1">
                  <div className="text-[11px] text-[#646872]">Cooling Water Used</div>
                  <div className="font-mono text-lg font-bold text-[#18181B] tabular-nums">
                    {sThermos.water_l.toFixed(1)} L
                  </div>
                  <div className="text-[11px] text-[#0066FF] font-medium">
                    vs {sReactive.water_l.toFixed(1)} L fixed
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-[#DCDED8] p-3.5 space-y-1">
                  <div className="text-[11px] text-[#646872] truncate">
                    Grid CO₂ ({gridPreset.name})
                  </div>
                  <div className="font-mono text-lg font-bold text-[#18181B] tabular-nums">
                    {thermosCo2.toFixed(1)} kg
                  </div>
                  <div className="text-[11px] text-[#059669] font-medium">
                    vs {reactiveCo2.toFixed(1)} kg fixed
                  </div>
                </div>
              </section>

              {sNone && (
                <section className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-2">
                  <h2 className="text-sm font-semibold text-[#18181B]">
                    Why predictive control beats reactive cooling
                  </h2>
                  <p className="text-xs text-[#52565E] leading-relaxed">
                    Without AI control, peak inlet temperatures reach{' '}
                    <span className="font-mono font-semibold text-[#18181B]">
                      {sNone.peak_inlet_c.toFixed(1)}°C
                    </span>{' '}
                    with{' '}
                    <span className="font-mono font-semibold text-[#18181B]">
                      {sNone.over_limit_rack_minutes} rack-minutes
                    </span>{' '}
                    above the safe limit. THERMOS keeps work completing smoothly (
                    {sThermos.batch_completed_rack_minutes}/360 batch rack-min) while shifting
                    compute away from thermal hotspots ahead of time.
                  </p>
                </section>
              )}

              {/* UN SDGs 9, 11, 12 Explanation */}
              <section className="rounded-2xl bg-white border border-[#DCDED8] p-4 space-y-3">
                <h2 className="text-sm font-semibold text-[#18181B]">
                  HOPE ’26 Sustainability Alignment
                </h2>
                <div className="rounded-xl overflow-hidden border border-[#ECEEE9] bg-[#F7F8F4]">
                  <img
                    src="/assets/aistudio/sdg_9_11_12.png"
                    alt="UN Sustainable Development Goals 9, 11, and 12"
                    className="w-full h-auto object-contain block"
                  />
                </div>
                <ul className="space-y-1.5 text-xs text-[#52565E] leading-relaxed">
                  <li>
                    <strong className="text-[#18181B]">SDG 9 (Resilient Infrastructure):</strong>{' '}
                    Virtual thermal sensing keeps server halls safe even when hardware sensors fail.
                  </li>
                  <li>
                    <strong className="text-[#18181B]">SDG 11 (Sustainable Cities):</strong>{' '}
                    Recovers server waste heat for nearby building heating loops.
                  </li>
                  <li>
                    <strong className="text-[#18181B]">SDG 12 (Responsible Consumption):</strong>{' '}
                    Protects municipal water reserves during heatwaves and droughts.
                  </li>
                </ul>
              </section>

              {/* Deep Technical Drawers Launchers */}
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-[#646872] px-0.5">
                  Full Charts &amp; Technical Evidence
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenFullDrawer('comparison')}
                    className="min-h-[48px] px-3 rounded-xl bg-white border border-[#DCDED8] text-xs font-semibold text-[#18181B] flex items-center justify-between cursor-pointer"
                  >
                    <span>Results Charts</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#646872]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenFullDrawer('evidence')}
                    className="min-h-[48px] px-3 rounded-xl bg-white border border-[#DCDED8] text-xs font-semibold text-[#18181B] flex items-center justify-between cursor-pointer"
                  >
                    <span>24-Run Evidence</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#646872]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenFullDrawer('decisions')}
                    className="min-h-[48px] px-3 rounded-xl bg-white border border-[#DCDED8] text-xs font-semibold text-[#18181B] flex items-center justify-between cursor-pointer"
                  >
                    <span>Decision Log</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#646872]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenFullDrawer('science')}
                    className="min-h-[48px] px-3 rounded-xl bg-white border border-[#DCDED8] text-xs font-semibold text-[#18181B] flex items-center justify-between cursor-pointer"
                  >
                    <span>Model &amp; Physics</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#646872]" />
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* Fixed 3-Tab Thumb-Zone Bottom Bar (52px + safe-area) */}
      {!hideChrome && (
        <nav
          data-interactive="true"
          aria-label="Phone navigation"
          className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur-md border-t border-[#DCDED8] safe-bottom pointer-events-auto"
        >
          <div className="grid grid-cols-3 h-[52px] items-center max-w-md mx-auto">
            <button
              type="button"
              onClick={() => onChangeTab('guide')}
              className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                activeTab === 'guide' ? 'text-[#0066FF]' : 'text-[#646872]'
              }`}
            >
              <BookOpen
                className="w-[18px] h-[18px]"
                strokeWidth={activeTab === 'guide' ? 2.25 : 1.75}
              />
              <span
                className={`text-[10.5px] leading-none whitespace-nowrap ${
                  activeTab === 'guide' ? 'font-semibold' : 'font-medium'
                }`}
              >
                Explanations
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('3d')}
              className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                activeTab === '3d' ? 'text-[#18181B]' : 'text-[#646872]'
              }`}
            >
              <Box
                className="w-[18px] h-[18px]"
                strokeWidth={activeTab === '3d' ? 2.25 : 1.75}
              />
              <span
                className={`text-[10.5px] leading-none whitespace-nowrap ${
                  activeTab === '3d' ? 'font-semibold' : 'font-medium'
                }`}
              >
                Live 3D Twin
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('impact')}
              className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                activeTab === 'impact' ? 'text-[#059669]' : 'text-[#646872]'
              }`}
            >
              <BarChart3
                className="w-[18px] h-[18px]"
                strokeWidth={activeTab === 'impact' ? 2.25 : 1.75}
              />
              <span
                className={`text-[10.5px] leading-none whitespace-nowrap ${
                  activeTab === 'impact' ? 'font-semibold' : 'font-medium'
                }`}
              >
                Impact &amp; SDGs
              </span>
            </button>
          </div>
        </nav>
      )}
    </>
  );
};
