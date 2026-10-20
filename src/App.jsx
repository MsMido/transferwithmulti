import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { db } from './firebase/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

// ==========================================
// [설정 영역] 팀 및 초기 인원 구성
// ==========================================
const TEAM_NAMES = { M: 'M', S: 'S' };
const TOTAL_KEYS_BY_TEAM = { M: 4, S: 4 };
const ADMIN_MEMBER_NAME = '김명수';

const INITIAL_POOL = [
  // --- M팀 ---
  { id: 1, name: '김명수', team: 'M', keyCount: 0 },
  { id: 2, name: '류혜미', team: 'M', keyCount: 0 },
  { id: 3, name: '김만수', team: 'M', keyCount: 1 },
  { id: 4, name: '이구연', team: 'M', keyCount: 0 },
  { id: 5, name: '한승우', team: 'M', keyCount: 0 },
  { id: 6, name: '강천주', team: 'M', keyCount: 1 },
  { id: 7, name: '권재호', team: 'M', keyCount: 0 },
  { id: 8, name: '김진영', team: 'M', keyCount: 0 },
  { id: 9, name: '황정민', team: 'M', keyCount: 1 },
  { id: 10, name: '황종철', team: 'M', keyCount: 1 },
  { id: 11, name: '김경훈', team: 'M', keyCount: 0 },
  // --- S팀 ---
  { id: 101, name: '정승원', team: 'S', keyCount: 0 },
  { id: 102, name: '조재욱', team: 'S', keyCount: 0 },
  { id: 103, name: '이영한', team: 'S', keyCount: 1 },
  { id: 104, name: '우용', team: 'S', keyCount: 1 },
  { id: 105, name: '박상훈', team: 'S', keyCount: 1 },
  { id: 106, name: '김형주', team: 'S', keyCount: 1 },
  { id: 107, name: '고진석', team: 'S', keyCount: 0 }
];

const INITIAL_SCHEDULES = [];

function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('transferWith_activeTab') || 'Working Day');
  const [topTeam, setTopTeam] = useState(() => localStorage.getItem('transferWith_topTeam') || 'M');
  const [bottomTeam, setBottomTeam] = useState(() => localStorage.getItem('transferWith_bottomTeam') || 'M');

  const [myUserNo] = useState(() => {
    let savedNo = localStorage.getItem('transferWith_userNo');
    if (!savedNo) {
      savedNo = Math.floor(1000 + Math.random() * 9000).toString();
      localStorage.setItem('transferWith_userNo', savedNo);
    }
    return savedNo;
  });

  const [waitingPool, setWaitingPool] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [individualMembers, setIndividualMembers] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);

  const [selectedMember, setSelectedMember] = useState(null);
  const [keySenderMember, setKeySenderMember] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isMyInfoModalOpen, setIsMyInfoModalOpen] = useState(false);
  const [newScheduleTitle, setNewScheduleTitle] = useState('');

  const [, setPoolTapCount] = useState(0);
  const poolTapTimerRef = useRef(null);
  const adminTapRef = useRef({ count: 0, startTime: 0, timer: null });
  const lastTapRef = useRef({ id: null, time: 0 });

  useEffect(() => {
    localStorage.setItem('transferWith_activeTab', activeTab);
    resetSelection();
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('transferWith_topTeam', topTeam);
    resetSelection();
  }, [topTeam]);

  useEffect(() => {
    localStorage.setItem('transferWith_bottomTeam', bottomTeam);
    setKeySenderMember(null);
  }, [bottomTeam]);

  const resetSelection = () => {
    setSelectedMember(null);
    setKeySenderMember(null);
  };

  const getStateDocRef = () => {
    const docId = activeTab === 'Working Day' ? 'workingDay' : 'weekend';
    return doc(db, 'carpoolStateMulti', docId);
  };

  const normalizeStateData = (data) => {
    const initMap = new Map(INITIAL_POOL.map(m => [m.id, m]));
    const normalizeMember = (m) => {
      const ref = initMap.get(m.id);
      return {
        ...m,
        team: m.team || (ref ? ref.team : 'M'),
        keyCount: m.keyCount || 0
      };
    };

    let pool = (data.waitingPool || []).map(normalizeMember);
    let ind = (data.individualMembers || []).map(normalizeMember);
    let scheds = (data.schedules || []).map(s => ({
      ...s,
      team: s.team || 'M',
      members: (s.members || []).map(normalizeMember)
    }));

    const existingIds = new Set([
      ...pool.map(m => m.id),
      ...ind.map(m => m.id),
      ...scheds.flatMap(s => s.members.map(m => m.id))
    ]);

    const missingMembers = INITIAL_POOL.filter(m => !existingIds.has(m.id));
    if (missingMembers.length > 0) {
      pool = [...pool, ...missingMembers];
    }

    return { pool, ind, scheds };
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(getStateDocRef(), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const { pool, ind, scheds } = normalizeStateData(data);
        setWaitingPool(pool);
        setIndividualMembers(ind);
        setSchedules(scheds);
        setSystemLogs(data.systemLogs || []);
      } else {
        setDoc(getStateDocRef(), {
          waitingPool: INITIAL_POOL,
          schedules: INITIAL_SCHEDULES,
          individualMembers: [],
          systemLogs: [{ text: `${activeTab} 시스템이 초기화되었습니다.`, time: new Date().toLocaleTimeString(), userNo: 'System' }]
        });
      }
    });
    return () => unsubscribe();
  }, [activeTab]);

  const validateKeys = (pool, ind, scheds) => {
    const keySums = { M: 0, S: 0 };
    const countPool = (arr) => arr.forEach(m => {
      const t = m.team || 'M';
      if (keySums[t] !== undefined) keySums[t] += (m.keyCount || 0);
    });

    countPool(pool);
    countPool(ind);
    scheds.forEach(s => countPool(s.members || []));

    for (const teamKey of Object.keys(TOTAL_KEYS_BY_TEAM)) {
      if (keySums[teamKey] !== TOTAL_KEYS_BY_TEAM[teamKey]) return false;
    }
    return true;
  };

  const commitState = (newPool, newSchedules, newIndividual, logDesc) => {
    if (!validateKeys(newPool, newIndividual, newSchedules)) {
      alert('오류: 팀별 열쇠의 총 개수가 변조되었습니다!');
      return;
    }

    const newLog = {
      text: `[${activeTab}] ${logDesc}`,
      time: new Date().toLocaleTimeString(),
      userNo: myUserNo
    };

    setDoc(getStateDocRef(), {
      waitingPool: newPool,
      schedules: newSchedules,
      individualMembers: newIndividual,
      systemLogs: [newLog, ...systemLogs].slice(0, 100)
    }, { merge: true });

    resetSelection();
  };

  const handleCycleTopTeam = () => {
    setTopTeam(prev => (prev === 'M' ? 'S' : prev === 'S' ? 'ALL' : 'M'));
  };

  const handleMoveMemberTo = (targetType, targetScheduleId = null) => {
    if (!selectedMember) return;
    const member = selectedMember;

    let newPool = waitingPool.filter(m => m.id !== member.id);
    let newInd = individualMembers.filter(m => m.id !== member.id);
    let newScheds = schedules.map(s => ({
      ...s,
      members: s.members.filter(m => m.id !== member.id)
    }));

    let targetName = `${TEAM_NAMES[member.team]} 대기열`;
    if (targetType === 'pool') {
      newPool = [...newPool, member];
    } else if (targetType === 'individual') {
      newInd = [...newInd, member];
      targetName = '개별 이동';
    } else if (targetType === 'schedule') {
      newScheds = newScheds.map(s => {
        if (s.id === targetScheduleId) {
          targetName = `[${TEAM_NAMES[s.team || 'M']}] ${s.title}`;
          const updatedMembers = [...s.members, member];
          return {
            ...s,
            members: updatedMembers,
            hasBeenConfirmed: s.hasBeenConfirmed || updatedMembers.length >= 3
          };
        }
        return s;
      });
    }

    commitState(newPool, newScheds, newInd, `${member.name}(${TEAM_NAMES[member.team]})님이 [${targetName}](으)로 이동함`);
  };

  const handleTransferKeyTo = (targetMember) => {
    if (!keySenderMember || keySenderMember.id === targetMember.id) return;
    if (keySenderMember.team !== targetMember.team) {
      alert(`열쇠는 같은 팀(${TEAM_NAMES[keySenderMember.team]}) 멤버에게만 전달할 수 있습니다.`);
      return;
    }

    const transfer = (arr) => arr.map(m => {
      if (m.id === keySenderMember.id) return { ...m, keyCount: Math.max(0, (m.keyCount || 0) - 1) };
      if (m.id === targetMember.id) return { ...m, keyCount: (m.keyCount || 0) + 1 };
      return m;
    });

    commitState(
      transfer(waitingPool),
      schedules.map(s => ({ ...s, members: transfer(s.members) })),
      transfer(individualMembers),
      `${keySenderMember.name}님이 ${targetMember.name}님에게 키를 전달함`
    );
  };

  const handleMemberClick = (member, e) => {
    e.stopPropagation();
    const now = Date.now();

    if (member.name === ADMIN_MEMBER_NAME) {
      if (adminTapRef.current.count === 0 || now - adminTapRef.current.startTime > 5000) {
        adminTapRef.current = { count: 1, startTime: now, timer: null };
      } else {
        adminTapRef.current.count += 1;
      }
      if (adminTapRef.current.count >= 10) {
        adminTapRef.current.count = 0;
        resetSelection();
        setIsLogModalOpen(true);
        return;
      }
    }

    const isDoubleTap = lastTapRef.current.id === member.id && (now - lastTapRef.current.time < 300);
    lastTapRef.current = { id: member.id, time: now };

    if (isDoubleTap && (member.keyCount || 0) > 0) {
      setKeySenderMember(keySenderMember?.id === member.id ? null : member);
      setSelectedMember(null);
      return;
    }

    if (keySenderMember) {
      if (keySenderMember.id === member.id) setKeySenderMember(null);
      else handleTransferKeyTo(member);
      return;
    }

    setSelectedMember(selectedMember?.id === member.id ? null : member);
    setKeySenderMember(null);
  };

  const handleCompleteSchedule = (scheduleId, title) => {
    const target = schedules.find(s => s.id === scheduleId);
    if (!target) return;

    const msg = target.members.length > 0
      ? `[${title}] 스케줄을 완료 및 해제하시겠습니까?\n배치된 인원은 대기열로 복귀합니다.`
      : `[${title}] 빈 스케줄을 삭제하시겠습니까?`;

    if (window.confirm(msg)) {
      commitState([...waitingPool, ...target.members], schedules.filter(s => s.id !== scheduleId), individualMembers, `[${title}] 스케줄 완료/삭제`);
    }
  };

  const handleResetIndividual = () => {
    const visibleInd = topTeam === 'ALL' ? individualMembers : individualMembers.filter(m => m.team === topTeam);
    if (visibleInd.length === 0) return;

    const label = topTeam === 'ALL' ? '전체' : TEAM_NAMES[topTeam];
    if (window.confirm(`${label} 개별 이동 인원을 모두 대기열로 복귀시키겠습니까?`)) {
      const returningIds = new Set(visibleInd.map(m => m.id));
      commitState([...waitingPool, ...visibleInd], schedules, individualMembers.filter(m => !returningIds.has(m.id)), `${label} 개별 이동 인원 복귀`);
    }
  };

  const handleForceConfirm = (scheduleId, e) => {
    e.stopPropagation();
    const target = schedules.find(s => s.id === scheduleId);
    const newScheds = schedules.map(s => s.id === scheduleId ? { ...s, hasBeenConfirmed: true } : s);
    commitState(waitingPool, newScheds, individualMembers, `[${target?.title}] 스케줄 강제 확정`);
  };

  const handleAddSchedule = (e) => {
    e.preventDefault();
    if (!newScheduleTitle.trim()) return;

    const schedTeam = topTeam === 'ALL' ? bottomTeam : topTeam;
    const newSched = {
      id: `s_${Date.now()}`,
      title: newScheduleTitle,
      team: schedTeam,
      hasBeenConfirmed: false,
      members: []
    };

    commitState(waitingPool, [...schedules, newSched], individualMembers, `[${TEAM_NAMES[schedTeam]}] 새 스케줄 [${newScheduleTitle}] 생성`);
    setNewScheduleTitle('');
    setIsModalOpen(false);
  };

  // 1번 요건: 상하단 토글이 같더라도 멤버 이름 앞에 팀 마크가 항상 나오도록 수정 (조건 제거)
  const renderMemberChip = (member, contextTeam = null) => {
    const isSelected = selectedMember?.id === member.id;
    const isKeySender = keySenderMember?.id === member.id;
    const isKeyTarget = keySenderMember && !isKeySender && keySenderMember.team === member.team;
    const keys = Array.from({ length: member.keyCount || 0 });

    let style = 'bg-white/90 border-white/50 text-slate-800 hover:bg-white';
    if (isSelected) {
      style = 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-300 scale-105 shadow-md';
    } else if (isKeySender) {
      style = 'bg-amber-500 text-white border-amber-400 ring-2 ring-amber-300 scale-105 shadow-md';
    } else if (isKeyTarget) {
      style = 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-300 animate-pulse';
    } else if (keySenderMember && keySenderMember.team !== member.team) {
      style = 'bg-white/50 border-white/30 text-slate-400 opacity-60';
    } else {
      style = member.team === 'M' ? 'bg-sky-100 border-sky-300 text-sky-950 font-semibold' : 'bg-blue-900/15 border-blue-400 text-blue-950 font-semibold';
    }

    return (
      <div
        key={member.id}
        onClick={(e) => handleMemberClick(member, e)}
        className={`flex items-center pl-2 pr-1.5 py-1 rounded-lg border shadow-sm cursor-pointer transition-all text-xs backdrop-blur-sm ${style}`}
      >
        <span className={`text-[9px] font-extrabold px-1 py-0.2 rounded mr-1 ${
          isSelected ? 'bg-white/20 text-white' : member.team === 'M' ? 'bg-sky-400 text-slate-950' : 'bg-blue-900 text-white'
        }`}>
          {TEAM_NAMES[member.team]}
        </span>
        <span className="py-0.5">{member.name}</span>
        <div className="flex gap-0.5 ml-1.5 items-center">
          {keys.map((_, idx) => (
            <span
              key={idx}
              onClick={(e) => { e.stopPropagation(); setKeySenderMember(keySenderMember?.id === member.id ? null : member); setSelectedMember(null); }}
              className={`px-1.5 py-0.5 rounded text-[10px] shadow-sm border cursor-pointer ${
                isKeySender ? 'bg-amber-600 text-white border-amber-400 scale-110' : 'bg-amber-100 text-amber-900 border-amber-300'
              }`}
            >
              🔑
            </span>
          ))}
        </div>
      </div>
    );
  };

  const visibleIndMembers = topTeam === 'ALL' ? individualMembers : individualMembers.filter(m => m.team === topTeam);
  const visibleSchedules = topTeam === 'ALL' ? schedules : schedules.filter(s => (s.team || 'M') === topTeam);
  const visibleWaitingPool = waitingPool.filter(m => m.team === bottomTeam);
  const targetScheduleTeamForModal = topTeam === 'ALL' ? bottomTeam : topTeam;

  // 2, 3번 요건: 어두운 배경에서도 잘 보이고 M팀과 전체 모드가 확연히 구별되는 색감 테마 적용
  const topToggleBtnStyle = topTeam === 'M'
    ? 'bg-sky-400 text-slate-950 border-sky-300 font-bold hover:bg-sky-300'
    : topTeam === 'S'
      ? 'bg-blue-900 text-white border-blue-800 font-bold hover:bg-blue-800'
      : 'bg-slate-700 text-slate-100 border-slate-600 font-bold hover:bg-slate-800';

  const scheduleRegBtnStyle = topTeam === 'M'
    ? 'bg-sky-200 border-sky-400 text-sky-950 font-bold hover:bg-sky-300'
    : topTeam === 'S'
      ? 'bg-blue-900/30 border-blue-500 text-blue-950 font-bold hover:bg-blue-900/40'
      : 'bg-slate-300 border-slate-400 text-slate-900 font-bold hover:bg-slate-400';

  const indAreaStyle = topTeam === 'M'
    ? 'bg-sky-100/90 border-sky-300 shadow-md'
    : topTeam === 'S'
      ? 'bg-blue-950/10 border-blue-300 shadow-md'
      : 'bg-slate-100/90 border-slate-300 shadow-md';

  return (
    <div className="min-h-screen flex flex-col font-sans select-none relative overflow-x-hidden text-slate-900">
      {/* 배경 레이어 */}
      <div className={`fixed inset-0 transition-colors duration-700 z-[-3] ${activeTab === 'Working Day' ? 'bg-slate-900' : 'bg-orange-50'}`} />
      <div className="fixed inset-0 flex justify-center z-[-2] pointer-events-none">
        <div className="w-full max-w-lg h-full bg-cover bg-center opacity-[0.35]" style={{ backgroundImage: `url(${activeTab === 'Working Day' ? '/Working.png' : '/Weekend.png'})` }} />
      </div>
      <div className="fixed inset-0 flex justify-center z-[-1] pointer-events-none">
        <div className={`w-full max-w-lg h-full ${activeTab === 'Working Day' ? 'bg-slate-900/50' : 'bg-white/40'}`} />
      </div>

      {/* 상단 알림 배너 */}
      {selectedMember && (
        <div className="fixed top-12 left-0 right-0 bg-blue-600/95 backdrop-blur-md text-white text-xs font-bold py-1.5 px-3 text-center z-30 shadow-md flex justify-center items-center gap-2 animate-bounce">
          <span>🎯 [{TEAM_NAMES[selectedMember.team]} {selectedMember.name}] 이동할 장소를 터치하세요!</span>
          <button onClick={resetSelection} className="bg-blue-700 px-2 py-0.5 rounded text-[10px]">취소</button>
        </div>
      )}
      {keySenderMember && (
        <div className="fixed top-12 left-0 right-0 bg-amber-500/95 backdrop-blur-md text-white text-xs font-bold py-1.5 px-3 text-center z-30 shadow-md flex justify-center items-center gap-2 animate-bounce">
          <span>🔑 [{keySenderMember.name}]의 키를 받을 팀원을 터치하세요!</span>
          <button onClick={resetSelection} className="bg-amber-600 px-2 py-0.5 rounded text-[10px]">취소</button>
        </div>
      )}

      {/* 헤더 탭 (Working Day / Weekend) */}
      <div className="w-full bg-white/60 backdrop-blur-lg shadow-sm sticky top-0 z-20 border-b border-white/40">
        <div className="flex h-11">
          <button onClick={() => setActiveTab('Working Day')} className={`w-1/2 flex items-center justify-center font-bold text-sm transition-all gap-1.5 ${activeTab === 'Working Day' ? 'bg-slate-900 text-white shadow-inner' : 'text-slate-800 hover:bg-white/50'}`}>🏢 Working Day</button>
          <button onClick={() => setActiveTab('Weekend')} className={`w-1/2 flex items-center justify-center font-bold text-sm transition-all gap-1.5 ${activeTab === 'Weekend' ? 'bg-orange-600 text-white shadow-inner' : 'text-slate-800 hover:bg-white/50'}`}>🌴 Weekend</button>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 w-full max-w-lg mx-auto p-3 flex flex-col gap-4 mb-40 relative z-10">
        {/* 개별 이동 구역 & 스케줄 등록 버튼 묶음 */}
        <div className="flex justify-between items-stretch gap-2.5 mt-1">
          <div
            onClick={() => selectedMember && handleMoveMemberTo('individual')}
            className={`flex-1 min-w-0 backdrop-blur-md rounded-xl p-2.5 border transition-all ${indAreaStyle} ${selectedMember ? 'border-blue-400 ring-2 ring-blue-300/50 cursor-pointer bg-blue-50/90' : ''}`}
          >
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider truncate">개별 이동 / 기타 구역 ({topTeam === 'ALL' ? '전체' : TEAM_NAMES[topTeam]})</span>
              {visibleIndMembers.length > 0 && (
                <button onClick={(e) => { e.stopPropagation(); handleResetIndividual(); }} className="text-[10px] font-bold text-slate-800 bg-white hover:bg-slate-100 px-1.5 py-0.5 rounded shadow-sm border border-slate-300">해제</button>
              )}
            </div>
            <div className="min-h-[2.5rem] rounded-lg border border-dashed border-slate-400 p-1.5 flex flex-wrap gap-1.5 items-center bg-white/60">
              {visibleIndMembers.length === 0 && <span className="text-slate-700 text-[11px] m-auto font-medium">{selectedMember ? '여기를 눌러서 이동' : '개별 이동 인원 없음'}</span>}
              {visibleIndMembers.map(m => renderMemberChip(m, topTeam === 'ALL' ? null : topTeam))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 shrink-0 w-28">
            <button onClick={() => setIsModalOpen(true)} className={`flex-1 flex flex-col items-center justify-center gap-0.5 backdrop-blur-md px-2 py-2 rounded-xl text-xs shadow-sm border active:scale-95 transition-all whitespace-nowrap ${scheduleRegBtnStyle}`}>
              <div className="flex items-center gap-1">
                <Plus size={14} />
                <span>스케줄 등록</span>
              </div>
              <span className="text-[10px] font-bold text-blue-800">({TEAM_NAMES[targetScheduleTeamForModal]})</span>
            </button>

            <button onClick={handleCycleTopTeam} className={`py-1.5 px-2 rounded-xl text-xs shadow-sm border backdrop-blur-md active:scale-95 transition-all flex items-center justify-center gap-1 whitespace-nowrap ${topToggleBtnStyle}`}>
              <span>🔄 {topTeam === 'ALL' ? '전체 보기' : `${TEAM_NAMES[topTeam]} 보기`}</span>
            </button>
          </div>
        </div>

        {/* 스케줄 목록 */}
        <div className="flex flex-col gap-4">
          {visibleSchedules.map((schedule) => {
            const members = schedule.members || [];
            const keyCount = members.reduce((sum, m) => sum + (m.keyCount || 0), 0);
            const schedTeam = schedule.team || 'M';

            let status = '대기';
            if (schedule.hasBeenConfirmed || members.length >= 3) status = keyCount === 0 ? 'SOS' : '확정';

            const borderClass = status === '확정' ? 'border-blue-500 ring-2 ring-blue-400' : status === 'SOS' ? 'border-red-500 ring-2 ring-red-400 animate-pulse' : 'border-slate-300';
            const labelClass = status === '확정' ? 'bg-blue-200 text-blue-900 font-bold' : status === 'SOS' ? 'bg-red-200 text-red-900 font-bold animate-pulse' : 'bg-white text-slate-800 font-semibold';
            const tabColor = schedTeam === 'M' ? 'bg-sky-300 text-sky-950 font-bold' : 'bg-blue-900 text-white font-bold';
            const bodyBg = schedTeam === 'M' ? 'bg-sky-50/90 border-sky-300' : 'bg-blue-950/15 border-blue-300';

            return (
              <div key={schedule.id} className="relative mt-2">
                <div className="flex justify-between items-end mb-0 z-[1] relative">
                  <button onClick={() => handleCompleteSchedule(schedule.id, schedule.title)} className={`px-3 py-1 rounded-t-lg text-xs shadow-sm flex items-center gap-1.5 ${tabColor} backdrop-blur-sm`}>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/15 font-black">{TEAM_NAMES[schedTeam]}</span>
                    <span>{schedule.title}</span>
                  </button>
                  <div className={`px-2 py-0.5 rounded-t-md text-[11px] ${labelClass} shadow-sm backdrop-blur-sm`}>{status}</div>
                </div>

                <div
                  onClick={() => selectedMember && handleMoveMemberTo('schedule', schedule.id)}
                  className={`backdrop-blur-md rounded-b-xl rounded-tl-none rounded-tr-xl p-3 shadow-sm border ${bodyBg} ${borderClass} ${selectedMember ? 'border-blue-400 ring-2 ring-blue-300/50 cursor-pointer bg-blue-50/90' : ''} min-h-[5rem] flex flex-wrap gap-2 items-start transition-all relative`}
                >
                  {members.length === 0 && <span className="text-slate-700 text-xs font-semibold m-auto">{selectedMember ? '여기를 눌러서 합류' : '대기 중인 인원이 없습니다'}</span>}
                  {members.map(m => renderMemberChip(m, schedTeam))}
                  {status === '대기' && members.length > 0 && (
                    <button onClick={(e) => handleForceConfirm(schedule.id, e)} className="absolute bottom-2 right-2 p-1 bg-white text-blue-700 rounded-md hover:bg-slate-100 border border-blue-300 shadow-sm" title="강제 확정">
                      <Check size={14} strokeWidth={3} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* 하단 고정 바 (대기 멤버 풀) */}
      <div
        onClick={() => {
          if (selectedMember) { handleMoveMemberTo('pool'); return; }
          setPoolTapCount(prev => {
            const next = prev + 1;
            if (poolTapTimerRef.current) clearTimeout(poolTapTimerRef.current);
            poolTapTimerRef.current = setTimeout(() => setPoolTapCount(0), 2000);
            if (next >= 10) { setIsMyInfoModalOpen(true); return 0; }
            return next;
          });
        }}
        className={`fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-300 p-3 shadow-xl z-10 transition-all cursor-pointer ${selectedMember ? 'border-blue-500 ring-4 ring-blue-400/50 bg-blue-50' : ''}`}
      >
        <div className="max-w-lg mx-auto flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">{selectedMember ? `👉 눌러서 [${TEAM_NAMES[selectedMember.team]}] 대기열 복귀` : '대기 멤버 풀'}</span>
              <span className="text-[11px] font-bold text-slate-900">({visibleWaitingPool.length}명)</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setBottomTeam(prev => prev === 'M' ? 'S' : 'M'); }} className={`px-3 py-1 rounded-lg text-[11px] font-bold shadow-sm border backdrop-blur-md active:scale-95 transition-all flex items-center gap-1 ${bottomTeam === 'M' ? 'bg-sky-400 text-slate-950 border-sky-300' : 'bg-blue-900 text-white border-blue-800'}`}>
              <span>🔄 {TEAM_NAMES[bottomTeam]}</span>
            </button>
          </div>

          <div className="min-h-[3.5rem] max-h-32 overflow-y-auto rounded-xl border border-dashed border-slate-400 p-2 flex flex-wrap gap-1.5 items-start bg-white/70">
            {visibleWaitingPool.length === 0 && <span className="text-slate-700 text-[11px] m-auto font-semibold">{TEAM_NAMES[bottomTeam]}에 대기 중인 인원이 없습니다.</span>}
            {visibleWaitingPool.map(m => renderMemberChip(m, bottomTeam))}
          </div>
        </div>
      </div>

      {/* 모달들 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-bold text-slate-900">[{TEAM_NAMES[targetScheduleTeamForModal]}] 새 스케줄 생성</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-600 hover:text-slate-900"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddSchedule} className="flex flex-col gap-3">
              <input type="text" value={newScheduleTitle} onChange={(e) => setNewScheduleTitle(e.target.value)} placeholder="예: 공장 > HEB 마트 > 숙소" className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white text-slate-900 font-medium" autoFocus />
              <button type="submit" disabled={!newScheduleTitle.trim()} className="w-full bg-slate-900 text-white font-bold py-2 rounded-lg text-xs disabled:bg-slate-400">등록하기</button>
            </form>
          </div>
        </div>
      )}

      {isLogModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-4 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-3 pb-2 border-b">
              <h2 className="text-sm font-bold text-slate-900">📋 최근 변경 이력</h2>
              <button onClick={() => setIsLogModalOpen(false)} className="text-slate-600"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
              {systemLogs.map((log, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-500 font-semibold">
                    <span>#{log.userNo}</span><span>{log.time}</span>
                  </div>
                  <div className="text-slate-900 font-medium">{log.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isMyInfoModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs p-5 shadow-2xl flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-xl mb-1">🔑</div>
            <h2 className="text-base font-bold text-slate-900">내 시스템 사용자 번호</h2>
            <div className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-2 w-full"><span className="text-xl font-black text-blue-700 tracking-widest">#{myUserNo}</span></div>
            <button onClick={() => setIsMyInfoModalOpen(false)} className="w-full bg-slate-900 text-white font-bold py-2 rounded-xl text-xs">확인</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;