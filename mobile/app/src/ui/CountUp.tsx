import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Text } from './Text';
import type { ColorRole, TypeRole } from '../theme';

/** 數字從 0 跑到 value（例如釋放的空間）。系統開了「減少動態效果」就直接顯示。 */
export function CountUp({ value, format, duration = 700, variant = 'stat', color = 'keep', scheme }: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  variant?: TypeRole;
  color?: ColorRole;
  scheme?: 'light' | 'dark';
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return setShown(value);
      const start = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - start) / duration);
        setShown(value * (1 - Math.pow(1 - p, 3))); // ease-out
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);
  return (
    <Text variant={variant} color={color} scheme={scheme} accessibilityLabel={format(value)}>
      {format(shown)}
    </Text>
  );
}
