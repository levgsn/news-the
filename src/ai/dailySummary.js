import { pool } from "../db/client.js";
import { generateText } from "./claude.js";
import { getOrSynthesizeAudio } from "./audioCache.js";
import { getTrendingClusters } from "../ranking/trending.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodaysSummary() {
  const { rows } = await pool.query(
    `SELECT text_content, text_source, audio_source, (audio_data IS NOT NULL) AS has_audio
     FROM daily_summary WHERE summary_date = $1`,
    [today()]
  );
  return rows[0] || null;
}

export async function getTodaysSummaryAudio() {
  const { rows } = await pool.query(
    `SELECT audio_data, audio_content_type FROM daily_summary WHERE summary_date = $1`,
    [today()]
  );
  if (!rows[0]?.audio_data) return null;
  return { audio_data: rows[0].audio_data, content_type: rows[0].audio_content_type || "audio/mpeg" };
}

/**
 * Writes today's AI-generated text, overwriting whatever was there
 * (including a previous user recording) -- generating fresh AI text is a
 * deliberate replace, not a merge. Clears any existing audio since it
 * would no longer match the new text.
 */
export async function generateAiDailySummary() {
  const clusters = await getTrendingClusters({ limit: 25 });
  const headlineLines = clusters
    .map((c) => `- [${c.category}] ${c.representative_title} (${c.top_source})`)
    .join("\n");

  const text = await generateText({
    system: [
      "You are an anchor writing and delivering a daily news podcast. The listener has headphones on during a morning walk -- they are not reading, they are LISTENING, and they cannot re-scan a line they missed. Write for the ear.",
      "",
      "This must sound like a person talking, not a list being read out. Absolutely do not write one sentence per story. Instead:",
      "- Open with a natural greeting and a one-line sense of what kind of day it is in the news.",
      "- Give the two or three biggest stories real airtime -- several sentences of context each, why it matters, what happens next. Let the smaller items go by quickly in a sentence, grouped together.",
      "- Vary sentence length. Short sentences land points.",
      "- Close with a brief sign-off.",
      "",
      "MOST IMPORTANT -- never jump from one story to the next cold. EVERY handoff needs a spoken bridge, and the bridge should connect the two stories rather than just announcing a change of subject. Reach for whatever they share: subject, theme, place, cause, mood, or even deliberate contrast.",
      "Good bridges: 'Staying with the courts for a moment...', 'That same fight is playing out in the markets, where...', 'From Washington to Wall Street...', 'If that story is about institutions straining, this next one is about them holding...', 'On a much lighter note...'",
      "Weak bridges to avoid: 'In other news', 'Also today', 'Moving on', 'Next up', or simply starting a new paragraph with a new subject.",
      "Never use the same bridge twice in one script.",
      "",
      "You only have headlines and outlet names -- no article text. Never invent quotes, statistics, causes, or outcomes. Where you add context, keep it to what is broadly known and safe, or attribute it loosely ('outlets covering this are focused on...').",
      "",
      "Neutral and even-handed on anything contested. Warm and human, never breathless or salesy.",
      "",
      "Roughly 600-800 words -- about five minutes of listening.",
      "",
      "Plain spoken prose ONLY. No markdown, no headers, no bullets, no asterisks, no stage directions, no speaker labels -- this is fed straight to a text-to-speech engine, so any stray characters get read out loud.",
    ].join("\n"),
    prompt: `Here are today's top stories, by category, with the outlet covering each:\n${headlineLines}\n\nWrite today's spoken news rundown.`,
    maxTokens: 1600,
  });

  await pool.query(
    `INSERT INTO daily_summary (summary_date, text_content, text_source, audio_data, audio_content_type, audio_source)
     VALUES ($1, $2, 'ai', NULL, NULL, NULL)
     ON CONFLICT (summary_date) DO UPDATE SET
       text_content = EXCLUDED.text_content, text_source = 'ai',
       audio_data = NULL, audio_content_type = NULL, audio_source = NULL,
       updated_at = now()`,
    [today(), text]
  );

  return text;
}

/** Synthesizes AI audio for whatever text is currently saved (AI or user-written). */
export async function generateAiDailySummaryAudio() {
  const { rows } = await pool.query(`SELECT text_content FROM daily_summary WHERE summary_date = $1`, [today()]);
  const text = rows[0]?.text_content;
  if (!text) return null;

  const { audio_data, content_type } = await getOrSynthesizeAudio(text);
  await pool.query(
    `UPDATE daily_summary SET audio_data = $1, audio_content_type = $2, audio_source = 'ai', updated_at = now()
     WHERE summary_date = $3`,
    [audio_data, content_type, today()]
  );
  return { audio_data, content_type };
}

/**
 * Owner-provided version: a transcript and/or an uploaded audio recording.
 * Each field is independent -- submitting only text leaves any existing
 * audio alone, submitting only audio leaves any existing text alone, so
 * the admin form doesn't force re-entering both every time.
 */
export async function setUserDailySummary({ text, audioBuffer, audioContentType }) {
  await pool.query(
    `INSERT INTO daily_summary (summary_date, text_content, text_source, audio_data, audio_content_type, audio_source)
     VALUES (
       $1, $2, CASE WHEN $2 IS NOT NULL THEN 'user' ELSE NULL END,
       $3, $4, CASE WHEN $3 IS NOT NULL THEN 'user' ELSE NULL END
     )
     ON CONFLICT (summary_date) DO UPDATE SET
       text_content = COALESCE(EXCLUDED.text_content, daily_summary.text_content),
       text_source = COALESCE(EXCLUDED.text_source, daily_summary.text_source),
       audio_data = COALESCE(EXCLUDED.audio_data, daily_summary.audio_data),
       audio_content_type = COALESCE(EXCLUDED.audio_content_type, daily_summary.audio_content_type),
       audio_source = COALESCE(EXCLUDED.audio_source, daily_summary.audio_source),
       updated_at = now()`,
    [today(), text || null, audioBuffer || null, audioContentType || null]
  );
}
