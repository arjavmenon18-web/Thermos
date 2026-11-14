import { useState, useEffect } from 'react';

export interface ViewportInfo {
  width: number;
  height: number;
  aspect: number;
  /** Narrow phone / narrow split-screen (< 768px): use slide-up bottom sheets & two-tier compact bars */
  isMobile: boolean;
  /** Tablet width (768px - 1023px) */
  isTablet: boolean;
  /** Below 1240px where top-left status card & center lens bar would collide horizontally */
  isCompactTop: boolean;
  /** Short viewport height (< 780px, e.g. 720p laptop or landscape phone/tablet) */
  isShort: boolean;
  /** Very narrow phone (< 480px) where world-space rack badges use ultra-compact labels */
  isExtraNarrow: boolean;
  /** Coarse pointer (touch screen) requiring >= 44px hit targets */
  isCoarsePointer: boolean;
}

function readViewport(): ViewportInfo {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const width = Math.max(
    320,
    Math.round(vv?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1280))
  );
  const height = Math.max(
    320,
    Math.round(vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800))
  );
  const isCoarsePointer =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  return {
    width,
    height,
    aspect: width / Math.max(1, height),
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isCompactTop: width < 1240,
    isShort: height < 780,
    isExtraNarrow: width < 480,
    isCoarsePointer,
  };
}

export function useViewport(): ViewportInfo {
  const [viewport, setViewport] = useState<ViewportInfo>(() => readViewport());

  useEffect(() => {
    let rafId = 0;
    const handleUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewport((prev) => {
          const next = readViewport();
          if (
            prev.width === next.width &&
            prev.height === next.height &&
            prev.isCoarsePointer === next.isCoarsePointer
          ) {
            return prev;
          }
          return next;
        });
      });
    };

    window.addEventListener('resize', handleUpdate, { passive: true });
    window.addEventListener('orientationchange', handleUpdate, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', handleUpdate, { passive: true });

    const pointerMq =
      typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    pointerMq?.addEventListener?.('change', handleUpdate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('orientationchange', handleUpdate);
      vv?.removeEventListener('resize', handleUpdate);
      pointerMq?.removeEventListener?.('change', handleUpdate);
    };
  }, []);

  return viewport;
}
