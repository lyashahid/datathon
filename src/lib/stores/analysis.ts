import { createContext } from 'svelte';
import type { AnalysisProvider } from '#lib/types/analysis.ts';

export const [getAnalysisProvider, setAnalysisProvider] = createContext<AnalysisProvider>();
