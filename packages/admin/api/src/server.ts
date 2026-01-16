import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as jwt from 'jsonwebtoken';
import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import { settings, isEmailAllowed } from './config';

// Extend Express Request to include user info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { email: string; name: string };
    }
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CORS config - allow credentials for cookies
app.use(cors({
  origin: settings.adminUiOrigin,
  credentials: true,
}));

const COOKIE_NAME = 'admin_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface JwtPayload {
  email: string;
  name: string;
}

// Auth middleware for protected routes
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, settings.jwtSecret) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ============ Google OAuth Routes ============

// Step 1: Redirect to Google
app.get('/auth/google', (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const params = new URLSearchParams({
    client_id: settings.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Handle Google callback
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error || !code) {
    return res.redirect(`${settings.adminUiOrigin}?auth_error=${error || 'no_code'}`);
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: settings.googleClientId,
        client_secret: settings.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errData = await tokenResponse.text();
      console.error('Token exchange failed:', errData);
      return res.redirect(`${settings.adminUiOrigin}?auth_error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json() as { access_token: string; id_token: string };

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect(`${settings.adminUiOrigin}?auth_error=userinfo_failed`);
    }

    const userInfo = await userResponse.json() as { email: string; name: string };

    // Check if email is allowed
    if (!isEmailAllowed(userInfo.email)) {
      console.warn(`Access denied for email: ${userInfo.email}`);
      return res.redirect(`${settings.adminUiOrigin}?auth_error=access_denied`);
    }

    // Create JWT session token
    const sessionToken = jwt.sign(
      { email: userInfo.email, name: userInfo.name },
      settings.jwtSecret,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie
    res.cookie(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });

    // Redirect back to admin UI
    res.redirect(settings.adminUiOrigin);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${settings.adminUiOrigin}?auth_error=server_error`);
  }
});

// Get current user info
app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

const temporalClient = new Client();

async function fetchWithRetry(url: string, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

app.get('/hn/latest-posts', requireAuth, async (req, res) => {
  try {
    console.log('Fetching latest "Who is hiring" thread ID...');
    const searchResponse = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story&hitsPerPage=5'
    );
    const searchData = await searchResponse.json() as any;
    
    if (!searchData.hits || searchData.hits.length === 0) {
      return res.status(404).json({ error: 'No "Who is hiring" thread found.' });
    }

    const hit = searchData.hits.find(
      (h: any) => typeof h.title === 'string' && /who is hiring\?/i.test(h.title)
    ) || searchData.hits[0];

    const threadId = hit.objectID;
    console.log(`Found thread ID: ${threadId}`);

    const threadResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const threadData = await threadResponse.json() as any;

    if (!threadData.kids || threadData.kids.length === 0) {
      return res.json({
        threadId,
        threadTitle: threadData.title,
        posts: [],
        stats: { total: 0, processed: 0 }
      });
    }

    const allPostIds: number[] = threadData.kids;
    console.log(`Fetching details for ${allPostIds.length} posts...`);

    // 1. Check which posts are already processed
    const input = JSON.stringify({ hnPostIds: allPostIds.map(String) });
    const checkResponse = await fetch(`${settings.apiUrl}/trpc/job.checkExisting?input=${encodeURIComponent(input)}`);

    const checkResult = await checkResponse.json() as any;
    // tRPC response format: { result: { data: { existingIds: [...] } } }
    const existingIds = new Set(checkResult.result?.data?.existingIds || []);

    // 2. Fetch post details in batches
    const BATCH_SIZE = 20;
    const posts: any[] = [];

    for (let i = 0; i < allPostIds.length; i += BATCH_SIZE) {
      const batchIds = allPostIds.slice(i, i + BATCH_SIZE);
      const batchPromises = batchIds.map(async (id: number) => {
        try {
          return await fetchWithRetry(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch (e) {
          console.error(`Failed to fetch post ${id}`, e);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      posts.push(...batchResults.filter((p: any) => p !== null && !p.deleted && !p.dead));

      // Small delay to be nice to HN API
      await new Promise(r => setTimeout(r, 100));
    }

    const processedPosts = posts.map(p => ({
      ...p,
      isProcessed: existingIds.has(String(p.id))
    }));

    res.json({
      threadId,
      threadTitle: threadData.title,
      posts: processedPosts,
      stats: {
        total: processedPosts.length,
        processed: processedPosts.filter(p => p.isProcessed).length
      }
    });
  } catch (error) {
    console.error('Error fetching HN posts:', error);
    res.status(500).json({ error: 'Failed to fetch HN posts' });
  }
});

app.post('/trigger-workflow', requireAuth, async (req, res) => {
  console.log('Received /trigger-workflow request:', { 
    url: req.body.url, 
    hnPostId: req.body.hnPostId, 
    postTextLength: req.body.postText?.length 
  });
  const { url, hnPostId, postText } = req.body;

  if (!url && (!hnPostId || !postText)) {
    return res.status(400).json({ error: 'Either URL or HN Post data is required' });
  }

  try {
    const workflowId = `job-${nanoid()}`;
    console.log(`Starting workflow ${workflowId}`);

    if (hnPostId && postText) {
      await temporalClient.workflow.start('processHNPost', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [hnPostId.toString(), postText],
        workflowExecutionTimeout: '30 minutes',
        workflowRunTimeout: '30 minutes',
      });
    } else if (url) {
      await temporalClient.workflow.start('crawlPageWorkflow', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [url, null], // Standalone crawl has no post ID
        workflowExecutionTimeout: '30 minutes',
        workflowRunTimeout: '30 minutes',
      });
    }

    console.log(`Workflow started successfully! Workflow ID: ${workflowId}`);
    res.json({ workflowId });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({ error: 'Failed to start workflow' });
  }
});

app.post('/process-all-unprocessed', requireAuth, async (req, res) => {
  console.log('Received /process-all-unprocessed request');

  try {
    // 1. Fetch the latest "Who is hiring" thread
    const searchResponse = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story&hitsPerPage=5'
    );
    const searchData = await searchResponse.json() as any;

    if (!searchData.hits || searchData.hits.length === 0) {
      return res.status(404).json({ error: 'No "Who is hiring" thread found.' });
    }

    const hit = searchData.hits.find(
      (h: any) => typeof h.title === 'string' && /who is hiring\?/i.test(h.title)
    ) || searchData.hits[0];

    const threadId = hit.objectID;
    console.log(`Found thread ID: ${threadId}`);

    // 2. Get all post IDs from the thread
    const threadResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const threadData = await threadResponse.json() as any;

    if (!threadData.kids || threadData.kids.length === 0) {
      return res.json({ processed: 0, message: 'No posts found in thread' });
    }

    const allPostIds: number[] = threadData.kids;

    // 3. Check which posts are already processed
    const input = JSON.stringify({ hnPostIds: allPostIds.map(String) });
    const checkResponse = await fetch(`${settings.apiUrl}/trpc/job.checkExisting?input=${encodeURIComponent(input)}`);
    const checkResult = await checkResponse.json() as any;
    const existingIds = new Set(checkResult.result?.data?.existingIds || []);

    // 4. Get unprocessed post IDs
    const unprocessedIds = allPostIds.filter(id => !existingIds.has(String(id)));
    console.log(`Found ${unprocessedIds.length} unprocessed posts out of ${allPostIds.length} total`);

    if (unprocessedIds.length === 0) {
      return res.json({ processed: 0, message: 'All posts are already processed!' });
    }

    // 5. Fetch details and trigger workflows for unprocessed posts (in batches)
    const BATCH_SIZE = 20;
    const startedWorkflows: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < unprocessedIds.length; i += BATCH_SIZE) {
      const batchIds = unprocessedIds.slice(i, i + BATCH_SIZE);
      
      // Fetch post details
      const batchPromises = batchIds.map(async (id: number) => {
        try {
          return await fetchWithRetry(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch (e) {
          console.error(`Failed to fetch post ${id}`, e);
          return null;
        }
      });

      const posts = (await Promise.all(batchPromises)).filter(
        (p: any) => p !== null && !p.deleted && !p.dead && p.text
      );

      // Trigger workflows for each post
      for (const p of posts) {
        const post = p as { id: number; text: string };
        try {
          const workflowId = `job-batch-${nanoid()}`;
          
          // Strip HTML from post text
          const plainText = post.text
            .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_: string, href: string, content: string) => `${content} (${href})`)
            .replace(/<p>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>?/gm, '')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#x27;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

          await temporalClient.workflow.start('processHNPost', {
            taskQueue: 'hn-jobs',
            workflowId: workflowId,
            args: [post.id.toString(), plainText],
            workflowExecutionTimeout: '30 minutes',
            workflowRunTimeout: '30 minutes',
          });

          startedWorkflows.push(workflowId);
          console.log(`Started workflow ${workflowId} for post ${post.id}`);
        } catch (error: any) {
          console.error(`Failed to start workflow for post ${post.id}:`, error.message);
          errors.push(`Post ${post.id}: ${error.message}`);
        }
      }

      // Small delay between batches to avoid overwhelming Temporal
      if (i + BATCH_SIZE < unprocessedIds.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Successfully started ${startedWorkflows.length} workflows`);
    res.json({
      processed: startedWorkflows.length,
      total: unprocessedIds.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Started processing ${startedWorkflows.length} posts`
    });
  } catch (error: any) {
    console.error('Error processing all posts:', error);
    res.status(500).json({ error: error.message || 'Failed to process posts' });
  }
});

app.post('/clear-all-jobs', requireAuth, async (req, res) => {
  console.log('Received /clear-all-jobs request');

  try {
    const response = await fetch(`${settings.apiUrl}/trpc/job.clearAll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const responseText = await response.text();
    
    // Check if response is HTML (error page) instead of JSON
    if (responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')) {
      console.error('API returned HTML instead of JSON:', responseText.substring(0, 200));
      throw new Error('API returned an error page. Make sure the API server is running.');
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse API response:', responseText.substring(0, 200));
      throw new Error('Invalid response from API');
    }

    if (!response.ok) {
      console.error('Failed to clear jobs:', result);
      throw new Error(result.error?.message || 'Failed to clear jobs from database');
    }

    console.log('All jobs cleared successfully');
    res.json({ success: true, result: result.result?.data });
  } catch (error: any) {
    console.error('Error clearing jobs:', error);
    res.status(500).json({ error: error.message || 'Failed to clear jobs' });
  }
});

app.listen(settings.port, () => {
  console.log(`Admin API server listening on http://localhost:${settings.port}`);
});
