import { useFilterStore, type RoleLevel, type RemoteStatus } from '../lib/store';
import { Search, X, DollarSign, Tag } from 'lucide-react';
import { trpc } from '../lib/trpc';
import * as Slider from '@radix-ui/react-slider';

export function FilterPanel() {
  const { 
    searchQuery, setSearchQuery, 
    roleLevels, toggleRoleLevel,
    remoteStatuses, toggleRemoteStatus,
    minSalary, setMinSalary,
    technologies: selectedTechs, toggleTechnology,
    resetFilters
  } = useFilterStore();

  const { data: popularTechs } = trpc.job.getTechnologies.useQuery();

  const levels: RoleLevel[] = ['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL', 'MANAGER'];
  const remotes: RemoteStatus[] = ['REMOTE_ONLY', 'HYBRID', 'ON_SITE'];
// ... (rest of the component)

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

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
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 text-[10px]">Search</label>
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

      {/* Salary Slider */}
      <div className="space-y-4">
        <div className="flex justify-between items-end">
          <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 text-[10px]">Min Salary</label>
          <span className="text-sm font-bold text-primary">{formatCurrency(minSalary || 0)}</span>
        </div>
        <Slider.Root
          className="relative flex items-center select-none touch-none w-full h-5"
          value={[minSalary || 0]}
          max={500000}
          step={10000}
          onValueChange={([value]) => setMinSalary(value === 0 ? null : value)}
        >
          <Slider.Track className="bg-gray-100 relative grow rounded-full h-[4px]">
            <Slider.Range className="absolute bg-primary rounded-full h-full" />
          </Slider.Track>
          <Slider.Thumb
            className="block w-5 h-5 bg-white border-2 border-primary shadow-sm rounded-[10px] hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Minimum Salary"
          />
        </Slider.Root>
        <div className="flex justify-between text-[10px] text-gray-400 font-bold uppercase">
          <span>$0</span>
          <span>$500k+</span>
        </div>
      </div>

      {/* Role Level */}
      <div className="space-y-3">
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 text-[10px]">Role Level</label>
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
        <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 text-[10px]">Remote</label>
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

      {/* Popular Technologies */}
      {popularTechs && popularTechs.length > 0 && (
        <div className="space-y-3">
          <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 text-[10px]">Top Technologies</label>
          <div className="flex flex-wrap gap-2">
            {popularTechs.map((tech: any) => (
              <button
                key={tech.name}
                onClick={() => toggleTechnology(tech.name)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                  selectedTechs.includes(tech.name)
                    ? 'bg-primary border-primary text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-primary/50'
                }`}
              >
                {tech.name} <span className="opacity-60">({tech.job_count})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
