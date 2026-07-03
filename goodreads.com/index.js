/**
 * Goodreads Scraper
 * A library for scraping book details from Goodreads
 */

const { scrapeGoodreads } = require('./src/scraper');

/**
 * Main export for the Goodreads Scraper library
 * 
 * @module goodreads-scraper
 */
module.exports = {
  /**
   * Scrape book details from a Goodreads URL
   * 
   * @param {string} url - The Goodreads book URL to scrape
   * @returns {Promise<Object>} - A promise that resolves to a book details object
   * @example
   * const { scrapeGoodreads } = require('goodreads-scraper');
   * 
   * scrapeGoodreads('https://www.goodreads.com/book/show/12067.Good_Omens')
   *   .then(bookDetails => console.log(bookDetails))
   *   .catch(err => console.error('Error:', err));
   */
  scrapeGoodreads
}; 