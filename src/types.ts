export interface TimeRange {
  start: string;
  end: string;
}

export interface RoomConfig {
  dates: string[];
  createdBy: string;
  createdAt: number;
}

export type ScreenType = 'home' | 'setup' | 'grid';
export type ModeType = 'edit' | 'heatmap';

export interface RoomHistoryItem {
  code: string;
  config: RoomConfig;
}

export interface OverlapSegment {
  start: number; // minutes from midnight
  end: number;
  count: number;
  names: string[];
}

export interface DayOverlapData {
  segments: OverlapSegment[];
  total: number;
  min: number;
  max: number;
}
