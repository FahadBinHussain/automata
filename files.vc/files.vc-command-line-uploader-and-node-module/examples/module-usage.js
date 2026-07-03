/**
 * Example of using the files.vc uploader as a module
 */

// Import the uploader module
// If used from another script, the path should be relative to your project
const { uploadFile } = require('../lib/uploader');

// Define a custom logger function (optional)
const logger = (message) => {
  console.log(`[FILES.VC] ${message}`);
};

// Upload a file
async function uploadMyFile() {
  try {
    // Replace with your actual API key and account ID
    const apiKey = 'your-api-key-here';
    const accountId = 'your-account-id-here'; // Optional
    
    // Path to the file you want to upload
    const filePath = './example.txt';
    
    // Upload the file
    const result = await uploadFile(filePath, {
      apiKey,
      accountId,
      logger
    });
    
    // Process the result
    console.log('Upload successful!');
    console.log('Page URL:', result.page_url);
    console.log('Direct File URL:', result.file_url);
    
    return result;
  } catch (error) {
    console.error('Upload failed:', error.message);
    return null;
  }
}

// Execute the upload function
uploadMyFile().then(() => {
  console.log('Done!');
}); 
