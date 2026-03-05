import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Users, Calendar, Settings, ShieldCheck, AlertCircle, CheckCircle2, Clock, ChevronRight, Plus, Trash2, RefreshCw, Search, Edit2, X, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { socket } from './lib/socket';
import { storage } from './lib/storage';
import type { Team, Match, Submission, AppData, TournamentType, Goal } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'live' | 'umpire' | 'report' | 'admin'>('dashboard');
  const [tournamentType, setTournamentType] = useState<TournamentType>('competitive');
  const [data, setData] = useState<AppData & { goals: Goal[] }>({ teams: [], matches: [], submissions: [], goals: [] });
  const [loading, setLoading] = useState(true);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthError, setAdminAuthError] = useState(false);
  const [isCaptainAuthenticated, setIsCaptainAuthenticated] = useState(false);
  const [captainPassword, setCaptainPassword] = useState('');
  const [captainAuthError, setCaptainAuthError] = useState(false);
  const [umpireName, setUmpireName] = useState('');
  const [isUmpireAuthenticated, setIsUmpireAuthenticated] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [favorites, setFavorites] = useState<number[]>(() => {
    const saved = localStorage.getItem('nams_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [captainTeamId, setCaptainTeamId] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem('nams_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (teamId: number) => {
    setFavorites(prev => 
      prev.includes(teamId) ? prev.filter(id => id !== teamId) : [...prev, teamId]
    );
  };

  useEffect(() => {
    fetchData();

    socket.on('connect', () => {
      console.log('Connected to server');
      setIsConnecting(false);
      setIsLocalMode(false);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    socket.on('connect_error', () => {
      console.warn('Socket connection error');
      setIsConnecting(false);
    });

    socket.on('team_added', (newTeam: Team) => {
      setData(prev => ({ ...prev, teams: [...prev.teams, newTeam] }));
    });

    socket.on('match_added', (newMatch: Match) => {
      setData(prev => ({ ...prev, matches: [...prev.matches, newMatch] }));
    });

    socket.on('match_updated', (updatedMatch: Partial<Match>) => {
      setData(prev => ({
        ...prev,
        matches: prev.matches.map(m => m.id === updatedMatch.id ? { ...m, ...updatedMatch } : m)
      }));
    });

    socket.on('goals_updated', (newGoals: Goal[]) => {
      setData(prev => ({ ...prev, goals: newGoals }));
    });

    socket.on('data_updated', (newData: AppData & { goals: Goal[] }) => {
      setData(newData);
    });

    socket.on('data_reset', () => {
      setData({ teams: [], matches: [], submissions: [], goals: [] });
    });

    return () => {
      socket.off('team_added');
      socket.off('match_added');
      socket.off('match_updated');
      socket.off('goals_updated');
      socket.off('data_updated');
      socket.off('data_reset');
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setIsConnecting(true);
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error('API not available');
      const json = await res.json();
      setData(json);
      setIsLocalMode(false);
    } catch (err) {
      console.warn('Backend server not found or sleeping. Checking local storage.');
      setIsLocalMode(true);
      setData(storage.getData());
    } finally {
      setLoading(false);
      setIsConnecting(false);
    }
  };

  const filteredTeams = useMemo(() => 
    data.teams.filter(t => t.tournament_type === tournamentType),
    [data.teams, tournamentType]
  );

  const filteredMatches = useMemo(() => 
    data.matches.filter(m => m.tournament_type === tournamentType),
    [data.matches, tournamentType]
  );

  const standings = useMemo(() => {
    const groupStats: Record<string, Record<number, { name: string, played: number, won: number, drawn: number, lost: number, gf: number, ga: number, pts: number, group: string, id: number }>> = {};
    
    filteredTeams.forEach(team => {
      const g = team.group_name || 'Unassigned';
      if (!groupStats[g]) groupStats[g] = {};
      groupStats[g][team.id] = { name: team.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0, group: g, id: team.id };
    });

    filteredMatches.filter(m => m.status === 'completed' && m.stage === 'round-robin').forEach(match => {
      // Find which group this match belongs to (assuming both teams are in the same group)
      const team1 = data.teams.find(t => t.id === match.team1_id);
      if (!team1) return;
      const g = team1.group_name || 'Unassigned';
      
      const t1 = groupStats[g]?.[match.team1_id];
      const t2 = groupStats[g]?.[match.team2_id];
      if (!t1 || !t2) return;

      t1.played++;
      t2.played++;
      t1.gf += match.score1;
      t1.ga += match.score2;
      t2.gf += match.score2;
      t2.ga += match.score1;

      if (match.score1 > match.score2) {
        t1.won++;
        t1.pts += 3;
        t2.lost++;
      } else if (match.score1 < match.score2) {
        t2.won++;
        t2.pts += 3;
        t1.lost++;
      } else {
        t1.drawn++;
        t2.drawn++;
        t1.pts += 1;
        t2.pts += 1;
      }
    });

    const result: Record<string, any[]> = {};
    Object.keys(groupStats).sort().forEach(g => {
      result[g] = Object.values(groupStats[g]).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    });
    return result;
  }, [filteredTeams, filteredMatches, data.teams]);

  const bestSecondPlace = useMemo(() => {
    if (tournamentType !== 'chill') return null;
    const seconds = Object.values(standings).map(group => group[1]).filter(Boolean);
    return seconds.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)[0] || null;
  }, [standings, tournamentType]);

  const sortedMatches = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      const aFav = favorites.includes(a.team1_id) || favorites.includes(a.team2_id);
      const bFav = favorites.includes(b.team1_id) || favorites.includes(b.team2_id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return (a.match_date || '').localeCompare(b.match_date || '') || (a.start_time || '').localeCompare(b.start_time || '');
    });
  }, [filteredMatches, favorites]);

  const venueInfo = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    // For testing/demo purposes, if it's not the 7th or 8th, we'll show based on the first match date found
    const matchDates = Array.from(new Set(data.matches.map(m => m.match_date).filter(Boolean))).sort();
    const activeDate = matchDates.includes(today) ? today : matchDates[0] || today;

    if (activeDate === '2026-03-07') return { name: 'Badminton School', pitches: ['1', '2'] };
    if (activeDate === '2026-03-08') return { name: 'Coombe Dingle Sports Ground', pitches: ['1', '2', '3', '4'] };
    return { name: 'Tournament Venue', pitches: ['1', '2'] };
  }, [data.matches]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 text-maroon-600 animate-spin" />
          <p className="text-stone-500 font-medium">Loading tournament data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Header */}
      <header className="bg-black border-b border-maroon-900 sticky top-0 z-30">
        {isLocalMode && (
          <div className="bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest py-1 px-4 text-center">
            Local Storage Mode: Data is saved only on this device. Use Render.com for a shared tournament app.
          </div>
        )}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-maroon-700 p-2 rounded-lg">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-white">NAMS Hockey Tournament</h1>
                  {isConnecting ? (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-maroon-900/50 rounded-full border border-maroon-700/50">
                      <RefreshCw className="w-2.5 h-2.5 text-maroon-400 animate-spin" />
                      <span className="text-[10px] font-bold text-maroon-400 uppercase tracking-tighter">Waking up...</span>
                    </div>
                  ) : !isLocalMode ? (
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-900/30 rounded-full border border-emerald-700/30">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tighter">Live</span>
                    </div>
                  ) : null}
                </div>
                <p className="text-xs text-maroon-300 font-medium uppercase tracking-wider">Bristol Medics Hockey</p>
              </div>
            </div>
            
            <nav className="hidden md:flex items-center gap-1">
              <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Calendar className="w-4 h-4" />} label="Dashboard" />
              <TabButton active={activeTab === 'live'} onClick={() => setActiveTab('live')} icon={<Clock className="w-4 h-4" />} label="Live" />
              <TabButton active={activeTab === 'umpire'} onClick={() => setActiveTab('umpire')} icon={<Users className="w-4 h-4" />} label="Umpire" />
              <TabButton active={activeTab === 'report'} onClick={() => setActiveTab('report')} icon={<ShieldCheck className="w-4 h-4" />} label="Report Score" />
              <TabButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} icon={<Settings className="w-4 h-4" />} label="Admin" />
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tournament Switcher */}
        {(activeTab === 'dashboard' || activeTab === 'admin') && (
          <div className="flex justify-center mb-8">
            <div className="bg-stone-200 p-1 rounded-xl flex gap-1">
              <button 
                onClick={() => setTournamentType('competitive')}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-semibold transition-all",
                  tournamentType === 'competitive' ? "bg-maroon-700 text-white shadow-sm" : "text-stone-600 hover:text-stone-900"
                )}
              >
                Competitive
              </button>
              <button 
                onClick={() => setTournamentType('chill')}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-semibold transition-all",
                  tournamentType === 'chill' ? "bg-maroon-700 text-white shadow-sm" : "text-stone-600 hover:text-stone-900"
                )}
              >
                Chill
              </button>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'umpire' && (
            <motion.div 
              key="umpire"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto"
            >
              {!isUmpireAuthenticated ? (
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Users className="w-6 h-6 text-maroon-700" />
                    Umpire Portal
                  </h2>
                  <div className="space-y-4">
                    <p className="text-sm text-stone-500 mb-4">Enter your name to see your assigned matches.</p>
                    <input 
                      type="text" 
                      placeholder="Your Full Name"
                      value={umpireName}
                      onChange={(e) => setUmpireName(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
                    />
                    <button 
                      onClick={() => {
                        if (umpireName.trim()) {
                          setIsUmpireAuthenticated(true);
                        }
                      }}
                      className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all"
                    >
                      View My Matches
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Users className="w-6 h-6 text-maroon-700" />
                      Matches for {umpireName}
                    </h2>
                    <button 
                      onClick={() => setIsUmpireAuthenticated(false)}
                      className="text-sm text-maroon-700 font-bold hover:underline"
                    >
                      Logout
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {data.matches
                      .filter(m => m.umpire?.toLowerCase() === umpireName.toLowerCase())
                      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
                      .map(match => (
                        <MatchCard key={match.id} match={match} />
                      ))}
                    {data.matches.filter(m => m.umpire?.toLowerCase() === umpireName.toLowerCase()).length === 0 && (
                      <div className="bg-white p-12 rounded-2xl border border-stone-200 text-center">
                        <p className="text-stone-500">No matches assigned to you yet.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'live' && (
            <motion.div 
              key="live"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <LiveDashboard matches={data.matches} />
              {data.matches.filter(m => m.start_time && m.status !== 'completed' && m.team1_id).length === 0 && (
                <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
                  <Clock className="w-12 h-12 text-stone-200 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-stone-800">No Live or Upcoming Matches</h3>
                  <p className="text-stone-500 max-w-xs mx-auto mt-2">Check the dashboard schedule for full timings.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Standings & Schedule */}
              <div className="lg:col-span-2 space-y-6">
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                    <h2 className="font-bold flex items-center gap-2">
                      <Users className="w-5 h-5 text-maroon-700" />
                      Standings
                    </h2>
                    {tournamentType === 'chill' && bestSecondPlace && (
                      <span className="text-[10px] font-bold bg-maroon-50 text-maroon-700 px-2 py-1 rounded border border-maroon-100">
                        Best 2nd: {bestSecondPlace.name}
                      </span>
                    )}
                  </div>
          <div className="divide-y divide-stone-100">
            {(Object.entries(standings) as [string, any[]][]).map(([groupName, teams]) => (
              <div key={groupName} className="pb-4">
                <div className="bg-stone-50 px-6 py-2 text-[10px] font-black uppercase tracking-widest text-stone-400">
                  Group {groupName}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="text-stone-500 text-[10px] font-bold uppercase tracking-wider">
                        <th className="px-6 py-2">Pos</th>
                        <th className="px-6 py-2">Team</th>
                        <th className="px-6 py-2 text-center">P</th>
                        <th className="px-6 py-2 text-center">W</th>
                        <th className="px-6 py-2 text-center">D</th>
                        <th className="px-6 py-2 text-center">L</th>
                        <th className="px-6 py-2 text-center">Pts</th>
                        <th className="px-6 py-2 text-center">GD</th>
                        <th className="px-6 py-2 text-center">Fav</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {teams.map((team, idx) => (
                        <tr key={team.name} className="hover:bg-stone-50 transition-colors">
                          <td className="px-6 py-3 font-mono text-xs text-stone-400">{idx + 1}</td>
                          <td className="px-6 py-3 font-bold text-stone-800 text-sm">{team.name}</td>
                          <td className="px-6 py-3 text-center text-xs">{team.played}</td>
                          <td className="px-6 py-3 text-center text-xs">{team.won}</td>
                          <td className="px-6 py-3 text-center text-xs">{team.drawn}</td>
                          <td className="px-6 py-3 text-center text-xs">{team.lost}</td>
                          <td className="px-6 py-3 text-center font-bold text-maroon-800 text-sm">{team.pts}</td>
                          <td className="px-6 py-3 text-center text-xs font-medium text-stone-600">{(team.gf - team.ga) > 0 ? `+${team.gf - team.ga}` : team.gf - team.ga}</td>
                          <td className="px-6 py-3 text-center">
                            <button 
                              onClick={() => toggleFavorite(team.id)}
                              className={cn(
                                "p-1 rounded-full transition-all",
                                favorites.includes(team.id) ? "text-amber-500" : "text-stone-300 hover:text-stone-400"
                              )}
                            >
                              <Trophy className={cn("w-4 h-4", favorites.includes(team.id) ? "fill-current" : "")} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
                    {Object.keys(standings).length === 0 && (
                      <div className="px-6 py-12 text-center text-stone-400 italic">No teams added yet</div>
                    )}
                  </div>
                </section>

                {/* Schedule */}
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-100">
                    <h2 className="font-bold flex items-center gap-2">
                      <Clock className="w-5 h-5 text-maroon-700" />
                      Full Schedule
                    </h2>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[800px] overflow-y-auto">
                    {sortedMatches.map(match => (
                      <MatchCard key={match.id} match={match} isFavorite={favorites.includes(match.team1_id) || favorites.includes(match.team2_id)} />
                    ))}
                    {sortedMatches.length === 0 && (
                      <div className="col-span-2 py-12 text-center text-stone-400 italic">No matches scheduled</div>
                    )}
                  </div>
                </section>
              </div>

              {/* Knockout Stages */}
              <div className="space-y-6">
                {tournamentType === 'competitive' && (
                  <>
                    <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                      <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900">
                        <Trophy className="w-4 h-4 text-maroon-600" />
                        8v9 Play-off
                      </h3>
                      <div className="space-y-3">
                        {filteredMatches.filter(m => m.stage === 'play-off-8v9').map(match => (
                          <MatchCard key={match.id} match={match} />
                        ))}
                        {filteredMatches.filter(m => m.stage === 'play-off-8v9').length === 0 && (
                          <p className="text-sm text-stone-400 italic">To be determined...</p>
                        )}
                      </div>
                    </section>
                    <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                      <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900">
                        <Trophy className="w-4 h-4 text-maroon-600" />
                        Quarter-Finals
                      </h3>
                      <div className="space-y-3">
                        {filteredMatches.filter(m => m.stage === 'quarter-final').map(match => (
                          <MatchCard key={match.id} match={match} />
                        ))}
                        {filteredMatches.filter(m => m.stage === 'quarter-final').length === 0 && (
                          <p className="text-sm text-stone-400 italic">To be determined...</p>
                        )}
                      </div>
                    </section>
                  </>
                )}
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900">
                    <Trophy className="w-4 h-4 text-maroon-600" />
                    Semi-Finals
                  </h3>
                  <div className="space-y-3">
                    {filteredMatches.filter(m => m.stage === 'semi-final').map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    {filteredMatches.filter(m => m.stage === 'semi-final').length === 0 && (
                      <p className="text-sm text-stone-400 italic">To be determined...</p>
                    )}
                  </div>
                </section>
                <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900">
                    <Trophy className="w-4 h-4 text-black" />
                    Final & 3rd Place
                  </h3>
                  <div className="space-y-3">
                    {filteredMatches.filter(m => m.stage === 'final' || m.stage === '3rd-4th-play-off').map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    {filteredMatches.filter(m => m.stage === 'final' || m.stage === '3rd-4th-play-off').length === 0 && (
                      <p className="text-sm text-stone-400 italic">To be determined...</p>
                    )}
                  </div>
                </section>
              </div>

              {/* Top Scorers - Full Width at Bottom */}
              <div className="lg:col-span-3">
                <TopScorers goals={data.goals} />
              </div>
            </div>
          </motion.div>
          )}

          {activeTab === 'report' && (
            <motion.div 
              key="report"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto"
            >
              {!isCaptainAuthenticated ? (
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-maroon-700" />
                    Captain Login
                  </h2>
                  <div className="space-y-4">
                    <input 
                      type="password" 
                      placeholder="Enter Captain Password"
                      value={captainPassword}
                      onChange={(e) => {
                        setCaptainPassword(e.target.value);
                        setCaptainAuthError(false);
                      }}
                      className={cn(
                        "w-full bg-stone-50 border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all",
                        captainAuthError ? "border-red-500 bg-red-50" : "border-stone-200"
                      )}
                    />
                    {captainAuthError && <p className="text-xs text-red-600 font-bold">Incorrect password. Please try again.</p>}
                    <button 
                      onClick={() => {
                        if (captainPassword === 'Captains') {
                          setIsCaptainAuthenticated(true);
                        } else {
                          setCaptainAuthError(true);
                        }
                      }}
                      className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all"
                    >
                      Login
                    </button>
                  </div>
                </div>
              ) : (
                <ScoreReporter teams={data.teams} matches={data.matches} isLocalMode={isLocalMode} onRefresh={fetchData} />
              )}
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {!isAdminAuthenticated ? (
                <div className="max-w-md mx-auto bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-maroon-700" />
                    Admin Login
                  </h2>
                  <div className="space-y-4">
                    <input 
                      type="password" 
                      placeholder="Enter Password"
                      value={adminPassword}
                      onChange={(e) => {
                        setAdminPassword(e.target.value);
                        setAdminAuthError(false);
                      }}
                      className={cn(
                        "w-full bg-stone-50 border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all",
                        adminAuthError ? "border-red-500 bg-red-50" : "border-stone-200"
                      )}
                    />
                    {adminAuthError && <p className="text-xs text-red-600 font-bold">Incorrect password. Please try again.</p>}
                    <button 
                      onClick={() => {
                        if (adminPassword === 'Tinothedino') {
                          setIsAdminAuthenticated(true);
                        } else {
                          setAdminAuthError(true);
                        }
                      }}
                      className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all"
                    >
                      Login
                    </button>
                  </div>
                </div>
              ) : (
                <AdminPanel 
                  teams={data.teams} 
                  matches={data.matches} 
                  tournamentType={tournamentType} 
                  standings={standings}
                  bestSecondPlace={bestSecondPlace}
                  submissions={data.submissions}
                  goals={data.goals}
                  onRefresh={fetchData}
                  isLocalMode={isLocalMode}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black border-t border-maroon-900 px-4 py-2 flex justify-around items-center z-40">
        <MobileTabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Calendar className="w-5 h-5" />} label="Dashboard" />
        <MobileTabButton active={activeTab === 'live'} onClick={() => setActiveTab('live')} icon={<Clock className="w-5 h-5" />} label="Live" />
        <MobileTabButton active={activeTab === 'umpire'} onClick={() => setActiveTab('umpire')} icon={<Users className="w-5 h-5" />} label="Umpire" />
        <MobileTabButton active={activeTab === 'report'} onClick={() => setActiveTab('report')} icon={<ShieldCheck className="w-5 h-5" />} label="Report" />
        <MobileTabButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} icon={<Settings className="w-5 h-5" />} label="Admin" />
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
        active ? "bg-maroon-900 text-white" : "text-maroon-300 hover:bg-maroon-800 hover:text-white"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileTabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-all",
        active ? "text-white bg-maroon-900" : "text-maroon-400"
      )}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

const MatchCard: React.FC<{ match: Match, isFavorite?: boolean }> = ({ match, isFavorite }) => {
  const isBreak = !match.team1_id && !match.team2_id && match.stage === 'break';
  const team1Display = match.team1_name || (match.team1_id === 0 ? 'TBD' : 'Unknown');
  const team2Display = match.team2_name || (match.team2_id === 0 ? 'TBD' : 'Unknown');

  return (
    <div className={cn(
      "p-4 rounded-xl border transition-all relative overflow-hidden",
      isBreak ? "bg-stone-100 border-stone-300 border-dashed" :
      match.status === 'completed' ? "bg-stone-50 border-stone-100" : 
      match.status === 'pending' ? "bg-maroon-50 border-maroon-200" : "bg-white border-stone-200",
      isFavorite && !isBreak && "ring-2 ring-amber-400 ring-inset"
    )}>
      {isFavorite && !isBreak && (
        <div className="absolute top-0 right-0 p-1">
          <Trophy className="w-3 h-3 text-amber-500 fill-current" />
        </div>
      )}
      <div className="flex justify-between items-center mb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
              {match.stage.replace('-', ' ')}
            </span>
            {!isBreak && (
              <span className={cn(
                "text-[8px] font-black uppercase px-1.5 py-0.5 rounded border",
                match.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200"
              )}>
                {match.tournament_type}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold text-maroon-700 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {match.match_date ? `${match.match_date.slice(5)} ${match.start_time}` : match.start_time || 'TBD'}
            </span>
            {match.pitch && (
              <span className="text-[10px] font-bold text-stone-500 flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                Pitch {match.pitch}
              </span>
            )}
            {match.umpire && (
              <span className="text-[10px] font-medium text-stone-400 flex items-center gap-1 border-l border-stone-200 pl-2">
                Umpire: {match.umpire}
              </span>
            )}
          </div>
        </div>
        {!isBreak && match.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-maroon-600" />}
        {!isBreak && match.status === 'pending' && <AlertCircle className="w-3 h-3 text-maroon-500" />}
      </div>
      {isBreak ? (
        <div className="flex items-center justify-center py-2">
          <span className="text-sm font-black text-stone-400 uppercase tracking-widest">{match.stage}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 flex flex-col items-center text-center">
            <span className="text-sm font-bold text-stone-800 line-clamp-1">{team1Display}</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-1 bg-stone-100 rounded-lg">
            <span className={cn("text-lg font-black", match.status === 'completed' ? "text-stone-900" : "text-stone-300")}>
              {match.status === 'completed' ? match.score1 : '-'}
            </span>
            <span className="text-stone-300 font-bold">:</span>
            <span className={cn("text-lg font-black", match.status === 'completed' ? "text-stone-900" : "text-stone-300")}>
              {match.status === 'completed' ? match.score2 : '-'}
            </span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center">
            <span className="text-sm font-bold text-stone-800 line-clamp-1">{team2Display}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveDashboard({ matches }: { matches: Match[] }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const venueInfo = useMemo(() => {
    const today = now.toISOString().split('T')[0];
    // For testing/demo purposes, if it's not the 7th or 8th, we'll show based on the first match date found
    const matchDates = Array.from(new Set(matches.map(m => m.match_date).filter(Boolean))).sort();
    const activeDate = matchDates.includes(today) ? today : matchDates[0] || today;

    if (activeDate === '2026-03-07') return { name: 'Badminton School', pitches: ['1', '2'], details: 'One pitch divided in half' };
    if (activeDate === '2026-03-08') return { 
      name: 'Coombe Dingle Sports Ground', 
      pitches: ['1', '2', '3', '4'],
      details: 'Upper Astro: Pitch 1 & 2 (Chill) | Lower Astro: Pitch 3 & 4 (Competitive)'
    };
    return { name: 'Tournament Venue', pitches: ['1', '2'], details: '' };
  }, [matches, now]);

  const liveMatchesByPitch = useMemo(() => {
    const currentTimeStr = now.toTimeString().slice(0, 5);
    const currentDateStr = now.toISOString().split('T')[0];
    
    const live = matches.filter(m => {
      if (!m.team1_id) return false;
      if (m.status === 'completed') return false;
      if (m.status === 'pending') return true;
      
      if (!m.start_time) return false;
      
      // If match has a date, it MUST match today
      if (m.match_date && m.match_date !== currentDateStr) return false;
      // If match has NO date, we assume it might be for today (fallback)
      
      const matchTime = new Date(`2024-01-01T${m.start_time}:00`);
      const currentTime = new Date(`2024-01-01T${currentTimeStr}:00`);
      const diff = (currentTime.getTime() - matchTime.getTime()) / 60000;
      // Match is "live" if it started within the last 30 minutes
      return diff >= 0 && diff < 30;
    });

    const map: Record<string, Match[]> = {};
    live.forEach(m => {
      if (m.pitch) {
        if (!map[m.pitch]) map[m.pitch] = [];
        map[m.pitch].push(m);
      }
    });
    return map;
  }, [matches, now]);

  const upcomingMatches = useMemo(() => {
    const currentTimeStr = now.toTimeString().slice(0, 5);
    const currentDateStr = now.toISOString().split('T')[0];

    return matches
      .filter(m => {
        if (!m.start_time || m.status === 'completed' || !m.team1_id) return false;
        
        // If date is in the future, it's upcoming
        if (m.match_date && m.match_date > currentDateStr) return true;
        // If date is in the past, it's not upcoming
        if (m.match_date && m.match_date < currentDateStr) return false;
        
        // Same day, check time
        const matchTime = new Date(`2024-01-01T${m.start_time}:00`);
        const currentTime = new Date(`2024-01-01T${currentTimeStr}:00`);
        return matchTime.getTime() > currentTime.getTime();
      })
      .sort((a, b) => (a.match_date || '').localeCompare(b.match_date || '') || (a.start_time || '').localeCompare(b.start_time || ''))
      .slice(0, 4);
  }, [matches, now]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-maroon-700" />
            <span className="text-xs font-black uppercase tracking-widest text-maroon-700">{venueInfo.name}</span>
          </div>
          <h2 className="text-3xl font-black text-stone-900 tracking-tight">Live Matches</h2>
          <p className="text-stone-500 font-medium">{venueInfo.details || 'Real-time updates from all pitches'}</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-xl border border-stone-200 shadow-sm flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-bold text-stone-700">
            {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} • {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Pitch Status Grid */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="bg-maroon-900 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-black uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Pitch Status
          </h2>
          <span className="text-maroon-300 text-[10px] font-bold uppercase">Live Updates</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x divide-y divide-stone-100">
          {venueInfo.pitches.map(pitch => {
            const pitchMatches = liveMatchesByPitch[pitch] || [];
            const isUpper = (pitch === '1' || pitch === '2') && venueInfo.name.includes('Coombe');
            const isLower = (pitch === '3' || pitch === '4') && venueInfo.name.includes('Coombe');
            
            return (
              <div key={pitch} className="p-6 flex flex-col items-center text-center relative">
                {isUpper && <div className="absolute top-0 left-0 right-0 bg-stone-100 py-1 text-[8px] font-black uppercase tracking-tighter text-stone-400">Upper Astro</div>}
                {isLower && <div className="absolute top-0 left-0 right-0 bg-stone-100 py-1 text-[8px] font-black uppercase tracking-tighter text-stone-400">Lower Astro</div>}
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-4 mt-2">Pitch {pitch}</span>
                {pitchMatches.length > 0 ? (
                  <div className="space-y-4 w-full">
                    {pitchMatches.map(match => (
                      <div key={match.id} className="p-2 rounded-lg bg-stone-50 border border-stone-100 relative overflow-hidden">
                        <div className={cn(
                          "absolute top-0 left-0 w-1 h-full",
                          match.tournament_type === 'competitive' ? "bg-maroon-600" : "bg-stone-400"
                        )} />
                        <div className="flex flex-col">
                          <span className="text-[8px] font-black uppercase text-stone-400 mb-1">{match.tournament_type}</span>
                          <span className="text-sm font-bold text-maroon-800 leading-tight">{match.team1_name}</span>
                          <span className="text-[8px] font-black text-stone-300 my-0.5">VS</span>
                          <span className="text-sm font-bold text-maroon-800 leading-tight">{match.team2_name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">Available</span>
                    <span className="text-[10px] font-bold text-stone-300 mt-0.5 uppercase italic">Pitch Free</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upcoming Section */}
        {upcomingMatches.length > 0 && (
          <section className="bg-black rounded-2xl p-6 shadow-xl shadow-stone-200 border border-stone-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-black uppercase tracking-widest flex items-center gap-2">
                <Clock className="w-4 h-4 text-maroon-500" />
                Coming Up Next
              </h2>
              <span className="text-stone-500 text-[10px] font-bold uppercase">Next 4 Matches</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {upcomingMatches.map(match => (
                <div key={match.id} className="bg-white/5 rounded-xl p-3 border border-white/5">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-maroon-500">{match.start_time}</span>
                    <span className="text-[10px] font-bold text-stone-500">P{match.pitch}</span>
                  </div>
                  <div className="text-white text-xs font-bold truncate">
                    {match.team1_name} vs {match.team2_name}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TopScorers({ goals }: { goals: Goal[] }) {
  const scorerStats = useMemo(() => {
    const stats: Record<string, { name: string, team: string, count: number, tournament_type: string }> = {};
    goals.forEach(goal => {
      if (!stats[goal.player_name]) {
        stats[goal.player_name] = { 
          name: goal.player_name, 
          team: goal.team_name || 'Unknown', 
          count: 0,
          tournament_type: goal.tournament_type || 'Unknown'
        };
      }
      stats[goal.player_name].count++;
    });
    return Object.values(stats).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [goals]);

  return (
    <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-maroon-700" />
          Top Goal Scorers
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 text-stone-500 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-3">Player</th>
              <th className="px-6 py-3">Team</th>
              <th className="px-6 py-3">Tournament</th>
              <th className="px-6 py-3 text-center">Goals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {scorerStats.map((player) => (
              <tr key={player.name} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-4 font-bold text-stone-800">{player.name}</td>
                <td className="px-6 py-4 text-sm text-stone-500">{player.team}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "text-[10px] font-black uppercase px-1.5 py-0.5 rounded border",
                    player.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200"
                  )}>
                    {player.tournament_type}
                  </span>
                </td>
                <td className="px-6 py-4 text-center font-black text-maroon-800">{player.count}</td>
              </tr>
            ))}
            {scorerStats.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-stone-400 italic">No goals recorded yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}const ScoreReporter: React.FC<{ teams: Team[], matches: Match[], isLocalMode: boolean, onRefresh: () => void }> = ({ teams, matches, isLocalMode, onRefresh }) => {
  const [captainTeamId, setCaptainTeamId] = useState<number | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [score1, setScore1] = useState<number>(0);
  const [score2, setScore2] = useState<number>(0);
  const [scorers, setScorers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const teamMatches = useMemo(() => {
    if (!captainTeamId) return [];
    return matches.filter(m => 
      (m.team1_id === captainTeamId || m.team2_id === captainTeamId) && 
      m.status !== 'completed' &&
      m.team1_id !== 0 && m.team2_id !== 0
    );
  }, [matches, captainTeamId]);

  const selectedMatch = matches.find(m => m.id === Number(selectedMatchId));

  // Update scorers array when score changes
  useEffect(() => {
    if (!selectedMatch || !selectedTeamId) return;
    const teamScore = Number(selectedTeamId) === selectedMatch.team1_id ? score1 : score2;
    setScorers(prev => {
      const next = [...prev];
      if (next.length < teamScore) {
        while (next.length < teamScore) next.push('');
      } else if (next.length > teamScore) {
        return next.slice(0, teamScore);
      }
      return next;
    });
  }, [score1, score2, selectedTeamId, selectedMatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMatchId || !selectedTeamId) return;

    setSubmitting(true);
    setMessage(null);

    try {
      if (isLocalMode) {
        storage.submitScore({
          match_id: Number(selectedMatchId),
          team_id: Number(selectedTeamId),
          score1,
          score2,
          scorers: scorers.filter(s => s.trim() !== '')
        });
        onRefresh();
      } else {
        const res = await fetch('/api/submit-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            match_id: Number(selectedMatchId),
            team_id: Number(selectedTeamId),
            score1,
            score2,
            scorers: scorers.filter(s => s.trim() !== '')
          })
        });

        if (!res.ok) throw new Error('Submission failed');
      }

      setMessage({ type: 'success', text: 'Score submitted! Waiting for other team to confirm.' });
      setSelectedMatchId('');
      setScore1(0);
      setScore2(0);
      setScorers([]);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to submit score. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!captainTeamId) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
        <h2 className="text-xl font-bold mb-6">Select Your Team</h2>
        <div className="grid grid-cols-1 gap-3">
          {teams.sort((a, b) => a.name.localeCompare(b.name)).map(team => (
            <button
              key={team.id}
              onClick={() => {
                setCaptainTeamId(team.id);
                setSelectedTeamId(team.id.toString());
              }}
              className="p-4 text-left bg-stone-50 border border-stone-200 rounded-xl hover:border-maroon-500 hover:bg-maroon-50 transition-all group"
            >
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-800">{team.name}</span>
                <span className={cn(
                  "text-[10px] font-black uppercase px-2 py-1 rounded",
                  team.tournament_type === 'competitive' ? "bg-maroon-100 text-maroon-700" : "bg-stone-200 text-stone-600"
                )}>
                  {team.tournament_type}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-maroon-100 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-maroon-700" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Report for {teams.find(t => t.id === captainTeamId)?.name}</h2>
            <p className="text-sm text-stone-500">Submit scores for your outstanding matches.</p>
          </div>
        </div>
        <button 
          onClick={() => setCaptainTeamId(null)}
          className="text-xs font-bold text-maroon-700 hover:underline"
        >
          Change Team
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Select Match</label>
          <select 
            value={selectedMatchId}
            onChange={(e) => setSelectedMatchId(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
            required
          >
            <option value="">-- Choose a match --</option>
            {teamMatches.map(m => (
              <option key={m.id} value={m.id}>
                {m.team1_name} vs {m.team2_name} ({m.stage}) - {m.start_time}
              </option>
            ))}
          </select>
          {teamMatches.length === 0 && (
            <p className="text-xs text-stone-400 italic">No outstanding matches for your team.</p>
          )}
        </div>

        {selectedMatch && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="bg-stone-50 rounded-2xl p-6 border border-stone-100">
              <div className="flex items-center justify-center gap-8">
                <div className="flex flex-col items-center gap-3">
                  <span className="text-sm font-bold text-stone-600">{selectedMatch.team1_name}</span>
                  <input 
                    type="number" 
                    min="0"
                    value={score1}
                    onChange={(e) => setScore1(Number(e.target.value))}
                    className="w-20 h-20 text-center text-3xl font-black bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-maroon-500 outline-none"
                  />
                </div>
                <span className="text-2xl font-black text-stone-300 mt-8">:</span>
                <div className="flex flex-col items-center gap-3">
                  <span className="text-sm font-bold text-stone-600">{selectedMatch.team2_name}</span>
                  <input 
                    type="number" 
                    min="0"
                    value={score2}
                    onChange={(e) => setScore2(Number(e.target.value))}
                    className="w-20 h-20 text-center text-3xl font-black bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-maroon-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {scorers.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider">Goal Scorers (Your Team)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {scorers.map((name, idx) => (
                    <div key={idx} className="space-y-1">
                      <label className="text-[10px] font-bold text-stone-400">Scorer {idx + 1} (First & Last Name)</label>
                      <input 
                        type="text"
                        placeholder="e.g. John Smith"
                        value={name}
                        onChange={(e) => {
                          const next = [...scorers];
                          next[idx] = e.target.value;
                          setScorers(next);
                        }}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
                        required
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={submitting}
              className="w-full bg-maroon-700 text-white font-bold py-4 rounded-xl hover:bg-maroon-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? 'Submitting...' : 'Submit Result'}
            </button>
          </div>
        )}

        {message && (
          <div className={cn(
            "p-4 rounded-xl text-sm font-medium flex items-center gap-3",
            message.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
          )}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
};

const TOURNAMENT_SLOTS: Record<string, Record<'chill' | 'competitive', string[]>> = {
  '2026-03-07': {
    chill: ['09:00', '09:20', '09:40', '10:00', '10:20', '10:40', '11:00', '11:20', '11:40', '12:00', '12:20', '12:40'],
    competitive: ['09:10', '09:35', '10:00', '10:25', '10:50', '11:15', '11:40', '12:05', '12:30']
  },
  '2026-03-08': {
    chill: ['11:30', '11:50', '12:10', '12:30', '12:50', '13:10', '13:30'],
    competitive: ['12:00', '12:25', '12:50', '13:15', '13:40']
  }
};

function AdminPanel({ teams, matches, tournamentType, standings, bestSecondPlace, submissions, goals, onRefresh, isLocalMode }: { 
  teams: Team[], 
  matches: Match[], 
  tournamentType: TournamentType,
  standings: Record<string, any[]>,
  bestSecondPlace: any,
  submissions: Submission[],
  goals: Goal[],
  onRefresh: () => void,
  isLocalMode: boolean
}) {
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGroup, setNewTeamGroup] = useState('Group 1');
  const [editingMatchId, setEditingMatchId] = useState<number | null>(null);
  const [editScore1, setEditScore1] = useState(0);
  const [editScore2, setEditScore2] = useState(0);
  const [editStatus, setEditStatus] = useState<'scheduled' | 'pending' | 'completed'>('scheduled');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editPitch, setEditPitch] = useState('');
  const [editUmpire, setEditUmpire] = useState('');

  const [bulkDate, setBulkDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkStartTime, setBulkStartTime] = useState('10:00');
  const [bulkEndTime, setBulkEndTime] = useState('17:00');
  const [bulkInterval, setBulkInterval] = useState(20);
  const [bulkPitch, setBulkPitch] = useState('1');
  const [selectedBulkMatchIds, setSelectedBulkMatchIds] = useState<number[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [breakLabel, setBreakLabel] = useState('');
  const [breakDate, setBreakDate] = useState(new Date().toISOString().split('T')[0]);
  const [breakTime, setBreakTime] = useState('');
  const [breakPitch, setBreakPitch] = useState('');
  const [matchSearch, setMatchSearch] = useState('');

  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [editGoalName, setEditGoalName] = useState('');
  const [newGoalMatchId, setNewGoalMatchId] = useState<number | null>(null);
  const [newGoalTeamId, setNewGoalTeamId] = useState<number | null>(null);
  const [newGoalPlayerName, setNewGoalPlayerName] = useState('');

  const filteredTeams = teams.filter(t => t.tournament_type === tournamentType);
  const filteredMatches = matches.filter(m => m.tournament_type === tournamentType);
  const allMatches = matches; // We show all matches in the manager
  
  const searchedMatches = allMatches.filter(m => 
    m.team1_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.team2_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.umpire?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.stage?.toLowerCase().includes(matchSearch.toLowerCase())
  );

  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamGroup, setEditTeamGroup] = useState('');

  const [newMatchTeam1, setNewMatchTeam1] = useState<number | null>(null);
  const [newMatchTeam2, setNewMatchTeam2] = useState<number | null>(null);
  const [newMatchDate, setNewMatchDate] = useState('2026-03-07');
  const [newMatchTime, setNewMatchTime] = useState('');
  const [newMatchPitch, setNewMatchPitch] = useState('1');
  const [newMatchStage, setNewMatchStage] = useState('round-robin');
  const [newMatchUmpire, setNewMatchUmpire] = useState('');

  const addMatch = async () => {
    if (newMatchTeam1 === null || newMatchTeam2 === null || !newMatchTime) return;
    const matchData = {
      team1_id: newMatchTeam1,
      team2_id: newMatchTeam2,
      tournament_type: tournamentType,
      match_date: newMatchDate,
      start_time: newMatchTime,
      pitch: newMatchPitch,
      stage: newMatchStage,
      umpire: newMatchUmpire,
      status: 'scheduled'
    };

    if (isLocalMode) {
      storage.addMatches([matchData as any]);
      onRefresh();
    } else {
      await fetch('/api/admin/add-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matchData)
      });
    }
    setNewMatchTeam1(null);
    setNewMatchTeam2(null);
    setNewMatchTime('');
  };

  const updateTeam = async (id: number, name: string, group_name: string) => {
    if (isLocalMode) {
      storage.updateTeam(id, { name, group_name });
      onRefresh();
    } else {
      await fetch('/api/admin/update-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, group_name })
      });
      onRefresh();
    }
    setEditingTeamId(null);
  };

  const addTeam = async () => {
    if (!newTeamName) return;
    try {
      if (isLocalMode) {
        storage.addTeam({ name: newTeamName, tournament_type: tournamentType, group_name: newTeamGroup });
      } else {
        const res = await fetch('/api/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newTeamName, tournament_type: tournamentType, group_name: newTeamGroup })
        });
        if (!res.ok) throw new Error('Failed to add team');
      }
      setNewTeamName('');
      onRefresh();
    } catch (err: any) {
      alert(`Error adding team: ${err.message}`);
    }
  };

  const removeTeam = async (id: number) => {
    if (isLocalMode) {
      storage.deleteTeam(id);
    } else {
      await fetch(`/api/teams/${id}`, { method: 'DELETE' });
    }
    onRefresh();
  };

  const generateSchedule = async () => {
    if (filteredTeams.length < 2) return;
    
    // Group-based Round Robin
    const groups = ['A', 'B', 'C'];
    for (const g of groups) {
      const groupTeams = filteredTeams.filter(t => t.group_name === g);
      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          if (isLocalMode) {
            storage.addMatch({
              team1_id: groupTeams[i].id,
              team2_id: groupTeams[j].id,
              tournament_type: tournamentType,
              start_time: 'TBD',
              stage: 'round-robin',
              team1_name: groupTeams[i].name,
              team2_name: groupTeams[j].name
            });
          } else {
            await fetch('/api/matches', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                team1_id: groupTeams[i].id,
                team2_id: groupTeams[j].id,
                tournament_type: tournamentType,
                start_time: 'TBD',
                stage: 'round-robin'
              })
            });
          }
        }
      }
    }
    onRefresh();
  };

  const forceApprove = async (submissionId: number) => {
    if (isLocalMode) {
      const sub = submissions.find(s => s.id === submissionId);
      if (sub) {
        storage.updateMatch(sub.match_id, { score1: sub.score1, score2: sub.score2, status: 'completed' });
      }
    } else {
      await fetch('/api/admin/force-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId })
      });
    }
    onRefresh();
  };

  const resetData = async () => {
    if (!confirm('Are you sure you want to reset ALL data? This cannot be undone.')) return;
    setIsResetting(true);
    if (isLocalMode) {
      storage.reset();
    } else {
      await fetch('/api/reset', { method: 'POST' });
    }
    setIsResetting(false);
    onRefresh();
  };

  const exportData = () => {
    const data = storage.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tournament-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        storage.saveData(json);
        onRefresh();
        alert('Data imported successfully!');
      } catch (err) {
        alert('Failed to import data. Invalid file format.');
      }
    };
    reader.readAsText(file);
  };

  const [isSavingMatch, setIsSavingMatch] = useState<number | null>(null);

  const updateMatch = async (matchId: number | null) => {
    if (matchId === null) return;
    console.log('Attempting to update match:', { 
      matchId, 
      score1: editScore1, 
      score2: editScore2, 
      status: editStatus,
      start_time: editStartTime,
      pitch: editPitch,
      umpire: editUmpire 
    });
    setIsSavingMatch(matchId);
    try {
      if (isLocalMode) {
        storage.updateMatch(matchId, {
          score1: isNaN(editScore1) ? 0 : editScore1, 
          score2: isNaN(editScore2) ? 0 : editScore2, 
          status: editStatus,
          match_date: editDate,
          start_time: editStartTime,
          pitch: editPitch,
          umpire: editUmpire
        });
      } else {
        const res = await fetch('/api/admin/update-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            match_id: matchId, 
            score1: isNaN(editScore1) ? 0 : editScore1, 
            score2: isNaN(editScore2) ? 0 : editScore2, 
            status: editStatus,
            match_date: editDate,
            start_time: editStartTime,
            pitch: editPitch,
            umpire: editUmpire
          })
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to update match');
        }
      }
      setEditingMatchId(null);
      onRefresh();
    } catch (err: any) {
      console.error('Update match error:', err);
      alert(`Failed to save match updates: ${err.message}`);
    } finally {
      setIsSavingMatch(null);
    }
  };

  const bulkSchedule = async () => {
    if (selectedBulkMatchIds.length === 0) return;
    
    let currentTime = new Date(`2024-01-01T${bulkStartTime}:00`);
    const endTime = new Date(`2024-01-01T${bulkEndTime}:00`);
    
    for (const matchId of selectedBulkMatchIds) {
      if (currentTime.getTime() > endTime.getTime()) break;
      
      const match = matches.find(m => m.id === matchId);
      if (!match) continue;

      const timeStr = currentTime.toTimeString().slice(0, 5);
      if (isLocalMode) {
        storage.updateMatch(match.id, {
          match_date: bulkDate,
          start_time: timeStr,
          pitch: bulkPitch
        });
      } else {
        await fetch('/api/admin/update-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            match_id: match.id, 
            score1: match.score1, 
            score2: match.score2, 
            status: match.status,
            match_date: bulkDate,
            start_time: timeStr,
            pitch: bulkPitch,
            umpire: match.umpire
          })
        });
      }
      currentTime = new Date(currentTime.getTime() + bulkInterval * 60000);
    }
    setSelectedBulkMatchIds([]);
    onRefresh();
  };

  const bulkAssignPitches = async () => {
    if (selectedBulkMatchIds.length === 0) return;
    for (const matchId of selectedBulkMatchIds) {
      const match = matches.find(m => m.id === matchId);
      if (!match) continue;

      if (isLocalMode) {
        storage.updateMatch(match.id, { pitch: bulkPitch });
      } else {
        await fetch('/api/admin/update-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            match_id: match.id, 
            score1: match.score1, 
            score2: match.score2, 
            status: match.status,
            match_date: match.match_date,
            start_time: match.start_time,
            pitch: bulkPitch,
            umpire: match.umpire
          })
        });
      }
    }
    setSelectedBulkMatchIds([]);
    onRefresh();
  };

  const addBreak = async () => {
    if (!breakLabel || !breakTime) return;
    if (isLocalMode) {
      storage.addMatch({
        tournament_type: tournamentType,
        match_date: breakDate,
        start_time: breakTime,
        pitch: breakPitch,
        stage: breakLabel,
        team1_id: 0,
        team2_id: 0
      });
      // Update status to completed for breaks
      const data = storage.getData();
      const lastMatch = data.matches[data.matches.length - 1];
      storage.updateMatch(lastMatch.id, { status: 'completed' });
    } else {
      await fetch('/api/admin/add-break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_type: tournamentType,
          match_date: breakDate,
          start_time: breakTime,
          pitch: breakPitch,
          stage: breakLabel
        })
      });
    }
    setBreakLabel('');
    setBreakTime('');
    setBreakPitch('');
    onRefresh();
  };

  const deleteMatch = async (matchId: number) => {
    if (!confirm('Are you sure you want to delete this match? This will also delete any associated scores and goals.')) return;
    try {
      if (isLocalMode) {
        storage.deleteMatch(matchId);
      } else {
        const res = await fetch(`/api/admin/matches/${matchId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete match');
      }
      onRefresh();
    } catch (err: any) {
      alert(`Error deleting match: ${err.message}`);
    }
  };

  const updateGoal = async (goalId: number, newName: string) => {
    try {
      if (isLocalMode) {
        storage.updateGoal(goalId, newName);
      } else {
        const res = await fetch('/api/admin/update-goal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: goalId, player_name: newName })
        });
        if (!res.ok) throw new Error('Failed to update goal');
      }
      setEditingGoalId(null);
      onRefresh();
    } catch (err: any) {
      alert(`Error updating goal: ${err.message}`);
    }
  };

  const deleteGoal = async (goalId: number) => {
    if (!confirm('Delete this goal?')) return;
    try {
      if (isLocalMode) {
        storage.deleteGoal(goalId);
      } else {
        const res = await fetch(`/api/admin/goals/${goalId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete goal');
      }
      onRefresh();
    } catch (err: any) {
      alert(`Error deleting goal: ${err.message}`);
    }
  };

  const addGoal = async () => {
    if (!newGoalMatchId || !newGoalTeamId || !newGoalPlayerName) return;
    try {
      if (isLocalMode) {
        storage.addGoal({
          match_id: newGoalMatchId,
          team_id: newGoalTeamId,
          player_name: newGoalPlayerName
        });
      } else {
        const res = await fetch('/api/admin/add-goal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            match_id: newGoalMatchId,
            team_id: newGoalTeamId,
            player_name: newGoalPlayerName
          })
        });
        if (!res.ok) throw new Error('Failed to add goal');
      }
      setNewGoalPlayerName('');
      onRefresh();
    } catch (err: any) {
      alert(`Error adding goal: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-maroon-700" />
              Team Management ({tournamentType})
            </h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-6">
            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <input 
                type="text" 
                placeholder="Team Name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
              />
              <input 
                type="text" 
                placeholder="Group"
                value={newTeamGroup}
                onChange={(e) => setNewTeamGroup(e.target.value)}
                className="w-full sm:w-32 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
              />
            </div>
            <button 
              onClick={addTeam}
              className="bg-maroon-700 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-maroon-800 transition-all whitespace-nowrap"
            >
              Add Team
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {filteredTeams.map(team => (
              <div key={team.id} className="flex justify-between items-center p-3 bg-stone-50 rounded-lg border border-stone-100">
                <div className="flex-1 flex items-center gap-2">
                  {editingTeamId === team.id ? (
                    <div className="flex flex-1 gap-2">
                      <input 
                        type="text" 
                        value={editTeamName} 
                        onChange={e => setEditTeamName(e.target.value)}
                        className="flex-1 bg-white border border-maroon-300 rounded px-2 py-1 text-sm"
                      />
                      <input 
                        type="text" 
                        value={editTeamGroup}
                        onChange={e => setEditTeamGroup(e.target.value)}
                        className="w-24 bg-white border border-maroon-300 rounded px-2 py-1 text-sm"
                        placeholder="Group"
                      />
                      <button 
                        onClick={() => updateTeam(team.id, editTeamName, editTeamGroup)}
                        className="bg-maroon-700 text-white px-2 py-1 rounded text-[10px] font-bold"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-[10px] font-black bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">{team.group_name}</span>
                      <span className="font-medium text-sm text-stone-800">{team.name}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingTeamId !== team.id && (
                    <button 
                      onClick={() => {
                        setEditingTeamId(team.id);
                        setEditTeamName(team.name);
                        setEditTeamGroup(team.group_name || '');
                      }}
                      className="p-2 text-stone-400 hover:text-maroon-700 transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                  {confirmDeleteId === team.id ? (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
                      <button 
                        onClick={() => {
                          removeTeam(team.id);
                          setConfirmDeleteId(null);
                        }}
                        className="bg-maroon-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-maroon-800 transition-all"
                      >
                        Confirm
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteId(null)}
                        className="bg-stone-200 text-stone-600 text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-stone-300 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => setConfirmDeleteId(team.id)}
                      className="inline-flex items-center gap-2 bg-stone-100 text-stone-400 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-xl transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="text-xs font-bold">Delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {filteredTeams.length === 0 && <p className="text-center text-stone-400 text-sm italic py-4">No teams added</p>}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Plus className="w-5 h-5 text-maroon-700" />
            Add Manual Match ({tournamentType})
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Team 1</label>
                <select 
                  value={newMatchTeam1 || ''} 
                  onChange={e => setNewMatchTeam1(Number(e.target.value))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Select Team 1</option>
                  <option value="0">TBD / Placeholder</option>
                  {filteredTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Team 2</label>
                <select 
                  value={newMatchTeam2 || ''} 
                  onChange={e => setNewMatchTeam2(Number(e.target.value))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Select Team 2</option>
                  <option value="0">TBD / Placeholder</option>
                  {filteredTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Date</label>
                <select 
                  value={newMatchDate} 
                  onChange={e => {
                    setNewMatchDate(e.target.value);
                    setNewMatchTime(''); 
                  }}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="2026-03-07">Sat Mar 7</option>
                  <option value="2026-03-08">Sun Mar 8</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Time Slot</label>
                <select 
                  value={newMatchTime} 
                  onChange={e => setNewMatchTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Select Slot</option>
                  {TOURNAMENT_SLOTS[newMatchDate]?.[tournamentType].map(slot => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitch</label>
                <select 
                  value={newMatchPitch} 
                  onChange={e => setNewMatchPitch(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="1">Pitch 1</option>
                  <option value="2">Pitch 2</option>
                  <option value="3">Pitch 3</option>
                  <option value="4">Pitch 4</option>
                  <option value="A">Pitch A</option>
                  <option value="B">Pitch B</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Stage</label>
                <select 
                  value={newMatchStage} 
                  onChange={e => setNewMatchStage(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="round-robin">Round Robin</option>
                  <option value="quarter-final">Quarter Final</option>
                  <option value="semi-final">Semi Final</option>
                  <option value="final">Final</option>
                  <option value="3rd-4th-play-off">3rd/4th Play-off</option>
                </select>
              </div>
            </div>
            <button 
              onClick={addMatch}
              disabled={newMatchTeam1 === null || newMatchTeam2 === null || !newMatchTime}
              className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all disabled:opacity-50"
            >
              Add Match
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-maroon-700" />
            Bulk Scheduler ({tournamentType})
          </h3>
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Date</label>
                <input 
                  type="date" 
                  value={bulkDate}
                  onChange={(e) => setBulkDate(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Start Time</label>
                <input 
                  type="time" 
                  value={bulkStartTime}
                  onChange={(e) => setBulkStartTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Finish Time</label>
                <input 
                  type="time" 
                  value={bulkEndTime}
                  onChange={(e) => setBulkEndTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Interval (min)</label>
                <input 
                  type="number" 
                  value={bulkInterval}
                  onChange={(e) => setBulkInterval(Number(e.target.value))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitch</label>
                <select 
                  value={bulkPitch}
                  onChange={(e) => setBulkPitch(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="1">Pitch 1</option>
                  <option value="2">Pitch 2</option>
                  <option value="3">Pitch 3</option>
                  <option value="4">Pitch 4</option>
                  <option value="A">Pitch A</option>
                  <option value="B">Pitch B</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Select Matches to Schedule</label>
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      const unassignedIds = filteredMatches
                        .filter(m => !m.start_time || !m.pitch)
                        .map(m => m.id);
                      setSelectedBulkMatchIds(unassignedIds);
                    }}
                    className="text-[10px] font-bold text-stone-400 hover:text-maroon-700 uppercase transition-colors"
                  >
                    Select All
                  </button>
                  <button 
                    onClick={() => setSelectedBulkMatchIds([])}
                    className="text-[10px] font-bold text-stone-400 hover:text-maroon-700 uppercase transition-colors"
                  >
                    Clear
                  </button>
                  <span className="text-[10px] font-bold text-maroon-700 bg-maroon-50 px-2 py-1 rounded-full">
                    {selectedBulkMatchIds.length} Selected
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 border border-stone-100 rounded-xl">
                {filteredMatches.filter(m => !m.start_time || !m.pitch).map(match => (
                  <label 
                    key={match.id} 
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                      selectedBulkMatchIds.includes(match.id) 
                        ? "bg-maroon-50 border-maroon-200 ring-1 ring-maroon-200" 
                        : "bg-white border-stone-100 hover:border-stone-200"
                    )}
                  >
                    <input 
                      type="checkbox"
                      checked={selectedBulkMatchIds.includes(match.id)}
                      onChange={() => {
                        if (selectedBulkMatchIds.includes(match.id)) {
                          setSelectedBulkMatchIds(selectedBulkMatchIds.filter(id => id !== match.id));
                        } else {
                          setSelectedBulkMatchIds([...selectedBulkMatchIds, match.id]);
                        }
                      }}
                      className="hidden"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold text-stone-400 uppercase truncate">{match.stage}</div>
                      <div className="text-xs font-bold text-stone-800 truncate">
                        {(match.team1_name || (match.team1_id === 0 ? 'TBD' : 'Unknown'))} vs {(match.team2_name || (match.team2_id === 0 ? 'TBD' : 'Unknown'))}
                      </div>
                    </div>
                    {selectedBulkMatchIds.includes(match.id) && (
                      <div className="w-5 h-5 rounded-full bg-maroon-700 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {selectedBulkMatchIds.indexOf(match.id) + 1}
                      </div>
                    )}
                  </label>
                ))}
                {filteredMatches.filter(m => !m.start_time || !m.pitch).length === 0 && (
                  <div className="col-span-full py-8 text-center text-stone-400 italic text-sm">
                    No unassigned matches found
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={bulkSchedule}
              disabled={selectedBulkMatchIds.length === 0}
              className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all shadow-lg shadow-maroon-100"
            >
              Schedule Selected Matches
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-maroon-700" />
            Knockout Phase Scheduler
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              {allMatches.filter(m => m.tournament_type === tournamentType && m.stage !== 'round-robin' && m.stage !== 'break').length === 0 && (
                <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  <p className="text-sm text-stone-400 italic">No knockout matches created yet. Use "Pre-Generate Knockout Slots" below to create them.</p>
                </div>
              )}
              {allMatches.filter(m => m.tournament_type === tournamentType && m.stage !== 'round-robin' && m.stage !== 'break').map(match => (
                <div key={match.id} className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-maroon-700 uppercase bg-maroon-50 px-2 py-0.5 rounded-full">
                        {match.stage.replace('-', ' ')}
                      </span>
                      {(!match.team1_id || !match.team2_id) && (
                        <span className="text-[10px] font-bold text-amber-600 uppercase bg-amber-50 px-2 py-0.5 rounded-full">
                          Placeholder
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-stone-800 truncate">
                      {(match.team1_name || (match.team1_id === 0 ? 'TBD' : 'Unknown'))} vs {(match.team2_name || (match.team2_id === 0 ? 'TBD' : 'Unknown'))}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-bold text-stone-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {match.match_date ? `${match.match_date.slice(5)} ${match.start_time}` : match.start_time || 'TBD'}
                      </span>
                      <span className="text-[10px] font-bold text-stone-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        Pitch {match.pitch || 'TBD'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setEditingMatchId(match.id);
                        setEditScore1(match.score1);
                        setEditScore2(match.score2);
                        setEditStatus(match.status);
                        setEditDate(match.match_date || '2026-03-07');
                        setEditStartTime(match.start_time || '10:00');
                        setEditPitch(match.pitch || '1');
                        setEditUmpire(match.umpire || '');
                      }}
                      className="p-2 text-stone-400 hover:text-maroon-700 hover:bg-maroon-50 rounded-lg transition-all"
                      title="Schedule Match"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => deleteMatch(match.id)}
                      className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Delete Match"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-maroon-700" />
            Add Break / Gap
          </h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-500 uppercase">Label (e.g. Lunch Break)</label>
              <input 
                type="text" 
                value={breakLabel}
                onChange={(e) => setBreakLabel(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Date</label>
                <input 
                  type="date" 
                  value={breakDate}
                  onChange={(e) => setBreakDate(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Time</label>
                <input 
                  type="time" 
                  value={breakTime}
                  onChange={(e) => setBreakTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitch (Optional)</label>
                <select 
                  value={breakPitch}
                  onChange={(e) => setBreakPitch(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">None</option>
                  <option value="1">Pitch 1</option>
                  <option value="2">Pitch 2</option>
                  <option value="3">Pitch 3</option>
                  <option value="4">Pitch 4</option>
                </select>
              </div>
            </div>
            <button 
              onClick={addBreak}
              className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all"
            >
              Add Break to Schedule
            </button>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-1 gap-8">
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-maroon-700" />
            Tournament Controls
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button 
              onClick={generateSchedule}
              disabled={filteredTeams.length < 2}
              className="flex items-center justify-center gap-2 bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 disabled:bg-stone-200 transition-all text-xs"
            >
              <RefreshCw className="w-4 h-4" />
              Generate Round Robin
            </button>
            
            <button 
              onClick={async () => {
                const stages = tournamentType === 'competitive' 
                  ? ['play-off-8v9', 'quarter-final', 'quarter-final', 'quarter-final', 'quarter-final', 'semi-final', 'semi-final', 'final', '3rd-4th-play-off']
                  : ['semi-final', 'semi-final', 'final', '3rd-4th-play-off'];
                
                const matchesToCreate = stages.map(stage => ({
                  team1_id: 0,
                  team2_id: 0,
                  tournament_type: tournamentType,
                  stage,
                  status: 'scheduled' as const
                }));

                if (isLocalMode) {
                  storage.addMatches(matchesToCreate as any);
                } else {
                  for (const m of matchesToCreate) {
                    await fetch('/api/admin/add-match', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(m)
                    });
                  }
                }
                onRefresh();
              }}
              className="flex items-center justify-center gap-2 bg-stone-800 text-white py-3 rounded-xl font-bold hover:bg-black transition-all text-xs"
            >
              <Plus className="w-4 h-4" />
              Pre-Generate Knockout Slots
            </button>

            {tournamentType === 'competitive' ? (
              <>
                <button 
                  onClick={async () => {
                    // Overall standings for competitive
                    const allTeams = (Object.values(standings).flat() as any[]).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
                    
                    if (isLocalMode) {
                      const newMatches: any[] = [];
                      if (allTeams.length >= 9) {
                        newMatches.push({ team1_id: allTeams[7].id, team2_id: allTeams[8].id, tournament_type: tournamentType, stage: 'play-off-8v9', team1_name: allTeams[7].name, team2_name: allTeams[8].name });
                      }
                      newMatches.push({ team1_id: allTeams[0].id, team2_id: 0, tournament_type: tournamentType, stage: 'quarter-final', team1_name: allTeams[0].name, team2_name: 'Winner 8v9' });
                      newMatches.push({ team1_id: allTeams[1].id, team2_id: allTeams[6].id, tournament_type: tournamentType, stage: 'quarter-final', team1_name: allTeams[1].name, team2_name: allTeams[6].name });
                      newMatches.push({ team1_id: allTeams[2].id, team2_id: allTeams[5].id, tournament_type: tournamentType, stage: 'quarter-final', team1_name: allTeams[2].name, team2_name: allTeams[5].name });
                      newMatches.push({ team1_id: allTeams[3].id, team2_id: allTeams[4].id, tournament_type: tournamentType, stage: 'quarter-final', team1_name: allTeams[3].name, team2_name: allTeams[4].name });
                      storage.fillPlaceholderMatches(newMatches);
                    } else {
                      await fetch('/api/generate-knockouts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tournament_type: tournamentType, teams: allTeams })
                      });
                    }
                    onRefresh();
                  }}
                  disabled={Object.keys(standings).length === 0 || matches.filter(m => m.tournament_type === tournamentType && (m.stage === 'play-off-8v9' || m.stage === 'quarter-final')).length > 0}
                  className="flex items-center justify-center gap-2 bg-maroon-600 text-white py-3 rounded-xl font-bold hover:bg-maroon-700 disabled:bg-stone-200 transition-all text-xs"
                >
                  <Trophy className="w-4 h-4" />
                  Generate Quarters & 8v9
                </button>

                <button 
                  onClick={async () => {
                    const quarters = matches.filter(m => m.tournament_type === tournamentType && m.stage === 'quarter-final' && m.status === 'completed');
                    if (quarters.length < 4) {
                      alert("Complete all Quarter-Finals first!");
                      return;
                    }
                    const winners = quarters.map(m => m.score1 > m.score2 ? { id: m.team1_id, name: m.team1_name } : { id: m.team2_id, name: m.team2_name });
                    
                    if (isLocalMode) {
                      const newMatches = [
                        { team1_id: winners[0].id, team2_id: winners[3].id, tournament_type: tournamentType, stage: 'semi-final', team1_name: winners[0].name, team2_name: winners[3].name },
                        { team1_id: winners[1].id, team2_id: winners[2].id, tournament_type: tournamentType, stage: 'semi-final', team1_name: winners[1].name, team2_name: winners[2].name }
                      ];
                      storage.fillPlaceholderMatches(newMatches as any);
                    } else {
                      await fetch('/api/generate-next-stage', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tournament_type: tournamentType, stage: 'semi-final', teams: winners })
                      });
                    }
                    onRefresh();
                  }}
                  disabled={matches.filter(m => m.tournament_type === tournamentType && m.stage === 'quarter-final' && m.status === 'completed').length < 4 || matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final').length > 0}
                  className="flex items-center justify-center gap-2 bg-maroon-500 text-white py-3 rounded-xl font-bold hover:bg-maroon-600 disabled:bg-stone-200 transition-all text-xs"
                >
                  <Trophy className="w-4 h-4" />
                  Generate Semis
                </button>
              </>
            ) : (
              <button 
                onClick={async () => {
                  // Chill: 3 winners + 1 best 2nd
                  const winners = Object.values(standings).map(group => group[0]).filter(Boolean);
                  if (winners.length < 3 || !bestSecondPlace) {
                    alert("Group stages not complete or not enough teams!");
                    return;
                  }
                  const knockoutTeams = [...winners, bestSecondPlace];
                  
                  if (isLocalMode) {
                    const newMatches = [
                      { team1_id: knockoutTeams[0].id, team2_id: knockoutTeams[3].id, tournament_type: tournamentType, stage: 'semi-final', team1_name: knockoutTeams[0].name, team2_name: knockoutTeams[3].name },
                      { team1_id: knockoutTeams[1].id, team2_id: knockoutTeams[2].id, tournament_type: tournamentType, stage: 'semi-final', team1_name: knockoutTeams[1].name, team2_name: knockoutTeams[2].name }
                    ];
                    storage.fillPlaceholderMatches(newMatches as any);
                  } else {
                    await fetch('/api/generate-knockouts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tournament_type: tournamentType, teams: knockoutTeams })
                    });
                  }
                  onRefresh();
                }}
                disabled={Object.keys(standings).length < 3 || matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final').length > 0}
                className="flex items-center justify-center gap-2 bg-maroon-600 text-white py-3 rounded-xl font-bold hover:bg-maroon-700 disabled:bg-stone-200 transition-all text-xs"
              >
                <Trophy className="w-4 h-4" />
                Generate Semis (Winners + Best 2nd)
              </button>
            )}

            <button 
              onClick={async () => {
                const semiFinals = matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed');
                if (semiFinals.length < 2) {
                  alert("Complete all Semi-Finals first!");
                  return;
                }
                const winners = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team1_id, name: m.team1_name } : { id: m.team2_id, name: m.team2_name });
                const losers = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team2_id, name: m.team2_name } : { id: m.team1_id, name: m.team1_name });
                
                if (isLocalMode) {
                  const newMatches = [
                    { team1_id: winners[0].id, team2_id: winners[1].id, tournament_type: tournamentType, stage: 'final', team1_name: winners[0].name, team2_name: winners[1].name },
                    { team1_id: losers[0].id, team2_id: losers[1].id, tournament_type: tournamentType, stage: '3rd-4th-play-off', team1_name: losers[0].name, team2_name: losers[1].name }
                  ];
                  storage.fillPlaceholderMatches(newMatches as any);
                } else {
                  await fetch('/api/generate-next-stage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tournament_type: tournamentType, stage: 'final', teams: [...winners, ...losers] })
                  });
                }
                onRefresh();
              }}
              disabled={matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed').length < 2 || matches.filter(m => m.tournament_type === tournamentType && m.stage === 'final').length > 0}
              className="flex items-center justify-center gap-2 bg-maroon-900 text-white py-3 rounded-xl font-bold hover:bg-maroon-950 disabled:bg-stone-200 transition-all text-xs"
            >
              <Trophy className="w-4 h-4" />
              Generate Final & 3rd/4th
            </button>
          </div>
          <div className="mt-6 pt-6 border-t border-stone-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {isLocalMode && (
                <>
                  <button 
                    onClick={exportData}
                    className="flex items-center gap-2 bg-stone-100 text-stone-600 px-4 py-2 rounded-xl font-bold text-xs hover:bg-stone-200 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Export Data
                  </button>
                  <label className="flex items-center gap-2 bg-stone-100 text-stone-600 px-4 py-2 rounded-xl font-bold text-xs hover:bg-stone-200 transition-all cursor-pointer">
                    <Plus className="w-3 h-3" />
                    Import Data
                    <input type="file" accept=".json" onChange={importData} className="hidden" />
                  </label>
                </>
              )}
            </div>
            
            {showResetConfirm ? (
              <div className="flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
                <span className="text-xs font-bold text-red-600 uppercase tracking-tight">Reset everything?</span>
                <button 
                  onClick={() => {
                    resetData();
                    setShowResetConfirm(false);
                  }}
                  className="bg-maroon-700 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-maroon-800 transition-all shadow-lg shadow-maroon-100"
                >
                  Yes, Reset
                </button>
                <button 
                  onClick={() => setShowResetConfirm(false)}
                  className="bg-stone-100 text-stone-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-stone-200 transition-all"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex items-center gap-2 text-stone-300 hover:text-red-400 px-4 py-2 rounded-xl font-bold transition-all cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Reset All Data
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-maroon-700" />
            Goal Scorer Management
          </h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-100">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-400 uppercase">Match</label>
              <select 
                value={newGoalMatchId || ''} 
                onChange={e => setNewGoalMatchId(Number(e.target.value))}
                className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select Match</option>
                {matches.filter(m => m.status === 'completed').map(m => (
                  <option key={m.id} value={m.id}>{m.team1_name} vs {m.team2_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-400 uppercase">Team</label>
              <select 
                value={newGoalTeamId || ''} 
                onChange={e => setNewGoalTeamId(Number(e.target.value))}
                className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select Team</option>
                {newGoalMatchId && matches.find(m => m.id === newGoalMatchId) && (
                  <>
                    <option value={matches.find(m => m.id === newGoalMatchId)!.team1_id}>{matches.find(m => m.id === newGoalMatchId)!.team1_name}</option>
                    <option value={matches.find(m => m.id === newGoalMatchId)!.team2_id}>{matches.find(m => m.id === newGoalMatchId)!.team2_name}</option>
                  </>
                )}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-400 uppercase">Player Name</label>
              <input 
                type="text" 
                value={newGoalPlayerName} 
                onChange={e => setNewGoalPlayerName(e.target.value)}
                placeholder="Full Name"
                className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button 
                onClick={addGoal}
                disabled={!newGoalMatchId || !newGoalTeamId || !newGoalPlayerName}
                className="w-full bg-maroon-700 text-white font-bold py-2 rounded-lg hover:bg-maroon-800 transition-all disabled:opacity-50"
              >
                Add Goal
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-stone-500 text-[10px] font-bold uppercase tracking-wider">
                  <th className="px-4 py-2">Player</th>
                  <th className="px-4 py-2">Team</th>
                  <th className="px-4 py-2">Tournament</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {goals.sort((a, b) => a.player_name.localeCompare(b.player_name)).map(goal => (
                  <tr key={goal.id} className="hover:bg-stone-50 group">
                    <td className="px-4 py-3">
                      {editingGoalId === goal.id ? (
                        <input 
                          type="text" 
                          value={editGoalName} 
                          onChange={e => setEditGoalName(e.target.value)}
                          onBlur={() => updateGoal(goal.id, editGoalName)}
                          onKeyDown={e => e.key === 'Enter' && updateGoal(goal.id, editGoalName)}
                          autoFocus
                          className="bg-white border border-maroon-300 rounded px-2 py-1 text-sm w-full"
                        />
                      ) : (
                        <span className="text-sm font-medium text-stone-800">{goal.player_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-500">{goal.team_name}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "text-[10px] font-black uppercase px-2 py-0.5 rounded",
                        goal.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700" : "bg-stone-100 text-stone-600"
                      )}>
                        {goal.tournament_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingGoalId(goal.id); setEditGoalName(goal.player_name); }}
                          className="p-1 text-stone-400 hover:text-maroon-700"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => deleteGoal(goal.id)}
                          className="p-1 text-stone-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-maroon-700" />
            Match Manager
          </h3>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text"
              placeholder="Search teams, umpires, or stages..."
              value={matchSearch}
              onChange={(e) => setMatchSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-3">Match Details</th>
                <th className="px-6 py-3">Time & Pitch</th>
                <th className="px-6 py-3">Umpire</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[...searchedMatches]
                .sort((a, b) => 
                  (a.match_date || '').localeCompare(b.match_date || '') || 
                  (a.start_time || '').localeCompare(b.start_time || '') || 
                  a.tournament_type.localeCompare(b.tournament_type)
                )
                .map(match => (
                <tr key={match.id} className={cn(
                  "hover:bg-stone-50 transition-colors group",
                  match.tournament_type !== tournamentType && "opacity-60 bg-stone-50/50"
                )}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900">{match.team1_name} vs {match.team2_name}</span>
                        <span className={cn(
                          "text-[8px] font-black uppercase px-1.5 py-0.5 rounded border",
                          match.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200"
                        )}>
                          {match.tournament_type}
                        </span>
                      </div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">{match.stage}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 text-maroon-700 font-bold text-sm">
                        <Clock className="w-3 h-3" />
                        {match.match_date ? `${match.match_date.slice(5)} ${match.start_time}` : match.start_time || 'TBD'}
                      </div>
                      <div className="flex items-center gap-1.5 text-stone-500 text-xs">
                        <MapPin className="w-3 h-3" />
                        Pitch {match.pitch || 'TBD'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {match.umpire ? (
                      <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
                        <div className="w-6 h-6 rounded-full bg-maroon-100 flex items-center justify-center text-[10px] text-maroon-700 font-bold">
                          {match.umpire.charAt(0).toUpperCase()}
                        </div>
                        {match.umpire}
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400 italic">No umpire</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5",
                      match.status === 'completed' ? "bg-green-100 text-green-700" :
                      match.status === 'pending' ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        match.status === 'completed' ? "bg-green-500" :
                        match.status === 'pending' ? "bg-amber-500" : "bg-stone-400"
                      )} />
                      {match.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono font-bold text-lg text-stone-800">
                      {match.score1} - {match.score2}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingMatchId(match.id);
                          setEditScore1(match.score1);
                          setEditScore2(match.score2);
                          setEditStatus(match.status);
                          setEditDate(match.match_date || '');
                          setEditStartTime(match.start_time || '');
                          setEditPitch(match.pitch || '');
                          setEditUmpire(match.umpire || '');
                        }}
                        className="inline-flex items-center gap-2 bg-stone-100 text-stone-600 hover:bg-maroon-700 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button 
                        onClick={() => deleteMatch(match.id)}
                        className="inline-flex items-center gap-2 bg-stone-100 text-stone-600 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {searchedMatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-stone-400">
                      <Search className="w-8 h-8 opacity-20" />
                      <p className="italic">No matches found matching your search</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Match Editor Modal */}
      {editingMatchId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="bg-maroon-700 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Edit Match</h3>
                <p className="text-maroon-100 text-xs font-medium uppercase tracking-widest mt-1">
                  {matches.find(m => m.id === editingMatchId)?.team1_name} vs {matches.find(m => m.id === editingMatchId)?.team2_name}
                </p>
              </div>
              <button 
                onClick={() => setEditingMatchId(null)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Date</label>
                  <input 
                    type="date" 
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Start Time</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input 
                      type="text" 
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      placeholder="e.g. 10:00"
                      className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Pitch</label>
                  <select 
                    value={editPitch}
                    onChange={(e) => setEditPitch(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
                  >
                    <option value="">TBD</option>
                    <option value="1">Pitch 1</option>
                    <option value="2">Pitch 2</option>
                    <option value="3">Pitch 3</option>
                    <option value="4">Pitch 4</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Umpire Assignment</label>
                <div className="relative flex gap-2">
                  <div className="relative flex-1">
                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input 
                      type="text" 
                      value={editUmpire}
                      onChange={(e) => setEditUmpire(e.target.value)}
                      placeholder="Enter umpire's full name"
                      className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
                    />
                  </div>
                  {editUmpire && (
                    <button 
                      onClick={() => setEditUmpire('')}
                      className="px-3 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 transition-all text-xs font-bold"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Status</label>
                  <select 
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none appearance-none"
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Final Score</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" 
                      value={editScore1}
                      onChange={(e) => setEditScore1(Number(e.target.value))}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-center font-bold text-lg focus:ring-2 focus:ring-maroon-500 outline-none"
                    />
                    <span className="font-bold text-stone-400">-</span>
                    <input 
                      type="number" 
                      value={editScore2}
                      onChange={(e) => setEditScore2(Number(e.target.value))}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-center font-bold text-lg focus:ring-2 focus:ring-maroon-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => updateMatch(editingMatchId)}
                  disabled={isSavingMatch === editingMatchId}
                  className="flex-1 bg-maroon-700 text-white font-bold py-4 rounded-2xl hover:bg-maroon-800 transition-all shadow-lg shadow-maroon-100 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingMatch === editingMatchId ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Save Changes
                    </>
                  )}
                </button>
                <button 
                  onClick={() => setEditingMatchId(null)}
                  disabled={isSavingMatch === editingMatchId}
                  className="px-8 bg-stone-100 text-stone-600 font-bold py-4 rounded-2xl hover:bg-stone-200 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-maroon-700" />
            Pending Submissions
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-3">Match</th>
                <th className="px-6 py-3">Submitted By</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {matches.filter(m => m.status === 'pending').map(match => {
                const matchSubmissions = submissions.filter(s => s.match_id === match.id);
                return matchSubmissions.map(sub => (
                  <tr key={sub.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium">{match.team1_name} vs {match.team2_name}</td>
                    <td className="px-6 py-4 text-sm">{teams.find(t => t.id === sub.team_id)?.name}</td>
                    <td className="px-6 py-4 text-sm font-bold">{sub.score1} - {sub.score2}</td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => forceApprove(sub.id)}
                        className="text-xs bg-maroon-700 text-white px-3 py-1 rounded-lg font-bold hover:bg-maroon-800 transition-all"
                      >
                        Force Approve
                      </button>
                    </td>
                  </tr>
                ));
              })}
              {matches.filter(m => m.status === 'pending').length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-stone-400 italic">No pending submissions</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
