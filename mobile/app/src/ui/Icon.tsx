import { Platform } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme, type ColorRole } from '../theme';

/**
 * 語意圖示。iOS 用 SF Symbols；Android／web 用 Material（Apple 授權不允許在非 Apple 平台使用 SF Symbols）。
 * 對照表同 replica/design/components.md。
 */
const MAP = {
  keep: { ios: 'heart.fill', md: 'heart' },
  delete: { ios: 'trash.fill', md: 'delete' },
  hide: { ios: 'eye.slash.fill', md: 'eye-off' },
  undo: { ios: 'arrow.uturn.backward', md: 'undo' },
  favorite: { ios: 'star.fill', md: 'star' },
  close: { ios: 'xmark', md: 'close' },
  check: { ios: 'checkmark', md: 'check' },
  'trash-bin': { ios: 'trash', md: 'delete-outline' },
  lock: { ios: 'lock.fill', md: 'lock' },
  photos: { ios: 'photo.on.rectangle', md: 'image-multiple' },
  settings: { ios: 'gearshape', md: 'cog-outline' },
  compare: { ios: 'square.split.2x1', md: 'compare' },
  info: { ios: 'info.circle', md: 'information-outline' },
  restore: { ios: 'arrow.counterclockwise', md: 'restore' },
  play: { ios: 'play.fill', md: 'play' },
  pause: { ios: 'pause.fill', md: 'pause' },
  'sound-off': { ios: 'speaker.slash.fill', md: 'volume-off' },
  'sound-on': { ios: 'speaker.wave.2.fill', md: 'volume-high' },
  video: { ios: 'video.fill', md: 'video' },
  photo: { ios: 'photo', md: 'image-outline' },
} as const satisfies Record<string, { ios: SFSymbol; md: keyof typeof MaterialCommunityIcons.glyphMap }>;

export type IconName = keyof typeof MAP;

type Props = { name: IconName; size?: number; color?: ColorRole; rawColor?: string; scheme?: 'light' | 'dark' };

export function Icon({ name, size = 24, color = 'text', rawColor, scheme }: Props) {
  const t = useTheme(scheme);
  const tint = rawColor ?? t.color[color];
  const material = <MaterialCommunityIcons name={MAP[name].md} size={size} color={tint} />;
  if (Platform.OS !== 'ios') return material;
  return (
    <SymbolView name={MAP[name].ios} size={size} tintColor={tint} type="monochrome" fallback={material} />
  );
}

export const ICON_NAMES = Object.keys(MAP) as IconName[];
