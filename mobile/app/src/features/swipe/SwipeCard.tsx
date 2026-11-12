import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { resolveSwipe } from '../../core/deck';
import type { Decision, Photo } from '../../core/types';
import { useTheme } from '../../theme';
import { DecisionStamp, Text } from '../../ui';

export type SwipeCardHandle = { fly: (d: Decision) => void };

type Props = {
  photo: Photo;
  label: string;
  onDecide: (d: Decision) => void;
  onThreshold?: () => void;
};

/** 滑動卡片：右保留、左刪除、上隱藏（門檻見 tokens.swipe）。讀屏使用者用 accessibilityActions。 */
export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard({ photo, label, onDecide, onThreshold }, ref) {
  const t = useTheme('dark');
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const opacity = useSharedValue(1);
  const crossed = useSharedValue(0);
  const cfg = { horizontal: t.swipe['horizontal-threshold'], up: t.swipe['up-threshold'] };
  const maxRot = t.swipe['max-rotate-deg'];
  const flyMs = t.motion.base;

  const flyOut = (d: Decision) => {
    'worklet';
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDecide, d);
    };
    if (reduceMotion) {
      opacity.value = withTiming(0, { duration: t.motion.fast }, done);
      return;
    }
    if (d === 'hide') ty.value = withTiming(-height * 1.2, { duration: flyMs }, done);
    else tx.value = withTiming((d === 'keep' ? 1 : -1) * width * 1.5, { duration: flyMs }, done);
  };

  useImperativeHandle(ref, () => ({ fly: (d) => flyOut(d) }));

  const pan = usePanGesture({
    onUpdate: (e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
      const d = resolveSwipe({ dx: e.translationX, dy: e.translationY, vx: 0, vy: 0 }, { width, height }, cfg);
      const now = d ? 1 : 0;
      if (now !== crossed.value) {
        crossed.value = now;
        if (now && onThreshold) scheduleOnRN(onThreshold);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      const d = resolveSwipe(
        { dx: e.translationX, dy: e.translationY, vx: e.velocityX, vy: e.velocityY },
        { width, height },
        cfg,
      );
      if (d) flyOut(d);
      else {
        tx.value = withSpring(0, t.motion.spring);
        ty.value = withSpring(0, t.motion.spring);
      }
    },
  });

  const cardStyle = useAnimatedStyle(() => {
    const goingUp = ty.value < 0 && Math.abs(ty.value) > Math.abs(tx.value);
    const rot = goingUp ? 0 : interpolate(tx.value, [-width, 0, width], [-maxRot, 0, maxRot], Extrapolation.CLAMP);
    const scale = goingUp ? interpolate(-ty.value, [0, height], [1, 0.9], Extrapolation.CLAMP) : 1;
    return {
      opacity: opacity.value,
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rot}deg` }, { scale }],
    };
  });
  const keepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, width * cfg.horizontal], [0, 1], Extrapolation.CLAMP),
  }));
  const deleteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-tx.value, [0, width * cfg.horizontal], [0, 1], Extrapolation.CLAMP),
  }));
  const hideStyle = useAnimatedStyle(() => ({
    opacity: Math.abs(tx.value) > -ty.value ? 0 : interpolate(-ty.value, [0, height * cfg.up], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, { borderRadius: t.radius.card, backgroundColor: t.color['photo-backdrop'] }, cardStyle]}
        accessible
        accessibilityLabel={label}
        accessibilityHint="向右滑保留、向左滑刪除、向上滑隱藏"
        accessibilityActions={[
          { name: 'keep', label: '保留' },
          { name: 'delete', label: '刪除' },
          { name: 'hide', label: '隱藏' },
        ]}
        onAccessibilityAction={(e) => onDecide(e.nativeEvent.actionName as Decision)}
      >
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} recyclingKey={photo.id} />
        <Animated.View style={[styles.stamp, styles.stampLeft, keepStyle]}>
          <DecisionStamp decision="keep" />
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampRight, deleteStyle]}>
          <DecisionStamp decision="delete" />
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampCenter, hideStyle]}>
          <DecisionStamp decision="hide" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

/** 墊在後面的下一張（縮小一點），滑走時不會閃 */
export function NextCard({ photo }: { photo: Photo }) {
  const t = useTheme('dark');
  return (
    <View
      style={[styles.card, { borderRadius: t.radius.card, backgroundColor: t.color['photo-backdrop'], transform: [{ scale: 0.94 }] }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" recyclingKey={photo.id} />
    </View>
  );
}

export function CardError() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text scheme="dark" color="on-photo">無法載入這張照片</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  stamp: { position: 'absolute', top: 32 },
  stampLeft: { left: 24 },
  stampRight: { right: 24 },
  stampCenter: { alignSelf: 'center', left: 0, right: 0, alignItems: 'center' },
});
