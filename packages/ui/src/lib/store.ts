import { create } from 'zustand';

export type RoleLevel = 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF' | 'PRINCIPAL' | 'MANAGER';
export type RemoteStatus = 'REMOTE_ONLY' | 'HYBRID' | 'ON_SITE';

interface FilterState {
  searchQuery: string;
  roleLevels: RoleLevel[];
  remoteStatuses: RemoteStatus[];
  minSalary: number | null;
  technologies: string[];
  locations: string[];
  sortBy: 'created_at' | 'salary_max' | 'company_name';
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;

  setSearchQuery: (query: string) => void;
  toggleRoleLevel: (level: RoleLevel) => void;
  toggleRemoteStatus: (status: RemoteStatus) => void;
  setMinSalary: (salary: number | null) => void;
  toggleTechnology: (tech: string) => void;
  toggleLocation: (location: string) => void;
  setSort: (by: FilterState['sortBy'], order: FilterState['sortOrder']) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;
}

const initialState = {
  searchQuery: '',
  roleLevels: [],
  remoteStatuses: [],
  minSalary: null,
  technologies: [],
  locations: [],
  sortBy: 'created_at' as const,
  sortOrder: 'desc' as const,
  page: 1,
  pageSize: 10,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...initialState,

  setSearchQuery: (query) => set({ searchQuery: query, page: 1 }),
  
  toggleRoleLevel: (level) => set((state) => ({
    page: 1,
    roleLevels: state.roleLevels.includes(level)
      ? state.roleLevels.filter((l) => l !== level)
      : [...state.roleLevels, level],
  })),

  toggleRemoteStatus: (status) => set((state) => ({
    page: 1,
    remoteStatuses: state.remoteStatuses.includes(status)
      ? state.remoteStatuses.filter((s) => s !== status)
      : [...state.remoteStatuses, status],
  })),

  setMinSalary: (salary) => set({ minSalary: salary, page: 1 }),

  toggleTechnology: (tech) => set((state) => ({
    page: 1,
    technologies: state.technologies.includes(tech)
      ? state.technologies.filter((t) => t !== tech)
      : [...state.technologies, tech],
  })),

  toggleLocation: (location) => set((state) => ({
    page: 1,
    locations: state.locations.includes(location)
      ? state.locations.filter((l) => l !== location)
      : [...state.locations, location],
  })),

  setSort: (by, order) => set({ sortBy: by, sortOrder: order, page: 1 }),

  setPage: (page) => set({ page }),

  resetFilters: () => set(initialState),
}));