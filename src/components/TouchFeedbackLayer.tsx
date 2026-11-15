import { useEffect, useRef } from 'react';

export function TouchFeedbackLayer() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const handlePointerDown = (e: PointerEvent) => {
      const host = hostRef.current;
      if (!host) return;
      if (e.clientX === 0 && e.clientY === 0) return;

      while (host.childElementCount >= 5 && host.firstElementChild) {
        host.firstElementChild.remove();
      }

      const spark = document.createElement('span');
      spark.className = 'touch-spark';
      spark.style.left = `${e.clientX}px`;
      spark.style.top = `${e.clientY}px`;
      host.appendChild(spark);

      window.setTimeout(() => {
        spark.remove();
      }, 450);
    };

    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9999]" />;
}
