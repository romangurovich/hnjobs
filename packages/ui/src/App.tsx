import './App.css';
import { trpc } from './lib/trpc';
import { useFilterStore } from './lib/store';

function App() {
  const { data, isLoading, error } = trpc.job.list.useQuery({
    search: 'frontend',
  });

  const { searchQuery, setSearchQuery } = useFilterStore();

  return (
    <div>
      <h1>HN Jobs Board</h1>

      <main>
        <h2>Job List (from API)</h2>
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
