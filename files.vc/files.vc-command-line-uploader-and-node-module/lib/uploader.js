/**
 * Files.vc Uploader Module
 * Core functionality for uploading files to files.vc
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

/**
 * Upload a file to files.vc
 * @param {string} filePath - Path to the file to upload
 * @param {Object} options - Upload options
 * @param {string} options.apiKey - Files.vc API key
 * @param {string} [options.accountId] - Optional account ID to associate with the upload
 * @param {Function} [options.logger] - Optional logger function (defaults to console.log)
 * @returns {Promise<Object|null>} - Response data or null if upload failed
 */
async function uploadFile(filePath, options) {
  const { apiKey, accountId, logger = console.log } = options;
  
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at ${filePath}`);
    }
    
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    
    // Check if file size is within limits (10GB)
    if (fileSizeMB > 10 * 1024) {
      throw new Error('File size exceeds the 10GB limit');
    }
    
    logger(`Uploading ${path.basename(filePath)} to files.vc...`);
    
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    // Set headers
    const headers = {
      'X-API-Key': apiKey,
      ...form.getHeaders()
    };
    
    // Add account ID if provided
    if (accountId) {
      headers['X-Account-ID'] = accountId;
      logger(`Using account ID: ${accountId} (files will never expire)`);
    }
    
    const response = await axios.post('https://api.files.vc/upload', form, { headers });
    
    if (response.data && (response.data.file_url || response.data.page_url)) {
      logger('Upload successful!');
      
      if (response.data.page_url) {
        logger(`Page URL: ${response.data.page_url}`);
      }
      
      if (response.data.file_url) {
        logger(`Direct File URL: ${response.data.file_url}`);
      }
      
      return response.data;
    } else {
      throw new Error('Unexpected response format');
    }
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    throw new Error(`Upload failed: ${errorMessage}`);
  }
}

module.exports = {
  uploadFile
}; 