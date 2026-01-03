import { useFilterStore, RoleLevel, RemoteStatus } from '../lib/store';
import { Search, X } from 'lucide-react';

export function FilterPanel() {
  const { 
    searchQuery, setSearchQuery, 
    roleLevels, toggleRoleLevel,
    remoteStatuses, toggleRemoteStatus,
    resetFilters
  } = useFilterStore();

  const levels: RoleLevel[] = ['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL', 'MANAGER'];
  const remotes: RemoteStatus[] = ['REMOTE_ONLY', 'HYBRID', 'ON_SITE'];

  return (
    <aside className="w-full lg:w-64 space-y-8 bg-white p-6 rounded-lg border border-gray-200 h-fit">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Filters</h2>
        <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-primary flex items-center gap-1">
          <X size={12} /> Reset
        </button>
      </div>

      {/* Search */}
      <div className="space-y-3">
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500">Search</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            placeholder="Company or title..."
          />
        </div>
      </div>

      {/* Role Level */}
      <div className="space-y-3">
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500">Role Level</label>
        <div className="space-y-2">
          {levels.map((level) => (
            <label key={level} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={roleLevels.includes(level)}
                onChange={() => toggleRoleLevel(level)}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors capitalize">
                {level.toLowerCase()}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Remote Status */}
      <div className="space-y-3">
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500">Remote</label>
        <div className="space-y-2">
          {remotes.map((status) => (
            <label key={status} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={remoteStatuses.includes(status)}
                onChange={() => toggleRemoteStatus(status)}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                {status.replace('_', ' ')}
              </span>
            </label>
          ))}
        </div>
      </div>
    </aside>
  );
}
