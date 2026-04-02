import { useState, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal, RefreshControl, Share, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { useAuthStore } from '../../store/authStore';
import { usePurchaseStore } from '../../store/purchaseStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useCocoStore } from '../../store/cocoStore';
import { ProGate } from '../../components/ProGate';
import {
  fetchGlobalLeaderboard, fetchFriendsLeaderboard, fetchGroupLeaderboard,
  searchUser, addFriend, LeaderboardEntry, LeaderboardGroup, LeagueDetailStats,
  fetchUserGroups, createGroup, joinGroupByCode, leaveGroup, tierEmojiFromStreak,
} from '../../lib/leaderboard';
import { scheduleLeagueRivalNotification } from '../../utils/notifications';

type Tab = 'global' | 'friends' | string; // string = group id

function LeagueStatsChips({ stats, style }: { stats: LeagueDetailStats; style?: object }) {
  const durationH = Math.floor(stats.avgDurationMins / 60);
  const durationM = stats.avgDurationMins % 60;
  const durationStr = durationM > 0 ? `${durationH}h ${durationM}m` : `${durationH}h`;
  return (
    <View style={[chipStyles.row, style]}>
      <View style={chipStyles.chip}>
        <Text style={chipStyles.chipText}>{durationStr} avg</Text>
      </View>
      <View style={chipStyles.chip}>
        <Text style={chipStyles.chipText}>{stats.totalHours}h total</Text>
      </View>
      <View style={chipStyles.chip}>
        <Text style={chipStyles.chipText}>{stats.avgQuality} quality</Text>
      </View>
      {stats.avgHrv != null && (
        <View style={chipStyles.chip}>
          <Text style={chipStyles.chipText}>HRV {stats.avgHrv}</Text>
        </View>
      )}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  chip: {
    backgroundColor: 'rgba(96,165,250,0.12)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)',
    paddingHorizontal: 6, paddingVertical: 2,
  },
  chipText: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5, color: '#60A5FA' },
});

/** Returns a human-readable countdown string, e.g. "3d 14h left" or "ENDED" */
function countdownLabel(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'ENDED';
  const totalMins = Math.floor(diff / 60_000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = totalMins % 60;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export default function LeaderboardScreen() {
  const { userId, username, isAuthenticated } = useAuthStore();
  const { isPremium } = usePurchaseStore();
  const { history } = useRecoveryStore();
  const { streak } = useCocoStore();
  const [tab, setTab] = useState<Tab>('global');
  const [global, setGlobal] = useState<LeaderboardEntry[]>([]);
  const [friends, setFriends] = useState<LeaderboardEntry[]>([]);
  const [groups, setGroups] = useState<LeaderboardGroup[]>([]);
  const [groupEntries, setGroupEntries] = useState<Record<string, LeaderboardEntry[]>>({});
  const [loading, setLoading] = useState(true);

  // Friend search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ id: string; username: string } | null | 'not_found'>('not_found');
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group management modal
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'create' | 'join'>('create');
  const [groupName, setGroupName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [groupActionLoading, setGroupActionLoading] = useState(false);

  // New: deadline + stake for group creation
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadline, setDeadline] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [stake, setStake] = useState('');

  const loadedOnce     = useRef(false);
  const isLoading      = useRef(false);
  const searchAbort    = useRef<AbortController | null>(null);
  const rivalNotifSent = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) void load();
    }, [isAuthenticated, userId])
  );

  async function load(isRefresh = false) {
    if (isLoading.current) return;
    isLoading.current = true;
    if (!loadedOnce.current || isRefresh) setLoading(true);
    try {
      const [g, f, userGroups] = await Promise.all([
        fetchGlobalLeaderboard(),
        userId ? fetchFriendsLeaderboard(userId) : Promise.resolve([]),
        userId ? fetchUserGroups(userId) : Promise.resolve([]),
      ]);
      setGlobal(g);
      setFriends(f);
      setGroups(userGroups);

      if (userId && f.length > 0) {
        const me = f.find((e) => e.userId === userId);
        if (me) {
          const rival = f.find((e) => e.userId !== userId && e.avgScore > me.avgScore);
          if (rival && rival.username !== rivalNotifSent.current) {
            rivalNotifSent.current = rival.username;
            void scheduleLeagueRivalNotification(rival.username, rival.avgScore, me.avgScore);
          }
        }
      }

      if (userGroups.length > 0) {
        const groupData = await Promise.all(userGroups.map((grp) => fetchGroupLeaderboard(grp.id)));
        const map: Record<string, LeaderboardEntry[]> = {};
        userGroups.forEach((grp, i) => { map[grp.id] = groupData[i]; });
        setGroupEntries(map);
      }
    } catch {
      // Network error — show whatever data we have
    } finally {
      loadedOnce.current = true;
      isLoading.current  = false;
      setLoading(false);
    }
  }

  function handleSearch(text: string) {
    const clean = text.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
    setSearchQuery(clean);
    setSearchResult('not_found');

    searchAbort.current?.abort();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!clean.trim()) { setSearching(false); return; }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      searchAbort.current = ctrl;
      try {
        const result = await searchUser(clean.trim());
        if (!ctrl.signal.aborted) setSearchResult(result ?? 'not_found');
      } catch {
        if (!ctrl.signal.aborted) setSearchResult('not_found');
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 500);
  }

  async function handleAdd(friendId: string) {
    if (!userId) return;
    const ok = await addFriend(userId, friendId);
    if (ok) {
      setAddedIds((prev) => new Set([...prev, friendId]));
      void load();
    }
  }

  async function handleCreateGroup() {
    if (!userId) return;
    const name = groupName.trim().replace(/[<>'"]/g, '').slice(0, 30);
    if (!name) { Alert.alert('Invalid name', 'Group name cannot be empty.'); return; }
    setGroupActionLoading(true);
    const newGroup = await createGroup(name, userId, {
      endsAt: hasDeadline ? deadline.toISOString() : null,
      stake: stake.trim() || null,
    });
    setGroupActionLoading(false);
    if (newGroup) {
      setGroups((prev) => [...prev, newGroup]);
      setGroupEntries((prev) => ({ ...prev, [newGroup.id]: [] }));
      setShowGroupModal(false);
      setGroupName('');
      setStake('');
      setHasDeadline(false);
      setTab(newGroup.id);
    } else {
      Alert.alert('Error', 'Could not create group. Try again.');
    }
  }

  async function handleJoinGroup() {
    if (!userId) return;
    const code = inviteCode.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    if (code.length !== 8) { Alert.alert('Invalid code', 'Invite code must be 8 characters.'); return; }
    setGroupActionLoading(true);
    const joined = await joinGroupByCode(code, userId);
    setGroupActionLoading(false);
    if (joined) {
      setShowGroupModal(false);
      setInviteCode('');
      void load();
    } else {
      Alert.alert('Not found', 'No group with that invite code.');
    }
  }

  async function handleLeaveGroup(grp: LeaderboardGroup) {
    if (!userId) return;
    Alert.alert(`Leave "${grp.name}"?`, 'You can rejoin anytime with the invite code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          await leaveGroup(grp.id, userId);
          setGroups((prev) => prev.filter((g) => g.id !== grp.id));
          if (tab === grp.id) setTab('global');
        },
      },
    ]);
  }

  async function handleShareGroup(grp: LeaderboardGroup) {
    const deadlineText = grp.endsAt
      ? `\nDeadline: ${new Date(grp.endsAt).toLocaleDateString()}`
      : '';
    const stakeText = grp.stake ? `\nStake: ${grp.stake}` : '';
    const message = `Join my Coco Sleep league "${grp.name}"!\nInvite code: ${grp.inviteCode.toUpperCase()}${deadlineText}${stakeText}\n\nDownload Coco Sleep and enter the code under League → Join Group.`;
    await Share.share({ message });
  }

  function buildLocalEntry(): LeaderboardEntry | null {
    if (!userId) return null;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = history.filter((s) => new Date(s.date).getTime() >= sevenDaysAgo);
    if (recent.length === 0) return null;
    const scores = recent.map((s) => s.recovery.recoveryScore);
    return {
      userId,
      username: username || 'You',
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      bestScore: Math.max(...scores),
      streak,
      nights: recent.length,
      tierEmoji: tierEmojiFromStreak(streak),
    };
  }

  function getEntries(): LeaderboardEntry[] {
    let entries: LeaderboardEntry[];
    if (tab === 'global') entries = global;
    else if (tab === 'friends') entries = friends;
    else entries = groupEntries[tab] ?? [];

    // Always ensure current user appears — inject local data if Supabase is missing them
    if (userId && !entries.some((e) => e.userId === userId)) {
      const local = buildLocalEntry();
      if (local) {
        entries = [...entries, local].sort((a, b) => b.avgScore - a.avgScore);
      }
    }
    return entries;
  }

  const activeGroup = groups.find((g) => g.id === tab);

  // Determine winner for ended leagues
  function getWinner(): LeaderboardEntry | null {
    if (!activeGroup?.endsAt) return null;
    if (new Date(activeGroup.endsAt).getTime() > Date.now()) return null;
    const entries = groupEntries[activeGroup.id] ?? [];
    return entries.length > 0 ? entries[0] : null; // already sorted by avgScore desc
  }

  const winner = getWinner();

  if (!isAuthenticated) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>NOT SIGNED IN.</Text>
        <View style={styles.emptyBar} />
        <Text style={styles.emptySub}>Complete onboarding to access the leaderboard.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading && loadedOnce.current}
          onRefresh={() => void load(true)}
          tintColor={Colors.red}
        />
      }
    >
      {/* Tab row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {(['global', 'friends'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'global' ? `GLOBAL${!isPremium ? ' — PRO' : ''}` : 'FRIENDS'}
            </Text>
          </TouchableOpacity>
        ))}
        {groups.map((grp) => (
          <TouchableOpacity key={grp.id} style={[styles.tabBtn, tab === grp.id && styles.tabBtnActive]} onPress={() => setTab(grp.id)}>
            <Text style={[styles.tabLabel, tab === grp.id && styles.tabLabelActive]}>{grp.name.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.tabBtnNew}
          onPress={() => { setGroupModalMode('create'); setShowGroupModal(true); }}
        >
          <Text style={styles.tabBtnNewText}>+ GROUP</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Group info bar */}
      {activeGroup && (
        <View style={styles.groupInfoBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupInfoCode}>
              CODE: <Text style={styles.groupInfoCodeVal}>{activeGroup.inviteCode.toUpperCase()}</Text>
            </Text>
            {activeGroup.endsAt && (
              <Text style={[styles.groupInfoHint, { color: new Date(activeGroup.endsAt).getTime() < Date.now() ? Colors.red : Colors.gold }]}>
                {countdownLabel(activeGroup.endsAt)}
              </Text>
            )}
            {!activeGroup.endsAt && (
              <Text style={styles.groupInfoHint}>No deadline · ongoing</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <TouchableOpacity onPress={() => void handleShareGroup(activeGroup)}>
              <Text style={styles.shareBtn}>SHARE</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleLeaveGroup(activeGroup)}>
              <Text style={styles.leaveBtn}>LEAVE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Stake banner */}
      {activeGroup?.stake && (
        <View style={styles.stakeBanner}>
          <DiagonalStripes color={Colors.gold} opacity={0.06} />
          <Text style={styles.stakeLabel}>// THE STAKE</Text>
          <Text style={styles.stakeText}>{activeGroup.stake}</Text>
        </View>
      )}

      {/* Winner banner (league ended) */}
      {winner && (
        <View style={styles.winnerBanner}>
          <DiagonalStripes color={Colors.gold} opacity={0.08} />
          <Text style={styles.winnerLabel}>// LEAGUE OVER — WINNER</Text>
          <Text style={styles.winnerName}>{winner.tierEmoji} @{winner.username}</Text>
          <Text style={styles.winnerScore}>{winner.avgScore} AVG SCORE · {winner.streak}D STREAK</Text>
          {activeGroup?.stake && (
            <Text style={styles.winnerStake}>Stake: {activeGroup.stake}</Text>
          )}
        </View>
      )}

      {/* Global tab — pro only */}
      {tab === 'global' && !isPremium && (
        <ProGate
          feature="Global Leaderboard"
          description="Compete against every Coco user worldwide. See where you rank globally."
          style={{ marginTop: 16 }}
        >
          {null}
        </ProGate>
      )}

      {/* Leaderboard entries */}
      {(tab === 'global' && !isPremium) ? null : loading ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
      ) : getEntries().length === 0 ? (
        <View style={styles.noDataOuter}>
          <DiagonalStripes opacity={0.04} />
          <View style={styles.noDataInner}>
            <Text style={styles.noDataText}>
              {tab === 'friends' ? 'NO FRIENDS YET.' : tab !== 'global' ? 'NO DATA YET.' : 'NO DATA YET.'}
            </Text>
            <Text style={styles.noDataSub}>
              {tab === 'friends'
                ? 'Search for friends below to add them.'
                : tab !== 'global'
                  ? 'Share your invite code so others can join this group.'
                  : 'Complete a sleep session to appear here.'}
            </Text>
          </View>
        </View>
      ) : (() => {
        const entries = getEntries();
        const myRank = entries.findIndex((e) => e.userId === userId);
        const myEntry = myRank >= 0 ? entries[myRank] : null;

        return (
          <>
            {/* My rank card */}
            {myEntry && (
              <View style={styles.myRankCard}>
                <DiagonalStripes color={Colors.red} opacity={0.06} />
                <View style={styles.myRankInner}>
                  <View style={styles.myRankLeft}>
                    <Text style={styles.myRankPos}>#{myRank + 1}</Text>
                    <Text style={styles.myRankLabel}>YOUR RANK</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.myRankEmoji}>{myEntry.tierEmoji}</Text>
                    <Text style={styles.myRankName}>@{myEntry.username}</Text>
                    <Text style={styles.myRankSub}>{myEntry.streak}d streak · {myEntry.nights} {myEntry.nights === 1 ? 'night' : 'nights'} this week</Text>
                    {tab !== 'global' && myEntry.leagueStats && (
                      <LeagueStatsChips stats={myEntry.leagueStats} style={{ marginTop: 6 }} />
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.myRankScore, { color: myEntry.avgScore >= 75 ? Colors.green : myEntry.avgScore >= 50 ? Colors.gold : Colors.red }]}>
                      {myEntry.avgScore}
                    </Text>
                    <Text style={styles.myRankScoreLabel}>AVG</Text>
                    <Text style={[styles.myRankBest, { color: Colors.gold }]}>↑{myEntry.bestScore} BEST</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Full list */}
            {entries.map((entry, i) => {
              const isMe = entry.userId === userId;
              const scoreColor = entry.avgScore >= 75 ? Colors.green : entry.avgScore >= 50 ? Colors.gold : Colors.red;
              const podiumColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
              const rankColor = i < 3 ? podiumColors[i] : Colors.textMuted;
              const podiumMedal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
              return (
                <View
                  key={entry.userId}
                  style={[
                    styles.entryOuter,
                    isMe && styles.entryOuterMe,
                    i < 3 && styles.entryOuterPodium,
                    i === 0 && { borderLeftColor: podiumColors[0], borderColor: podiumColors[0] },
                    i === 1 && { borderLeftColor: podiumColors[1] },
                    i === 2 && { borderLeftColor: podiumColors[2] },
                  ]}
                >
                  <DiagonalStripes color={isMe ? Colors.red : i < 3 ? podiumColors[i] : Colors.textMuted} opacity={0.05} />
                  <View style={styles.entryInner}>
                    <View style={styles.rankBlock}>
                      {podiumMedal
                        ? <Text style={styles.rankMedal}>{podiumMedal}</Text>
                        : <Text style={[styles.rank, { color: rankColor }]}>#{i + 1}</Text>}
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={styles.entryNameRow}>
                        <Text style={styles.entryTierEmoji}>{entry.tierEmoji}</Text>
                        <Text style={[styles.entryName, isMe && { color: Colors.red }]}>
                          @{entry.username}{isMe ? ' (YOU)' : ''}
                        </Text>
                      </View>
                      <Text style={styles.entrySub}>
                        {entry.streak}d streak · {entry.nights} {entry.nights === 1 ? 'night' : 'nights'}
                      </Text>
                      {tab !== 'global' && entry.leagueStats && (
                        <LeagueStatsChips stats={entry.leagueStats} />
                      )}
                      {tab !== 'global' && !entry.leagueStats && !isMe && (
                        <Text style={styles.entryPrivate}>// stats private</Text>
                      )}
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.entryScore, { color: scoreColor }]}>{entry.avgScore}</Text>
                      <Text style={styles.entryScoreLabel}>7D AVG</Text>
                      {entry.bestScore !== entry.avgScore && (
                        <Text style={styles.entryBest}>↑{entry.bestScore}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        );
      })()}

      {/* Join existing group */}
      <TouchableOpacity
        style={styles.joinGroupBtn}
        onPress={() => { setGroupModalMode('join'); setShowGroupModal(true); }}
      >
        <View style={styles.joinGroupInner}>
          <Text style={styles.joinGroupText}>JOIN A GROUP BY CODE →</Text>
        </View>
      </TouchableOpacity>

      {/* Add friend section */}
      {tab === 'friends' && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>ADD A FRIEND</Text>
          <View style={styles.searchOuter}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="search username..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {searching && <ActivityIndicator color={Colors.red} style={{ marginTop: 12 }} />}

          {!searching && searchResult !== 'not_found' && searchResult !== null && (
            <View style={styles.resultRow}>
              <Text style={styles.resultName}>@{searchResult.username}</Text>
              {searchResult.id === userId ? (
                <Text style={styles.resultSelf}>That's you!</Text>
              ) : addedIds.has(searchResult.id) ? (
                <Text style={styles.resultAdded}>ADDED</Text>
              ) : (
                <TouchableOpacity style={styles.addBtn} onPress={() => void handleAdd(searchResult!.id)}>
                  <Text style={styles.addBtnText}>+ ADD</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!searching && searchQuery.length > 0 && searchResult === 'not_found' && (
            <Text style={styles.notFound}>No user found.</Text>
          )}
        </>
      )}

      {/* Group management modal */}
      <Modal visible={showGroupModal} transparent animationType="slide" onRequestClose={() => setShowGroupModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <DiagonalStripes color={Colors.red} opacity={0.05} />
            <ScrollView style={{ maxHeight: 600 }}>
              <View style={styles.modalInner}>
                <Text style={styles.modalTitle}>{groupModalMode === 'create' ? 'CREATE GROUP' : 'JOIN GROUP'}</Text>
                <View style={styles.modalTabRow}>
                  {(['create', 'join'] as const).map((m) => (
                    <TouchableOpacity key={m} style={[styles.modalTab, groupModalMode === m && styles.modalTabActive]} onPress={() => setGroupModalMode(m)}>
                      <Text style={[styles.modalTabLabel, groupModalMode === m && styles.modalTabLabelActive]}>
                        {m === 'create' ? 'CREATE' : 'JOIN'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {groupModalMode === 'create' ? (
                  <>
                    {/* Group name */}
                    <Text style={styles.modalFieldLabel}>GROUP NAME</Text>
                    <View style={styles.modalInput}>
                      <TextInput
                        style={styles.modalInputText}
                        value={groupName}
                        onChangeText={setGroupName}
                        placeholder="group name..."
                        placeholderTextColor={Colors.textMuted}
                        maxLength={30}
                      />
                    </View>

                    {/* Stake / bet */}
                    <Text style={styles.modalFieldLabel}>STAKE (OPTIONAL)</Text>
                    <Text style={styles.modalHint}>e.g. "loser goes bald", "winner gets $50"</Text>
                    <View style={styles.modalInput}>
                      <TextInput
                        style={styles.modalInputText}
                        value={stake}
                        onChangeText={setStake}
                        placeholder="what's on the line..."
                        placeholderTextColor={Colors.textMuted}
                        maxLength={120}
                      />
                    </View>

                    {/* Deadline toggle */}
                    <View style={styles.deadlineRow}>
                      <Text style={styles.modalFieldLabel}>DEADLINE</Text>
                      <TouchableOpacity
                        style={[styles.deadlineToggle, hasDeadline && styles.deadlineToggleOn]}
                        onPress={() => setHasDeadline((v) => !v)}
                      >
                        <Text style={[styles.deadlineToggleText, hasDeadline && { color: Colors.red }]}>
                          {hasDeadline ? 'ON' : 'OFF'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {hasDeadline && (
                      <>
                        <TouchableOpacity
                          style={styles.datePickerBtn}
                          onPress={() => setShowDatePicker(true)}
                        >
                          <Text style={styles.datePickerBtnText}>
                            {deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </TouchableOpacity>
                        {showDatePicker && (
                          <DateTimePicker
                            value={deadline}
                            mode="date"
                            minimumDate={new Date()}
                            display={Platform.OS === 'ios' ? 'inline' : 'default'}
                            themeVariant="dark"
                            onChange={(_, date) => {
                              setShowDatePicker(Platform.OS === 'ios');
                              if (date) setDeadline(date);
                            }}
                          />
                        )}
                      </>
                    )}

                    <TouchableOpacity
                      style={[styles.modalCta, (!groupName.trim() || groupActionLoading) && { opacity: 0.5 }]}
                      disabled={!groupName.trim() || groupActionLoading}
                      onPress={handleCreateGroup}
                    >
                      <View style={styles.modalCtaInner}>
                        {groupActionLoading
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.modalCtaText}>CREATE →</Text>}
                      </View>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.modalHint}>Enter the 8-character invite code from a friend</Text>
                    <View style={styles.modalInput}>
                      <TextInput
                        style={[styles.modalInputText, { letterSpacing: 4, textTransform: 'uppercase' }]}
                        value={inviteCode}
                        onChangeText={setInviteCode}
                        placeholder="XXXXXXXX"
                        placeholderTextColor={Colors.textMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={8}
                      />
                    </View>
                    <TouchableOpacity
                      style={[styles.modalCta, (!inviteCode.trim() || groupActionLoading) && { opacity: 0.5 }]}
                      disabled={!inviteCode.trim() || groupActionLoading}
                      onPress={handleJoinGroup}
                    >
                      <View style={styles.modalCtaInner}>
                        {groupActionLoading
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.modalCtaText}>JOIN →</Text>}
                      </View>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.modalClose} onPress={() => setShowGroupModal(false)}>
                  <Text style={styles.modalCloseText}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { paddingBottom: 60 },

  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 20 },
  eyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.red, marginBottom: 4 },
  title: { fontSize: 52, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, lineHeight: 54 },
  titleUnderline: { height: 3, width: 60, backgroundColor: Colors.red, marginTop: 6, marginBottom: 4 },

  tabScroll: { marginBottom: 4 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingVertical: 12 },
  tabBtn: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.textMuted,
    backgroundColor: Colors.bgCard,
  },
  tabBtnActive: { borderColor: Colors.red, borderLeftColor: Colors.red, backgroundColor: Colors.redDim },
  tabLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted },
  tabLabelActive: { color: Colors.red },
  tabBtnNew: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.gold,
    backgroundColor: Colors.bgCard,
  },
  tabBtnNewText: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.gold },

  groupInfoBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 24, marginBottom: 6, padding: 12,
    backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.gold,
  },
  groupInfoCode: { fontSize: 9, fontWeight: '900', color: Colors.textMuted, letterSpacing: 1 },
  groupInfoCodeVal: { color: Colors.gold, letterSpacing: 3 },
  groupInfoHint: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  shareBtn: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.gold, letterSpacing: 1 },
  leaveBtn: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: Colors.red, letterSpacing: 1 },

  // Stake banner
  stakeBanner: {
    marginHorizontal: 24, marginBottom: 10, padding: 14,
    backgroundColor: Colors.bgCard, overflow: 'hidden',
    borderWidth: 1.5, borderColor: Colors.gold,
    borderLeftWidth: 4, borderLeftColor: Colors.gold,
  },
  stakeLabel: { fontSize: 7, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.gold, marginBottom: 4 },
  stakeText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },

  // Winner banner
  winnerBanner: {
    marginHorizontal: 24, marginBottom: 16, padding: 18,
    backgroundColor: Colors.bgCard, overflow: 'hidden',
    borderWidth: 2, borderColor: Colors.gold,
    borderLeftWidth: 5, borderLeftColor: Colors.gold,
    alignItems: 'center',
  },
  winnerLabel: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.gold, marginBottom: 8 },
  winnerName: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 4 },
  winnerScore: { fontSize: 11, fontWeight: '700', color: Colors.gold, letterSpacing: 1 },
  winnerStake: { fontSize: 11, color: Colors.textSecondary, marginTop: 6, fontStyle: 'italic' },

  // My-rank card
  myRankCard: {
    backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.red,
    borderLeftWidth: 6, borderLeftColor: Colors.red,
    marginBottom: 20, marginHorizontal: 24, overflow: 'hidden',
    transform: [{ skewX: '-1deg' }],
  },
  myRankInner: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14, transform: [{ skewX: '1deg' }] },
  myRankLeft: { alignItems: 'center', minWidth: 44 },
  myRankPos: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', color: Colors.red },
  myRankLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted, marginTop: 2 },
  myRankEmoji: { fontSize: 22, lineHeight: 26 },
  myRankName: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.red },
  myRankSub: { fontSize: 9, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  myRankScore: { fontSize: 32, fontWeight: '900', fontStyle: 'italic' },
  myRankScoreLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted },
  myRankBest: { fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 2 },

  // Entry rows
  entryOuter: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, borderLeftColor: Colors.textMuted,
    marginBottom: 8, marginHorizontal: 24, overflow: 'hidden',
  },
  entryOuterMe: { borderLeftColor: Colors.red, borderColor: Colors.red },
  entryOuterPodium: { borderWidth: 1.5 },
  entryInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  rankBlock: { width: 38, alignItems: 'center' },
  rankMedal: { fontSize: 22 },
  rank: { fontSize: 16, fontWeight: '900', fontStyle: 'italic' },
  entryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  entryTierEmoji: { fontSize: 14 },
  entryName: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  entrySub: { fontSize: 9, color: Colors.textMuted, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  entryScore: { fontSize: 28, fontWeight: '900', fontStyle: 'italic' },
  entryScoreLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted },
  entryBest: { fontSize: 9, fontWeight: '900', color: Colors.gold, letterSpacing: 1, marginTop: 2 },
  entryPrivate: { fontSize: 8, fontStyle: 'italic', color: Colors.textMuted, marginTop: 4, letterSpacing: 0.5 },

  joinGroupBtn: { marginHorizontal: 24, marginTop: 20, marginBottom: 8, transform: [{ skewX: '-1.5deg' }] },
  joinGroupInner: { borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 4, borderLeftColor: Colors.gold, padding: 14, backgroundColor: Colors.bgCard, transform: [{ skewX: '1.5deg' }] },
  joinGroupText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.gold, textAlign: 'center' },

  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, marginHorizontal: 24 },

  searchOuter: {
    marginHorizontal: 24,
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 4, borderLeftColor: Colors.red,
  },
  searchInput: { padding: 14, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },

  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginHorizontal: 24, padding: 14, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.green },
  resultName: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  resultSelf: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  resultAdded: { fontSize: 10, fontWeight: '900', color: Colors.green, letterSpacing: 1 },
  addBtn: { backgroundColor: Colors.red, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  notFound: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', marginTop: 12, marginHorizontal: 24 },

  noDataOuter: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 5, borderLeftColor: Colors.textMuted,
    marginBottom: 14, marginHorizontal: 24, overflow: 'hidden',
  },
  noDataInner: { padding: 24, alignItems: 'center' },
  noDataText: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 8 },
  noDataSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Group modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.bgCard, borderTopWidth: 3, borderTopColor: Colors.red, overflow: 'hidden' },
  modalInner: { padding: 28, paddingBottom: 48 },
  modalTitle: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 20 },
  modalTabRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  modalTab: { flex: 1, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.textMuted, backgroundColor: Colors.bgDeep, alignItems: 'center' },
  modalTabActive: { borderColor: Colors.red, borderLeftColor: Colors.red },
  modalTabLabel: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted },
  modalTabLabelActive: { color: Colors.red },
  modalFieldLabel: { fontSize: 8, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textSecondary, marginBottom: 6 },
  modalHint: { fontSize: 11, color: Colors.textMuted, marginBottom: 12, lineHeight: 18 },
  modalInput: { backgroundColor: Colors.bgDeep, borderWidth: 1.5, borderColor: Colors.red, borderLeftWidth: 4, borderLeftColor: Colors.red, marginBottom: 16 },
  modalInputText: { padding: 14, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  modalCta: { transform: [{ skewX: '-1.5deg' }], marginTop: 8 },
  modalCtaInner: { backgroundColor: Colors.red, paddingVertical: 16, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  modalCtaText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },
  modalClose: { marginTop: 16, alignItems: 'center' },
  modalCloseText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted },

  // Deadline
  deadlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  deadlineToggle: { borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Colors.bgDeep },
  deadlineToggleOn: { borderColor: Colors.red },
  deadlineToggleText: { fontSize: 10, fontWeight: '900', letterSpacing: 2, color: Colors.textMuted },
  datePickerBtn: { borderWidth: 1.5, borderColor: Colors.gold, borderLeftWidth: 4, borderLeftColor: Colors.gold, padding: 14, backgroundColor: Colors.bgDeep, marginBottom: 16 },
  datePickerBtnText: { fontSize: 14, fontWeight: '700', color: Colors.gold },

  empty: { flex: 1, backgroundColor: Colors.bgDeep, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: 28, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, marginBottom: 8 },
  emptyBar: { height: 3, width: 40, backgroundColor: Colors.red, marginBottom: 16 },
  emptySub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
});
