import { Text as RNText, type TextProps } from 'react-native';
import { useTheme, type ColorRole, type TypeRole } from '../theme';

type Props = TextProps & {
  variant?: TypeRole;
  color?: ColorRole;
  /** 照片上的大字章等，字級放大上限較低，避免撐破版面 */
  maxScale?: number;
  scheme?: 'light' | 'dark';
};

/** 一律用這個元件顯示文字：系統字體、token 字級、跟隨系統字級（Dynamic Type）。 */
export function Text({ variant = 'body', color = 'text', maxScale = 1.6, scheme, style, ...rest }: Props) {
  const t = useTheme(scheme);
  const v = t.type[variant];
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          color: t.color[color],
          fontSize: v.size,
          lineHeight: v.line,
          fontWeight: v.weight as '400' | '500' | '600' | '700' | '800',
        },
        style,
      ]}
      {...rest}
    />
  );
}
