import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const PresentationPlugin: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div className="hidden md:block absolute bottom-3 left-[132px] z-20 select-none">
      <div
        className={`bg-white/92 backdrop-blur-md border border-[#DCDED8] text-[#18181B] shadow-2xs overflow-hidden transition-[width,height,border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isExpanded
            ? 'w-[280px] rounded-xl shadow-lg'
            : 'w-[164px] rounded-md hover:bg-white hover:border-[#CCD0C8]'
        }`}
      >
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className={`w-full flex items-center justify-between px-3 text-left transition-colors duration-200 cursor-pointer ${
            isExpanded
              ? 'py-2 hover:bg-[#F4F5F0]/80 border-b border-[#EAECE6]'
              : 'py-1.5 hover:bg-[#F4F5F0]/60'
          }`}
          title={isExpanded ? 'Collapse UN SDG reference' : 'View HOPE ’26 UN SDGs 9, 11 & 12 alignment'}
        >
          <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#059669] shrink-0" />
            <span className="text-[11px] font-medium tracking-tight text-[#52565E] truncate">
              HOPE ’26 · UN SDGs
            </span>
          </div>

          <div className="flex items-center text-[#7A7E85] shrink-0 ml-1.5">
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isExpanded ? 'rotate-180 text-[#18181B]' : 'rotate-0'
              }`}
            />
          </div>
        </button>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isExpanded
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden">
            <div className="p-2.5 space-y-2">
              <div className="relative rounded-lg overflow-hidden border border-[#DCDED8] bg-[#F7F8F4]">
                <img
                  src="/assets/aistudio/sdg_9_11_12.png"
                  alt="UN Sustainable Development Goals 9, 11, and 12"
                  className="w-full h-auto object-contain block"
                  loading="eager"
                />
              </div>
              <p className="text-[10px] text-[#646872] leading-snug">
                Sustainability alignment reference: resilient digital infrastructure (SDG 9), urban resource efficiency (SDG 11), and responsible water/heat use (SDG 12).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
