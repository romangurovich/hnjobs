import { create } from 'zustand';

export type RoleLevel = 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF' | 'PRINCIPAL' | 'MANAGER';
export type RemoteStatus = 'REMOTE_ONLY' | 'HYBRID' | 'ON_SITE';

interface FilterState {
  searchQuery: string;
  roleLevels: RoleLevel[];
  remoteStatuses: RemoteStatus[];
  minSalary: number | null;
  technologies: string[];
  sortBy: 'created_at' | 'salary_max' | 'company_name';
  sortOrder: 'asc' | 'desc';

  setSearchQuery: (query: string) => void;
  toggleRoleLevel: (level: RoleLevel) => void;
  toggleRemoteStatus: (status: RemoteStatus) => void;
  setMinSalary: (salary: number | null) => void;
  toggleTechnology: (tech: string) => void;
  setSort: (by: FilterState['sortBy'], order: FilterState['sortOrder']) => void;
  resetFilters: () => void;
}

const initialState = {
  searchQuery: '',
  roleLevels: [],
  remoteStatuses: [],
  minSalary: null,
  technologies: [],
  sortBy: 'created_at' as const,
  sortOrder: 'desc' as const,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...initialState,

  setSearchQuery: (query) => set({ searchQuery: query }),
  
  toggleRoleLevel: (level) => set((state) => ({
    roleLevels: state.roleLevels.includes(level)
      ? state.roleLevels.filter((l) => l !== level)
      : [...state.roleLevels, level],
  })),

  toggleRemoteStatus: (status) => set((state) => ({
    remoteStatuses: state.remoteStatuses.includes(status)
      ? state.remoteStatuses.filter((s) => s !== status)
      : [...state.remoteStatuses, status],
  })),

  setMinSalary: (salary) => set({ minSalary: salary }),

  toggleTechnology: (tech) => set((state) => ({
    technologies: state.technologies.includes(tech)
      ? state.technologies.filter((t) => t !== tech)
      : [...state.technologies, tech],
  })),

  setSort: (by, order) => set({ sortBy: by, sortOrder: order }),

  resetFilters: () => set(initialState),
}));
