import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { db } from './firebase/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

// ==========================================
// [하드코딩 설정 영역] 직접 조절해서 사용하세요
// ==========================================
const TEAM_NAMES = {
  M: 'M',
  S: 'S',
};

// 팀별 고정 열쇠 총합 (무결성 검증 기준)
const TOTAL_KEYS_BY_TEAM = {
  M: 4,
  S: 4,
};

// 5초 이내 10번 클릭 시 변경 이력 로그 모달이 열리는 타겟 이름
const ADMIN_MEMBER_NAME = '김명수';

// 전체 초기 인원 및 소속 팀, 초기 열쇠 배분
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
  // 1. 주중 / 주말 탭 상태
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('transferWith_activeTab') || 'Working Day';
  });

  // 2. 상단 메인 뷰 팀 토글 ('ALL' | 'M' | 'S') - 독립 저장
  const [topTeam, setTopTeam] = useState(() => {
    return localStorage.getItem('transferWith_topTeam') || 'M';
  });

  // 3. 하단 대기열 팀 토글 ('M' | 'S') - 상단과 연동 없이 독립 저장
  const [bottomTeam, setBottomTeam] = useState(() => {
    return localStorage.getItem('transferWith_bottomTeam') || 'M';
  });

  // 4. 내 고유 사용자 번호
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

  // 대기 멤버 풀 빈 공간 10연타 감지용 (내 번호 확인)
  const [, setPoolTapCount] = useState(0);
  const poolTapTimerRef = useRef(null);

  // 특정(관리자) 이름 5초 이내 10연타 감지용 (로그 확인)
  const adminTapRef = useRef({ count: 0, startTime: 0, timer: null });

  // 더블탭 감지용
  const lastTapRef = useRef({ id: null, time: 0 });

  // 상단 탭(주중/주말) 변경 시 저장 및 선택 상태 초기화
  useEffect(() => {
    localStorage.setItem('transferWith_activeTab', activeTab);
    setSelectedMember(null);
    setKeySenderMember(null);
  }, [activeTab]);

  // 상단 팀 뷰 변경 시 저장 및 선택 상태 초기화 (하단 토글과 연동 없음)
  useEffect(() => {
    localStorage.setItem('transferWith_topTeam', topTeam);
    setSelectedMember(null);
    setKeySenderMember(null);
  }, [topTeam]);

  // 하단 대기열 팀 토글 변경 시 저장
  useEffect(() => {
    localStorage.setItem('transferWith_bottomTeam', bottomTeam);
    setKeySenderMember(null);
  }, [bottomTeam]);

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
    const stateDocRef = getStateDocRef();

    const unsubscribe = onSnapshot(stateDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const { pool, ind, scheds } = normalizeStateData(data);
        setWaitingPool(pool);
        setIndividualMembers(ind);
        setSchedules(scheds);
        setSystemLogs(data.systemLogs || []);
      } else {
        setDoc(stateDocRef, {
          waitingPool: INITIAL_POOL,
          schedules: INITIAL_SCHEDULES,
          individualMembers: [],
          systemLogs: [{ text: `${activeTab} 시스템이 초기화되었습니다.`, time: new Date().toLocaleTimeString(), userNo: 'System' }]
        });
      }
    });

    return () => unsubscribe();
  }, [activeTab]);

  const validateAndCalculateKeys = (pool, ind, scheds) => {
    const keySums = { M: 0, S: 0 };
    const countPool = (arr) => arr.forEach(m => {
      const t = m.team || 'M';
      if (keySums[t] !== undefined) {
        keySums[t] += (m.keyCount || 0);
      }
    });

    countPool(pool);
    countPool(ind);
    scheds.forEach(s => countPool(s.members || []));

    for (const teamKey of Object.keys(TOTAL_KEYS_BY_TEAM)) {
      if (keySums[teamKey] !== TOTAL_KEYS_BY_TEAM[teamKey]) {
        console.warn(`[무결성 경고] ${TEAM_NAMES[teamKey]} 열쇠 개수가 일치하지 않습니다! 현재: ${keySums[teamKey]} / 기대값: ${TOTAL_KEYS_BY_TEAM[teamKey]}`);
        return false;
      }
    }
    return true;
  };

  const commitStateToFirebase = (newPool, newSchedules, newIndividual, logDescription) => {
    if (!validateAndCalculateKeys(newPool, newIndividual, newSchedules)) {
      alert('오류: 팀별 열쇠의 총 개수가 변조되었습니다! 작업이 취소됩니다.');
      return;
    }

    const newLogEntry = {
      text: `[${activeTab}] ${logDescription}`,
      time: new Date().toLocaleTimeString(),
      userNo: myUserNo
    };

    const updatedLogs = [newLogEntry, ...systemLogs].slice(0, 100);

    setDoc(getStateDocRef(), {
      waitingPool: newPool,
      schedules: newSchedules,
      individualMembers: newIndividual,
      systemLogs: updatedLogs
    }, { merge: true });

    setSelectedManagerAndReset();
  };

  const setSelectedManagerAndReset = () => {
    setSelectedMember(null);
    setKeySenderMember(null);
  };

  const handleCycleTopTeam = () => {
    setTopTeam(prev => {
      if (prev === 'M') return 'S';
      if (prev === 'S') return 'ALL';
      return 'M';
    });
  };
  
  const handleMoveMemberTo = (targetAreaType, targetScheduleId = null) => {
    if (!selectedMember) return;
    const memberData = selectedMember;

    let newPool = waitingPool.filter(m => m.id !== memberData.id);
    let newIndividual = individualMembers.filter(m => m.id !== memberData.id);
    let newSchedules = schedules.map(s => ({
      ...s,
      members: s.members.filter(m => m.id !== memberData.id)
    }));

    let targetName = `${TEAM_NAMES[memberData.team]} 대기열`;
    if (targetAreaType === 'pool') {
      newPool = [...newPool, memberData];
    } else if (targetAreaType === 'individual') {
      newIndividual = [...newIndividual, memberData];
      targetName = '개별 이동';
    } else if (targetAreaType === 'schedule') {
      newSchedules = newSchedules.map(s => {
        if (s.id === targetScheduleId) {
          targetName = `[${TEAM_NAMES[s.team || 'M']}] ${s.title}`;
          const updatedMembers = [...s.members, memberData];
          return {
            ...s,
            members: updatedMembers,
            hasBeenConfirmed: s.hasBeenConfirmed || updatedMembers.length >= 3
          };
        }
        return s;
      });
    }

    commitStateToFirebase(newPool, newSchedules, newIndividual, `${memberData.name}(${TEAM_NAMES[memberData.team]})님이 [${targetName}](으)로 이동함`);
  };

  const handleTransferKeyTo = (targetMember) => {
    if (!keySenderMember) return;
    const sourceId = keySenderMember.id;
    const targetMemberId = targetMember.id;
    if (sourceId === targetMemberId) return;

    if (keySenderMember.team !== targetMember.team) {
      alert(`열쇠는 같은 팀(${TEAM_NAMES[keySenderMember.team]}) 멤버에게만 전달할 수 있습니다.`);
      return;
    }

    const transferInArray = (arr) => {
      return arr.map(m => {
        if (m.id === sourceId) {
          return { ...m, keyCount: Math.max(0, (m.keyCount || 0) - 1) };
        }
        if (m.id === targetMemberId) {
          return { ...m, keyCount: (m.keyCount || 0) + 1 };
        }
        return m;
      });
    };

    const newPool = transferInArray(waitingPool);
    const newIndividual = transferInArray(individualMembers);
    const newSchedules = schedules.map(s => ({
      ...s,
      members: transferInArray(s.members)
    }));

    commitStateToFirebase(newPool, newSchedules, newIndividual, `${keySenderMember.name}님이 ${targetMember.name}님에게 키를 전달함`);
  };

  const handleMemberClick = (member, e) => {
    e.stopPropagation();
    const now = Date.now();

    if (member.name === ADMIN_MEMBER_NAME) {
      if (adminTapRef.current.count === 0 || now - adminTapRef.current.startTime > 5000) {
        adminTapRef.current.count = 1;
        adminTapRef.current.startTime = now;
      } else {
        adminTapRef.current.count += 1;
      }

      if (adminTapRef.current.timer) clearTimeout(adminTapRef.current.timer);
      adminTapRef.current.timer = setTimeout(() => {
        adminTapRef.current.count = 0;
      }, 5000);

      if (adminTapRef.current.count >= 10) {
        adminTapRef.current.count = 0;
        clearTimeout(adminTapRef.current.timer);
        setSelectedMember(null);
        setKeySenderMember(null);
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
      if (keySenderMember.id === member.id) {
        setKeySenderMember(null);
      } else {
        handleTransferKeyTo(member);
      }
      return;
    }

    if (selectedMember?.id === member.id) {
      setSelectedMember(null);
    } else {
      setSelectedMember(member);
      setKeySenderMember(null);
    }
  };

  const handleKeyBadgeClick = (member, e) => {
    e.stopPropagation();
    if ((member.keyCount || 0) <= 0) return;

    if (keySenderMember?.id === member.id) {
      setKeySenderMember(null);
    } else {
      setKeySenderMember(member);
      setSelectedMember(null);
    }
  };

  const handleCompleteSchedule = (scheduleId, title) => {
    const targetSchedule = schedules.find(s => s.id === scheduleId);
    if (!targetSchedule) return;

    const confirmMessage = targetSchedule.members.length > 0
      ? `[${title}] 스케줄을 완료 및 해제하시겠습니까?\n배치된 인원은 각자 소속 팀 대기열로 복귀합니다.`
      : `[${title}] 빈 스케줄을 삭제하시겠습니까?`;

    if (window.confirm(confirmMessage)) {
      const newPool = [...waitingPool, ...targetSchedule.members];
      const newSchedules = schedules.filter(s => s.id !== scheduleId);

      commitStateToFirebase(newPool, newSchedules, individualMembers, `[${title}] 스케줄 완료 및 해제`);
    }
  };

  const handleResetIndividual = () => {
    const visibleInd = topTeam === 'ALL'
      ? individualMembers
      : individualMembers.filter(m => m.team === topTeam);

    if (visibleInd.length === 0) return;

    const targetLabel = topTeam === 'ALL' ? '전체' : TEAM_NAMES[topTeam];
    if (window.confirm(`${targetLabel} 개별 이동 인원을 모두 대기열로 복귀시키겠습니까?`)) {
      const returningIds = new Set(visibleInd.map(m => m.id));
      const remainingInd = individualMembers.filter(m => !returningIds.has(m.id));
      const newPool = [...waitingPool, ...visibleInd];
      commitStateToFirebase(newPool, schedules, remainingInd, `${targetLabel} 개별 이동 인원 대기열 복귀`);
    }
  };

  const handleForceConfirm = (scheduleId, e) => {
    e.stopPropagation();
    const newSchedules = schedules.map(s =>
      s.id === scheduleId ? { ...s, hasBeenConfirmed: true } : s
    );
    const target = schedules.find(s => s.id === scheduleId);
    commitStateToFirebase(waitingPool, newSchedules, individualMembers, `[${target?.title}] 스케줄 강제 확정`);
  };

  const handleAddSchedule = (e) => {
    e.preventDefault();
    if (!newScheduleTitle.trim()) return;

    const scheduleTeam = topTeam === 'ALL' ? bottomTeam : topTeam;
    const isTeamM = scheduleTeam === 'M';

    const newSchedule = {
      id: `s_${Date.now()}`,
      title: newScheduleTitle,
      team: scheduleTeam,
      theme: isTeamM ? 'bg-green-50' : 'bg-indigo-50',
      tabTheme: isTeamM ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-800',
      hasBeenConfirmed: false,
      members: []
    };

    const newSchedules = [...schedules, newSchedule];
    commitStateToFirebase(waitingPool, newSchedules, individualMembers, `[${TEAM_NAMES[scheduleTeam]}] 새 스케줄 [${newScheduleTitle}] 생성`);

    setNewScheduleTitle('');
    setIsModalOpen(false);
  };

  const renderMemberChip = (member, contextTeam = null) => {
    const isSelected = selectedMember?.id === member.id;
    const isKeySender = keySenderMember?.id === member.id;
    const isKeyReceiverTarget = keySenderMember && !isKeySender && keySenderMember.team === member.team;
    const keys = Array.from({ length: member.keyCount || 0 });

    const showTeamBadge = topTeam === 'ALL' || (contextTeam && contextTeam !== member.team);

    let borderStyle = 'bg-white/90 border-white/50 text-slate-800 hover:bg-white';
    if (isSelected) {
      borderStyle = 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-300 scale-105 shadow-md';
    } else if (isKeySender) {
      borderStyle = 'bg-amber-500 text-white border-amber-400 ring-2 ring-amber-300 scale-105 shadow-md';
    } else if (isKeyReceiverTarget) {
      borderStyle = 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-300 animate-pulse';
    } else if (keySenderMember && keySenderMember.team !== member.team) {
      borderStyle = 'bg-white/50 border-white/30 text-slate-400 opacity-60';
    }

    return (
      <div
        key={member.id}
        onClick={(e) => handleMemberClick(member, e)}
        className={`flex items-center pl-2 pr-1.5 py-1 rounded-lg border shadow-sm cursor-pointer transition-all text-xs font-medium backdrop-blur-sm ${borderStyle}`}
      >
        {showTeamBadge && (
          <span className={`text-[9px] font-extrabold px-1 py-0.2 rounded mr-1 ${
            isSelected
              ? 'bg-white/20 text-white'
              : member.team === 'M'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-indigo-100 text-indigo-800'
          }`}>
            {TEAM_NAMES[member.team]}
          </span>
        )}
        <span className="py-0.5">{member.name}</span>

        <div className="flex gap-0.5 ml-1.5 items-center">
          {keys.map((_, idx) => (
            <span
              key={idx}
              onClick={(e) => handleKeyBadgeClick(member, e)}
              className={`px-1 py-0.5 rounded text-[10px] shadow-sm border transition-transform cursor-pointer ${
                isKeySender
                  ? 'bg-amber-600 text-white border-amber-400 scale-110'
                  : isSelected
                    ? 'bg-blue-500 text-white border-blue-400'
                    : 'bg-amber-100/90 text-amber-800 border-amber-300 hover:bg-amber-200'
              }`}
              title="키를 누르거나 더블클릭하면 같은 팀원에게 키 넘기기 모드가 켜집니다"
            >
              🔑
            </span>
          ))}
        </div>
      </div>
    );
  };

  const visibleIndividualMembers = topTeam === 'ALL'
    ? individualMembers
    : individualMembers.filter(m => m.team === topTeam);

  const visibleSchedules = topTeam === 'ALL'
    ? schedules
    : schedules.filter(s => (s.team || 'M') === topTeam);

  // 🔥 하단 대기 멤버 풀은 상단 토글과 무관하게 오직 하단 토글(bottomTeam)로만 필터링
  const visibleWaitingPool = waitingPool.filter(m => m.team === bottomTeam);

  const targetScheduleTeamForModal = topTeam === 'ALL' ? bottomTeam : topTeam;

  return (
    <div className="min-h-screen flex flex-col font-sans select-none relative overflow-x-hidden">

      <div className={`fixed inset-0 transition-colors duration-700 ease-in-out z-[-3] ${
        activeTab === 'Working Day' ? 'bg-slate-900' : 'bg-orange-50'
      }`} />

      <div className="fixed inset-0 flex justify-center z-[-2] pointer-events-none">
        <div
          className="w-full max-w-lg h-full bg-cover bg-center bg-no-repeat transition-all duration-700 ease-in-out opacity-[0.35]"
          style={{ backgroundImage: `url(${activeTab === 'Working Day' ? '/Working.png' : '/Weekend.png'})` }}
        />
      </div>

      <div className="fixed inset-0 flex justify-center z-[-1] pointer-events-none">
        <div className={`w-full max-w-lg h-full transition-colors duration-700 ease-in-out ${
          activeTab === 'Working Day' ? 'bg-slate-900/40' : 'bg-white/30'
        }`} />
      </div>

      {selectedMember && (
        <div className="fixed top-12 left-0 right-0 bg-blue-600/95 backdrop-blur-md text-white text-xs font-bold py-1.5 px-3 text-center z-30 shadow-md flex justify-center items-center gap-2 animate-bounce">
          <span>🎯 [{TEAM_NAMES[selectedMember.team]} {selectedMember.name}] 이동할 장소를 터치하세요!</span>
          <button
            onClick={setSelectedManagerAndReset}
            className="bg-blue-700 px-2 py-0.5 rounded text-[10px] hover:bg-blue-800"
          >
            취소
          </button>
        </div>
      )}

      {keySenderMember && (
        <div className="fixed top-12 left-0 right-0 bg-amber-500/95 backdrop-blur-md text-white text-xs font-bold py-1.5 px-3 text-center z-30 shadow-md flex justify-center items-center gap-2 animate-bounce">
          <span>🔑 [{keySenderMember.name}]의 키를 받을 [{TEAM_NAMES[keySenderMember.team]}] 멤버를 터치하세요!</span>
          <button
            onClick={setSelectedManagerAndReset}
            className="bg-amber-600 px-2 py-0.5 rounded text-[10px] hover:bg-amber-700"
          >
            취소
          </button>
        </div>
      )}

      {/* 상단 고정 헤더: 주중/주말 탭 */}
      <div className="w-full bg-white/40 backdrop-blur-lg shadow-sm sticky top-0 z-20 border-b border-white/30 transition-colors duration-500">
        <div className="flex h-11">
          <button
            onClick={() => setActiveTab('Working Day')}
            className={`w-1/2 flex items-center justify-center font-bold text-sm transition-all gap-1.5 ${
              activeTab === 'Working Day'
                ? 'bg-slate-900/80 text-white shadow-inner'
                : 'text-slate-700 hover:bg-white/40'
            }`}>
            🏢 Working Day
          </button>
          <button
            onClick={() => setActiveTab('Weekend')}
            className={`w-1/2 flex items-center justify-center font-bold text-sm transition-all gap-1.5 ${
              activeTab === 'Weekend'
                ? 'bg-orange-500/80 text-white shadow-inner'
                : 'text-slate-700 hover:bg-white/40'
            }`}>
            🌴 Weekend
          </button>
        </div>
      </div>

      <main className="flex-1 w-full max-w-lg mx-auto p-3 flex flex-col gap-4 mb-40 relative z-10">

        {/* 상단: 좌측 개별이동 박스 + 우측 버튼 2개 세로 묶음 */}
        <div className="flex justify-between items-stretch gap-2.5 mt-1">
          
          {/* 1. 좌측: 개별 이동 구역 (남은 가로폭 전체 차지) */}
          <div
            onClick={() => selectedMember && handleMoveMemberTo('individual')}
            className={`flex-1 min-w-0 bg-white/70 backdrop-blur-md rounded-xl p-2.5 shadow-sm border transition-all ${
              selectedMember ? 'border-blue-400 ring-2 ring-blue-300/50 cursor-pointer bg-blue-50/80' : 'border-white/50'
            }`}
          >
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider truncate">
                개별 이동 / 기타 구역 ({topTeam === 'ALL' ? '전체' : TEAM_NAMES[topTeam]})
              </span>
              {visibleIndividualMembers.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleResetIndividual(); }}
                  className="text-[10px] font-bold text-slate-600 bg-white/80 hover:bg-white px-1.5 py-0.5 rounded shadow-sm shrink-0"
                >
                  해제
                </button>
              )}
            </div>
            <div className="min-h-[2.5rem] rounded-lg border border-dashed border-slate-400/50 p-1.5 flex flex-wrap gap-1.5 items-center bg-white/30">
              {visibleIndividualMembers.length === 0 && (
                <span className="text-slate-600 text-[11px] m-auto font-medium">
                  {selectedMember ? '여기를 눌러서 이동' : '개별 이동 인원 없음'}
                </span>
              )}
              {visibleIndividualMembers.map(m => renderMemberChip(m, topTeam === 'ALL' ? null : topTeam))}
            </div>
          </div>

          {/* 2. 우측: 스케줄 등록 + 팀 전환 버튼 세로 배치 (고정 폭) */}
          <div className="flex flex-col gap-1.5 shrink-0 w-28">
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-white/80 backdrop-blur-md text-slate-800 px-2 py-2 rounded-xl font-bold text-xs shadow-sm border border-white/50 hover:bg-white active:scale-95 transition-all whitespace-nowrap"
            >
              <div className="flex items-center gap-1">
                <Plus size={14} />
                <span>스케줄 등록</span>
                <span className="text-[10px] font-semibold text-blue-600">
                {TEAM_NAMES[targetScheduleTeamForModal]}
              </span>
              </div>              
            </button>

            <button
              onClick={handleCycleTopTeam}
              className={`py-1.5 px-2 rounded-xl font-bold text-xs shadow-sm border backdrop-blur-md active:scale-95 transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                topTeam === 'ALL'
                  ? 'bg-slate-800/90 text-white border-slate-700'
                  : 'bg-indigo-600/90 text-white border-indigo-500'
              }`}
            >
              <span>{topTeam === 'ALL' ? '전체' : ` ${TEAM_NAMES[topTeam]} `}🔄</span>
            </button>
          </div>

        </div>

        <div className="flex flex-col gap-4">
          {visibleSchedules.map((schedule) => {
            const members = schedule.members || [];
            const keyCount = members.reduce((sum, m) => sum + (m.keyCount || 0), 0);
            const schedTeam = schedule.team || 'M';

            let status = '대기';
            if (schedule.hasBeenConfirmed || members.length >= 3) {
              status = keyCount === 0 ? 'SOS' : '확정';
            }

            let borderClass = 'border-white/50';
            let labelClass = 'bg-white/80 text-slate-700';
            if (status === '확정') {
              borderClass = 'border-blue-400/80 ring-2 ring-blue-300/50';
              labelClass = 'bg-blue-100 text-blue-700';
            } else if (status === 'SOS') {
              borderClass = 'border-red-400/80 ring-2 ring-red-300/50';
              labelClass = 'bg-red-100 text-red-700 animate-pulse';
            }

            const tabColorClass = schedTeam === 'M'
              ? 'bg-emerald-100 text-emerald-900'
              : 'bg-indigo-100 text-indigo-900';

            return (
              <div key={schedule.id} className="relative mt-2">
                <div className="flex justify-between items-end mb-0 z-[1] relative">
                  <button
                    onClick={() => handleCompleteSchedule(schedule.id, schedule.title)}
                    className={`px-3 py-1 rounded-t-lg font-bold text-xs shadow-sm flex items-center gap-1.5 ${tabColorClass} bg-opacity-95 backdrop-blur-sm`}
                  >
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/10 font-extrabold">
                      {TEAM_NAMES[schedTeam]}
                    </span>
                    <span>{schedule.title}</span>
                  </button>
                  <div className={`px-2 py-0.5 rounded-t-md text-[11px] font-bold ${labelClass} shadow-sm backdrop-blur-sm`}>
                    {status}
                  </div>
                </div>

                <div
                  onClick={() => selectedMember && handleMoveMemberTo('schedule', schedule.id)}
                  className={`bg-white/70 backdrop-blur-md rounded-b-xl rounded-tl-none rounded-tr-xl p-3 shadow-sm border ${borderClass} ${
                    selectedMember ? 'border-blue-400 ring-2 ring-blue-300/50 cursor-pointer bg-blue-50/80' : ''
                  } min-h-[5rem] flex flex-wrap gap-2 items-start transition-all relative`}
                >
                  {members.length === 0 && (
                    <span className="text-slate-600 text-xs font-medium m-auto drop-shadow-sm">
                      {selectedMember ? '여기를 눌러서 합류' : '대기 중인 인원이 없습니다'}
                    </span>
                  )}

                  {members.map(m => renderMemberChip(m, schedTeam))}

                  {status === '대기' && members.length > 0 && (
                    <button
                      onClick={(e) => handleForceConfirm(schedule.id, e)}
                      className="absolute bottom-2 right-2 p-1 bg-white/90 text-blue-600 rounded-md hover:bg-white border border-blue-200 shadow-sm"
                      title="강제 확정"
                    >
                      <Check size={14} strokeWidth={3} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* 하단 고정 바: 대기 멤버 풀 (오직 bottomTeam으로만 필터링) */}
      <div
        onClick={() => {
          if (selectedMember) {
            handleMoveMemberTo('pool');
            return;
          }

          setPoolTapCount(prev => {
            const nextCount = prev + 1;
            if (poolTapTimerRef.current) clearTimeout(poolTapTimerRef.current);
            poolTapTimerRef.current = setTimeout(() => {
              setPoolTapCount(0);
            }, 2000);

            if (nextCount >= 10) {
              setIsMyInfoModalOpen(true);
              return 0;
            }
            return nextCount;
          });
        }}
        className={`fixed bottom-0 left-0 right-0 bg-white/60 backdrop-blur-xl border-t border-white/40 p-3 shadow-lg z-10 transition-all cursor-pointer ${
          selectedMember ? 'border-blue-400 ring-4 ring-blue-300/50 bg-blue-50/80' : ''
        }`}
      >
        <div className="max-w-lg mx-auto flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider drop-shadow-sm">
                {selectedMember ? `👉 눌러서 [${TEAM_NAMES[selectedMember.team]}] 대기열로 복귀` : '대기 멤버 풀'}
              </span>
              <span className="text-[11px] font-bold text-slate-800 drop-shadow-sm">
                ({visibleWaitingPool.length}명)
              </span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setBottomTeam(prev => (prev === 'M' ? 'S' : 'M'));
              }}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold shadow-sm border backdrop-blur-md active:scale-95 transition-all flex items-center gap-1 ${
                bottomTeam === 'M'
                  ? 'bg-emerald-600/90 text-white border-emerald-500'
                  : 'bg-indigo-600/90 text-white border-indigo-500'
              }`}
            >
              <span>{TEAM_NAMES[bottomTeam]}🔄</span>
            </button>
          </div>

          <div className="min-h-[3.5rem] max-h-32 overflow-y-auto rounded-xl border border-dashed border-slate-500/40 p-2 flex flex-wrap gap-1.5 items-start bg-white/40">
            {visibleWaitingPool.length === 0 && (
              <span className="text-slate-600 text-[11px] m-auto font-medium">
                {TEAM_NAMES[bottomTeam]}에 대기 중인 인원이 없습니다.
              </span>
            )}
            {visibleWaitingPool.map(m => renderMemberChip(m, bottomTeam))}
          </div>
        </div>
      </div>

      {/* 새 스케줄 등록 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl w-full max-w-sm p-4 shadow-xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-bold text-slate-800">
                [{TEAM_NAMES[targetScheduleTeamForModal]}] 새 스케줄 생성
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-slate-800">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSchedule} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">이동 경로</label>
                <input
                  type="text"
                  value={newScheduleTitle}
                  onChange={(e) => setNewScheduleTitle(e.target.value)}
                  placeholder="예: 공장 > HEB 마트 > 숙소"
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={!newScheduleTitle.trim()}
                className="w-full bg-slate-800/90 backdrop-blur-sm text-white font-bold py-2 rounded-lg text-xs mt-1 disabled:bg-slate-400"
              >
                등록하기
              </button>
            </form>
          </div>
        </div>
      )}

      {/* [숨김 모달 1] 전체 최근 변경 이력 */}
      {isLogModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl w-full max-w-md p-4 shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-3 pb-2 border-b">
              <h2 className="text-sm font-bold text-slate-800">📋 전체 최근 변경 이력 (최대 100개)</h2>
              <button onClick={() => setIsLogModalOpen(false)} className="text-slate-500 hover:text-slate-800">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
              {systemLogs.length === 0 && (
                <span className="text-xs text-slate-400 text-center py-6">기록된 이력이 없습니다.</span>
              )}
              {systemLogs.map((log, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200/80 rounded-lg p-2 text-xs flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold">
                    <span>사용자 ID: #{log.userNo}</span>
                    <span>{log.time}</span>
                  </div>
                  <div className="text-slate-700 font-medium">{log.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* [숨김 모달 2] 내 시스템 사용자 번호 */}
      {isMyInfoModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl w-full max-w-xs p-5 shadow-xl flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xl mb-1 shadow-inner">
              🔑
            </div>
            <h2 className="text-base font-bold text-slate-800">내 시스템 사용자 번호</h2>
            <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 w-full">
              <span className="text-xl font-black text-blue-600 tracking-widest">#{myUserNo}</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              이 번호는 브라우저에 자동 저장되어 시스템 변경 이력에 기록됩니다.
            </p>
            <button
              onClick={() => setIsMyInfoModalOpen(false)}
              className="w-full bg-slate-800 text-white font-bold py-2 rounded-xl text-xs mt-2"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;