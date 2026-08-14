import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

export interface Participant {
  id: string;
  name: string;
  pin: string;
  availableTimes: string[];
  lastUpdated: string;
}

export interface Room {
  code: string;
  title: string;
  date: string;
  createdAt: string;
  participants: Participant[];
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

// Firebase 기반 방 생성 함수
export async function createRoomInFirestore(title: string, date: string, creatorName: string, creatorPin: string): Promise<Room> {
  const code = generateRoomCode();
  const newRoom: Room = {
    code,
    title: title || "게임 약속",
    date: date || new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
    participants: [
      {
        id: "p_" + Date.now(),
        name: creatorName,
        pin: creatorPin,
        availableTimes: [],
        lastUpdated: new Date().toISOString(),
      },
    ],
  };

  const roomRef = doc(db, ROOMS_COLLECTION, code);
  await setDoc(roomRef, newRoom);
  return newRoom;
}

// 방 데이터 가져오기
export async function getRoomFromFirestore(roomCode: string): Promise<Room | null> {
  const roomRef = doc(db, ROOMS_COLLECTION, roomCode.toUpperCase());
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    return null;
  }
  return snap.data() as Room;
}

// 실시간 방 구독 리스너
export function subscribeToRoom(roomCode: string, onUpdate: (room: Room | null) => void) {
  const roomRef = doc(db, ROOMS_COLLECTION, roomCode.toUpperCase());
  return onSnapshot(
    roomRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as Room);
      } else {
        onUpdate(null);
      }
    },
    (err) => {
      console.error("Firestore listen error:", err);
    }
  );
}

// 참여자 추가 또는 기존 참여자 정보 업데이트
export async function joinOrUpdateParticipant(
  roomCode: string,
  participantName: string,
  pin: string,
  times?: string[]
): Promise<{ success: boolean; message?: string; room?: Room }> {
  const roomRef = doc(db, ROOMS_COLLECTION, roomCode.toUpperCase());
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    return { success: false, message: "존재하지 않는 방입니다." };
  }

  const room = snap.data() as Room;
  const existingIdx = room.participants.findIndex((p) => p.name === participantName);

  if (existingIdx >= 0) {
    // 기존 유저: PIN 일치 확인
    if (room.participants[existingIdx].pin !== pin) {
      return { success: false, message: "PIN 번호가 일치하지 않습니다." };
    }
    if (times !== undefined) {
      room.participants[existingIdx].availableTimes = times;
      room.participants[existingIdx].lastUpdated = new Date().toISOString();
    }
  } else {
    // 신규 참여자 등록
    room.participants.push({
      id: "p_" + Date.now(),
      name: participantName,
      pin,
      availableTimes: times || [],
      lastUpdated: new Date().toISOString(),
    });
  }

  await updateDoc(roomRef, { participants: room.participants });
  return { success: true, room };
}

// 닉네임과 PIN으로 참여했던 방 목록 찾기
export async function findMyRoomsInFirestore(nickname: string, pin: string): Promise<Room[]> {
  const roomsRef = collection(db, ROOMS_COLLECTION);
  const q = query(roomsRef);
  const snap = await getDocs(q);

  const matched: Room[] = [];
  snap.forEach((docSnap) => {
    const r = docSnap.data() as Room;
    const isMember = r.participants.some((p) => p.name === nickname && p.pin === pin);
    if (isMember) {
      matched.push(r);
    }
  });

  return matched;
}
