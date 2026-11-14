import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp, ArrowRight, ArrowLeft } from 'lucide-react';
import type { GlobalFacilityState } from '../simulation/types';
import type { PathwayPanelKind } from './ThermosCorePanel';
import type {
  ContextualExplanation,
  ExplainableTarget,
} from '../simulation/explanationEngine';
import * as E from '../simulation/engine';
import { ResponsiveSheet } from './ResponsiveSheet';
import { ExplanationLevels } from './ExplanationLevels';

interface RackInspectorProps {
  rackId: number | null;
  onClose: () => void;
  facility: GlobalFacilityState;
  revealTruth: boolean;
  onToggleRevealTruth: () => void;
  onSelectRack: (id: number) => void;
  onSelectIncident?: (incidentId: string) => void;
  onSelectPathway?: (kind: PathwayPanelKind) => void;
  onToggleThermos?: () => void;
  explanation?: ContextualExplanation | null;
  onNavigate?: (target: ExplainableTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  isMobile?: boolean;
}

export const RackInspector: React.FC<RackInspectorProps> = ({
  rackId,
  onClose,
  facility,
  revealTruth,
  onToggleRevealTruth,
  onSelectRack,
  onSelectIncident,
  onSelectPathway,
  onToggleThermos,
  explanation,
  onNavigate,
  onBack,
  backLabel,
  isMobile = false,
}) => {
  const [showDetails, setShowDetails] = useState<boolean>(false);

  if (rackId === null) return null;
  const rack = facility.racks[rackId];
  if (!rack) return null;

  const thermosEnabled = facility.thermos.enabled;
  const isBlindOffline = !rack.sensorAvailable && !thermosEnabled && !revealTruth;
  const currentTemp =
    rack.sensorAvailable || revealTruth ? rack.simulatedInletC : rack.estimatedInletC;
  const predictedTemp = rack.predictedInletC;
  const limitC = rack.temperatureLimitC;

  // Scale temperatures visually across 20°C .. 36°C
  const scaleMin = 20;
  const scaleMax = 36;
  const toPct = (t: number) =>
    Math.max(4, Math.min(98, ((t - scaleMin) / (scaleMax - scaleMin)) * 100));
  const limitPct = toPct(limitC);
  const currentPct = toPct(currentTemp);
  const predictedPct = toPct(predictedTemp);

  const forecastWillExceed = predictedTemp >= limitC - 0.3;
  const forecastIsWarming = !forecastWillExceed && predictedTemp >= limitC - 1.5;

  const rackIncidents = facility.activeIncidents.filter(
    (inc) => inc.affectedRacks.length <= 6 && inc.affectedRacks.includes(rackId)
  );
  const neighbours = E.adjacent(rackId);

  const rackTransfers = thermosEnabled
    ? facility.thermos.activeTransfers.filter(
        (tr) => tr.fromRack === rackId || tr.toRack === rackId
      )
    : [];

  const statusText = !rack.sensorAvailable
    ? thermosEnabled
      ? 'Sensor Offline (Estimated)'
      : 'Sensor Offline'
    : rack.thermalRiskState === 'CRITICAL'
    ? 'Overheating'
    : rack.thermalRiskState === 'WARMING'
    ? 'Warming'
    : 'Normal';

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
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            rack.thermalRiskState === 'CRITICAL'
              ? 'bg-[#DC2626]'
              : rack.thermalRiskState === 'WARMING' || !rack.sensorAvailable
              ? 'bg-[#D97706]'
              : 'bg-[#059669]'
          }`}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-mono text-sm font-bold text-[#18181B]">{rack.label}</h2>
            <span className="text-[11px] font-medium text-[#52565E] truncate">
              · {statusText}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close rack inspector"
        className="w-7 h-7 -mr-1 flex items-center justify-center rounded text-[#646872] hover:text-[#18181B] hover:bg-[#F1F1EC] cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <ResponsiveSheet
      isMobile={isMobile}
      ariaLabel={`Rack ${rack.label} telemetry`}
      onDismiss={onClose}
      showMobileScrim={true}
      mobileMaxHeightClass="max-h-[60dvh]"
      desktopClassName="top-4 right-3.5 xl:right-4 w-[352px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)] animate-slideLeft"
      header={header}
    >
      <div className="p-3.5 space-y-3 text-xs">
        {/* Fast 12-Rack Switcher */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1.5 border-b border-[#ECEEE9]">
          {facility.racks.map((r) => {
            const active = r.id === rackId;
            const rHot = r.thermalRiskState === 'CRITICAL';
            const rWarm = r.thermalRiskState === 'WARMING';
            const rOff = !r.sensorAvailable;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRack(r.id)}
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer transition-colors shrink-0 ${
                  active
                    ? 'bg-[#18181B] text-white'
                    : rHot
                    ? 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5]'
                    : rOff || rWarm
                    ? 'bg-[#FFFBEB] text-[#B45309] border border-[#FCD34D]'
                    : 'bg-[#F7F7F2] text-[#52565E] hover:bg-[#EFEFE9]'
                }`}
                title={`${r.label}${rOff ? ' (Sensor Offline)' : ''}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Current vs 15-Minute Forecast + Physics/ML Blend */}
        <div className="rounded-md border border-[#DCDED8] bg-[#FAFAF7] p-2.5 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#18181B]">
              15-Minute Forecast
            </span>
            <span className="font-mono text-[9.5px] text-[#646872]">
              72% Physics + 28% ML
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-[#E6E8E3] rounded p-2">
              <div className="text-[10px] text-[#646872] font-medium">
                {!rack.sensorAvailable
                  ? revealTruth
                    ? 'Actual Temp (Check)'
                    : thermosEnabled
                    ? 'Estimated Now'
                    : 'Sensor Offline'
                  : 'Current Temp'}
              </div>
              <div className="font-mono text-lg font-bold tabular-nums text-[#18181B] mt-0.5">
                {isBlindOffline
                  ? 'Offline'
                  : `${!rack.sensorAvailable && !revealTruth ? '~' : ''}${currentTemp.toFixed(1)}°C`}
              </div>
              <div className="text-[10px] text-[#646872] tabular-nums">
                {isBlindOffline
                  ? 'No direct reading'
                  : `±${rack.uncertaintyMarginC.toFixed(2)}°C margin`}
              </div>
            </div>

            <div className="bg-white border border-[#E6E8E3] rounded p-2">
              <div className="text-[10px] text-[#646872] font-medium">Predicted (+15 min)</div>
              {thermosEnabled ? (
                <>
                  <div
                    className={`font-mono text-lg font-bold tabular-nums mt-0.5 ${
                      forecastWillExceed
                        ? 'text-[#DC2626]'
                        : forecastIsWarming
                        ? 'text-[#D97706]'
                        : 'text-[#0066FF]'
                    }`}
                  >
                    {predictedTemp.toFixed(1)}°C
                  </div>
                  <div className="text-[10px] text-[#646872] tabular-nums">
                    {forecastWillExceed
                      ? 'Over 30°C limit risk'
                      : forecastIsWarming
                      ? 'Warming near 30°C'
                      : 'Safe · ±0.82°C range'}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-lg font-bold text-[#94A3B8] mt-0.5">--.-°C</div>
                  <div className="text-[10px] text-[#646872]">Turn on AI to forecast</div>
                </>
              )}
            </div>
          </div>

          {!isBlindOffline && (
            <div className="space-y-1">
              <div className="relative h-4 rounded bg-[#E8EAE4] overflow-hidden border border-[#DCDED8]">
                <div
                  className="absolute top-0.5 bottom-0.5 left-0 rounded-r bg-[#52565E]/80 transition-all duration-200"
                  style={{ width: `${currentPct}%` }}
                  title={`Now: ${currentTemp.toFixed(1)}°C`}
                />
                {thermosEnabled && (
                  <div
                    className={`absolute top-0 bottom-0 w-1.5 -ml-0.5 transition-all duration-200 ${
                      forecastWillExceed
                        ? 'bg-[#DC2626]'
                        : forecastIsWarming
                        ? 'bg-[#D97706]'
                        : 'bg-[#0066FF]'
                    }`}
                    style={{ left: `${predictedPct}%` }}
                    title={`+15m forecast: ${predictedTemp.toFixed(1)}°C`}
                  />
                )}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[#DC2626]/80"
                  style={{ left: `${limitPct}%` }}
                  title={`Safe limit: ${limitC}°C`}
                />
              </div>
              <div className="flex items-center justify-between text-[9.5px] font-mono text-[#646872] tabular-nums">
                <span>20°C</span>
                <span className="text-[#DC2626] font-medium">Limit {limitC}°C</span>
                <span>36°C</span>
              </div>
            </div>
          )}

          {!rack.sensorAvailable && (
            <div
              className={`rounded border px-2 py-1.5 text-[10.5px] leading-snug ${
                thermosEnabled
                  ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]'
              }`}
            >
              {thermosEnabled
                ? `Hardware sensor offline — estimating from neighbors (${neighbours
                    .map((n) => `R${String(n + 1).padStart(2, '0')}`)
                    .join(', ')}) with ±${rack.uncertaintyMarginC.toFixed(2)}°C safety margin.`
                : `No live reading on ${rack.label}. Turn on THERMOS to estimate from neighboring racks.`}
            </div>
          )}
        </div>

        {/* Server Workload & Active Rack Transfers */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onSelectPathway?.('compute')}
              className="text-[#52565E] font-medium hover:text-[#18181B] hover:underline cursor-pointer"
            >
              Server Workload
            </button>
            <div className="flex items-center gap-1.5 font-mono tabular-nums">
              {thermosEnabled && Math.abs(rack.workloadDeltaPct) >= 2 && (
                <span
                  className={`text-[10px] font-semibold ${
                    rack.workloadDeltaPct < 0 ? 'text-[#059669]' : 'text-[#0066FF]'
                  }`}
                >
                  ({rack.workloadDeltaPct > 0 ? `+${rack.workloadDeltaPct}%` : `${rack.workloadDeltaPct}%`})
                </span>
              )}
              <span className="font-semibold">{Math.round(rack.workloadUtil * 100)}%</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-[#ECEEE9] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#18181B] transition-all duration-200"
              style={{ width: `${Math.min(100, Math.round(rack.workloadUtil * 100))}%` }}
            />
          </div>

          {rackTransfers.length > 0 && (
            <div className="space-y-1 pt-0.5">
              {rackTransfers.map((tr, idx) => (
                <div
                  key={`${tr.fromRack}-${tr.toRack}-${idx}`}
                  className="flex items-center justify-between px-2 py-1 rounded bg-[#F7F7F2] border border-[#E6E8E3] font-mono text-[10px] tabular-nums"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelectRack(tr.fromRack)}
                      className="font-semibold text-[#18181B] hover:underline cursor-pointer"
                    >
                      R{String(tr.fromRack + 1).padStart(2, '0')}
                    </button>
                    <ArrowRight className="w-2.5 h-2.5 text-[#059669]" />
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

          {!thermosEnabled && onToggleThermos && (
            <button
              type="button"
              onClick={onToggleThermos}
              className="w-full mt-1 py-1.5 rounded bg-[#059669] hover:bg-[#047857] text-white text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Turn On THERMOS
            </button>
          )}
        </div>

        {/* Why / What THERMOS does (without repeating the forecast summary or link footer) */}
        {explanation && onNavigate && (
          <ExplanationLevels
            explanation={explanation}
            onNavigate={onNavigate}
            showLevel1={false}
            showLinks={false}
          />
        )}

        {/* Linked Alerts */}
        {rackIncidents.length > 0 && (
          <div className="pt-1.5 border-t border-[#ECEEE9] space-y-1">
            <div className="text-[10.5px] text-[#646872] font-medium">
              Active Alerts ({rackIncidents.length})
            </div>
            {rackIncidents.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => onSelectIncident?.(inc.id)}
                className="w-full text-left text-[10.5px] bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#E6E8E3] rounded px-2 py-1.5 text-[#18181B] transition-colors cursor-pointer flex items-center justify-between gap-2"
              >
                <span className="font-semibold truncate">{inc.title}</span>
                <span className="font-mono text-[9.5px] text-[#0066FF] shrink-0">→</span>
              </button>
            ))}
          </div>
        )}

        {/* Technical Details (Collapsed by default — keeps Peek Truth hidden from normal UX) */}
        <div className="pt-1 border-t border-[#ECEEE9]">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between text-[11px] font-medium text-[#52565E] hover:text-[#18181B] cursor-pointer py-0.5"
          >
            <span>Technical details &amp; validation</span>
            {showDetails ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {showDetails && (
            <div className="mt-2 space-y-2 animate-fadeIn">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#646872]">Pinned (45%):</span>
                  <span>{Math.round(rack.mandatoryWorkload * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#646872]">Flexible:</span>
                  <span>{Math.round(rack.flexibleWorkload * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#646872]">Airflow:</span>
                  <span>{rack.localAirflowPct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#646872]">Blocked:</span>
                  <span>{Math.round(rack.airflowRestriction * 100)}%</span>
                </div>
              </div>
              <p className="text-[10px] text-[#646872] leading-snug">
                24-tree Random Forest (7 input features) blended 28% ML + 72% physics ODE. Simulated held-out test benchmarks: ~0.312°C MAE, R² ~0.966, 94.3% 95% coverage, ±0.8249°C conformal Q95 bound (not a guarantee of real-world hardware performance).
              </p>

              {!rack.sensorAvailable && (
                <div className="pt-1.5 border-t border-[#ECEEE9] flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#52565E]">
                    Validation check (simulated true temp):
                  </span>
                  <button
                    type="button"
                    onClick={onToggleRevealTruth}
                    className="px-2 py-0.5 rounded border border-[#DCDED8] bg-[#F7F7F2] text-[10px] font-mono font-semibold text-[#18181B] hover:bg-[#EFEFE9] cursor-pointer"
                  >
                    {revealTruth ? 'Hide Actual Temp' : 'Show Actual Temp'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Neighbor Racks */}
        <div className="pt-2 border-t border-[#ECEEE9] flex items-center justify-between gap-2 text-[10.5px]">
          <span className="text-[#646872] shrink-0">Neighbor racks:</span>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {neighbours.map((nId) => (
              <button
                key={nId}
                type="button"
                onClick={() => onSelectRack(nId)}
                className="px-1.5 py-0.5 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#DCDED8] font-mono text-[10px] font-semibold text-[#18181B] cursor-pointer transition-colors"
              >
                R{String(nId + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ResponsiveSheet>
  );
};
