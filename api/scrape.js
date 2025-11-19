import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FCC_BASE = 'https://www.freecodecamp.org';
const FCC_NEWS = `${FCC_BASE}/news`;

// Topics to scrape
const TOPICS = [
  'javascript',
  'react',
  'python',
  'web-development',
  'programming',
  'data-science',
  'machine-learning',
  'nodejs',
  'typescript',
  'css'
];

async function scrapeArticle(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const title = $('h1.post-full-title').text().trim() || 
                 $('h1').first().text().trim();
    
    const content = $('.post-content').text().trim() || 
                   $('article').text().trim();
    
    const summary = $('meta[property="og:description"]').attr('content') ||
                   content.slice(0, 500);
    
    const author = $('.author-card-name').text().trim() ||
                  $('meta[name="author"]').attr('content') ||
                  'FreeCodeCamp';
    
    return {
      title: title || 'Untitled',
      content: content.slice(0, 15000),
      summary: summary.slice(0, 500),
      author
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
}

async function getArticleLinksForTopic(topic, limit = 20) {
  try {
    const url = `${FCC_NEWS}/tag/${topic}/`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const links = [];
    $('a.post-card-content-link').each((i, elem) => {
      if (i >= limit) return false;
      const href = $(elem).attr('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `${FCC_BASE}${href}`;
        links.push(fullUrl);
      }
    });
    
    return links;
  } catch (error) {
    console.error(`Error getting links for ${topic}:`, error.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🚀 FreeCodeCamp scraper started');
    const startTime = Date.now();
    let totalScraped = 0;
    let totalErrors = 0;

    // Get or create source
    const { data: source, error: sourceError } = await supabase
      .from('knowledge_sources')
      .upsert({
        name: 'FreeCodeCamp',
        source_type: 'tutorials',
        base_url: 'https://www.freecodecamp.org',
        scrape_frequency: 'daily',
        is_active: true,
        last_scraped_at: new Date().toISOString()
      }, {
        onConflict: 'name'
      })
      .select()
      .single();

    if (sourceError) {
      console.error('Source error:', sourceError);
      return res.status(500).json({ error: 'Failed to create source' });
    }

    console.log(`✅ Source: ${source.name} (ID: ${source.id})`);

    // Scrape each topic
    for (const topic of TOPICS) {
      try {
        console.log(`\n📚 Scraping topic: ${topic}`);
        
        const links = await getArticleLinksForTopic(topic, 20);
        console.log(`  Found ${links.length} articles`);
        
        for (const url of links) {
          try {
            const articleData = await scrapeArticle(url);
            
            if (articleData) {
              const { error: insertError } = await supabase
                .from('knowledge_content')
                .upsert({
                  source_id: source.id,
                  title: articleData.title,
                  content_type: 'tutorial',
                  url: url,
                  content: articleData.content,
                  summary: articleData.summary,
                  metadata: {
                    topic: topic,
                    author: articleData.author,
                    scraped_at: new Date().toISOString()
                  },
                  scraped_at: new Date().toISOString()
                }, {
                  onConflict: 'url'
                });

              if (insertError) {
                console.error(`  ⚠️  Insert error:`, insertError.message);
                totalErrors++;
              } else {
                totalScraped++;
                if (totalScraped % 10 === 0) {
                  console.log(`  ✅ Progress: ${totalScraped} articles`);
                }
              }
            }
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (error) {
            console.error(`  ❌ Error with ${url}:`, error.message);
            totalErrors++;
          }
        }
        
        console.log(`  ✅ Completed ${topic}: ${links.length} articles`);
        
      } catch (error) {
        console.error(`  ❌ Error with topic ${topic}:`, error.message);
        totalErrors++;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Update source stats
    await supabase
      .from('knowledge_sources')
      .update({
        last_scraped_at: new Date().toISOString(),
        metadata: {
          last_scrape_duration: duration,
          last_scrape_count: totalScraped,
          last_scrape_errors: totalErrors
        }
      })
      .eq('id', source.id);

    const response = {
      success: true,
      source: 'FreeCodeCamp',
      scraped: totalScraped,
      errors: totalErrors,
      duration: `${duration}s`,
      timestamp: new Date().toISOString()
    };

    console.log('\n✅ Scraping complete:', response);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
