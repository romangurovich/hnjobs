import { useState, useEffect } from 'react';
import { trpc } from './lib/trpc';
import { settings } from './config';
import './App.css';

interface User {
  email: string;
  name: string;
}

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

// Helper for authenticated API calls
async function authFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include', // Include cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  const [hnPosts, setHnPosts] = useState<any[]>([]);
  const [hnStats, setHnStats] = useState<{ total: number; processed: number } | null>(null);
  const [isHnLoading, setIsHnLoading] = useState(true);
  const [hnThreadInfo, setHnThreadInfo] = useState<{ id: string; title: string } | null>(null);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const { data: jobsResult, isLoading: isJobsLoading, refetch: refetchJobs } = trpc.job.list.useQuery();

  // Check for auth errors in URL (from OAuth redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('auth_error');
    if (error) {
      const errorMessages: Record<string, string> = {
        access_denied: 'Access denied. Your email is not authorized.',
        token_exchange_failed: 'Authentication failed. Please try again.',
        userinfo_failed: 'Failed to get user info. Please try again.',
        server_error: 'Server error during authentication.',
      };
      setAuthError(errorMessages[error] || `Authentication error: ${error}`);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    authFetch(`${settings.adminApiUrl}/auth/me`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      })
      .catch((err) => {
        console.error('Auth check failed:', err);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  const handleLogin = () => {
    window.location.href = `${settings.adminApiUrl}/auth/google`;
  };

  const handleLogout = async () => {
    await authFetch(`${settings.adminApiUrl}/auth/logout`, { method: 'POST' });
    setUser(null);
  };

  // Fetch HN posts when authenticated
  useEffect(() => {
    if (!user) return; // Only fetch when authenticated
    
    authFetch(`${settings.adminApiUrl}/hn/latest-posts`)
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
  }, [user]);

  // Show loading state
  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: '20px' }}>
        <h1>HN Jobs - Admin</h1>
        <p style={{ color: '#666' }}>Sign in to access the admin panel</p>
        {authError && (
          <div style={{ padding: '12px 24px', backgroundColor: '#fee', color: '#c00', borderRadius: '8px', marginBottom: '10px' }}>
            {authError}
          </div>
        )}
        <button
          onClick={handleLogin}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: '#4285f4',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleProcessAllUnprocessed = async () => {
    if (!window.confirm(`Are you sure you want to process all ${hnStats ? hnStats.total - hnStats.processed : 'remaining'} unprocessed posts? This will start many workflows.`)) {
      return;
    }

    setIsProcessingAll(true);
    setTriggerMessage('');

    try {
      const response = await authFetch(`${settings.adminApiUrl}/process-all-unprocessed`, {
        method: 'POST',
      });

      const data = await response.json() as any;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process posts');
      }

      setTriggerMessage(`Started processing ${data.processed} posts. ${data.errors?.length ? `(${data.errors.length} errors)` : ''}`);
      
      // Refresh data after a delay
      setTimeout(() => {
        refetchJobs();
        // Refresh HN posts to update processed status
        authFetch(`${settings.adminApiUrl}/hn/latest-posts`)
          .then(res => res.json())
          .then((data: any) => {
            setHnPosts(data.posts || []);
            setHnStats(data.stats || null);
          });
      }, 5000);
    } catch (error: any) {
      setTriggerMessage(`Error: ${error.message}`);
    } finally {
      setIsProcessingAll(false);
    }
  };

  const handleClearAllJobs = async () => {
    if (!window.confirm('Are you sure you want to delete ALL jobs from the database? This action cannot be undone.')) {
      return;
    }

    setIsClearing(true);
    setTriggerMessage('');

    try {
      const response = await authFetch(`${settings.adminApiUrl}/clear-all-jobs`, {
        method: 'POST',
      });

      const data = await response.json() as any;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clear jobs');
      }

      setTriggerMessage('All jobs cleared successfully!');
      refetchJobs();
      // Reset the HN posts processed status
      setHnPosts(posts => posts.map(p => ({ ...p, isProcessed: false })));
      setHnStats(stats => stats ? { ...stats, processed: 0 } : null);
    } catch (error: any) {
      setTriggerMessage(`Error: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTriggering(true);
    setTriggerMessage('');

    try {
      const response = await authFetch(`${settings.adminApiUrl}/trigger-workflow`, {
        method: 'POST',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>HN Jobs - Admin</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#666' }}>{user.email}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              fontSize: '14px',
              backgroundColor: '#f0f0f0',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </div>
      
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
          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#e0f7fa', borderRadius: '8px', display: 'flex', gap: '24px', alignItems: 'center' }}>
             <div><strong>Total Posts:</strong> {hnStats.total}</div>
             <div><strong>Processed:</strong> {hnStats.processed}</div>
             <div><strong>Remaining:</strong> {hnStats.total - hnStats.processed}</div>
             {hnStats.total - hnStats.processed > 0 && (
               <button
                 onClick={handleProcessAllUnprocessed}
                 disabled={isProcessingAll || isTriggering}
                 style={{
                   marginLeft: 'auto',
                   padding: '10px 20px',
                   backgroundColor: '#2196F3',
                   color: 'white',
                   border: 'none',
                   borderRadius: '4px',
                   fontWeight: 'bold',
                   cursor: isProcessingAll ? 'not-allowed' : 'pointer',
                   opacity: isProcessingAll ? 0.7 : 1
                 }}
               >
                 {isProcessingAll ? 'Processing...' : `Process All ${hnStats.total - hnStats.processed} Posts`}
               </button>
             )}
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
                        authFetch(`${settings.adminApiUrl}/trigger-workflow`, {
                          method: 'POST',
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => refetchJobs()} style={{ padding: '6px 12px', fontSize: '12px' }}>Refresh</button>
            <button 
              onClick={handleClearAllJobs} 
              disabled={isClearing}
              style={{ 
                padding: '6px 12px', 
                fontSize: '12px', 
                backgroundColor: '#dc3545', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px', 
                cursor: isClearing ? 'not-allowed' : 'pointer' 
              }}
            >
              {isClearing ? 'Clearing...' : 'Clear All Jobs'}
            </button>
          </div>
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
