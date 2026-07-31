import crypto from "node:crypto";
import { pool } from "../db/client.js";
import { synthesizeSpeech } from "./elevenlabs.js";

// Single choke point for ElevenLabs calls: every route that wants spoken
// audio goes through here, and a cache hit means zero API cost. Callers
// (the /audio routes) only ever invoke this in response to an explicit
// user click on a play button -- never automatically -- so TTS credits
// are only spent when someone actually wants to listen.
export async function getOrSynthesizeAudio(text, { voiceId } = {}) {
  const key = crypto.createHash("sha256").update(`${text}::${voiceId || "default"}`).digest("hex");

  const { rows } = await pool.query(
    `SELECT audio_data, content_type FROM tts_audio_cache WHERE cache_key = $1`,
    [key]
  );
  if (rows[0]) return rows[0];

  const audioBuffer = await synthesizeSpeech(text, { voiceId });
  await pool.query(
    `INSERT INTO tts_audio_cache (cache_key, audio_data, content_type)
     VALUES ($1, $2, 'audio/mpeg')
     ON CONFLICT (cache_key) DO NOTHING`,
    [key, audioBuffer]
  );
  return { audio_data: audioBuffer, content_type: "audio/mpeg" };
}
