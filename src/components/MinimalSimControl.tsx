import React from 'react';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  SlidersHorizontal,
  X,
  Clock,
} from 'lucide-react';
import type { PresetKey, SystemMode } from '../simulation/types';
import * as E from '../simulation/engine';
import { ResponsiveSheet } from './ResponsiveSheet';

interface MinimalSimControlProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  thermosEnabled: boolean;
  isIntervening?: boolean;
  onToggleThermos: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onReset: () => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  scenarioKey: PresetKey;
  onSelectScenario: (preset: PresetKey) => void;
  systemMode: SystemMode;
  onChangeSystemMode: (mode: SystemMode) => void;
  timeString: string;
  currentStep: number;
  traceLength: number;
  cursor: number;
  onScrub: (step: number) => void;
  isComplete: boolean;
  isMobile?: boolean;
  hidePill?: boolean;
}

const STREAMLINED_PRESETS: Array<{
  key: PresetKey;
  label: string;
  dotClass: string;
  meta: string;
}> = [
  {
    key: 'compound',
    label: 'Compound Stress',
    dotClass: 'bg-[#DC2626]',
    meta: '43.2°C · 82% · 35L · R07@11:00',
  },
  {
    key: 'sensor',
    label: 'Sensor Failure',
    dotClass: 'bg-[#D97706]',
    meta: '40.0°C · 79% · R07@11:00',
  },
  {
    key: 'water',
    label: 'Severe Drought Cap',
    dotClass: 'bg-[#2563EB]',
    meta: '41.0°C · 78% · 20L',
  },
  {
    key: 'normal',
    label: 'Normal Working Day',
    dotClass: 'bg-[#16A34A]',
    meta: '32.0°C · 64% · Eco',
  },
];

export const MinimalSimControl: React.FC<MinimalSimControlProps> = ({
  isOpen,
  onToggleOpen,
  onClose,
  thermosEnabled,
  isIntervening = false,
  onToggleThermos,
  isPlaying,
  onTogglePlay,
  onStepForward,
  onReset,
  speed,
  onChangeSpeed,
  scenarioKey,
  onSelectScenario,
  systemMode,
  onChangeSystemMode,
  timeString,
  currentStep,
  traceLength,
  cursor,
  onScrub,
  isComplete,
  isMobile = false,
  hidePill = false,
}) => {
  const effectiveScrubValue =
    cursor >= 0 ? cursor : traceLength > 0 ? traceLength - 1 : 0;

  const popoverHeader = (
    <div className="px-3.5 py-2.5 border-b border-[#ECEEE9] flex items-center justify-between">
      <span className="text-[12px] font-semibold text-[#18181B]">
        THERMOS &amp; Digital Twin
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close controls"
        className="w-7 h-7 -mr-1 flex items-center justify-center rounded text-[#646872] hover:text-[#18181B] hover:bg-[#F1F1EC] transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const popoverBody = (
    <div className="p-3.5 space-y-3.5 text-xs">
      {/* 1. Real-World THERMOS AI Controller Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-mono uppercase text-[#646872]">
            THERMOS AI Controller
          </span>
          <span
            className={`font-mono text-[10px] font-semibold ${
              thermosEnabled ? 'text-[#059669]' : 'text-[#646872]'
            }`}
          >
            {thermosEnabled ? 'ACTIVE' : 'PAUSED · NO AI ACTION'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-[#F1F2EE] border border-[#E2E4DF]">
          <button
            type="button"
            onClick={() => {
              if (!thermosEnabled) onToggleThermos();
            }}
            className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              thermosEnabled
                ? 'bg-white text-[#18181B] shadow-2xs font-semibold'
                : 'text-[#646872] hover:text-[#18181B]'
            }`}
          >
            Run THERMOS
          </button>
          <button
            type="button"
            onClick={() => {
              if (thermosEnabled) onToggleThermos();
            }}
            className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              !thermosEnabled
                ? 'bg-white text-[#18181B] shadow-2xs font-semibold'
                : 'text-[#646872] hover:text-[#18181B]'
            }`}
          >
            Pause THERMOS
          </button>
        </div>

        <p className="text-[10.5px] text-[#52565E] leading-snug">
          {thermosEnabled
            ? 'Every 5 min, THERMOS tests 108 plans to move flexible work & 3 batch jobs (360 rack-min total), while keeping 45% of rack work pinned.'
            : 'THERMOS is off. Fixed cooling fans run without moving jobs away from warm racks.'}
        </p>

        {/* Control Mode */}
        <div className="pt-0.5 space-y-1">
          <div className="flex items-center justify-between text-[10.5px] text-[#646872]">
            <span>Approval Mode</span>
            <span className="font-mono text-[10px]">
              {systemMode === 'demonstration' ? 'Auto-run' : 'Ask before acting'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded bg-[#F1F2EE] border border-[#E2E4DF]">
            <button
              type="button"
              disabled={!thermosEnabled}
              onClick={() => onChangeSystemMode('demonstration')}
              className={`py-1 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-45 ${
                systemMode === 'demonstration'
                  ? 'bg-white text-[#18181B] shadow-2xs font-semibold'
                  : 'text-[#646872] hover:text-[#18181B]'
              }`}
            >
              Auto
            </button>
            <button
              type="button"
              disabled={!thermosEnabled}
              onClick={() => onChangeSystemMode('interactive')}
              className={`py-1 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-45 ${
                systemMode === 'interactive'
                  ? 'bg-white text-[#18181B] shadow-2xs font-semibold'
                  : 'text-[#646872] hover:text-[#18181B]'
              }`}
            >
              Ask Me
            </button>
          </div>
          <p className="text-[10px] text-[#646872] leading-snug">
            {systemMode === 'demonstration'
              ? 'Auto: Runs each best 5-minute cooling and workload plan automatically.'
              : 'Ask Me: Proposes each plan in THERMOS Core and waits until you Approve or Skip.'}
          </p>
        </div>
      </div>

      {/* 2. Clock & Speed */}
      <div className="pt-2.5 border-t border-[#ECEEE9] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-mono uppercase text-[#646872]">
            Simulation Clock
          </span>
          <span className="font-mono text-[10.5px] text-[#18181B] tabular-nums">
            {timeString} · {isPlaying ? 'Running' : isComplete ? 'Done' : 'Paused'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onTogglePlay}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[#18181B] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <Clock className="w-3 h-3 text-[#52565E]" />
              <span>{isPlaying ? 'Freeze Clock' : isComplete ? 'Replay 09:00' : 'Resume Clock'}</span>
            </button>

            <button
              type="button"
              onClick={onStepForward}
              disabled={isPlaying || isComplete}
              title="Advance facility clock by +5 simulated minutes"
              aria-label="Advance facility by 5 minutes"
              className="flex items-center gap-1 px-2 py-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] disabled:opacity-40 text-[#18181B] font-mono text-[10.5px] transition-colors cursor-pointer"
            >
              <SkipForward className="w-3 h-3" />
              <span>+5m</span>
            </button>

            <button
              type="button"
              onClick={onReset}
              title="Restart 6-hour facility shift at 09:00"
              aria-label="Restart facility shift"
              className="p-1.5 rounded border border-[#DCDED8] bg-[#F7F7F2] hover:bg-[#EFEFE9] text-[#52565E] hover:text-[#18181B] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            className="flex items-center rounded border border-[#DCDED8] bg-[#F7F7F2] p-0.5 font-mono text-[10.5px]"
            role="group"
            aria-label="Representation clock speed"
          >
            {[1, 2, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChangeSpeed(s)}
                className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  speed === s
                    ? 'bg-white text-[#18181B] font-semibold shadow-2xs'
                    : 'text-[#646872] hover:text-[#18181B]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Shift Timeline Scrubber */}
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-[#646872] tabular-nums">
            <span>09:00</span>
            <span>
              {cursor >= 0 ? `Inspecting snapshot · ${timeString}` : `Live shift · ${Math.min(currentStep, E.STEPS) * 5}m elapsed`}
            </span>
            <span>15:00</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, traceLength - 1)}
            value={effectiveScrubValue}
            disabled={traceLength <= 1}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="Scrub recorded facility shift history"
            className="w-full h-1.5 accent-[#18181B] bg-[#E5E7EB] rounded-lg cursor-pointer disabled:opacity-40"
          />
          {cursor >= 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onScrub(-1)}
                className="font-mono text-[10px] text-[#0066FF] hover:underline cursor-pointer"
              >
                Return to live clock →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Operating Condition */}
      <div className="pt-2.5 border-t border-[#ECEEE9] space-y-1.5">
        <div className="text-[10.5px] font-mono uppercase text-[#646872]">
          Operating Condition
        </div>

        <div className="space-y-1">
          {STREAMLINED_PRESETS.map((p) => {
            const active = scenarioKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onSelectScenario(p.key)}
                className={`w-full px-2.5 py-1.5 rounded border flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-white border-[#18181B] text-[#18181B] shadow-2xs'
                    : 'bg-[#F7F7F2] border-[#E5E7E0] text-[#52565E] hover:bg-[#EFEFE9] hover:text-[#18181B]'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotClass}`} />
                  <span className={`text-[11px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>
                    {p.label}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-[#646872] tabular-nums shrink-0">
                  {p.meta}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Contextual THERMOS & Digital-Twin Controls Popover / Mobile Sheet */}
      {isOpen &&
        (isMobile ? (
          <ResponsiveSheet
            isMobile={true}
            ariaLabel="THERMOS and Digital Twin Controls"
            onDismiss={onClose}
            showMobileScrim={true}
            mobileMaxHeightClass="max-h-[64dvh]"
            desktopClassName=""
            header={popoverHeader}
          >
            {popoverBody}
          </ResponsiveSheet>
        ) : (
          <section
            data-interactive="true"
            aria-label="THERMOS and Digital Twin Controls"
            className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 w-[336px] max-w-[calc(100vw-1.5rem)] bg-white/98 border border-[#DCDED8] rounded-md shadow-[0_8px_24px_rgba(24,24,27,0.08)] text-[#18181B] pointer-events-auto animate-slideUp"
          >
            {popoverHeader}
            {popoverBody}
          </section>
        ))}

      {/* Discreet Default Play/Pause THERMOS Control + Digital Twin Clock Access */}
      {!hidePill && (
        <div
          data-interactive="true"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center bg-white/94 border border-[#DFE2DC] rounded-md shadow-[0_1px_4px_rgba(24,24,27,0.06)] overflow-hidden pointer-events-auto"
        >
          <button
            type="button"
            onClick={onToggleThermos}
            aria-label={
              thermosEnabled
                ? 'Pause THERMOS AI (stop all THERMOS actions while facility continues running)'
                : 'Engage THERMOS AI control on live facility'
            }
            title={
              thermosEnabled
                ? 'Pause THERMOS — no AI action will take place while the facility continues running'
                : 'Run THERMOS — engage real-time AI thermal and workload control'
            }
            className={`px-2.5 h-8 flex items-center gap-1.5 transition-colors cursor-pointer border-r border-[#ECEEE9] whitespace-nowrap ${
              thermosEnabled
                ? 'text-[#18181B] hover:bg-[#F1F1EC]'
                : 'bg-[#F7F7F2] text-[#52565E] hover:text-[#18181B] hover:bg-[#EFEFE9]'
            }`}
          >
            {thermosEnabled ? (
              <Pause className="w-3.5 h-3.5 shrink-0 text-[#18181B]" />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0 ml-0.5 text-[#059669]" />
            )}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                !thermosEnabled
                  ? 'bg-[#94A3B8]'
                  : isIntervening
                  ? 'bg-[#059669]'
                  : 'bg-[#0066FF]'
              }`}
            />
            <span className="text-[11px] font-medium">
              {thermosEnabled ? 'THERMOS Active' : 'THERMOS Paused'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            aria-label="Open THERMOS and digital twin facility settings"
            className={`px-2.5 h-8 flex items-center gap-1.5 font-mono text-[11px] tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
              isOpen
                ? 'bg-[#18181B] text-white'
                : 'text-[#18181B] hover:bg-[#F1F1EC]'
            }`}
          >
            {isPlaying && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse shrink-0"
                title="Simulation running live"
              />
            )}
            <span>{timeString}</span>
            {!isPlaying && !isComplete && (
              <span
                className={`text-[9.5px] font-sans ${
                  isOpen ? 'text-[#D4D4D8]' : 'text-[#B45309]'
                }`}
              >
                Frozen
              </span>
            )}
            {isComplete && (
              <span
                className={`text-[9.5px] font-sans ${
                  isOpen ? 'text-[#D4D4D8]' : 'text-[#0066FF]'
                }`}
              >
                Done
              </span>
            )}
            <SlidersHorizontal
              className={`w-3 h-3 ml-0.5 ${
                isOpen ? 'text-[#E4E4E7]' : 'text-[#646872]'
              }`}
            />
          </button>
        </div>
      )}
    </>
  );
};
