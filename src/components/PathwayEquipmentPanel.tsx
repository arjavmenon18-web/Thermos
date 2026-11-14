import React from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import type { GlobalFacilityState, StepRecord } from '../simulation/types';
import type { PathwayPanelKind } from './ThermosCorePanel';
import type {
  ContextualExplanation,
  ExplainableTarget,
} from '../simulation/explanationEngine';
import { ResponsiveSheet } from './ResponsiveSheet';
import { ExplanationLevels } from './ExplanationLevels';

interface PathwayEquipmentPanelProps {
  kind: PathwayPanelKind | null;
  onClose: () => void;
  facility: GlobalFacilityState;
  currentRecord: StepRecord | null;
  onSelectRack: (rackId: number) => void;
  onSelectPathway: (kind: PathwayPanelKind) => void;
  onOpenCore: () => void;
  onToggleThermos?: () => void;
  explanation?: ContextualExplanation | null;
  onNavigate?: (target: ExplainableTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  isMobile?: boolean;
}

export const PathwayEquipmentPanel: React.FC<PathwayEquipmentPanelProps> = ({
  kind,
  onClose,
  facility,
  currentRecord,
  onSelectRack,
  onSelectPathway,
  onOpenCore,
  onToggleThermos,
  explanation,
  onNavigate,
  onBack,
  backLabel,
  isMobile = false,
}) => {
  if (!kind) return null;

  const thermosEnabled = facility.thermos.enabled;
  const hr = facility.heatRecovery;

  const executedTransfers = thermosEnabled
    ? facility.thermos.activeTransfers.length > 0
      ? facility.thermos.activeTransfers
      : facility.thermos.visualState === 'INTERVENING'
      ? currentRecord?.transfers ?? []
      : []
    : [];
  const proposedTransfers =
    thermosEnabled && executedTransfers.length === 0 ? facility.pendingPlan?.transfers ?? [] : [];

  const sortedByHeat = [...facility.racks].sort((a, b) => b.heatGeneratedKW - a.heatGeneratedKW);
  const sortedByLoad = [...facility.racks].sort((a, b) => b.workloadUtil - a.workloadUtil);
  const restrictedRacks = facility.racks.filter((r) => r.airflowRestriction >= 0.12);

  const metaByKind: Record<
    PathwayPanelKind,
    { title: string; subtitle: string; dotClass: string }
  > = {
    compute: {
      title: 'Job Routing',
      subtitle: thermosEnabled ? 'Smart Placement' : 'Fixed Placement',
      dotClass: !thermosEnabled
        ? 'bg-[#94A3B8]'
        : executedTransfers.length > 0
        ? 'bg-[#059669]'
        : 'bg-[#0066FF]',
    },
    heat: {
      title: 'Heat Capture',
      subtitle: 'Central Hydronic Coils',
      dotClass: hr.isExporting ? 'bg-[#D97706]' : 'bg-[#64748B]',
    },
    recovery: {
      title: 'Thermal Recovery',
      subtitle: 'Heat Reuse Concept + Aux TEG',
      dotClass: hr.isExporting ? 'bg-[#059669]' : 'bg-[#64748B]',
    },
    cooling: {
      title: 'Smart Cooling',
      subtitle: thermosEnabled ? 'Air & Water Control' : 'Fixed Fans',
      dotClass: !thermosEnabled
        ? 'bg-[#94A3B8]'
        : facility.activeCoolingMode === 'wet'
        ? 'bg-[#0284C7]'
        : 'bg-[#0066FF]',
    },
  };

  const meta = metaByKind[kind];

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
        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="text-[12.5px] font-semibold text-[#18181B] whitespace-nowrap">
            {meta.title}
          </h2>
          <span className="text-[#8E929C] text-[11px]">·</span>
          <span className="text-[11px] text-[#646872] truncate">{meta.subtitle}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${meta.title} panel`}
        className="w-7 h-7 -mr-1 flex items-center justify-center rounded text-[#646872] hover:text-[#18181B] hover:bg-[#F1F1EC] transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <ResponsiveSheet
      isMobile={isMobile}
      ariaLabel={`${meta.title} contextual information`}
      onDismiss={onClose}
      showMobileScrim={true}
      mobileMaxHeightClass="max-h-[58dvh]"
      desktopClassName="top-4 right-3.5 xl:right-4 w-[352px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)] animate-slideLeft"
      header={header}
    >
      <div className="p-3.5 space-y-3 text-xs">
        {(kind === 'recovery' || kind === 'heat') && (
          <div className="rounded-md border border-[#DCDED8] bg-[#FAFAF7] p-2.5 space-y-2">
            <div className="text-[11px] font-semibold text-[#18181B]">
              How Heat Capture &amp; Reuse Work
            </div>
            {/* 4-Step Visual Heat Flow */}
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1 text-center text-[9.5px]">
              <div className="rounded bg-white border border-[#E4E6E0] py-1.5 px-1">
                <div className="font-semibold text-[#18181B]">Server Heat</div>
                <div className="font-mono text-[#646872]">≥38°C</div>
              </div>
              <ArrowRight className="w-2.5 h-2.5 text-[#8E929C]" />
              <div className="rounded bg-white border border-[#E4E6E0] py-1.5 px-1">
                <div className="font-semibold text-[#18181B]">Hydronic</div>
                <div className="font-mono text-[#646872]">Coils</div>
              </div>
              <ArrowRight className="w-2.5 h-2.5 text-[#8E929C]" />
              <div className="rounded bg-[#ECFDF5] border border-[#A7F3D0] py-1.5 px-1">
                <div className="font-semibold text-[#065F46]">88% HX</div>
                <div className="font-mono text-[#059669]">Exchange</div>
              </div>
              <ArrowRight className="w-2.5 h-2.5 text-[#8E929C]" />
              <div className="rounded bg-[#EFF6FF] border border-[#BFDBFE] py-1.5 px-1">
                <div className="font-semibold text-[#1E40AF]">Concept</div>
                <div className="font-mono text-[#0066FF]">kWh_th</div>
              </div>
            </div>
            <p className="text-[10.5px] text-[#52565E] leading-snug">
              Captures warm server heat above 38°C into a central water loop (88% HX) to model potential external building pre-heating — without connecting to a real building.
            </p>
          </div>
        )}

        {kind === 'recovery' && (
          <div className="space-y-2 font-mono text-[10.5px] tabular-nums">
            <div className="rounded border border-[#A7F3D0] bg-[#F4FBF7] p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-sans text-[11px] font-semibold text-[#065F46]">
                  Potential Heat Reuse (Conceptual)
                </div>
                <span className="font-mono font-bold text-sm text-[#059669] shrink-0">
                  {hr.usefulHeatKWhTh.toFixed(2)} kWh_th
                </span>
              </div>
              <div className="font-sans text-[10.5px] text-[#52565E] leading-snug">
                Currently capturing{' '}
                <span className="font-mono font-semibold text-[#18181B]">
                  {hr.thermalEnergyCapturedKW.toFixed(1)} kW_th
                </span>{' '}
                (thermal energy — kept strictly separate from grid electricity kWh).
              </div>
            </div>

            <div className="rounded border border-[#BFDBFE] bg-[#F5F9FF] p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-sans text-[11px] font-semibold text-[#1E40AF]">
                  Auxiliary TEG Experiment (Separate)
                </div>
                <span className="font-mono font-semibold text-[#0066FF] shrink-0">
                  {(hr.tegGenerationKW * 1000).toFixed(0)} W ({hr.tegHarvestKWh.toFixed(4)} kWh)
                </span>
              </div>
              <div className="font-sans text-[10px] text-[#52565E] leading-snug">
                Experimental solid-state Seebeck module limited by outdoor ambient temperature. Yields 0 W in hot weather and does not power THERMOS.
              </div>
            </div>
          </div>
        )}

        {!thermosEnabled && onToggleThermos && (
          <button
            type="button"
            onClick={onToggleThermos}
            className="w-full py-1.5 rounded bg-[#059669] hover:bg-[#047857] text-white text-[11px] font-semibold transition-colors cursor-pointer"
          >
            Turn On THERMOS
          </button>
        )}

        {kind === 'compute' && (
          <>
            {thermosEnabled && (executedTransfers.length > 0 || proposedTransfers.length > 0) && (
              <div className="pt-1 border-t border-[#ECEEE9] space-y-1.5">
                <div className="text-[10.5px] font-medium text-[#52565E]">
                  {executedTransfers.length > 0 ? 'Moving Work Now' : 'Planned Job Moves'}
                </div>
                <div className="space-y-1">
                  {(executedTransfers.length > 0 ? executedTransfers : proposedTransfers)
                    .slice(0, 5)
                    .map((tr, idx) => (
                      <div
                        key={`${tr.fromRack}-${tr.toRack}-${idx}`}
                        className="flex items-center justify-between py-1 px-2 rounded bg-[#F7F7F2] border border-[#E6E8E3] font-mono text-[10.5px] tabular-nums"
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
                        <span className="text-[#18181B] font-medium">
                          {Math.round(tr.fractionMoved * 100)}% moved
                        </span>
                      </div>
                    ))}
                </div>
                {proposedTransfers.length > 0 && executedTransfers.length === 0 && (
                  <button
                    type="button"
                    onClick={onOpenCore}
                    className="text-[10.5px] font-medium text-[#0066FF] hover:underline cursor-pointer"
                  >
                    Approve in THERMOS Core →
                  </button>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-[#ECEEE9] space-y-1.5">
              <div className="text-[10.5px] font-medium text-[#52565E]">
                Busiest Racks (45% Stays Pinned)
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10.5px] tabular-nums">
                {sortedByLoad.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRack(r.id)}
                    className="flex items-center justify-between px-2 py-1 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] cursor-pointer transition-colors"
                  >
                    <span className="font-semibold text-[#18181B]">{r.label}</span>
                    <span className="text-[#52565E]">{Math.round(r.workloadUtil * 100)}%</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#646872] leading-snug">
                45% of rack work stays in place for stability; 55% flexible work plus 3 batch jobs (360 rack-min total) shift toward cooler racks.
              </p>
            </div>
          </>
        )}

        {kind === 'heat' && (
          <>
            <div className="pt-1 border-t border-[#ECEEE9] space-y-1.5">
              <div className="text-[10.5px] font-medium text-[#52565E]">Warmest Racks</div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10.5px] tabular-nums">
                {sortedByHeat.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRack(r.id)}
                    className="flex items-center justify-between px-2 py-1 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] text-left cursor-pointer transition-colors"
                  >
                    <span className="font-semibold text-[#18181B]">{r.label}</span>
                    <span className="text-[#B45309]">
                      {r.exhaustTempC.toFixed(1)}° · {r.heatGeneratedKW.toFixed(1)}kW
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {restrictedRacks.length > 0 && (
              <div className="pt-2 border-t border-[#ECEEE9] flex items-center justify-between text-[10.5px]">
                <span className="text-[#B45309]">Blocked air intake:</span>
                <div className="flex items-center gap-1">
                  {restrictedRacks.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectRack(r.id)}
                      className="px-1.5 py-0.5 rounded bg-[#F7F7F2] border border-[#DCDED8] font-mono text-[10px] font-semibold text-[#B45309] cursor-pointer"
                    >
                      {r.label} (−{Math.round(r.airflowRestriction * 100)}%)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {kind === 'cooling' && (
          <>
            <div className="pt-1.5 border-t border-[#ECEEE9] space-y-1 font-mono text-[10.5px] tabular-nums">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[#646872]">Cooling Efficiency (PUE)</span>
                <span className="font-semibold text-[#18181B]">{facility.pue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-[#646872]">Water Reserve Left</span>
                <span className="font-semibold text-[#18181B]">
                  {facility.waterRemainingL.toFixed(1)} / {facility.waterBudgetL} L
                </span>
              </div>
            </div>

            {restrictedRacks.length > 0 && (
              <div className="pt-2 border-t border-[#ECEEE9] flex items-center justify-between text-[10.5px]">
                <span className="text-[#B45309]">Blocked vents:</span>
                <div className="flex items-center gap-1">
                  {restrictedRacks.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectRack(r.id)}
                      className="px-1.5 py-0.5 rounded bg-[#F7F7F2] border border-[#DCDED8] font-mono text-[10px] font-semibold text-[#B45309] cursor-pointer"
                    >
                      {r.label} ({r.localAirflowPct}% air)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(kind === 'compute' || kind === 'cooling') && explanation && onNavigate && (
          <ExplanationLevels
            explanation={explanation}
            onNavigate={onNavigate}
            showLevel1={false}
          />
        )}

        {/* Quick Navigation */}
        <div className="pt-2 border-t border-[#ECEEE9] flex items-center justify-between text-[10.5px] text-[#646872]">
          <button
            type="button"
            onClick={onOpenCore}
            className="hover:text-[#18181B] hover:underline cursor-pointer whitespace-nowrap"
          >
            ← THERMOS Core
          </button>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            {(
              [
                { id: 'compute', label: 'Jobs' },
                { id: 'heat', label: 'Heat' },
                { id: 'recovery', label: 'Recovery' },
                { id: 'cooling', label: 'Cooling' },
              ] as { id: PathwayPanelKind; label: string }[]
            )
              .filter((k) => k.id !== kind)
              .map((other, idx) => (
                <React.Fragment key={other.id}>
                  {idx > 0 && <span className="text-[#D4D7D0]">·</span>}
                  <button
                    type="button"
                    onClick={() => onSelectPathway(other.id)}
                    className="hover:text-[#18181B] hover:underline cursor-pointer"
                  >
                    {other.label}
                  </button>
                </React.Fragment>
              ))}
          </div>
        </div>
      </div>
    </ResponsiveSheet>
  );
};
