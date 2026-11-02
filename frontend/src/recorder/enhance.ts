function wavFromBuffer(audio: AudioBuffer): Blob {
  const length = audio.length;
  const samples = new Float32Array(length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const source = audio.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      samples[index] += source[index] / audio.numberOfChannels;
    }
  }

  const output = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(output);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([output], { type: "audio/wav" });
}

export async function enhanceAudio(blob: Blob): Promise<Blob> {
  try {
    const decodeContext = new AudioContext();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer());
    } finally {
      await decodeContext.close();
    }

    const frameCount = Math.ceil(decoded.duration * decoded.sampleRate);
    const offline = new OfflineAudioContext(1, frameCount, decoded.sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;

    let sumSquares = 0;
    let totalSamples = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const samples = decoded.getChannelData(channel);
      for (const sample of samples) {
        sumSquares += sample * sample;
        totalSamples += 1;
      }
    }
    const rms = totalSamples ? Math.sqrt(sumSquares / totalSamples) : 0;
    const targetRms = 10 ** (-18 / 20);
    const gain = Math.min(8, rms > 0 ? targetRms / rms : 1);
    const normalize = offline.createGain();
    normalize.gain.value = gain;
    const highpass = offline.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 1;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    source.connect(normalize);
    normalize.connect(highpass);
    highpass.connect(limiter);
    limiter.connect(offline.destination);
    source.start();
    return wavFromBuffer(await offline.startRendering());
  } catch {
    return blob;
  }
}
