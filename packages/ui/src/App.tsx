
import { useState } from 'react';
import './App.css';
import { trpc } from './lib/trpc';
import { useFilterStore } from './lib/store';

function App() {
  const [url, setUrl] = useState('');
  const { data, isLoading, error } = trpc.job.list.useQuery({
    search: 'frontend',
  });
  const createJobMutation = trpc.job.create.useMutation();

  const { searchQuery, setSearchQuery } = useFilterStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createJobMutation.mutate({ url }, {
      onSuccess: (data) => {
        console.log('Workflow started:', data.workflowId);
        alert(`Workflow started: ${data.workflowId}`);
      },
      onError: (error) => {
        console.error('Error starting workflow:', error);
        alert(`Error: ${error.message}`);
      },
    });
  };

  return (
    <div>
      <h1>HN Jobs Board</h1>
      
      <form onSubmit={handleSubmit}>
        <h3>Temp form to trigger workflow</h3>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter job URL to process"
          style={{ width: '400px' }}
        />
        <button type="submit" disabled={createJobMutation.isPending}>
          {createJobMutation.isPending ? 'Starting...' : 'Start Workflow'}
        </button>
      </form>

      <hr />

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
