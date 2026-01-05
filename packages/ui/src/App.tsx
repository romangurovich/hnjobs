import { trpc } from './lib/trpc';
import { useFilterStore } from './lib/store';
import { FilterPanel } from './components/FilterPanel';
import { JobCard } from './components/JobCard';
import { SortControls } from './components/SortControls';
import { Pagination } from './components/Pagination';
import { Loader2 } from 'lucide-react';

function App() {
  const { 
    searchQuery, roleLevels, remoteStatuses, 
    minSalary, technologies, locations, page, pageSize, 
    sortBy, sortOrder, setPage 
  } = useFilterStore();

  const { data, isLoading, error } = trpc.job.list.useQuery({
    search: searchQuery || undefined,
    roleLevels: roleLevels.length > 0 ? roleLevels : undefined,
    remoteStatuses: remoteStatuses.length > 0 ? remoteStatuses : undefined,
    locations: locations.length > 0 ? locations : undefined,
    minSalary: minSalary || undefined,
    technologies: technologies.length > 0 ? technologies : undefined,
    page,
    pageSize,
    sortBy,
    sortOrder,
  });

  const jobs = data?.jobs || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-white p-1.5 rounded font-bold text-lg">HN</div>
            <h1 className="text-xl font-extrabold tracking-tight">Jobs Board</h1>
          </div>
          <div className="text-sm text-gray-500 font-medium hidden sm:block">
            Enriched listings from Hacker News
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <FilterPanel />

        {/* Job List */}
        <main className="flex-1">
          <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-lg font-bold text-gray-900">
              {isLoading ? 'Searching jobs...' : `${total} Job Postings found`}
            </h2>
            <SortControls />
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 className="animate-spin mb-4" size={48} />
              <p className="text-lg font-medium">Fetching latest opportunities...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-100 text-red-700 p-6 rounded-lg">
              <h3 className="font-bold mb-2 text-lg">Error loading jobs</h3>
              <p>{error.message}</p>
            </div>
          ) : jobs.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-6">
                {jobs.map((job: any) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
              
              <Pagination 
                page={page} 
                totalPages={totalPages} 
                onPageChange={(p) => setPage(p)} 
              />
            </>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
              <p className="text-lg font-medium">No jobs matching your filters found.</p>
              <button 
                onClick={() => useFilterStore.getState().resetFilters()}
                className="mt-4 text-primary font-bold hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-100 mt-12">
        <div className="flex justify-center items-center text-sm text-gray-400">
          <p>
            Made by{' '}
            <a 
              href="https://0to1.pro/" 
              target="_blank" 
              rel="noreferrer"
              className="text-gray-500 font-medium hover:text-primary transition-colors underline decoration-gray-200 underline-offset-4"
            >
              Roman (0to1.pro)
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;