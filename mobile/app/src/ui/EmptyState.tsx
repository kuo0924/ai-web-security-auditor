import { View } from 'react-native';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  scheme?: 'light' | 'dark';
};

export function EmptyState({ icon, title, body, action, scheme }: Props) {
  const t = useTheme(scheme);
  return (
    <View style={{ alignItems: 'center', padding: t.space[7], gap: t.space[3] }}>
      <Icon name={icon} size={56} color="text-muted" scheme={scheme} />
      <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }} scheme={scheme}>
        {title}
      </Text>
      {body ? (
        <Text variant="body-sm" color="text-muted" style={{ textAlign: 'center' }} scheme={scheme}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ alignSelf: 'stretch', marginTop: t.space[3] }}>
          <Button label={action.label} onPress={action.onPress} scheme={scheme} />
        </View>
      ) : null}
    </View>
  );
}
