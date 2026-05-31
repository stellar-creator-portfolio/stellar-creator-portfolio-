import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  Group,
  Line,
  vec,
  Paint,
  useValue,
  useComputedValue,
  runTiming,
} from '@shopify/react-native-skia';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FinancialChartProps {
  data: Candle[];
  width?: number;
  height?: number;
  bullColor?: string;
  bearColor?: string;
  backgroundColor?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function parseCandles(raw: Array<[number, number, number, number, number, number]>): Candle[] {
  return raw.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));
}

function priceToY(price: number, minPrice: number, maxPrice: number, chartHeight: number, padding: number): number {
  const range = maxPrice - minPrice || 1;
  return padding + (1 - (price - minPrice) / range) * (chartHeight - padding * 2);
}

export const FinancialChart: React.FC<FinancialChartProps> = ({
  data,
  width = SCREEN_WIDTH - 32,
  height = 320,
  bullColor = '#26a69a',
  bearColor = '#ef5350',
  backgroundColor = '#1a1a2e',
}) => {
  const padding = 24;
  const chartHeight = height - 60;

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);

  const [visibleStart, setVisibleStart] = useState(0);
  const [candleWidth, setCandleWidth] = useState(8);

  const prices = useMemo(() => {
    if (!data.length) return { min: 0, max: 1 };
    const highs = data.map((c) => c.high);
    const lows = data.map((c) => c.low);
    return { min: Math.min(...lows), max: Math.max(...highs) };
  }, [data]);

  const visibleData = useMemo(() => {
    const maxVisible = Math.floor(width / (candleWidth + 2));
    const start = Math.max(0, Math.min(visibleStart, data.length - maxVisible));
    return data.slice(start, start + maxVisible);
  }, [data, visibleStart, candleWidth, width]);

  const candlePaths = useMemo(() => {
    const { min, max } = prices;
    const paths: Array<{ wick: ReturnType<typeof Skia.Path.Make>; body: ReturnType<typeof Skia.Path.Make>; bull: boolean }> = [];
    const totalCandles = visibleData.length;

    visibleData.forEach((candle, i) => {
      const x = padding + i * ((width - padding * 2) / totalCandles) + (width - padding * 2) / totalCandles / 2;
      const cw = Math.max(2, (width - padding * 2) / totalCandles - 2);

      const openY = priceToY(candle.open, min, max, chartHeight, padding);
      const closeY = priceToY(candle.close, min, max, chartHeight, padding);
      const highY = priceToY(candle.high, min, max, chartHeight, padding);
      const lowY = priceToY(candle.low, min, max, chartHeight, padding);

      const isBull = candle.close >= candle.open;
      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);

      const wickPath = Skia.Path.Make();
      wickPath.moveTo(x, highY);
      wickPath.lineTo(x, lowY);

      const bodyPath = Skia.Path.Make();
      bodyPath.addRect({ x: x - cw / 2, y: bodyTop, width: cw, height: bodyHeight });

      paths.push({ wick: wickPath, body: bodyPath, bull: isBull });
    });

    return paths;
  }, [visibleData, prices, width, chartHeight, padding]);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const newScale = Math.max(0.5, Math.min(5, savedScale.value * e.scale));
      scale.value = newScale;
      const newCandleWidth = Math.max(3, Math.min(24, 8 * newScale));
      setCandleWidth(Math.round(newCandleWidth));
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
    })
    .onUpdate((e) => {
      const candleStep = candleWidth + 2;
      const delta = Math.round(e.translationX / candleStep);
      const newStart = Math.max(0, Math.min(data.length - 1, visibleStart - delta));
      setVisibleStart(newStart);
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  const bullPaint = Skia.Paint();
  bullPaint.setColor(Skia.Color(bullColor));
  bullPaint.setStyle(1);
  bullPaint.setStrokeWidth(1);

  const bearPaint = Skia.Paint();
  bearPaint.setColor(Skia.Color(bearColor));
  bearPaint.setStyle(1);
  bearPaint.setStrokeWidth(1);

  const wickPaint = Skia.Paint();
  wickPaint.setColor(Skia.Color('#888888'));
  wickPaint.setStyle(1);
  wickPaint.setStrokeWidth(1);

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { width, height, backgroundColor }]}>
        <Canvas style={{ width, height: chartHeight }}>
          <Group>
            {candlePaths.map((cp, i) => (
              <Group key={i}>
                <Path path={cp.wick} paint={wickPaint} />
                <Path path={cp.body} paint={cp.bull ? bullPaint : bearPaint} />
              </Group>
            ))}
          </Group>
        </Canvas>
        <View style={[styles.volumeBar, { width }]} />
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  volumeBar: {
    height: 50,
    backgroundColor: '#0d0d1a',
  },
});

export { parseCandles };
export default FinancialChart;
