# Goodreads Scraper

A Node.js library for scraping book details from Goodreads. This library extracts comprehensive information about books including title, authors, summary, genres, characters, ratings, and more.

## Features

- Extract complete book details including:
  - Title
  - Authors (supports multiple authors)
  - Book cover image URL
  - Summary/description (with preserved formatting)
  - Publication date and publisher
  - Genres
  - Rating information
  - Number of pages
  - Language
  - Series information (with position)
  - Character names
- Clean handling of series names and positions
- Support for parsing multiple book page layouts
- Proper error handling

## Installation

### As a dependency in your project

```bash
# Using npm
npm install git+https://github.com/yourusername/goodreads-scraper.git

# Using pnpm
pnpm add git+https://github.com/yourusername/goodreads-scraper.git

# Using yarn
yarn add git+https://github.com/yourusername/goodreads-scraper.git
```

### As a git submodule

```bash
# Add as a submodule to your project
git submodule add https://github.com/yourusername/goodreads-scraper.git

# Update the submodule
git submodule update --init --recursive
```

## Usage

### Basic Example

```javascript
const { scrapeGoodreads } = require('goodreads-scraper');

// Scrape a book's details
scrapeGoodreads('https://www.goodreads.com/book/show/12067.Good_Omens')
  .then(bookDetails => {
    console.log(`Title: ${bookDetails.bookName}`);
    console.log(`Authors: ${bookDetails.authors.join(', ')}`);
    console.log(`Summary: ${bookDetails.bookSummary}`);
  })
  .catch(error => {
    console.error('Error:', error.message);
  });
```

### Returned Data Structure

The `scrapeGoodreads` function returns a Promise that resolves to an object with the following properties:

```javascript
{
  bookName: "Good Omens: The Nice and Accurate Prophecies of Agnes Nutter, Witch",
  authors: ["Terry Pratchett", "Neil Gaiman"],
  imageUrl: "https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1615552073i/12067.jpg",
  bookSummary: "According to the Nice and Accurate Prophecies of Agnes Nutter...",
  publicationDate: "May 10, 1990",
  publisher: "William Morrow Paperbacks",
  genres: ["Fantasy", "Fiction", "Humor", "Audiobook", "Comedy", "Urban Fantasy"],
  ratings: "804034",
  averageRating: "4.25",
  numberOfPages: 491,
  language: "English",
  seriesName: null,
  positionInSeries: null,
  characters: ["Aziraphale", "Adam Young", "Anathema Device", "Newt Pulsifer"]
}
```

### Advanced Usage

See the examples directory for more advanced usage examples:

- `examples/simple-scrape.js` - Basic usage example
- `examples/multiple-books.js` - Scraping multiple books and saving to a file

## Development

### Prerequisites

- Node.js 14 or higher
- npm, pnpm, or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/goodreads-scraper.git
cd goodreads-scraper

# Install dependencies
pnpm install
```

### Running Tests

```bash
pnpm test
```

### Examples

```bash
# Run the simple example
pnpm start

# Run with a specific URL
node examples/simple-scrape.js https://www.goodreads.com/book/show/12067.Good_Omens

# Run the multiple books example
node examples/multiple-books.js
```

## License

MIT

## Disclaimer

This library is for educational purposes only. Make sure to respect Goodreads' terms of service and robots.txt policies when using this library. Add appropriate delays between requests to avoid overwhelming their servers.
