import React from 'react';
import { X, Play, ArrowLeft } from 'lucide-react';
import type { FacilityIncident } from '../simulation/types';
import type {
  ContextualExplanation,
  ExplainableTarget,
} from '../simulation/explanationEngine';
import { ResponsiveSheet } from './ResponsiveSheet';
import { ExplanationLevels } from './ExplanationLevels';

interface IncidentInspectorCardProps {
  incident: FacilityIncident | null;
  thermosEnabled?: boolean;
  onToggleThermos?: () => void;
  onClose: () => void;
  onSelectRack: (id: number) => void;
  onOpenCore?: () => void;
  explanation?: ContextualExplanation | null;
  onNavigate?: (target: ExplainableTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  isMobile?: boolean;
}

export const IncidentInspectorCard: React.FC<IncidentInspectorCardProps> = ({
  incident,
  thermosEnabled = true,
  onToggleThermos,
  onClose,
  onSelectRack,
  onOpenCore,
  explanation,
  onNavigate,
  onBack,
  backLabel,
  isMobile = false,
}) => {
  if (!incident) return null;

  const dotClass = incident.severity === 'CRITICAL' ? 'bg-[#DC2626]' : 'bg-[#D97706]';

  const header = (
    <div className="px-3.5 py-2.5 border-b border-[#ECEEE9] flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase font-semibold text-[#646872]">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={`Back to ${backLabel || 'previous'}`}
              className="px-1.5 py-0.5 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#DCDED8] text-[9.5px] font-sans font-medium text-[#52565E] hover:text-[#18181B] flex items-center gap-0.5 cursor-pointer shrink-0 normal-case"
            >
              <ArrowLeft className="w-2.5 h-2.5" />
              <span>{backLabel || 'Back'}</span>
            </button>
          )}
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span>
            {incident.severity} · {thermosEnabled ? incident.status : 'UNMITIGATED'}
          </span>
        </div>
        <h3 className="font-semibold text-[12.5px] text-[#18181B] mt-0.5 leading-snug">
          {incident.title}
        </h3>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close incident inspector"
        className="w-7 h-7 -mr-1 -mt-0.5 flex items-center justify-center rounded text-[#646872] hover:text-[#18181B] hover:bg-[#F1F1EC] cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <ResponsiveSheet
      isMobile={isMobile}
      ariaLabel="Incident Inspector"
      onDismiss={onClose}
      showMobileScrim={true}
      mobileMaxHeightClass="max-h-[56dvh]"
      desktopClassName="top-4 right-3.5 xl:right-4 w-[348px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)] animate-slideLeft"
      header={header}
    >
      <div className="p-3.5 space-y-2.5 text-[11.5px]">
        {explanation && onNavigate && (
          <ExplanationLevels explanation={explanation} onNavigate={onNavigate} />
        )}

        {incident.affectedRacks.length > 0 && incident.affectedRacks.length <= 8 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[10.5px] text-[#646872] mr-0.5">Racks:</span>
            {incident.affectedRacks.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onSelectRack(r)}
                className="px-2 py-0.5 rounded bg-[#F7F7F2] border border-[#DCDED8] font-mono text-[10px] font-semibold hover:border-[#0066FF] cursor-pointer transition-colors"
              >
                R{String(r + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
        )}

        {!thermosEnabled && onToggleThermos && (
          <button
            type="button"
            onClick={onToggleThermos}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#059669] hover:bg-[#047857] text-white text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>Turn On THERMOS</span>
          </button>
        )}

        {onOpenCore && (
          <div className="pt-1.5 border-t border-[#ECEEE9] flex justify-end">
            <button
              type="button"
              onClick={onOpenCore}
              className="text-[10.5px] font-medium text-[#0066FF] hover:underline cursor-pointer"
            >
              Open THERMOS Core →
            </button>
          </div>
        )}
      </div>
    </ResponsiveSheet>
  );
};
