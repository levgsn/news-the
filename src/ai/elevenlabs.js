// ElevenLabs' public "Rachel" premade voice -- a sensible default if the
// user hasn't picked one. Override via ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function synthesizeSpeech(text, { voiceId } = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs API ${res.status}: ${await res.text()}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
