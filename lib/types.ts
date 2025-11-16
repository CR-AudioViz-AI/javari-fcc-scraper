// ================================================================================
// TYPE DEFINITIONS FOR JAVARI FREECODECAMP SCRAPER
// ================================================================================

export interface FCCCertification {
  title: string
  slug: string
  url: string
  description: string
  category: 'web-design' | 'javascript' | 'frontend' | 'data-viz' | 'apis' | 'security' | 'python' | 'data-analysis' | 'ml'
}

export interface FCCChallenge {
  title: string
  url: string
  description: string
  instructions: string
  tests: string[]
  solution?: string
}

export interface ScrapeResult {
  success: boolean
  url: string
  title: string
  content: string
  markdown?: string
  codeSnippets: CodeSnippet[]
  wordCount: number
  characterCount: number
  keywords: string[]
  topics: string[]
  error?: string
}

export interface CodeSnippet {
  language: string
  code: string
  description?: string
}

export interface ScraperConfig {
  concurrency: number
  delayMs: number
  timeoutMs: number
  maxRetries: number
  rateLimitPerMinute: number
  rateLimitPerHour: number
}

export interface JobProgress {
  jobId: string
  status: string
  progress: number
  totalUrls: number
  processedUrls: number
  failedUrls: number
  itemsScraped: number
  startedAt: string
  estimatedCompletion?: string
}
