#!/usr/bin/env node

/**
 * Command-line interface for the Goodreads Scraper
 */

const { scrapeGoodreads } = require('./scraper');

// Get URL from command line argument
const commandLineUrl = process.argv[2];

// Process and validate command line arguments
async function main() {
  // Check if URL is provided
  if (!commandLineUrl) {
    console.log('\nGoodreads Scraper CLI');
    console.log('====================\n');
    console.log('Usage: goodreads-scraper <url>');
    console.log('Example: goodreads-scraper https://www.goodreads.com/book/show/12067.Good_Omens\n');
    process.exit(1);
  }

  // Validate URL format
  if (!commandLineUrl.match(/^https?:\/\/www\.goodreads\.com\/book\/show\/\d+/)) {
    console.error('Error: Invalid Goodreads URL. URL should be in the format:');
    console.error('https://www.goodreads.com/book/show/[book_id]');
    process.exit(1);
  }

  try {
    console.log(`Scraping: ${commandLineUrl}\n`);
    
    // Scrape the book details
    const bookDetails = await scrapeGoodreads(commandLineUrl);
    
    // Output as formatted JSON to preserve line breaks
    console.log(JSON.stringify(bookDetails, null, 2));
    
    console.log('\nScraping completed successfully.');
  } catch (error) {
    console.error('\nError scraping Goodreads:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
    }
    process.exit(1);
  }
}

// Run the main function
main(); 