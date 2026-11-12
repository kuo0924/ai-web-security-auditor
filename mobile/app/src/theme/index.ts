import { useColorScheme } from 'react-native';
import tokens from './tokens.json';

export type ColorRole = keyof typeof tokens.color;
export type TypeRole = keyof typeof tokens.type;
export type Palette = Record<ColorRole, string>;

const light = tokens.color as Palette;
const dark = tokens.colorDark as Palette;

export type Theme = {
  scheme: 'light' | 'dark';
  color: Palette;
  type: typeof tokens.type;
  space: number[];
  radius: typeof tokens.radius;
  hit: number;
  motion: typeof tokens.motion;
  overlay: typeof tokens.overlay;
  swipe: typeof tokens.swipe;
};

export function makeTheme(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    color: scheme === 'dark' ? dark : light,
    type: tokens.type,
    space: tokens.space,
    radius: tokens.radius,
    hit: tokens.hit.min,
    motion: tokens.motion,
    overlay: tokens.overlay,
    swipe: tokens.swipe,
  };
}

/** 跟隨系統的淺色／深色。可以傳 override 強制某一種（例如照片頁一律深色）。 */
export function useTheme(override?: 'light' | 'dark'): Theme {
  const system = useColorScheme();
  return makeTheme(override ?? (system === 'dark' ? 'dark' : 'light'));
}

export { tokens };
