import { useState, useEffect } from 'react';
import { trpc } from './lib/trpc';
import { settings } from './config';
import './App.css';

const stripHtml = (html: string) => {
  let text = html;
  
  // 1. Handle anchor tags specially to preserve the full href
  text = text.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, content) => {
    return `${content} (${href})`;
  });

  // 2. Handle paragraphs and line breaks
  text = text.replace(/<p>/gi, '\n\n')
             .replace(/<br\s*\/?>/gi, '\n');

  // 3. Strip all other tags
  text = text.replace(/<[^>]*>?/gm, '');

  // 4. Decode common HTML entities
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

function App() {
  const [url, setUrl] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState('');

  const [hnPosts, setHnPosts] = useState<any[]>([]);
  const [hnStats, setHnStats] = useState<{ total: number; processed: number } | null>(null);
  const [isHnLoading, setIsHnLoading] = useState(true);
  const [hnThreadInfo, setHnThreadInfo] = useState<{ id: string; title: string } | null>(null);

  const { data: jobsResult, isLoading: isJobsLoading, refetch: refetchJobs } = trpc.job.list.useQuery();

  useEffect(() => {
    fetch(`${settings.adminApiUrl}/hn/latest-posts`)
      .then(res => res.json())
      .then((data: any) => {
        setHnPosts(data.posts || []);
        setHnThreadInfo({ id: data.threadId, title: data.threadTitle });
        setHnStats(data.stats || null);
        setIsHnLoading(false);
      })
      .catch(err => {
        console.error('Error fetching HN posts:', err);
        setIsHnLoading(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTriggering(true);
    setTriggerMessage('');

    try {
      const response = await fetch(`${settings.adminApiUrl}/trigger-workflow`, {
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

  const recentJobs = jobsResult?.jobs || [];

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

        {hnStats && (
          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#e0f7fa', borderRadius: '8px', display: 'flex', gap: '24px' }}>
             <div><strong>Total Posts:</strong> {hnStats.total}</div>
             <div><strong>Processed:</strong> {hnStats.processed}</div>
             <div><strong>Remaining:</strong> {hnStats.total - hnStats.processed}</div>
          </div>
        )}

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
                  {post.isProcessed ? (
                    <span style={{
                      padding: '2px 8px',
                      fontSize: '12px',
                      backgroundColor: '#e0e0e0',
                      color: '#666',
                      borderRadius: '4px',
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      ✅ Processed
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setIsTriggering(true);
                        const plainText = stripHtml(post.text);
                        fetch(`${settings.adminApiUrl}/trigger-workflow`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ hnPostId: post.id, postText: plainText })
                        })
                        .then(async res => {
                          const data = await res.json() as any;
                          if (!res.ok) {
                            console.error('Workflow trigger failed:', data);
                            throw new Error(data.error || 'Failed to start workflow');
                          }
                          return data;
                        })
                        .then((data: any) => {
                          setTriggerMessage(`Workflow started for post ${post.id}: ${data.workflowId}`);
                          setTimeout(() => refetchJobs(), 3000);
                        })
                        .catch((err: any) => setTriggerMessage(`Error: ${err.message}`))
                        .finally(() => setIsTriggering(false));
                      }}
                      disabled={isTriggering}
                      style={{ padding: '2px 8px', fontSize: '12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Process
                    </button>
                  )}
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
        ) : recentJobs.length > 0 ? (
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
              {recentJobs.slice(0, 10).map((job: any) => (
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
