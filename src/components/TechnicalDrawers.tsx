import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { ControllerComparisonPage } from './ControllerComparisonPage';
import { EvidenceLabPage } from './EvidenceLabPage';
import { ModelSciencePage } from './ModelSciencePage';
import { DecisionCentrePage } from './DecisionCentrePage';
import type { SimulationState, ThermosConfig, StepRecord, ForestModel } from '../simulation/types';

export type ActiveDrawer = 'none' | 'comparison' | 'evidence' | 'science' | 'decisions';

interface TechnicalDrawersProps {
  activeDrawer: ActiveDrawer;
  onChangeDrawer: (drawer: ActiveDrawer) => void;
  onClose: () => void;
  states: {
    thermos: SimulationState;
    reactive: SimulationState;
    physics: SimulationState;
    none?: SimulationState;
  };
  config: ThermosConfig;
  cursor: number;
  onScrub: (step: number) => void;
  model: ForestModel;
  currentRecord: StepRecord | null;
  onRunFull: () => void;
  isComputingFull: boolean;
}

export const TechnicalDrawers: React.FC<TechnicalDrawersProps> = ({
  activeDrawer,
  onChangeDrawer,
  onClose,
  states,
  config,
  cursor,
  onScrub,
  model,
  currentRecord,
  onRunFull,
  isComputingFull,
}) => {
  useEffect(() => {
    if (activeDrawer === 'none') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDrawer, onClose]);

  if (activeDrawer === 'none') return null;

  const tabs: Array<{ id: Exclude<ActiveDrawer, 'none'>; label: string; shortLabel: string }> = [
    { id: 'comparison', label: 'Performance & Sustainability', shortLabel: 'Results' },
    { id: 'evidence', label: 'Verified Evidence', shortLabel: 'Evidence' },
    { id: 'decisions', label: 'Decision Log', shortLabel: 'Decisions' },
    { id: 'science', label: 'Model & Physics', shortLabel: 'Physics' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/25 backdrop-blur-[1px] animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full lg:max-w-5xl h-dvh bg-[#F7F7F2] lg:border-l border-[#D6D8D2] shadow-2xl flex flex-col overflow-hidden animate-slideLeft">
        {/* Precision Off-White Header */}
        <header className="safe-top px-3 sm:px-5 py-2.5 border-b border-[#DCDED8] bg-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F1F2EE] overflow-x-auto no-scrollbar min-w-0">
            {tabs.map((t) => {
              const active = activeDrawer === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeDrawer(t.id)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap min-h-8 ${
                    active
                      ? 'bg-white text-[#18181B] shadow-xs font-semibold'
                      : 'text-[#646872] hover:text-[#18181B]'
                  }`}
                >
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.shortLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onRunFull}
              disabled={isComputingFull}
              className="px-2.5 sm:px-3 py-1.5 min-h-8 rounded-md bg-[#0066FF] hover:bg-[#0052CC] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <span className="hidden sm:inline">
                {isComputingFull ? 'Simulating 6h…' : 'Compute Full 6h Run'}
              </span>
              <span className="sm:hidden">{isComputingFull ? 'Running…' : 'Run 6h'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close technical analysis panel"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-md flex items-center justify-center text-[#646872] hover:text-[#18181B] hover:bg-[#F1F2EE] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Unified Precision Off-White Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 md:p-6 safe-bottom text-[#18181B]">
          {activeDrawer === 'comparison' && (
            <ControllerComparisonPage
              states={states}
              config={config}
              cursor={cursor}
              onScrub={onScrub}
            />
          )}

          {activeDrawer === 'evidence' && (
            <EvidenceLabPage
              model={model}
              currentConfig={config}
              currentRecord={currentRecord}
              state={states.thermos}
              allStates={states}
            />
          )}

          {activeDrawer === 'science' && <ModelSciencePage />}

          {activeDrawer === 'decisions' && (
            <DecisionCentrePage
              currentRecord={currentRecord}
              config={config}
            />
          )}
        </div>
      </div>
    </div>
  );
};
