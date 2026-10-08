import { level1 } from './level1';

export interface LevelDef {
  id: string;
  title: string;
  subtitle: string;
  difficulty: number;
  description: string;
  trk: string;
  sch: string;
  tutorial?: string[];
}

export const LEVELS: LevelDef[] = [level1];
