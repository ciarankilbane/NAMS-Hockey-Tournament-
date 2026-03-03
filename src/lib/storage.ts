import { Team, Match, Goal, Submission, AppData, TournamentType } from '../types';

const STORAGE_KEY = 'tournament_data';

const getInitialData = (): AppData & { goals: Goal[] } => ({
  teams: [],
  matches: [],
  submissions: [],
  goals: [],
});

export const storage = {
  getData: (): AppData & { goals: Goal[] } => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : getInitialData();
  },

  saveData: (data: AppData & { goals: Goal[] }) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  addTeam: (team: Omit<Team, 'id'>): Team => {
    const data = storage.getData();
    const newTeam = { ...team, id: Date.now() };
    data.teams.push(newTeam);
    storage.saveData(data);
    return newTeam;
  },

  deleteTeam: (id: number) => {
    const data = storage.getData();
    data.teams = data.teams.filter(t => t.id !== id);
    data.matches = data.matches.filter(m => m.team1_id !== id && m.team2_id !== id);
    data.submissions = data.submissions.filter(s => s.team_id !== id);
    data.goals = data.goals.filter(g => g.team_id !== id);
    storage.saveData(data);
  },

  addMatch: (match: Omit<Match, 'id' | 'score1' | 'score2' | 'status'>): Match => {
    const data = storage.getData();
    const newMatch: Match = {
      ...match,
      id: Date.now() + Math.random(),
      score1: 0,
      score2: 0,
      status: 'scheduled' as const
    };
    data.matches.push(newMatch);
    storage.saveData(data);
    return newMatch;
  },

  addMatches: (matches: Omit<Match, 'id' | 'score1' | 'score2' | 'status'>[]) => {
    const data = storage.getData();
    const newMatches = matches.map(m => ({
      ...m,
      id: Date.now() + Math.random(),
      score1: 0,
      score2: 0,
      status: 'scheduled' as const
    }));
    data.matches.push(...newMatches);
    storage.saveData(data);
  },

  updateMatch: (id: number, updates: Partial<Match>) => {
    const data = storage.getData();
    data.matches = data.matches.map(m => m.id === id ? { ...m, ...updates } : m);
    storage.saveData(data);
  },

  submitScore: (submission: Omit<Submission, 'id' | 'timestamp'> & { scorers: string[] }) => {
    const data = storage.getData();
    const { match_id, team_id, score1, score2, scorers } = submission;

    // Add or replace submission
    const existingIdx = data.submissions.findIndex(s => s.match_id === match_id && s.team_id === team_id);
    const newSubmission: Submission = {
      id: Date.now(),
      match_id,
      team_id,
      score1,
      score2,
      scorers: JSON.stringify(scorers),
      timestamp: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      data.submissions[existingIdx] = newSubmission;
    } else {
      data.submissions.push(newSubmission);
    }

    // Check for agreement
    const match = data.matches.find(m => m.id === match_id);
    if (match) {
      const otherTeamId = match.team1_id === team_id ? match.team2_id : match.team1_id;
      const otherSubmission = data.submissions.find(s => s.match_id === match_id && s.team_id === otherTeamId);

      if (otherSubmission) {
        if (otherSubmission.score1 === score1 && otherSubmission.score2 === score2) {
          match.score1 = score1;
          match.score2 = score2;
          match.status = 'completed';

          // Update goals
          data.goals = data.goals.filter(g => g.match_id !== match_id);
          const currentScorers = scorers.map(name => ({
            id: Date.now() + Math.random(),
            match_id,
            team_id,
            player_name: name
          }));
          const otherScorers = JSON.parse(otherSubmission.scorers || '[]').map((name: string) => ({
            id: Date.now() + Math.random(),
            match_id,
            team_id: otherTeamId,
            player_name: name
          }));
          data.goals.push(...currentScorers, ...otherScorers);
        } else {
          match.status = 'pending';
        }
      } else {
        match.status = 'pending';
      }
    }

    storage.saveData(data);
  },

  reset: () => {
    storage.saveData(getInitialData());
  }
};
