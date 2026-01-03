
import './App.css';
import { trpc } from './lib/trpc';
import { useFilterStore } from './lib/store';

function App() {
  // Example of using the tRPC hook (will fail at runtime until backend is running)
  const { data, isLoading, error } = trpc.job.list.useQuery({
    search: 'frontend',
  });

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

        <hr />

        <h2>API Data:</h2>
        {isLoading && <p>Loading...</p>}
        {error && <p>Error: {error.message}</p>}
        {data && (
          <pre>
            <code>{JSON.stringify(data, null, 2)}</code>
          </pre>
        )}
      </main>
    </div>
  );
}

export default App;
