import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Users, Calendar, Settings, ShieldCheck, AlertCircle, CheckCircle2, Clock, ChevronRight, Plus, Trash2, RefreshCw, Search, Edit2, X, MapPin, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { socket } from './lib/socket';
import { storage } from './lib/storage';
import type { Team, Match, Submission, AppData, TournamentType, Goal } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return 'TBD';
  if (dateStr === '2026-03-07') return '7 Mar';
  if (dateStr === '2026-03-08') return '8 Mar';
  // Fallback: parse YYYY-MM-DD
  const [, month, day] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${months[parseInt(month) - 1]}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'live' | 'umpire' | 'report' | 'admin'>('dashboard');
  const [tournamentType, setTournamentType] = useState<TournamentType>('competitive');
  const [data, setData] = useState<AppData & { goals: Goal[], umpires: {id: number, name: string}[] }>({ teams: [], matches: [], submissions: [], goals: [], umpires: [] });
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
      setIsConnecting(false);
      setIsLocalMode(false);
    });
    socket.on('disconnect', () => {});
    socket.on('connect_error', () => {
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
      const team1 = data.teams.find(t => t.id === match.team1_id);
      if (!team1) return;
      const g = team1.group_name || 'Unassigned';
      const t1 = groupStats[g]?.[match.team1_id];
      const t2 = groupStats[g]?.[match.team2_id];
      if (!t1 || !t2) return;

      t1.played++; t2.played++;
      t1.gf += match.score1; t1.ga += match.score2;
      t2.gf += match.score2; t2.ga += match.score1;

      if (match.score1 > match.score2) { t1.won++; t1.pts += 3; t2.lost++; }
      else if (match.score1 < match.score2) { t2.won++; t2.pts += 3; t1.lost++; }
      else { t1.drawn++; t2.drawn++; t1.pts += 1; t2.pts += 1; }
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
      <header className="bg-black border-b border-maroon-900 sticky top-0 z-30">
        {isLocalMode && (
          <div className="bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest py-1 px-4 text-center">
            Local Storage Mode: Data is saved only on this device.
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(activeTab === 'dashboard' || activeTab === 'admin') && (
          <div className="flex justify-center mb-8">
            <div className="bg-stone-200 p-1 rounded-xl flex gap-1">
              <button onClick={() => setTournamentType('competitive')} className={cn("px-6 py-2 rounded-lg text-sm font-semibold transition-all", tournamentType === 'competitive' ? "bg-maroon-700 text-white shadow-sm" : "text-stone-600 hover:text-stone-900")}>Competitive</button>
              <button onClick={() => setTournamentType('chill')} className={cn("px-6 py-2 rounded-lg text-sm font-semibold transition-all", tournamentType === 'chill' ? "bg-maroon-700 text-white shadow-sm" : "text-stone-600 hover:text-stone-900")}>Chill</button>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'umpire' && (
            <motion.div key="umpire" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl mx-auto">
              {!isUmpireAuthenticated ? (
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Users className="w-6 h-6 text-maroon-700" />Umpire Portal</h2>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Select Your Name</label>
                      <select value={umpireName} onChange={(e) => setUmpireName(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none">
                        <option value="">-- Select your name --</option>
                        {data.umpires.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                      </select>
                      {data.umpires.length === 0 && <p className="text-xs text-stone-400 italic">No umpires have been added yet. Ask the admin to add umpires first.</p>}
                    </div>
                    <button onClick={() => { if (umpireName.trim()) setIsUmpireAuthenticated(true); }} disabled={!umpireName} className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all disabled:opacity-50">View My Matches</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2"><Users className="w-6 h-6 text-maroon-700" />Matches for {umpireName}</h2>
                    <button onClick={() => setIsUmpireAuthenticated(false)} className="text-sm text-maroon-700 font-bold hover:underline">Logout</button>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {data.matches.filter(m => m.umpire?.toLowerCase() === umpireName.toLowerCase()).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    {data.matches.filter(m => m.umpire?.toLowerCase() === umpireName.toLowerCase()).length === 0 && (
                      <div className="bg-white p-12 rounded-2xl border border-stone-200 text-center"><p className="text-stone-500">No matches assigned to you yet.</p></div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'live' && (
            <motion.div key="live" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <LiveDashboard matches={data.matches} />
            </motion.div>
          )}

          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                      <h2 className="font-bold flex items-center gap-2"><Users className="w-5 h-5 text-maroon-700" />Standings</h2>
                      {tournamentType === 'chill' && bestSecondPlace && (
                        <span className="text-[10px] font-bold bg-maroon-50 text-maroon-700 px-2 py-1 rounded border border-maroon-100">Best 2nd: {bestSecondPlace.name}</span>
                      )}
                    </div>
                    <div className="divide-y divide-stone-100">
                      {(Object.entries(standings) as [string, any[]][]).map(([groupName, teams]) => (
                        <div key={groupName} className="pb-4">
                          <div className="bg-stone-50 px-6 py-2 text-[10px] font-black uppercase tracking-widest text-stone-400">Group {groupName}</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[600px]">
                              <thead>
                                <tr className="text-stone-500 text-[10px] font-bold uppercase tracking-wider">
                                  <th className="px-6 py-2">Pos</th><th className="px-6 py-2">Team</th>
                                  <th className="px-6 py-2 text-center">P</th><th className="px-6 py-2 text-center">W</th>
                                  <th className="px-6 py-2 text-center">D</th><th className="px-6 py-2 text-center">L</th>
                                  <th className="px-6 py-2 text-center">Pts</th><th className="px-6 py-2 text-center">GD</th>
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
                                      <button onClick={() => toggleFavorite(team.id)} className={cn("p-1 rounded-full transition-all", favorites.includes(team.id) ? "text-amber-500" : "text-stone-300 hover:text-stone-400")}>
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
                      {Object.keys(standings).length === 0 && <div className="px-6 py-12 text-center text-stone-400 italic">No teams added yet</div>}
                    </div>
                  </section>

                  <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-100">
                      <h2 className="font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-maroon-700" />Full Schedule</h2>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[800px] overflow-y-auto">
                      {sortedMatches.map(match => (
                        <MatchCard key={match.id} match={match} isFavorite={favorites.includes(match.team1_id) || favorites.includes(match.team2_id)} />
                      ))}
                      {sortedMatches.length === 0 && <div className="col-span-2 py-12 text-center text-stone-400 italic">No matches scheduled</div>}
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                  {tournamentType === 'competitive' && (
                    <>
                      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                        <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900"><Trophy className="w-4 h-4 text-maroon-600" />8v9 Play-off</h3>
                        <div className="space-y-3">
                          {filteredMatches.filter(m => m.stage === 'play-off-8v9').map(match => <MatchCard key={match.id} match={match} />)}
                          {filteredMatches.filter(m => m.stage === 'play-off-8v9').length === 0 && <p className="text-sm text-stone-400 italic">To be determined...</p>}
                        </div>
                      </section>
                      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                        <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900"><Trophy className="w-4 h-4 text-maroon-600" />Quarter-Finals</h3>
                        <div className="space-y-3">
                          {filteredMatches.filter(m => m.stage === 'quarter-final').map(match => <MatchCard key={match.id} match={match} />)}
                          {filteredMatches.filter(m => m.stage === 'quarter-final').length === 0 && <p className="text-sm text-stone-400 italic">To be determined...</p>}
                        </div>
                      </section>
                    </>
                  )}
                  <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                    <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900"><Trophy className="w-4 h-4 text-maroon-600" />Semi-Finals</h3>
                    <div className="space-y-3">
                      {filteredMatches.filter(m => m.stage === 'semi-final').map(match => <MatchCard key={match.id} match={match} />)}
                      {filteredMatches.filter(m => m.stage === 'semi-final').length === 0 && <p className="text-sm text-stone-400 italic">To be determined...</p>}
                    </div>
                  </section>
                  <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                    <h3 className="font-bold mb-4 flex items-center gap-2 text-maroon-900"><Trophy className="w-4 h-4 text-black" />Final & 3rd Place</h3>
                    <div className="space-y-3">
                      {filteredMatches.filter(m => m.stage === 'final' || m.stage === '3rd-4th-play-off').map(match => <MatchCard key={match.id} match={match} />)}
                      {filteredMatches.filter(m => m.stage === 'final' || m.stage === '3rd-4th-play-off').length === 0 && <p className="text-sm text-stone-400 italic">To be determined...</p>}
                    </div>
                  </section>
                </div>

                <div className="lg:col-span-3">
                  <TopScorers goals={data.goals} />
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'report' && (
            <motion.div key="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl mx-auto">
              {!isCaptainAuthenticated ? (
                <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-maroon-700" />Captain Login</h2>
                  <div className="space-y-4">
                    <input type="password" placeholder="Enter Captain Password" value={captainPassword} onChange={(e) => { setCaptainPassword(e.target.value); setCaptainAuthError(false); }} className={cn("w-full bg-stone-50 border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none", captainAuthError ? "border-red-500 bg-red-50" : "border-stone-200")} />
                    {captainAuthError && <p className="text-xs text-red-600 font-bold">Incorrect password.</p>}
                    <button onClick={() => { if (captainPassword === 'Captains') setIsCaptainAuthenticated(true); else setCaptainAuthError(true); }} className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all">Login</button>
                  </div>
                </div>
              ) : (
                <ScoreReporter teams={data.teams} matches={data.matches} isLocalMode={isLocalMode} onRefresh={fetchData} />
              )}
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div key="admin" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              {!isAdminAuthenticated ? (
                <div className="max-w-md mx-auto bg-white p-8 rounded-2xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-maroon-700" />Admin Login</h2>
                  <div className="space-y-4">
                    <input type="password" placeholder="Enter Password" value={adminPassword} onChange={(e) => { setAdminPassword(e.target.value); setAdminAuthError(false); }} className={cn("w-full bg-stone-50 border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none", adminAuthError ? "border-red-500 bg-red-50" : "border-stone-200")} />
                    {adminAuthError && <p className="text-xs text-red-600 font-bold">Incorrect password.</p>}
                    <button onClick={() => { if (adminPassword === 'Tinothedino') setIsAdminAuthenticated(true); else setAdminAuthError(true); }} className="w-full bg-maroon-700 text-white font-bold py-3 rounded-xl hover:bg-maroon-800 transition-all">Login</button>
                  </div>
                </div>
              ) : (
                <AdminPanel teams={data.teams} matches={data.matches} tournamentType={tournamentType} standings={standings} bestSecondPlace={bestSecondPlace} submissions={data.submissions} goals={data.goals} umpires={data.umpires} onRefresh={fetchData} isLocalMode={isLocalMode} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

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
    <button onClick={onClick} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all", active ? "bg-maroon-900 text-white" : "text-maroon-300 hover:bg-maroon-800 hover:text-white")}>
      {icon}{label}
    </button>
  );
}

function MobileTabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-all", active ? "text-white bg-maroon-900" : "text-maroon-400")}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

const MatchCard: React.FC<{ match: Match, isFavorite?: boolean }> = ({ match, isFavorite }) => {
  const isBreak = !match.team1_id && !match.team2_id && match.stage === 'break';
  const team1Display = match.team1_name || (match.team1_id === 0 ? 'TBD' : !match.team1_id ? 'TBD' : 'Unknown');
  const team2Display = match.team2_name || (match.team2_id === 0 ? 'TBD' : !match.team2_id ? 'TBD' : 'Unknown');

  return (
    <div className={cn("p-4 rounded-xl border transition-all relative overflow-hidden", isBreak ? "bg-stone-100 border-stone-300 border-dashed" : match.status === 'completed' ? "bg-stone-50 border-stone-100" : match.status === 'pending' ? "bg-maroon-50 border-maroon-200" : "bg-white border-stone-200", isFavorite && !isBreak && "ring-2 ring-amber-400 ring-inset")}>
      {isFavorite && !isBreak && <div className="absolute top-0 right-0 p-1"><Trophy className="w-3 h-3 text-amber-500 fill-current" /></div>}
      <div className="flex justify-between items-center mb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{match.stage.replace('-', ' ')}</span>
            {!isBreak && <span className={cn("text-[8px] font-black uppercase px-1.5 py-0.5 rounded border", match.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200")}>{match.tournament_type}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold text-maroon-700 flex items-center gap-1"><Clock className="w-3 h-3" />{match.match_date ? `${formatDate(match.match_date)} ${match.start_time}` : match.start_time || 'TBD'}</span>
            {match.pitch && <span className="text-[10px] font-bold text-stone-500 flex items-center gap-1"><ChevronRight className="w-3 h-3" />Pitch {match.pitch}</span>}
            {match.umpire && <span className="text-[10px] font-medium text-stone-400 flex items-center gap-1 border-l border-stone-200 pl-2">Umpire: {match.umpire}</span>}
          </div>
        </div>
        {!isBreak && match.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-maroon-600" />}
        {!isBreak && match.status === 'pending' && <AlertCircle className="w-3 h-3 text-maroon-500" />}
      </div>
      {isBreak ? (
        <div className="flex items-center justify-center py-2"><span className="text-sm font-black text-stone-400 uppercase tracking-widest">{match.stage}</span></div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 flex flex-col items-center text-center"><span className="text-sm font-bold text-stone-800 line-clamp-1">{team1Display}</span></div>
          <div className="flex items-center gap-3 px-3 py-1 bg-stone-100 rounded-lg">
            <span className={cn("text-lg font-black", match.status === 'completed' ? "text-stone-900" : "text-stone-300")}>{match.status === 'completed' ? match.score1 : '-'}</span>
            <span className="text-stone-300 font-bold">:</span>
            <span className={cn("text-lg font-black", match.status === 'completed' ? "text-stone-900" : "text-stone-300")}>{match.status === 'completed' ? match.score2 : '-'}</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center"><span className="text-sm font-bold text-stone-800 line-clamp-1">{team2Display}</span></div>
        </div>
      )}
    </div>
  );
}

function LiveDashboard({ matches }: { matches: Match[] }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  const venueInfo = useMemo(() => {
    const today = now.toISOString().split('T')[0];
    const matchDates = Array.from(new Set(matches.map(m => m.match_date).filter(Boolean))).sort();
    const activeDate = matchDates.includes(today) ? today : matchDates[0] || today;
    if (activeDate === '2026-03-07') return { name: 'Badminton School', pitches: ['1', '2'], details: 'One pitch divided in half' };
    if (activeDate === '2026-03-08') return { name: 'Coombe Dingle Sports Ground', pitches: ['1', '2', '3', '4'], details: 'Upper Astro: Pitch 1 & 2 (Chill) | Lower Astro: Pitch 3 & 4 (Competitive)' };
    return { name: 'Tournament Venue', pitches: ['1', '2'], details: '' };
  }, [matches, now]);

  // One match per pitch: currently playing, or next up if nothing in progress
  const currentMatchByPitch = useMemo(() => {
    const nowMins = toMins(now.toTimeString().slice(0, 5));
    const currentDateStr = now.toISOString().split('T')[0];
    const map: Record<string, { match: Match, isLive: boolean } | null> = {};

    venueInfo.pitches.forEach(pitch => {
      const candidates = matches.filter(m =>
        m.pitch === pitch &&
        m.team1_id &&
        m.start_time &&
        m.status !== 'completed' &&
        (!m.match_date || m.match_date === currentDateStr)
      );

      // In progress: started within last 30 mins
      const live = candidates.find(m => {
        const s = toMins(m.start_time!);
        return nowMins >= s && nowMins < s + 30;
      });
      if (live) { map[pitch] = { match: live, isLive: true }; return; }

      // Next upcoming
      const next = candidates
        .filter(m => toMins(m.start_time!) > nowMins)
        .sort((a, b) => toMins(a.start_time!) - toMins(b.start_time!))[0];
      map[pitch] = next ? { match: next, isLive: false } : null;
    });
    return map;
  }, [matches, now, venueInfo.pitches]);

  const upcomingMatches = useMemo(() => {
    const currentTimeStr = now.toTimeString().slice(0, 5);
    const currentDateStr = now.toISOString().split('T')[0];
    return matches.filter(m => {
      if (!m.start_time || m.status === 'completed' || !m.team1_id) return false;
      if (m.match_date && m.match_date > currentDateStr) return true;
      if (m.match_date && m.match_date < currentDateStr) return false;
      return toMins(m.start_time) > toMins(currentTimeStr);
    }).sort((a, b) => (a.match_date || '').localeCompare(b.match_date || '') || (a.start_time || '').localeCompare(b.start_time || '')).slice(0, 6);
  }, [matches, now]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1"><MapPin className="w-4 h-4 text-maroon-700" /><span className="text-xs font-black uppercase tracking-widest text-maroon-700">{venueInfo.name}</span></div>
          <h2 className="text-3xl font-black text-stone-900 tracking-tight">Live</h2>
          <p className="text-stone-500 font-medium">{venueInfo.details || 'Real-time updates from all pitches'}</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-xl border border-stone-200 shadow-sm flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-bold text-stone-700">{now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} • {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="bg-maroon-900 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-black uppercase tracking-widest flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />Pitch Status</h2>
          <span className="text-maroon-300 text-[10px] font-bold uppercase">Live Updates</span>
        </div>
        <div className={cn("grid divide-stone-100", venueInfo.pitches.length === 2 ? "grid-cols-2 divide-x" : "grid-cols-2 lg:grid-cols-4 divide-x divide-y")}>
          {venueInfo.pitches.map(pitch => {
            const entry = currentMatchByPitch[pitch];
            const isUpper = (pitch === '1' || pitch === '2') && venueInfo.name.includes('Coombe');
            const isLower = (pitch === '3' || pitch === '4') && venueInfo.name.includes('Coombe');
            return (
              <div key={pitch} className="flex flex-col relative">
                {isUpper && <div className="bg-stone-100 py-1 text-center text-[8px] font-black uppercase tracking-tighter text-stone-400">Upper Astro</div>}
                {isLower && <div className="bg-stone-100 py-1 text-center text-[8px] font-black uppercase tracking-tighter text-stone-400">Lower Astro</div>}
                <div className="p-6 flex flex-col items-center text-center flex-1">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Pitch {pitch}</span>
                    {entry?.isLive && <span className="flex items-center gap-1 text-[9px] font-black text-red-500 uppercase"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />Live</span>}
                  </div>
                  {entry ? (
                    <div className="w-full rounded-xl border overflow-hidden" style={{ borderColor: entry.isLive ? '#991b1b' : '#e7e5e4' }}>
                      <div className={cn("px-3 py-1.5 flex items-center justify-between", entry.isLive ? "bg-maroon-900" : "bg-stone-100")}>
                        <span className={cn("text-[10px] font-black uppercase", entry.isLive ? "text-maroon-300" : "text-stone-400")}>{entry.match.tournament_type}</span>
                        <span className={cn("text-[10px] font-black", entry.isLive ? "text-white" : "text-stone-500")}>
                          {entry.match.start_time}
                          {!entry.isLive && <span className="ml-1 text-stone-400">— up next</span>}
                        </span>
                      </div>
                      <div className="p-4 space-y-2 bg-white">
                        <div className="text-sm font-black text-stone-900 leading-tight">{entry.match.team1_name}</div>
                        <div className="text-[10px] font-black text-stone-300 uppercase tracking-widest">vs</div>
                        <div className="text-sm font-black text-stone-900 leading-tight">{entry.match.team2_name}</div>
                        {entry.match.umpire && (
                          <div className="pt-2 border-t border-stone-100 text-[10px] text-stone-400 font-medium">Umpire: {entry.match.umpire}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" /></div>
                      <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">Available</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {upcomingMatches.length > 0 && (
        <section className="bg-black rounded-2xl p-6 shadow-xl border border-stone-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-black uppercase tracking-widest flex items-center gap-2"><Clock className="w-4 h-4 text-maroon-500" />Coming Up</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingMatches.map(match => (
              <div key={match.id} className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                <div className="text-center shrink-0">
                  <div className="text-maroon-400 font-black text-sm">{match.start_time}</div>
                  <div className="text-stone-500 text-[10px] font-bold">P{match.pitch}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-white text-xs font-bold truncate">{match.team1_name}</div>
                  <div className="text-stone-500 text-[9px] font-black uppercase my-0.5">vs</div>
                  <div className="text-white text-xs font-bold truncate">{match.team2_name}</div>
                </div>
                <span className={cn("ml-auto shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded", match.tournament_type === 'competitive' ? "bg-maroon-900 text-maroon-300" : "bg-stone-800 text-stone-400")}>{match.tournament_type === 'competitive' ? 'Comp' : 'Chill'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TopScorers({ goals }: { goals: Goal[] }) {
  const scorerStats = useMemo(() => {
    const stats: Record<string, { name: string, team: string, count: number, tournament_type: string }> = {};
    goals.forEach(goal => {
      if (!stats[goal.player_name]) {
        stats[goal.player_name] = { name: goal.player_name, team: goal.team_name || 'Unknown', count: 0, tournament_type: goal.tournament_type || 'Unknown' };
      }
      stats[goal.player_name].count++;
    });
    return Object.values(stats).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [goals]);

  return (
    <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 className="font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-maroon-700" />Top Goal Scorers</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 text-stone-500 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-3">Player</th><th className="px-6 py-3">Team</th><th className="px-6 py-3">Tournament</th><th className="px-6 py-3 text-center">Goals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {scorerStats.map((player) => (
              <tr key={player.name} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-4 font-bold text-stone-800">{player.name}</td>
                <td className="px-6 py-4 text-sm text-stone-500">{player.team}</td>
                <td className="px-6 py-4"><span className={cn("text-[10px] font-black uppercase px-1.5 py-0.5 rounded border", player.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200")}>{player.tournament_type}</span></td>
                <td className="px-6 py-4 text-center font-black text-maroon-800">{player.count}</td>
              </tr>
            ))}
            {scorerStats.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400 italic">No goals recorded yet</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ScoreReporter: React.FC<{ teams: Team[], matches: Match[], isLocalMode: boolean, onRefresh: () => void }> = ({ teams, matches, isLocalMode, onRefresh }) => {
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
    return matches.filter(m => (m.team1_id === captainTeamId || m.team2_id === captainTeamId) && m.status !== 'completed' && m.team1_id && m.team2_id);
  }, [matches, captainTeamId]);

  const selectedMatch = matches.find(m => m.id === Number(selectedMatchId));

  useEffect(() => {
    if (!selectedMatch || !selectedTeamId) return;
    const teamScore = Number(selectedTeamId) === selectedMatch.team1_id ? score1 : score2;
    setScorers(prev => {
      const next = [...prev];
      if (next.length < teamScore) { while (next.length < teamScore) next.push(''); }
      else if (next.length > teamScore) { return next.slice(0, teamScore); }
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
        storage.submitScore({ match_id: Number(selectedMatchId), team_id: Number(selectedTeamId), score1, score2, scorers: scorers.filter(s => s.trim() !== '') });
        onRefresh();
      } else {
        const res = await fetch('/api/submit-score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: Number(selectedMatchId), team_id: Number(selectedTeamId), score1, score2, scorers: scorers.filter(s => s.trim() !== '') }) });
        if (!res.ok) throw new Error('Submission failed');
      }
      setMessage({ type: 'success', text: 'Score submitted! Waiting for other team to confirm.' });
      setSelectedMatchId(''); setScore1(0); setScore2(0); setScorers([]);
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
            <button key={team.id} onClick={() => { setCaptainTeamId(team.id); setSelectedTeamId(team.id.toString()); }} className="p-4 text-left bg-stone-50 border border-stone-200 rounded-xl hover:border-maroon-500 hover:bg-maroon-50 transition-all">
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-800">{team.name}</span>
                <span className={cn("text-[10px] font-black uppercase px-2 py-1 rounded", team.tournament_type === 'competitive' ? "bg-maroon-100 text-maroon-700" : "bg-stone-200 text-stone-600")}>{team.tournament_type}</span>
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
          <div className="bg-maroon-100 p-2 rounded-lg"><ShieldCheck className="w-6 h-6 text-maroon-700" /></div>
          <div>
            <h2 className="text-xl font-bold">Report for {teams.find(t => t.id === captainTeamId)?.name}</h2>
            <p className="text-sm text-stone-500">Submit scores for your outstanding matches.</p>
          </div>
        </div>
        <button onClick={() => setCaptainTeamId(null)} className="text-xs font-bold text-maroon-700 hover:underline">Change Team</button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Select Match</label>
          <select value={selectedMatchId} onChange={(e) => setSelectedMatchId(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none" required>
            <option value="">-- Choose a match --</option>
            {teamMatches.map(m => <option key={m.id} value={m.id}>{m.team1_name} vs {m.team2_name} ({m.stage}) - {m.start_time}</option>)}
          </select>
          {teamMatches.length === 0 && <p className="text-xs text-stone-400 italic">No outstanding matches for your team.</p>}
        </div>
        {selectedMatch && (
          <div className="space-y-6">
            <div className="bg-stone-50 rounded-2xl p-6 border border-stone-100">
              <div className="flex items-center justify-center gap-8">
                <div className="flex flex-col items-center gap-3">
                  <span className="text-sm font-bold text-stone-600">{selectedMatch.team1_name}</span>
                  <input type="number" min="0" value={score1} onChange={(e) => setScore1(Number(e.target.value))} className="w-20 h-20 text-center text-3xl font-black bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-maroon-500 outline-none" />
                </div>
                <span className="text-2xl font-black text-stone-300 mt-8">:</span>
                <div className="flex flex-col items-center gap-3">
                  <span className="text-sm font-bold text-stone-600">{selectedMatch.team2_name}</span>
                  <input type="number" min="0" value={score2} onChange={(e) => setScore2(Number(e.target.value))} className="w-20 h-20 text-center text-3xl font-black bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-maroon-500 outline-none" />
                </div>
              </div>
            </div>
            {scorers.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider">Goal Scorers (Your Team)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {scorers.map((name, idx) => (
                    <div key={idx} className="space-y-1">
                      <label className="text-[10px] font-bold text-stone-400">Scorer {idx + 1}</label>
                      <input type="text" placeholder="e.g. John Smith" value={name} onChange={(e) => { const next = [...scorers]; next[idx] = e.target.value; setScorers(next); }} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none" required />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button type="submit" disabled={submitting} className="w-full bg-maroon-700 text-white font-bold py-4 rounded-xl hover:bg-maroon-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? 'Submitting...' : 'Submit Result'}
            </button>
          </div>
        )}
        {message && (
          <div className={cn("p-4 rounded-xl text-sm font-medium flex items-center gap-3", message.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100")}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
};

const TOURNAMENT_SLOTS: Record<string, Record<'chill' | 'competitive', string[]>> = {
  '2026-03-07': { chill: ['09:00','09:20','09:40','10:00','10:20','10:40','11:00','11:20','11:40','12:00','12:20','12:40'], competitive: ['09:10','09:35','10:00','10:25','10:50','11:15','11:40','12:05','12:30'] },
  '2026-03-08': { chill: ['11:30','11:50','12:10','12:30','12:50','13:10','13:30'], competitive: ['12:00','12:25','12:50','13:15','13:40'] }
};

function AdminPanel({ teams, matches, tournamentType, standings, bestSecondPlace, submissions, goals, umpires, onRefresh, isLocalMode }: {
  teams: Team[], matches: Match[], tournamentType: TournamentType, standings: Record<string, any[]>, bestSecondPlace: any, submissions: Submission[], goals: Goal[], umpires: {id: number, name: string}[], onRefresh: () => void, isLocalMode: boolean
}) {
  const [newTeamName, setNewTeamName] = useState('');
  const [newUmpireName, setNewUmpireName] = useState('');
  const [confirmDeleteUmpireId, setConfirmDeleteUmpireId] = useState<number | null>(null);
  const [extraMatchTeam1, setExtraMatchTeam1] = useState<number | null>(null);
  const [extraMatchTeam2, setExtraMatchTeam2] = useState<number | null>(null);
  const [extraMatchGroup, setExtraMatchGroup] = useState<string>('');
  const [newTeamGroup, setNewTeamGroup] = useState('Group 1');
  const [editingMatchId, setEditingMatchId] = useState<number | null>(null);
  const [editScore1, setEditScore1] = useState(0);
  const [editScore2, setEditScore2] = useState(0);
  const [editStatus, setEditStatus] = useState<'scheduled' | 'pending' | 'completed'>('scheduled');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editPitch, setEditPitch] = useState('');
  const [editUmpire, setEditUmpire] = useState('');
  const [isSavingMatch, setIsSavingMatch] = useState<number | null>(null);

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

  // Goal management state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editGoalName, setEditGoalName] = useState('');
  const [confirmDeleteGoalId, setConfirmDeleteGoalId] = useState<string | null>(null);
  const [newGoalMatchId, setNewGoalMatchId] = useState<number | null>(null);
  const [newGoalTeamId, setNewGoalTeamId] = useState<number | null>(null);
  const [newGoalPlayerName, setNewGoalPlayerName] = useState('');

  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamGroup, setEditTeamGroup] = useState('');


  const [confirmDeleteMatchId, setConfirmDeleteMatchId] = useState<number | null>(null);

  const filteredTeams = teams.filter(t => t.tournament_type === tournamentType);
  const filteredMatches = matches.filter(m => m.tournament_type === tournamentType);
  const allMatches = matches;
  const searchedMatches = allMatches.filter(m =>
    m.tournament_type === tournamentType &&
    (m.team1_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.team2_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.umpire?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.stage?.toLowerCase().includes(matchSearch.toLowerCase()))
  );

  // Group goals by player+team for the management UI
  const groupedGoals = useMemo(() => {
    const groups: Record<string, { key: string, playerName: string, teamName: string, teamId: number, tournamentType: string, goals: Goal[] }> = {};
    goals.forEach(goal => {
      const key = `${goal.player_name}__${goal.team_id}`;
      if (!groups[key]) {
        groups[key] = { key, playerName: goal.player_name, teamName: goal.team_name || 'Unknown', teamId: goal.team_id, tournamentType: goal.tournament_type || '', goals: [] };
      }
      groups[key].goals.push(goal);
    });
    return Object.values(groups).sort((a, b) => b.goals.length - a.goals.length || a.playerName.localeCompare(b.playerName));
  }, [goals]);



  const updateTeam = async (id: number, name: string, group_name: string) => {
    if (isLocalMode) { storage.updateTeam(id, { name, group_name }); onRefresh(); }
    else { await fetch('/api/admin/update-team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, group_name }) }); onRefresh(); }
    setEditingTeamId(null);
  };

  const addTeam = async () => {
    if (!newTeamName) return;
    try {
      if (isLocalMode) { storage.addTeam({ name: newTeamName, tournament_type: tournamentType, group_name: newTeamGroup }); }
      else { const res = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newTeamName, tournament_type: tournamentType, group_name: newTeamGroup }) }); if (!res.ok) throw new Error('Failed to add team'); }
      setNewTeamName(''); onRefresh();
    } catch (err: any) { alert(`Error adding team: ${err.message}`); }
  };

  const removeTeam = async (id: number) => {
    if (isLocalMode) { storage.deleteTeam(id); }
    else { await fetch(`/api/teams/${id}`, { method: 'DELETE' }); }
    onRefresh();
  };

  const generateSchedule = async () => {
    if (filteredTeams.length < 2) return;
    const groups = [...new Set(filteredTeams.map(t => t.group_name).filter(Boolean))];
    if (groups.length === 0) groups.push('');
    let created = 0;
    let errors: string[] = [];
    for (const g of groups) {
      const groupTeams = g ? filteredTeams.filter(t => t.group_name === g) : filteredTeams;
      for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
          if (isLocalMode) {
            storage.addMatch({ team1_id: groupTeams[i].id, team2_id: groupTeams[j].id, tournament_type: tournamentType, start_time: 'TBD', stage: 'round-robin', team1_name: groupTeams[i].name, team2_name: groupTeams[j].name });
            created++;
          } else {
            const res = await fetch('/api/admin/add-match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ team1_id: groupTeams[i].id, team2_id: groupTeams[j].id, tournament_type: tournamentType, stage: 'round-robin', status: 'scheduled' })
            });
            if (res.ok) created++;
            else { const err = await res.json(); errors.push(`${groupTeams[i].name} vs ${groupTeams[j].name}: ${err.error}`); }
          }
        }
      }
    }
    if (errors.length > 0) alert(`Some matches failed:\n${errors.join('\n')}`);
    onRefresh();
  };

  const forceApprove = async (submissionId: number) => {
    if (isLocalMode) { const sub = submissions.find(s => s.id === submissionId); if (sub) storage.updateMatch(sub.match_id, { score1: sub.score1, score2: sub.score2, status: 'completed' }); }
    else { await fetch('/api/admin/force-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submission_id: submissionId }) }); }
    onRefresh();
  };

  const resetData = async () => {
    setIsResetting(true);
    if (isLocalMode) { storage.reset(); }
    else { await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournament_type: tournamentType }) }); }
    setIsResetting(false); onRefresh();
  };

  const updateMatch = async (matchId: number | null) => {
    if (matchId === null) return;
    setIsSavingMatch(matchId);
    try {
      if (isLocalMode) { storage.updateMatch(matchId, { score1: isNaN(editScore1) ? 0 : editScore1, score2: isNaN(editScore2) ? 0 : editScore2, status: editStatus, match_date: editDate, start_time: editStartTime, pitch: editPitch, umpire: editUmpire }); }
      else {
        const res = await fetch('/api/admin/update-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: matchId, score1: isNaN(editScore1) ? 0 : editScore1, score2: isNaN(editScore2) ? 0 : editScore2, status: editStatus, match_date: editDate, start_time: editStartTime, pitch: editPitch, umpire: editUmpire }) });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      }
      setEditingMatchId(null); onRefresh();
    } catch (err: any) { alert(`Failed to save match updates: ${err.message}`); }
    finally { setIsSavingMatch(null); }
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
      if (isLocalMode) { storage.updateMatch(match.id, { match_date: bulkDate, start_time: timeStr, pitch: bulkPitch }); }
      else { await fetch('/api/admin/update-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: match.id, score1: match.score1, score2: match.score2, status: match.status, match_date: bulkDate, start_time: timeStr, pitch: bulkPitch, umpire: match.umpire }) }); }
      currentTime = new Date(currentTime.getTime() + bulkInterval * 60000);
    }
    setSelectedBulkMatchIds([]); onRefresh();
  };

  const addBreak = async () => {
    if (!breakLabel || !breakTime) return;
    if (isLocalMode) {
      storage.addMatch({ tournament_type: tournamentType, match_date: breakDate, start_time: breakTime, pitch: breakPitch, stage: breakLabel, team1_id: 0, team2_id: 0 });
      const d = storage.getData(); const last = d.matches[d.matches.length - 1];
      storage.updateMatch(last.id, { status: 'completed' });
    } else {
      await fetch('/api/admin/add-break', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournament_type: tournamentType, match_date: breakDate, start_time: breakTime, pitch: breakPitch, stage: breakLabel }) });
    }
    setBreakLabel(''); setBreakTime(''); setBreakPitch(''); onRefresh();
  };

  const deleteMatch = async (matchId: number) => {
    try {
      if (isLocalMode) { storage.deleteMatch(matchId); }
      else { const res = await fetch(`/api/admin/matches/${matchId}`, { method: 'DELETE' }); if (!res.ok) throw new Error('Failed to delete match'); }
      setConfirmDeleteMatchId(null); onRefresh();
    } catch (err: any) { alert(`Error deleting match: ${err.message}`); }
  };

  const updateGoal = async (goalId: number, newName: string) => {
    try {
      if (isLocalMode) { storage.updateGoal(goalId, newName); }
      else { const res = await fetch('/api/admin/update-goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: goalId, player_name: newName }) }); if (!res.ok) throw new Error('Failed'); }
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const deleteGoal = async (goalId: number) => {
    try {
      if (isLocalMode) { storage.deleteGoal(goalId); }
      else { const res = await fetch(`/api/admin/goals/${goalId}`, { method: 'DELETE' }); if (!res.ok) throw new Error('Failed'); }
      setConfirmDeleteGoalId(null); onRefresh();
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  // Delete ALL goals for a player (used when reducing goal count to 0)
  const deleteAllGoalsForPlayer = async (goalIds: number[]) => {
    for (const id of goalIds) {
      if (isLocalMode) { storage.deleteGoal(id); }
      else { await fetch(`/api/admin/goals/${id}`, { method: 'DELETE' }); }
    }
    setConfirmDeleteGoalId(null); onRefresh();
  };

  const addGoalForPlayer = async (matchId: number, teamId: number, playerName: string) => {
    try {
      if (isLocalMode) { storage.addGoal({ match_id: matchId, team_id: teamId, player_name: playerName }); }
      else { await fetch('/api/admin/add-goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: matchId, team_id: teamId, player_name: playerName }) }); }
      onRefresh();
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const addGoal = async () => {
    if (!newGoalMatchId || !newGoalTeamId || !newGoalPlayerName) return;
    try {
      if (isLocalMode) { storage.addGoal({ match_id: newGoalMatchId, team_id: newGoalTeamId, player_name: newGoalPlayerName }); }
      else { await fetch('/api/admin/add-goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: newGoalMatchId, team_id: newGoalTeamId, player_name: newGoalPlayerName }) }); }
      setNewGoalPlayerName(''); onRefresh();
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const addExtraMatch = async () => {
    if (extraMatchTeam1 === null || extraMatchTeam2 === null || extraMatchTeam1 === extraMatchTeam2) return;
    if (isLocalMode) {
      const t1 = filteredTeams.find(t => t.id === extraMatchTeam1);
      const t2 = filteredTeams.find(t => t.id === extraMatchTeam2);
      storage.addMatch({ team1_id: extraMatchTeam1, team2_id: extraMatchTeam2, tournament_type: tournamentType, start_time: 'TBD', stage: 'round-robin', team1_name: t1?.name, team2_name: t2?.name });
    } else {
      const res = await fetch('/api/admin/add-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team1_id: extraMatchTeam1, team2_id: extraMatchTeam2, tournament_type: tournamentType, stage: 'round-robin', status: 'scheduled' }) });
      if (!res.ok) { const err = await res.json(); alert(err.error); return; }
    }
    setExtraMatchTeam1(null); setExtraMatchTeam2(null);
    onRefresh();
  };

  const addUmpire = async () => {
    if (!newUmpireName.trim()) return;
    try {
      const res = await fetch('/api/umpires', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newUmpireName.trim() }) });
      if (!res.ok) { const err = await res.json(); alert(err.error); return; }
      setNewUmpireName(''); onRefresh();
    } catch (err: any) { alert(err.message); }
  };

  const deleteUmpire = async (id: number) => {
    try {
      await fetch(`/api/umpires/${id}`, { method: 'DELETE' });
      setConfirmDeleteUmpireId(null); onRefresh();
    } catch (err: any) { alert(err.message); }
  };

  const preGenerateKnockouts = async () => {
    const stages = tournamentType === 'competitive'
      ? ['play-off-8v9', 'quarter-final', 'quarter-final', 'quarter-final', 'quarter-final', 'semi-final', 'semi-final', 'final', '3rd-4th-play-off']
      : ['semi-final', 'semi-final', 'final', '3rd-4th-play-off'];

    for (const stage of stages) {
      const matchData = { team1_id: null, team2_id: null, tournament_type: tournamentType, stage, status: 'scheduled' };
      if (isLocalMode) { storage.addMatches([matchData as any]); }
      else {
        const res = await fetch('/api/admin/add-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(matchData) });
        if (!res.ok) { const err = await res.json(); console.error('Failed to create slot:', err); alert(`Error creating ${stage} slot: ${err.error}`); return; }
      }
    }
    onRefresh();
  };

  const fillTeamsFromStandings = async () => {
    const groupEntries = Object.entries(standings) as [string, any[]][];
    if (groupEntries.length === 0) { alert('No standings data yet — complete some group stage matches first.'); return; }

    // Rank by position across groups: all 1st places sorted by pts/GD/GF, then all 2nd places, etc.
    const maxTeamsPerGroup = Math.max(...groupEntries.map(([, g]) => g.length));
    const rankedTeams: any[] = [];
    for (let pos = 0; pos < maxTeamsPerGroup; pos++) {
      const teamsAtPos = groupEntries
        .map(([, group]) => group[pos])
        .filter(Boolean)
        .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      rankedTeams.push(...teamsAtPos);
    }

    if (rankedTeams.length < 2) { alert('Not enough teams in standings to fill knockout slots.'); return; }

    const res = await fetch('/api/fill-knockout-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_type: tournamentType, teams: rankedTeams })
    });
    if (!res.ok) { const err = await res.json(); alert(`Error: ${err.error}`); return; }
    const result = await res.json();
    alert(`Done! Filled ${result.filled} knockout slot${result.filled !== 1 ? 's' : ''}.`);
    onRefresh();
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Umpire Management */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:col-span-2">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Users className="w-5 h-5 text-maroon-700" />Umpire Management</h3>
          <div className="flex flex-col sm:flex-row gap-2 mb-6">
            <input
              type="text"
              placeholder="Umpire Full Name"
              value={newUmpireName}
              onChange={(e) => setNewUmpireName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addUmpire(); }}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
            />
            <button onClick={addUmpire} disabled={!newUmpireName.trim()} className="bg-maroon-700 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-maroon-800 transition-all disabled:opacity-50 whitespace-nowrap">Add Umpire</button>
          </div>
          {umpires.length === 0 ? (
            <p className="text-center text-stone-400 text-sm italic py-4">No umpires added yet</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {umpires.map(umpire => (
                <div key={umpire.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-100">
                  <span className="font-medium text-sm text-stone-800 truncate">{umpire.name}</span>
                  {confirmDeleteUmpireId === umpire.id ? (
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <button onClick={() => deleteUmpire(umpire.id)} className="bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded">Yes</button>
                      <button onClick={() => setConfirmDeleteUmpireId(null)} className="bg-stone-200 text-stone-600 text-[10px] font-bold px-2 py-1 rounded">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteUmpireId(umpire.id)} className="ml-2 shrink-0 p-1 text-stone-300 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Team Management */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Users className="w-5 h-5 text-maroon-700" />Team Management ({tournamentType})</h3>
          <div className="flex flex-col sm:flex-row gap-2 mb-6">
            <input type="text" placeholder="Team Name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none" />
            <input type="text" placeholder="Group" value={newTeamGroup} onChange={(e) => setNewTeamGroup(e.target.value)} className="w-full sm:w-32 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none" />
            <button onClick={addTeam} className="bg-maroon-700 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-maroon-800 transition-all whitespace-nowrap">Add Team</button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {filteredTeams.map(team => (
              <div key={team.id} className="flex justify-between items-center p-3 bg-stone-50 rounded-lg border border-stone-100">
                <div className="flex-1 flex items-center gap-2">
                  {editingTeamId === team.id ? (
                    <div className="flex flex-1 gap-2">
                      <input type="text" value={editTeamName} onChange={e => setEditTeamName(e.target.value)} className="flex-1 bg-white border border-maroon-300 rounded px-2 py-1 text-sm" />
                      <input type="text" value={editTeamGroup} onChange={e => setEditTeamGroup(e.target.value)} className="w-24 bg-white border border-maroon-300 rounded px-2 py-1 text-sm" />
                      <button onClick={() => updateTeam(team.id, editTeamName, editTeamGroup)} className="bg-maroon-700 text-white px-2 py-1 rounded text-[10px] font-bold">Save</button>
                    </div>
                  ) : (
                    <>
                      <span className="text-[10px] font-black bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">{team.group_name}</span>
                      <span className="font-medium text-sm text-stone-800">{team.name}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingTeamId !== team.id && <button onClick={() => { setEditingTeamId(team.id); setEditTeamName(team.name); setEditTeamGroup(team.group_name || ''); }} className="p-2 text-stone-400 hover:text-maroon-700"><Edit2 className="w-4 h-4" /></button>}
                  {confirmDeleteId === team.id ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => { removeTeam(team.id); setConfirmDeleteId(null); }} className="bg-red-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg">Confirm</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="bg-stone-200 text-stone-600 text-[10px] font-bold px-3 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(team.id)} className="inline-flex items-center gap-2 bg-stone-100 text-stone-400 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-xl transition-all">
                      <Trash2 className="w-4 h-4" /><span className="text-xs font-bold">Delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {filteredTeams.length === 0 && <p className="text-center text-stone-400 text-sm italic py-4">No teams added</p>}
          </div>
        </section>



        {/* Bulk Scheduler */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Clock className="w-5 h-5 text-maroon-700" />Bulk Scheduler ({tournamentType})</h3>
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Date</label><input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Start Time</label><input type="time" value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Finish Time</label><input type="time" value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Interval (min)</label><input type="number" value={bulkInterval} onChange={(e) => setBulkInterval(Number(e.target.value))} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitch</label>
                <select value={bulkPitch} onChange={(e) => setBulkPitch(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none">
                  <option value="1">Pitch 1</option><option value="2">Pitch 2</option><option value="3">Pitch 3</option><option value="4">Pitch 4</option>
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-500 uppercase">Select Matches to Schedule</label>
                <div className="flex gap-3">
                  <button onClick={() => setSelectedBulkMatchIds(filteredMatches.filter(m => !m.start_time || !m.pitch).map(m => m.id))} className="text-[10px] font-bold text-stone-400 hover:text-maroon-700 uppercase">Select All</button>
                  <button onClick={() => setSelectedBulkMatchIds([])} className="text-[10px] font-bold text-stone-400 hover:text-maroon-700 uppercase">Clear</button>
                  <span className="text-[10px] font-bold text-maroon-700 bg-maroon-50 px-2 py-1 rounded-full">{selectedBulkMatchIds.length} Selected</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 border border-stone-100 rounded-xl">
                {filteredMatches.filter(m => !m.start_time || !m.pitch).map(match => (
                  <label key={match.id} className={cn("flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all", selectedBulkMatchIds.includes(match.id) ? "bg-maroon-50 border-maroon-200 ring-1 ring-maroon-200" : "bg-white border-stone-100 hover:border-stone-200")}>
                    <input type="checkbox" checked={selectedBulkMatchIds.includes(match.id)} onChange={() => { if (selectedBulkMatchIds.includes(match.id)) setSelectedBulkMatchIds(selectedBulkMatchIds.filter(id => id !== match.id)); else setSelectedBulkMatchIds([...selectedBulkMatchIds, match.id]); }} className="hidden" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold text-stone-400 uppercase truncate">{match.stage}</div>
                      <div className="text-xs font-bold text-stone-800 truncate">{match.team1_name || 'TBD'} vs {match.team2_name || 'TBD'}</div>
                    </div>
                    {selectedBulkMatchIds.includes(match.id) && <div className="w-5 h-5 rounded-full bg-maroon-700 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{selectedBulkMatchIds.indexOf(match.id) + 1}</div>}
                  </label>
                ))}
                {filteredMatches.filter(m => !m.start_time || !m.pitch).length === 0 && <div className="col-span-full py-8 text-center text-stone-400 italic text-sm">No unassigned matches found</div>}
              </div>
            </div>
            <button onClick={bulkSchedule} disabled={selectedBulkMatchIds.length === 0} className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all disabled:opacity-50">Schedule Selected Matches</button>
          </div>
        </section>

        {/* Knockout Phase */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Trophy className="w-5 h-5 text-maroon-700" />Knockout Phase Scheduler</h3>
          <div className="space-y-4">
            {allMatches.filter(m => m.tournament_type === tournamentType && m.stage !== 'round-robin' && m.stage !== 'break').length === 0 && (
              <div className="text-center py-6 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                <p className="text-sm text-stone-400 italic">No knockout matches yet. Use "Pre-Generate Knockout Slots" in Tournament Controls below.</p>
              </div>
            )}
            {allMatches.filter(m => m.tournament_type === tournamentType && m.stage !== 'round-robin' && m.stage !== 'break').map(match => (
              <div key={match.id} className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-maroon-700 uppercase bg-maroon-50 px-2 py-0.5 rounded-full">{match.stage.replace('-', ' ')}</span>
                    {(!match.team1_id || !match.team2_id) && <span className="text-[10px] font-bold text-amber-600 uppercase bg-amber-50 px-2 py-0.5 rounded-full">TBD</span>}
                  </div>
                  <div className="text-sm font-bold text-stone-800 truncate">{match.team1_name || 'TBD'} vs {match.team2_name || 'TBD'}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] font-bold text-stone-400"><Clock className="w-3 h-3 inline mr-1" />{match.match_date ? `${formatDate(match.match_date)} ${match.start_time}` : match.start_time || 'TBD'}</span>
                    <span className="text-[10px] font-bold text-stone-400"><MapPin className="w-3 h-3 inline mr-1" />Pitch {match.pitch || 'TBD'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditingMatchId(match.id); setEditScore1(match.score1); setEditScore2(match.score2); setEditStatus(match.status); setEditDate(match.match_date || '2026-03-07'); setEditStartTime(match.start_time || ''); setEditPitch(match.pitch || ''); setEditUmpire(match.umpire || ''); }} className="p-2 text-stone-400 hover:text-maroon-700 hover:bg-maroon-50 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></button>
                  {confirmDeleteMatchId === match.id ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => deleteMatch(match.id)} className="bg-red-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg">Confirm</button>
                      <button onClick={() => setConfirmDeleteMatchId(null)} className="bg-stone-200 text-stone-600 text-[10px] font-bold px-3 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteMatchId(match.id)} className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Add Break */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Clock className="w-5 h-5 text-maroon-700" />Add Break / Gap</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-500 uppercase">Label</label>
              <input type="text" value={breakLabel} onChange={(e) => setBreakLabel(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Date</label><input type="date" value={breakDate} onChange={(e) => setBreakDate(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-500 uppercase">Time</label><input type="time" value={breakTime} onChange={(e) => setBreakTime(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" /></div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitch (Optional)</label>
                <select value={breakPitch} onChange={(e) => setBreakPitch(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none">
                  <option value="">None</option><option value="1">Pitch 1</option><option value="2">Pitch 2</option><option value="3">Pitch 3</option><option value="4">Pitch 4</option>
                </select>
              </div>
            </div>
            <button onClick={addBreak} className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all">Add Break to Schedule</button>
          </div>
        </section>
      </div>

      {/* Tournament Controls */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Calendar className="w-5 h-5 text-maroon-700" />Tournament Controls</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button onClick={generateSchedule} disabled={filteredTeams.length < 2} className="flex items-center justify-center gap-2 bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 disabled:bg-stone-200 transition-all text-xs">
            <RefreshCw className="w-4 h-4" />Generate Round Robin
          </button>

          <button onClick={preGenerateKnockouts} className="flex items-center justify-center gap-2 bg-stone-800 text-white py-3 rounded-xl font-bold hover:bg-black transition-all text-xs">
            <Plus className="w-4 h-4" />Pre-Generate Knockout Slots
          </button>

          <button onClick={fillTeamsFromStandings} disabled={Object.keys(standings).length === 0} className="flex items-center justify-center gap-2 bg-blue-700 text-white py-3 rounded-xl font-bold hover:bg-blue-800 disabled:bg-stone-200 transition-all text-xs">
            <Trophy className="w-4 h-4" />Fill Teams from Standings
          </button>

          {tournamentType === 'competitive' ? (
            <button
              onClick={async () => {
                const semiFinals = matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed');
                if (semiFinals.length < 2) { alert("Complete all Semi-Finals first!"); return; }
                const winners = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team1_id, name: m.team1_name } : { id: m.team2_id, name: m.team2_name });
                const losers = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team2_id, name: m.team2_name } : { id: m.team1_id, name: m.team1_name });
                await fetch('/api/generate-next-stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournament_type: tournamentType, stage: 'final', teams: [...winners, ...losers] }) });
                onRefresh();
              }}
              disabled={matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed').length < 2}
              className="flex items-center justify-center gap-2 bg-maroon-900 text-white py-3 rounded-xl font-bold hover:bg-black disabled:bg-stone-200 transition-all text-xs"
            >
              <Trophy className="w-4 h-4" />Generate Final & 3rd/4th
            </button>
          ) : (
            <button
              onClick={async () => {
                const semiFinals = matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed');
                if (semiFinals.length < 2) { alert("Complete all Semi-Finals first!"); return; }
                const winners = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team1_id, name: m.team1_name } : { id: m.team2_id, name: m.team2_name });
                const losers = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team2_id, name: m.team2_name } : { id: m.team1_id, name: m.team1_name });
                await fetch('/api/generate-next-stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournament_type: tournamentType, stage: 'final', teams: [...winners, ...losers] }) });
                onRefresh();
              }}
              disabled={matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed').length < 2}
              className="flex items-center justify-center gap-2 bg-maroon-900 text-white py-3 rounded-xl font-bold hover:bg-black disabled:bg-stone-200 transition-all text-xs"
            >
              <Trophy className="w-4 h-4" />Generate Final & 3rd/4th
            </button>
          )}
        </div>
        {/* Extra match adder */}
        <div className="mt-6 pt-6 border-t border-stone-100">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Add Extra Round Robin Match</label>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={extraMatchGroup}
                  onChange={e => { setExtraMatchGroup(e.target.value); setExtraMatchTeam1(null); setExtraMatchTeam2(null); }}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Filter by group</option>
                  {[...new Set(filteredTeams.map(t => t.group_name).filter(Boolean))].sort().map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <select
                  value={extraMatchTeam1 ?? ''}
                  onChange={e => setExtraMatchTeam1(Number(e.target.value) || null)}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Team 1</option>
                  {(extraMatchGroup ? filteredTeams.filter(t => t.group_name === extraMatchGroup) : filteredTeams)
                    .filter(t => t.id !== extraMatchTeam2)
                    .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="text-stone-400 font-bold text-sm">vs</span>
                <select
                  value={extraMatchTeam2 ?? ''}
                  onChange={e => setExtraMatchTeam2(Number(e.target.value) || null)}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="">Team 2</option>
                  {(extraMatchGroup ? filteredTeams.filter(t => t.group_name === extraMatchGroup) : filteredTeams)
                    .filter(t => t.id !== extraMatchTeam1)
                    .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button
                  onClick={addExtraMatch}
                  disabled={!extraMatchTeam1 || !extraMatchTeam2 || extraMatchTeam1 === extraMatchTeam2}
                  className="bg-maroon-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-maroon-800 transition-all disabled:opacity-40 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 inline mr-1" />Add Match
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-stone-100 flex flex-wrap items-center justify-end gap-4">
          {showResetConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-red-600 uppercase">Reset {tournamentType} data?</span>
              <button onClick={() => { resetData(); setShowResetConfirm(false); }} className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-red-700 transition-all">Yes, Reset</button>
              <button onClick={() => setShowResetConfirm(false)} className="bg-stone-100 text-stone-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-stone-200 transition-all">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowResetConfirm(true)} disabled={isResetting} className="flex items-center gap-2 text-stone-300 hover:text-red-400 px-4 py-2 rounded-xl font-bold transition-all">
              <Trash2 className="w-4 h-4" />Reset All Data
            </button>
          )}
        </div>
      </section>

      {/* Goal Scorer Management - UPDATED with inline goal count editing */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <h3 className="text-lg font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-maroon-700" />Goal Scorer Management</h3>
        </div>
        <div className="p-6 space-y-6">
          {/* Add Goal Form */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-100">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-400 uppercase">Match</label>
              <select value={newGoalMatchId || ''} onChange={e => setNewGoalMatchId(Number(e.target.value))} className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select Match</option>
                {matches.filter(m => m.status === 'completed').map(m => <option key={m.id} value={m.id}>{m.team1_name} vs {m.team2_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-stone-400 uppercase">Team</label>
              <select value={newGoalTeamId || ''} onChange={e => setNewGoalTeamId(Number(e.target.value))} className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm">
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
              <input type="text" value={newGoalPlayerName} onChange={e => setNewGoalPlayerName(e.target.value)} placeholder="Full Name" className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={addGoal} disabled={!newGoalMatchId || !newGoalTeamId || !newGoalPlayerName} className="w-full bg-maroon-700 text-white font-bold py-2 rounded-lg hover:bg-maroon-800 transition-all disabled:opacity-50">Add Goal</button>
            </div>
          </div>

          {/* Grouped scorer list */}
          <div className="space-y-2">
            {groupedGoals.length === 0 && <p className="text-center text-stone-400 italic py-8">No goals recorded yet</p>}
            {groupedGoals.map(group => (
              <div key={group.key} className="flex items-center gap-4 p-4 bg-stone-50 rounded-xl border border-stone-100 group/row hover:border-stone-200 transition-all">
                {/* Player name - editable */}
                <div className="flex-1 min-w-0">
                  {editingGoalId === group.key ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={editGoalName}
                        onChange={e => setEditGoalName(e.target.value)}
                        className="flex-1 min-w-[120px] bg-white border border-maroon-300 rounded-lg px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-maroon-500 outline-none"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') { group.goals.forEach(g => updateGoal(g.id, editGoalName)); } }}
                      />
                      <button
                        onClick={async () => {
                          for (const goal of group.goals) {
                            await updateGoal(goal.id, editGoalName);
                          }
                          setEditingGoalId(null);
                          onRefresh();
                        }}
                        className="bg-maroon-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-maroon-800"
                      >Save</button>
                      <button onClick={() => setEditingGoalId(null)} className="bg-stone-200 text-stone-600 text-xs font-bold px-3 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <div>
                      <span className="font-bold text-stone-800">{group.playerName}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-stone-500">{group.teamName}</span>
                        <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded", group.tournamentType === 'competitive' ? "bg-maroon-50 text-maroon-700" : "bg-stone-100 text-stone-600")}>{group.tournamentType}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Goal count with +/- controls */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-stone-400 uppercase">Goals</span>
                  <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-xl p-1">
                    <button
                      onClick={async () => {
                        // Remove one goal (the last one for this player)
                        if (group.goals.length > 1) {
                          await deleteGoal(group.goals[group.goals.length - 1].id);
                        } else {
                          setConfirmDeleteGoalId(group.goals[0].id);
                        }
                      }}
                      className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-all"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center font-black text-lg text-stone-800">{group.goals.length}</span>
                    <button
                      onClick={() => addGoalForPlayer(group.goals[0].match_id, group.teamId, group.playerName)}
                      className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-green-100 hover:text-green-600 flex items-center justify-center transition-all"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Actions - always visible */}
                <div className="flex items-center gap-2 shrink-0">
                  {editingGoalId !== group.key && (
                    <button onClick={() => { setEditingGoalId(group.key); setEditGoalName(group.playerName); }} className="p-2 text-stone-400 hover:text-maroon-700 hover:bg-maroon-50 rounded-lg transition-all" title="Edit name">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                  {confirmDeleteGoalId === group.key ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => deleteAllGoalsForPlayer(group.goals.map(g => g.id))} className="bg-red-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap">Yes, delete {group.goals.length} goal{group.goals.length > 1 ? 's' : ''}</button>
                      <button onClick={() => setConfirmDeleteGoalId(null)} className="bg-stone-200 text-stone-600 text-[10px] font-bold px-3 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteGoalId(group.key)} className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Delete player">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Match Manager */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><RefreshCw className="w-5 h-5 text-maroon-700" />Match Manager</h3>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input type="text" placeholder="Search teams, umpires, or stages..." value={matchSearch} onChange={(e) => setMatchSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-3">Match Details</th><th className="px-6 py-3">Time & Pitch</th><th className="px-6 py-3">Umpire</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Score</th><th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[...searchedMatches].sort((a, b) => (a.match_date || '').localeCompare(b.match_date || '') || (a.start_time || '').localeCompare(b.start_time || '') || a.tournament_type.localeCompare(b.tournament_type)).map(match => (
                <tr key={match.id} className={cn("hover:bg-stone-50 transition-colors group", match.tournament_type !== tournamentType && "opacity-60 bg-stone-50/50")}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900">{match.team1_name || 'TBD'} vs {match.team2_name || 'TBD'}</span>
                        <span className={cn("text-[8px] font-black uppercase px-1.5 py-0.5 rounded border", match.tournament_type === 'competitive' ? "bg-maroon-50 text-maroon-700 border-maroon-100" : "bg-stone-100 text-stone-600 border-stone-200")}>{match.tournament_type}</span>
                      </div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase">{match.stage}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 text-maroon-700 font-bold text-sm"><Clock className="w-3 h-3" />{match.match_date ? `${formatDate(match.match_date)} ${match.start_time}` : match.start_time || 'TBD'}</div>
                      <div className="flex items-center gap-1.5 text-stone-500 text-xs"><MapPin className="w-3 h-3" />Pitch {match.pitch || 'TBD'}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {match.umpire ? <div className="flex items-center gap-2 text-sm font-medium text-stone-800"><div className="w-6 h-6 rounded-full bg-maroon-100 flex items-center justify-center text-[10px] text-maroon-700 font-bold">{match.umpire.charAt(0).toUpperCase()}</div>{match.umpire}</div> : <span className="text-xs text-stone-400 italic">No umpire</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1.5", match.status === 'completed' ? "bg-green-100 text-green-700" : match.status === 'pending' ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600")}>
                      <div className={cn("w-1.5 h-1.5 rounded-full", match.status === 'completed' ? "bg-green-500" : match.status === 'pending' ? "bg-amber-500" : "bg-stone-400")} />
                      {match.status}
                    </span>
                  </td>
                  <td className="px-6 py-4"><div className="font-mono font-bold text-lg text-stone-800">{match.score1} - {match.score2}</div></td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setEditingMatchId(match.id); setEditScore1(match.score1); setEditScore2(match.score2); setEditStatus(match.status); setEditDate(match.match_date || ''); setEditStartTime(match.start_time || ''); setEditPitch(match.pitch || ''); setEditUmpire(match.umpire || ''); }} className="inline-flex items-center gap-2 bg-stone-100 text-stone-600 hover:bg-maroon-700 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"><Edit2 className="w-3.5 h-3.5" />Edit</button>
                      {confirmDeleteMatchId === match.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => deleteMatch(match.id)} className="bg-red-600 text-white text-[10px] font-bold px-2 py-1.5 rounded-lg">Confirm</button>
                          <button onClick={() => setConfirmDeleteMatchId(null)} className="bg-stone-200 text-stone-600 text-[10px] font-bold px-2 py-1.5 rounded-lg">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteMatchId(match.id)} className="inline-flex items-center gap-2 bg-stone-100 text-stone-600 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {searchedMatches.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-stone-400 italic">No matches found</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Match Editor Modal */}
      {editingMatchId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-maroon-700 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Edit Match</h3>
                <p className="text-maroon-100 text-xs font-medium uppercase tracking-widest mt-1">{matches.find(m => m.id === editingMatchId)?.team1_name || 'TBD'} vs {matches.find(m => m.id === editingMatchId)?.team2_name || 'TBD'}</p>
              </div>
              <button onClick={() => setEditingMatchId(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-8 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2"><label className="text-xs font-bold text-stone-500 uppercase">Date</label><input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none" /></div>
                <div className="space-y-2"><label className="text-xs font-bold text-stone-500 uppercase">Start Time</label><input type="text" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} placeholder="e.g. 10:00" className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none" /></div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase">Pitch</label>
                  <select value={editPitch} onChange={(e) => setEditPitch(e.target.value)} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none">
                    <option value="">TBD</option><option value="1">Pitch 1</option><option value="2">Pitch 2</option><option value="3">Pitch 3</option><option value="4">Pitch 4</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase">Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none">
                    <option value="scheduled">Scheduled</option><option value="pending">Pending</option><option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-500 uppercase">Umpire</label>
                <div className="flex gap-2">
                  <select value={editUmpire} onChange={(e) => setEditUmpire(e.target.value)} className="flex-1 px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-maroon-500 outline-none">
                    <option value="">-- No umpire assigned --</option>
                    {umpires.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                  {editUmpire && <button onClick={() => setEditUmpire('')} className="px-3 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 text-xs font-bold">Clear</button>}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-500 uppercase">Final Score</label>
                <div className="flex items-center gap-3">
                  <input type="number" min="0" value={editScore1} onChange={(e) => setEditScore1(Number(e.target.value))} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-center font-bold text-lg focus:ring-2 focus:ring-maroon-500 outline-none" />
                  <span className="font-bold text-stone-400">-</span>
                  <input type="number" min="0" value={editScore2} onChange={(e) => setEditScore2(Number(e.target.value))} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-center font-bold text-lg focus:ring-2 focus:ring-maroon-500 outline-none" />
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button onClick={() => updateMatch(editingMatchId)} disabled={isSavingMatch === editingMatchId} className="flex-1 bg-maroon-700 text-white font-bold py-4 rounded-2xl hover:bg-maroon-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {isSavingMatch === editingMatchId ? <><RefreshCw className="w-5 h-5 animate-spin" />Saving...</> : <><CheckCircle2 className="w-5 h-5" />Save Changes</>}
                </button>
                <button onClick={() => setEditingMatchId(null)} disabled={isSavingMatch === editingMatchId} className="px-8 bg-stone-100 text-stone-600 font-bold py-4 rounded-2xl hover:bg-stone-200 transition-all disabled:opacity-50">Cancel</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Pending Submissions */}
      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-maroon-700" />
            Pending Approvals
          </h3>
          {matches.filter(m => m.status === 'pending').length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-black px-2 py-0.5 rounded-full">
              {matches.filter(m => m.status === 'pending').length} pending
            </span>
          )}
        </div>
        <div className="divide-y divide-stone-100">
          {matches.filter(m => m.status === 'pending').map(match => {
            const matchSubmissions = submissions.filter(s => s.match_id === match.id);
            const team1Sub = matchSubmissions.find(s => Number(s.team_id) === Number(match.team1_id));
            const team2Sub = matchSubmissions.find(s => Number(s.team_id) === Number(match.team2_id));
            const scoresConflict = team1Sub && team2Sub && (Number(team1Sub.score1) !== Number(team2Sub.score1) || Number(team1Sub.score2) !== Number(team2Sub.score2));
            const waitingFor = !team1Sub ? match.team1_name : !team2Sub ? match.team2_name : null;

            return (
              <div key={match.id} className={cn("px-6 py-4", scoresConflict ? "bg-red-50" : "bg-white")}>
                {/* Match title row */}
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <span className="font-bold text-stone-900">{match.team1_name} vs {match.team2_name}</span>
                    <span className="ml-2 text-[10px] font-black uppercase text-stone-400">{match.stage.replace(/-/g, ' ')}</span>
                    {match.start_time && <span className="ml-2 text-[10px] font-bold text-maroon-700">{match.start_time}</span>}
                  </div>
                  {scoresConflict && <span className="flex items-center gap-1 text-[10px] font-black text-red-600 bg-red-100 px-2 py-1 rounded-full"><AlertCircle className="w-3 h-3" />Scores conflict</span>}
                  {waitingFor && <span className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-1 rounded-full"><Clock className="w-3 h-3" />Waiting for {waitingFor}</span>}
                </div>

                {/* Two team submissions side by side */}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { team: match.team1_name, sub: team1Sub },
                    { team: match.team2_name, sub: team2Sub },
                  ] as { team: string, sub: typeof team1Sub }[]).map(({ team, sub }) => (
                    <div key={team} className={cn("rounded-lg border p-3 text-sm", sub ? "bg-white border-stone-200" : "bg-stone-50 border-dashed border-stone-200")}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black text-stone-500 uppercase truncate">{team}</span>
                        {sub
                          ? <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0">✓ Submitted</span>
                          : <span className="text-[9px] text-stone-400 italic shrink-0">Awaiting...</span>
                        }
                      </div>
                      {sub ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-black text-stone-900">{sub.score1} – {sub.score2}</span>
                            {scoresConflict && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                          </div>
                          {(() => {
                            const scorerList = typeof sub.scorers === 'string' ? JSON.parse(sub.scorers) : (sub.scorers || []);
                            return scorerList.length > 0 ? <div className="text-[10px] text-stone-400 truncate">⚽ {scorerList.join(', ')}</div> : null;
                          })()}
                          <button onClick={() => forceApprove(sub.id)} className="w-full text-[10px] font-black bg-maroon-700 text-white px-2 py-1.5 rounded-lg hover:bg-maroon-800 transition-all">
                            Force Approve
                          </button>
                        </div>
                      ) : (
                        <div className="h-8 flex items-center"><span className="text-stone-300 text-xs">—</span></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {matches.filter(m => m.status === 'pending').length === 0 && (
            <div className="px-6 py-10 text-center text-stone-400 italic">No pending submissions</div>
          )}
        </div>
      </section>
    </div>
  );
}
