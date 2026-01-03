import { create } from 'zustand';

interface FilterState {
  searchQuery: string;
  // Add other filters here as we define them
  // e.g., locations: string[];
  // e.g., salaryRange: [number, number];

  setSearchQuery: (query: string) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
