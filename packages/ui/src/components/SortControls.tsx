import { useFilterStore } from '../lib/store';
import { ArrowUpDown } from 'lucide-react';

export function SortControls() {
  const { sortBy, sortOrder, setSort } = useFilterStore();

  const options = [
    { label: 'Date Posted', value: 'created_at' as const },
    { label: 'Max Salary', value: 'salary_max' as const },
    { label: 'Company Name', value: 'company_name' as const },
  ];

  return (
    <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Sort By</span>
      <select
        value={sortBy}
        onChange={(e) => setSort(e.target.value as any, sortOrder)}
        className="text-sm font-medium bg-transparent outline-none cursor-pointer border-r border-gray-100 pr-3"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => setSort(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
        className="hover:text-primary transition-colors flex items-center gap-1 text-sm font-medium"
      >
        <ArrowUpDown size={14} />
        {sortOrder === 'desc' ? 'Descending' : 'Ascending'}
      </button>
    </div>
  );
}
