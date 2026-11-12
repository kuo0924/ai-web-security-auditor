import { View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

export type Decision = 'keep' | 'delete' | 'hide';

const META: Record<Decision, { label: string; icon: 'keep' | 'delete' | 'hide'; angle: number }> = {
  keep: { label: '保留', icon: 'keep', angle: -12 },
  delete: { label: '刪除', icon: 'delete', angle: 12 },
  hide: { label: '隱藏', icon: 'hide', angle: 0 },
};

/** 拖曳時卡片上的字章。實心角色色膠囊＋on-角色文字，保證對比。 */
export function DecisionStamp({ decision, scheme = 'dark' }: { decision: Decision; scheme?: 'light' | 'dark' }) {
  const t = useTheme(scheme);
  const m = META[decision];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: t.radius.pill,
        backgroundColor: t.color[decision],
        transform: [{ rotate: `${m.angle}deg` }],
      }}
    >
      <Icon name={m.icon} size={26} color={`on-${decision}`} scheme={scheme} />
      <Text variant="stamp" color={`on-${decision}`} scheme={scheme} maxScale={1.2}>
        {m.label}
      </Text>
    </View>
  );
}
