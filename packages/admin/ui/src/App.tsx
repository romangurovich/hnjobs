import { useState } from 'react';
import { trpc } from './lib/trpc';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState('');

  const [hnPosts, setHnPosts] = useState<any[]>([]);
  const [isHnLoading, setIsHnLoading] = useState(true);
  const [hnThreadInfo, setHnThreadInfo] = useState<{ id: string; title: string } | null>(null);

  const { data: jobs, isLoading: isJobsLoading, refetch: refetchJobs } = trpc.job.list.useQuery();

  useState(() => {
    fetch('http://localhost:8081/hn/latest-posts')
      .then(res => res.json())
      .then(data => {
        setHnPosts(data.posts || []);
        setHnThreadInfo({ id: data.threadId, title: data.threadTitle });
        setIsHnLoading(false);
      })
      .catch(err => {
        console.error('Error fetching HN posts:', err);
        setIsHnLoading(false);
      });
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTriggering(true);
    setTriggerMessage('');

    try {
      const response = await fetch('http://localhost:8081/trigger-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start workflow');
      }

      setTriggerMessage(`Workflow started successfully! ID: ${data.workflowId}`);
      setUrl('');
      // Refetch the job list after a short delay to see the new job
      setTimeout(() => refetchJobs(), 2000);
    } catch (error: any) {
      setTriggerMessage(`Error: ${error.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px' }}>
      <h1>HN Jobs - Admin</h1>
      
      <section style={{ marginBottom: '60px', padding: '24px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
        <h2>Trigger New Scrape</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px' }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter job URL to process"
            required
            style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <button 
            type="submit" 
            disabled={isTriggering}
            style={{ padding: '10px 20px', backgroundColor: '#ff6600', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {isTriggering ? 'Triggering...' : 'Start Workflow'}
          </button>
        </form>
        {triggerMessage && <p style={{ marginTop: '16px', fontWeight: 'bold', color: triggerMessage.startsWith('Error') ? 'red' : 'green' }}>{triggerMessage}</p>}
      </section>

      <section style={{ marginBottom: '60px' }}>
        <h2>Latest HN Posts Preview {hnThreadInfo && `(${hnThreadInfo.title})`}</h2>
        {isHnLoading ? (
          <p>Loading latest HN posts...</p>
        ) : (
          <div style={{ 
            maxHeight: '500px', 
            overflowY: 'auto', 
            border: '1px solid #eee', 
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'left',
            backgroundColor: '#fff'
          }}>
            {hnPosts.map((post) => (
              <div key={post.id} style={{ 
                marginBottom: '24px', 
                paddingBottom: '16px', 
                borderBottom: '1px solid #f0f0f0' 
              }}>
                <div style={{ marginBottom: '8px', fontSize: '14px', color: '#666', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <strong>{post.by}</strong> | {new Date(post.time * 1000).toLocaleString()} | 
                  <a 
                    href={`https://news.ycombinator.com/item?id=${post.id}`} 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ color: '#ff6600' }}
                  >
                    Original
                  </a>
                  <button 
                    onClick={() => {
                      setIsTriggering(true);
                      fetch('http://localhost:8081/trigger-workflow', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hnPostId: post.id, postText: post.text })
                      })
                      .then(res => res.json())
                      .then(data => {
                        setTriggerMessage(`Workflow started for post ${post.id}: ${data.workflowId}`);
                        setTimeout(() => refetchJobs(), 3000);
                      })
                      .catch(err => setTriggerMessage(`Error: ${err.message}`))
                      .finally(() => setIsTriggering(false));
                    }}
                    disabled={isTriggering}
                    style={{ padding: '2px 8px', fontSize: '12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Process
                  </button>
                </div>
                <div 
                  className="hn-post-text"
                  dangerouslySetInnerHTML={{ __html: post.text }} 
                  style={{ fontSize: '15px', lineHeight: '1.5' }}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Recently Processed Jobs</h2>
          <button onClick={() => refetchJobs()} style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '12px' }}>Refresh</button>
        </div>

        {isJobsLoading ? (
          <p>Loading jobs...</p>
        ) : jobs && jobs.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ padding: '12px' }}>Company</th>
                <th style={{ padding: '12px' }}>Title</th>
                <th style={{ padding: '12px' }}>Location</th>
                <th style={{ padding: '12px' }}>Processed At</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map((job: any) => (
                <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '12px' }}>{job.company_name}</td>
                  <td style={{ padding: '12px' }}>{job.job_title}</td>
                  <td style={{ padding: '12px' }}>{job.location}</td>
                  <td style={{ padding: '12px' }}>{new Date(job.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No jobs found in the database.</p>
        )}
      </section>
    </div>
  );
}

export default App;
