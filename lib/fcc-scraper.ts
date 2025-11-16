// ================================================================================
// FREECODECAMP SCRAPER - MAIN LOGIC
// ================================================================================
// Scrapes coding tutorials from FreeCodeCamp and stores in Supabase
// ================================================================================

import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'crypto'
import { supabaseAdmin } from './supabase'
import type { ScrapeResult, CodeSnippet, ScraperConfig, FCCCertification } from './types'

const FCC_BASE = 'https://www.freecodecamp.org'

export class FCCScraper {
  private config: ScraperConfig
  private sourceId: string | null = null

  constructor(config?: Partial<ScraperConfig>) {
    this.config = {
      concurrency: config?.concurrency || 3,
      delayMs: config?.delayMs || 1000,
      timeoutMs: config?.timeoutMs || 30000,
      maxRetries: config?.maxRetries || 3,
      rateLimitPerMinute: config?.rateLimitPerMinute || 60,
      rateLimitPerHour: config?.rateLimitPerHour || 1000,
    }
  }

  /**
   * Get predefined FreeCodeCamp certifications to scrape
   */
  async getFCCCertifications(): Promise<FCCCertification[]> {
    return [
      {
        title: 'Responsive Web Design',
        slug: 'responsive-web-design',
        url: `${FCC_BASE}/learn/2022/responsive-web-design/`,
        description: 'Learn HTML and CSS fundamentals',
        category: 'web-design',
      },
      {
        title: 'JavaScript Algorithms and Data Structures',
        slug: 'javascript-algorithms',
        url: `${FCC_BASE}/learn/javascript-algorithms-and-data-structures-v8/`,
        description: 'Learn JavaScript programming fundamentals',
        category: 'javascript',
      },
      {
        title: 'Front End Development Libraries',
        slug: 'front-end-libraries',
        url: `${FCC_BASE}/learn/front-end-development-libraries/`,
        description: 'Learn React, Redux, Bootstrap, and jQuery',
        category: 'frontend',
      },
      {
        title: 'Data Visualization',
        slug: 'data-visualization',
        url: `${FCC_BASE}/learn/data-visualization/`,
        description: 'Learn D3.js for data visualization',
        category: 'data-viz',
      },
      {
        title: 'APIs and Microservices',
        slug: 'back-end-development-and-apis',
        url: `${FCC_BASE}/learn/back-end-development-and-apis/`,
        description: 'Learn Node.js and Express',
        category: 'apis',
      },
      {
        title: 'Scientific Computing with Python',
        slug: 'scientific-computing-with-python',
        url: `${FCC_BASE}/learn/scientific-computing-with-python-v7/`,
        description: 'Learn Python fundamentals',
        category: 'python',
      },
      {
        title: 'Data Analysis with Python',
        slug: 'data-analysis-with-python',
        url: `${FCC_BASE}/learn/data-analysis-with-python-v7/`,
        description: 'Learn data analysis using Python',
        category: 'data-analysis',
      },
      {
        title: 'Machine Learning with Python',
        slug: 'machine-learning-with-python',
        url: `${FCC_BASE}/learn/machine-learning-with-python-v7/`,
        description: 'Learn machine learning fundamentals',
        category: 'ml',
      },
    ]
  }

  /**
   * Get challenge pages from a certification
   */
  async getCertificationPages(certUrl: string): Promise<string[]> {
    try {
      const response = await axios.get(certUrl, {
        timeout: this.config.timeoutMs,
        headers: {
          'User-Agent': 'Javari-FCC-Scraper/1.0',
        },
      })

      const $ = cheerio.load(response.data)
      const urls: string[] = [certUrl]

      // Find all challenge links
      $('a[href^="/learn/"]').each((_, elem) => {
        const href = $(elem).attr('href')
        if (href && href.includes('/learn/')) {
          const fullUrl = href.startsWith('http') ? href : `${FCC_BASE}${href}`
          if (!urls.includes(fullUrl)) {
            urls.push(fullUrl)
          }
        }
      })

      return urls.slice(0, 50) // Limit to 50 challenges per certification
    } catch (error) {
      console.error(`Error getting pages from ${certUrl}:`, error)
      return [certUrl]
    }
  }

  /**
   * Scrape a single FreeCodeCamp page
   */
  async scrapePage(url: string): Promise<ScrapeResult> {
    try {
      const response = await axios.get(url, {
        timeout: this.config.timeoutMs,
        headers: {
          'User-Agent': 'Javari-FCC-Scraper/1.0',
        },
      })

      const html = response.data
      const $ = cheerio.load(html)

      // Extract title
      const title = $('h1').first().text().trim() || $('title').text().trim()

      // Extract main content
      const content = $('.challenge-instructions, .certification-desc, article, main')
        .text()
        .trim()

      // Extract code snippets
      const codeSnippets: CodeSnippet[] = []
      $('pre code, .code-editor').each((_, elem) => {
        const code = $(elem).text().trim()
        const language = $(elem).attr('class')?.match(/language-(\w+)/)?.[1] || 'javascript'
        if (code && code.length > 10) {
          codeSnippets.push({ language, code })
        }
      })

      // Generate markdown
      const markdown = this.htmlToMarkdown($)

      // Extract keywords and topics
      const keywords = this.extractKeywords(content)
      const topics = url.split('/').filter((p) => p && p !== 'learn')

      // Count words and characters
      const wordCount = content.split(/\s+/).filter(Boolean).length
      const characterCount = content.length

      return {
        success: true,
        url,
        title,
        content,
        markdown,
        codeSnippets,
        wordCount,
        characterCount,
        keywords,
        topics,
      }
    } catch (error) {
      return {
        success: false,
        url,
        title: '',
        content: '',
        codeSnippets: [],
        wordCount: 0,
        characterCount: 0,
        keywords: [],
        topics: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Scrape an entire certification
   */
  async scrapeCertification(
    cert: FCCCertification,
    jobId: string,
    onProgress?: (progress: number, total: number) => void
  ): Promise<{ success: number; failed: number; total: number }> {
    console.log(`Starting scrape of ${cert.title}...`)

    // Get all pages in this certification
    const urls = await this.getCertificationPages(cert.url)
    const total = urls.length

    console.log(`Found ${total} pages in ${cert.title}`)

    let successCount = 0
    let failedCount = 0

    // Update job with total URLs
    await this.updateJob(jobId, {
      total_urls: total,
      status: 'running',
      started_at: new Date().toISOString(),
    })

    // Process URLs in batches
    for (let i = 0; i < urls.length; i += this.config.concurrency) {
      const batch = urls.slice(i, i + this.config.concurrency)

      const results = await Promise.all(batch.map((url) => this.scrapePage(url)))

      // Save results to database
      for (const result of results) {
        if (result.success) {
          await this.saveContent(result, cert.slug)
          successCount++
        } else {
          failedCount++
        }

        // Update job progress
        const processed = successCount + failedCount
        const progress = (processed / total) * 100

        await this.updateJob(jobId, {
          urls_processed: processed,
          urls_failed: failedCount,
          progress_percentage: progress,
          items_scraped: successCount,
        })

        // Call progress callback
        if (onProgress) {
          onProgress(processed, total)
        }
      }

      // Delay between batches
      if (i + this.config.concurrency < urls.length) {
        await this.delay(this.config.delayMs)
      }
    }

    // Mark job as complete
    await this.updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })

    return {
      success: successCount,
      failed: failedCount,
      total,
    }
  }

  /**
   * Save scraped content to Supabase
   */
  private async saveContent(result: ScrapeResult, category: string) {
    try {
      // Get or create knowledge source
      if (!this.sourceId) {
        const { data: source } = await supabaseAdmin
          .from('knowledge_sources')
          .select('id')
          .eq('url', FCC_BASE)
          .single()

        this.sourceId = source?.id || null
      }

      if (!this.sourceId) {
        console.error('No source ID found for FreeCodeCamp')
        return
      }

      // Generate content hash
      const contentHash = crypto.createHash('sha256').update(result.content).digest('hex')

      // Check if content already exists
      const { data: existing } = await supabaseAdmin
        .from('knowledge_content')
        .select('id, content_hash')
        .eq('url', result.url)
        .single()

      if (existing && existing.content_hash === contentHash) {
        return
      }

      // Insert or update content
      const contentData = {
        source_id: this.sourceId,
        url: result.url,
        title: result.title,
        content_type: 'tutorial',
        content: result.content,
        markdown: result.markdown,
        code_snippets: result.codeSnippets,
        word_count: result.wordCount,
        character_count: result.characterCount,
        keywords: result.keywords,
        topics: result.topics,
        content_hash: contentHash,
        processed: false,
      }

      if (existing) {
        await supabaseAdmin.from('knowledge_content').update(contentData).eq('id', existing.id)
      } else {
        await supabaseAdmin.from('knowledge_content').insert(contentData)
      }
    } catch (error) {
      console.error('Error saving content:', error)
    }
  }

  /**
   * Update scraping job status
   */
  private async updateJob(jobId: string, updates: Record<string, any>) {
    try {
      await supabaseAdmin.from('scraping_jobs').update(updates).eq('id', jobId)
    } catch (error) {
      console.error('Error updating job:', error)
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Extract keywords from content
   */
  private extractKeywords(content: string): string[] {
    const words = content
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3)

    const frequency: Record<string, number> = {}
    words.forEach((word) => {
      frequency[word] = (frequency[word] || 0) + 1
    })

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word)
  }

  /**
   * Convert HTML to simplified Markdown
   */
  private htmlToMarkdown($: cheerio.CheerioAPI): string {
    let markdown = ''

    $('h1, h2, h3, h4').each((_, el) => {
      const level = parseInt(el.tagName[1])
      markdown += '#'.repeat(level) + ' ' + $(el).text().trim() + '\n\n'
    })

    $('p').each((_, el) => {
      markdown += $(el).text().trim() + '\n\n'
    })

    $('pre code').each((_, el) => {
      const code = $(el).text().trim()
      const language = $(el).attr('class')?.match(/language-(\w+)/)?.[1] || 'javascript'
      markdown += '```' + language + '\n' + code + '\n```\n\n'
    })

    return markdown.trim()
  }
}

// Export singleton instance
export const fccScraper = new FCCScraper()
