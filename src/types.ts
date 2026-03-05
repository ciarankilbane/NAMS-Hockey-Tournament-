export type TournamentType = 'chill' | 'competitive';

export interface Team {
  id: number;
  name: string;
  tournament_type: TournamentType;
  group_name?: string;
}

export interface Match {
  id: number;
  team1_id: number;
  team2_id: number;
  team1_name?: string;
  team2_name?: string;
  score1: number;
  score2: number;
  status: 'scheduled' | 'pending' | 'completed';
  tournament_type: TournamentType;
  match_date?: string;
  start_time: string;
  pitch?: string;
  umpire?: string;
  stage: string; // Using string to allow flexible stages like 'play-off-8v9', 'quarter-final', etc.
}

export interface Goal {
  id: number;
  match_id: number;
  team_id: number;
  player_name: string;
  team_name?: string;
  tournament_type?: TournamentType;
}

export interface Submission {
  id: number;
  match_id: number;
  team_id: number;
  score1: number;
  score2: number;
  scorers?: string; // JSON string
  timestamp: string;
}

export interface AppData {
  teams: Team[];
  matches: Match[];
  submissions: Submission[];
  goals: Goal[];
}
