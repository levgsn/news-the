import { pool } from "../db/client.js";

export async function getTodaysSong() {
  const { rows } = await pool.query(
    `SELECT track_id, label FROM song_schedule WHERE play_date = CURRENT_DATE`
  );
  return rows[0] || null;
}

export async function getUpcomingSongs(limit = 60) {
  const { rows } = await pool.query(
    `SELECT play_date, track_id, label FROM song_schedule
     WHERE play_date >= CURRENT_DATE
     ORDER BY play_date ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function setSongForDate(playDate, trackId, label) {
  await pool.query(
    `INSERT INTO song_schedule (play_date, track_id, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (play_date) DO UPDATE SET track_id = EXCLUDED.track_id, label = EXCLUDED.label`,
    [playDate, trackId, label || null]
  );
}

export async function deleteSongForDate(playDate) {
  await pool.query(`DELETE FROM song_schedule WHERE play_date = $1`, [playDate]);
}
