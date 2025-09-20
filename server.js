const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Facebook Automation Server Running', 
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage()
  });
});

// Facebook automation endpoint
app.post('/facebook-comment', async (req, res) => {
  let browser = null;
  
  try {
    const { posts, email, password } = req.body;
    
    if (!posts || !email || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields: posts, email, password' 
      });
    }
    
    console.log(`Starting automation for ${posts.length} posts`);
    
    // Optimized browser launch for Railway
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--memory-pressure-off',
        '--max-old-space-size=512'
      ],
      timeout: 60000
    });

    const page = await browser.newPage();
    
    // Reduce memory usage
    await page.setViewport({ width: 1024, height: 768 });
    await page.setRequestInterception(true);
    
    // Block images and CSS to save memory
    page.on('request', (req) => {
      if(req.resourceType() == 'stylesheet' || req.resourceType() == 'image'){
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // Login to Facebook
    console.log('Navigating to Facebook...');
    await page.goto('https://www.facebook.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    await delay(3000);

    // Enter credentials
    console.log('Entering credentials...');
    await page.waitForSelector('#email', { timeout: 15000 });
    await page.type('#email', email, { delay: 100 });
    await delay(1000);
    
    await page.waitForSelector('#pass', { timeout: 15000 });
    await page.type('#pass', password, { delay: 100 });
    await delay(1000);

    // Click login
    await page.waitForSelector('[data-testid="royal_login_button"]', { timeout: 15000 });
    await page.click('[data-testid="royal_login_button"]');

    // Wait for login
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      await delay(5000);
    }

    // Check login success
    const loginSuccess = await page.evaluate(() => {
      return !document.querySelector('#email') && !document.querySelector('#pass');
    });

    if (!loginSuccess) {
      await browser.close();
      return res.status(400).json({ 
        error: 'Login failed - check credentials' 
      });
    }

    console.log('Login successful!');
    
    // Process posts
    const results = [];
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      
      try {
        console.log(`Processing post ${i + 1}/${posts.length}`);
        
        await page.goto(post.url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });
        await delay(3000);
        
        // Find comment box
        const commentSelectors = [
          '[aria-label="Write a comment"]',
          '[placeholder="Write a comment..."]',
          'div[role="textbox"]'
        ];
        
        let commentBox = null;
        for (const selector of commentSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            commentBox = selector;
            break;
          } catch (e) {
            continue;
          }
        }
        
        if (!commentBox) {
          results.push({ 
            url: post.url, 
            status: 'failed', 
            error: 'Comment box not found' 
          });
          continue;
        }
        
        // Post comment
        await page.click(commentBox);
        await delay(1000);
        await page.type(commentBox, post.comment, { delay: 50 });
        await delay(2000);
        await page.keyboard.press('Enter');
        await delay(3000);
        
        results.push({ 
          url: post.url, 
          status: 'success', 
          comment: post.comment.substring(0, 50) + '...',
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Posted comment ${i + 1}`);
        
        // Delay between posts
        if (i < posts.length - 1) {
          const nextDelay = 30000 + Math.random() * 60000; // 30-90 seconds
          console.log(`Waiting ${Math.round(nextDelay/1000)} seconds...`);
          await delay(nextDelay);
        }
        
      } catch (error) {
        console.error(`Error processing ${post.url}:`, error.message);
        results.push({ 
          url: post.url, 
          status: 'failed', 
          error: error.message
        });
      }
    }
    
    await browser.close();
    browser = null;
    
    res.json({ 
      success: true, 
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length,
        completedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Server error:', error);
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message 
    });
  }
});

// Simple delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});