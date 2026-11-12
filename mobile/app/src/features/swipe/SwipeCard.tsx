import { forwardRef, memo, useImperativeHandle } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import { tokens, useTheme } from '../../theme';
import { DecisionStamp, Text } from '../../ui';

export type SwipeCardHandle = { fly: (d: Decision) => void };

type Props = {
  photo: Photo;
  label: string;
  /** 卡片底部的額外內容（例如「有 3 張相似 · 比較」）。用 memo 包好的元件，避免重繪 */
  footer?: React.ReactNode;
  /** 手指一碰到卡片就呼叫（讓背景分析先讓開） */
  onTouch?: () => void;
  onDecide: (d: Decision) => void;
  onThreshold?: () => void;
};

/** 滑動卡片：右保留、左刪除、上隱藏（門檻見 tokens.swipe）。讀屏使用者用 accessibilityActions。 */
export const SwipeCard = memo(
  forwardRef<SwipeCardHandle, Props>(function SwipeCard({ photo, label, footer, onDecide, onThreshold, onTouch }, ref) {
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
    onBegin: () => {
      'worklet';
      if (onTouch) scheduleOnRN(onTouch);
    },
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
        style={[styles.card, styles.shadow, { borderRadius: t.radius.card, backgroundColor: t.color['surface-raised'] }, cardStyle]}
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
        <PhotoLayers photo={photo} />
        <LinearGradient
          colors={[t.overlay['scrim-top'], t.overlay['scrim-bottom']]}
          style={styles.scrim}
          pointerEvents="none"
        />
        {footer ? (
          <View style={styles.footer} pointerEvents="box-none">
            {footer}
          </View>
        ) : null}
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
  }),
);

/**
 * 照片本身。不加模糊背景：每張卡片多做一次大圖模糊，在 Android 上會讓滑動掉格。
 * 卡片底色用 surface-raised，直式／橫式照片的留白看起來是卡片的一部分，而不是黑洞。
 */
function PhotoLayers({ photo }: { photo: Photo }) {
  return <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} recyclingKey={photo.id} />;
}

/** 墊在後面的牌（depth = 1、2），往下錯開、縮小，看起來是一疊照片；滑走時不會閃 */
export const NextCard = memo(function NextCard({ photo, depth = 1 }: { photo: Photo; depth?: 1 | 2 }) {
  const t = useTheme('dark');
  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: t.radius.card,
          backgroundColor: t.color['surface-raised'],
          transform: [{ translateY: depth * 12 }, { scale: 1 - depth * 0.05 }],
          opacity: depth === 1 ? 1 : 0.6,
        },
      ]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {depth === 1 ? <PhotoLayers photo={photo} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay.dim }]} />
    </View>
  );
});

export function CardError() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text scheme="dark" color="on-photo">無法載入這張照片</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  shadow: { shadowColor: tokens.color['photo-backdrop'], shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%' },
  footer: { position: 'absolute', left: 20, right: 20, bottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stamp: { position: 'absolute', top: 32 },
  stampLeft: { left: 24 },
  stampRight: { right: 24 },
  stampCenter: { alignSelf: 'center', left: 0, right: 0, alignItems: 'center' },
});
