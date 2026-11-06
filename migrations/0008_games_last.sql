-- XO "Play again" restarts the same message and keeps a one-line note of the last result.
ALTER TABLE games ADD COLUMN last TEXT;
