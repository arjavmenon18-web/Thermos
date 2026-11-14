import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react';
import type {
  ContextualExplanation,
  ExplainableTarget,
} from '../simulation/explanationEngine';

interface ExplanationLevelsProps {
  explanation: ContextualExplanation;
  onNavigate: (target: ExplainableTarget) => void;
  showLevel1?: boolean;
  showLinks?: boolean;
}

export const ExplanationLevels: React.FC<ExplanationLevelsProps> = ({
  explanation,
  onNavigate,
  showLevel1 = true,
  showLinks = true,
}) => {
  const [showWhy, setShowWhy] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);

  const planBadgeClass =
    explanation.level3.planStatus === 'PROPOSED'
      ? 'bg-[#EFF6FF] text-[#0066FF] border-[#BFDBFE]'
      : explanation.level3.planStatus === 'REJECTED'
      ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]'
      : explanation.level3.planStatus === 'VERIFIED' ||
        explanation.level3.planStatus === 'APPROVED' ||
        explanation.level3.planStatus === 'IN_PROGRESS'
      ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]'
      : explanation.level3.planStatus === 'PAUSED'
      ? 'bg-[#FFFBEB] text-[#B45309] border-[#FCD34D]'
      : 'bg-[#F7F7F2] text-[#646872] border-[#DCDED8]';

  return (
    <div className="space-y-1.5 text-[11.5px]">
      {/* Now — What's happening */}
      {showLevel1 && (
        <div className="bg-[#F7F7F2] border border-[#E6E8E3] rounded px-2.5 py-2">
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-[#646872] mb-0.5">
            Right Now
          </div>
          <p className="text-[#18181B] font-medium leading-snug">{explanation.level1}</p>
        </div>
      )}

      {/* Why — Simple breakdown */}
      <div className="border border-[#ECEEE9] rounded overflow-hidden">
        <button
          type="button"
          aria-expanded={showWhy}
          onClick={() => setShowWhy((v) => !v)}
          className="w-full px-2.5 py-1.5 bg-white hover:bg-[#F7F7F2] flex items-center justify-between text-left transition-colors cursor-pointer"
        >
          <span className="text-[11px] font-medium text-[#18181B]">Why is this happening?</span>
          {showWhy ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#646872]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#646872]" />
          )}
        </button>
        {showWhy && (
          <div className="px-2.5 py-2 bg-[#FAFAF8] border-t border-[#ECEEE9] space-y-2">
            {explanation.level2.measurements.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {explanation.level2.measurements.map((m) => (
                  <div
                    key={m.label}
                    className="bg-white border border-[#E6E8E3] rounded px-2 py-1"
                  >
                    <div className="text-[9.5px] text-[#646872]">{m.label}</div>
                    <div className="font-mono text-[11px] font-semibold text-[#18181B] tabular-nums">
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <ul className="space-y-1 text-[11px] text-[#52565E] leading-snug">
              {explanation.level2.causes.map((c, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-[#8E929C] mt-0.5">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action — What THERMOS is doing */}
      <div className="border border-[#ECEEE9] rounded overflow-hidden">
        <button
          type="button"
          aria-expanded={showResponse}
          onClick={() => setShowResponse((v) => !v)}
          className="w-full px-2.5 py-1.5 bg-white hover:bg-[#F7F7F2] flex items-center justify-between text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[#18181B]">What THERMOS does</span>
            <span
              className={`px-1.5 py-0.2 rounded border font-mono text-[9px] uppercase ${planBadgeClass}`}
            >
              {explanation.level3.planStatus}
            </span>
          </div>
          {showResponse ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#646872]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#646872]" />
          )}
        </button>
        {showResponse && (
          <div className="px-2.5 py-2 bg-[#FAFAF8] border-t border-[#ECEEE9] space-y-1.5">
            <p className="text-[11px] text-[#18181B] font-medium leading-snug">
              {explanation.level3.summary}
            </p>
            <ul className="space-y-1 text-[11px] text-[#52565E] leading-snug">
              {explanation.level3.steps.map((s, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-[#8E929C] mt-0.5">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            {explanation.level3.verifiedOutcome && (
              <div className="bg-white border border-[#E6E8E3] rounded p-2 space-y-1">
                <div className="text-[9.5px] font-mono uppercase text-[#059669] font-semibold">
                  Before → After
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10.5px] font-mono">
                  {explanation.level3.verifiedOutcome.perRackDeltas.slice(0, 6).map((d) => (
                    <div key={d.rackId} className="flex items-center justify-between">
                      <span className="text-[#52565E]">{d.label}</span>
                      <span className="text-[#18181B] tabular-nums">
                        {d.tempBeforeC.toFixed(1)}°→{d.tempAfterC.toFixed(1)}°
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      {showLinks && explanation.connectedLinks.length > 0 && (
        <div className="pt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-[#646872] mr-0.5">Jump to:</span>
          {explanation.connectedLinks.slice(0, 5).map((link, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onNavigate(link.target)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F7F7F2] hover:bg-[#EFEFE9] border border-[#DCDED8] hover:border-[#0066FF] font-mono text-[10px] text-[#18181B] transition-colors cursor-pointer"
            >
              <span>{link.label}</span>
              <ArrowUpRight className="w-2.5 h-2.5 text-[#646872]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
