import React from 'react';
import {
  X,
  Check,
  BarChart3,
  Play,
  Pause,
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  GitBranch,
  Sigma,
} from 'lucide-react';
import type {
  GlobalFacilityState,
  SystemMode,
  ThermosVisualState,
} from '../simulation/types';
import type {
  ContextualExplanation,
  ExplainableTarget,
} from '../simulation/explanationEngine';
import type { ActiveDrawer } from './TechnicalDrawers';
import { ResponsiveSheet } from './ResponsiveSheet';

export type PathwayPanelKind = 'compute' | 'heat' | 'recovery' | 'cooling';

interface ThermosCorePanelProps {
  isOpen: boolean;
  onClose: () => void;
  facility: GlobalFacilityState;
  systemMode: SystemMode;
  onToggleThermos: () => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onDismissOutcome: () => void;
  onSelectRack: (rackId: number) => void;
  onSelectIncident: (incidentId: string) => void;
  onSelectPathway: (kind: PathwayPanelKind) => void;
  onOpenDrawer: (drawer: Exclude<ActiveDrawer, 'none'>) => void;
  explanation?: ContextualExplanation | null;
  onNavigate?: (target: ExplainableTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  isMobile?: boolean;
}

const OPERATIONS_STEPS: Array<{
  id: string;
  label: string;
  matches: ThermosVisualState[];
}> = [
  { id: 'detect', label: 'Detect heat', matches: ['IDLE', 'SCANNING'] },
  { id: 'predict', label: 'Predict risk', matches: ['ANALYSING'] },
  { id: 'eval', label: 'Test 108 plans', matches: ['COORDINATING'] },
  { id: 'act', label: 'Adjust ops', matches: ['INTERVENING', 'MONITORING', 'ESCALATION', 'RESOLVED'] },
];

export const ThermosCorePanel: React.FC<ThermosCorePanelProps> = ({
  isOpen,
  onClose,
  facility,
  systemMode,
  onToggleThermos,
  onApprovePlan,
  onRejectPlan,
  onDismissOutcome,
  onSelectRack,
  onSelectIncident,
  onSelectPathway,
  onOpenDrawer,
  onBack,
  backLabel,
  isMobile = false,
}) => {
  if (!isOpen) return null;

  const thermos = facility.thermos;
  const isEnabled = thermos.enabled;
  const visualState = thermos.visualState;
  const plan = isEnabled ? facility.pendingPlan : null;
  const outcome = isEnabled && !plan ? facility.lastVerifiedOutcome : null;
  const visibleIncidents = facility.activeIncidents.filter((i) => i.severity !== 'ADVISORY');
  const isInterveningOrResolved = visualState === 'INTERVENING' || visualState === 'RESOLVED';

  const activeTransfers = isEnabled ? thermos.activeTransfers : [];
  const shownTransfers =
    activeTransfers.length > 0 ? activeTransfers : plan ? plan.transfers : [];

  const dotColorClass = !isEnabled
    ? 'bg-[#94A3B8]'
    : isInterveningOrResolved
    ? 'bg-[#059669]'
    : visualState === 'ESCALATION'
    ? 'bg-[#DC2626]'
    : 'bg-[#0066FF]';

  const header = (
    <div className="px-3.5 py-2.5 border-b border-[#ECEEE9] flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={`Back to ${backLabel || 'previous'}`}
            className="px-1.5 py-0.5 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#DCDED8] text-[10px] font-medium text-[#52565E] hover:text-[#18181B] flex items-center gap-0.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-2.5 h-2.5" />
            <span>{backLabel || 'Back'}</span>
          </button>
        )}
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColorClass}`} />
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight text-[#18181B] whitespace-nowrap">
            THERMOS Core
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onToggleThermos}
          className={`px-2 py-1 rounded border text-[10.5px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
            isEnabled
              ? 'border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[#52565E]'
              : 'border-[#059669] bg-[#059669] hover:bg-[#047857] text-white'
          }`}
        >
          {isEnabled ? (
            <>
              <Pause className="w-2.5 h-2.5" />
              <span>Pause AI</span>
            </>
          ) : (
            <>
              <Play className="w-2.5 h-2.5" />
              <span>Turn On</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close THERMOS Core panel"
          className="w-7 h-7 -mr-1 flex items-center justify-center rounded text-[#646872] hover:text-[#18181B] hover:bg-[#F1F1EC] transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <ResponsiveSheet
      isMobile={isMobile}
      ariaLabel="THERMOS Core — Intelligent Operations"
      onDismiss={onClose}
      showMobileScrim={true}
      mobileMaxHeightClass="max-h-[60dvh]"
      desktopClassName="top-4 right-3.5 xl:right-4 w-[356px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)] animate-slideLeft"
      header={header}
    >
      <div className="p-3.5 space-y-3 text-xs">
        {/* 4-Stage Operations Pipeline */}
        <div className="rounded-md border border-[#DCDED8] bg-[#FAFAF7] p-2.5 space-y-1.5">
          <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
            {OPERATIONS_STEPS.map((step) => {
              const active = isEnabled && step.matches.includes(visualState);
              return (
                <div
                  key={step.id}
                  className={`py-1.5 px-1 rounded border transition-colors ${
                    active
                      ? 'bg-[#18181B] border-[#18181B] text-white font-semibold'
                      : 'bg-white border-[#E4E6E0] text-[#646872]'
                  }`}
                >
                  {step.label}
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-[#52565E] leading-snug">
            {isEnabled
              ? 'Evaluates 108 cooling & placement plans every 5m, shifting flexible work before racks overheat.'
              : 'THERMOS is paused. Fixed cooling fans run without shifting workloads.'}
          </p>
        </div>

        {/* Turn On CTA when paused */}
        {!isEnabled && (
          <button
            type="button"
            onClick={onToggleThermos}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[#059669] hover:bg-[#047857] text-white text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>Turn On THERMOS</span>
          </button>
        )}

        {/* Pending Plan Approval (Ask Me Mode) */}
        {plan && systemMode === 'interactive' && (
          <div className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#1E3A8A]">
                Plan Ready for Approval
              </span>
              <span className="font-mono text-[10px] text-[#1E3A8A] tabular-nums">
                {plan.predictedOutcomes.baselineProjectedPeakC.toFixed(1)}° →{' '}
                {plan.predictedOutcomes.projectedPeakC.toFixed(1)}°C
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onApprovePlan}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[#059669] hover:bg-[#047857] text-white text-[11px] font-semibold transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve</span>
              </button>
              <button
                type="button"
                onClick={onRejectPlan}
                className="px-3 py-1.5 rounded border border-[#DCDED8] bg-white hover:bg-[#F1F1EC] text-[#646872] hover:text-[#18181B] text-[11px] font-medium transition-colors cursor-pointer"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Outcome Confirmation */}
        {outcome && (
          <div className="rounded-md border border-[#D1FAE5] bg-[#F4FBF7] px-2.5 py-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-[#065F46] font-medium">
              Peak temp cooled: {outcome.peakBeforeC.toFixed(1)}° → {outcome.peakAfterC.toFixed(1)}°C
            </div>
            <button
              type="button"
              onClick={onDismissOutcome}
              className="text-[10px] text-[#646872] hover:text-[#18181B] cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Workload Distribution (45% Pinned vs 55% Flexible + 3 Batch Jobs) */}
        <div className="rounded-md border border-[#E2E4DF] bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#18181B]">
              Workload Distribution
            </span>
            <span className="text-[10px] font-mono text-[#52565E]">
              {systemMode === 'demonstration' ? 'Auto mode' : 'Ask Me mode'}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex h-3 rounded overflow-hidden border border-[#DCDED8]">
              <div
                className="bg-[#52565E] text-[8.5px] font-mono text-white flex items-center justify-center"
                style={{ width: '45%' }}
                title="45% pinned workload stays in place"
              >
                45% Pinned
              </div>
              <div
                className="bg-[#0066FF] text-[8.5px] font-mono text-white flex items-center justify-center"
                style={{ width: '55%' }}
                title="55% flexible workload can move to cooler racks"
              >
                55% Flexible
              </div>
            </div>
            <div className="text-[10px] text-[#646872]">
              3 scheduled batch jobs (360 rack-min total) flex safely around peak heat.
            </div>
          </div>

          {/* Live Hot -> Cool Workload Transfers */}
          {shownTransfers.length > 0 && (
            <div className="pt-1.5 border-t border-[#ECEEE9] space-y-1">
              <div className="text-[10px] font-medium text-[#059669]">
                {activeTransfers.length > 0
                  ? 'Moving computing work to cooler racks:'
                  : 'Proposed move to cool hot racks:'}
              </div>
              {shownTransfers.slice(0, 4).map((tr, idx) => (
                <div
                  key={`${tr.fromRack}-${tr.toRack}-${idx}`}
                  className="flex items-center justify-between px-2 py-1 rounded bg-[#F7F7F2] border border-[#E6E8E3] font-mono text-[10.5px] tabular-nums"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectRack(tr.fromRack)}
                      className="font-semibold text-[#B45309] hover:underline cursor-pointer"
                    >
                      R{String(tr.fromRack + 1).padStart(2, '0')}
                    </button>
                    <ArrowRight className="w-3 h-3 text-[#059669]" />
                    <button
                      type="button"
                      onClick={() => onSelectRack(tr.toRack)}
                      className="font-semibold text-[#059669] hover:underline cursor-pointer"
                    >
                      R{String(tr.toRack + 1).padStart(2, '0')}
                    </button>
                  </div>
                  <span className="text-[#52565E]">{Math.round(tr.fractionMoved * 100)}% moved</span>
                </div>
              ))}
            </div>
          )}

          {/* Cooling Setpoint Snapshot */}
          <div className="pt-1.5 border-t border-[#ECEEE9] grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
            <div className="rounded bg-[#F7F7F2] py-1 px-1.5">
              <div className="font-sans text-[9.5px] text-[#646872]">Supply Air</div>
              <div className="font-semibold text-[#18181B]">{facility.coolingSupplyC.toFixed(0)}°C</div>
            </div>
            <div className="rounded bg-[#F7F7F2] py-1 px-1.5">
              <div className="font-sans text-[9.5px] text-[#646872]">Fan Speed</div>
              <div className="font-semibold text-[#18181B]">{Math.round(facility.coolingFanPct)}%</div>
            </div>
            <div className="rounded bg-[#F7F7F2] py-1 px-1.5">
              <div className="font-sans text-[9.5px] text-[#646872]">Water Mode</div>
              <div className="font-semibold text-[#0066FF]">
                {facility.activeCoolingMode === 'dry' ? 'Dry (0 L)' : 'Water Mist'}
              </div>
            </div>
          </div>
        </div>

        {/* 12-Rack Status Map */}
        <div className="rounded-md border border-[#E2E4DF] bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold text-[#18181B]">
              All 12 Racks (Click to Inspect)
            </span>
            <span className="text-[10px] font-mono text-[#646872] tabular-nums">
              Avg{' '}
              {(
                facility.racks.reduce(
                  (acc, r) => acc + (r.sensorAvailable ? r.simulatedInletC : r.estimatedInletC),
                  0
                ) / 12
              ).toFixed(1)}
              °C
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {facility.racks.map((rack) => {
              const temp = rack.sensorAvailable ? rack.simulatedInletC : rack.estimatedInletC;
              const isHot = rack.thermalRiskState === 'CRITICAL';
              const isWarm = rack.thermalRiskState === 'WARMING';

              return (
                <button
                  key={rack.id}
                  type="button"
                  onClick={() => onSelectRack(rack.id)}
                  className={`p-1.5 rounded border text-left transition-colors cursor-pointer ${
                    isHot
                      ? 'border-[#FCA5A5] bg-[#FEF2F2] hover:bg-[#FEE2E2]'
                      : isWarm || !rack.sensorAvailable
                      ? 'border-[#FED7AA] bg-[#FFF7ED] hover:bg-[#FFEDD5]'
                      : 'border-[#E4E7DF] bg-[#F7F8F4] hover:bg-[#EFEFEA]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-0.5">
                    <span className="font-mono text-[10px] font-semibold text-[#18181B]">
                      {rack.label}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isHot
                          ? 'bg-[#DC2626]'
                          : isWarm || !rack.sensorAvailable
                          ? 'bg-[#EA580C]'
                          : 'bg-[#10B981]'
                      }`}
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-0.5 mt-0.5 font-mono text-[10px] tabular-nums">
                    <span
                      className={`font-semibold ${
                        isHot ? 'text-[#DC2626]' : isWarm ? 'text-[#C2410C]' : 'text-[#18181B]'
                      }`}
                    >
                      {!rack.sensorAvailable && !isEnabled ? 'Off' : `${temp.toFixed(1)}°`}
                    </span>
                    <span className="text-[8.5px] text-[#717680]">
                      {Math.round(rack.workloadUtil * 100)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Alerts */}
        {visibleIncidents.length > 0 && (
          <div className="pt-1.5 border-t border-[#ECEEE9] space-y-1.5">
            <div className="text-[10.5px] font-medium text-[#646872]">
              Active Alerts ({visibleIncidents.length})
            </div>
            <div className="space-y-1">
              {visibleIncidents.slice(0, 4).map((inc) => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => onSelectIncident(inc.id)}
                  className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        inc.severity === 'CRITICAL' ? 'bg-[#DC2626]' : 'bg-[#D97706]'
                      }`}
                    />
                    <span className="text-[11px] font-medium text-[#18181B] truncate">
                      {inc.title}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[#646872] shrink-0">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick System Pathways */}
        <div className="pt-2 border-t border-[#ECEEE9] grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onSelectPathway('compute')}
            className="p-2 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] text-left transition-colors cursor-pointer"
          >
            <div className="text-[10.5px] font-medium text-[#18181B]">Job Routing</div>
            <div className="font-mono text-[10px] text-[#0066FF] font-semibold mt-0.5 tabular-nums">
              {facility.computingPowerKW.toFixed(1)} kW · {Math.round(facility.totalWorkloadPct)}%
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectPathway('recovery')}
            className="p-2 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] text-left transition-colors cursor-pointer"
          >
            <div className="text-[10.5px] font-medium text-[#18181B]">Thermal Recovery</div>
            <div className="font-mono text-[10px] text-[#059669] font-semibold mt-0.5 tabular-nums">
              {facility.heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th
            </div>
          </button>
        </div>

        {/* Direct 1-Click Deep Analysis Launchers */}
        <div className="pt-2 border-t border-[#ECEEE9] grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onOpenDrawer('comparison')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[11px] font-medium text-[#18181B] transition-colors cursor-pointer whitespace-nowrap"
          >
            <BarChart3 className="w-3.5 h-3.5 text-[#0066FF] shrink-0" />
            <span>Results</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenDrawer('evidence')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[11px] font-medium text-[#18181B] transition-colors cursor-pointer whitespace-nowrap"
          >
            <FlaskConical className="w-3.5 h-3.5 text-[#059669] shrink-0" />
            <span>Verified Evidence</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenDrawer('decisions')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[11px] font-medium text-[#18181B] transition-colors cursor-pointer whitespace-nowrap"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
            <span>Decision Log</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenDrawer('science')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[11px] font-medium text-[#18181B] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sigma className="w-3.5 h-3.5 text-[#18181B] shrink-0" />
            <span>Model &amp; Physics</span>
          </button>
        </div>
      </div>
    </ResponsiveSheet>
  );
};
