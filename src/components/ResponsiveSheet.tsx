import React from 'react';

interface ResponsiveSheetProps {
  isMobile: boolean;
  ariaLabel: string;
  onDismiss?: () => void;
  /** Desktop positioning & width classes inside <main className="relative flex-1"> */
  desktopClassName: string;
  /** Optional mobile max-height override (defaults to max-h-[62dvh]) */
  mobileMaxHeightClass?: string;
  /** Show subtle backdrop scrim on mobile so tapping the 3D hall dismisses the sheet */
  showMobileScrim?: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
}

export const ResponsiveSheet: React.FC<ResponsiveSheetProps> = ({
  isMobile,
  ariaLabel,
  onDismiss,
  desktopClassName,
  mobileMaxHeightClass = 'max-h-[62dvh]',
  showMobileScrim = false,
  header,
  children,
}) => {
  if (isMobile) {
    return (
      <>
        {showMobileScrim && onDismiss && (
          <div
            aria-hidden="true"
            onClick={onDismiss}
            className="absolute inset-0 z-[28] bg-[#18181B]/10 pointer-events-auto animate-fadeIn"
          />
        )}
        <aside
          data-interactive="true"
          aria-label={ariaLabel}
          className={`absolute inset-x-0 bottom-0 z-30 ${mobileMaxHeightClass} flex flex-col bg-white/99 border-t border-[#DCDED8] rounded-t-xl shadow-[0_-10px_30px_rgba(24,24,27,0.12)] text-[#18181B] pointer-events-auto animate-sheetUp`}
        >
          <div className="pt-1.5 pb-0.5 flex justify-center shrink-0">
            <span className="w-9 h-1 rounded-full bg-[#D4D7D0]" aria-hidden="true" />
          </div>
          <div className="shrink-0">{header}</div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        </aside>
      </>
    );
  }

  return (
    <aside
      data-interactive="true"
      aria-label={ariaLabel}
      className={`absolute z-30 flex flex-col bg-white/98 border border-[#DCDED8] rounded-lg shadow-[0_8px_28px_rgba(24,24,27,0.08)] text-[#18181B] pointer-events-auto overflow-hidden ${desktopClassName}`}
    >
      <div className="shrink-0">{header}</div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
    </aside>
  );
};
