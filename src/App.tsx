import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Users, Calendar, Settings, ShieldCheck, AlertCircle, CheckCircle2, Clock, ChevronRight, Plus, Trash2, RefreshCw, Search, Edit2, X, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { socket } from './lib/socket';
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

  useEffect(() => {
    fetchData();

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
      socket.off('data_reset');
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-maroon-700 p-2 rounded-lg">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">NAMS Hockey Tournament</h1>
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
                    {filteredMatches.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    {filteredMatches.length === 0 && (
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
                <ScoreReporter teams={data.teams} matches={data.matches} />
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
                  onRefresh={fetchData}
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

const MatchCard: React.FC<{ match: Match }> = ({ match }) => {
  const isBreak = !match.team1_id && !match.team2_id;

  return (
    <div className={cn(
      "p-4 rounded-xl border transition-all",
      isBreak ? "bg-stone-100 border-stone-300 border-dashed" :
      match.status === 'completed' ? "bg-stone-50 border-stone-100" : 
      match.status === 'pending' ? "bg-maroon-50 border-maroon-200" : "bg-white border-stone-200"
    )}>
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
            <span className="text-sm font-bold text-stone-800 line-clamp-1">{match.team1_name}</span>
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
            <span className="text-sm font-bold text-stone-800 line-clamp-1">{match.team2_name}</span>
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

  const pitches = useMemo(() => {
    // Limit to 2 pitches as requested
    return ['1', '2'];
  }, []);

  const liveMatchesByPitch = useMemo(() => {
    const currentTimeStr = now.toTimeString().slice(0, 5);
    const currentDateStr = now.toISOString().split('T')[0];
    
    const live = matches.filter(m => {
      if (!m.start_time || m.status === 'completed' || !m.team1_id) return false;
      
      // If match has a date, it MUST match today
      if (m.match_date && m.match_date !== currentDateStr) return false;
      // If match has NO date, we assume it might be for today (fallback)
      
      const matchTime = new Date(`2024-01-01T${m.start_time}:00`);
      const currentTime = new Date(`2024-01-01T${currentTimeStr}:00`);
      const diff = (currentTime.getTime() - matchTime.getTime()) / 60000;
      // Match is "live" if it started within the last 30 minutes (increased from 20)
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
          <h2 className="text-3xl font-black text-stone-900 tracking-tight">Live Matches</h2>
          <p className="text-stone-500 font-medium">Real-time updates from all pitches</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-x divide-y divide-stone-100">
          {pitches.map(pitch => {
            const pitchMatches = liveMatchesByPitch[pitch] || [];
            return (
              <div key={pitch} className="p-6 flex flex-col items-center text-center">
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-4">Pitch {pitch}</span>
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
                  <div className="py-4">
                    <span className="text-xl font-black text-stone-200 uppercase tracking-tighter italic">Free</span>
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
    const stats: Record<string, { name: string, team: string, count: number }> = {};
    goals.forEach(goal => {
      if (!stats[goal.player_name]) {
        stats[goal.player_name] = { name: goal.player_name, team: goal.team_name || 'Unknown', count: 0 };
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
              <th className="px-6 py-3 text-center">Goals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {scorerStats.map((player) => (
              <tr key={player.name} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-4 font-bold text-stone-800">{player.name}</td>
                <td className="px-6 py-4 text-sm text-stone-500">{player.team}</td>
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
}

const ScoreReporter: React.FC<{ teams: Team[], matches: Match[] }> = ({ teams, matches }) => {
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [score1, setScore1] = useState<number>(0);
  const [score2, setScore2] = useState<number>(0);
  const [scorers, setScorers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const pendingMatches = matches.filter(m => m.status !== 'completed');
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

      if (res.ok) {
        setMessage({ type: 'success', text: 'Score submitted! Waiting for other team to confirm.' });
        setSelectedMatchId('');
        setSelectedTeamId('');
        setScore1(0);
        setScore2(0);
        setScorers([]);
      } else {
        throw new Error('Submission failed');
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to submit score. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-maroon-100 p-2 rounded-lg">
          <ShieldCheck className="w-6 h-6 text-maroon-700" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Report Match Result</h2>
          <p className="text-sm text-stone-500">Both captains must submit the same score for it to be verified.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Select Match</label>
            <select 
              value={selectedMatchId}
              onChange={(e) => setSelectedMatchId(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
              required
            >
              <option value="">Choose a match...</option>
              {pendingMatches.map(m => (
                <option key={m.id} value={m.id}>
                  {m.team1_name} vs {m.team2_name} ({m.tournament_type})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Your Team</label>
            <select 
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-maroon-500 outline-none transition-all"
              required
              disabled={!selectedMatchId}
            >
              <option value="">Choose your team...</option>
              {selectedMatch && (
                <>
                  <option value={selectedMatch.team1_id}>{selectedMatch.team1_name}</option>
                  <option value={selectedMatch.team2_id}>{selectedMatch.team2_name}</option>
                </>
              )}
            </select>
          </div>
        </div>

        {selectedMatch && (
          <div className="space-y-6">
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
          </div>
        )}

        {message && (
          <div className={cn(
            "p-4 rounded-xl flex items-center gap-3 text-sm font-medium",
            message.type === 'success' ? "bg-maroon-50 text-maroon-700 border border-maroon-100" : "bg-red-50 text-red-700 border border-red-100"
          )}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        <button 
          type="submit"
          disabled={submitting || !selectedMatchId || !selectedTeamId}
          className="w-full bg-maroon-700 hover:bg-maroon-800 disabled:bg-stone-300 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-maroon-200"
        >
          {submitting ? 'Submitting...' : 'Submit Result'}
        </button>
      </form>
    </div>
  );
}

const AdminPanel: React.FC<{ 
  teams: Team[], 
  matches: Match[], 
  tournamentType: TournamentType,
  standings: Record<string, any[]>,
  bestSecondPlace: any,
  submissions: Submission[],
  onRefresh: () => void
}> = ({ teams, matches, tournamentType, standings, bestSecondPlace, submissions, onRefresh }) => {
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGroup, setNewTeamGroup] = useState('A');
  const [isResetting, setIsResetting] = useState(false);
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
  const [bulkInterval, setBulkInterval] = useState(20);
  const [bulkPitch, setBulkPitch] = useState('1');

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [autoDate, setAutoDate] = useState(new Date().toISOString().split('T')[0]);
  const [autoStartTime, setAutoStartTime] = useState('09:00');
  const [autoEndTime, setAutoEndTime] = useState('17:00');
  const [autoNumPitches, setAutoNumPitches] = useState(2);

  const [breakLabel, setBreakLabel] = useState('');
  const [breakDate, setBreakDate] = useState(new Date().toISOString().split('T')[0]);
  const [breakTime, setBreakTime] = useState('');
  const [breakPitch, setBreakPitch] = useState('');
  const [matchSearch, setMatchSearch] = useState('');

  const filteredTeams = teams.filter(t => t.tournament_type === tournamentType);
  const filteredMatches = matches.filter(m => m.tournament_type === tournamentType);
  const allMatches = matches; // We show all matches in the manager
  
  const searchedMatches = allMatches.filter(m => 
    m.team1_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.team2_name?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.umpire?.toLowerCase().includes(matchSearch.toLowerCase()) ||
    m.stage?.toLowerCase().includes(matchSearch.toLowerCase())
  );

  const addTeam = async () => {
    if (!newTeamName) return;
    await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName, tournament_type: tournamentType, group_name: newTeamGroup })
    });
    setNewTeamName('');
    onRefresh();
  };

  const removeTeam = async (id: number) => {
    await fetch(`/api/teams/${id}`, { method: 'DELETE' });
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
    onRefresh();
  };

  const forceApprove = async (submissionId: number) => {
    await fetch('/api/admin/force-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: submissionId })
    });
    onRefresh();
  };

  const resetData = async () => {
    setIsResetting(true);
    await fetch('/api/reset', { method: 'POST' });
    setIsResetting(false);
    onRefresh();
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
    if (filteredMatches.length === 0) return;
    
    let currentTime = new Date(`2024-01-01T${bulkStartTime}:00`);
    
    for (const match of filteredMatches) {
      const timeStr = currentTime.toTimeString().slice(0, 5);
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
          pitch: match.pitch,
          umpire: match.umpire
        })
      });
      currentTime = new Date(currentTime.getTime() + bulkInterval * 60000);
    }
    onRefresh();
  };

  const bulkAssignPitches = async () => {
    if (filteredMatches.length === 0) return;
    for (const match of filteredMatches) {
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
    onRefresh();
  };

  const autoScheduleAll = async () => {
    const allMatches = matches.filter(m => m.team1_id && m.team2_id); // Only actual matches, not breaks
    if (allMatches.length === 0) return;

    const start = new Date(`2024-01-01T${autoStartTime}:00`);
    const end = new Date(`2024-01-01T${autoEndTime}:00`);
    const totalMinutes = (end.getTime() - start.getTime()) / 60000;
    
    const slotsNeeded = Math.ceil(allMatches.length / autoNumPitches);
    const interval = Math.floor(totalMinutes / slotsNeeded);

    let currentMatchIdx = 0;
    for (let slot = 0; slot < slotsNeeded; slot++) {
      const slotTime = new Date(start.getTime() + slot * interval * 60000);
      const timeStr = slotTime.toTimeString().slice(0, 5);
      
      for (let p = 1; p <= autoNumPitches; p++) {
        if (currentMatchIdx >= allMatches.length) break;
        
        const match = allMatches[currentMatchIdx];
        await fetch('/api/admin/update-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            match_id: match.id, 
            score1: match.score1, 
            score2: match.score2, 
            status: match.status,
            match_date: autoDate,
            start_time: timeStr,
            pitch: p.toString(),
            umpire: match.umpire
          })
        });
        currentMatchIdx++;
      }
    }
    onRefresh();
  };

  const addBreak = async () => {
    if (!breakLabel || !breakTime) return;
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
    setBreakLabel('');
    setBreakTime('');
    setBreakPitch('');
    onRefresh();
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Plus className="w-5 h-5 text-maroon-700" />
            Manage Teams ({tournamentType})
          </h3>
          <div className="flex flex-col sm:flex-row gap-2 mb-6">
            <input 
              type="text" 
              placeholder="Team Name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
            />
            <div className="flex gap-2">
              <select 
                value={newTeamGroup}
                onChange={(e) => setNewTeamGroup(e.target.value)}
                className="flex-1 sm:flex-none bg-stone-50 border border-stone-200 rounded-xl px-2 py-2 text-sm focus:ring-2 focus:ring-maroon-500 outline-none"
              >
                <option value="A">Grp A</option>
                <option value="B">Grp B</option>
                <option value="C">Grp C</option>
              </select>
              <button 
                onClick={addTeam}
                className="flex-1 sm:flex-none bg-maroon-700 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-maroon-800 transition-all"
              >
                Add
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {filteredTeams.map(team => (
              <div key={team.id} className="flex justify-between items-center p-3 bg-stone-50 rounded-lg border border-stone-100">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">GRP {team.group_name}</span>
                  <span className="font-medium text-sm text-stone-800">{team.name}</span>
                </div>
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
            ))}
            {filteredTeams.length === 0 && <p className="text-center text-stone-400 text-sm italic py-4">No teams added</p>}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-maroon-700" />
            Bulk Scheduler ({tournamentType})
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={bulkSchedule}
                disabled={filteredMatches.length === 0}
                className="bg-black text-white py-3 rounded-xl font-bold hover:bg-stone-800 disabled:bg-stone-200 transition-all text-sm"
              >
                Apply Times
              </button>
              <button 
                onClick={bulkAssignPitches}
                disabled={filteredMatches.length === 0}
                className="bg-maroon-900 text-white py-3 rounded-xl font-bold hover:bg-maroon-950 disabled:bg-stone-200 transition-all text-sm"
              >
                Apply Pitches
              </button>
            </div>
            <p className="text-[10px] text-stone-400 italic text-center">
              Assign times and pitches separately to all {filteredMatches.length} matches.
            </p>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-maroon-700" />
            Auto-Schedule All Matches
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Date</label>
                <input 
                  type="date" 
                  value={autoDate}
                  onChange={(e) => setAutoDate(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Start</label>
                <input 
                  type="time" 
                  value={autoStartTime}
                  onChange={(e) => setAutoStartTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Finish</label>
                <input 
                  type="time" 
                  value={autoEndTime}
                  onChange={(e) => setAutoEndTime(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-500 uppercase">Pitches</label>
                <select 
                  value={autoNumPitches}
                  onChange={(e) => setAutoNumPitches(Number(e.target.value))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon-500"
                >
                  <option value="1">1 Pitch</option>
                  <option value="2">2 Pitches</option>
                </select>
              </div>
            </div>
            <button 
              onClick={autoScheduleAll}
              className="w-full bg-maroon-700 text-white py-3 rounded-xl font-bold hover:bg-maroon-800 transition-all shadow-lg shadow-maroon-100"
            >
              Schedule All (Comp & Chill)
            </button>
            <p className="text-[10px] text-stone-400 italic text-center">
              This will distribute all matches across {autoNumPitches} pitches between {autoStartTime} and {autoEndTime}.
            </p>
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
            
            {tournamentType === 'competitive' ? (
              <>
                <button 
                  onClick={async () => {
                    // Overall standings for competitive
                    const allTeams = (Object.values(standings).flat() as any[]).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
                    await fetch('/api/generate-knockouts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tournament_type: tournamentType, teams: allTeams })
                    });
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
                    const winners = quarters.map(m => m.score1 > m.score2 ? { id: m.team1_id } : { id: m.team2_id });
                    await fetch('/api/generate-next-stage', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tournament_type: tournamentType, stage: 'semi-final', teams: winners })
                    });
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
                  await fetch('/api/generate-knockouts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tournament_type: tournamentType, teams: knockoutTeams })
                  });
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
                const winners = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team1_id } : { id: m.team2_id });
                const losers = semiFinals.map(m => m.score1 > m.score2 ? { id: m.team2_id } : { id: m.team1_id });
                await fetch('/api/generate-next-stage', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tournament_type: tournamentType, stage: 'final', teams: [...winners, ...losers] })
                });
                onRefresh();
              }}
              disabled={matches.filter(m => m.tournament_type === tournamentType && m.stage === 'semi-final' && m.status === 'completed').length < 2 || matches.filter(m => m.tournament_type === tournamentType && m.stage === 'final').length > 0}
              className="flex items-center justify-center gap-2 bg-maroon-900 text-white py-3 rounded-xl font-bold hover:bg-maroon-950 disabled:bg-stone-200 transition-all text-xs"
            >
              <Trophy className="w-4 h-4" />
              Generate Final & 3rd/4th
            </button>
          </div>
          <div className="mt-6 pt-6 border-t border-stone-100 flex justify-end">
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
                      className="inline-flex items-center gap-2 bg-stone-100 text-stone-600 hover:bg-maroon-700 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
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
