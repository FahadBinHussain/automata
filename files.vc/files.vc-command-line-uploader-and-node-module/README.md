# Files.vc Uploader

A simple command-line tool and Node.js module to upload files to [files.vc](https://files.vc/).

This folder preserves the useful contents of the former `files.vc-Uploader` repo inside `automata`.

## Features

- Upload files to files.vc directly from your terminal
- Associate uploads with your account ID to prevent file expiration
- Use as a standalone CLI tool or as a module in your Node.js projects
- Simple and easy to use

## Installation

### As a standalone CLI tool

1. Open this folder
2. Install dependencies:
   ```
   pnpm install
   ```
3. Create a `.env` file based on `.env.example` with your API key and account ID
4. Make it globally available (optional):
   ```
   pnpm link --global
   ```

### As a local module

To use this utility from another local script:

1. Install dependencies in this folder:
   ```
   pnpm install
   ```
2. Import the uploader with a relative path:
   ```javascript
   const { uploadFile } = require('./files.vc-command-line-uploader-and-node-module/lib/uploader');
   ```

## Configuration

### For CLI usage

Create a `.env` file in the root directory with the following variables:

```
FILES_VC_API_KEY=your-api-key-here
FILES_VC_ACCOUNT_ID=your-account-id-here
```

- **API Key**: Required for authentication with files.vc API
- **Account ID**: Optional. When provided, files will never expire and will be associated with your account

### For Module usage

When using as a module, you need to provide the API key and optionally the account ID directly to the function:

```javascript
const { uploadFile } = require('./lib/uploader');

// Upload a file
try {
  const result = await uploadFile('path/to/file.jpg', {
    apiKey: 'your-api-key-here',
    accountId: 'your-account-id-here', // Optional
    logger: console.log // Optional
  });
  
  console.log('Upload successful!');
  console.log('Page URL:', result.page_url);
  console.log('Direct File URL:', result.file_url);
} catch (error) {
  console.error('Upload failed:', error.message);
}
```

## CLI Usage

```
filesvc-uploader <filepath> [options]
```

### Options

- `-a, --account-id <id>`: Override the account ID from the environment variable
- `-k, --api-key <key>`: Override the API key from the environment variable

### Examples

Upload a file using the account ID from the environment:
```
filesvc-uploader path/to/your/file.jpg
```

Upload a file with a specific account ID (overriding the one in .env):
```
filesvc-uploader path/to/your/file.jpg -a <account-id>
```

## Module API

### `uploadFile(filePath, options)`

Uploads a file to files.vc.

#### Parameters

- `filePath` (string): Path to the file to upload
- `options` (object): Upload options
  - `apiKey` (string): Files.vc API key
  - `accountId` (string, optional): Account ID to associate with the upload
  - `logger` (function, optional): Logger function (defaults to console.log)

#### Returns

Promise that resolves to an object containing:
- `page_url`: URL to the file page
- `file_url`: Direct URL to the file

#### Throws

- Error if the file doesn't exist
- Error if the file size exceeds 10GB
- Error if the upload fails

## Notes

- Maximum file size: 10GB
- Files uploaded with an account ID will never expire
- Without an account ID, files may expire after some time

## API Documentation

For more information about the files.vc API, visit [https://files.vc/api](https://files.vc/api).
