import React, { useState, useEffect, useRef, useCallback } from 'react';

interface ThermosLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
  isMobile?: boolean;
}

export const ThermosLockScreen: React.FC<ThermosLockScreenProps> = ({
  isLocked,
  onUnlock,
  isMobile = false,
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const [shouldRender, setShouldRender] = useState(isLocked);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLocked) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsOpening(false);
      setShouldRender(true);
    }
  }, [isLocked]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleOpen = useCallback(() => {
    if (isOpening) return;
    setIsOpening(true);
    timerRef.current = setTimeout(() => {
      setShouldRender(false);
      onUnlock();
    }, 620);
  }, [isOpening, onUnlock]);

  useEffect(() => {
    if (!shouldRender || isOpening) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shouldRender, isOpening, handleOpen]);

  if (!shouldRender) return null;

  const titleContent = (
    <div className="w-screen h-full flex flex-col items-center justify-center px-6 text-center">
      <h1
        className={`font-bold tracking-[0.26em] pl-[0.26em] text-[#F7F7F2] uppercase leading-none ${
          isMobile ? 'text-3xl' : 'text-5xl md:text-6xl'
        }`}
      >
        THERMOS
      </h1>
      <span className="mt-5 text-[11px] sm:text-xs font-medium tracking-[0.18em] pl-[0.18em] uppercase text-[#8E929C]">
        {isMobile ? 'Tap anywhere to enter' : 'Click anywhere to enter'}
      </span>
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Enter THERMOS"
      onClick={handleOpen}
      className={`fixed inset-0 z-50 overflow-hidden select-none cursor-pointer ${
        isOpening ? 'pointer-events-none' : ''
      }`}
    >
      {/* Left Wall Half — slides open to the left end */}
      <div
        className={`absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-[#16171A] border-r border-white/[0.06] transition-transform duration-[620ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          isOpening ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute inset-y-0 left-0 w-screen">{titleContent}</div>
      </div>

      {/* Right Wall Half — slides open to the right end */}
      <div
        className={`absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-[#16171A] border-l border-white/[0.06] transition-transform duration-[620ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          isOpening ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute inset-y-0 right-0 w-screen">{titleContent}</div>
      </div>
    </div>
  );
};
