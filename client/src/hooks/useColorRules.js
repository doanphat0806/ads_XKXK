import { useMemo } from 'react';
import {
  getNgayKetThucColor,
  getRowColor,
  getSLCanDatThemColor,
  getTiLeDatColor,
  getTiLeHoanColor,
  getTiLeShipColor
} from '../utils/colorRules';

export function useColorRules() {
  return useMemo(() => ({
    getNgayKetThucColor,
    getRowColor,
    getSLCanDatThemColor,
    getTiLeDatColor,
    getTiLeHoanColor,
    getTiLeShipColor
  }), []);
}
