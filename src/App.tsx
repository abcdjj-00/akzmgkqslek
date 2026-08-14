import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Users,
  Calendar,
  Clock,
  KeyRound,
  Sparkles,
  CheckCircle2,
  Copy,
  ChevronRight,
  RefreshCw,
  LogOut,
  HelpCircle,
  Plus,
  Trash2,
  Edit2,
  Share2,
  Lock,
  ArrowRight,
  Smile,
  Zap,
  Info,
  CalendarDays,
  Gamepad2
} from 'lucide-react';
import { TimeRange, TimeSlot, RoomConfig } from './types';
import {
  createRoom,
  joinRoom,
  saveUserRangesInDb,
  getRoomResponses,
  findRoomsByUserInDb,
  subscribeToRoomUpdates,
  updateRoomDatesInDb,
  getRoomById
} from './utils/storage';

// 30분 단위 시간 슬롯 생성 (00:00 ~ 24:00)
const TIME_SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  const hStr = h.toString().padStart(2, '0');
  TIME_SLOTS.push(`${hStr}:00`);
  TIME_SLOTS.push(`${hStr}:30`);
}
TIME_SLOTS.push('24:00');

export function App() {
  // 모드 상태: 'HOME' | 'CREATE' | 'ROOM'
  const [viewMode, setViewMode] = useState<'HOME' | 'CREATE' | 'ROOM'>('HOME');

  // 방 입장 / 생성 입력값
  const [inputCode, setInputCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');

  // 새 방 생성 시 선택한 후보 날짜들
  const [candidateDates, setCandidateDates] = useState<string[]>(() => {
    const today = new Date().toISOString().split('T')[0];
    return [today];
  });
  const [newDateInput, setNewDateInput] = useState('');

  // 현재 활성 방 정보
  const [currentRoomCode, setCurrentRoomCode] = useState<string>('');
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // 내 가능 시간대: { "2025-05-15": [{ start: "14:00", end: "18:00" }] }
  const [myRanges, setMyRanges] = useState<Record<string, TimeRange[]>>({});

  // 전체 참여자 응답 데이터: { "닉네임": { "2025-05-15": [...] } }
  const [allResponses, setAllResponses] = useState<Record<string, Record<string, TimeRange[]>>>({});

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isAddingRange, setIsAddingRange] = useState(false);
  const [customStart, setCustomStart] = useState('19:00');
  const [customEnd, setCustomEnd] = useState('22:00');
  const [activeTab, setActiveTab] = useState<'MY_INPUT' | 'OVERVIEW' | 'BEST_TIME'>('OVERVIEW');

  // 내가 참여했던 방 목록
  const [myPastRooms, setMyPastRooms] = useState<Array<{ code: string; config: RoomConfig }>>([]);

  // 드래그 선택 관련 상태 (시간표 드래그)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<'ADD' | 'REMOVE'>('ADD');

  // 토스트 메시지 헬퍼
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 실시간 방 데이터 구독
  useEffect(() => {
    if (!currentRoomCode || viewMode !== 'ROOM') return;

    const unsubscribe = subscribeToRoomUpdates(currentRoomCode, (roomData) => {
      if (roomData) {
        setRoomConfig({
          dates: roomData.dates,
          createdBy: roomData.createdBy,
          createdAt: roomData.createdAt,
        });

        // 날짜 갱신 시 선택 날짜 보정
        if (roomData.dates.length > 0 && !roomData.dates.includes(selectedDate)) {
          setSelectedDate(roomData.dates[0]);
        }

        // 전체 응답 갱신
        const responses: Record<string, Record<string, TimeRange[]>> = {};
        if (roomData.users) {
          for (const [user, data] of Object.entries(roomData.users)) {
            responses[user] = data.ranges || {};
          }
        }
        setAllResponses(responses);

        // 내 응답도 실시간 반영
        if (nickname && roomData.users?.[nickname]) {
          setMyRanges(roomData.users[nickname].ranges || {});
        }
      }
    });

    return () => unsubscribe();
  }, [currentRoomCode, viewMode, nickname, selectedDate]);

  // 방 생성 처리
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      showToast('닉네임을 입력해 주세요.');
      return;
    }
    if (pin.length !== 4) {
      showToast('4자리 숫자 PIN을 입력해 주세요.');
      return;
    }
    if (candidateDates.length === 0) {
      showToast('조율할 날짜를 최소 1개 이상 추가해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await createRoom({
        nickname: nickname.trim(),
        pinHash: pin,
        dates: candidateDates,
      });

      setCurrentRoomCode(res.code);
      setRoomConfig(res.config);
      setSelectedDate(res.config.dates[0]);
      setMyRanges({});
      setViewMode('ROOM');
      setActiveTab('MY_INPUT');
      showToast(`방 [${res.code}]가 생성되었습니다!`);
    } catch (err: any) {
      showToast(err.message || '방 생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 방 입장 처리
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inputCode.trim().toUpperCase();
    if (!code) {
      showToast('방 코드를 입력해 주세요.');
      return;
    }
    if (!nickname.trim()) {
      showToast('닉네임을 입력해 주세요.');
      return;
    }
    if (pin.length !== 4) {
      showToast('4자리 숫자 PIN을 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await joinRoom(code, nickname.trim(), pin);
      setCurrentRoomCode(code);
      setRoomConfig(res.config);
      setSelectedDate(res.config.dates[0] || '');
      setMyRanges(res.myRanges || {});
      setViewMode('ROOM');
      showToast(`[${code}] 방에 입장했습니다.`);
    } catch (err: any) {
      showToast(err.message || '방 입장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 내 가능 시간 저장 (Firestore 동기화)
  const handleSaveMyRanges = async (updatedRanges: Record<string, TimeRange[]>) => {
    if (!currentRoomCode || !nickname || !pin) return;
    try {
      await saveUserRangesInDb(currentRoomCode, nickname, pin, updatedRanges);
    } catch (err: any) {
      showToast(err.message || '시간 저장에 실패했습니다.');
    }
  };

  // 날짜 추가 (방 생성 시)
  const handleAddCandidateDate = () => {
    if (!newDateInput) return;
    if (candidateDates.includes(newDateInput)) {
      showToast('이미 추가된 날짜입니다.');
      return;
    }
    setCandidateDates([...candidateDates, newDateInput].sort());
    setNewDateInput('');
  };

  // 날짜 제거 (방 생성 시)
  const handleRemoveCandidateDate = (dateStr: string) => {
    if (candidateDates.length <= 1) {
      showToast('최소 1개 이상의 날짜가 필요합니다.');
      return;
    }
    setCandidateDates(candidateDates.filter((d) => d !== dateStr));
  };

  // 방 코드 복사
  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedCode(true);
      showToast('초대 링크가 복사되었습니다!');
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  // 슬롯 인덱스(0 ~ 47)를 "HH:MM"으로 변환
  const slotIdxToTime = (idx: number) => TIME_SLOTS[idx];

  // 시간대 배열을 슬롯 인덱스 집합으로 변환
  const rangesToSlotSet = (ranges: TimeRange[] = []): Set<number> => {
    const set = new Set<number>();
    ranges.forEach((r) => {
      const sIdx = TIME_SLOTS.indexOf(r.start);
      const eIdx = TIME_SLOTS.indexOf(r.end);
      if (sIdx >= 0 && eIdx >= 0) {
        for (let i = sIdx; i < eIdx; i++) {
          set.add(i);
        }
      }
    });
    return set;
  };

  // 슬롯 집합을 최소 TimeRange[]로 압축 변환
  const slotSetToRanges = (slotSet: Set<number>): TimeRange[] => {
    const sorted = Array.from(slotSet).sort((a, b) => a - b);
    const ranges: TimeRange[] = [];
    if (sorted.length === 0) return ranges;

    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === prev + 1) {
        prev = sorted[i];
      } else {
        ranges.push({ start: slotIdxToTime(start), end: slotIdxToTime(prev + 1) });
        start = sorted[i];
        prev = sorted[i];
      }
    }
    ranges.push({ start: slotIdxToTime(start), end: slotIdxToTime(prev + 1) });
    return ranges;
  };

  // 드래그 시간 선택 이벤트 핸들러
  const handleSlotMouseDown = (slotIndex: number) => {
    if (slotIndex >= 48) return;
    const currentSlots = rangesToSlotSet(myRanges[selectedDate] || []);
    const mode = currentSlots.has(slotIndex) ? 'REMOVE' : 'ADD';
    setDragMode(mode);
    setIsDragging(true);
    setDragStartIndex(slotIndex);
    setDragCurrentIndex(slotIndex);
  };

  const handleSlotMouseEnter = (slotIndex: number) => {
    if (isDragging && slotIndex < 48) {
      setDragCurrentIndex(slotIndex);
    }
  };

  const handleSlotMouseUp = () => {
    if (!isDragging || dragStartIndex === null || dragCurrentIndex === null) {
      setIsDragging(false);
      return;
    }

    const minIdx = Math.min(dragStartIndex, dragCurrentIndex);
    const maxIdx = Math.max(dragStartIndex, dragCurrentIndex);
    const currentSlots = rangesToSlotSet(myRanges[selectedDate] || []);

    for (let i = minIdx; i <= maxIdx; i++) {
      if (dragMode === 'ADD') {
        currentSlots.add(i);
      } else {
        currentSlots.delete(i);
      }
    }

    const newRanges = slotSetToRanges(currentSlots);
    const updated = { ...myRanges, [selectedDate]: newRanges };
    setMyRanges(updated);
    handleSaveMyRanges(updated);

    setIsDragging(false);
    setDragStartIndex(null);
    setDragCurrentIndex(null);
  };

  // 커스텀 시간 범위 추가
  const handleAddCustomRange = () => {
    const sIdx = TIME_SLOTS.indexOf(customStart);
    const eIdx = TIME_SLOTS.indexOf(customEnd);
    if (sIdx < 0 || eIdx < 0 || sIdx >= eIdx) {
      showToast('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }
    const currentSlots = rangesToSlotSet(myRanges[selectedDate] || []);
    for (let i = sIdx; i < eIdx; i++) {
      currentSlots.add(i);
    }
    const updated = { ...myRanges, [selectedDate]: slotSetToRanges(currentSlots) };
    setMyRanges(updated);
    handleSaveMyRanges(updated);
    setIsAddingRange(false);
    showToast(`${customStart} ~ ${customEnd} 시간이 추가되었습니다.`);
  };

  // 특정 날짜의 내 시간 전체 지우기
  const handleClearDay = () => {
    const updated = { ...myRanges, [selectedDate]: [] };
    setMyRanges(updated);
    handleSaveMyRanges(updated);
    showToast(`${selectedDate} 일정이 초기화되었습니다.`);
  };

  // 하루 종일 가능 (00:00 ~ 24:00) 설정
  const handleSetAllDay = () => {
    const updated = {
      ...myRanges,
      [selectedDate]: [{ start: '00:00', end: '24:00' }],
    };
    setMyRanges(updated);
    handleSaveMyRanges(updated);
    showToast(`${selectedDate} 종일 가능으로 설정되었습니다.`);
  };

  // 종합 통계 계산 (각 시간 슬롯별 참여 가능자 목록)
  const slotStats = useMemo(() => {
    if (!selectedDate) return [];
    const stats = [];
    const totalParticipants = Object.keys(allResponses).length;

    for (let i = 0; i < 48; i++) {
      const availableUsers: string[] = [];
      for (const [user, userDates] of Object.entries(allResponses)) {
        const ranges = userDates[selectedDate] || [];
        const slots = rangesToSlotSet(ranges);
        if (slots.has(i)) {
          availableUsers.push(user);
        }
      }
      stats.push({
        slotIndex: i,
        time: TIME_SLOTS[i],
        nextTime: TIME_SLOTS[i + 1],
        count: availableUsers.length,
        total: totalParticipants,
        ratio: totalParticipants > 0 ? availableUsers.length / totalParticipants : 0,
        users: availableUsers,
      });
    }
    return stats;
  }, [allResponses, selectedDate]);

  // 가장 많은 인원이 모일 수 있는 최적 시간대 계산
  const bestTimeSlots = useMemo(() => {
    if (slotStats.length === 0) return [];
    const maxCount = Math.max(...slotStats.map((s) => s.count), 0);
    if (maxCount === 0) return [];

    // 연속된 최대 인원 구간 묶기
    const matchingSlots = slotStats.filter((s) => s.count === maxCount);
    const contiguousBlocks: Array<{
      start: string;
      end: string;
      count: number;
      users: string[];
    }> = [];

    let currentBlock: { start: string; end: string; count: number; users: string[] } | null = null;

    for (let i = 0; i < slotStats.length; i++) {
      const stat = slotStats[i];
      if (stat.count === maxCount && maxCount > 0) {
        if (!currentBlock) {
          currentBlock = {
            start: stat.time,
            end: stat.nextTime,
            count: maxCount,
            users: stat.users,
          };
        } else {
          currentBlock.end = stat.nextTime;
        }
      } else {
        if (currentBlock) {
          contiguousBlocks.push(currentBlock);
          currentBlock = null;
        }
      }
    }
    if (currentBlock) {
      contiguousBlocks.push(currentBlock);
    }

    return contiguousBlocks;
  }, [slotStats]);

  // URL 파라미터에서 방 코드 확인
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInputCode(roomParam.toUpperCase());
    }
  }, []);

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none"
      onMouseUp={handleSlotMouseUp}
    >
      {/* 상단 네비게이션 */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setViewMode('HOME')}
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Gamepad2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                언제겜하냐
              </h1>
              <p className="text-[11px] text-slate-400">게임 약속 시간 조율 플랫폼</p>
            </div>
          </div>

          {viewMode === 'ROOM' && (
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 flex items-center gap-2 text-xs">
                <span className="text-slate-400">방 코드:</span>
                <span className="font-mono font-bold text-indigo-400">{currentRoomCode}</span>
                <button
                  onClick={handleCopyLink}
                  className="hover:text-white transition-colors"
                  title="초대 링크 복사"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => setViewMode('HOME')}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="나가기"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-center">
        {/* 토스트 알림 */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 text-white px-4 py-2.5 rounded-xl shadow-2xl text-sm font-medium animate-bounce flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            {toastMessage}
          </div>
        )}

        {/* 1. 홈 화면 (입장 / 생성 선택) */}
        {viewMode === 'HOME' && (
          <div className="max-w-md w-full mx-auto space-y-6 py-8">
            <div className="text-center space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Zap className="w-3 h-3" /> 로그인 없는 간편 스케줄러
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                친구들과 게임할 <br />
                <span className="text-indigo-400">딱 맞는 시간</span>을 찾아보세요
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                복잡한 회원가입 없이 닉네임과 4자리 비밀번호만으로 간편하게 약속을 잡으세요.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    방 코드 (6자리)
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="예: 7KA2B9"
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono tracking-wider uppercase focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      내 닉네임
                    </label>
                    <input
                      type="text"
                      placeholder="예: 페이커"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                      <span>4자리 PIN</span>
                      <span className="text-[10px] text-slate-500">수정용 비번</span>
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      placeholder="숫자 4자리"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleJoinRoom}
                  disabled={isLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                >
                  {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  기존 방 참여하기
                </button>
              </div>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-800 w-full" />
                <span className="bg-slate-900 px-3 text-xs text-slate-500 uppercase">또는</span>
                <div className="border-t border-slate-800 w-full" />
              </div>

              <button
                onClick={() => setViewMode('CREATE')}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                새 약속 방 만들기
              </button>
            </div>
          </div>
        )}

        {/* 2. 새 방 만들기 화면 */}
        {viewMode === 'CREATE' && (
          <div className="max-w-md w-full mx-auto space-y-6 py-6">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setViewMode('HOME')}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                ← 뒤로가기
              </button>
              <h2 className="text-lg font-bold text-white">새 약속 방 만들기</h2>
              <div className="w-12" />
            </div>

            <form onSubmit={handleCreateRoom} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      방장 닉네임
                    </label>
                    <input
                      type="text"
                      placeholder="내 닉네임"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      수정용 PIN (4자리)
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      placeholder="숫자 4자리"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    조율할 날짜 목록
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="date"
                      value={newDateInput}
                      onChange={(e) => setNewDateInput(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleAddCandidateDate}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> 추가
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-slate-950 border border-slate-800 rounded-xl">
                    {candidateDates.map((date) => (
                      <span
                        key={date}
                        className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg"
                      >
                        <Calendar className="w-3 h-3 text-indigo-400" />
                        {date}
                        <button
                          type="button"
                          onClick={() => handleRemoveCandidateDate(date)}
                          className="hover:text-red-400 ml-1"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                방 생성하고 시간 입력하기
              </button>
            </form>
          </div>
        )}

        {/* 3. 메인 조율 룸 화면 */}
        {viewMode === 'ROOM' && (
          <div className="space-y-6">
            {/* 상단 탭 및 날짜 선택 바 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                {roomConfig?.dates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDate(d)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      selectedDate === d
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                    }`}
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    {d}
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 w-full sm:w-auto justify-center">
                <button
                  onClick={() => setActiveTab('OVERVIEW')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'OVERVIEW'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  전체 현황 ({Object.keys(allResponses).length}명)
                </button>
                <button
                  onClick={() => setActiveTab('MY_INPUT')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'MY_INPUT'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  내 시간 입력
                </button>
                <button
                  onClick={() => setActiveTab('BEST_TIME')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'BEST_TIME'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  추천 시간대 ✨
                </button>
              </div>
            </div>

            {/* 탭 1: 전체 참여자 종합 현황 */}
            {activeTab === 'OVERVIEW' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      {selectedDate} 전체 참여 현황
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      색상이 진할수록 더 많은 친구들이 가능한 황금 시간대입니다.
                    </p>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-800 border border-slate-700" /> 0명
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/40" />
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> 전원
                  </div>
                </div>

                {/* 타임테이블 그리드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                  {slotStats.map((stat) => {
                    const isAll = stat.count === stat.total && stat.total > 0;
                    return (
                      <div
                        key={stat.slotIndex}
                        className={`p-2.5 rounded-xl border transition-all ${
                          stat.count > 0
                            ? isAll
                              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-md'
                              : 'bg-indigo-950/40 border-indigo-800/50 text-indigo-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span>
                            {stat.time} - {stat.nextTime}
                          </span>
                          <span className="font-bold text-white">
                            {stat.count} / {stat.total}명
                          </span>
                        </div>
                        {stat.users.length > 0 && (
                          <div className="mt-1 text-[10px] text-slate-400 truncate">
                            {stat.users.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 탭 2: 내 시간 드래그 입력 */}
            {activeTab === 'MY_INPUT' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      {nickname} 님의 {selectedDate} 가능 시간
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      원하는 시간 칸을 마우스로 드래그하거나 클릭하여 켜고 끌 수 있습니다.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSetAllDay}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700"
                    >
                      하루 종일 가능
                    </button>
                    <button
                      onClick={handleClearDay}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs border border-slate-700"
                    >
                      전체 취소
                    </button>
                  </div>
                </div>

                {/* 드래그 슬롯 매트릭스 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 select-none">
                  {Array.from({ length: 48 }).map((_, idx) => {
                    const mySlots = rangesToSlotSet(myRanges[selectedDate] || []);
                    const isSelected = mySlots.has(idx);
                    return (
                      <div
                        key={idx}
                        onMouseDown={() => handleSlotMouseDown(idx)}
                        onMouseEnter={() => handleSlotMouseEnter(idx)}
                        className={`p-2.5 rounded-xl border text-xs font-mono cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>
                            {TIME_SLOTS[idx]} ~ {TIME_SLOTS[idx + 1]}
                          </span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 탭 3: 최적 추천 시간대 */}
            {activeTab === 'BEST_TIME' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    {selectedDate} 가장 많이 모일 수 있는 골든 타임
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    모든 친구들의 일정을 계산하여 가장 참여율이 높은 시간대를 추천합니다.
                  </p>
                </div>

                {bestTimeSlots.length > 0 ? (
                  <div className="space-y-3 pt-2">
                    {bestTimeSlots.map((block, i) => (
                      <div
                        key={i}
                        className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-4 flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-bold text-indigo-300 font-mono flex items-center gap-2">
                            <Clock className="w-4 h-4 text-indigo-400" />
                            {block.start} ~ {block.end}
                          </div>
                          <p className="text-xs text-slate-400">
                            가능 인원: <span className="text-white font-bold">{block.users.join(', ')}</span>
                          </p>
                        </div>
                        <div className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-md">
                          {block.count}명 일치
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    아직 참여자들이 시간을 입력하지 않았습니다.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
export default App;
