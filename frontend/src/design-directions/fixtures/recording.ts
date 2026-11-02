export interface TranscriptSegment {
  speakerId: string;
  time: string;
  text: string;
}

export const recording = {
  title: "Product principles, over coffee",
  date: "October 29 · 34 min",
  speakers: [
    { id: "voice-1", name: "Maya Chen", color: "coral", confirmed: true, initials: "MC" },
    { id: "voice-2", name: "Voice 2", color: "blue", confirmed: false, initials: "V2" },
    { id: "voice-3", name: "Voice 3", color: "green", confirmed: false, initials: "V3" },
  ],
  segments: [
    { speakerId: "voice-1", time: "00:12", text: "I keep coming back to the idea that the app should feel like a place you can think, not another place asking you to manage things." },
    { speakerId: "voice-2", time: "00:36", text: "Exactly. The structure should be there when you need it, but it should never be the first thing you have to understand." },
    { speakerId: "voice-3", time: "01:04", text: "Maybe that's the difference between a workspace and a tool. A workspace gives you room to arrive." },
    { speakerId: "voice-1", time: "01:28", text: "Yes. And the recording should feel the same way. You press once, then you're back in the conversation." },
    { speakerId: "voice-2", time: "01:51", text: "We can make the transcript useful without making people babysit it. Speaker names should be easy to correct later." },
    { speakerId: "voice-3", time: "02:19", text: "And the notes should connect without forcing a perfect filing system. That's probably the thing I want to test next." },
  ] satisfies TranscriptSegment[],
};
