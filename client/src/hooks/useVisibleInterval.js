import { useEffect, useRef } from 'react';

// Chay callback dinh ky CHI KHI tab dang hien. Tab an (chuyen tab / thu nho) thi dung goi
// server; mo lai tab thi goi ngay 1 lan roi chay tiep theo chu ky.
// Ly do: moi tab Dashboard tu lam moi 10s-2 phut ke ca khi khong ai xem -> ~20 tab mo cung
// luc lam day 6 ket noi/ten mien cua trinh duyet (tab moi khong mo duoc) va ton tai server.
// enabled = false -> khong chay. callback doc qua ref nen khong can dua vao deps.
export function useVisibleInterval(callback, intervalMs, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    let timer = null;
    let hiddenSinceTick = false;

    const start = () => {
      if (timer) return;
      timer = window.setInterval(() => callbackRef.current(), intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        hiddenSinceTick = true;
        return;
      }
      if (hiddenSinceTick) {
        hiddenSinceTick = false;
        callbackRef.current();
      }
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    else hiddenSinceTick = true;
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}
