import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_CONFIG } from '../types/chuaCoConfig.types';
import { getPreviewSamples } from '../utils/calculations';
import { loadChuaCoConfig, saveChuaCoConfig } from '../utils/configStorage';

export function useChuaCoConfig() {
  const [config, setConfig] = useState(() => loadChuaCoConfig());

  const previewSamples = useMemo(() => getPreviewSamples(config), [config]);

  const persistConfig = useCallback((nextConfig) => {
    setConfig(nextConfig);
    saveChuaCoConfig(nextConfig);
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    saveChuaCoConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }, []);

  return {
    config,
    setConfig: persistConfig,
    resetConfig,
    previewSamples
  };
}
