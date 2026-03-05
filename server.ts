import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
const DATABASE_URL = process.env.DATABASE_URL;

// Database Abstraction
interface DB {
  all: (sql: string, params?: any[]) => Promise<any[]>;
  get: (sql: string, params?: any[]) => Promise<any>;
  run: (sql: string, params?: any[]) => Promise<{ lastInsertRowid?: number | string; changes?: number }>;
  exec: (sql: string) => Promise<void>;
}

let db: DB;

if (DATABASE_URL) {
  console.log("Using PostgreSQL database");
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  db = {
    all: async (sql, params) => {
      const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
      return res.rows;
    },
    get: async (sql, params) => {
      const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
      return res.rows[0];
    },
    run: async (sql, params) => {
      // Handle SQLite specific syntax if any, but mostly we'll use standard SQL
      let query = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      if (query.toLowerCase().includes("insert into")) {
        query += " RETURNING id";
      }
      const res = await pool.query(query, params);
      return { 
        lastInsertRowid: res.rows[0]?.id,
        changes: res.rowCount || 0
      };
    },
    exec: async (sql) => {
      await pool.query(sql);
    }
  };
} else {
  console.log("Using SQLite database");
  const sqlite = new Database("tournament.db");
  db = {
    all: async (sql, params) => sqlite.prepare(sql).all(params || []),
    get: async (sql, params) => sqlite.prepare(sql).get(params || []),
    run: async (sql, params) => {
      const info = sqlite.prepare(sql).run(params || []);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
    exec: async (sql) => { sqlite.exec(sql); }
  };
}

// Initialize Database
async function initDb() {
  const schema = `
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tournament_type TEXT NOT NULL,
      group_name TEXT
    );

    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      team1_id INTEGER REFERENCES teams(id),
      team2_id INTEGER REFERENCES teams(id),
      score1 INTEGER DEFAULT 0,
      score2 INTEGER DEFAULT 0,
      status TEXT DEFAULT 'scheduled',
      tournament_type TEXT NOT NULL,
      match_date TEXT,
      start_time TEXT,
      pitch TEXT,
      umpire TEXT,
      stage TEXT DEFAULT 'round-robin'
    );

    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,
      match_id INTEGER REFERENCES matches(id),
      team_id INTEGER REFERENCES teams(id),
      player_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      match_id INTEGER REFERENCES matches(id),
      team_id INTEGER REFERENCES teams(id),
      score1 INTEGER,
      score2 INTEGER,
      scorers TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id, team_id)
    );
  `;

  // SQLite specific adjustments for initialization if needed
  if (!DATABASE_URL) {
    const sqliteSchema = schema
      .replace(/SERIAL PRIMARY KEY/g, "INTEGER PRIMARY KEY AUTOINCREMENT")
      .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, "DATETIME DEFAULT CURRENT_TIMESTAMP")
      .replace(/REFERENCES teams\(id\)/g, ""); // SQLite handles FKs differently in CREATE
    await db.exec(sqliteSchema);
  } else {
    await db.exec(schema);
  }

  // Migrations
  try { await db.run("ALTER TABLE teams ADD COLUMN group_name TEXT"); } catch (e) {}
  try { await db.run("ALTER TABLE matches ADD COLUMN match_date TEXT"); } catch (e) {}
  try { await db.run("ALTER TABLE matches ADD COLUMN umpire TEXT"); } catch (e) {}
}

async function startServer() {
  await initDb();
  
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  app.use(express.json());

  // API Routes
  app.get("/api/data", async (req, res) => {
    try {
      const teams = await db.all("SELECT * FROM teams");
      const matches = await db.all(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
      `);
      const submissions = await db.all("SELECT * FROM submissions");
      const goals = await db.all(`
        SELECT g.*, t.name as team_name 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      res.json({ teams, matches, submissions, goals });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/teams", async (req, res) => {
    const { name, tournament_type, group_name } = req.body;
    const info = await db.run("INSERT INTO teams (name, tournament_type, group_name) VALUES (?, ?, ?)", [name, tournament_type, group_name]);
    const newTeam = { id: info.lastInsertRowid, name, tournament_type, group_name };
    io.emit("team_added", newTeam);
    res.json(newTeam);
  });

  app.post("/api/matches", async (req, res) => {
    const { team1_id, team2_id, tournament_type, match_date, start_time, stage } = req.body;
    
    const existing = await db.get(`
      SELECT id FROM matches 
      WHERE ((team1_id = ? AND team2_id = ?) OR (team1_id = ? AND team2_id = ?))
      AND tournament_type = ? AND stage = ?
    `, [team1_id, team2_id, team2_id, team1_id, tournament_type, stage]);

    if (existing) {
      const match = await db.get(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `, [existing.id]);
      return res.json(match);
    }

    const info = await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, match_date, start_time, stage) VALUES (?, ?, ?, ?, ?, ?)", [team1_id, team2_id, tournament_type, match_date, start_time, stage]);
    const newMatch = await db.get(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      WHERE m.id = ?
    `, [info.lastInsertRowid]);
    io.emit("match_added", newMatch);
    res.json(newMatch);
  });

  app.post("/api/submit-score", async (req, res) => {
    const { match_id, team_id, score1, score2, scorers } = req.body;
    
    try {
      if (DATABASE_URL) {
        await db.run(`
          INSERT INTO submissions (match_id, team_id, score1, score2, scorers) 
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (match_id, team_id) 
          DO UPDATE SET score1 = EXCLUDED.score1, score2 = EXCLUDED.score2, scorers = EXCLUDED.scorers
        `, [match_id, team_id, score1, score2, JSON.stringify(scorers)]);
      } else {
        await db.run("INSERT OR REPLACE INTO submissions (match_id, team_id, score1, score2, scorers) VALUES (?, ?, ?, ?, ?)", [match_id, team_id, score1, score2, JSON.stringify(scorers)]);
      }
      
      const match = await db.get("SELECT * FROM matches WHERE id = ?", [match_id]);
      const otherTeamId = match.team1_id === team_id ? match.team2_id : match.team1_id;
      
      const otherSubmission = await db.get("SELECT * FROM submissions WHERE match_id = ? AND team_id = ?", [match_id, otherTeamId]);
      
      if (otherSubmission) {
        if (otherSubmission.score1 === score1 && otherSubmission.score2 === score2) {
          await db.run("UPDATE matches SET score1 = ?, score2 = ?, status = 'completed' WHERE id = ?", [score1, score2, match_id]);
          
          await db.run("DELETE FROM goals WHERE match_id = ?", [match_id]);
          const otherScorers = typeof otherSubmission.scorers === 'string' ? JSON.parse(otherSubmission.scorers) : otherSubmission.scorers;
          const allScorers = [...scorers, ...otherScorers];
          
          for (const name of scorers) {
            await db.run("INSERT INTO goals (match_id, team_id, player_name) VALUES (?, ?, ?)", [match_id, team_id, name]);
          }
          for (const name of otherScorers) {
            await db.run("INSERT INTO goals (match_id, team_id, player_name) VALUES (?, ?, ?)", [match_id, otherTeamId, name]);
          }

          io.emit("match_updated", { id: match_id, score1, score2, status: 'completed' });
          
          const goals = await db.all(`
            SELECT g.*, t.name as team_name 
            FROM goals g
            JOIN teams t ON g.team_id = t.id
          `);
          io.emit("goals_updated", goals);
        } else {
          await db.run("UPDATE matches SET status = 'pending' WHERE id = ?", [match_id]);
          io.emit("match_updated", { id: match_id, status: 'pending' });
        }
      } else {
        await db.run("UPDATE matches SET status = 'pending' WHERE id = ?", [match_id]);
        io.emit("match_updated", { id: match_id, status: 'pending' });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/generate-knockouts", async (req, res) => {
    const { tournament_type, teams } = req.body;
    if (teams.length < 2) return res.status(400).json({ error: "Need more teams" });

    if (tournament_type === 'competitive') {
      if (teams.length >= 9) {
        await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[7].id, teams[8].id, tournament_type, 'play-off-8v9']);
      }
      await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[0].id, null, tournament_type, 'quarter-final']);
      await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[1].id, teams[6].id, tournament_type, 'quarter-final']);
      await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[2].id, teams[5].id, tournament_type, 'quarter-final']);
      await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[3].id, teams[4].id, tournament_type, 'quarter-final']);
    } else if (tournament_type === 'chill') {
      if (teams.length >= 4) {
        await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[0].id, teams[3].id, tournament_type, 'semi-final']);
        await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[1].id, teams[2].id, tournament_type, 'semi-final']);
      }
    }

    const newMatches = await db.all(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m 
      LEFT JOIN teams t1 ON m.team1_id = t1.id 
      LEFT JOIN teams t2 ON m.team2_id = t2.id 
      WHERE m.tournament_type = ? AND (m.stage LIKE '%final%' OR m.stage LIKE '%play-off%')
      AND m.status = 'scheduled'
    `, [tournament_type]);
    
    newMatches.forEach(m => io.emit("match_added", m));
    res.json(newMatches);
  });

  app.post("/api/generate-next-stage", async (req, res) => {
    const { tournament_type, stage, teams } = req.body;
    if (teams.length < 2) return res.status(400).json({ error: "Need at least 2 teams" });

    const matchCount = Math.floor(teams.length / 2);
    for (let i = 0; i < matchCount; i++) {
      await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[i*2].id, teams[i*2+1].id, tournament_type, stage]);
    }

    if (stage === 'final' && teams.length >= 4) {
       await db.run("INSERT INTO matches (team1_id, team2_id, tournament_type, stage) VALUES (?, ?, ?, ?)", [teams[2].id, teams[3].id, tournament_type, '3rd-4th-play-off']);
    }

    const newMatches = await db.all(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name 
      FROM matches m 
      LEFT JOIN teams t1 ON m.team1_id = t1.id 
      LEFT JOIN teams t2 ON m.team2_id = t2.id 
      WHERE m.tournament_type = ? AND m.stage = ?
      AND m.status = 'scheduled'
    `, [tournament_type, stage]);
    
    newMatches.forEach(m => io.emit("match_added", m));
    res.json(newMatches);
  });

  app.post("/api/admin/force-approve", async (req, res) => {
    const { submission_id } = req.body;
    try {
      const submission = await db.get("SELECT * FROM submissions WHERE id = ?", [submission_id]);
      if (!submission) return res.status(404).json({ error: "Submission not found" });

      await db.run("UPDATE matches SET score1 = ?, score2 = ?, status = 'completed' WHERE id = ?", [submission.score1, submission.score2, submission.match_id]);
      
      const updatedMatch = await db.get(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `, [submission.match_id]);

      io.emit("match_updated", updatedMatch);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/teams/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await db.run("DELETE FROM submissions WHERE match_id IN (SELECT id FROM matches WHERE team1_id = ? OR team2_id = ?)", [id, id]);
      await db.run("DELETE FROM matches WHERE team1_id = ? OR team2_id = ?", [id, id]);
      await db.run("DELETE FROM teams WHERE id = ?", [id]);
      
      const teams = await db.all("SELECT * FROM teams");
      const matches = await db.all(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
      `);
      const submissions = await db.all("SELECT * FROM submissions");
      const goals = await db.all(`
        SELECT g.*, t.name as team_name 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      
      io.emit("data_updated", { teams, matches, submissions, goals });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/matches/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await db.run("DELETE FROM goals WHERE match_id = ?", [id]);
      await db.run("DELETE FROM submissions WHERE match_id = ?", [id]);
      await db.run("DELETE FROM matches WHERE id = ?", [id]);
      
      const teams = await db.all("SELECT * FROM teams");
      const matches = await db.all(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
      `);
      const submissions = await db.all("SELECT * FROM submissions");
      const goals = await db.all(`
        SELECT g.*, t.name as team_name, t.tournament_type 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      
      io.emit("data_updated", { teams, matches, submissions, goals });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/update-goal", async (req, res) => {
    const { id, player_name } = req.body;
    try {
      await db.run("UPDATE goals SET player_name = ? WHERE id = ?", [player_name, id]);
      const goals = await db.all(`
        SELECT g.*, t.name as team_name, t.tournament_type 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      io.emit("goals_updated", goals);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/goals/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await db.run("DELETE FROM goals WHERE id = ?", [id]);
      const goals = await db.all(`
        SELECT g.*, t.name as team_name, t.tournament_type 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      io.emit("goals_updated", goals);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/add-goal", async (req, res) => {
    const { match_id, team_id, player_name } = req.body;
    try {
      await db.run("INSERT INTO goals (match_id, team_id, player_name) VALUES (?, ?, ?)", [match_id, team_id, player_name]);
      const goals = await db.all(`
        SELECT g.*, t.name as team_name, t.tournament_type 
        FROM goals g
        JOIN teams t ON g.team_id = t.id
      `);
      io.emit("goals_updated", goals);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/update-match", async (req, res) => {
    const { match_id, score1, score2, status, match_date, start_time, pitch, umpire } = req.body;
    try {
      const current = await db.get("SELECT * FROM matches WHERE id = ?", [match_id]);
      if (!current) return res.status(404).json({ error: "Match not found" });

      await db.run(`
        UPDATE matches 
        SET score1 = ?, score2 = ?, status = ?, match_date = ?, start_time = ?, pitch = ?, umpire = ? 
        WHERE id = ?
      `, [
        score1 !== undefined ? score1 : current.score1,
        score2 !== undefined ? score2 : current.score2,
        status !== undefined ? status : current.status,
        match_date !== undefined ? match_date : current.match_date,
        start_time !== undefined ? start_time : current.start_time,
        pitch !== undefined ? pitch : current.pitch,
        umpire !== undefined ? umpire : current.umpire,
        match_id
      ]);
      
      const updatedMatch = await db.get(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name 
        FROM matches m
        LEFT JOIN teams t1 ON m.team1_id = t1.id
        LEFT JOIN teams t2 ON m.team2_id = t2.id
        WHERE m.id = ?
      `, [match_id]);
      
      if (updatedMatch) {
        io.emit("match_updated", updatedMatch);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/add-break", async (req, res) => {
    const { tournament_type, match_date, start_time, pitch, stage } = req.body;
    try {
      const info = await db.run("INSERT INTO matches (tournament_type, match_date, start_time, pitch, stage, status) VALUES (?, ?, ?, ?, ?, 'completed')", [tournament_type, match_date, start_time, pitch, stage]);
      const newMatch = await db.get(`
        SELECT m.*, NULL as team1_name, NULL as team2_name 
        FROM matches m
        WHERE m.id = ?
      `, [info.lastInsertRowid]);
      io.emit("match_added", newMatch);
      res.json(newMatch);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reset", async (req, res) => {
    await db.exec("DELETE FROM submissions; DELETE FROM matches; DELETE FROM teams; DELETE FROM goals;");
    io.emit("data_reset");
    res.json({ success: true });
  });

  // Serve static files in production
  if (isProd) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
