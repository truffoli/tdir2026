import { level1 } from './level1';
import { level2 } from './level2';
import { level3 } from './level3';

export interface LevelDef {
  id: string;
  title: string;
  subtitle: string;
  difficulty: number;
  description: string;
  trk: string;
  sch: string;
  tutorial?: string[];
  /** attiva il blocco automatico su tutti i segnali che lo consentono */
  autoFleet?: boolean;
}

export const LEVELS: LevelDef[] = [level1, level2, level3];
