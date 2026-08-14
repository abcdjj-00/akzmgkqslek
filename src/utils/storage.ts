import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { RoomConfig, TimeRange } from "../types";

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

/**
 * Generate a random 6-character room code.
 */
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
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
    if (!room.users) room.users = {};
    room.users[nickname] = newUser;
  }

  return {
    success: true,
    nickname,
    myRanges: room.users?.[nickname]?.ranges || {},
    config: {
      dates: room.dates,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
  };
}

/**
 * Save / update user's time ranges in a room.
 */
export async function saveUserRangesInDb(
  code: string,
  nickname: string,
  pinHash: string,
  ranges: Record<string, TimeRange[]>
): Promise<void> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }

  const user = room.users?.[nickname];
  if (!user) {
    throw new Error("해당 방에 등록된 사용자가 아닙니다.");
  }

  if (user.pinHash !== pinHash) {
    throw new Error("PIN 번호가 일치하지 않습니다.");
  }

  const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
  await setDoc(roomRef, { users: { [nickname]: { ranges } } }, { merge: true });

  // Update room dates union if new date ranges were added
  const activeRangeDates = Object.keys(ranges).filter((d) => (ranges[d] || []).length > 0);
  const existingDates = room.dates || [];
  const combinedDates = Array.from(new Set([...existingDates, ...activeRangeDates])).sort();
  if (combinedDates.length > existingDates.length) {
    await setDoc(roomRef, { dates: combinedDates }, { merge: true });
  }
}

/**
 * Update the room's available coordination dates.
 */
export async function updateRoomDatesInDb(
  code: string,
  nickname: string,
  pinHash: string,
  dates: string[]
): Promise<RoomConfig> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }

  const user = room.users?.[nickname];
  if (!user) {
    throw new Error("해당 방의 참여자가 아닙니다.");
  }

  if (user.pinHash !== pinHash) {
    throw new Error("PIN 번호가 일치하지 않습니다.");
  }

  const sortedDates = [...dates].sort();
  const roomRef = doc(db, ROOMS_COLLECTION, upperCode);
  await setDoc(roomRef, { dates: sortedDates }, { merge: true });

  return {
    dates: sortedDates,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
  };
}

/**
 * Fetch all user responses and latest config for heatmap calculation.
 */
export async function getRoomResponses(code: string): Promise<{
  responses: Record<string, Record<string, TimeRange[]>>;
  config: RoomConfig;
}> {
  const upperCode = code.trim().toUpperCase();
  const room = await getRoomById(upperCode);

  if (!room) {
    throw new Error("방을 찾을 수 없습니다.");
  }

  const responses: Record<string, Record<string, TimeRange[]>> = {};
  if (room.users) {
    Object.keys(room.users).forEach((nick) => {
      responses[nick] = room.users[nick]?.ranges || {};
    });
  }

  return {
    responses,
    config: {
      dates: room.dates,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
  };
}

/**
 * Find all rooms associated with a user's nickname and PIN hash.
 */
export async function findRoomsByUserInDb(
  nickname: string,
  pinHash: string
): Promise<{ code: string; config: RoomConfig }[]> {
  const matchedRooms: { code: string; config: RoomConfig }[] = [];

  try {
    const q = query(
      collection(db, ROOMS_COLLECTION),
      where(`users.${nickname}.pinHash`, "==", pinHash)
    );
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data() as RoomData;
      matchedRooms.push({
        code: docSnap.id,
        config: {
          dates: data.dates,
          createdAt: data.createdAt,
          createdBy: data.createdBy,
        },
      });
    });
    if (matchedRooms.length > 0) {
      return matchedRooms;
    }
  } catch (e) {
    console.warn("Direct query failed, scanning collection fallback:", e);
  }

  // Fallback scan
  try {
    const allDocsSnap = await getDocs(collection(db, ROOMS_COLLECTION));
    allDocsSnap.forEach((docSnap) => {
      const data = docSnap.data() as RoomData;
      const user = data.users?.[nickname];
      if (user && user.pinHash === pinHash) {
        if (!matchedRooms.some((r) => r.code === docSnap.id)) {
          matchedRooms.push({
            code: docSnap.id,
            config: {
              dates: data.dates,
              createdAt: data.createdAt,
              createdBy: data.createdBy,
            },
          });
        }
      }
    });
  } catch (e) {
    console.error("Error finding rooms:", e);
    throw e;
  }

  return matchedRooms;
}
