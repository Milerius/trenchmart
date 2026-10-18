import { useVideoConfig } from 'remotion';

/** 16:9 (wide) or 9:16 (tall) layout switches. */
export const useFormat = () => {
  const { width, height } = useVideoConfig();
  const tall = height > width;
  return { tall, wide: !tall, W: width, H: height };
};

/** Picks the value for the current format. */
export const useF = () => {
  const { tall } = useFormat();
  return <T>(wide: T, tallValue: T) => (tall ? tallValue : wide);
};
