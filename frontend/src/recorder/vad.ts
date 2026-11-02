export function hasVoiceActivity(
  audio: AudioBuffer,
  { thresholdDb = -34, windowMs = 100 }: { thresholdDb?: number; windowMs?: number } = {},
): boolean {
  const threshold = 10 ** (thresholdDb / 20);
  const windowSize = Math.max(1, Math.floor((audio.sampleRate * windowMs) / 1000));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));

  for (let start = 0; start < audio.length; start += windowSize) {
    const end = Math.min(audio.length, start + windowSize);
    let sumSquares = 0;
    let sampleCount = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += 1) {
        const value = channel[sample];
        sumSquares += value * value;
        sampleCount += 1;
      }
    }
    if (sampleCount > 0 && Math.sqrt(sumSquares / sampleCount) >= threshold) return true;
  }
  return false;
}

export async function blobHasVoiceActivity(blob: Blob): Promise<boolean> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    return hasVoiceActivity(audio);
  } finally {
    await context.close();
  }
}
