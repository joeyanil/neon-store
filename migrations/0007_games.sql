-- Inline XO (tic-tac-toe) games. One row per game message; old rows are deleted by the cron.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,            -- Telegram inline_message_id
  x_id INTEGER, x_name TEXT,
  o_id INTEGER, o_name TEXT,
  board TEXT NOT NULL DEFAULT '.........',
  turn TEXT NOT NULL DEFAULT 'X',
  status TEXT NOT NULL DEFAULT 'wait',   -- wait | play | done
  winner TEXT,                    -- X | O | D (draw)
  moves INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
