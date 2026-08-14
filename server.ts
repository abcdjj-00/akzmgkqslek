import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";

interface TimeRange {
  start: string;
  end: string;
}

interface UserData {
  pinHash: string;
  ranges: Record<string, TimeRange[]>;
}

interface RoomData {
  code: string;
  dates: string[];
  createdAt: number;
  createdBy: string;
  users: Record<string, UserData>;
}

interface Database {
  rooms: Record<string, RoomData>;
}

const DB_FILE = path.join(process.cwd(), "db.json");

// Helper to load legacy db.json if present
function loadLegacyDb(): Database {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Error reading legacy db file:", e);
  }
  return { rooms: {} };
}

// Initialize Firestore
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseApp: any = null;
let db: any = null;

if (fs.existsSync(firebaseConfigPath)) {
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const databaseId = firebaseConfig.firestoreDatabaseId || "(default)";
    db = getFirestore(firebaseApp, databaseId);
    console.log("Firestore initialized successfully with databaseId:", databaseId);
  } catch (err) {
    console.error("Failed to initialize Firestore:", err);
  }
}

// Firestore Room Operations
async function getRoom(code: string): Promise<RoomData | null> {
  const upperCode = code.toUpperCase();
  if (db) {
    try {
      const roomRef = doc(db, "rooms", upperCode);
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        return snap.data() as RoomData;
      }
    } catch (e) {
      console.error(`Error reading room ${upperCode} from Firestore:`, e);
    }
  }

  // Fallback to legacy db.json
  const legacyDb = loadLegacyDb();
  const room = legacyDb.rooms[upperCode];
  if (room && db) {
    try {
      await setDoc(doc(db, "rooms", upperCode), room);
      console.log(`Auto-migrated room ${upperCode} to Firestore`);
    } catch (e) {
      console.error(`Failed auto-migration for ${upperCode}:`, e);
    }
  }
  return room || null;
}

async function saveRoom(room: RoomData): Promise<void> {
  const upperCode = room.code.toUpperCase();
  if (db) {
    try {
      await setDoc(doc(db, "rooms", upperCode), room);
      return;
    } catch (e) {
      console.error(`Error saving room ${upperCode} to Firestore:`, e);
    }
  }
}

async function updateUserInRoom(code: string, nickname: string, userData: UserData): Promise<void> {
  const upperCode = code.toUpperCase();
  if (db) {
    try {
      const roomRef = doc(db, "rooms", upperCode);
      await setDoc(roomRef, { users: { [nickname]: userData } }, { merge: true });
      return;
    } catch (e) {
      console.error(`Error updating user ${nickname} in ${upperCode}:`, e);
    }
  }
}

async function updateUserRanges(code: string, nickname: string, ranges: Record<string, TimeRange[]>): Promise<void> {
  const upperCode = code.toUpperCase();
  if (db) {
    try {
      const roomRef = doc(db, "rooms", upperCode);
      await setDoc(roomRef, { users: { [nickname]: { ranges } } }, { merge: true });
      return;
    } catch (e) {
      console.error(`Error updating ranges for ${nickname} in ${upperCode}:`, e);
    }
  }
}

async function updateRoomDates(code: string, dates: string[]): Promise<void> {
  const upperCode = code.toUpperCase();
  if (db) {
    try {
      const roomRef = doc(db, "rooms", upperCode);
      await setDoc(roomRef, { dates: dates.sort() }, { merge: true });
      return;
    } catch (e) {
      console.error(`Error updating dates for ${upperCode}:`, e);
    }
  }
}

async function findRoomsByUser(nickname: string, pinHash: string): Promise<{ code: string; config: any }[]> {
  const matchedRooms: { code: string; config: any }[] = [];

  if (db) {
    try {
      const q = query(
        collection(db, "rooms"),
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
            createdBy: data.createdBy
          }
        });
      });
      if (matchedRooms.length > 0) {
        return matchedRooms;
      }
    } catch (e) {
      console.warn("Direct Firestore query failed, falling back to collection scan:", e);
    }

    // Secondary scan fallback across Firestore rooms if nested field query missed or threw
    try {
      const allDocsSnap = await getDocs(collection(db, "rooms"));
      allDocsSnap.forEach((docSnap) => {
        const data = docSnap.data() as RoomData;
        const user = data.users?.[nickname];
        if (user && user.pinHash === pinHash) {
          if (!matchedRooms.some(r => r.code === docSnap.id)) {
            matchedRooms.push({
              code: docSnap.id,
              config: {
                dates: data.dates,
                createdAt: data.createdAt,
                createdBy: data.createdBy
              }
            });
          }
        }
      });
      return matchedRooms;
    } catch (e) {
      console.error("Error during Firestore collection scan fallback:", e);
    }
  }

  // Fallback check in legacy db.json
  const legacyDb = loadLegacyDb();
  Object.keys(legacyDb.rooms).forEach((code) => {
    const room = legacyDb.rooms[code];
    const user = room.users[nickname];
    if (user && user.pinHash === pinHash) {
      matchedRooms.push({
        code,
        config: {
          dates: room.dates,
          createdAt: room.createdAt,
          createdBy: room.createdBy
        }
      });
    }
  });

  return matchedRooms;
}

// Auto migrate legacy db.json to Firestore on boot
async function autoMigrateLegacyDb() {
  if (!db) return;
  const legacyDb = loadLegacyDb();
  const roomCodes = Object.keys(legacyDb.rooms);
  if (roomCodes.length === 0) return;

  console.log(`Checking ${roomCodes.length} legacy rooms for auto-migration...`);
  for (const code of roomCodes) {
    try {
      const upperCode = code.toUpperCase();
      const snap = await getDoc(doc(db, "rooms", upperCode));
      if (!snap.exists()) {
        await setDoc(doc(db, "rooms", upperCode), legacyDb.rooms[code]);
        console.log(`Successfully migrated legacy room ${upperCode} to Firestore`);
      }
    } catch (err) {
      console.error(`Migration error for room ${code}:`, err);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Trigger migration asynchronously
  autoMigrateLegacyDb().catch((err) => console.error("Auto migration failed:", err));

  // API 1: Create room
  app.post("/api/rooms", async (req, res) => {
    const { nickname, pinHash, dates } = req.body;
    if (!nickname || !pinHash || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    let attempts = 0;
    while (attempts < 10) {
      code = "";
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      const existing = await getRoom(code);
      if (!existing) break;
      attempts++;
    }

    const newRoom: RoomData = {
      code,
      dates: dates.sort(),
      createdAt: Date.now(),
      createdBy: nickname,
      users: {
        [nickname]: {
          pinHash,
          ranges: {}
        }
      }
    };

    await saveRoom(newRoom);

    res.json({
      success: true,
      code,
      config: {
        dates: newRoom.dates,
        createdBy: newRoom.createdBy,
        createdAt: newRoom.createdAt
      }
    });
  });

  // API 2: Join room
  app.post("/api/rooms/:code/join", async (req, res) => {
    const { code } = req.params;
    const { nickname, pinHash } = req.body;

    if (!nickname || !pinHash) {
      return res.status(400).json({ error: "Nickname and PIN hash are required" });
    }

    const room = await getRoom(code);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const existingUser = room.users?.[nickname];
    if (existingUser) {
      if (existingUser.pinHash !== pinHash) {
        return res.status(401).json({ error: "Incorrect PIN" });
      }
    } else {
      const newUser: UserData = {
        pinHash,
        ranges: {}
      };
      await updateUserInRoom(code, nickname, newUser);
      if (!room.users) room.users = {};
      room.users[nickname] = newUser;
    }

    res.json({
      success: true,
      nickname,
      myRanges: room.users[nickname]?.ranges || {},
      config: {
        dates: room.dates,
        createdBy: room.createdBy,
        createdAt: room.createdAt
      }
    });
  });

  // API 3: Update user ranges
  app.post("/api/rooms/:code/user/:nickname/ranges", async (req, res) => {
    const { code, nickname } = req.params;
    const { pinHash, ranges } = req.body;

    if (!pinHash || !ranges) {
      return res.status(400).json({ error: "PIN hash and ranges are required" });
    }

    const room = await getRoom(code);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const user = room.users?.[nickname];
    if (!user) {
      return res.status(404).json({ error: "User not found in this room" });
    }

    if (user.pinHash !== pinHash) {
      return res.status(401).json({ error: "Incorrect PIN" });
    }

    await updateUserRanges(code, nickname, ranges);

    // Ensure any newly added dates are unioned into room.dates so other members can see them
    const activeRangeDates = Object.keys(ranges).filter((d) => (ranges[d] || []).length > 0);
    const existingDates = room.dates || [];
    const combinedDates = Array.from(new Set([...existingDates, ...activeRangeDates])).sort();
    if (combinedDates.length > existingDates.length) {
      await updateRoomDates(code, combinedDates);
    }

    res.json({ success: true });
  });

  // API 4: Get all responses for a room
  app.get("/api/rooms/:code/responses", async (req, res) => {
    const { code } = req.params;
    const room = await getRoom(code);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const responses: Record<string, Record<string, TimeRange[]>> = {};
    if (room.users) {
      Object.keys(room.users).forEach((nick) => {
        responses[nick] = room.users[nick].ranges || {};
      });
    }

    res.json({
      success: true,
      responses,
      config: {
        dates: room.dates,
        createdBy: room.createdBy,
        createdAt: room.createdAt
      }
    });
  });

  // API 5: Find all rooms by nickname and PIN hash
  app.post("/api/find-rooms", async (req, res) => {
    const { nickname, pinHash } = req.body;
    if (!nickname || !pinHash) {
      return res.status(400).json({ error: "Nickname and PIN hash are required" });
    }

    const matchedRooms = await findRoomsByUser(nickname, pinHash);

    res.json({
      success: true,
      rooms: matchedRooms
    });
  });

  // API 6: Update room dates
  app.post("/api/rooms/:code/dates", async (req, res) => {
    const { code } = req.params;
    const { nickname, pinHash, dates } = req.body;

    if (!nickname || !pinHash || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "Nickname, PIN hash, and dates are required" });
    }

    const room = await getRoom(code);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const user = room.users?.[nickname];
    if (!user) {
      return res.status(404).json({ error: "User not found in this room" });
    }

    if (user.pinHash !== pinHash) {
      return res.status(401).json({ error: "Incorrect PIN" });
    }

    const sortedDates = dates.sort();
    await updateRoomDates(code, sortedDates);

    res.json({
      success: true,
      config: {
        dates: sortedDates,
        createdBy: room.createdBy,
        createdAt: room.createdAt
      }
    });
  });

  // Vite dev or production static serving middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
