// ================================================================================
// API ROUTE: /api/scrape
// Triggers scraping of FreeCodeCamp tutorials
// ================================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fccScraper } from '@/lib/fcc-scraper'

export const maxDuration = 300 // 5 minutes
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { certSlug, priority = 5 } = body

    if (!certSlug) {
      return NextResponse.json({ error: 'certSlug is required' }, { status: 400 })
    }

    // Get or create knowledge source for FreeCodeCamp
    let sourceId: string

    const { data: existingSource } = await supabaseAdmin
      .from('knowledge_sources')
      .select('id')
      .eq('url', 'https://www.freecodecamp.org')
      .single()

    if (existingSource) {
      sourceId = existingSource.id
    } else {
      const { data: newSource, error: createError } = await supabaseAdmin
        .from('knowledge_sources')
        .insert({
          name: 'FreeCodeCamp',
          source_type: 'tutorial',
          url: 'https://www.freecodecamp.org',
          base_domain: 'freecodecamp.org',
          category: 'web_development',
          priority,
          trust_level: 'verified',
          status: 'active',
          scrape_enabled: true,
          scrape_frequency: 'weekly',
          tags: ['freecodecamp', 'tutorials', 'beginner-friendly', 'certification'],
        })
        .select('id')
        .single()

      if (createError || !newSource) {
        throw new Error('Failed to create knowledge source')
      }

      sourceId = newSource.id
    }

    // Create scraping job
    const { data: job, error: jobError } = await supabaseAdmin
      .from('scraping_jobs')
      .insert({
        source_id: sourceId,
        job_type: 'full_scrape',
        scheduled_at: new Date().toISOString(),
        status: 'pending',
        total_urls: 0,
        urls_processed: 0,
        urls_failed: 0,
        progress_percentage: 0,
        items_scraped: 0,
        items_new: 0,
        items_updated: 0,
        items_unchanged: 0,
        retry_count: 0,
        max_retries: 3,
        config: { certSlug },
      })
      .select()
      .single()

    if (jobError || !job) {
      throw new Error('Failed to create scraping job')
    }

    // Start scraping in background
    scrapeInBackground(job.id, certSlug, sourceId)

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: `Scraping started for ${certSlug}`,
    })
  } catch (error) {
    console.error('Scrape API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    // Get list of available certifications
    const certs = await fccScraper.getFCCCertifications()

    // Get already scraped certifications
    const { data: scrapedJobs } = await supabaseAdmin
      .from('scraping_jobs')
      .select('config, status')
      .eq('status', 'completed')

    const scrapedCerts = new Set(
      scrapedJobs?.map((job: any) => job.config?.certSlug).filter(Boolean) || []
    )

    // Mark which certifications are already scraped
    const certsWithStatus = certs.map((cert) => ({
      ...cert,
      scraped: scrapedCerts.has(cert.slug),
    }))

    return NextResponse.json({
      success: true,
      count: certs.length,
      certifications: certsWithStatus,
    })
  } catch (error) {
    console.error('Get certifications API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

async function scrapeInBackground(jobId: string, certSlug: string, sourceId: string) {
  try {
    const certs = await fccScraper.getFCCCertifications()
    const cert = certs.find((c) => c.slug === certSlug)

    if (!cert) {
      throw new Error(`Certification ${certSlug} not found`)
    }

    await fccScraper.scrapeCertification(cert, jobId)

    // Update source last_scraped_at
    await supabaseAdmin
      .from('knowledge_sources')
      .update({ last_scraped_at: new Date().toISOString() })
      .eq('id', sourceId)
  } catch (error) {
    console.error('Background scraping error:', error)

    await supabaseAdmin
      .from('scraping_jobs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }
}
