import { enhanceAudio } from "./enhance";
import { PartUploadQueue } from "./jobs";
import { recordingJournal, type UploadJob } from "./journal";
import { blobHasVoiceActivity } from "./vad";

export interface ClosedPart {
  index: number;
  fromSeq: number;
  toSeq: number;
  isEmpty: boolean;
}

export async function closeAndQueuePart({
  sessionId,
  index,
  fromSeq,
  toSeq,
  mimeType,
  queue,
}: {
  sessionId: string;
  index: number;
  fromSeq: number;
  toSeq: number;
  mimeType: string;
  queue: PartUploadQueue;
}): Promise<ClosedPart> {
  const slices = await recordingJournal.readSlices(sessionId, 0, fromSeq, toSeq);
  if (!slices.length) return { index, fromSeq, toSeq, isEmpty: true };
  const original = new Blob(slices.map((slice) => slice.blob), { type: mimeType });
  await recordingJournal.writePart({
    sessionId_index: `${sessionId}_${index}`,
    sessionId,
    index,
    fromSeq,
    toSeq,
    blob: original,
    isEmpty: false,
  });

  let isEmpty = false;
  let enhanced = original;
  try {
    isEmpty = !(await blobHasVoiceActivity(original));
    if (!isEmpty) enhanced = await enhanceAudio(original);
  } catch {
    // Keep the original capture if local audio decoding is unavailable.
  }
  const job: UploadJob = {
    sessionId_index: `${sessionId}_${index}`,
    sessionId,
    index,
    blob: enhanced,
    fileName: `part-${index}.wav`,
    isEmpty,
    attempts: 0,
    nextAttemptAt: Date.now(),
    status: "queued",
  };
  await recordingJournal.writePart({
    sessionId_index: `${sessionId}_${index}`,
    sessionId,
    index,
    fromSeq,
    toSeq,
    blob: original,
    isEmpty,
  });
  await queue.enqueue(job);
  return { index, fromSeq, toSeq, isEmpty };
}
