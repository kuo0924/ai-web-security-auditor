import { memo, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { formatDuration } from '../../core/format';
import type { Photo } from '../../core/types';
import { useTheme } from '../../theme';
import { Icon, Text } from '../../ui';

/**
 * 影片卡片上的東西：右上角長度、中間播放鈕。按了才建立播放器（滑動時不會有一堆影片在解碼）。
 * 預設靜音，可以開聲音；卡片被滑走時播放器跟著卸載、停止。web 預覽不能播放，只顯示長度。
 */
export const VideoOverlay = memo(function VideoOverlay({ photo }: { photo: Photo }) {
  const t = useTheme('dark');
  const [playing, setPlaying] = useState(false);
  const canPlay = Platform.OS !== 'web';
  return (
    <>
      {playing ? <Player photo={photo} onEnd={() => setPlaying(false)} /> : null}
      <View style={styles.badge} pointerEvents="none">
        <View style={[styles.pill, { backgroundColor: t.overlay.glass, borderColor: t.overlay['glass-border'] }]}>
          <Icon name="video" size={13} color="on-photo" scheme="dark" />
          <Text variant="caption" scheme="dark" color="on-photo" style={{ fontVariant: ['tabular-nums'] }}>
            {formatDuration(photo.durationMs)}
          </Text>
        </View>
      </View>
      {!playing && canPlay ? (
        <View style={styles.center} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`播放影片，長度 ${formatDuration(photo.durationMs)}`}
            onPress={() => setPlaying(true)}
            hitSlop={12}
          >
            {({ pressed }) => (
              <View style={[styles.play, { backgroundColor: t.overlay.glass, borderColor: t.overlay['glass-border'], transform: [{ scale: pressed ? 0.92 : 1 }] }]}>
                <Icon name="play" size={30} color="on-photo" scheme="dark" />
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </>
  );
});

function Player({ photo, onEnd }: { photo: Photo; onEnd: () => void }) {
  const t = useTheme('dark');
  const player = useVideoPlayer(photo.uri, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration || (photo.durationMs ?? 0) / 1000;
      setProgress(d ? Math.min(1, currentTime / d) : 0);
    });
    const end = player.addListener('playToEnd', onEnd);
    return () => {
      sub.remove();
      end.remove();
    };
  }, [player, onEnd, photo.durationMs]);

  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {/* 點畫面暫停／繼續 */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? '暫停' : '繼續播放'}
        onPress={() => (isPlaying ? player.pause() : player.play())}
      />
      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? '開啟聲音' : '靜音'}
          onPress={() => (player.muted = !muted)}
          hitSlop={10}
          style={[styles.round, { backgroundColor: t.overlay.glass, borderColor: t.overlay['glass-border'] }]}
        >
          <Icon name={muted ? 'sound-off' : 'sound-on'} size={16} color="on-photo" scheme="dark" />
        </Pressable>
      </View>
      {!isPlaying ? (
        <View style={styles.center} pointerEvents="none">
          <View style={[styles.play, { backgroundColor: t.overlay.glass, borderColor: t.overlay['glass-border'] }]}>
            <Icon name="play" size={30} color="on-photo" scheme="dark" />
          </View>
        </View>
      ) : null}
      <View style={[styles.track, { backgroundColor: t.overlay['glass-border'] }]} pointerEvents="none">
        <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: t.color['on-photo'] }} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: 16, right: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingLeft: 4 },
  controls: { position: 'absolute', top: 14, left: 14 },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
});
