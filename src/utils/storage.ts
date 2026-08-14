import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { TimeRange, RoomConfig } from "../types";

export interface UserData {
  pinHash: string;
  ranges: Record<string, TimeRange[]>;
}

export interface RoomData {
  code: string;
  dates: string[];
  createdAt: number;
  createdBy: string;
  users: Record<string, UserData>;
}

// Initialize Firebase client-side instance
const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

function initDb() {
  const cfgDbId = (firebaseConfig as any).firestoreDatabaseId;
  if (cfgDbId && cfgDbId !== "(default)") {
    try {
      return getFirestore(firebaseApp, cfgDbId);
    } catch (e) {
      console.warn("Could not init named firestore, falling back to default:", e);
      return getFirestore(firebaseApp);
    }
  }
  return getFirestore(firebaseApp);
}

export const db = initDb();

const ROOMS_COLLECTION = "rooms";

// 6자리 난수 방 코드 생성
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Retrieve room data by room code.
 */
export async function getRoomById(code: string): Promise<RoomData | null> {
  const upperCode = code.trim().toUpperCase();
  if (!upperCode) return null;

  try {
    const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
      return snap.data() as RoomData;
    }
  } catch (err) {
    console.error(`Error fetching room ${upperCode}:`, err);
    throw err;
  }
  return null;
}

/**
 * Create a new room with custom dates and creator info.
 */
export async function createRoom(params: {
  nickname: string;
  pinHash: string;
  dates: string[];
}): Promise<{ code: string; config: RoomConfig }> {
  const { nickname, pinHash, dates } = params;
  if (!nickname || !pinHash || !dates || dates.length === 0) {
    throw new Error("닉네임, PIN, 그리고 최소 1개 이상의 날짜가 필요합니다.");
  }

  let code = "";
  let attempts = 0;
  while (attempts < 10) {
    code = generateRoomCode();
    const existing = await getRoomById(code);
    if (!existing) break;
    attempts++;
  }

  const sortedDates = [...dates].sort();
  const newRoom: RoomData = {
    code,
    dates: sortedDates,
    createdAt: Date.now(),
    createdBy: nickname,
    users: {
      [nickname]: {
        pinHash,
        ranges: {},
      },
    },
  };

  const roomRef = doc(db, ROOMS_COLLECTION, code);
  await setDoc(roomRef, newRoom);

  return {
    code,
    config: {
      dates: newRoom.dates,
      createdBy: newRoom.createdBy,
      createdAt: newRoom.createdAt,
    },
  };
}

/**
 * Join an existing room with nickname and PIN hash validation.
 */
export async function joinRoom(
  code: string,
  nickname: string,
  pinHash: string
): Promise<{
  success: boolean;
  nickname: string;
  myRanges: Record<string, TimeRange[]>;
  config: RoomConfig;
}> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("존재하지 않는 방입니다. 코드를 다시 확인해 주세요.");
  }

  const existingUser = room.users?.[nickname];
  if (existingUser) {
    if (existingUser.pinHash !== pinHash) {
      throw new Error("PIN 번호가 일치하지 않습니다. 올바른 PIN을 입력해 주세요.");
    }
  } else {
    const newUser: UserData = {
      pinHash,
      ranges: {},
    };
    const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
    await setDoc(roomRef, { users: { [nickname]: newUser } }, { merge: true });
  }

  return {
    success: true,
    nickname,
    myRanges: existingUser?.ranges || {},
    config: {
      dates: room.dates,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
  };
}

/**
 * Save user time ranges for a room.
 */
export async function saveUserRangesInDb(
  code: string,
  nickname: string,
  pinHash: string,
  ranges: Record<string, TimeRange[]>
): Promise<{ success: boolean; config: RoomConfig }> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("존재하지 않는 방입니다.");
  }

  const user = room.users?.[nickname];
  if (!user || user.pinHash !== pinHash) {
    throw new Error("수정 권한이 없습니다. PIN 번호를 확인해 주세요.");
  }

  const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
  await setDoc(
    roomRef,
    {
      users: {
        [nickname]: {
          pinHash,
          ranges,
        },
      },
    },
    { merge: true }
  );

  return {
    success: true,
    config: {
      dates: room.dates,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
  };
}

/**
 * Update candidate dates for a room.
 */
export async function updateRoomDatesInDb(
  code: string,
  nickname: string,
  pinHash: string,
  dates: string[]
): Promise<{ success: boolean; config: RoomConfig }> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("존재하지 않는 방입니다.");
  }

  const user = room.users?.[nickname];
  if (!user || user.pinHash !== pinHash) {
    throw new Error("수정 권한이 없습니다. PIN 번호를 확인해 주세요.");
  }

  const sortedDates = [...dates].sort();
  const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
  await setDoc(roomRef, { dates: sortedDates }, { merge: true });

  return {
    success: true,
    config: {
      dates: sortedDates,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
  };
}

/**
 * Fetch all participants' responses for a room.
 */
export async function getRoomResponses(
  code: string
): Promise<Record<string, Record<string, TimeRange[]>>> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room || !room.users) {
    return {};
  }

  const responses: Record<string, Record<string, TimeRange[]>> = {};
  for (const [user, data] of Object.entries(room.users)) {
    responses[user] = data.ranges || {};
  }

  return responses;
}

/**
 * Find rooms by user nickname and PIN hash.
 */
export async function findRoomsByUserInDb(
  nickname: string,
  pinHash: string
): Promise<Array<{ code: string; config: RoomConfig }>> {
  const roomsRef = collection(db, ROOMS_COLLECTION);
  const q = query(roomsRef);
  const snap = await getDocs(q);

  const matched: Array<{ code: string; config: RoomConfig }> = [];
  snap.forEach((docSnap) => {
    const r = docSnap.data() as RoomData;
    if (r.users && r.users[nickname] && r.users[nickname].pinHash === pinHash) {
      matched.push({
        code: r.code,
        config: {
          dates: r.dates,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
        },
      });
    }
  });

  return matched;
}

/**
 * Real-time listener for room updates.
 */
export function subscribeToRoomUpdates(
  code: string,
  onUpdate: (room: RoomData | null) => void
) {
  const upperCode = code.trim().toUpperCase();
  const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
  return onSnapshot(
    roomRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as RoomData);
      } else {
        onUpdate(null);
      }
    },
    (err) => {
      console.error("Firestore listen error:", err);
    }
  );
}
