import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar,
  Users,
  Clock,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  LogOut,
  RefreshCw,
  Search,
  Lock,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Gamepad2,
  Info,
  CalendarDays,
  UserCheck
} from "lucide-react";
import {
  TimeRange,
  RoomConfig,
  ScreenType,
  ModeType,
  RoomHistoryItem,
  OverlapSegment,
  DayOverlapData
} from "./types";
import {
  createRoom,
  joinRoom,
  saveUserRangesInDb,
  updateRoomDatesInDb,
  getRoomResponses,
  findRoomsByUserInDb,
  getRoomById
} from "./utils/storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

// Helper time functions
function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeToMin(t: string): number {
  const parts = t.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function minToTime(m: number): string {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function formatAMPM(t: string): string {
  if (!t) return "";
  const parts = t.split(":");
  if (parts.length < 2) return t;
  const hour24 = Number(parts[0]);
  const min = Number(parts[1]);
  if (isNaN(hour24) || isNaN(min)) return t;

  const isPM = hour24 >= 12;
  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = isPM ? "pm" : "am";
  return `${displayHour}:${pad2(min)} ${period}`;
}

function minToTimeAMPM(m: number): string {
  const hour24 = Math.floor(m / 60);
  const min = m % 60;
  const isPM = hour24 >= 12;
  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = isPM ? "pm" : "am";
  return `${displayHour}:${pad2(min)} ${period}`;
}

function dateLabel(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`;
}

function getDaysInMonth(year: number, month: number): (Date | null)[] {
  // Use local time zone to avoid shifting
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  const days: (Date | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    days.push(null);
  }
  for (let i = 1; i <= totalDays; i++) {
    days.push(new Date(year, month, i));
  }
  return days;
}

// Generate secure salt hash for PIN in front-end
async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode("gtf-salt-" + pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function App() {
  // Navigation & Core States
  const [screen, setScreen] = useState<ScreenType>("home");
  const [roomCode, setRoomCode] = useState<string>("");
  const [nickname, setNickname] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [myRanges, setMyRanges] = useState<Record<string, TimeRange[]>>({});
  const [responses, setResponses] = useState<Record<string, Record<string, TimeRange[]>>>({});
  
  // Date Editing States in Grid Screen
  const [isEditingDates, setIsEditingDates] = useState<boolean>(false);
  const [editingDatesSet, setEditingDatesSet] = useState<Set<string>>(new Set());
  const [editExtraDate, setEditExtraDate] = useState<string>("");
  const [editCalendarYear, setEditCalendarYear] = useState<number>(new Date().getFullYear());
  const [editCalendarMonth, setEditCalendarMonth] = useState<number>(new Date().getMonth());
  const [myActiveDates, setMyActiveDates] = useState<Set<string>>(new Set());

  // Heatmap View Selection States
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState<string | null>(null);
  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth()); // 0-indexed

  // UI Flow States
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [mode, setMode] = useState<ModeType>("edit");
  const [localHistory, setLocalHistory] = useState<RoomHistoryItem[]>([]);

  // Inputs
  const [createNickInput, setCreateNickInput] = useState<string>("");
  const [createPinInput, setCreatePinInput] = useState<string>("");
  const [joinCodeInput, setJoinCodeInput] = useState<string>("");
  const [joinNickInput, setJoinNickInput] = useState<string>("");
  const [joinPinInput, setJoinPinInput] = useState<string>("");
  
  const [findNickInput, setFindNickInput] = useState<string>("");
  const [findPinInput, setFindPinInput] = useState<string>("");
  const [foundRooms, setFoundRooms] = useState<RoomHistoryItem[] | null>(null);
  const [findLoading, setFindLoading] = useState<boolean>(false);

  const [setupSelectedDates, setSetupSelectedDates] = useState<Set<string>>(new Set());
  const [setupExtraDate, setSetupExtraDate] = useState<string>("");

  // Hover status for overlap segments
  const [activeTooltip, setActiveTooltip] = useState<{
    date: string;
    segment: OverlapSegment;
    total: number;
  } | null>(null);

  // Range Editor State
  const [rangeEditor, setRangeEditor] = useState<{
    date: string;
    index: number | null;
    start: string;
    end: string;
  } | null>(null);

  // Flash Toast Message
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((prev) => prev - 1);
    } else {
      setCalendarMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((prev) => prev + 1);
    } else {
      setCalendarMonth((prev) => prev + 1);
    }
  };

  const handlePrevEditMonth = () => {
    if (editCalendarMonth === 0) {
      setEditCalendarMonth(11);
      setEditCalendarYear((prev) => prev - 1);
    } else {
      setEditCalendarMonth((prev) => prev - 1);
    }
  };

  const handleNextEditMonth = () => {
    if (editCalendarMonth === 11) {
      setEditCalendarMonth(0);
      setEditCalendarYear((prev) => prev + 1);
    } else {
      setEditCalendarMonth((prev) => prev + 1);
    }
  };

  // Load local room history on mount
  useEffect(() => {
    const raw = localStorage.getItem("gtf_room_history");
    if (raw) {
      try {
        setLocalHistory(JSON.parse(raw));
      } catch (e) {
        setLocalHistory([]);
      }
    }

    // Check url hash for invite code
    const hash = window.location.hash.replace("#", "").trim().toUpperCase();
    if (hash && hash.length === 6) {
      setJoinCodeInput(hash);
      showToast(`방 코드 ${hash}가 감지되어 입력란에 채웠어요!`);
    }
  }, []);

  // Synchronize selectedHeatmapDate and calendar selection based on room dates config
  useEffect(() => {
    if (config?.dates && config.dates.length > 0) {
      if (!selectedHeatmapDate || !config.dates.includes(selectedHeatmapDate)) {
        setSelectedHeatmapDate(config.dates[0]);
      }
      const d = new Date(config.dates[0] + "T00:00:00");
      if (!isNaN(d.getTime())) {
        setCalendarYear(d.getFullYear());
        setCalendarMonth(d.getMonth());
      }
    }
  }, [config?.dates]);

  // Sync to local history
  const addRoomToLocalHistory = (code: string, cfg: RoomConfig) => {
    const updated = [...localHistory.filter((item) => item.code !== code)];
    updated.unshift({ code, config: cfg });
    const limited = updated.slice(0, 10); // Keep last 10
    setLocalHistory(limited);
    localStorage.setItem("gtf_room_history", JSON.stringify(limited));
  };

  // Pre-fill setup dates with upcoming 3 days
  const initializeSetupDates = () => {
    const today = new Date();
    const datesSet = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getTime() + i * DAY_MS);
      datesSet.add(dateStr(d));
    }
    setSetupSelectedDates(datesSet);
  };

  const handleGoSetup = () => {
    if (!createNickInput.trim()) {
      showToast("닉네임을 먼저 입력해 주세요!");
      return;
    }
    if (!/^\d{4}$/.test(createPinInput.trim())) {
      showToast("PIN 번호는 숫자 4자리로 입력해 주세요!");
      return;
    }
    initializeSetupDates();
    setScreen("setup");
  };

  const toggleSetupDate = (ds: string) => {
    const next = new Set(setupSelectedDates);
    if (next.has(ds)) {
      next.delete(ds);
    } else {
      next.add(ds);
    }
    setSetupSelectedDates(next);
  };

  const handleAddExtraDate = () => {
    if (!setupExtraDate) return;
    const next = new Set(setupSelectedDates);
    next.add(setupExtraDate);
    setSetupSelectedDates(next);
    setSetupExtraDate("");
    showToast(`${dateLabel(setupExtraDate)}가 일정 목록에 추가되었습니다.`);
  };

  const handleCreateRoom = async () => {
    const nick = createNickInput.trim();
    const rawPin = createPinInput.trim();
    if (!nick || !/^\d{4}$/.test(rawPin)) {
      showToast("닉네임과 PIN 4자리를 확인해 주세요.");
      return;
    }
    if (setupSelectedDates.size === 0) {
      showToast("최소 하루 이상의 날짜를 선택해 주세요!");
      return;
    }

    setLoading(true);
    try {
      const pinHash = await hashPin(rawPin);
      const dates = Array.from<string>(setupSelectedDates).sort();

      const created = await createRoom({
        nickname: nick,
        pinHash,
        dates,
      });

      setRoomCode(created.code);
      setNickname(nick);
      setPin(rawPin);
      setConfig(created.config);
      setMyRanges({});
      setMyActiveDates(new Set());
      addRoomToLocalHistory(created.code, created.config);
      window.location.hash = created.code;
      setScreen("grid");
      setMode("edit");
      showToast("🎮 조율용 방이 완성되었습니다! 친구들에게 코드를 전송하세요.");
    } catch (err: any) {
      showToast(err?.message || "방 생성 도중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (overrideCode?: string) => {
    const code = (overrideCode || joinCodeInput).trim().toUpperCase();
    const nick = joinNickInput.trim();
    const rawPin = joinPinInput.trim();

    if (!code || code.length !== 6) {
      showToast("6자리 방 코드를 올바르게 입력해 주세요.");
      return;
    }
    if (!nick) {
      showToast("참여할 닉네임을 입력해 주세요.");
      return;
    }
    if (!/^\d{4}$/.test(rawPin)) {
      showToast("비밀번호 분실 방지용 PIN 4자리를 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const pinHash = await hashPin(rawPin);
      const result = await joinRoom(code, nick, pinHash);

      setRoomCode(code);
      setNickname(nick);
      setPin(rawPin);
      setConfig(result.config);
      const fetchedRanges = result.myRanges || {};
      setMyRanges(fetchedRanges);
      const activeDates = new Set<string>(
        Object.keys(fetchedRanges).filter((d) => (fetchedRanges[d] || []).length > 0)
      );
      setMyActiveDates(activeDates);
      addRoomToLocalHistory(code, result.config);
      window.location.hash = code;
      setScreen("grid");
      setMode("edit");
      showToast(`${nick}님, 방에 입장하셨습니다!`);
    } catch (err: any) {
      showToast(err?.message || "PIN이 일치하지 않거나 참여할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleFindRooms = async () => {
    const nick = findNickInput.trim();
    const rawPin = findPinInput.trim();

    if (!nick) {
      showToast("조회할 닉네임을 입력해 주세요.");
      return;
    }
    if (!/^\d{4}$/.test(rawPin)) {
      showToast("등록된 PIN 4자리를 입력해 주세요.");
      return;
    }

    setFindLoading(true);
    try {
      const pinHash = await hashPin(rawPin);
      const rooms = await findRoomsByUserInDb(nick, pinHash);

      setFoundRooms(rooms);
      if (rooms.length === 0) {
        showToast("입력한 계정 정보로 조회된 모임이 없습니다.");
      } else {
        showToast(`총 ${rooms.length}개의 참여 모임을 찾았습니다!`);
      }
    } catch (err: any) {
      showToast(err?.message || "모임을 찾는 중 오류가 생겼습니다.");
    } finally {
      setFindLoading(false);
    }
  };

  // Direct Enter from History List
  const handleEnterFromHistory = async (item: RoomHistoryItem) => {
    // We attempt to find the PIN from matching input, or ask the user
    const nick = prompt("입장할 때 사용한 닉네임을 입력해 주세요:", nickname || "");
    if (!nick) return;
    const rawPin = prompt("PIN 번호 4자리를 입력해 주세요:");
    if (!rawPin || !/^\d{4}$/.test(rawPin)) {
      showToast("올바른 PIN이 아닙니다.");
      return;
    }

    setLoading(true);
    try {
      const pinHash = await hashPin(rawPin);
      const result = await joinRoom(item.code, nick, pinHash);

      setRoomCode(item.code);
      setNickname(nick);
      setPin(rawPin);
      setConfig(result.config);
      const fetchedRanges = result.myRanges || {};
      setMyRanges(fetchedRanges);
      const activeDates = new Set<string>(
        Object.keys(fetchedRanges).filter((d) => (fetchedRanges[d] || []).length > 0)
      );
      setMyActiveDates(activeDates);
      addRoomToLocalHistory(item.code, result.config);
      window.location.hash = item.code;
      setScreen("grid");
      setMode("edit");
      showToast("저장된 일정을 성공적으로 연동했습니다.");
    } catch (err: any) {
      showToast(err?.message || "계정 정보가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  // Update backend with user ranges
  const saveUserRanges = async (updatedRanges: Record<string, TimeRange[]>) => {
    setSaving(true);
    try {
      const pinHash = await hashPin(pin);
      await saveUserRangesInDb(roomCode, nickname, pinHash, updatedRanges);
    } catch (e: any) {
      showToast(e?.message || "일정 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // Edit room dates helpers
  const toggleEditRoomDate = (ds: string) => {
    const next = new Set(editingDatesSet);
    if (next.has(ds)) {
      next.delete(ds);
    } else {
      next.add(ds);
    }
    setEditingDatesSet(next);
  };

  const handleAddEditRoomExtraDate = () => {
    if (!editExtraDate) return;
    const next = new Set(editingDatesSet);
    next.add(editExtraDate);
    setEditingDatesSet(next);
    setEditExtraDate("");
    showToast(`${dateLabel(editExtraDate)}가 수정할 일정 목록에 추가되었습니다.`);
  };

  const handleSaveRoomDates = async () => {
    if (editingDatesSet.size === 0) {
      showToast("최소 하루 이상의 날짜를 선택해 주세요!");
      return;
    }

    setSaving(true);
    try {
      const pinHash = await hashPin(pin);
      const newConfig = await updateRoomDatesInDb(
        roomCode,
        nickname,
        pinHash,
        Array.from(editingDatesSet)
      );

      setConfig(newConfig);
      setIsEditingDates(false);
      showToast("모임의 조율 날짜가 변경되었습니다!");
      if (roomCode && newConfig) {
        addRoomToLocalHistory(roomCode, newConfig);
      }
      // Refresh responses
      fetchHeatmapData();
    } catch (e: any) {
      showToast(e?.message || "날짜 변경에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEditDates = () => {
    if (config?.dates) {
      setEditingDatesSet(new Set(config.dates));
    }
    setIsEditingDates(true);
  };

  const toggleMyActiveDate = async (ds: string) => {
    const next = new Set<string>(myActiveDates);
    if (next.has(ds)) {
      next.delete(ds);
      setMyActiveDates(next);
      const updated = { ...myRanges };
      delete updated[ds];
      setMyRanges(updated);
      await saveUserRanges(updated);
      showToast(`${dateLabel(ds)} 일정을 내 목록에서 해제했습니다.`);
    } else {
      next.add(ds);
      setMyActiveDates(next);
      showToast(`${dateLabel(ds)} 일정이 추가되었습니다. 아래에서 가능한 시간을 선택해 주세요.`);
    }
  };

  const addPresetToMyActive = (datesToAdd: string[]) => {
    const next = new Set<string>(myActiveDates);
    datesToAdd.forEach((d) => next.add(d));
    setMyActiveDates(next);
    showToast(`${datesToAdd.length}개의 날짜가 내 일정 목록에 추가되었습니다.`);
  };

  const handleAddDirectActiveDate = () => {
    if (!editExtraDate) return;
    const next = new Set<string>(myActiveDates);
    next.add(editExtraDate);
    setMyActiveDates(next);
    showToast(`${dateLabel(editExtraDate)} 일정이 추가되었습니다.`);
    setEditExtraDate("");
  };

  const handleClearDayRanges = async (date: string) => {
    const updated = { ...myRanges };
    delete updated[date];
    setMyRanges(updated);
    const next = new Set<string>(myActiveDates);
    next.delete(date);
    setMyActiveDates(next);
    await saveUserRanges(updated);
    showToast(`${dateLabel(date)} 일정을 목록에서 삭제했습니다.`);
  };

  // Range editor helpers
  const handleOpenAddRange = (date: string) => {
    const next = new Set<string>(myActiveDates);
    next.add(date);
    setMyActiveDates(next);
    setRangeEditor({ date, index: null, start: "19:00", end: "22:00" });
  };

  const handleOpenEditRange = (date: string, idx: number) => {
    const current = myRanges[date]?.[idx];
    if (current) {
      setRangeEditor({ date, index: idx, start: current.start, end: current.end });
    }
  };

  const handleSaveRange = async () => {
    if (!rangeEditor) return;
    const { date, index, start, end } = rangeEditor;

    if (!start || !end) {
      showToast("시작 및 종료 시간대를 올바르게 지정해 주세요.");
      return;
    }

    if (timeToMin(end) <= timeToMin(start)) {
      showToast("종료 시간은 반드시 시작 시간보다 나중이어야 합니다!");
      return;
    }

    const currentDayRanges = [...(myRanges[date] || [])];
    const newEntry = { start, end };

    if (index === null) {
      currentDayRanges.push(newEntry);
    } else {
      currentDayRanges[index] = newEntry;
    }

    // Sort ranges ascending by start time
    currentDayRanges.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));

    const updated = { ...myRanges, [date]: currentDayRanges };
    setMyRanges(updated);
    const next = new Set<string>(myActiveDates);
    next.add(date);
    setMyActiveDates(next);
    setRangeEditor(null);
    await saveUserRanges(updated);
    showToast("시간대가 업데이트되었습니다.");
  };

  const handleDirectQuickAddRange = async (date: string, start: string, end: string) => {
    if (timeToMin(end) <= timeToMin(start)) {
      showToast("종료 시간은 시작 시간보다 나중이어야 합니다!");
      return;
    }
    const currentDayRanges = [...(myRanges[date] || [])];
    const exists = currentDayRanges.some((r) => r.start === start && r.end === end);
    if (exists) {
      showToast("이미 추가되어 있는 시간대입니다.");
      return;
    }
    currentDayRanges.push({ start, end });
    currentDayRanges.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));

    const updated = { ...myRanges, [date]: currentDayRanges };
    setMyRanges(updated);
    const next = new Set<string>(myActiveDates);
    next.add(date);
    setMyActiveDates(next);
    await saveUserRanges(updated);
    fetchHeatmapData();
    showToast(`${dateLabel(date)}에 ${formatAMPM(start)} ~ ${formatAMPM(end)} 시간이 등록되었습니다!`);
  };

  const handleDeleteRange = async (date: string, idx: number) => {
    const currentDayRanges = [...(myRanges[date] || [])];
    currentDayRanges.splice(idx, 1);

    const updated = { ...myRanges, [date]: currentDayRanges };
    setMyRanges(updated);
    await saveUserRanges(updated);
    showToast("시간대를 삭제했습니다.");
  };

  // Refresh heatmap/responses
  const fetchHeatmapData = async () => {
    if (!roomCode) return;
    setLoading(true);
    try {
      const data = await getRoomResponses(roomCode);
      setResponses(data.responses || {});
      setConfig(data.config);
      setLastRefresh(new Date());
    } catch (e: any) {
      showToast(e?.message || "데이터 갱신에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchMode = (target: ModeType) => {
    setMode(target);
    if (target === "heatmap") {
      fetchHeatmapData();
    }
  };

  const handleCopyCode = () => {
    try {
      navigator.clipboard.writeText(roomCode);
      showToast(`방 코드를 클립보드에 복사했어요! (${roomCode})`);
    } catch (e) {
      showToast(`복사에 실패했습니다. 코드: ${roomCode}`);
    }
  };

  const handleLeaveRoom = () => {
    setScreen("home");
    setRoomCode("");
    setConfig(null);
    setMyRanges({});
    setResponses({});
    setRangeEditor(null);
    window.location.hash = "";
  };

  // Math/overlap computer
  const computeDayOverlap = (date: string): DayOverlapData => {
    const nicks = Object.keys(responses);
    const total = nicks.length;
    
    // Flatten all ranges for this day
    const allRanges: { nick: string; start: number; end: number }[] = [];
    nicks.forEach((n) => {
      const ranges = responses[n]?.[date] || [];
      ranges.forEach((r) => {
        allRanges.push({
          nick: n,
          start: timeToMin(r.start),
          end: timeToMin(r.end),
        });
      });
    });

    if (allRanges.length === 0) {
      return { segments: [], total, min: 0, max: 0 };
    }

    // Collect all unique time boundary points
    const pointsSet = new Set<number>();
    allRanges.forEach((r) => {
      pointsSet.add(r.start);
      pointsSet.add(r.end);
    });

    const sortedPoints = Array.from(pointsSet).sort((a, b) => a - b);
    const segments: OverlapSegment[] = [];

    // Form discrete segments and count overlapping users
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const t0 = sortedPoints[i];
      const t1 = sortedPoints[i + 1];
      if (t1 <= t0) continue;

      // Filter who is covering this slice
      const covering = allRanges.filter((r) => r.start <= t0 && r.end >= t1);
      const names = Array.from(new Set(covering.map((c) => c.nick)));

      if (names.length > 0) {
        segments.push({
          start: t0,
          end: t1,
          count: names.length,
          names,
        });
      }
    }

    // Merge adjacent segments with identical participants
    const merged: OverlapSegment[] = [];
    segments.forEach((s) => {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.count === s.count &&
        last.end === s.start &&
        JSON.stringify(last.names.sort()) === JSON.stringify(s.names.sort())
      ) {
        last.end = s.end;
      } else {
        merged.push({ ...s });
      }
    });

    return {
      segments: merged,
      total,
      min: sortedPoints[0],
      max: sortedPoints[sortedPoints.length - 1],
    };
  };

  // Quick preset selections for setup
  const applyPresetDates = (presetType: "today3Days" | "thisWeek" | "thisWeekend" | "nextWeek") => {
    const today = new Date();
    const nextSet = new Set<string>();
    const currentDayOfWeek = today.getDay(); // 0 is Sun, 6 is Sat

    if (presetType === "today3Days") {
      // Today + 3 days
      for (let i = 0; i < 3; i++) {
        const d = new Date(today.getTime() + i * DAY_MS);
        nextSet.add(dateStr(d));
      }
    } else if (presetType === "thisWeek") {
      // Mon to Fri of this week
      for (let i = 1; i <= 5; i++) {
        const diff = i - currentDayOfWeek;
        const d = new Date(today.getTime() + diff * DAY_MS);
        nextSet.add(dateStr(d));
      }
    } else if (presetType === "thisWeekend") {
      // Sat & Sun of this week
      const satDiff = 6 - currentDayOfWeek;
      const sunDiff = 7 - currentDayOfWeek;
      nextSet.add(dateStr(new Date(today.getTime() + satDiff * DAY_MS)));
      nextSet.add(dateStr(new Date(today.getTime() + sunDiff * DAY_MS)));
    } else if (presetType === "nextWeek") {
      // Next Mon to Sun
      const startOfNextWeekDiff = 8 - currentDayOfWeek; // next Monday
      for (let i = 0; i < 7; i++) {
        const d = new Date(today.getTime() + (startOfNextWeekDiff + i) * DAY_MS);
        nextSet.add(dateStr(d));
      }
    }
    setSetupSelectedDates(nextSet);
    showToast("날짜 간편 선택이 적용되었습니다.");
  };

  return (
    <div className="min-h-screen font-sans flex flex-col justify-between max-w-4xl mx-auto px-4 py-8 md:py-12">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#2B2822] tracking-tight">언제겜해?</h1>
            <p className="text-xs text-[#8C8779] font-medium">우리끼리 제일 편한 게임 시간 찾기</p>
          </div>
        </div>

        {screen === "grid" && (
          <button
            onClick={handleLeaveRoom}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#DFD9C6] bg-white hover:bg-[#F7F5EC] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>방 나가기</span>
          </button>
        )}
      </header>

      <main className="flex-grow">
        <AnimatePresence mode="wait">
          {/* SCREEN 1: HOME */}
          {screen === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="grid md:grid-cols-2 gap-6">
                {/* Create Room Block */}
                <div className="bg-white border border-[#ECE7DA] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[#A9700F] font-bold text-xs uppercase tracking-wider mb-4">
                      <Plus className="w-4 h-4" />
                      <span>새 모임 생성하기</span>
                    </div>
                    <p className="text-sm text-[#8C8779] mb-4 leading-relaxed">
                      모임 날짜를 지정하고 방을 개설합니다. 참여한 친구들의 입력을 한눈에 모아볼 수 있습니다.
                    </p>

                    <div className="space-y-3 mb-6">
                      <div>
                        <label htmlFor="create-nickname" className="block text-xs font-semibold text-[#8C8779] mb-1">
                          내 닉네임
                        </label>
                        <input
                          id="create-nickname"
                          name="create-nickname"
                          type="text"
                          autoComplete="nickname"
                          placeholder="예: 민수"
                          value={createNickInput}
                          onChange={(e) => setCreateNickInput(e.target.value)}
                          className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FFC93C] transition-all"
                        />
                      </div>
                      <div>
                        <label htmlFor="create-pin" className="block text-xs font-semibold text-[#8C8779] mb-1">
                          수정용 PIN 번호 (숫자 4자리)
                        </label>
                        <input
                          id="create-pin"
                          name="create-pin"
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          autoComplete="new-password"
                          placeholder="비밀번호 설정"
                          value={createPinInput}
                          onChange={(e) => setCreatePinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                          className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FFC93C] transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleGoSetup}
                    className="w-full bg-[#FFC93C] hover:bg-[#FFBD1F] text-[#2B2822] font-semibold text-sm rounded-xl py-3 border border-[#FFC93C] shadow-sm hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>날짜 정하러 가기</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Join Room Block */}
                <div className="bg-white border border-[#ECE7DA] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[#A9700F] font-bold text-xs uppercase tracking-wider mb-4">
                      <Users className="w-4 h-4" />
                      <span>기존 모임 참여하기</span>
                    </div>
                    <p className="text-sm text-[#8C8779] mb-4 leading-relaxed">
                      공유받은 6자리 방 코드를 입력하고 내 비는 시간대를 등록해 보세요.
                    </p>

                    <div className="space-y-3 mb-6">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1">
                          <label htmlFor="join-code" className="block text-xs font-semibold text-[#8C8779] mb-1">
                            방 코드
                          </label>
                          <input
                            id="join-code"
                            name="join-code"
                            type="text"
                            placeholder="7XQK2M"
                            value={joinCodeInput}
                            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                            className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] font-bold placeholder:font-normal rounded-lg px-3 py-2 text-sm outline-none text-center focus:border-[#FFC93C] transition-all"
                          />
                        </div>
                        <div className="col-span-2">
                          <label htmlFor="join-nick" className="block text-xs font-semibold text-[#8C8779] mb-1">
                            내 닉네임
                          </label>
                          <input
                            id="join-nick"
                            name="join-nick"
                            type="text"
                            autoComplete="nickname"
                            placeholder="지난번과 같은 이름이면 정보 연동"
                            value={joinNickInput}
                            onChange={(e) => setJoinNickInput(e.target.value)}
                            className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FFC93C] transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="join-pin" className="block text-xs font-semibold text-[#8C8779] mb-1">
                          PIN 번호 (숫자 4자리)
                        </label>
                        <input
                          id="join-pin"
                          name="join-pin"
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          autoComplete="current-password"
                          placeholder="최초 입장 시 앞으로 쓸 PIN 설정"
                          value={joinPinInput}
                          onChange={(e) => setJoinPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                          className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FFC93C] transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleJoinRoom()}
                    disabled={loading}
                    className="w-full bg-white hover:bg-[#F7F5EC] text-[#2B2822] font-semibold text-sm rounded-xl py-3 border border-[#DFD9C6] hover:border-[#FFC93C] shadow-sm hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-[#DFD9C6] border-t-[#FFC93C]"></span>
                        <span>입장 정보 확인 중...</span>
                      </span>
                    ) : (
                      <span>참여하기</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Find My Rooms & Local History Section */}
              <div className="grid md:grid-cols-3 gap-6 pt-4">
                {/* Account Recovery */}
                <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm md:col-span-2">
                  <div className="flex items-center gap-2 text-[#A9700F] font-bold text-xs uppercase tracking-wider mb-3">
                    <Search className="w-4 h-4" />
                    <span>참여 중인 방 통합 찾기 (PIN 복구)</span>
                  </div>
                  <p className="text-xs text-[#8C8779] mb-4">
                    닉네임과 PIN 번호만 입력하면, 이전에 만들거나 입장했던 방의 기록을 서버에서 바로 찾아 연동할 수 있습니다.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label htmlFor="find-nick" className="block text-xs font-semibold text-[#8C8779] mb-1">
                        사용했던 닉네임
                      </label>
                      <input
                        id="find-nick"
                        name="find-nick"
                        type="text"
                        autoComplete="nickname"
                        placeholder="예: 민수"
                        value={findNickInput}
                        onChange={(e) => setFindNickInput(e.target.value)}
                        className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#FFC93C] transition-all"
                      />
                    </div>
                    <div>
                      <label htmlFor="find-pin" className="block text-xs font-semibold text-[#8C8779] mb-1">
                        등록했던 PIN
                      </label>
                      <input
                        id="find-pin"
                        name="find-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        autoComplete="current-password"
                        placeholder="숫자 4자리"
                        value={findPinInput}
                        onChange={(e) => setFindPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                        className="w-full bg-[#F7F5EC] border border-[#DFD9C6] text-[#2B2822] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#FFC93C] transition-all"
                      />
                    </div>
                    <button
                      onClick={handleFindRooms}
                      disabled={findLoading}
                      className="bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] font-semibold text-xs py-2 rounded-lg text-[#2B2822] transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {findLoading ? (
                        <span className="animate-spin rounded-full h-3 h-3 border-2 border-[#DFD9C6] border-t-[#FFC93C]"></span>
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      <span>내 모임 내역 찾기</span>
                    </button>
                  </div>

                  {foundRooms && foundRooms.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 border-t border-[#ECE7DA] pt-4 space-y-2 max-h-48 overflow-y-auto"
                    >
                      <h4 className="text-xs font-bold text-[#2B2822]">찾아낸 모임 목록</h4>
                      {foundRooms.map((r) => (
                        <div
                          key={r.code}
                          onClick={() => handleJoinRoom(r.code)}
                          className="flex justify-between items-center bg-[#F7F5EC] hover:bg-[#FFF6D9] p-2.5 rounded-lg border border-[#DFD9C6] cursor-pointer text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#A9700F] font-mono tracking-wide">{r.code}</span>
                            <span className="text-[#8C8779] font-medium">| 개설자: {r.config.createdBy}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[#A9700F] font-semibold">
                            <span>입장하기</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </div>

                {/* Local History */}
                <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-[#8C8779] font-bold text-xs uppercase tracking-wider mb-2">
                    <Calendar className="w-4 h-4 text-[#8C8779]" />
                    <span>최근 방문한 모임</span>
                  </div>
                  {localHistory.length === 0 ? (
                    <div className="text-xs text-[#B7B2A0] text-center py-6">
                      방문했던 모임 기록이 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {localHistory.map((item) => (
                        <div
                          key={item.code}
                          onClick={() => handleEnterFromHistory(item)}
                          className="group p-2 bg-[#F7F5EC] hover:bg-white rounded-lg border border-[#ECE7DA] hover:border-[#FFC93C] transition-all cursor-pointer flex justify-between items-center text-xs"
                        >
                          <div>
                            <div className="font-bold font-mono tracking-wider text-[#2B2822]">
                              {item.code}
                            </div>
                            <div className="text-[10px] text-[#8C8779] mt-0.5 font-medium truncate max-w-[140px]">
                              개설자: {item.config.createdBy}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#B7B2A0] group-hover:text-[#FFC93C] transition-colors" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* SCREEN 2: SETUP */}
          {screen === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-[#A9700F] uppercase tracking-widest">
                    모임 준비 단계
                  </div>
                  <h2 className="text-xl font-bold text-[#2B2822]">조율할 날짜를 골라주세요</h2>
                </div>
                <button
                  onClick={() => setScreen("home")}
                  className="text-xs text-[#8C8779] hover:text-[#2B2822] font-semibold bg-white border border-[#DFD9C6] px-3 py-1.5 rounded-lg transition-colors"
                >
                  이전 단계로
                </button>
              </div>

              {/* Setup Body */}
              <div className="bg-white border border-[#ECE7DA] rounded-2xl p-6 shadow-sm">
                <div className="mb-4">
                  <div className="text-xs font-bold text-[#8C8779] mb-2 flex items-center gap-1">
                    <CalendarDays className="w-4 h-4 text-[#A9700F]" />
                    <span>날짜 간편 선택 패널</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => applyPresetDates("today3Days")}
                      className="px-3 py-1.5 bg-[#FFF6D9] hover:bg-[#FFEAA7] border border-[#FFC93C] rounded-lg text-xs font-bold text-[#A9700F] transition-all"
                    >
                      오늘부터 3일 (기본)
                    </button>
                    <button
                      onClick={() => applyPresetDates("thisWeek")}
                      className="px-3 py-1.5 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all"
                    >
                      이번주 주중 (월~금)
                    </button>
                    <button
                      onClick={() => applyPresetDates("thisWeekend")}
                      className="px-3 py-1.5 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all"
                    >
                      이번주 주말 (토~일)
                    </button>
                    <button
                      onClick={() => applyPresetDates("nextWeek")}
                      className="px-3 py-1.5 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all"
                    >
                      다음주 전체 (월~일)
                    </button>
                    {setupSelectedDates.size > 0 && (
                      <button
                        onClick={() => setSetupSelectedDates(new Set())}
                        className="px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        선택 초기화
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-[#ECE7DA] my-4 pt-4">
                  <label className="block text-xs font-bold text-[#8C8779] mb-3">
                    달력에서 직접 추가하거나 아래에서 날짜들을 고르세요 (중복 선택 가능)
                  </label>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 mb-6">
                    {Array.from({ length: 14 }).map((_, i) => {
                      const today = new Date();
                      const d = new Date(today.getTime() + i * DAY_MS);
                      const ds = dateStr(d);
                      const isSelected = setupSelectedDates.has(ds);
                      return (
                        <div
                          key={ds}
                          onClick={() => toggleSetupDate(ds)}
                          className={`p-3 rounded-xl border text-center cursor-pointer select-none transition-all ${
                            isSelected
                              ? "bg-[#FFF3C4] border-[#FFC93C] text-[#A9700F] font-bold"
                              : "bg-[#F7F5EC] border-[#DFD9C6] text-[#2B2822] hover:bg-white"
                          }`}
                        >
                          <div className="text-[10px] text-[#8C8779] font-medium">
                            {d.getMonth() + 1}월
                          </div>
                          <div className="text-base font-bold my-0.5">{d.getDate()}</div>
                          <div className="text-[10px] text-xs font-medium">
                            {WEEKDAY[d.getDay()]}요일
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="bg-[#F7F5EC] p-4 rounded-xl flex flex-col sm:flex-row gap-3 items-end max-w-md border border-[#DFD9C6]">
                    <div className="flex-grow">
                      <label className="block text-xs font-bold text-[#8C8779] mb-1">
                        캘린더에서 직접 날짜 선택
                      </label>
                      <input
                        type="date"
                        value={setupExtraDate}
                        onChange={(e) => setSetupExtraDate(e.target.value)}
                        className="w-full bg-white border border-[#DFD9C6] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#FFC93C] transition-all"
                      />
                    </div>
                    <button
                      onClick={handleAddExtraDate}
                      className="px-4 py-2 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] text-[#2B2822] hover:border-[#FFC93C] rounded-lg text-xs font-semibold shrink-0 transition-all"
                    >
                      날짜 추가
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={handleCreateRoom}
                disabled={loading}
                className="w-full bg-[#FFC93C] hover:bg-[#FFBD1F] text-[#2B2822] font-semibold text-sm rounded-xl py-3.5 border border-[#FFC93C] shadow-sm hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-[#DFD9C6] border-t-[#FFC93C]"></span>
                    <span>방 만드는 중...</span>
                  </span>
                ) : (
                  <span>방 개설하고 일정 조율판 열기 →</span>
                )}
              </button>
            </motion.div>
          )}

          {/* SCREEN 3: GRID / DASHBOARD */}
          {screen === "grid" && config && (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Dashboard Sub Header */}
              <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold text-[#A9700F] uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" />
                      <span>초대하기 · 코드를 복사해서 전송하세요</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-extrabold font-mono tracking-widest text-[#A9700F] bg-[#FFF6D9] px-4 py-1.5 rounded-xl border border-dashed border-[#DFD9C6]">
                        {roomCode}
                      </div>
                      <button
                        onClick={handleCopyCode}
                        className="p-2.5 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] text-[#2B2822] rounded-xl transition-all cursor-pointer"
                        title="방 코드 복사"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="sm:text-right">
                    <div className="text-xs text-[#8C8779] font-medium">현재 접속 계정</div>
                    <div className="text-base font-bold text-[#2B2822] mt-0.5 flex items-center sm:justify-end gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FFC93C] animate-pulse"></span>
                      <span>{nickname}</span>
                      <span className="text-xs text-[#8C8779] font-normal font-mono">(PIN: {pin})</span>
                    </div>
                    <div className="text-[10px] text-[#B7B2A0] mt-1">
                      방 개설일: {new Date(config.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Mode Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex bg-[#F7F5EC] p-1 rounded-xl w-fit border border-[#DFD9C6]">
                  <button
                    onClick={() => {
                      setIsEditingDates(false);
                      handleSwitchMode("edit");
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      !isEditingDates && mode === "edit"
                        ? "bg-white text-[#2B2822] shadow-sm font-bold"
                        : "text-[#8C8779] hover:text-[#2B2822]"
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span>내 일정 등록 / 관리</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingDates(false);
                      handleSwitchMode("heatmap");
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      !isEditingDates && mode === "heatmap"
                        ? "bg-white text-[#2B2822] shadow-sm font-bold"
                        : "text-[#8C8779] hover:text-[#2B2822]"
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>모두의 일정 (종합)</span>
                  </button>
                </div>
              </div>

              {/* Mode content layout */}
              <AnimatePresence mode="wait">
                {isEditingDates ? (
                  <motion.div
                    key="date-edit"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-white border border-[#FFC93C] rounded-2xl p-6 shadow-sm space-y-6"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#ECE7DA] pb-4">
                      <div>
                        <h3 className="font-bold text-[#2B2822] text-base flex items-center gap-2">
                          <CalendarDays className="w-5 h-5 text-[#A9700F]" />
                          <span>조율할 날짜 추가 및 수정</span>
                        </h3>
                        <p className="text-xs text-[#8C8779] mt-0.5">
                          달력이나 아래 간편 버튼을 눌러 모임 대상 날짜들을 선택해 주세요. 저장 시 참가자 모두에게 반영됩니다.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleSaveRoomDates}
                          disabled={saving}
                          className="px-4 py-2 bg-[#FFC93C] hover:bg-[#FFBD1F] text-[#2B2822] font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{saving ? "저장 중..." : "변경 사항 저장"}</span>
                        </button>
                        <button
                          onClick={() => setIsEditingDates(false)}
                          className="px-4 py-2 bg-[#F7F5EC] hover:bg-[#ECE7DA] border border-[#DFD9C6] text-[#2B2822] text-xs font-semibold rounded-xl transition-all cursor-pointer"
                        >
                          취소
                        </button>
                      </div>
                    </div>

                    {/* Interactive Monthly Calendar for Date Selection */}
                    <div className="bg-[#FDFCF7] border border-[#ECE7DA] rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#2B2822] flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 text-[#A9700F]" />
                          <span>달력에서 날짜 클릭하여 추가/해제</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handlePrevEditMonth}
                            className="px-2.5 py-1 bg-white hover:bg-[#F7F5EC] border border-[#DFD9C6] rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            &lt; 이전 달
                          </button>
                          <span className="text-xs font-extrabold text-[#2B2822] px-1">
                            {editCalendarYear}년 {editCalendarMonth + 1}월
                          </span>
                          <button
                            onClick={handleNextEditMonth}
                            className="px-2.5 py-1 bg-white hover:bg-[#F7F5EC] border border-[#DFD9C6] rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            다음 달 &gt;
                          </button>
                        </div>
                      </div>

                      {/* Month Grid */}
                      <div className="p-2 border border-[#ECE7DA] rounded-xl bg-white shadow-inner">
                        {/* Weekday headers */}
                        <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-[#8C8779] border-b border-[#ECE7DA] pb-2">
                          <div className="text-red-500">일</div>
                          <div>월</div>
                          <div>화</div>
                          <div>수</div>
                          <div>목</div>
                          <div>금</div>
                          <div className="text-blue-500">토</div>
                        </div>

                        {/* Days */}
                        <div className="grid grid-cols-7 gap-1.5 pt-2">
                          {getDaysInMonth(editCalendarYear, editCalendarMonth).map((d, index) => {
                            if (d === null) {
                              return <div key={`empty-edit-${index}`} className="aspect-square" />;
                            }
                            const ds = dateStr(d);
                            const isSelected = editingDatesSet.has(ds);
                            const isToday = ds === dateStr(new Date());

                            return (
                              <button
                                key={ds}
                                type="button"
                                onClick={() => toggleEditRoomDate(ds)}
                                className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs font-bold border transition-all cursor-pointer select-none ${
                                  isSelected
                                    ? "bg-[#FFF3C4] border-[#FFC93C] text-[#A9700F] shadow-sm ring-2 ring-[#FFC93C]/40"
                                    : "bg-white border-[#ECE7DA] text-[#2B2822] hover:bg-[#F7F5EC]"
                                } ${isToday && !isSelected ? "border-dashed border-[#A9700F]" : ""}`}
                              >
                                <span>{d.getDate()}</span>
                                {isSelected ? (
                                  <span className="text-[9px] text-[#A9700F] font-extrabold leading-none mt-0.5">
                                    선택됨
                                  </span>
                                ) : isToday ? (
                                  <span className="text-[9px] text-gray-400 font-normal leading-none mt-0.5">
                                    오늘
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Quick Preset Buttons & Direct Date Input */}
                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Presets */}
                      <div className="bg-[#F7F5EC] p-4 rounded-xl border border-[#DFD9C6] space-y-2">
                        <span className="block text-xs font-bold text-[#8C8779]">
                          ⚡ 간편 묶음 선택
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const nextSet = new Set<string>(editingDatesSet);
                              for (let i = 1; i <= 5; i++) {
                                const diff = i - today.getDay();
                                const d = new Date(today.getTime() + diff * DAY_MS);
                                nextSet.add(dateStr(d));
                              }
                              setEditingDatesSet(nextSet);
                              showToast("이번주 주중 날짜가 추가되었습니다.");
                            }}
                            className="px-2.5 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all cursor-pointer"
                          >
                            + 이번주 주중(월~금)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const nextSet = new Set<string>(editingDatesSet);
                              const satDiff = 6 - today.getDay();
                              const sunDiff = 7 - today.getDay();
                              nextSet.add(dateStr(new Date(today.getTime() + satDiff * DAY_MS)));
                              nextSet.add(dateStr(new Date(today.getTime() + sunDiff * DAY_MS)));
                              setEditingDatesSet(nextSet);
                              showToast("이번주 주말 날짜가 추가되었습니다.");
                            }}
                            className="px-2.5 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all cursor-pointer"
                          >
                            + 이번주 주말(토~일)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const nextSet = new Set<string>(editingDatesSet);
                              const startOfNextWeekDiff = 8 - today.getDay();
                              for (let i = 0; i < 7; i++) {
                                const d = new Date(today.getTime() + (startOfNextWeekDiff + i) * DAY_MS);
                                nextSet.add(dateStr(d));
                              }
                              setEditingDatesSet(nextSet);
                              showToast("다음주 전체 날짜가 추가되었습니다.");
                            }}
                            className="px-2.5 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all cursor-pointer"
                          >
                            + 다음주 전체(월~일)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const nextSet = new Set<string>(editingDatesSet);
                              for (let i = 0; i < 7; i++) {
                                const d = new Date(today.getTime() + i * DAY_MS);
                                nextSet.add(dateStr(d));
                              }
                              setEditingDatesSet(nextSet);
                              showToast("오늘부터 7일이 추가되었습니다.");
                            }}
                            className="px-2.5 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-semibold text-[#2B2822] transition-all cursor-pointer"
                          >
                            + 오늘부터 7일
                          </button>
                        </div>
                      </div>

                      {/* Direct Input */}
                      <div className="bg-[#F7F5EC] p-4 rounded-xl border border-[#DFD9C6] space-y-2 flex flex-col justify-between">
                        <label className="block text-xs font-bold text-[#8C8779]">
                          📅 특정 날짜 직접 입력
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={editExtraDate}
                            onChange={(e) => setEditExtraDate(e.target.value)}
                            className="flex-grow bg-white border border-[#DFD9C6] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#FFC93C] transition-all"
                          />
                          <button
                            type="button"
                            onClick={handleAddEditRoomExtraDate}
                            className="px-3 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] text-[#2B2822] hover:border-[#FFC93C] rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer"
                          >
                            추가
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Selected Dates Summary Badges */}
                    <div className="bg-[#FDFCF7] border border-[#ECE7DA] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#2B2822]">
                          현재 선택된 조율 대상 날짜 ({editingDatesSet.size}일)
                        </span>
                        {editingDatesSet.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setEditingDatesSet(new Set())}
                            className="text-[11px] text-red-500 hover:text-red-700 hover:underline cursor-pointer"
                          >
                            전체 해제
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Array.from<string>(editingDatesSet)
                          .sort()
                          .map((ds) => (
                            <span
                              key={ds}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#FFC93C] text-[#A9700F] text-xs font-bold rounded-lg shadow-2xs"
                            >
                              <span>{dateLabel(ds)}</span>
                              <button
                                type="button"
                                onClick={() => toggleEditRoomDate(ds)}
                                className="text-gray-400 hover:text-red-600 ml-0.5 cursor-pointer"
                                title="제거"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        {editingDatesSet.size === 0 && (
                          <span className="text-xs text-gray-400 italic">
                            선택된 날짜가 없습니다. 달력이나 위 버튼에서 날짜를 골라주세요.
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ) : mode === "edit" ? (
                  <motion.div
                    key="edit"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="space-y-6"
                  >
                    {/* Horizontal Date Selection Panel for My Schedule */}
                    <div className="bg-white rounded-2xl p-5 border border-[#ECE7DA] shadow-xs space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#F2EFE9] pb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-[#FFF3C4] text-[#A9700F] rounded-xl">
                            <CalendarDays className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-[#2B2822]">
                              참여 가능한 날짜 선택
                            </h3>
                            <p className="text-xs text-[#8C8779]">
                              가로 카드를 좌우로 스크롤하며 가능한 날짜를 탭하여 추가/해제하세요
                            </p>
                          </div>
                        </div>

                        {/* Quick preset buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const day = today.getDay(); // 0 is Sun
                              const mondayOffset = day === 0 ? -6 : 1 - day;
                              const monday = new Date(today);
                              monday.setDate(today.getDate() + mondayOffset);
                              const dates: string[] = [];
                              for (let i = 0; i < 5; i++) {
                                const d = new Date(monday);
                                d.setDate(monday.getDate() + i);
                                dates.push(dateStr(d));
                              }
                              addPresetToMyActive(dates);
                            }}
                            className="px-2.5 py-1 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] text-xs font-semibold rounded-lg text-[#2B2822] transition-colors cursor-pointer"
                          >
                            + 평일(월~금)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const day = today.getDay();
                              const saturdayOffset = day === 0 ? -1 : 6 - day;
                              const sat = new Date(today);
                              sat.setDate(today.getDate() + saturdayOffset);
                              const sun = new Date(sat);
                              sun.setDate(sat.getDate() + 1);
                              addPresetToMyActive([dateStr(sat), dateStr(sun)]);
                            }}
                            className="px-2.5 py-1 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] text-xs font-semibold rounded-lg text-[#2B2822] transition-colors cursor-pointer"
                          >
                            + 주말(토~일)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const dates: string[] = [];
                              const today = new Date();
                              for (let i = 0; i < 7; i++) {
                                const d = new Date(today);
                                d.setDate(today.getDate() + i);
                                dates.push(dateStr(d));
                              }
                              addPresetToMyActive(dates);
                            }}
                            className="px-2.5 py-1 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] text-xs font-semibold rounded-lg text-[#2B2822] transition-colors cursor-pointer"
                          >
                            + 오늘부터 7일
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const today = new Date();
                              const day = today.getDay();
                              const nextMonOffset = day === 0 ? 1 : 8 - day;
                              const monday = new Date(today);
                              monday.setDate(today.getDate() + nextMonOffset);
                              const dates: string[] = [];
                              for (let i = 0; i < 7; i++) {
                                const d = new Date(monday);
                                d.setDate(monday.getDate() + i);
                                dates.push(dateStr(d));
                              }
                              addPresetToMyActive(dates);
                            }}
                            className="px-2.5 py-1 bg-[#F7F5EC] hover:bg-[#FFF6D9] border border-[#DFD9C6] text-xs font-semibold rounded-lg text-[#2B2822] transition-colors cursor-pointer"
                          >
                            + 다음주(7일)
                          </button>
                          {myActiveDates.size > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setMyActiveDates(new Set());
                                setMyRanges({});
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg transition-colors cursor-pointer"
                            >
                              전체 해제
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Horizontal Date Selection Slider */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-[#8C8779] px-1">
                          <span>향후 28일 일정 카드 (좌우로 스와이프/스크롤 가능)</span>
                          <span className="font-bold text-[#A9700F]">
                            선택됨: {myActiveDates.size}일
                          </span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 pt-1 scrollbar-thin">
                          {Array.from({ length: 28 }).map((_, i) => {
                            const today = new Date();
                            const d = new Date(today.getTime() + i * DAY_MS);
                            const ds = dateStr(d);
                            const isSelected = myActiveDates.has(ds);
                            const dayOfWeek = d.getDay();
                            const isSunday = dayOfWeek === 0;
                            const isSaturday = dayOfWeek === 6;
                            const isToday = i === 0;

                            return (
                              <button
                                key={ds}
                                type="button"
                                onClick={() => toggleMyActiveDate(ds)}
                                className={`shrink-0 w-16 sm:w-20 p-2.5 rounded-2xl border text-center cursor-pointer select-none transition-all flex flex-col items-center justify-between ${
                                  isSelected
                                    ? "bg-[#FFF3C4] border-[#FFC93C] text-[#A9700F] font-bold shadow-xs ring-2 ring-[#FFC93C]/50"
                                    : "bg-[#F7F5EC] border-[#DFD9C6] text-[#2B2822] hover:bg-white hover:border-[#FFC93C]"
                                } ${isToday && !isSelected ? "border-dashed border-[#A9700F]" : ""}`}
                              >
                                <div className="text-[10px] text-[#8C8779] font-medium">
                                  {d.getMonth() + 1}월
                                </div>
                                <div
                                  className={`text-lg font-extrabold my-0.5 ${
                                    isSelected
                                      ? "text-[#A9700F]"
                                      : isSunday
                                      ? "text-red-500"
                                      : isSaturday
                                      ? "text-blue-500"
                                      : "text-[#2B2822]"
                                  }`}
                                >
                                  {d.getDate()}
                                </div>
                                <div
                                  className={`text-[10px] font-semibold ${
                                    isSunday
                                      ? "text-red-500"
                                      : isSaturday
                                      ? "text-blue-500"
                                      : "text-[#8C8779]"
                                  }`}
                                >
                                  {WEEKDAY[dayOfWeek]}요일
                                </div>
                                <div className="mt-1">
                                  {isSelected ? (
                                    <span className="text-[9px] bg-[#A9700F] text-white px-1.5 py-0.2 rounded-full font-bold">
                                      선택됨
                                    </span>
                                  ) : isToday ? (
                                    <span className="text-[9px] text-[#8C8779] font-medium">
                                      오늘
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-gray-400 opacity-60">
                                      + 추가
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Direct Date Input & Sync Indicator */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#F2EFE9]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#8C8779]">
                            📅 특정 날짜 직접 입력:
                          </span>
                          <input
                            type="date"
                            value={editExtraDate}
                            onChange={(e) => setEditExtraDate(e.target.value)}
                            className="bg-[#F7F5EC] border border-[#DFD9C6] rounded-xl px-3 py-1.5 text-xs text-[#2B2822] outline-none focus:border-[#FFC93C]"
                          />
                          <button
                            type="button"
                            onClick={handleAddDirectActiveDate}
                            className="px-3 py-1.5 bg-[#FFC93C] hover:bg-[#FFBD1F] text-xs font-bold text-[#2B2822] rounded-xl transition-all cursor-pointer shadow-2xs"
                          >
                            + 날짜 추가
                          </button>
                        </div>
                        {saving && (
                          <span className="text-xs text-[#8C8779] font-mono animate-pulse">
                            🔄 일정 저장 중...
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Section: My Selected Dates */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#A9700F]" />
                        <h3 className="font-bold text-sm text-[#2B2822]">
                          내가 선택한 일정 목록 ({myActiveDates.size}일)
                        </h3>
                      </div>
                      <span className="text-xs text-[#8C8779]">
                        {myActiveDates.size > 0
                          ? "각 날짜별로 가능한 시간을 등록해 주세요"
                          : "위 달력에서 날짜를 선택해 주세요"}
                      </span>
                    </div>

                    {/* Dates List */}
                    {(() => {
                      const displayedDates: string[] = (Array.from(myActiveDates) as string[]).sort();

                      if (displayedDates.length === 0) {
                        return (
                          <div className="bg-[#FDFCF7] border border-[#ECE7DA] rounded-2xl p-8 text-center space-y-3 shadow-2xs">
                            <div className="w-12 h-12 bg-[#FFF9E6] text-[#A9700F] rounded-full flex items-center justify-center mx-auto">
                              <CalendarDays className="w-6 h-6" />
                            </div>
                            <h4 className="font-bold text-sm text-[#2B2822]">
                              아직 선택한 가능한 날짜가 없습니다
                            </h4>
                            <p className="text-xs text-[#8C8779] max-w-sm mx-auto">
                              위 달력에서 참여 가능한 날짜를 탭하여 추가하거나 간편 선택 버튼을 눌러보세요!
                            </p>
                          </div>
                        );
                      }

                      return displayedDates.map((ds: string) => {
                        const ranges = myRanges[ds] || [];
                        const isEditorOpenForThisDate =
                          rangeEditor && rangeEditor.date === ds && rangeEditor.index === null;

                        return (
                          <div
                            key={ds}
                            className="bg-white rounded-2xl p-5 shadow-xs space-y-4 transition-all border border-[#FFC93C]/80 ring-1 ring-[#FFC93C]/30"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-base text-[#2B2822]">
                                  {dateLabel(ds)}
                                </span>
                                {ranges.length > 0 ? (
                                  <span className="px-2 py-0.5 bg-[#FFF3C4] border border-[#FFC93C] text-[#A9700F] text-[10px] font-bold rounded-full">
                                    {ranges.length}개 시간대 등록됨
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-[#F7F5EC] border border-[#DFD9C6] text-[#8C8779] text-[10px] font-medium rounded-full">
                                    시간대 미등록 (아래에서 추가)
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleClearDayRanges(ds)}
                                  className="px-2.5 py-1 text-xs font-semibold text-red-600 hover:text-red-800 hover:bg-[#FDECEC] border border-red-200 rounded-lg transition-colors cursor-pointer"
                                  title="이 날짜를 내 일정에서 삭제"
                                >
                                  이 날짜 삭제 ✕
                                </button>
                                <button
                                  onClick={() => handleOpenAddRange(ds)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FFC93C] hover:bg-[#FFBD1F] text-xs font-bold text-[#2B2822] rounded-xl transition-all cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>직접 시간 추가</span>
                                </button>
                              </div>
                            </div>

                            {/* Quick presets for this day */}
                            <div className="flex flex-wrap items-center gap-1.5 bg-[#FCFBF8] p-2.5 rounded-xl border border-[#ECE7DA]">
                              <span className="text-[11px] font-bold text-[#8C8779] mr-1">간편 시간 등록:</span>
                              <button
                                type="button"
                                onClick={() => handleDirectQuickAddRange(ds, "12:00", "18:00")}
                                className="px-2.5 py-1 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] text-[11px] font-semibold text-[#2B2822] rounded-lg transition-colors cursor-pointer"
                              >
                                오후 (12:00 ~ 18:00)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDirectQuickAddRange(ds, "18:00", "22:00")}
                                className="px-2.5 py-1 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] text-[11px] font-semibold text-[#2B2822] rounded-lg transition-colors cursor-pointer"
                              >
                                저녁 (18:00 ~ 22:00)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDirectQuickAddRange(ds, "20:00", "24:00")}
                                className="px-2.5 py-1 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] text-[11px] font-semibold text-[#2B2822] rounded-lg transition-colors cursor-pointer"
                              >
                                밤 (20:00 ~ 24:00)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDirectQuickAddRange(ds, "00:00", "23:59")}
                                className="px-2.5 py-1 bg-[#FFF3C4] hover:bg-[#FFC93C] border border-[#FFC93C] text-[11px] font-bold text-[#A9700F] hover:text-[#2B2822] rounded-lg transition-colors cursor-pointer"
                              >
                                하루종일 (00:00 ~ 24:00)
                              </button>
                            </div>

                            {/* Ranges List */}
                            <div className="space-y-2">
                              {ranges.length === 0 ? (
                                <div className="p-3 bg-[#F7F5EC] rounded-xl text-xs text-[#8C8779] text-center border border-dashed border-[#DFD9C6]">
                                  아직 등록된 시간대가 없습니다. 위의 간편 시간 버튼이나 [+ 직접 시간 추가] 버튼을 눌러주세요.
                                </div>
                              ) : (
                                ranges.map((r, idx) => {
                                  const isEditingThisItem =
                                    rangeEditor &&
                                    rangeEditor.date === ds &&
                                    rangeEditor.index === idx;

                                  if (isEditingThisItem) {
                                    return (
                                      <div
                                        key={idx}
                                        className="bg-[#FFF6D9] border border-[#FFC93C] p-3 rounded-xl flex flex-wrap gap-3 items-end"
                                      >
                                        <div className="space-y-1">
                                          <span className="block text-[10px] font-bold text-[#8C8779]">
                                            시작 시간
                                          </span>
                                          <input
                                            type="time"
                                            value={rangeEditor.start}
                                            onChange={(e) =>
                                              setRangeEditor({ ...rangeEditor, start: e.target.value })
                                            }
                                            className="bg-white border border-[#DFD9C6] rounded-lg px-2.5 py-1 text-sm outline-none"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <span className="block text-[10px] font-bold text-[#8C8779]">
                                            종료 시간
                                          </span>
                                          <input
                                            type="time"
                                            value={rangeEditor.end}
                                            onChange={(e) =>
                                              setRangeEditor({ ...rangeEditor, end: e.target.value })
                                            }
                                            className="bg-white border border-[#DFD9C6] rounded-lg px-2.5 py-1 text-sm outline-none"
                                          />
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setRangeEditor({
                                                ...rangeEditor,
                                                start: "00:00",
                                                end: "23:59"
                                              })
                                            }
                                            className="px-3 py-1.5 bg-[#FFF3C4] border border-[#FFC93C] text-xs font-semibold rounded-lg hover:bg-[#FFC93C]/50 text-[#A9700F] transition-all"
                                          >
                                            하루종일
                                          </button>
                                          <button
                                            onClick={handleSaveRange}
                                            className="px-3 py-1.5 bg-[#FFC93C] text-xs font-semibold rounded-lg hover:bg-[#FFBD1F]"
                                          >
                                            적용
                                          </button>
                                          <button
                                            onClick={() => setRangeEditor(null)}
                                            className="px-3 py-1.5 bg-white border border-[#DFD9C6] text-xs font-semibold rounded-lg hover:bg-gray-50"
                                          >
                                            취소
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between bg-[#F7F5EC] p-3 rounded-xl border border-[#ECE7DA]"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Clock className="w-3.5 h-3.5 text-[#8C8779]" />
                                        <span className="text-sm font-bold font-mono text-[#2B2822]">
                                          {formatAMPM(r.start)} ~ {formatAMPM(r.end)}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => handleOpenEditRange(ds, idx)}
                                          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-[#DFD9C6]"
                                          title="시간 수정"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteRange(ds, idx)}
                                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-[#FDECEC] rounded-lg transition-colors border border-transparent hover:border-red-200"
                                          title="삭제"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              )}

                              {/* Range editor inline creator */}
                              {isEditorOpenForThisDate && rangeEditor && (
                                <motion.div
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="bg-[#FFF6D9] border border-dashed border-[#FFC93C] p-4 rounded-xl flex flex-wrap gap-4 items-end"
                                >
                                  <div className="space-y-1">
                                    <span className="block text-[10px] font-bold text-[#8C8779]">
                                      시작 시간
                                    </span>
                                    <input
                                      type="time"
                                      value={rangeEditor.start}
                                      onChange={(e) =>
                                        setRangeEditor({ ...rangeEditor, start: e.target.value })
                                      }
                                      className="bg-white border border-[#DFD9C6] rounded-lg px-2.5 py-1 text-sm outline-none"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="block text-[10px] font-bold text-[#8C8779]">
                                      종료 시간
                                    </span>
                                    <input
                                      type="time"
                                      value={rangeEditor.end}
                                      onChange={(e) =>
                                        setRangeEditor({ ...rangeEditor, end: e.target.value })
                                      }
                                      className="bg-white border border-[#DFD9C6] rounded-lg px-2.5 py-1 text-sm outline-none"
                                    />
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRangeEditor({
                                          ...rangeEditor,
                                          start: "00:00",
                                          end: "23:59"
                                        })
                                      }
                                      className="px-3 py-1.5 bg-[#FFF3C4] border border-[#FFC93C] text-xs font-semibold rounded-lg hover:bg-[#FFC93C]/50 text-[#A9700F] transition-all"
                                    >
                                      하루종일
                                    </button>
                                    <button
                                      onClick={handleSaveRange}
                                      className="px-3 py-1.5 bg-[#FFC93C] text-xs font-semibold rounded-lg hover:bg-[#FFBD1F]"
                                    >
                                      추가
                                    </button>
                                    <button
                                      onClick={() => setRangeEditor(null)}
                                      className="px-3 py-1.5 bg-white border border-[#DFD9C6] text-xs font-semibold rounded-lg hover:bg-gray-50"
                                    >
                                      취소
                                    </button>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </motion.div>
                ) : (
                  <motion.div
                    key="heatmap"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      {/* Swatch legend */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#8C8779]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ backgroundColor: "#FFEB3B" }}
                          ></span>
                          <span>한사람만</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ backgroundColor: "#FF9800" }}
                          ></span>
                          <span>절반이상</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ backgroundColor: "#FF5722" }}
                          ></span>
                          <span>전부 🔥</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleOpenEditDates}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#FFF6D9] border border-[#DFD9C6] hover:border-[#FFC93C] rounded-lg text-xs font-bold text-[#2B2822] transition-all cursor-pointer"
                        >
                          <CalendarDays className="w-3.5 h-3.5 text-[#A9700F]" />
                          <span>날짜 추가/수정</span>
                        </button>
                        <button
                          onClick={fetchHeatmapData}
                          disabled={loading}
                          className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-[#F7F5EC] border border-[#DFD9C6] rounded-lg text-xs font-semibold text-[#2B2822] transition-all cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                          <span>시간표 새로고침</span>
                        </button>
                      </div>
                    </div>

                    {/* Interactive Calendar View */}
                    <div className="grid md:grid-cols-5 gap-6">
                      {/* Calendar Panel */}
                      <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm space-y-4 md:col-span-3">
                        <div className="flex items-center justify-between pb-2 border-b border-[#ECE7DA]">
                          <span className="text-xs font-bold text-[#8C8779] flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-[#A9700F]" />
                            <span>조율 캘린더 (날짜 선택)</span>
                          </span>
                          <button
                            onClick={handleOpenEditDates}
                            className="text-[11px] font-bold text-[#A9700F] hover:text-[#8A3A18] bg-[#FFF6D9] hover:bg-[#FFF3C4] px-2 py-0.5 rounded-md border border-[#FFC93C] transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" />
                            <span>날짜 추가하기</span>
                          </button>
                        </div>

                        {/* Month Navigation */}
                        <div className="flex items-center justify-between bg-[#F7F5EC] p-2 rounded-xl border border-[#DFD9C6]">
                          <button
                            onClick={handlePrevMonth}
                            className="px-2.5 py-1 hover:bg-white rounded-lg border border-transparent hover:border-[#DFD9C6] text-xs font-bold transition-all cursor-pointer"
                          >
                            &lt; 이전 달
                          </button>
                          <div className="text-xs font-extrabold text-[#2B2822]">
                            {calendarYear}년 {calendarMonth + 1}월
                          </div>
                          <button
                            onClick={handleNextMonth}
                            className="px-2.5 py-1 hover:bg-white rounded-lg border border-transparent hover:border-[#DFD9C6] text-xs font-bold transition-all cursor-pointer"
                          >
                            다음 달 &gt;
                          </button>
                        </div>

                        {/* Calendar Grid */}
                        <div className="p-1 border border-[#ECE7DA] rounded-xl bg-gray-50/50">
                          {/* Weekdays */}
                          <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-[#8C8779] border-b border-[#ECE7DA] pb-1.5 pt-0.5">
                            <div className="text-red-500">일</div>
                            <div>월</div>
                            <div>화</div>
                            <div>수</div>
                            <div>목</div>
                            <div>금</div>
                            <div className="text-blue-500">토</div>
                          </div>

                          {/* Days */}
                          <div className="grid grid-cols-7 gap-1.5 pt-1.5">
                            {getDaysInMonth(calendarYear, calendarMonth).map((d, index) => {
                              if (d === null) {
                                return <div key={`empty-${index}`} className="aspect-square" />;
                              }
                              const ds = dateStr(d);
                              const isConfiguredDate = config.dates.includes(ds);
                              const isActiveSelected =
                                (selectedHeatmapDate && config.dates.includes(selectedHeatmapDate)
                                  ? selectedHeatmapDate
                                  : config.dates[0]) === ds;
                              const isMySelected =
                                Boolean(myRanges[ds] && myRanges[ds].length > 0);

                              let cellClass =
                                "aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-medium border transition-all text-gray-300 border-transparent bg-transparent select-none";

                              if (isConfiguredDate) {
                                if (isActiveSelected) {
                                  cellClass =
                                    "aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-extrabold bg-[#FFC93C] text-[#2B2822] border-[#FF7A45] shadow-sm ring-2 ring-[#FF7A45]/20 cursor-pointer";
                                } else {
                                  cellClass =
                                    "aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-bold bg-[#FFF9E6] text-[#A9700F] border-[#FFC93C]/60 hover:bg-[#FFF3C4] hover:border-[#FFC93C] cursor-pointer";
                                }
                              } else {
                                const isToday = ds === dateStr(new Date());
                                cellClass =
                                  "aspect-square flex flex-col items-center justify-center rounded-lg text-[11px] text-gray-400 opacity-40 cursor-not-allowed";
                                if (isToday) {
                                  cellClass += " border border-dashed border-[#DFD9C6] font-semibold opacity-70";
                                }
                              }

                              return (
                                <button
                                  key={ds}
                                  disabled={!isConfiguredDate}
                                  onClick={() => isConfiguredDate && setSelectedHeatmapDate(ds)}
                                  className={cellClass}
                                >
                                  <span>{d.getDate()}</span>
                                  {isConfiguredDate && (
                                    <div className="flex items-center gap-0.5 mt-0.5">
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                          isActiveSelected ? "bg-[#FF7A45]" : "bg-[#FF7A45]/80"
                                        }`}
                                      />
                                      {isMySelected && (
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full ${
                                            isActiveSelected ? "bg-[#A9700F]" : "bg-[#FFC93C]"
                                          }`}
                                          title="내 선택 일정"
                                        />
                                      )}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Quick Select Panel */}
                      <div className="md:col-span-2 flex flex-col justify-between">
                        <div className="bg-[#F7F5EC] p-4 rounded-2xl border border-[#DFD9C6] space-y-3 h-full">
                          <div className="flex items-center justify-between border-b border-[#ECE7DA] pb-2">
                            <div className="text-xs font-bold text-[#8C8779] flex items-center gap-1">
                              <CalendarDays className="w-4 h-4 text-[#A9700F]" />
                              <span>조율 일정 목록 ({config.dates.length}일)</span>
                            </div>
                            <button
                              onClick={handleOpenEditDates}
                              className="text-[11px] font-bold text-[#A9700F] hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>날짜 추가</span>
                            </button>
                          </div>
                          <p className="text-[11px] text-[#8C8779] leading-relaxed">
                            친구들이 등록한 약속 대상 날짜들입니다. 클릭하면 시간대와 상세 참여자를 볼 수 있습니다.
                          </p>
                          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                            {config.dates.map((ds) => {
                              const isActiveSelected =
                                (selectedHeatmapDate && config.dates.includes(selectedHeatmapDate)
                                  ? selectedHeatmapDate
                                  : config.dates[0]) === ds;
                              const dailyOverlap = computeDayOverlap(ds);
                              const bestRangesCount = dailyOverlap.segments.filter(
                                (s) => s.count === dailyOverlap.total
                              ).length;
                              const isMySelected =
                                Boolean(myRanges[ds] && myRanges[ds].length > 0);

                              return (
                                <button
                                  key={ds}
                                  onClick={() => setSelectedHeatmapDate(ds)}
                                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex justify-between items-center ${
                                    isActiveSelected
                                      ? "bg-[#FFF3C4] border-[#FFC93C] text-[#A9700F] font-bold shadow-sm"
                                      : "bg-white hover:bg-[#FFF9E6] border-[#DFD9C6] text-[#2B2822]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span>{dateLabel(ds)}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {isMySelected && (
                                      <span className="bg-[#FFF3C4] border border-[#FFC93C] text-[#A9700F] text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                                        내 선택 ✓
                                      </span>
                                    )}
                                    {bestRangesCount > 0 && (
                                      <span className="bg-[#FF7A45] text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">
                                        합의 가능 🔥
                                      </span>
                                    )}
                                    <span className="text-[10px] text-gray-500">
                                      {
                                        Object.keys(responses).filter(
                                          (user) => responses[user]?.[ds]?.length > 0
                                        ).length
                                      }
                                      명 가능
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Timeline & Participant Details for Selected Date */}
                    {(() => {
                      const activeSelectedDate = (selectedHeatmapDate && config.dates.includes(selectedHeatmapDate))
                        ? selectedHeatmapDate
                        : config.dates[0] || null;

                      if (!activeSelectedDate) {
                        return (
                          <div className="bg-white border border-[#ECE7DA] rounded-2xl p-6 text-center text-xs text-gray-400 italic">
                            조율 중인 날짜가 없습니다. 날짜를 먼저 추가해 주세요.
                          </div>
                        );
                      }

                      const overlapData = computeDayOverlap(activeSelectedDate);
                      const hasParticipants = overlapData.total > 0;
                      const segments = overlapData.segments;

                      return (
                        <div className="space-y-6">
                          {/* Day Overlap Visualization */}
                          <div className="bg-white border border-[#FFC93C]/60 rounded-2xl p-5 shadow-sm space-y-4">
                            <div className="flex justify-between items-center border-b border-[#F7F5EC] pb-3">
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-[#A9700F]" />
                                <h3 className="font-bold text-[#2B2822] text-sm md:text-base">
                                  {dateLabel(activeSelectedDate)} 종합 일정
                                </h3>
                              </div>
                              <span className="text-xs text-[#8C8779] font-medium">
                                제출 인원: {overlapData.total}명
                              </span>
                            </div>

                            {!hasParticipants || segments.length === 0 ? (
                              <p className="text-xs text-[#B7B2A0] italic py-6 text-center bg-[#F7F5EC]/50 rounded-xl">
                                아직 아무도 일정을 제출하지 않았거나 가능한 시간대가 없습니다.
                              </p>
                            ) : (
                              <>
                                {/* Visual Bar Timeline Wrapper */}
                                <div className="relative group/timeline pt-6 pb-1">
                                  <div className="h-10 bg-[#F7F5EC] rounded-xl border border-[#ECE7DA] overflow-visible flex relative">
                                    {segments.map((seg, sIdx) => {
                                      const rangeSpan = overlapData.max - overlapData.min;
                                      const widthPercentage =
                                        rangeSpan > 0 ? ((seg.end - seg.start) / rangeSpan) * 100 : 100;

                                      const activeUsersCount = seg.count;
                                      const ratio = activeUsersCount / overlapData.total;

                                      // 3 groups: 한사람만 (#FFEB3B), 절반이상 (#FF9800), 전부 (#FF5722)
                                      let bgColor = "#FFEB3B";
                                      if (ratio >= 0.5 && activeUsersCount > 1) {
                                        bgColor = "#FF9800";
                                      }
                                      if (activeUsersCount === overlapData.total) {
                                        bgColor = "#FF5722";
                                      }

                                      const isFirst = sIdx === 0;
                                      const isLast = sIdx === segments.length - 1;

                                      return (
                                        <div
                                          key={sIdx}
                                          style={{ width: `${widthPercentage}%`, backgroundColor: bgColor }}
                                          className={`h-full relative cursor-help transition-all hover:brightness-95 group/seg ${
                                            isFirst ? "rounded-l-xl" : ""
                                          } ${isLast ? "rounded-r-xl" : ""}`}
                                        >
                                          {/* Time tooltip at start of first segment */}
                                          {isFirst && (
                                            <div className="absolute left-0 top-0 pointer-events-none z-10">
                                              <span className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/timeline:opacity-100 group-hover/seg:opacity-100 bg-[#2B2822] text-white text-[9px] font-bold font-mono px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap transition-all z-20">
                                                {minToTimeAMPM(seg.start)}
                                              </span>
                                            </div>
                                          )}

                                          {/* Time tooltip at end of segment (division boundary) */}
                                          <div className="absolute right-0 top-0 pointer-events-none z-10">
                                            <span className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/timeline:opacity-100 group-hover/seg:opacity-100 bg-[#2B2822] text-white text-[9px] font-bold font-mono px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap transition-all z-20">
                                              {minToTimeAMPM(seg.end)}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Time Labels on bottom */}
                                  <div className="flex justify-between text-[10px] font-mono text-[#B7B2A0] px-1 mt-1.5">
                                    <span>{minToTimeAMPM(overlapData.min)}</span>
                                    <span>{minToTimeAMPM(overlapData.max)}</span>
                                  </div>
                                </div>

                                {/* Best windows indicator */}
                                <div className="space-y-1.5 pt-1">
                                  {segments.filter((s) => s.count === overlapData.total).length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-bold text-[#8A3A18] flex items-center gap-1 bg-[#FFF3C4] px-2 py-1 rounded-md border border-[#FFC93C]">
                                        <Sparkles className="w-3.5 h-3.5 text-[#FF7A45]" />
                                        <span>전원 참여 가능 시간:</span>
                                      </span>
                                      {segments
                                        .filter((s) => s.count === overlapData.total)
                                        .map((s, idx) => (
                                          <span
                                            key={idx}
                                            className="text-xs font-extrabold font-mono text-[#A9700F] px-2 py-1 bg-white border border-[#DFD9C6] rounded-md shadow-sm"
                                          >
                                            {minToTimeAMPM(s.start)} ~ {minToTimeAMPM(s.end)}
                                          </span>
                                        ))}
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Participant Detailed Schedules on this specific date */}
                          <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm space-y-4">
                            <h4 className="text-xs font-bold text-[#8C8779] flex items-center gap-1.5 border-b border-[#F7F5EC] pb-2.5">
                              <Users className="w-4 h-4 text-[#A9700F]" />
                              <span>친구별 상세 선택 시간 ({dateLabel(activeSelectedDate)})</span>
                            </h4>
                            <div className="space-y-2.5">
                              {Object.keys(responses).length > 0 ? (
                                Object.keys(responses).map((nickName) => {
                                  const userRangesOnThisDate = responses[nickName]?.[activeSelectedDate] || [];
                                  const isMe = nickName === nickname;
                                  return (
                                    <div
                                      key={nickName}
                                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border transition-all ${
                                        isMe
                                          ? "bg-[#FFFDF5] border-[#FFC93C]/60 shadow-sm"
                                          : "bg-[#F7F5EC]/60 border-[#ECE7DA]"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${userRangesOnThisDate.length > 0 ? "bg-[#FFC93C] animate-pulse" : "bg-gray-300"}`} />
                                        <span className={`text-xs font-bold ${isMe ? "text-[#A9700F]" : "text-[#2B2822]"}`}>
                                          {nickName} {isMe && "(나)"}
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 mt-2 sm:mt-0">
                                        {userRangesOnThisDate.length > 0 ? (
                                          userRangesOnThisDate.map((r, rIdx) => (
                                            <span
                                              key={rIdx}
                                              className="bg-white px-2.5 py-1 rounded-lg border border-[#DFD9C6] text-xs font-bold font-mono text-[#2B2822]"
                                            >
                                              {formatAMPM(r.start)} ~ {formatAMPM(r.end)}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-[11px] text-gray-400 italic font-medium bg-white/50 px-2 py-0.5 rounded">
                                            가능 시간 미제출 또는 없음
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-xs text-gray-400 italic py-3 text-center">
                                  아직 제출된 일정이 없습니다.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}



                    {/* Respondent participants list */}
                    <div className="bg-white border border-[#ECE7DA] rounded-2xl p-5 shadow-sm space-y-3">
                      <div className="text-xs font-bold text-[#8C8779] flex items-center gap-1.5">
                        <UserCheck className="w-4 h-4 text-[#A9700F]" />
                        <span>전체 참여 인원 제출 현황 ({Object.keys(responses).length}명)</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Object.keys(responses).length > 0 ? (
                          Object.keys(responses).map((nickName) => {
                            const isMe = nickName === nickname;
                            return (
                              <span
                                key={nickName}
                                className={`text-xs px-3 py-1.5 rounded-full font-semibold border ${
                                  isMe
                                    ? "bg-[#FFF3C4] border-[#FFC93C] text-[#A9700F]"
                                    : "bg-[#F7F5EC] border-[#ECE7DA] text-gray-700"
                                }`}
                              >
                                {nickName} {isMe && "(나)"}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-gray-400 italic">
                            아직 일정을 제출한 사용자가 없습니다.
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-12 text-center text-[11px] text-[#B7B2A0] border-t border-[#ECE7DA] pt-4 space-y-1 font-medium">
        <div>언제겜해? - 간편하게 조율하는 같이 게임할 시간</div>
        <div>
          개발자 정보 및 보안: 데이터가 서버의 JSON 형식 파일로 안전하게 관리되고 있습니다.
        </div>
      </footer>

      {/* Popover Global Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 20, x: "-50%" }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#2B2822] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 z-50 border border-white/10"
          >
            <Sparkles className="w-4 h-4 text-[#FFC93C]" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
