import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("tournament.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tournament_type TEXT NOT NULL CHECK (tournament_type IN ('chill', 'competitive'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team1_id INTEGER,
    team2_id INTEGER,
    score1 INTEGER DEFAULT 0,
    score2 INTEGER DEFAULT 0,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'pending', 'completed')),
    tournament_type TEXT NOT NULL,
    start_time TEXT,
    pitch TEXT,
    umpire TEXT,
    stage TEXT DEFAULT 'round-robin',
    FOREIGN KEY (team1_id) REFERENCES teams(id),
    FOREIGN KEY (team2_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER,
    team_id INTEGER,
    player_name TEXT NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER,
    team_id INTEGER,
    score1 INTEGER,
    score2 INTEGER,
    scorers TEXT, -- JSON string of player names
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(match_id, team_id)
  );
`);

// Migration: Ensure umpire column exists
try {
  db.prepare("ALTER TABLE matches ADD COLUMN umpire TEXT").run();
} catch (e) {
  // Column already exists or other error
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/data", (req, res) => {
    const teams = db.prepare("SELECT * FROM teams").all();
    const matches = db.prepare(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
    `).all();
    const submissions = db.prepare("SELECT * FROM submissions").all();
    const goals = db.prepare(`
      SELECT g.*, t.name as team_name 
      FROM goals g
      JOIN teams t ON g.team_id = t.id
    `).all();
    res.json({ teams, matches, submissions, goals });
  });

  app.post("/api/teams", (req, res) => {
    const { name, tournament_type } = req.body;
    const info = db.prepare("INSERT INTO teams (name, tournament_type) VALUES (?, ?)").run(name, tournament_type);
    const newTeam = { id: info.lastInsertRowid, name, tournament_type };
    io.emit("team_added", newTeam);
    res.json(newTeam);
  });

  app.post("/api/matches", (req, res) => {
    const { team1_id, team2_id, tournament_type, start_time, stage } = req.body;
    
    // Prevent duplicate matches in the same stage
    const existing = db.prepare(`
      SELECT id FROM matches 
      WHERE ((team1_id = ? AND team2_id = ?) OR (team1_id = ? AND team2_id = ?))
      AND tournament_type = ? AND stage = ?
    `).get(team1_id, team2_id, team2_id, team1_id, tournament_type, stage);

    if (existing) {
      return res.json(db.prepare(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `).get(existing.id));
    }

    const info = db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, start_time, stage) VALUES (?, ?, ?, ?, ?)").run(team1_id, team2_id, tournament_type, start_time, stage);
    const newMatch = db.prepare(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      WHERE m.id = ?
    `).get(info.lastInsertRowid);
    io.emit("match_added", newMatch);
    res.json(newMatch);
  });

  app.post("/api/submit-score", (req, res) => {
    const { match_id, team_id, score1, score2, scorers } = req.body;
    
    try {
      db.prepare("INSERT OR REPLACE INTO submissions (match_id, team_id, score1, score2, scorers) VALUES (?, ?, ?, ?, ?)").run(match_id, team_id, score1, score2, JSON.stringify(scorers));
      
      // Check for agreement
      const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(match_id);
      const otherTeamId = match.team1_id === team_id ? match.team2_id : match.team1_id;
      
      const otherSubmission = db.prepare("SELECT * FROM submissions WHERE match_id = ? AND team_id = ?").get(match_id, otherTeamId);
      
      if (otherSubmission) {
        // If both submitted, check if they agree
        if (otherSubmission.score1 === score1 && otherSubmission.score2 === score2) {
          db.prepare("UPDATE matches SET score1 = ?, score2 = ?, status = 'completed' WHERE id = ?").run(score1, score2, match_id);
          
          // Finalize goals
          db.prepare("DELETE FROM goals WHERE match_id = ?").run(match_id);
          const allScorers = [...scorers, ...JSON.parse(otherSubmission.scorers)];
          const stmt = db.prepare("INSERT INTO goals (match_id, team_id, player_name) VALUES (?, ?, ?)");
          
          // Note: scorers from current submission belong to team_id.
          // Scorers from otherSubmission belong to otherTeamId.
          scorers.forEach((name: string) => stmt.run(match_id, team_id, name));
          JSON.parse(otherSubmission.scorers).forEach((name: string) => stmt.run(match_id, otherTeamId, name));

          io.emit("match_updated", { id: match_id, score1, score2, status: 'completed' });
          
          // Refresh goal data
          const goals = db.prepare(`
            SELECT g.*, t.name as team_name 
            FROM goals g
            JOIN teams t ON g.team_id = t.id
          `).all();
          io.emit("goals_updated", goals);
        } else {
          db.prepare("UPDATE matches SET status = 'pending' WHERE id = ?").run(match_id);
          io.emit("match_updated", { id: match_id, status: 'pending' });
        }
      } else {
        db.prepare("UPDATE matches SET status = 'pending' WHERE id = ?").run(match_id);
        io.emit("match_updated", { id: match_id, status: 'pending' });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/generate-knockouts", (req, res) => {
    const { tournament_type, teams } = req.body;
    // teams should be sorted by standings
    if (teams.length < 2) return res.status(400).json({ error: "Need at least 2 teams" });

    // Semi 1: 1st vs 4th (if 4+ teams)
    if (teams.length >= 4) {
      db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)").run(teams[0].id, teams[3].id, tournament_type, 'semi-final');
      db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)").run(teams[1].id, teams[2].id, tournament_type, 'semi-final');
      
      // Play-offs for the rest
      for (let i = 4; i < teams.length; i += 2) {
        if (teams[i+1]) {
          db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)").run(teams[i].id, teams[i+1].id, tournament_type, 'play-off');
        }
      }
    } else if (teams.length >= 2) {
      // Just a final if only 2-3 teams? Or just semi between 1 and 2
      db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)").run(teams[0].id, teams[1].id, tournament_type, 'final');
    }

    const newMatches = db.prepare(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m 
      LEFT JOIN teams t1 ON m.team1_id = t1.id 
      LEFT JOIN teams t2 ON m.team2_id = t2.id 
      WHERE m.tournament_type = ? AND (m.stage = 'semi-final' OR m.stage = 'play-off')
    `).all(tournament_type);
    
    newMatches.forEach(m => io.emit("match_added", m));
    res.json(newMatches);
  });

  app.post("/api/generate-final", (req, res) => {
    const { tournament_type, winners } = req.body;
    if (winners.length < 2) return res.status(400).json({ error: "Need 2 winners" });

    db.prepare("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)").run(winners[0].id, winners[1].id, tournament_type, 'final');
    
    const newMatch = db.prepare("SELECT m.*, t1.name as team1_name, t2.name as team2_name FROM matches m LEFT JOIN teams t1 ON m.team1_id = t1.id LEFT JOIN teams t2 ON m.team2_id = t2.id WHERE m.tournament_type = ? AND m.stage = 'final'").get(tournament_type);
    
    io.emit("match_added", newMatch);
    res.json(newMatch);
  });

  app.post("/api/admin/force-approve", (req, res) => {
    const { submission_id } = req.body;
    try {
      const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submission_id);
      if (!submission) return res.status(404).json({ error: "Submission not found" });

      db.prepare("UPDATE matches SET score1 = ?, score2 = ?, status = 'completed' WHERE id = ?").run(submission.score1, submission.score2, submission.match_id);
      
      const updatedMatch = db.prepare(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `).get(submission.match_id);

      io.emit("match_updated", updatedMatch);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/teams/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM submissions WHERE match_id IN (SELECT id FROM matches WHERE team1_id = ? OR team2_id = ?)").run(id, id);
      db.prepare("DELETE FROM matches WHERE team1_id = ? OR team2_id = ?").run(id, id);
      db.prepare("DELETE FROM teams WHERE id = ?").run(id);
      
      // Fetch full data and emit a refresh signal instead of full reset
      const teams = db.prepare("SELECT * FROM teams").all();
      const matches = db.prepare(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
      `).all();
      const submissions = db.prepare("SELECT * FROM submissions").all();
      const goals = db.prepare(`
        SELECT g.*, t.name as team_name 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `).all();
      
      io.emit("data_updated", { teams, matches, submissions, goals });
      res.json({ success: true });
    } catch (error) {
      console.error('Delete team error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/update-match", (req, res) => {
    const { match_id, score1, score2, status, start_time, pitch, umpire } = req.body;
    console.log(`Updating match ${match_id}:`, { score1, score2, status, start_time, pitch, umpire });
    try {
      const current = db.prepare("SELECT * FROM matches WHERE id = ?").get(match_id);
      if (!current) {
        console.error(`Match ${match_id} not found`);
        return res.status(404).json({ error: "Match not found" });
      }

      const result = db.prepare(`
        UPDATE matches 
        SET score1 = ?, score2 = ?, status = ?, start_time = ?, pitch = ?, umpire = ? 
        WHERE id = ?
      `).run(
        score1 !== undefined ? score1 : current.score1,
        score2 !== undefined ? score2 : current.score2,
        status !== undefined ? status : current.status,
        start_time !== undefined ? start_time : current.start_time,
        pitch !== undefined ? pitch : current.pitch,
        umpire !== undefined ? umpire : current.umpire,
        match_id
      );
      
      console.log(`Match ${match_id} updated successfully. Rows affected: ${result.changes}`);
      
      const updatedMatch = db.prepare(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `).get(match_id);
      
      if (updatedMatch) {
        io.emit("match_updated", updatedMatch);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/add-break", (req, res) => {
    const { tournament_type, start_time, pitch, stage } = req.body;
    try {
      const info = db.prepare("INSERT INTO matches (tournament_type, start_time, pitch, stage, status) VALUES (?, ?, ?, ?, 'completed')").run(tournament_type, start_time, pitch, stage);
      const newMatch = db.prepare(`
        SELECT m.*, NULL as team1_name, NULL as team2_name 
        FROM matches m
        WHERE m.id = ?
      `).get(info.lastInsertRowid);
      io.emit("match_added", newMatch);
      res.json(newMatch);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Reset everything (for testing)
  app.post("/api/reset", (req, res) => {
    db.exec("DELETE FROM submissions; DELETE FROM matches; DELETE FROM teams; DELETE FROM goals;");
    io.emit("data_reset");
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
