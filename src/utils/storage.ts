// 방 데이터 타입 정의 (프로젝트의 타입 정의에 맞게 수정)
export interface Room {
  id: string;
  title?: string;
  selectedDates: string[];
  createdAt: string;
}

const ROOMS_KEY = 'game_rooms_data';

// 모든 방 목록 가져오기
export const getRooms = (): Room[] => {
  const data = localStorage.getItem(ROOMS_KEY);
  return data ? JSON.parse(data) : [];
};

// 특정 방 하나 가져오기
export const getRoomById = (id: string): Room | undefined => {
  const rooms = getRooms();
  return rooms.find((room) => room.id === id);
};

// 새 방 생성 및 저장하기
export const createRoom = (roomData: Omit<Room, 'id' | 'createdAt'>): Room => {
  const rooms = getRooms();
  const newRoom: Room = {
    ...roomData,
    id: Math.random().toString(36).substring(2, 9), // 고유 ID 생성
    createdAt: new Date().toISOString(),
  };

  rooms.push(newRoom);
  localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  return newRoom;
};
