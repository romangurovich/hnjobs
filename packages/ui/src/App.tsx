
import './App.css';
import { trpc } from './lib/trpc';
import { useFilterStore } from './lib/store';

function App() {
  // Example of using the tRPC hook (will fail until backend is connected)
  // const { data, isLoading, error } = trpc.job.list.useQuery();

  // Example of using the Zustand store
  const { searchQuery, setSearchQuery } = useFilterStore();

  return (
    <div>
      <h1>HN Jobs Board</h1>
      <main>
        {/* We will add FilterPanel, JobList, etc. here */}
        <p>This is where the job board will be.</p>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
        />
        <p>Current search query: {searchQuery}</p>
      </main>
    </div>
  );
}

export default App;
